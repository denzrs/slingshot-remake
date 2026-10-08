import { advanceExperimentalWorld, createExperimentalLearner, measureReconstruction, observeExperimentalShot, planExperimentalShot, type ExperimentalDecision, type ExperimentalLearner, type ExperimentalRecoveryDiagnostics, type ExperimentalWorld, type GravityFit } from '../experimental-ai';
import { ExperimentalWorkerCancelledError, ExperimentalWorkerClient } from '../experimental-worker-client';
import { EXPERIMENTAL_PRESETS, isExperimentalCpu, planShot, type Aim, type CpuDecision, type CpuLevel, type ExperimentalCpuConfig } from '../ai';
import { AIM, COLORS, FIELD, GRACE, PHYSICS, SCORING, TEAMS, TRAIL_FADE } from '../config';
import { t } from '../i18n';
import { normalizeAngle, type ShotEnd, type ShotRules, type StyleKind, type World } from '../physics';
import { createRng, randomSeed, type Rng } from '../rng';
import { bump, closestApproach, improve, newStatBook, pathLength, type StatBook } from '../stats';
import { seatTeamsFor, startPower, type Seat, type Settings } from '../settings';
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
  /** Launch aim, used by the experimental CPU to fit gravity from completed shots. */
  angle?: number;
  power?: number;
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

/** Diagnostics from planning; actual gravity is used only to score reconstruction after planning. */
export interface ExperimentalReport {
  mode: Mode;
  round: number;
  player: number;
  shot: number;
  learningRate: number;
  /** Public initial belief, independent of evidence assimilated at learningRate. */
  startingKnowledge: number;
  observedShots: number;
  learnedShots: number;
  retainedShots: number;
  samples: number;
  /** Previous completed shot's pre-update validation; not a forecast of this launch. */
  predictionRms: number | null;
  predictionSamples: number;
  fitMs: number;
  decision: ExperimentalDecision;
  relativeGravityMapRms: number;
  /** Optional additive diagnostics; absent in historical schema-3 records. */
  recovery?: ExperimentalRecoveryDiagnostics;
}
/** Selected launch and simulated outcome for one normal CPU decision. */
export interface CpuDecisionReport extends CpuDecision {
  mode: Mode;
  round: number;
  player: number;
  shot: number;
}


/** Post-ingestion evidence state; prediction validates this shot against the pre-update fit. */
export interface ExperimentalObservationReport {
  learningRate: number;
  startingKnowledge: number;
  observedShots: number;
  learnedShots: number;
  retainedShots: number;
  samples: number;
  predictionRms: number | null;
  predictionSamples: number;
  fitMs: number;
  recovery?: ExperimentalRecoveryDiagnostics;
}

/** Authoritative result of a real shot, never a visual extrapolation or killcam replay. */
export interface CompletedShotReport {
  mode: Mode;
  round: number;
  player: number;
  shot: number;
  /** Index within the launched volley, distinct from the player's round shot ordinal. */
  volleyShot: number;
  hitRelation: 'enemy' | 'friendly' | 'self' | null;
  outcome: ShotEnd['kind'];
  end: ShotEnd;
  hitShip: number | null;
  elapsed: number;
  /** Own real-flight observation, captured before any following planning or field transition. */
  experimentalObservation: ExperimentalObservationReport | null;
}

export interface MatchOptions {
  /** Attract mode (title screen): rounds continue on their own, forever. */
  attract?: boolean;
  /** Override the seats from the settings (used by attract mode). */
  seats?: Seat[];
  /** Fixed player names by player index (online matches) — they survive a rematch. */
  names?: string[];
  /** Fixed team per player index (online matches); `settings.teamMode` is the team count. */
  teams?: number[];
  /** Event Horizon online: every human aims at once instead of one after another at a shared keyboard. */
  simultaneous?: boolean;
  /** Reproducible multi-round worlds, independent of planner random consumption. */
  seed?: number;
  /** Custom experimental evidence rate only: finite values clamp to [0, 1], nonfinite values use 0, omitted uses 1. */
  experimentalLearningRate?: number;
  /** Custom experimental public prior only: finite values clamp to [0, 1], nonfinite values use 0, omitted uses 1. */
  experimentalStartingKnowledge?: number;
  /** Finish CPU generators without a wall-clock budget, for deterministic simulation. */
  deterministicCpu?: boolean;
  /** Inject a worker client for hosts that provide their own Worker implementation. */
  experimentalWorkerClient?: () => ExperimentalWorkerClient;
  onExperimentalDecision?: (report: ExperimentalReport) => void;
  /** Receives normal CPU planner decisions; console logging can also enable this path. */
  onCpuDecision?: (report: CpuDecisionReport) => void;
  onShotComplete?: (report: CompletedShotReport) => void;
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
  /** What happened this round, and in the whole match — for the scorecard. */
  roundStats: StatBook = newStatBook();
  matchStats: StatBook = newStatBook();
  /** Everybody's score at the start of the match and after every round — for the chart on the final screen. */
  scoreHistory: number[][] = [];
  /** Match clock when the current round began, so kills can be timed from the start of the round. */
  protected roundStartedAt = 0;
  /** Online: the player sitting at this screen. null = hot-seat, where whoever is on turn is at the keyboard. */
  viewer: number | null = null;
  /** Whether this screen may move the match on (next round, skip the killcam, rematch). Online only the host may. */
  canAdvance = true;

  protected rng: Rng;
  private readonly matchSeed: number;
  private worldRng: Rng;
  private plannerRngs = new Map<number, Rng>();
  private experimentalLearners = new Map<number, ExperimentalLearner>();
  private experimentalWorlds = new Map<number, ExperimentalWorld>();
  private flightObservation: ExperimentalWorld | null = null;
  private experimentalWorker: ExperimentalWorkerClient | null = null;
  private experimentalGeneration = 0;
  private experimentalPending = new Set<number>();
  private experimentalError: Error | null = null;
  /** Who hit each player last — CPUs with a grudge aim back at them. */
  private lastHitBy = new Map<number, number>();
  private flightPending = false;
  private disposed = false;
  protected cpuJobs = new Map<number, CpuJob>();
  private listeners: ((e: GameEvent) => void)[] = [];
  protected simClock = 0;

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
  protected abstract roundTitle(survivor: number | null): RoundTitle;

  on(listener: (e: GameEvent) => void): void {
    this.listeners.push(listener);
  }

  /** Release the fitting worker when this match leaves the application. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.resetExperimentalState();
    this.experimentalWorker?.dispose();
    this.experimentalWorker = null;
    this.listeners.length = 0;
  }

  private resetExperimentalState(): void {
    this.experimentalGeneration++;
    this.experimentalWorker?.reset();
    this.experimentalPending.clear();
    this.experimentalLearners.clear();
    this.experimentalWorlds.clear();
    this.experimentalError = null;
    this.flightPending = false;
    this.flightObservation = null;
    this.cpuJobs.clear();
  }

  private workerForFitting(): ExperimentalWorkerClient | null {
    if (this.options.deterministicCpu || this.disposed) return null;
    if (!this.experimentalWorker && (this.options.experimentalWorkerClient || typeof Worker !== 'undefined')) {
      this.experimentalWorker = this.options.experimentalWorkerClient?.() ?? new ExperimentalWorkerClient();
    }
    return this.experimentalWorker;
  }

  private failExperimental(error: unknown, generation: number): void {
    if (generation !== this.experimentalGeneration || error instanceof ExperimentalWorkerCancelledError) return;
    this.experimentalError = error instanceof Error ? error : new Error(String(error));
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
    this.worldRng = createRng(this.options.seed ?? randomSeed());
    this.rng = createRng(this.matchSeed ^ 0x4f1bbcdc);
    this.plannerRngs.clear();
    this.lastHitBy.clear();
    this.experimentalLearners.clear();
    const seats = this.options.seats ?? this.settings.seats;
    const taken = seats.flatMap((seat, i) => (seat === 'off' ? [] : [{ seat: i, kind: seat }]));
    const teams = this.attract ? null : (this.options.teams ?? seatTeamsFor(this.settings, taken.map((s) => s.seat)));
    this.teamMode = teams ? this.settings.teamMode : 0;
    this.players = taken.map(({ seat, kind }, id) => newPlayer(id, seat, kind, teams?.[id] ?? null, false, this.options.names?.[id]));
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
    this.totalRounds = this.attract ? 0 : this.settings.rounds;
    this.startRound();
  }

  startRound(): void {
    this.resetExperimentalState();
    this.round++;
    this.roundStats = newStatBook();
    this.roundStartedAt = this.clock;
    this.world = generateWorld(Math.floor(this.worldRng() * 2 ** 32), {
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
      // Face the middle of the field; the classic duel keeps the original's straight 0° / 180°.
      p.angle = duel ? (p.id === 0 ? 0 : 180) : normalizeAngle(Math.round((Math.atan2(ship.y - FIELD.height / 2, FIELD.width / 2 - ship.x) * 180) / Math.PI));
      p.power = startPower(this.settings);
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
    if (this.experimentalError) throw this.experimentalError;
    this.clock += dt;
    this.phaseTime += dt;
    if (this.notice && this.clock - this.notice.at > 1.4) this.notice = null;
    if (this.phase === 'flying') this.updateFlight(dt);
    else this.updatePhase(dt);
    if (this.phase === 'roundOver' && this.attract && this.phaseTime > 3) this.advance();
  }

  // ————————————————————————————— Flight —————————————————————————————

  protected launch(aims: VolleyAim[], trackStyle: boolean): void {
    this.flightObservation = this.observedWorld(aims[0]?.player ?? 0);
    this.volley = new Volley(this.world, aims, this.rules, trackStyle);
    this.simClock = 0;
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
    if (this.flightPending || !this.volley) return;
    const volley = this.volley;
    this.simClock += dt * this.flightSpeed;
    while (this.simClock >= PHYSICS.DT && !volley.done) {
      this.simClock -= PHYSICS.DT;
      for (const e of volley.step()) this.onVolleyEvent(volley, e, true);
    }
    if (!volley.done) return;
    this.flightPending = true;
    const generation = this.experimentalGeneration;
    const finish = (): void => {
      if (generation !== this.experimentalGeneration || this.volley !== volley || this.disposed) return;
      this.trails.push(...volley.shots.map((vs) => ({ owner: vs.owner, points: vs.trail, angle: vs.shot.angle, power: vs.shot.power, volley: this.volleyNumber, at: this.clock })));
      this.volley = null;
      this.flightPending = false;
      this.afterVolley();
    };
    const completion = this.completeShots(volley);
    if (completion) completion.then(finish, (error: unknown) => this.failExperimental(error, generation));
    else finish();
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
    this.resetExperimentalState();
    this.simClock = 0;
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
    this.scoreHistory.push(this.players.map((p) => p.score));
    this.current = -1;
    this.setPhase('roundOver');
    this.emit({ type: 'roundEnd' });
  }

  // ————————————————————————————— CPU —————————————————————————————

  private experimentalConfigFor(id: number): Readonly<ExperimentalCpuConfig> {
    const level = this.players[id].cpu;
    if (!isExperimentalCpu(level)) throw new Error('Experimental configuration requires an experimental CPU');
    if (level !== 'experimental') return EXPERIMENTAL_PRESETS[level];
    const rate = this.options.experimentalLearningRate ?? 1;
    const knowledge = this.options.experimentalStartingKnowledge ?? 1;
    return {
      learningRate: Number.isFinite(rate) ? Math.min(1, Math.max(0, rate)) : 0,
      startingKnowledge: Number.isFinite(knowledge) ? Math.min(1, Math.max(0, knowledge)) : 0,
    };
  }

  private learnerFor(id: number): ExperimentalLearner {
    let learner = this.experimentalLearners.get(id);
    if (!learner) {
      learner = createExperimentalLearner(this.experimentalConfigFor(id).startingKnowledge);
      this.experimentalLearners.set(id, learner);
      this.experimentalWorlds.set(id, this.observedWorld(id));
    }
    return learner;
  }

  private plannerRngFor(id: number): Rng {
    let rng = this.plannerRngs.get(id);
    if (!rng) {
      rng = createRng(this.matchSeed ^ Math.imul(this.players[id].seat + 1, 0x9e3779b9));
      this.plannerRngs.set(id, rng);
    }
    return rng;
  }

  /** Only public geometry, never density, mass, or render-history dependent evidence. */
  protected observedWorld(shooter: number): ExperimentalWorld {
    const hole = this.world.hole;
    return {
      width: this.world.width,
      height: this.world.height,
      ships: this.world.ships.map((ship) => ({ ...ship })),
      shooter,
      planetCount: this.world.planets.length,
      visiblePlanets: this.hiddenPlanets ? undefined : this.world.planets.map(({ seed, x, y, radius }) => ({ id: seed, x, y, radius })),
      visibleHole: hole ? { x: hole.x, y: hole.y, radius: hole.radius } : undefined,
      hasHole: hole !== null,
      holeRadius: hole?.radius ?? 0,
      mode: this.mode === 'horizon' ? 'horizon' : 'classic',
      epoch: this.world.version,
      rules: { bounce: this.rules.bounce },
      shots: [],
    };
  }

  protected advanceExperimentalField(swallowedPlanetIds: readonly number[], holeMassGain: number, feed: number): void {
    const worker = this.experimentalLearners.size ? this.workerForFitting() : null;
    const generation = this.experimentalGeneration;
    for (const [id, learner] of this.experimentalLearners) {
      const world = this.observedWorld(id);
      const transition = { swallowedPlanetIds, holeMassGain, feed };
      if (!worker) {
        advanceExperimentalWorld(learner, world, transition);
        this.experimentalWorlds.set(id, world);
        continue;
      }
      this.experimentalPending.add(id);
      const previousWorld = this.experimentalWorlds.get(id);
      this.experimentalWorlds.set(id, world);
      worker.advance(id, world, transition, this.experimentalConfigFor(id).startingKnowledge, previousWorld).then((updated) => {
        if (generation !== this.experimentalGeneration || this.disposed) return;
        this.experimentalLearners.set(id, updated);
        this.experimentalPending.delete(id);
      }, (error: unknown) => this.failExperimental(error, generation));
    }
  }

  private observationReport(learner: ExperimentalLearner): ExperimentalObservationReport {
    return {
      learningRate: learner.learningRate,
      startingKnowledge: learner.startingKnowledge,
      observedShots: learner.observedShots,
      learnedShots: learner.learnedShots,
      retainedShots: learner.retainedShots ?? learner.evidence.length,
      samples: learner.samples,
      predictionRms: learner.predictionRms,
      predictionSamples: learner.predictionSamples,
      fitMs: learner.fitMs,
      ...(learner.recovery ? { recovery: { ...learner.recovery, sampleCounts: [...learner.recovery.sampleCounts], retainedShotIds: [...learner.recovery.retainedShotIds] } } : {}),
    };
  }

  private completeShots(volley: Volley): Promise<void> | null {
    const worker = volley.shots.some((vs) => isExperimentalCpu(this.players[vs.owner].cpu)) ? this.workerForFitting() : null;
    const generation = this.experimentalGeneration;
    const reports: CompletedShotReport[] = [];
    const fits: Promise<void>[] = [];
    for (const [index, vs] of volley.shots.entries()) {
      const end = vs.shot.end;
      if (!end) continue;
      const player = this.players[vs.owner];
      const report: CompletedShotReport = {
        mode: this.mode,
        round: this.round,
        player: vs.owner,
        shot: player.shots,
        volleyShot: index,
        hitRelation: end.kind !== 'ship' ? null : end.ship === vs.owner ? 'self' : this.friendsOf(vs.owner).includes(end.ship) ? 'friendly' : 'enemy',
        outcome: end.kind,
        end: { ...end },
        hitShip: end.kind === 'ship' ? end.ship : null,
        elapsed: vs.shot.time,
        experimentalObservation: null,
      };
      reports.push(report);
      if (!isExperimentalCpu(player.cpu) || !this.flightObservation) continue;
      const shot = { shotId: player.shots, points: vs.trail, angle: vs.shot.angle, power: vs.shot.power };
      const world = { ...this.flightObservation, shooter: vs.owner };
      const config = this.experimentalConfigFor(vs.owner);
      if (worker) {
        this.experimentalPending.add(vs.owner);
        this.experimentalWorlds.set(vs.owner, world);
        fits.push(worker.submit(vs.owner, shot, world, config.learningRate, config.startingKnowledge).then((learner) => {
          if (generation !== this.experimentalGeneration || this.disposed) return;
          this.experimentalLearners.set(vs.owner, learner);
          this.experimentalPending.delete(vs.owner);
          report.experimentalObservation = this.observationReport(learner);
        }));
      } else {
        const learner = this.learnerFor(vs.owner);
        observeExperimentalShot(learner, shot, world, config.learningRate);
        report.experimentalObservation = this.observationReport(learner);
      }
    }
    const publish = (): void => {
      if (generation !== this.experimentalGeneration || this.disposed) return;
      this.recordFlights(volley);
      this.flightObservation = null;
      for (const report of reports) {
        if (generation !== this.experimentalGeneration || this.disposed) return;
        this.options.onShotComplete?.(report);
      }
    };
    if (fits.length) return Promise.all(fits).then(publish);
    publish();
    return null;
  }

  /** Think for the given CPU players, sharing a per-frame time budget round-robin. */
  protected runCpu(ids: number[], budgetMs: number, effort: number, lookahead?: number): void {
    const logDecisions = (typeof process !== 'undefined' && process.env.AI_DECISION_LOGS === '1')
      || import.meta.env?.VITE_AI_DECISION_LOGS === '1';
    for (const id of ids) {
      if (this.cpuJobs.has(id) || this.experimentalPending.has(id)) continue;
      const p = this.players[id];
      const friends = [...this.friendsOf(id), ...this.sparedFor(id)];
      const planner = isExperimentalCpu(p.cpu)
        ? planExperimentalShot(this.observedWorld(id), {
            rules: this.rules,
            attempt: p.shots,
            fixedPower: this.settings.fixedPower ? startPower(this.settings) : null,
            maxPower: this.settings.maxPower,
            rng: this.plannerRngFor(id),
            effort,
            lookahead,
            friends,
            learner: this.learnerFor(id),
            learningRate: this.experimentalConfigFor(id).learningRate,
          }, (fit, decision) => this.logGravityFit(id, fit, decision))
        : planShot(this.world, id, {
            rules: this.rules,
            level: p.cpu ?? 'medium',
            attempt: p.shots,
            fixedPower: this.settings.fixedPower ? startPower(this.settings) : null,
            maxPower: this.settings.maxPower,
            rng: this.plannerRngFor(id),
            effort,
            lookahead,
            friends,
            grudgeTarget: this.lastHitBy.get(id) ?? null,
            ...(logDecisions || this.options.onCpuDecision ? { onDecision: (decision) => this.logCpuDecision(id, decision, logDecisions) } : {}),
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
  private logGravityFit(player: number, fit: GravityFit, decision: ExperimentalDecision): void {
    const recovery = decision.recovery ?? fit.recovery;
    const logsEnabled = (typeof process !== 'undefined' && process.env.EXPERIMENTAL_AI_LOGS === '1')
      || import.meta.env?.VITE_EXPERIMENTAL_AI_LOGS === '1';
    if (!logsEnabled && !this.options.onExperimentalDecision) return;
    const reconstruction = measureReconstruction(this.world, fit);
    const report: ExperimentalReport = {
      mode: this.mode,
      round: this.round,
      player,
      shot: this.players[player].shots + 1,
      learningRate: decision.learningRate,
      startingKnowledge: decision.startingKnowledge,
      observedShots: decision.observedShots,
      learnedShots: decision.learnedShots,
      retainedShots: decision.retainedShots,
      samples: fit.samples,
      predictionRms: decision.predictionRms,
      predictionSamples: decision.predictionSamples,
      fitMs: fit.fitMs,
      decision,
      relativeGravityMapRms: reconstruction.relativeGravityRms,
      ...(recovery ? { recovery: { ...recovery, sampleCounts: [...recovery.sampleCounts], retainedShotIds: [...recovery.retainedShotIds] } } : {}),
    };
    this.options.onExperimentalDecision?.(report);
    if (logsEnabled) console.info('[AI experimental] decision', {
      ...report,
      fit: {
        initialRms: fit.initialRms,
        rms: fit.rms,
        improvement: fit.improvement,
        diagonalSensitivityProxy: fit.condition,
        samples: fit.samples,
        retainedShots: decision.retainedShots,
        ...(report.recovery ? { recovery: report.recovery } : {}),
      },
      reconstruction: {
        gravityRms: reconstruction.gravityRms,
        relativeGravityErrorPercent: reconstruction.relativeGravityRms * 100,
        realPlanetCount: this.world.planets.length,
        estimatedPlanetCount: fit.planets.length,
        planets: reconstruction.planetMatches.map(({ real, estimated, positionError, massError }) => ({
          real: { x: real.x, y: real.y, mass: real.mass },
          estimated: { ...estimated },
          positionError,
          massError,
          massErrorPercent: real.mass === 0 ? null : massError / Math.abs(real.mass) * 100,
        })),
        realBlackHole: this.world.hole ? { x: this.world.hole.x, y: this.world.hole.y, mass: this.world.hole.mass } : null,
        estimatedBlackHole: fit.holeMass === null ? null : {
          x: fit.hole?.x ?? this.world.width / 2,
          y: fit.hole?.y ?? this.world.height / 2,
          mass: fit.holeMass,
          massStandardDeviation: fit.holeMassStandardDeviation ?? null,
        },
        blackHoleMassErrorPercent: this.world.hole && fit.holeMass !== null && this.world.hole.mass !== 0
          ? Math.abs(fit.holeMass - this.world.hole.mass) / Math.abs(this.world.hole.mass) * 100 : null,
      },
    });
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

export function newPlayer(id: number, seat: number, kind: Exclude<Seat, 'off'>, team: number | null, target = false, fixedName?: string): PlayerState {
  const cpu = kind === 'human' ? null : kind;
  return {
    id,
    seat,
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
  };
}
