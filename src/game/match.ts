import { planShot, type Aim, type CpuDecision, type CpuLevel } from '../ai';
import type { Avatar } from '../avatars';
import { AIM, COLORS, FIELD, GRACE, ORACLE, PHYSICS, SCORING, TEAMS, TRAIL_FADE } from '../config';
import { t } from '../i18n';
import { normalizeAngle, type ShotGate, type ShotRules, type StyleKind, type World } from '../physics';
import { createRng, randomSeed, type Rng } from '../rng';
import { bump, closestApproach, improve, newStatBook, pathLength, type StatBook } from '../stats';
import { seatTeamsFor, startPower, type Seat, type Settings } from '../settings';
import { Volley, type VolleyAim, type VolleyEvent, type VolleyShot } from '../volley';
import { CPU_IGNORES, POWER_UP, type Pickup, type PowerUpKind } from '../powerups';
import { generateWorld } from '../world';
import { Oracle, stakeOptions, type OracleKind } from './oracle';
import { PowerUpField, type PlacementAim } from './powerup-field';

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
  /** The symbol the player picked for an online game; null offline. */
  avatar: Avatar | null;
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
  /** The ship spent its shot on a teleport: it fires nothing this turn or volley. */
  passed: boolean;
  /** Power-up held (one at a time), null for none. */
  powerUp: PowerUpKind | null;
  /** The held preview or splitter is set to go off with the next shot. */
  armed: boolean;
}

export interface Trail {
  owner: number;
  /** The splitter fan the shot belonged to: its shots share one look. */
  fan?: number;
  /** Flat [x0, y0, x1, y1, …] polyline in field units. */
  points: number[];
  /** Volley the shot belonged to (Event Horizon), so old ones can be dropped. */
  volley: number;
  /** Match clock when the shot ended, for fading trails. */
  at: number;
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

interface RoundSummary {
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
  /** Power-ups on the field, and the armed preview's path while aiming. */
  pickups?: readonly Pickup[];
  /** The pass the round is in, so the renderer can tell which pickups are about to fade. */
  pass?: number;
  preview?: number[] | null;
  /** Where the aiming ship's teleport or black hole would go. */
  placement?: PlacementAim | null;
}

export type GameEvent =
  | { type: 'round' }
  | { type: 'turn'; player: number }
  | { type: 'lock'; player: number }
  | { type: 'volley' }
  | { type: 'fire'; player: number; x: number; y: number; angle: number; power: number }
  | { type: 'impact'; player: number; x: number; y: number; vx: number; vy: number }
  | { type: 'fizzle'; player: number; x: number; y: number; vx: number; vy: number; lost: boolean }
  | { type: 'clash'; x: number; y: number; players: [number, number]; velocities: [{ x: number; y: number }, { x: number; y: number }]; points: number }
  | { type: 'devour'; x: number; y: number; toX: number; toY: number; color: string; vx: number; vy: number }
  | { type: 'style'; player: number; kind: StyleKind; x: number; y: number }
  | { type: 'explode'; x: number; y: number; ship: number; vx: number; vy: number }
  | { type: 'pickup'; player: number; kind: PowerUpKind; x: number; y: number; dropped: PowerUpKind | null }
  | { type: 'pickupSpawn'; kind: PowerUpKind; x: number; y: number }
  | { type: 'pickupFade'; kind: PowerUpKind; x: number; y: number }
  | { type: 'teleport'; player: number; fromX: number; fromY: number; toX: number; toY: number }
  | { type: 'blackhole'; player: number; x: number; y: number }
  | { type: 'planetKiller'; player: number; x: number; y: number; radius: number }
  | { type: 'nebula'; player: number; x: number; y: number }
  | { type: 'wormhole'; player: number; x: number; y: number; toX: number; toY: number }
  | { type: 'defense'; player: number; x: number; y: number }
  /** A planet's gravity was turned round (`reversed`) or back. */
  | { type: 'polarity'; player: number; x: number; y: number; radius: number; reversed: boolean }
  /** A planetary defense fired a missile at a shot: from its turret to where the shot is. */
  | { type: 'defenseFire'; player: number; x: number; y: number; toX: number; toY: number }
  /** A defense's missile lost its shot at (x, y). */
  | { type: 'defenseMiss'; player: number; x: number; y: number }
  /** A planetary defense shot a flying shot down. */
  | { type: 'shotdown'; player: number; x: number; y: number; vx: number; vy: number }
  | { type: 'split'; player: number; x: number; y: number }
  | { type: 'shield'; ship: number; x: number; y: number }
  | { type: 'kill'; record: KillRecord }
  /** One shot took more than one ship in this volley: the chain number and what it paid. */
  | { type: 'multiKill'; player: number; kills: number; points: number; x: number; y: number }
  | { type: 'collapse'; x: number; y: number }
  | { type: 'killcam'; active: boolean; recording: boolean }
  | { type: 'roundEnd' }
  | { type: 'gameOver' };

/** Selected launch and simulated outcome for one normal CPU decision. */
export interface CpuDecisionReport extends CpuDecision {
  mode: Mode;
  round: number;
  player: number;
  shot: number;
}


export interface MatchOptions {
  /** Attract mode (title screen): rounds continue on their own, forever. */
  attract?: boolean;
  /** Override the seats from the settings (used by attract mode). */
  seats?: Seat[];
  /** Fixed player names by player index (online matches) — they survive a rematch. */
  names?: string[];
  /** The symbol each player picked, by player index (online matches). */
  avatars?: Avatar[];
  /** Fixed team per player index (online matches); `settings.teamMode` is the team count. */
  teams?: number[];
  /** Event Horizon online: every human aims at once instead of one after another at a shared keyboard. */
  simultaneous?: boolean;
  /** Online: eliminated players may tip on what the others' shots do. */
  oracle?: boolean;
  /** Reproducible multi-round worlds, independent of planner random consumption. */
  seed?: number;
  /** Finish CPU generators without a wall-clock budget, for deterministic simulation. */
  deterministicCpu?: boolean;
  /** Receives normal CPU planner decisions; console logging can also enable this path. */
  onCpuDecision?: (report: CpuDecisionReport) => void;
}

export interface CpuJob {
  planner: Generator<void, Aim> | null;
  target: Aim | null;
  settle: number;
  /** Power-ups: the planner found no hitting shot. Only known while the CPU holds a teleport. */
  blind?: boolean;
  teleportTried?: boolean;
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
  /** What happened this round, and in the whole match — for the scorecard. */
  roundStats: StatBook = newStatBook();
  matchStats: StatBook = newStatBook();
  /** Everybody's score at the start of the match and after every round — for the chart on the final screen. */
  scoreHistory: number[][] = [];
  /** The tipping game for eliminated players (online only). */
  readonly oracle = new Oracle();
  /** Match clock when the current round began, so kills can be timed from the start of the round. */
  protected roundStartedAt = 0;
  /** Seed used to generate the current round's battlefield. */
  worldSeed = 0;
  /** Online: the player sitting at this screen. null = hot-seat, where whoever is on turn is at the keyboard. */
  viewer: number | null = null;
  /** Whether this screen may move the match on (next round, skip the killcam, rematch). Online only the host may. */
  canAdvance = true;

  protected rng: Rng;
  private readonly matchSeed: number;
  private worldRng: Rng;
  private plannerRngs = new Map<number, Rng>();
  /** Who hit each player last — CPUs with a grudge aim back at them. */
  private lastHitBy = new Map<number, number>();
  /** Phase time when the current volley finished, replicated so online guests keep the same post-flight delay. */
  protected flightDoneAt: number | null = null;
  /** What the volley in the air has destroyed so far — the oracle's verdict is read from it. */
  private oracleKills: { killer: number; victim: number; self: boolean; friendly: boolean }[] = [];
  /** The enemies each player has taken in the round being played, for the multi-kill chain. */
  private killChain = new Map<number, number>();
  private disposed = false;
  protected cpuJobs = new Map<number, CpuJob>();
  private listeners: ((e: GameEvent) => void)[] = [];
  protected simClock = 0;
  /** Power-ups: the pickups on the field, who holds what, and what each one does. */
  readonly power = new PowerUpField({
    enabled: () => this.powerUps,
    world: () => this.world,
    players: () => this.players,
    rng: () => this.rng,
    rules: () => this.rules,
    volley: () => this.volley,
    phase: () => this.phase,
    viewer: () => this.viewer,
    current: () => this.current,
    localCanAim: () => this.localCanAim,
    canAim: (id) => this.canAim(id),
    friendsOf: (id) => this.friendsOf(id),
    sparedFor: (id) => this.sparedFor(id),
    volleysPerPass: () => this.volleysPerPass,
    kinds: () => this.settings.powerUpKinds,
    amount: () => this.settings.powerUpAmount,
    emit: (event) => this.emit(event),
    clearCpuJobs: () => this.cpuJobs.clear(),
    record: (update) => this.record(update),
  });

  constructor(
    public settings: Settings,
    protected readonly options: MatchOptions = {},
  ) {
    this.matchSeed = options.seed ?? randomSeed();
    this.rng = createRng(this.matchSeed ^ 0x4f1bbcdc);
    this.worldRng = createRng(this.matchSeed);
  }

  abstract get rules(): ShotRules;
  /** Enter / "ready": classic fires, Event Horizon locks the aim in. */
  abstract commit(): void;
  protected abstract beginRound(): void;
  protected abstract updatePhase(dt: number): void;
  protected abstract afterVolley(): void;
  protected abstract killPoints(vs: VolleyShot): { points: number; combo: StyleKind[]; multiplier: number };
  protected abstract get survivorBonus(): number;
  /** Whether trick shots multiply a hit's points in this match. */
  protected get stylePays(): boolean {
    return true;
  }
  /**
   * Whether back-to-back kills pay the multi-kill chain. The daily challenge keeps a score of its own and
   * runs a target per round rather than a round per volley, so the chain has no meaning there.
   */
  protected get paysKillChain(): boolean {
    return this.mode !== 'challenge';
  }
  protected abstract roundTitle(survivor: number | null): RoundTitle;

  on(listener: (e: GameEvent) => void): void {
    this.listeners.push(listener);
  }

  /** Stop this match for good when it leaves the application. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.resetFlight();
    this.listeners.length = 0;
  }

  private resetFlight(): void {
    this.flightDoneAt = null;
    this.cpuJobs.clear();
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

  /** Whether all shots of a round of aiming fly at once (Event Horizon, or Classic with simultaneous shots), not one per turn. */
  get salvo(): boolean {
    return false;
  }

  /** Whether every human aims at once (online salvos) rather than in turns. */
  get simultaneous(): boolean {
    return !!this.options.simultaneous;
  }

  /** Whether a human may change this player's aim right now. */
  canAim(id: number): boolean {
    const p = this.players[id];
    return this.phase === 'aiming' && this.current === id && !!p && !p.cpu && !p.locked;
  }

  /** Whether the person at this screen has been shot down and may tip in the oracle. */
  get ghost(): boolean {
    const me = this.viewer === null ? undefined : this.players[this.viewer];
    return !!this.options.oracle && !!me && !me.alive && !me.cpu;
  }

  /** Whether this player may tip right now: shot down, and a question is open. */
  canBet(id: number): boolean {
    const p = this.players[id];
    return !!this.options.oracle && !!p && !p.alive && !p.cpu && !!this.oracle.question && !this.oracle.question.locked;
  }

  /** Whether the oracle's minimum window for tipping and betting on this aiming phase has passed. */
  protected get betWindowDone(): boolean {
    return (!this.oracle.question && !this.oracle.roundQuestion) || this.phaseTime >= ORACLE.MIN_BET_TIME;
  }
  /**
   * Puts a stake on the player's tip on the round question, once. The points leave their score at once —
   * they come back with a share of the pot if the tip was right, or when there is nobody to share with.
   */
  private placeStake(id: number, stake: number): boolean {
    const p = this.players[id];
    if (!p || stake > this.maxStake(id) || !this.oracle.setStake(id, stake)) return false;
    p.score -= stake;
    return true;
  }

  /** The ships a tip on who wins the round may name right now: the ones still in. */
  get roundChoices(): number[] {
    return (this.oracle.roundQuestion?.choices ?? []).filter((id) => this.players[id]?.alive);
  }

  /** Whether this player may tip on who wins the round right now: shot down, the question is open, and the next shots have not flown yet. */
  canBetRound(id: number): boolean {
    const p = this.players[id];
    return !!this.options.oracle && !!p && !p.alive && !p.cpu && !!this.oracle.roundQuestion && this.phase === 'aiming';
  }

  /** The most this player could still stake on the round question: a share of their score, once. 0 when there is no bet to make — or the room plays without betting. */
  maxStake(id: number): number {
    const p = this.players[id];
    if (!p || !this.settings.betting || !this.canBetRound(id) || !this.oracle.canStake(id)) return 0;
    return stakeOptions(p.score).at(-1) ?? 0;
  }

  /**
   * An eliminated player's tip — on the open shot or salvo, or (`round`) on who wins the round, with an
   * optional `stake` of the player's own points on it. The host keeps it until the verdict; a screen also
   * remembers its own to show it.
   */
  placeBet(id: number, pick: number, round = false, stake = 0): boolean {
    if (round) {
      if (!this.canBetRound(id) || !this.oracle.betRound(id, pick, this.alive.map((p) => p.id), this.sidesIn)) return false;
      if (id === this.viewer) this.oracle.roundMine = { id: this.oracle.roundQuestion!.id, pick };
      if (stake > 0) this.placeStake(id, stake);
      return true;
    }
    if (!this.canBet(id) || !this.oracle.bet(id, pick)) return false;
    if (id === this.viewer) this.oracle.mine = { id: this.oracle.question!.id, pick };
    return true;
  }

  /**
   * Once somebody is out and two or more ships are still in a contested round, the oracle asks who wins it.
   * Called whenever the aiming begins; a round has one such question.
   */
  private openRoundQuestion(): void {
    if (!this.options.oracle || this.attract || this.oracle.roundQuestion || this.decided) return;
    if (!this.players.some((p) => !p.alive && !p.cpu)) return;
    this.oracle.openRound(this.alive.map((p) => p.id), this.simultaneous);
  }

  /** Subclasses call this when a shot (`shot`, by `shooter`) or a salvo is about to be aimed. */
  protected openOracle(kind: OracleKind, shooter = -1): void {
    const ghosts = this.players.some((p) => !p.alive && !p.cpu);
    if (!this.options.oracle || this.attract || !ghosts) return this.oracle.close();
    this.oracle.open(kind, shooter, kind === 'salvo' ? this.alive.map((p) => p.id) : []);
  }

  private judgeOracle(): void {
    const q = this.oracle.question;
    if (q) {
      const victims = [...new Set(this.oracleKills.map((k) => k.victim))];
      const hit = this.oracleKills.some((k) => k.killer === q.shooter && !k.self && !k.friendly);
      this.oracle.resolve(victims, hit, this.clock);
    }
    this.oracleKills = [];
  }

  /** Whether the person at this screen may aim right now. */
  get localCanAim(): boolean {
    return this.viewer === null ? this.isHumanTurn : this.canAim(this.viewer);
  }

  /** Whose aim the screen shows: whoever is on turn — or, while everyone aims at once, the local player. */
  get focus(): number {
    return this.simultaneous && this.viewer !== null && this.canAim(this.viewer) ? this.viewer : this.current;
  }

  /**
   * Whether this player's aim (arrow, angle, ship heading) may be drawn. With hidden aim only the
   * person at the screen sees it: their own seat online, whoever is on turn at a shared keyboard.
   */
  aimVisible(id: number): boolean {
    if (!this.settings.hiddenAim || this.attract) return true;
    if (this.viewer !== null) return id === this.viewer;
    return id === this.focus && !this.players[id]?.cpu;
  }

  /** How visible a finished shot's trail still is (1 → 0). Always 1 unless trails fade. */
  trailAlpha(trail: Trail): number {
    const life = this.settings.fadingTrails;
    if (!life) return 1;
    const hold = life * TRAIL_FADE.HOLD;
    return Math.max(0, Math.min(1, (life - (this.clock - trail.at)) / (life - hold)));
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

  /**
   * Neighbour grace period: the ships this player's next shot flies through. While a round is young
   * (each ship's first `neighborGrace` shots) that is the nearest enemy, so nobody can just snipe their neighbour.
   */
  sparedFor(id: number): number[] {
    const me = this.players[id];
    if (!this.settings.neighborGrace || !me || this.players.length < GRACE.MIN_SHIPS || me.shots >= this.settings.neighborGrace) return [];
    const from = this.world.ships[id];
    const friends = this.friendsOf(id);
    let nearest = -1;
    let best = Infinity;
    for (const p of this.players) {
      const ship = this.world.ships[p.id];
      if (p.id === id || !p.alive || friends.includes(p.id)) continue;
      const d = Math.hypot(ship.x - from.x, ship.y - from.y);
      if (d < best) {
        best = d;
        nearest = p.id;
      }
    }
    return nearest < 0 ? [] : [nearest];
  }

  /** Teammates of a player (empty in free for all). */
  friendsOf(id: number): number[] {
    const team = this.players[id].team;
    return team === null ? [] : this.players.filter((p) => p.id !== id && p.team === team).map((p) => p.id);
  }

  /** The round is decided once at most one side — a team, or a lone player — has ships left. */
  get decided(): boolean {
    return this.sidesIn <= 1;
  }

  /** How many sides still have ships in the round: lone players in a free for all, whole teams in a team match. */
  get sidesIn(): number {
    return new Set(this.alive.map((p) => (p.team === null ? `p${p.id}` : `t${p.team}`))).size;
  }

  scene(): Scene {
    return { world: this.world, trails: this.trails, volley: this.volley, camera: null, ...this.power.scene() };
  }

  // ————————————————————————————— Power-ups —————————————————————————————

  /** Power-ups are an offline experiment: Classic and Event Horizon, never on the attract screen, never online. */
  get powerUps(): boolean {
    return this.settings.powerUps && (this.mode === 'classic' || this.mode === 'horizon') && !this.attract;
  }

  /** Volleys that make up one pass: the shot of every ship still in, or one salvo at a time. */
  protected get volleysPerPass(): number {
    return this.salvo ? 1 : Math.max(1, this.alive.length);
  }

  /**
   * A CPU holding a teleport that planned and found no hitting shot jumps to a new spot, once, and plans again
   * from there. Returns true when it did, so the caller leaves this tick to the new position.
   */
  protected cpuTeleportIfBlind(p: PlayerState, job: CpuJob | undefined): boolean {
    if (p.powerUp !== 'teleport' || !job?.target || !job.blind || job.teleportTried) return false;
    job.teleportTried = true;
    return this.power.teleport(p.id);
  }

  get pickups(): Pickup[] {
    return this.power.pickups;
  }

  set pickups(pickups: Pickup[]) {
    this.power.pickups = pickups;
  }

  /** The power-up key: opens a teleport's aim, or arms a preview. */
  usePowerUp(id: number = this.viewer ?? this.current): void {
    this.power.use(id);
  }

  /** Whether the ship on turn is aiming a teleport or a black hole. */
  get placing(): boolean {
    return this.power.placing;
  }

  /** Whether a given ship is aiming a placement. */
  placingFor(id: number): boolean {
    return this.power.placingFor(id);
  }

  /** Fire, while aiming: the jump happens, or the black hole is planted. False when there is no aim, or it lands nowhere the ship may rest. */
  confirmPlacement(by?: number): boolean {
    return this.power.confirmPlacement(by);
  }

  cancelPlacement(by?: number): boolean {
    return this.power.cancelPlacement(by);
  }

  /** The power-up state a snapshot carries besides the pickups, and its restoring. */
  protected get powerState() {
    return this.power.state();
  }

  /** Fire while the shot is flying: an armed splitter forks it into three. */
  protected splitInFlight(id = -1): boolean {
    return this.power.splitInFlight(id);
  }

  protected aimsFor(p: PlayerState): VolleyAim[] {
    return this.power.aimsFor(p);
  }

  // Event Horizon hooks the renderer asks about; classic answers "nothing".
  devourProgress(_planetSeed: number): number {
    return 0;
  }
  swallowProgress(_ship: number): number {
    return 0;
  }
  /** How far the wormhole with this id has fallen into the hole (0 to 1). */
  devourWormhole(_id: number): number {
    return 0;
  }
  get nextHoleRadius(): number | null {
    return null;
  }
  get shotClock(): number | null {
    return null;
  }

  newMatch(): void {
    this.worldRng = createRng(this.options.seed ?? randomSeed());
    this.rng = createRng(this.matchSeed ^ 0x4f1bbcdc);
    this.plannerRngs.clear();
    this.lastHitBy.clear();
    const seats = this.options.seats ?? this.settings.seats;
    const taken = seats.flatMap((seat, i) => (seat === 'off' ? [] : [{ seat: i, kind: seat }]));
    const teams = this.attract ? null : (this.options.teams ?? seatTeamsFor(this.settings, taken.map((s) => s.seat)));
    this.teamMode = teams ? this.settings.teamMode : 0;
    this.players = taken.map(({ seat, kind }, id) => newPlayer(id, seat, kind, teams?.[id] ?? null, false, this.options.names?.[id], this.options.avatars?.[id] ?? null));
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
    this.matchStats = newStatBook();
    this.scoreHistory = [this.players.map(() => 0)];
    this.oracle.reset(this.players.length);
    this.totalRounds = this.attract ? 0 : this.settings.rounds;
    this.startRound();
  }

  startRound(): void {
    this.resetFlight();
    // The chain counts a round's kills: several in one turn (a splitter's forks, an armor-piercing round) or
    // one per turn adding up. A new round starts everyone over, so no round opens with a chain carried in.
    this.killChain.clear();
    this.round++;
    // Stakes that were never paid out (a round cut short) go back to their owners.
    for (const [id, stake] of this.oracle.stakes) if (this.players[id]) this.players[id].score += stake;
    this.oracle.startRound();
    this.oracleKills = [];
    this.roundStats = newStatBook();
    this.roundStartedAt = this.clock;
    this.worldSeed = Math.floor(this.worldRng() * 2 ** 32);
    this.world = generateWorld(this.worldSeed, {
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
    // A grudge lasts one round — whoever survived it starts the next one clean.
    this.lastHitBy.clear();
    this.cpuJobs.clear();
    const duel = this.mode === 'classic' && this.players.length === 2;
    for (const p of this.players) {
      const ship = this.world.ships[p.id];
      p.shots = 0;
      p.alive = true;
      p.locked = false;
      p.passed = false;
      p.powerUp = null;
      p.armed = false;
      // Face the middle of the field; the classic duel keeps the original's straight 0° / 180°.
      p.angle = duel ? (p.id === 0 ? 0 : 180) : normalizeAngle(Math.round((Math.atan2(ship.y - FIELD.height / 2, FIELD.width / 2 - ship.x) * 180) / Math.PI));
      p.power = startPower(this.settings);
    }
    this.power.startRound();
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
    if (!this.settings.fixedPower) p.power = Math.min(this.settings.maxPower, Math.max(AIM.MIN_POWER, power));
  }

  /** Called when settings change mid-match: only display options follow along, the rules stay as the game started. */
  applySettings(settings: Settings): void {
    this.settings.contours = settings.contours;
  }

  /** Online: one player's vote to skip the killcam. Only Event Horizon has one. */
  voteSkip(_player: number): void {}

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
    if (this.disposed) return;
    this.clock += dt;
    this.phaseTime += dt;
    if (this.notice && this.clock - this.notice.at > 1.4) this.notice = null;
    if (this.phase === 'flying') this.updateFlight(dt);
    else this.updatePhase(dt);
    if (this.phase === 'roundOver' && this.attract && this.phaseTime > 3) this.advance();
  }

  // ————————————————————————————— Flight —————————————————————————————

  protected launch(aims: VolleyAim[], trackStyle: boolean): void {
    this.oracle.lock();
    this.oracleKills = [];
    this.volley = new Volley(this.world, aims, this.rules, trackStyle);
    this.simClock = 0;
    this.flightDoneAt = null;
    this.cpuJobs.clear();
    this.setPhase('flying');
    this.volley.shots.forEach((vs, i) => {
      const aim = aims[i];
      this.emit({ type: 'fire', player: vs.owner, x: vs.shot.x, y: vs.shot.y, angle: aim.angle, power: aim.power });
    });
  }

  /** Long flights speed up so nobody waits for an orbit to decay. */
  private get flightSpeed(): number {
    const t = this.phaseTime;
    return t < 3 ? 1 : Math.min(4, 1 + (t - 3) * 0.75);
  }

  private updateFlight(dt: number): void {
    if (!this.volley) return;
    const volley = this.volley;
    this.simClock += dt * this.flightSpeed;
    while (this.simClock >= PHYSICS.DT && !volley.done) {
      this.simClock -= PHYSICS.DT;
      for (const e of volley.step()) this.onVolleyEvent(volley, e, true);
      this.power.onStep(volley);
    }
    if (!volley.done) return;
    this.flightDoneAt ??= this.phaseTime;
    if (this.phaseTime - this.flightDoneAt < this.afterVolleyDelay) return;
    this.recordFlights(volley);
    this.trails.push(...volley.shots.map((vs) => ({ owner: vs.owner, fan: vs.fan, points: vs.trail, volley: this.volleyNumber, at: this.clock })));
    this.volley = null;
    this.power.onVolleyEnd();
    this.judgeOracle();
    this.afterVolley();
  }

  /**
   * Guests carry a flight on between the host's snapshots, so it moves smoothly instead of in 30 Hz
   * steps. The physics is deterministic, so this is exactly what the host is about to send; it is
   * purely visual — hits, events and scores only ever come from the host.
   */
  extrapolate(dt: number): void {
    const volley = this.volley;
    if (this.phase !== 'flying' || !volley) return;
    this.phaseTime += dt;
    this.simClock += dt * this.flightSpeed;
    while (this.simClock >= PHYSICS.DT && !volley.done) {
      this.simClock -= PHYSICS.DT;
      volley.step();
    }
  }

  /** A fresh snapshot replaced the state: the extrapolation starts over from it. */
  protected restarted(): void {
    this.resetFlight();
    this.simClock = 0;
  }

  /** Seconds to keep a finished volley on screen before moving on (e.g. before a killcam). */
  protected get afterVolleyDelay(): number {
    return 0;
  }

  protected get volleyNumber(): number {
    return 0;
  }

  /** Turn a simulation event into game events. `live` = the real volley, not a killcam replay. */
  protected onVolleyEvent(volley: Volley, e: VolleyEvent, live: boolean): void {
    const vs = volley.shots[e.index];
    const player = vs.owner;
    if (e.type === 'style') {
      if (live && (e.event.kind === 'swingby' || e.event.kind === 'graze')) this.record((book) => bump(e.event.kind === 'swingby' ? book.swingbys : book.grazes, player));
      // The call-out promises a multiplier, so it only shows where trick shots pay.
      if (this.stylePays) this.emit({ type: 'style', player, kind: e.event.kind, x: e.event.x, y: e.event.y });
      return;
    }
    if (e.type === 'intercept') {
      const d = volley.world.defenses[e.defense];
      if (d) this.emit({ type: 'defenseFire', player: d.owner, x: d.x, y: d.y, toX: e.x, toY: e.y });
      return;
    }
    if (e.type === 'interceptMiss') {
      const d = volley.world.defenses[e.defense];
      if (d) this.emit({ type: 'defenseMiss', player: d.owner, x: e.x, y: e.y });
      return;
    }
    if (e.type === 'reflect') {
      // The shield bounced the shot off: it is spent, and so is the power-up it came from.
      this.emit({ type: 'shield', ship: e.ship, x: e.x, y: e.y });
      if (live) {
        const holder = this.players[e.ship];
        holder.powerUp = null;
        holder.armed = false;
        this.record((book) => bump(book.saves, e.ship));
      }
      return;
    }
    if (e.type === 'pierce') {
      // Armor piercing went through the hull: the ship is out, and the shot flies on.
      this.emit({ type: 'explode', x: e.x, y: e.y, ship: e.ship, vx: e.vx, vy: e.vy });
      if (live) this.registerKill(vs, e.ship, volley);
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
        const hole = volley.world.holes[end.hole];
        this.emit({ type: 'devour', x: e.x, y: e.y, toX: hole.x, toY: hole.y, color: COLORS.players[this.players[player].seat], vx: e.vx, vy: e.vy });
        break;
      }
      case 'shotdown':
        this.emit({ type: 'shotdown', player, x: e.x, y: e.y, vx: e.vx, vy: e.vy });
        break;
      case 'clash': {
        if (e.index >= end.other) break;
        const otherOwner = volley.shots[end.other].owner;
        const other = volley.shots[end.other].shot;
        const team = this.players[player].team;
        const friendly = team !== null && team === this.players[otherOwner].team;
        // A high-five pays both shooters whose shots cancelled each other — and only where trick shots pay.
        const points = this.stylePays ? (friendly ? SCORING.HIGH_FIVE_TEAMMATE : SCORING.HIGH_FIVE_ENEMY) : 0;
        if (live && points > 0) {
          this.players[player].score += points;
          this.players[otherOwner].score += points;
        }
        this.emit({
          type: 'clash',
          x: e.x,
          y: e.y,
          players: [player, otherOwner],
          velocities: [{ x: e.vx, y: e.vy }, { x: other.vx, y: other.vy }],
          points,
        });
        break;
      }
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
    this.oracleKills.push({ killer, victim, self, friendly });
    this.players[killer].score += score.points;
    // A CPU hit by an enemy remembers it — level profiles with a grudge aim back.
    if (!self && !friendly) this.lastHitBy.set(victim, killer);
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
    if (self) this.record((book) => bump(book.ownGoals, killer));
    if (!self && !friendly) {
      const seconds = this.clock - this.roundStartedAt;
      const from = volley.world.ships[killer];
      const target = volley.world.ships[victim];
      const shot = { trail: vs.trail, at: { x: target.x, y: target.y } };
      this.record((book) => {
        bump(book.kills, killer);
        book.fastestKill = improve(book.fastestKill, killer, seconds, false, shot);
        book.bestHit = improve(book.bestHit, killer, score.points, true, shot);
        book.sniper = improve(book.sniper, killer, Math.hypot(target.x - from.x, target.y - from.y), true, shot);
      });
    }
    this.recordKill(record);
    // The kill chain: a second enemy in the round pays extra, whether it came in this turn or an earlier one.
    if (!self && !friendly && this.paysKillChain) {
      const kills = (this.killChain.get(killer) ?? 0) + 1;
      this.killChain.set(killer, kills);
      const bonus = SCORING.MULTI_KILL[Math.min(kills, SCORING.MULTI_KILL.length - 1)];
      if (bonus > 0) {
        this.players[killer].score += bonus;
        this.emit({ type: 'multiKill', player: killer, kills, points: bonus, x: volley.world.ships[victim].x, y: volley.world.ships[victim].y });
      }
    }
    this.onKill(record, volley.shots.indexOf(vs), volley.steps);
  }

  /** What the finished shots tell the scorecard: how far they flew and whom they narrowly missed. */
  private recordFlights(volley: Volley): void {
    for (const vs of volley.shots) {
      const trail = vs.trail;
      const end = { x: trail[trail.length - 2], y: trail[trail.length - 1] };
      this.record((book) => (book.longestShot = improve(book.longestShot, vs.owner, pathLength(trail), true, { trail, at: end })));
      // Enemy ships still flying after the volley — the ones this shot missed.
      const friends = this.friendsOf(vs.owner);
      volley.world.ships.forEach((ship, id) => {
        if (id === vs.owner || friends.includes(id) || !ship.alive) return;
        const { distance, at } = closestApproach(trail, ship);
        const gap = distance - PHYSICS.SHIP_RADIUS;
        if (gap > 0) this.record((book) => (book.closeCall = improve(book.closeCall, vs.owner, gap, false, { trail, at })));
      });
    }
  }

  /** Note something for the scorecard, in both the round's and the match's books. */
  private record(update: (book: StatBook) => void): void {
    update(this.roundStats);
    update(this.matchStats);
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
    // The oracle's question for the whole round: a lone survivor or a whole team won it, or nobody did.
    this.oracle.resolveRound(team !== null ? this.players.filter((p) => p.team === team).map((p) => p.id) : survivor !== null ? [survivor] : [], this.round, this.clock);
    // What the bets on the round come to: their share of the pot goes into the winners' scores.
    for (const tip of this.oracle.roundResult?.tips ?? []) if (tip.payout && this.players[tip.player]) this.players[tip.player].score += tip.payout;
    this.scoreHistory.push(this.players.map((p) => p.score));
    this.current = -1;
    this.setPhase('roundOver');
    this.emit({ type: 'roundEnd' });
  }

  // ————————————————————————————— CPU —————————————————————————————

  private plannerRngFor(id: number): Rng {
    let rng = this.plannerRngs.get(id);
    if (!rng) {
      rng = createRng(this.matchSeed ^ Math.imul(this.players[id].seat + 1, 0x9e3779b9));
      this.plannerRngs.set(id, rng);
    }
    return rng;
  }

  /**
   * Where a CPU lays the placement it holds, as an aim: a rough spot, never a searched one. A black hole or
   * a nebula goes part way along the line to the nearest enemy, so that enemy's next shot runs into it; a defense
   * stands on the planet nearest the CPU, on the side that faces it; the
   * planet killer shoots the planet lying most in the way of that line. Null when the CPU holds no placement,
   * or there is no planet left.
   */
  protected cpuPlacementAim(p: PlayerState): Aim | null {
    const kind = p.powerUp;
    if (kind !== 'blackhole' && kind !== 'nebula' && kind !== 'planetkiller' && kind !== 'defense') return null;
    const world = this.world;
    const from = world.ships[p.id];
    const friends = this.friendsOf(p.id);
    const enemies = this.players
      .filter((q) => q.alive && q.id !== p.id && !friends.includes(q.id))
      .map((q) => world.ships[q.id])
      .sort((a, b) => Math.hypot(a.x - from.x, a.y - from.y) - Math.hypot(b.x - from.x, b.y - from.y));
    const reach = (POWER_UP.TELEPORT_MAX_POWER / AIM.MAX_POWER) * POWER_UP.TELEPORT_RANGE;
    const to = enemies[0] ?? from;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const span = dx * dx + dy * dy;
    /** How far a planet sits off the line the CPU shoots along — small means it is in the way. */
    const laneGap = (planet: { x: number; y: number }): number => {
      const t = span ? Math.max(0, Math.min(1, ((planet.x - from.x) * dx + (planet.y - from.y) * dy) / span)) : 0;
      return Math.hypot(from.x + t * dx - planet.x, from.y + t * dy - planet.y);
    };
    let spot: { x: number; y: number };
    if (kind === 'defense') {
      // On the planet nearest its own ship, on the side that faces it: the shots coming at the CPU pass there.
      const near = [...world.planets].sort((a, b) => Math.hypot(a.x - from.x, a.y - from.y) - Math.hypot(b.x - from.x, b.y - from.y))[0];
      if (!near) return null;
      return { angle: normalizeAngle((Math.atan2(-(near.y - from.y), near.x - from.x) * 180) / Math.PI), power: 0 };
    }
    if (kind === 'planetkiller') {
      const byGap = [...world.planets].sort((a, b) => laneGap(a) - laneGap(b));
      if (!byGap.length) return null;
      spot = { x: byGap[0].x, y: byGap[0].y };
    } else {
      // A little ahead of its own ship, on the way in: near enough for the enemy's shot to meet it.
      const d = Math.hypot(dx, dy) || 1;
      const along = Math.min(0.45 * d, reach);
      spot = { x: from.x + (dx / d) * along, y: from.y + (dy / d) * along };
    }
    const distance = Math.hypot(spot.x - from.x, spot.y - from.y);
    return {
      angle: normalizeAngle((Math.atan2(-(spot.y - from.y), spot.x - from.x) * 180) / Math.PI),
      power: Math.min(POWER_UP.TELEPORT_MAX_POWER, (distance / POWER_UP.TELEPORT_RANGE) * AIM.MAX_POWER),
    };
  }

  /** A CPU lays the placement it holds, at the spot its aim points at. False when it cannot lay it now. */
  protected placeForCpu(id: number): boolean {
    return this.power.placeForCpu(id);
  }

  /** Think for the given CPU players, sharing a per-frame time budget round-robin. */
  protected runCpu(ids: number[], budgetMs: number, effort: number, lookahead?: number): void {
    const logDecisions = (typeof process !== 'undefined' && process.env.AI_DECISION_LOGS === '1')
      || import.meta.env?.VITE_AI_DECISION_LOGS === '1';
    for (const id of ids) {
      if (this.cpuJobs.has(id)) continue;
      const p = this.players[id];
      const friends = [...this.friendsOf(id), ...this.sparedFor(id)];
      const pierce = !!p.armed && p.powerUp === 'piercing';
      // The pickups a CPU would actually keep (a preview is of no use to it): the planner steers its
      // search through them, so a power-up-hungry level like Einstein collects more.
      const pickups: ShotGate[] = this.powerUps
        ? this.power.pickups
            .filter((pickup) => !CPU_IGNORES[pickup.kind])
            .map((pickup) => ({ x: pickup.x, y: pickup.y, r: POWER_UP.PICKUP_RADIUS }))
        : [];
      const planner = planShot(this.world, id, {
        rules: this.rules,
        level: p.cpu ?? 'medium',
        attempt: p.shots,
        fixedPower: this.settings.fixedPower ? startPower(this.settings) : null,
        maxPower: this.settings.maxPower,
        rng: this.plannerRngFor(id),
        effort,
        lookahead,
        friends,
        pierce,
        pickups,
        grudgeTarget: this.lastHitBy.get(id) ?? null,
        // A CPU holding a teleport also wants to know whether it found a hitting shot at all.
        ...(logDecisions || this.options.onCpuDecision || (this.powerUps && p.powerUp === 'teleport')
          ? {
              onDecision: (decision) => {
                const job = this.cpuJobs.get(id);
                if (job) job.blind = decision.hitCandidates === 0;
                if (logDecisions || this.options.onCpuDecision) this.logCpuDecision(id, decision, logDecisions);
              },
            }
          : {}),
      });
      this.cpuJobs.set(id, { planner, target: null, settle: 0 });
    }
    const deadline = this.options.deterministicCpu ? 0 : performance.now() + budgetMs;
    let busy = true;
    while (busy && (this.options.deterministicCpu || performance.now() < deadline)) {
      busy = false;
      for (const id of ids) {
        const job = this.cpuJobs.get(id);
        if (!job?.planner) continue;
        busy = true;
        const r = job.planner.next();
        if (r.done) {
          job.target = r.value;
          job.planner = null;
        }
      }
    }
  }
  private logCpuDecision(player: number, decision: CpuDecision, logsEnabled: boolean): void {
    const report: CpuDecisionReport = {
      mode: this.mode,
      round: this.round,
      player,
      shot: this.players[player].shots + 1,
      ...decision,
    };
    this.options.onCpuDecision?.(report);
    if (logsEnabled) console.info('[AI] decision', report);
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
    if (phase === 'aiming') this.openRoundQuestion();
  }

  protected emit(e: GameEvent): void {
    for (const l of this.listeners) l(e);
  }
}

export function newPlayer(id: number, seat: number, kind: Exclude<Seat, 'off'>, team: number | null, target = false, fixedName?: string, avatar: Avatar | null = null): PlayerState {
  const cpu = kind === 'human' ? null : kind;
  return {
    id,
    seat,
    avatar,
    // A getter, so the name follows the UI language when it is switched mid-match.
    get name() {
      if (fixedName) return fixedName;
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
    passed: false,
    powerUp: null,
    armed: false,
  };
}
