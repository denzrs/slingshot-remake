import { planShot, type Aim, type CpuLevel } from '../ai';
import { AIM, COLORS, FIELD, PHYSICS, SCORING, TEAMS } from '../config';
import { t } from '../i18n';
import { normalizeAngle, type ShotRules, type StyleKind, type World } from '../physics';
import { createRng, randomSeed, type Rng } from '../rng';
import { seatTeamsFor, type Seat, type Settings } from '../settings';
import { Volley, type VolleyAim, type VolleyEvent, type VolleyShot } from '../volley';
import { generateWorld } from '../world';

export type Mode = 'classic' | 'horizon' | 'challenge';
/** The modes you play against other ships, picked from the title menu. */
export type VersusMode = Exclude<Mode, 'challenge'>;
export type Phase = 'aiming' | 'flying' | 'killcam' | 'collapse' | 'roundOver' | 'gameOver';

export interface PlayerState {
  /** Index into `players` and `world.ships`. */
  id: number;
  /** Seat (0-based) — fixes name and colour for the whole match. */
  seat: number;
  name: string;
  cpu: CpuLevel | null;
  color: string;
  /** Team index in team mode, null in free for all. */
  team: number | null;
  /** Daily challenge: a stationary target drone rather than a ship that shoots. */
  target: boolean;
  score: number;
  angle: number;
  power: number;
  /** Shots fired this round. */
  shots: number;
  alive: boolean;
  /** Event Horizon: aim is locked in for the coming volley. */
  locked: boolean;
}

export interface Trail {
  owner: number;
  /** Flat [x0, y0, x1, y1, …] polyline in field units. */
  points: number[];
  /** Volley the shot belonged to (Event Horizon), so old ones can be dropped. */
  volley: number;
}

export interface KillRecord {
  /** null = swallowed by the black hole. */
  killer: number | null;
  victim: number;
  /** Points the killer got (negative for a self-hit or friendly fire). */
  points: number;
  self: boolean;
  /** Shot down a teammate. */
  friendly: boolean;
  combo: StyleKind[];
  multiplier: number;
  shots: number;
  power: number;
  /** Match clock when it happened — the kill feed fades entries by age. */
  at: number;
}

export type RoundTitle = 'hit' | 'selfHit' | 'swallowed' | 'lastInOrbit' | 'noneLeft' | 'teamWin' | 'cleared' | 'outOfShots';

export interface RoundSummary {
  title: RoundTitle;
  survivor: number | null;
  /** Winning team in team mode. */
  team: number | null;
  /** Bonus for the survivor — or for every member of the winning team. */
  bonus: number;
  lastKill: KillRecord | null;
}

/** Display name of a team, e.g. "Glut". */
export function teamName(team: number): string {
  return t(`team.${team as 0 | 1 | 2}`);
}

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

/** What the renderer should show: normally the live match, during a killcam the replay. */
export interface Scene {
  world: World;
  trails: Trail[];
  volley: Volley | null;
  camera: Camera | null;
}

export type GameEvent =
  | { type: 'round' }
  | { type: 'turn'; player: number }
  | { type: 'lock'; player: number }
  | { type: 'volley' }
  | { type: 'fire'; player: number; x: number; y: number; angle: number; power: number }
  | { type: 'impact'; player: number; x: number; y: number; vx: number; vy: number }
  | { type: 'fizzle'; player: number; x: number; y: number; vx: number; vy: number; lost: boolean }
  | { type: 'clash'; x: number; y: number; players: [number, number]; velocities: [{ x: number; y: number }, { x: number; y: number }] }
  | { type: 'devour'; x: number; y: number; toX: number; toY: number; color: string; vx: number; vy: number }
  | { type: 'style'; player: number; kind: StyleKind; x: number; y: number }
  | { type: 'explode'; x: number; y: number; ship: number; vx: number; vy: number }
  | { type: 'kill'; record: KillRecord }
  | { type: 'collapse'; x: number; y: number }
  | { type: 'killcam'; active: boolean; recording: boolean }
  | { type: 'roundEnd' }
  | { type: 'gameOver' };

export interface MatchOptions {
  /** Attract mode (title screen): rounds continue on their own, forever. */
  attract?: boolean;
  /** Override the seats from the settings (used by attract mode). */
  seats?: Seat[];
}

interface CpuJob {
  planner: Generator<void, Aim> | null;
  target: Aim | null;
  settle: number;
}

/**
 * Everything both modes share: players, rounds, scoring, CPU thinking and flying volleys.
 * Subclasses decide how turns are structured.
 */
export abstract class Match {
  abstract readonly mode: Mode;
  world!: World;
  phase: Phase = 'aiming';
  /** Seconds spent in the current phase. */
  phaseTime = 0;
  /** Seconds since the match started. */
  clock = 0;
  round = 0;
  /** Rounds in this match (0 = endless) — fixed when the match starts. */
  totalRounds = 0;
  /** Planets hidden this round — fixed when the round starts. */
  hiddenPlanets = false;
  /** Number of teams in this match; 0 = free for all. Fixed when the match starts. */
  teamMode = 0;
  players: PlayerState[] = [];
  /** Player currently aiming, -1 if nobody. */
  current = -1;
  trails: Trail[] = [];
  volley: Volley | null = null;
  killFeed: KillRecord[] = [];
  lastKill: KillRecord | null = null;
  summary: RoundSummary | null = null;
  /** Big transient announcement, e.g. "SALVE!". */
  notice: { text: string; color: string; at: number } | null = null;

  protected readonly rng: Rng = createRng(randomSeed());
  protected cpuJobs = new Map<number, CpuJob>();
  private listeners: ((e: GameEvent) => void)[] = [];
  private simClock = 0;

  constructor(
    public settings: Settings,
    protected readonly options: MatchOptions = {},
  ) {}

  abstract get rules(): ShotRules;
  /** Enter / "ready": classic fires, Event Horizon locks the aim in. */
  abstract commit(): void;
  protected abstract beginRound(): void;
  protected abstract updatePhase(dt: number): void;
  protected abstract afterVolley(): void;
  protected abstract killPoints(vs: VolleyShot): { points: number; combo: StyleKind[]; multiplier: number };
  protected abstract get survivorBonus(): number;
  protected abstract roundTitle(survivor: number | null): RoundTitle;

  on(listener: (e: GameEvent) => void): void {
    this.listeners.push(listener);
  }

  /** Dispatch authoritative events on clients that do not run the simulation. */
  applyRemoteEvent(event: GameEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  get attract(): boolean {
    return !!this.options.attract;
  }

  get isHumanTurn(): boolean {
    if (this.phase !== 'aiming' || this.current < 0) return false;
    const p = this.players[this.current];
    return !p.cpu && !p.locked;
  }

  get humanCount(): number {
    return this.players.filter((p) => !p.cpu).length;
  }

  get planetsVisible(): boolean {
    return !this.hiddenPlanets || this.phase === 'roundOver' || this.phase === 'gameOver';
  }

  get isLastRound(): boolean {
    return this.totalRounds > 0 && this.round >= this.totalRounds;
  }

  get alive(): PlayerState[] {
    return this.players.filter((p) => p.alive);
  }

  /** Players by score, best first. */
  ranking(): PlayerState[] {
    return [...this.players].sort((a, b) => b.score - a.score || a.seat - b.seat);
  }

  /** The single leader, or null on a tie at the top. */
  get leader(): number | null {
    const [a, b] = this.ranking();
    return !b || a.score > b.score ? a.id : null;
  }

  /** Team totals, best first (empty in free for all). */
  teamRanking(): { team: number; score: number; members: PlayerState[] }[] {
    const teams = [...new Set(this.players.flatMap((p) => (p.team === null ? [] : [p.team])))];
    return teams
      .map((team) => {
        const members = this.players.filter((p) => p.team === team);
        return { team, members, score: members.reduce((sum, p) => sum + p.score, 0) };
      })
      .sort((a, b) => b.score - a.score || a.team - b.team);
  }

  /** Who is ahead in the match — a team in team mode, a player otherwise; null on a tie. */
  winner(): { name: string; color: string } | null {
    if (this.teamMode) {
      const [a, b] = this.teamRanking();
      return !b || a.score > b.score ? { name: teamName(a.team), color: TEAMS[a.team][0] } : null;
    }
    const leader = this.leader;
    return leader === null ? null : { name: this.players[leader].name, color: this.players[leader].color };
  }

  /** Teammates of a player (empty in free for all). */
  friendsOf(id: number): number[] {
    const team = this.players[id].team;
    return team === null ? [] : this.players.filter((p) => p.id !== id && p.team === team).map((p) => p.id);
  }

  /** The round is decided once at most one side — a team, or a lone player — has ships left. */
  get decided(): boolean {
    return new Set(this.alive.map((p) => (p.team === null ? `p${p.id}` : `t${p.team}`))).size <= 1;
  }

  scene(): Scene {
    return { world: this.world, trails: this.trails, volley: this.volley, camera: null };
  }

  // Event Horizon hooks the renderer asks about; classic answers "nothing".
  devourProgress(_planetSeed: number): number {
    return 0;
  }
  swallowProgress(_ship: number): number {
    return 0;
  }
  get nextHoleRadius(): number | null {
    return null;
  }
  get shotClock(): number | null {
    return null;
  }

  newMatch(): void {
    const seats = this.options.seats ?? this.settings.seats;
    const taken = seats.flatMap((seat, i) => (seat === 'off' ? [] : [{ seat: i, kind: seat }]));
    const teams = this.attract ? null : seatTeamsFor(this.settings, taken.map((s) => s.seat));
    this.teamMode = teams ? this.settings.teamMode : 0;
    this.players = taken.map(({ seat, kind }, id) => newPlayer(id, seat, kind, teams?.[id] ?? null));
    if (teams) {
      // Each team member gets its own shade of the team colour.
      const seen = new Map<number, number>();
      for (const p of this.players) {
        const n = seen.get(p.team!) ?? 0;
        seen.set(p.team!, n + 1);
        p.color = TEAMS[p.team!][n % TEAMS[p.team!].length];
      }
    }
    this.round = 0;
    this.clock = 0;
    this.killFeed = [];
    this.totalRounds = this.attract ? 0 : this.settings.rounds;
    this.startRound();
  }

  startRound(): void {
    this.round++;
    this.world = generateWorld(randomSeed(), {
      maxPlanets: this.settings.maxPlanets,
      players: this.players.length,
      blackHole: this.mode === 'horizon',
      teams: this.teamMode ? this.players.map((p) => p.team!) : null,
    });
    this.hiddenPlanets = this.mode === 'classic' && this.settings.invisiblePlanets;
    this.trails = [];
    this.volley = null;
    this.summary = null;
    this.lastKill = null;
    this.cpuJobs.clear();
    const duel = this.mode === 'classic' && this.players.length === 2;
    for (const p of this.players) {
      const ship = this.world.ships[p.id];
      p.shots = 0;
      p.alive = true;
      p.locked = false;
      // Face the middle of the field; the classic duel keeps the original's straight 0° / 180°.
      p.angle = duel ? (p.id === 0 ? 0 : 180) : normalizeAngle(Math.round((Math.atan2(ship.y - FIELD.height / 2, FIELD.width / 2 - ship.x) * 180) / Math.PI));
      p.power = this.settings.fixedPower ? AIM.FIXED_POWER : AIM.DEFAULT_POWER;
    }
    this.emit({ type: 'round' });
    this.beginRound();
  }

  /** Nudge the current player's aim (human input). */
  adjust(dAngle: number, dPower: number): void {
    if (!this.isHumanTurn) return;
    const p = this.players[this.current];
    this.setAim(p.angle + dAngle, p.power + dPower);
  }

  setAim(angle: number, power: number): void {
    if (!this.isHumanTurn) return;
    const p = this.players[this.current];
    p.angle = normalizeAngle(angle);
    if (!this.settings.fixedPower) p.power = Math.min(AIM.MAX_POWER, Math.max(AIM.MIN_POWER, power));
  }

  /** Called when settings change mid-match. */
  applySettings(settings: Settings): void {
    this.settings = settings;
    if (settings.fixedPower) for (const p of this.players) p.power = AIM.FIXED_POWER;
  }

  /** Space / "continue": next round, final screen, or a new match. */
  advance(): void {
    if (this.phaseTime < 0.6) return;
    if (this.phase === 'roundOver') {
      if (this.isLastRound) {
        this.setPhase('gameOver');
        this.emit({ type: 'gameOver' });
      } else {
        this.startRound();
      }
    } else if (this.phase === 'gameOver') {
      this.newMatch();
    }
  }

  update(dt: number): void {
    this.clock += dt;
    this.phaseTime += dt;
    if (this.notice && this.clock - this.notice.at > 1.4) this.notice = null;
    if (this.phase === 'flying') this.updateFlight(dt);
    else this.updatePhase(dt);
    if (this.phase === 'roundOver' && this.attract && this.phaseTime > 3) this.advance();
  }

  // ————————————————————————————— Flight —————————————————————————————

  protected launch(aims: VolleyAim[], trackStyle: boolean): void {
    this.volley = new Volley(this.world, aims, this.rules, trackStyle);
    this.simClock = 0;
    this.cpuJobs.clear();
    this.setPhase('flying');
    this.volley.shots.forEach((vs, i) => {
      const aim = aims[i];
      this.emit({ type: 'fire', player: vs.owner, x: vs.shot.x, y: vs.shot.y, angle: aim.angle, power: aim.power });
    });
  }

  private updateFlight(dt: number): void {
    const volley = this.volley!;
    // Long flights speed up so nobody waits for an orbit to decay.
    const t = this.phaseTime;
    const speed = t < 3 ? 1 : Math.min(4, 1 + (t - 3) * 0.75);
    this.simClock += dt * speed;
    while (this.simClock >= PHYSICS.DT && !volley.done) {
      this.simClock -= PHYSICS.DT;
      for (const e of volley.step()) this.onVolleyEvent(volley, e, true);
    }
    if (volley.done) {
      this.trails.push(...volley.shots.map((vs) => ({ owner: vs.owner, points: vs.trail, volley: this.volleyNumber })));
      this.volley = null;
      this.afterVolley();
    }
  }

  protected get volleyNumber(): number {
    return 0;
  }

  /** Turn a simulation event into game events. `live` = the real volley, not a killcam replay. */
  protected onVolleyEvent(volley: Volley, e: VolleyEvent, live: boolean): void {
    const vs = volley.shots[e.index];
    const player = vs.owner;
    if (e.type === 'style') {
      this.emit({ type: 'style', player, kind: e.event.kind, x: e.event.x, y: e.event.y });
      return;
    }
    const end = e.end;
    switch (end.kind) {
      case 'ship': {
        const ship = volley.world.ships[end.ship];
        this.emit({ type: 'explode', x: ship.x, y: ship.y, ship: end.ship, vx: e.vx, vy: e.vy });
        if (live) this.registerKill(vs, end.ship, volley);
        break;
      }
      case 'planet': {
        const planet = volley.world.planets[end.planet];
        const dx = e.x - planet.x;
        const dy = e.y - planet.y;
        const distance = Math.hypot(dx, dy) || 1;
        const x = planet.x + (dx / distance) * (planet.radius + 2);
        const y = planet.y + (dy / distance) * (planet.radius + 2);
        this.emit({ type: 'impact', player, x, y, vx: e.vx, vy: e.vy });
        break;
      }
      case 'hole': {
        const hole = volley.world.hole!;
        this.emit({ type: 'devour', x: e.x, y: e.y, toX: hole.x, toY: hole.y, color: COLORS.players[this.players[player].seat], vx: e.vx, vy: e.vy });
        break;
      }
      case 'clash':
        if (e.index < end.other) {
          const other = volley.shots[end.other].shot;
          this.emit({
            type: 'clash',
            x: e.x,
            y: e.y,
            players: [player, volley.shots[end.other].owner],
            velocities: [{ x: e.vx, y: e.vy }, { x: other.vx, y: other.vy }],
          });
        }
        break;
      default:
        this.emit({ type: 'fizzle', player, x: e.x, y: e.y, vx: e.vx, vy: e.vy, lost: end.kind === 'lost' });
    }
  }

  private registerKill(vs: VolleyShot, victim: number, volley: Volley): void {
    const killer = vs.owner;
    const self = killer === victim;
    const friendly = !self && this.players[killer].team !== null && this.players[killer].team === this.players[victim].team;
    const score = self || friendly ? { points: -SCORING.SELF_HIT, combo: [], multiplier: 1 } : this.killPoints(vs);
    this.players[victim].alive = false;
    this.players[killer].score += score.points;
    const record: KillRecord = {
      killer,
      victim,
      self,
      friendly,
      points: score.points,
      combo: score.combo,
      multiplier: score.multiplier,
      shots: this.players[killer].shots,
      power: vs.shot.power,
      at: this.clock,
    };
    this.recordKill(record);
    this.onKill(record, volley.shots.indexOf(vs), volley.steps);
  }

  protected recordKill(record: KillRecord): void {
    this.killFeed.push(record);
    if (this.killFeed.length > 8) this.killFeed.shift();
    this.lastKill = record;
    this.emit({ type: 'kill', record });
  }

  /** Hook for Event Horizon to remember kills for the killcam. */
  protected onKill(_record: KillRecord, _shotIndex: number, _step: number): void {}

  protected endRound(): void {
    const alive = this.alive;
    const survivor = alive.length === 1 ? alive[0].id : null;
    // In team mode the whole winning team shares the bonus — fallen members included.
    const team = this.teamMode && alive.length > 0 && this.decided ? alive[0].team : null;
    const bonus = team !== null || survivor !== null ? this.survivorBonus : 0;
    if (team !== null) {
      for (const p of this.players) if (p.team === team) p.score += bonus;
    } else if (survivor !== null) {
      this.players[survivor].score += bonus;
    }
    const title = team !== null ? 'teamWin' : this.roundTitle(survivor);
    this.summary = { title, survivor, team, bonus, lastKill: this.lastKill };
    this.current = -1;
    this.setPhase('roundOver');
    this.emit({ type: 'roundEnd' });
  }

  // ————————————————————————————— CPU —————————————————————————————

  /** Think for the given CPU players, sharing a per-frame time budget round-robin. */
  protected runCpu(ids: number[], budgetMs: number, effort: number, lookahead?: number): void {
    for (const id of ids) {
      if (this.cpuJobs.has(id)) continue;
      const p = this.players[id];
      this.cpuJobs.set(id, {
        planner: planShot(this.world, id, {
          rules: this.rules,
          level: p.cpu ?? 'medium',
          attempt: p.shots,
          fixedPower: this.settings.fixedPower ? AIM.FIXED_POWER : null,
          rng: this.rng,
          effort,
          lookahead,
          friends: this.friendsOf(id),
        }),
        target: null,
        settle: 0,
      });
    }
    const deadline = performance.now() + budgetMs;
    let busy = true;
    while (busy && performance.now() < deadline) {
      busy = false;
      for (const id of ids) {
        const job = this.cpuJobs.get(id)!;
        if (!job.planner) continue;
        busy = true;
        const r = job.planner.next();
        if (r.done) {
          job.target = r.value;
          job.planner = null;
        }
      }
    }
  }

  protected cpuJob(id: number): CpuJob | undefined {
    return this.cpuJobs.get(id);
  }

  /** Swing a CPU's ship towards its chosen aim like a player would. True once it's there. */
  protected swingTowards(p: PlayerState, target: Aim, dt: number, speed = 1): boolean {
    const dA = ((target.angle - p.angle + 540) % 360) - 180;
    const dP = target.power - p.power;
    const stepA = 140 * speed * dt;
    const stepP = 70 * speed * dt;
    const doneA = Math.abs(dA) <= stepA;
    const doneP = Math.abs(dP) <= stepP;
    p.angle = normalizeAngle(doneA ? target.angle : p.angle + Math.sign(dA) * stepA);
    p.power = doneP ? target.power : p.power + Math.sign(dP) * stepP;
    return doneA && doneP;
  }

  protected setPhase(phase: Phase): void {
    this.phase = phase;
    this.phaseTime = 0;
  }

  protected emit(e: GameEvent): void {
    for (const l of this.listeners) l(e);
  }
}

export function newPlayer(id: number, seat: number, kind: Exclude<Seat, 'off'>, team: number | null, target = false): PlayerState {
  const cpu = kind === 'human' ? null : kind;
  return {
    id,
    seat,
    // A getter, so the name follows the UI language when it is switched mid-match.
    get name() {
      if (target) return t('daily.target', { n: id });
      return cpu ? `CPU ${seat + 1}` : t('players.player', { n: seat + 1 });
    },
    cpu,
    color: target ? COLORS.danger : COLORS.players[seat],
    team,
    target,
    score: 0,
    angle: 0,
    power: AIM.DEFAULT_POWER,
    shots: 0,
    alive: true,
    locked: false,
  };
}
