import { AIM, HORIZON, PHYSICS, SCORING, COLORS, WORMHOLE } from '../config';
import { t } from '../i18n';
import { cloneWorld, type ShotRules, type StyleKind, type World } from '../physics';
import { POWER_UP, type Pickup } from '../powerups';
import type { PowerUpState } from './powerup-field';
import { scoreHorizonKill } from '../scoring';
import { shotSource, Volley, type VolleyAim, type VolleyScript, type VolleyShot, type VolleySnapshot } from '../volley';
import { Match, type Camera, type KillRecord, type Phase, type RoundTitle, type Scene } from './match';
import type { OracleSnapshot } from './oracle';

/** Everything needed to replay one kill exactly — the physics is deterministic. */
interface KillcamClip {
  snapshot: World;
  aims: VolleyAim[];
  /** What was done to the flight on the way (splits, shields), so the replay flies the same flight. */
  script?: VolleyScript[];
  /** Index of the killing shot within the volley. */
  focus: number;
  victim: number;
  /** Simulation step at which the kill happened. */
  killStep: number;
  record: KillRecord;
}

export interface HorizonSnapshot {
  phase: Phase;
  phaseTime: number;
  clock: number;
  round: number;
  worldSeed?: number;
  totalRounds: number;
  hiddenPlanets: boolean;
  teamMode: number;
  players: Match['players'];
  current: number;
  world: World;
  trails: Match['trails'];
  volley: VolleySnapshot | null;
  /** Phase time when a finished volley began waiting for its post-flight delay. */
  flightDoneAt?: number | null;
  killFeed: Match['killFeed'];
  lastKill: Match['lastKill'];
  summary: Match['summary'];
  notice: Match['notice'];
  settings: Match['settings'];
  roundStats: Match['roundStats'];
  matchStats: Match['matchStats'];
  scoreHistory: number[][];
  volleyNo: number;
  clock_: HorizonMatch['clock_'];
  queue: number[];
  snapshot: World | null;
  aims: VolleyAim[];
  volleyKills: { record: KillRecord; shotIndex: number; step: number }[];
  collapse: null | Omit<CollapseState, 'planets' | 'ships' | 'pickups'> & { planets: [number, Drift][]; ships: [number, Drift][]; pickups?: [number, Drift][] };
  /** The clip being replayed — static for the whole killcam, so it travels as its own (rarely changing) field. */
  killcamClip: KillcamClip | null;
  killcam: null | {
    replay: VolleySnapshot;
    simClock: number;
    hold: number;
    camera: Camera;
    returnTo: Phase | null;
    recording: boolean;
    skipVotes: number[];
  };
  lastClip: KillcamClip | null;
  oracle: OracleSnapshot;
  pickups?: Pickup[];
  power?: PowerUpState;
}

interface KillcamState {
  clip: KillcamClip;
  replay: Volley;
  simClock: number;
  /** Seconds spent after the kill, holding on the explosion. */
  hold: number;
  camera: Camera;
  /** Phase to return to afterwards (replays started from the round summary); null = continue the volley. */
  returnTo: Phase | null;
  recording: boolean;
  /** Online: the players who voted to skip. */
  skipVotes: number[];
}

interface Drift {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  /** Falls into the hole during this collapse. */
  lost: boolean;
}

interface CollapseState {
  fromRadius: number;
  toRadius: number;
  fromMass: number;
  toMass: number;
  planets: Map<number, Drift>;
  ships: Map<number, Drift>;
  /** The power-up pickups, by id: the hole pulls them in like planets. */
  pickups: Map<number, Drift>;
  /** The wormholes the hole takes this collapse, by id, with where their portals stood. Portals do not drift. */
  wormholes: WormholeFate[];
}

/** A wormhole the hole swallows: both portals fall in together, from where they stood. */
interface WormholeFate {
  id: number;
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

const SWALLOW_MARGIN = 14;

/**
 * "Ereignishorizont" — gravity royale. Everyone locks in an aim, then all shots fly at once.
 * After every volley the central black hole grows, eats planets and drags ships inwards.
 * Kills pay base × trick-shot combo and get a slow-motion killcam.
 */
export class HorizonMatch extends Match {
  readonly mode = 'horizon';
  volleyNo = 0;
  lastClip: KillcamClip | null = null;
  killcam: KillcamState | null = null;

  private clock_: number = HORIZON.SHOT_CLOCK;
  private queue: number[] = [];
  private volleySnapshot: World | null = null;
  private aims: VolleyAim[] = [];
  /** What was done to the volley in the air; the killcam's clip keeps it. */
  private volleyScript: VolleyScript[] = [];
  private volleyKills: { record: KillRecord; shotIndex: number; step: number }[] = [];
  private collapse: CollapseState | null = null;

  get rules(): ShotRules {
    return { bounce: this.settings.bounce, timeLimit: this.settings.shotTime };
  }

  snapshot(): HorizonSnapshot {
    return {
      phase: this.phase, phaseTime: this.phaseTime, clock: this.clock, round: this.round, worldSeed: this.worldSeed,
      totalRounds: this.totalRounds, hiddenPlanets: this.hiddenPlanets, teamMode: this.teamMode,
      players: this.players.map((player) => ({ ...player })), current: this.current, world: this.world,
      trails: this.trails, volley: this.volley?.snapshot() ?? null, flightDoneAt: this.flightDoneAt, killFeed: this.killFeed,
      lastKill: this.lastKill, summary: this.summary, notice: this.notice, settings: this.settings,
      roundStats: this.roundStats, matchStats: this.matchStats, scoreHistory: this.scoreHistory,
      volleyNo: this.volleyNo, clock_: this.clock_, queue: this.queue, snapshot: this.volleySnapshot,
      aims: this.aims, volleyKills: this.volleyKills,
      collapse: this.collapse ? { ...this.collapse, planets: [...this.collapse.planets], ships: [...this.collapse.ships], pickups: [...this.collapse.pickups], wormholes: this.collapse.wormholes.map((w) => ({ ...w })) } : null,
      killcamClip: this.killcam?.clip ?? null,
      killcam: this.killcam ? {
        replay: this.killcam.replay.snapshot(), simClock: this.killcam.simClock,
        hold: this.killcam.hold, camera: this.killcam.camera, returnTo: this.killcam.returnTo,
        recording: this.killcam.recording, skipVotes: [...this.killcam.skipVotes],
      } : null,
      lastClip: this.lastClip,
      oracle: this.oracle.snapshot(),
      pickups: this.pickups,
      power: this.powerState,
    };
  }

  restoreSnapshot(s: HorizonSnapshot): void {
    if (s.world.ships.length !== s.players.length) return;
    this.settings = s.settings;
    this.phase = s.phase; this.phaseTime = s.phaseTime; this.clock = s.clock; this.round = s.round;
    this.worldSeed = s.worldSeed ?? 0;
    this.totalRounds = s.totalRounds; this.hiddenPlanets = s.hiddenPlanets; this.teamMode = s.teamMode;
    this.players = s.players.map((player) => ({ ...player })); this.current = s.current;
    this.world = s.world; this.trails = s.trails; this.killFeed = s.killFeed; this.lastKill = s.lastKill;
    this.summary = s.summary; this.notice = s.notice; this.roundStats = s.roundStats; this.matchStats = s.matchStats; this.scoreHistory = s.scoreHistory; this.volleyNo = s.volleyNo; this.clock_ = s.clock_;
    this.queue = [...s.queue]; this.volleySnapshot = s.snapshot; this.aims = s.aims; this.volleyKills = s.volleyKills;
    this.collapse = s.collapse ? { ...s.collapse, planets: new Map(s.collapse.planets), ships: new Map(s.collapse.ships), pickups: new Map(s.collapse.pickups ?? []), wormholes: s.collapse.wormholes ?? [] } : null;
    this.volley = null;
    if (s.volley) {
      this.volley = new Volley(this.world, s.volley.aims, this.rules, true);
      this.volley.restore(s.volley);
    }
    this.lastClip = s.lastClip;
    // Hosts from before the oracle send none.
    if (s.oracle) this.oracle.restore(s.oracle);
    this.pickups = s.pickups ?? [];
    this.power.restoreState(s.power);
    this.killcam = null;
    if (s.killcam && s.killcamClip) {
      const clip = s.killcamClip;
      const replay = new Volley(cloneWorld(clip.snapshot), clip.aims, this.rules, true, clip.script);
      replay.restore(s.killcam.replay);
      this.killcam = {
        clip, replay, simClock: s.killcam.simClock, hold: s.killcam.hold,
        camera: s.killcam.camera, returnTo: s.killcam.returnTo, recording: s.killcam.recording, skipVotes: [...s.killcam.skipVotes],
      };
    }
    this.restarted();
    this.flightDoneAt = s.flightDoneAt ?? null;
  }

  /** Everyone who hasn't locked in may aim when all aim at once; otherwise only the player on turn. */
  canAim(id: number): boolean {
    if (!this.simultaneous) return super.canAim(id);
    const p = this.players[id];
    return this.phase === 'aiming' && !!p && p.alive && !p.cpu && !p.locked;
  }

  adjustPlayer(id: number, dAngle: number, dPower: number): void {
    if (!this.canAim(id)) return;
    const p = this.players[id];
    this.setPlayerAim(id, p.angle + dAngle, p.power + dPower);
  }

  setPlayerAim(id: number, angle: number, power: number): void {
    if (!this.canAim(id)) return;
    const p = this.players[id];
    p.angle = ((angle % 360) + 360) % 360;
    if (!this.settings.fixedPower) p.power = Math.min(this.settings.maxPower, Math.max(AIM.MIN_POWER, power));
  }

  commitPlayer(id: number): void {
    // The fire key during a flight: an armed splitter forks the shot.
    if (this.phase === 'flying') {
      this.splitInFlight(id);
      return;
    }
    if (!this.canAim(id)) return;
    // While a ship aims a teleport or a black hole, fire places it; the placement spends its shot, so it fires nothing this volley.
    if (this.placingFor(id)) {
      if (this.confirmPlacement(id)) this.spend(id);
      return;
    }
    this.lock(id);
  }

  get salvo(): boolean {
    return true;
  }

  protected get afterVolleyDelay(): number {
    return this.volleyKills.length ? HORIZON.KILLCAM_DELAY : 0;
  }

  protected get survivorBonus(): number {
    return SCORING.LAST_IN_ORBIT;
  }

  protected get volleyNumber(): number {
    return this.volleyNo;
  }

  get shotClock(): number | null {
    if (this.phase !== 'aiming') return null;
    const aiming = this.simultaneous ? this.players.some((p) => this.canAim(p.id)) : this.isHumanTurn;
    return aiming ? Math.max(0, this.clock_) : null;
  }

  get nextHoleRadius(): number | null {
    const hole = this.world.holes[0];
    if (!hole || this.phase === 'roundOver' || this.phase === 'gameOver') return null;
    if (this.collapse) return this.collapse.toRadius;
    return hole.radius + HORIZON.GROWTH + HORIZON.GROWTH_ACCEL * this.volleyNo;
  }

  get canReplay(): boolean {
    return !!this.lastClip && (this.phase === 'roundOver' || (this.phase === 'killcam' && !this.killcam?.recording));
  }

  scene(): Scene {
    const k = this.killcam;
    if (k) return { world: k.replay.world, trails: [], volley: k.replay, camera: k.camera };
    return super.scene();
  }

  devourProgress(seed: number): number {
    return this.collapse?.planets.get(seed)?.lost ? this.collapseT : 0;
  }

  swallowProgress(ship: number): number {
    return this.collapse?.ships.get(ship)?.lost ? this.collapseT : 0;
  }

  devourWormhole(id: number): number {
    return this.collapse?.wormholes.some((w) => w.id === id) ? this.collapseT : 0;
  }

  private get collapseT(): number {
    return Math.min(1, this.phaseTime / HORIZON.COLLAPSE_TIME);
  }

  protected beginRound(): void {
    this.volleyNo = 0;
    this.lastClip = null;
    this.killcam = null;
    this.collapse = null;
    this.startPlanning();
  }

  // ————————————————————————————— Planning —————————————————————————————

  private startPlanning(): void {
    this.volleyNo++;
    // Render only the previous volley; each CPU's learner survives this visual pruning.
    this.trails = this.trails.filter((t) => t.volley >= this.volleyNo - 1);
    const alive = this.alive;
    for (const p of alive) {
      p.locked = false;
      p.passed = false;
    }
    // Rotate who aims first so nobody always waits last.
    const start = (this.round + this.volleyNo) % alive.length;
    const order = [...alive.slice(start), ...alive.slice(0, start)];
    this.queue = this.simultaneous ? [] : order.filter((p) => !p.cpu).map((p) => p.id);
    this.cpuJobs.clear();
    this.setPhase('aiming');
    this.openOracle('salvo');
    if (this.simultaneous) {
      // No turns: everybody aims against one shared clock.
      this.current = -1;
      this.clock_ = HORIZON.SIMULTANEOUS_CLOCK;
    } else {
      this.nextHuman();
    }
  }

  private nextHuman(): void {
    this.current = this.queue.shift() ?? -1;
    this.clock_ = HORIZON.SHOT_CLOCK;
    if (this.current >= 0) this.emit({ type: 'turn', player: this.current });
  }

  commit(): void {
    // The fire key during a flight: an armed splitter forks the shot.
    if (this.phase === 'flying') {
      this.splitInFlight(this.viewer ?? this.current);
      return;
    }
    // While a ship aims a teleport or a black hole, fire places it; the placement spends its shot, so it fires nothing this volley.
    const by = this.viewer ?? this.current;
    if (this.placingFor(by)) {
      if (this.confirmPlacement(by)) this.spend(by);
      return;
    }
    if (this.isHumanTurn) this.lock(this.current);
  }

  /** The ship spent its shot on a teleport: it fires nothing this volley, and the turn moves on. */
  private spend(id: number): void {
    this.players[id].passed = true;
    this.lock(id);
  }

  private lock(id: number): void {
    this.players[id].locked = true;
    this.emit({ type: 'lock', player: id });
    if (!this.simultaneous) this.nextHuman();
  }

  protected updatePhase(dt: number): void {
    if (this.phase === 'aiming') this.updatePlanning(dt);
    else if (this.phase === 'killcam') this.updateKillcam(dt);
    else if (this.phase === 'collapse') this.updateCollapse();
  }

  private updatePlanning(dt: number): void {
    const cpus = this.alive.filter((p) => p.cpu && !p.locked);
    if (cpus.length) {
      // All CPUs think in parallel while the humans aim. Shots never leave the walled arena,
      // so a shorter look-ahead keeps the search affordable.
      this.runCpu(cpus.map((p) => p.id), 8, 0.6, 7);
      for (const p of cpus) {
        const job = this.cpuJob(p.id);
        if (this.cpuRescueIfBlind(p, job)) continue;
        const place = this.cpuPlacementAim(p);
        if (place && this.phaseTime >= 0.5) {
          // It lays the placement once its aim is on the spot; the placement spends its shot, so it fires nothing this volley.
          if (!this.swingTowards(p, place, dt, 2)) continue;
          if (this.placeForCpu(p.id)) {
            p.passed = true;
            p.locked = true;
            this.emit({ type: 'lock', player: p.id });
            continue;
          }
          // Nowhere to lay it this volley: it keeps the power-up and aims a shot instead.
        }
        if (!job?.target || this.phaseTime < 0.5) continue;
        if (this.swingTowards(p, job.target, dt, 2)) {
          job.settle += dt;
          if (job.settle > 0.2) {
            p.locked = true;
            this.emit({ type: 'lock', player: p.id });
          }
        }
      }
    }
    if (this.simultaneous) {
      const waiting = this.alive.filter((p) => !p.cpu && !p.locked);
      if (waiting.length) {
        this.clock_ -= dt;
        if (this.clock_ <= 0) for (const p of waiting) this.lock(p.id);
      }
    } else if (this.current >= 0) {
      this.clock_ -= dt;
      if (this.clock_ <= 0) this.commit();
    }
    if (this.alive.every((p) => p.locked) && this.phaseTime > 0.6 && this.betWindowDone) this.launchVolley();
  }

  private launchVolley(): void {
    this.volleySnapshot = cloneWorld(this.world);
    this.aims = this.alive.filter((p) => !p.passed).flatMap((p) => this.aimsFor(p));
    for (const p of this.alive) if (!p.passed) p.shots++;
    this.volleyKills = [];
    this.notice = { text: t('notice.volley'), color: COLORS.bone, at: this.clock };
    this.emit({ type: 'volley' });
    this.launch(this.aims, true);
    this.volleyScript = this.volley?.script ?? [];
  }

  protected onKill(record: KillRecord, shotIndex: number, step: number): void {
    this.volleyKills.push({ record, shotIndex, step });
  }

  protected afterVolley(): void {
    // Replay the volley's best kill (self-hits only if that's all there was).
    const best = [...this.volleyKills].sort((a, b) => Number(own(a.record)) - Number(own(b.record)) || b.record.points - a.record.points)[0];
    if (best && this.volleySnapshot) {
      this.lastClip = {
        snapshot: this.volleySnapshot,
        aims: this.aims,
        script: this.volleyScript,
        focus: best.shotIndex,
        victim: best.record.victim,
        killStep: best.step,
        record: best.record,
      };
      this.startKillcam(this.lastClip, null, false);
    } else {
      this.startCollapse();
    }
  }

  protected killPoints(vs: VolleyShot): { points: number; combo: StyleKind[]; multiplier: number } {
    const kinds = (vs.shot.style ?? []).map((e) => e.kind);
    const { points, combo } = scoreHorizonKill(vs.shot.power, kinds, this.settings.fixedPower);
    return { points, combo: kinds, multiplier: combo };
  }

  // ————————————————————————————— Killcam —————————————————————————————

  /** Replay the last kill (e.g. to record a clip). Returns false when there is nothing to replay right now. */
  replayLastKill(recording: boolean): boolean {
    if (!this.lastClip || !this.canReplay) return false;
    const returnTo = this.phase === 'killcam' ? this.killcam!.returnTo : this.phase;
    this.startKillcam(this.lastClip, returnTo, recording);
    return true;
  }

  get killcamInfo(): { clip: KillcamClip; recording: boolean; slow: boolean; votes: number; needed: number } | null {
    const k = this.killcam;
    if (!k) return null;
    return { clip: k.clip, recording: k.recording, slow: this.killcamRate(k) < 0.5, votes: k.skipVotes.length, needed: this.skipsNeeded };
  }

  /** At least half of the people at the table have to want the killcam gone. */
  private get skipsNeeded(): number {
    return Math.ceil(this.players.filter((p) => !p.cpu).length / 2);
  }

  voteSkip(player: number): void {
    const k = this.killcam;
    if (!k || k.recording || this.phaseTime <= 0.3 || k.skipVotes.includes(player)) return;
    k.skipVotes.push(player);
    if (k.skipVotes.length >= this.skipsNeeded) this.endKillcam();
  }

  private startKillcam(clip: KillcamClip, returnTo: Phase | null, recording: boolean): void {
    const replay = new Volley(cloneWorld(clip.snapshot), clip.aims, this.rules, true, clip.script);
    const start = this.focusShot(replay, clip).shot;
    this.killcam = { clip, replay, simClock: 0, hold: 0, camera: { x: start.x, y: start.y, zoom: 1.2 }, returnTo, recording, skipVotes: [] };
    this.setPhase('killcam');
    this.emit({ type: 'killcam', active: true, recording });
  }

  /** The shot the killcam follows: the killing one, or — until a split has made it — the shot it will branch off from. */
  private focusShot(replay: Volley, clip: KillcamClip): VolleyShot {
    return replay.shots[clip.focus] ?? replay.shots[shotSource(clip.aims.length, clip.script ?? [], clip.focus)];
  }

  private killcamRate(k: KillcamState): number {
    const toKill = k.clip.killStep - k.replay.steps;
    if (toKill <= 0) return 0.3;
    // Slow motion for the last moments before impact.
    return toKill < 0.7 / PHYSICS.DT ? 0.2 : 0.85;
  }

  private updateKillcam(dt: number): void {
    const k = this.killcam!;
    k.simClock += dt * this.killcamRate(k);
    while (k.simClock >= PHYSICS.DT && !k.replay.done) {
      k.simClock -= PHYSICS.DT;
      for (const e of k.replay.step()) this.onVolleyEvent(k.replay, e, false);
    }
    const afterKill = k.replay.steps >= k.clip.killStep;
    if (afterKill || k.replay.done) k.hold += dt;

    // Follow the killing shot, then settle on the wreck.
    const focus = this.focusShot(k.replay, k.clip).shot;
    const victim = k.replay.world.ships[k.clip.victim];
    const tx = afterKill ? victim.x : focus.x;
    const ty = afterKill ? victim.y : focus.y;
    const tz = afterKill ? 2.3 : 1.7;
    const f = 1 - Math.exp(-dt * 5);
    const cam = k.camera;
    cam.zoom += (tz - cam.zoom) * f;
    cam.x += (tx - cam.x) * f;
    cam.y += (ty - cam.y) * f;
    const halfW = k.replay.world.width / (2 * cam.zoom);
    const halfH = k.replay.world.height / (2 * cam.zoom);
    cam.x = Math.min(k.replay.world.width - halfW, Math.max(halfW, cam.x));
    cam.y = Math.min(k.replay.world.height - halfH, Math.max(halfH, cam.y));

    if (k.hold > 1.4) this.endKillcam();
  }

  private endKillcam(): void {
    const k = this.killcam!;
    this.killcam = null;
    this.emit({ type: 'killcam', active: false, recording: k.recording });
    if (k.returnTo) this.setPhase(k.returnTo);
    else this.startCollapse();
  }

  advance(): void {
    if (this.phase === 'killcam') {
      if (!this.killcam!.recording && this.phaseTime > 0.3) this.endKillcam();
      return;
    }
    super.advance();
  }

  // ————————————————————————————— Collapse —————————————————————————————

  /** The black hole grows, eats what comes too close and pulls everything else inwards. */
  private startCollapse(): void {
    const hole = this.world.holes[0];
    const toRadius = hole.radius + HORIZON.GROWTH + HORIZON.GROWTH_ACCEL * this.volleyNo;
    let toMass = hole.mass + HORIZON.MASS_PER_VOLLEY;
    const pull = (x: number, y: number, factor: number, margin: number): Drift => {
      const d = Math.hypot(x - hole.x, y - hole.y);
      const drift = Math.min(HORIZON.MAX_DRIFT, Math.max(HORIZON.MIN_DRIFT, (HORIZON.DRIFT * hole.mass) / (d * d))) * factor;
      const lost = d - drift < toRadius + margin;
      const k = lost ? 1 : drift / d;
      return { fromX: x, fromY: y, toX: x + (hole.x - x) * k, toY: y + (hole.y - y) * k, lost };
    };

    const planets = new Map<number, Drift>();
    for (const p of this.world.planets) {
      const drift = pull(p.x, p.y, 0.6, p.radius * 0.6);
      if (drift.lost) {
        toMass += p.mass * HORIZON.FEED;
        this.emit({ type: 'devour', x: p.x, y: p.y, toX: hole.x, toY: hole.y, color: p.tint, vx: 0, vy: 0 });
      }
      planets.set(p.seed, drift);
    }
    const ships = new Map<number, Drift>();
    for (const p of this.alive) {
      const s = this.world.ships[p.id];
      ships.set(p.id, pull(s.x, s.y, 1, SWALLOW_MARGIN));
    }
    // Pickups drift in like planets (a little faster), and the hole eats those that come too close.
    const pickups = new Map<number, Drift>();
    if (this.powerUps) for (const pickup of this.pickups) pickups.set(pickup.id, pull(pickup.x, pickup.y, 0.8, POWER_UP.PICKUP_RADIUS));
    // Portals stay where they are, but the growing hole takes one that ends up inside it, and its partner goes too.
    const wormholes: WormholeFate[] = [];
    for (const w of this.world.wormholes) {
      const margin = w.radius * 0.5;
      const inside = (x: number, y: number): boolean => Math.hypot(x - hole.x, y - hole.y) < toRadius + margin;
      if (!inside(w.ax, w.ay) && !inside(w.bx, w.by)) continue;
      wormholes.push({ id: w.id, ax: w.ax, ay: w.ay, bx: w.bx, by: w.by });
      this.emit({ type: 'devour', x: w.ax, y: w.ay, toX: hole.x, toY: hole.y, color: WORMHOLE.COLORS[w.id % WORMHOLE.COLORS.length], vx: 0, vy: 0 });
      this.emit({ type: 'devour', x: w.bx, y: w.by, toX: hole.x, toY: hole.y, color: WORMHOLE.COLORS[w.id % WORMHOLE.COLORS.length], vx: 0, vy: 0 });
    }
    this.collapse = { fromRadius: hole.radius, toRadius, fromMass: hole.mass, toMass, planets, ships, pickups, wormholes };
    this.setPhase('collapse');
    this.emit({ type: 'collapse', x: hole.x, y: hole.y });
  }

  private updateCollapse(): void {
    const c = this.collapse!;
    const t = this.collapseT;
    const e = t * t * (3 - 2 * t);
    const hole = this.world.holes[0];
    hole.radius = c.fromRadius + (c.toRadius - c.fromRadius) * e;
    hole.mass = c.fromMass + (c.toMass - c.fromMass) * e;
    for (const p of this.world.planets) {
      // A defense stands on its planet and drifts with it.
      const ox = p.x;
      const oy = p.y;
      move(p, c.planets.get(p.seed)!, e, t);
      for (const d of this.world.defenses) {
        if (d.planet !== p.seed) continue;
        d.x += p.x - ox;
        d.y += p.y - oy;
      }
    }
    for (const fate of c.wormholes) {
      // Both portals fall in, quickening like anything the hole eats.
      const w = this.world.wormholes.find((o) => o.id === fate.id);
      if (!w) continue;
      w.ax = fate.ax + (hole.x - fate.ax) * t * t;
      w.ay = fate.ay + (hole.y - fate.ay) * t * t;
      w.bx = fate.bx + (hole.x - fate.bx) * t * t;
      w.by = fate.by + (hole.y - fate.by) * t * t;
    }
    for (const [id, d] of c.ships) move(this.world.ships[id], d, e, t);
    for (const pickup of this.pickups) {
      const d = c.pickups.get(pickup.id);
      if (d) move(pickup, d, e, t);
    }
    if (t >= 1) this.finishCollapse();
  }

  private finishCollapse(): void {
    const c = this.collapse!;
    const hole = this.world.holes[0];
    this.collapse = null;
    this.world.planets = this.world.planets.filter((p) => !c.planets.get(p.seed)?.lost);
    this.world.wormholes = this.world.wormholes.filter((w) => !c.wormholes.some((fate) => fate.id === w.id));
    // A defense does not outlive the planet it stood on.
    this.world.defenses = this.world.defenses.filter((d) => this.world.planets.some((p) => p.seed === d.planet));
    this.world.version++;
    // What the hole swallowed is gone from the field; what drifted stays where it landed.
    const eaten = this.pickups.filter((pickup) => c.pickups.get(pickup.id)?.lost);
    for (const gone of eaten) this.emit({ type: 'pickupFade', kind: gone.kind, x: hole.x, y: hole.y });
    this.pickups = this.pickups.filter((pickup) => !eaten.includes(pickup));
    this.power.sweep();

    for (const [id, d] of c.ships) {
      if (!d.lost) continue;
      this.players[id].alive = false;
      this.world.ships[id].alive = false;
      this.emit({ type: 'devour', x: hole.x, y: hole.y, toX: hole.x, toY: hole.y, color: this.players[id].color, vx: 0, vy: 0 });
      this.recordKill({ killer: null, victim: id, points: 0, self: false, friendly: false, combo: [], multiplier: 1, shots: 0, power: 0, at: this.clock });
    }
    for (const p of this.alive) p.score += SCORING.VOLLEY_SURVIVED;

    if (this.decided) this.endRound();
    else this.startPlanning();
  }

  protected roundTitle(survivor: number | null): RoundTitle {
    if (survivor !== null) return 'lastInOrbit';
    return this.lastKill?.killer === null ? 'swallowed' : 'noneLeft';
  }
}

/** A kill against your own side — never the first choice for the killcam. */
const own = (r: KillRecord) => r.self || r.friendly;

/** Ease towards the drift target; things falling into the hole accelerate (quadratic). */
function move(o: { x: number; y: number }, d: Drift, e: number, t: number): void {
  const k = d.lost ? t * t : e;
  o.x = d.fromX + (d.toX - d.fromX) * k;
  o.y = d.fromY + (d.toY - d.fromY) * k;
}
