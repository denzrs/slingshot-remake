import type { ShotRules, StyleKind, World } from '../sim/physics';
import { scoreChallengeHit } from '../sim/scoring';
import { AIM, COLORS, HORIZON, SCORING, SUDDEN_DEATH, type KillSource, type SuddenDeathKind } from '../sim/config';
import { t } from '../platform/i18n';
import { Volley, type VolleyShot } from '../sim/volley';
import { createRng, pick } from '../sim/rng';
import { planCollision, type DriftMove } from '../sim/drift';
import { landing, planMeteors } from '../sim/meteors';
import { planUfos, zapAt } from '../sim/ufos';
import { Match, type FinalePlanet, type RoundTitle, type SkipVote } from './match';
import type { Pickup } from '../sim/powerups';
import type { PowerUpState } from './powerup-field';
import type { ReplayTurn } from './replay';
import type { CrowdSeat } from './crowd';
import type { OracleSnapshot } from './oracle';
import type { KillcamSnapshot } from './killcam';

export interface ClassicSnapshot extends Partial<KillcamSnapshot> {
  phase: Match['phase'];
  phaseTime: number;
  clock: number;
  round: number;
  worldSeed?: number;
  totalRounds: number;
  hiddenPlanets: boolean;
  teamMode: number;
  teamCursor: number;
  memberCursor: number[];
  players: Match['players'];
  current: number;
  world: World;
  trails: Match['trails'];
  volley: ReturnType<Volley['snapshot']> | null;
  pickups?: Pickup[];
  power?: PowerUpState;
  killFeed: Match['killFeed'];
  lastKill: Match['lastKill'];
  summary: Match['summary'];
  notice: Match['notice'];
  settings: Match['settings'];
  mayhem?: Match['mayhem'];
  revealEnd?: number;
  revealHeld?: boolean;
  mayhemHistory?: Match['mayhemHistory'];
  roundStats: Match['roundStats'];
  matchStats: Match['matchStats'];
  scoreHistory: number[][];
  skipVote?: SkipVote | null;
  /** Simultaneous shots: seconds left to aim. */
  planClock: number;
  /** The passes the round has had, and the ships that have fired in the one under way. */
  passes?: number;
  fired?: number[];
  /** Sudden death: this round's kind of it, and whether it (not a player) has decided the round. */
  suddenDeathKind?: SuddenDeathKind;
  environmentDecided?: boolean;
  /** Sudden death, collision course: the drift of the pass under way (null when no ship is drifting). */
  drift?: DriftMove[] | null;
  /** Sudden death: a finale is playing (the round ends once its hold is over), and how long it holds (s). */
  blasting?: boolean;
  finaleHold?: number;
  /** The planets a finale has yet to destroy (by seed), and when (s into it). */
  doomedPlanets?: { seed: number; at: number }[];
  /** Phase time when a finished volley began waiting for its post-flight delay. */
  flightDoneAt?: number | null;
  oracle: OracleSnapshot;
  stands?: OracleSnapshot;
  crowd?: CrowdSeat[];
}

/**
 * The original game, extended to any number of ships: players take turns, one shot each.
 * A hit ship is out; the round ends when one ship — or one team — is left.
 */
export class ClassicMatch extends Match {
  readonly mode: 'classic' | 'solar' = 'classic';

  snapshot(): ClassicSnapshot {
    return {
      phase: this.phase,
      phaseTime: this.phaseTime,
      clock: this.clock,
      round: this.round,
      worldSeed: this.worldSeed,
      totalRounds: this.totalRounds,
      hiddenPlanets: this.hiddenPlanets,
      teamMode: this.teamMode,
      teamCursor: this.teamCursor,
      memberCursor: this.memberCursor,
      players: this.players.map((player) => ({ ...player })),
      current: this.current,
      world: this.world,
      trails: this.trails,
      volley: this.volley?.snapshot() ?? null,
      pickups: this.pickups,
      power: this.powerState,
      killFeed: this.killFeed,
      lastKill: this.lastKill,
      summary: this.summary,
      notice: this.notice,
      settings: this.settings,
      mayhem: this.mayhem,
      revealEnd: this.revealEnd,
      revealHeld: this.revealHeld,
      mayhemHistory: this.mayhemHistory,
      roundStats: this.roundStats,
      matchStats: this.matchStats,
      scoreHistory: this.scoreHistory,
      skipVote: this.skipVote,
      planClock: this.planClock,
      passes: this.passes,
      fired: [...this.fired],
      suddenDeathKind: this.suddenDeathKind,
      environmentDecided: this.environmentDecided,
      drift: this.drift,
      blasting: this.blasting,
      finaleHold: this.finaleHold,
      doomedPlanets: this.doomedPlanets,
      flightDoneAt: this.flightDoneAt,
      ...this.killcam.snapshot(),
      oracle: this.oracle.snapshot(),
      stands: this.stands.snapshot(),
      crowd: this.crowd.snapshot(),
    };
  }

  restoreSnapshot(snapshot: ClassicSnapshot): void {
    if (snapshot.world.ships.length !== snapshot.players.length) return;
    this.settings = snapshot.settings;
    this.mayhem = snapshot.mayhem ?? null;
    this.revealEnd = snapshot.revealEnd ?? 0;
    this.revealHeld = snapshot.revealHeld ?? false;
    this.mayhemHistory = snapshot.mayhemHistory ?? [];
    this.phase = snapshot.phase;
    this.phaseTime = snapshot.phaseTime;
    this.clock = snapshot.clock;
    this.round = snapshot.round;
    this.worldSeed = snapshot.worldSeed ?? 0;
    this.totalRounds = snapshot.totalRounds;
    this.hiddenPlanets = snapshot.hiddenPlanets;
    this.teamMode = snapshot.teamMode;
    this.teamCursor = snapshot.teamCursor;
    this.memberCursor = [...snapshot.memberCursor];
    this.players = snapshot.players.map((player) => ({ ...player }));
    this.current = snapshot.current;
    this.world = snapshot.world;
    this.trails = snapshot.trails;
    this.pickups = snapshot.pickups ?? [];
    this.power.restoreState(snapshot.power);
    this.killFeed = snapshot.killFeed;
    this.lastKill = snapshot.lastKill;
    this.summary = snapshot.summary;
    this.notice = snapshot.notice;
    this.roundStats = snapshot.roundStats;
    this.matchStats = snapshot.matchStats;
    this.scoreHistory = snapshot.scoreHistory;
    this.skipVote = snapshot.skipVote ?? null;
    this.planClock = snapshot.planClock;
    this.passes = snapshot.passes ?? 0;
    this.fired = new Set(snapshot.fired ?? []);
    this.suddenDeathKind = snapshot.suddenDeathKind ?? this.suddenDeathKinds[0];
    this.environmentDecided = snapshot.environmentDecided ?? false;
    this.drift = snapshot.drift ?? null;
    this.blasting = snapshot.blasting ?? false;
    this.finaleHold = snapshot.finaleHold ?? 0;
    this.doomedPlanets = snapshot.doomedPlanets ?? [];
    // Hosts from before the oracle send none.
    if (snapshot.oracle) this.oracle.restore(snapshot.oracle);
    if (snapshot.stands) this.stands.restore(snapshot.stands);
    this.crowd.restore(snapshot.crowd);
    this.volley = null;
    if (snapshot.volley) {
      const volley = new Volley(snapshot.world, snapshot.volley.aims, this.rules, true);
      volley.restore(snapshot.volley);
      this.volley = volley;
    }
    this.killcam.restore(snapshot, this.rules);
    this.restarted();
    this.flightDoneAt = snapshot.flightDoneAt ?? null;
  }

  /** Team mode: which team shoots next, and per team the member who shot last. */
  private teamCursor = 0;
  private memberCursor: number[] = [];

  // Simultaneous shots: everybody aims (the humans one after another at a shared keyboard, online all at once), then all fire.
  private planClock: number = HORIZON.SHOT_CLOCK;
  private queue: number[] = [];
  private salvoNo = 0;

  /** The ships that have fired in the pass under way, and the passes the round has had (a pass: every ship still in has shot). */
  private fired = new Set<number>();
  protected passes = 0;
  /** Sudden death: the kind this round gets (drawn from the round's seed), and whether it, not a player, decided the round. */
  protected suddenDeathKind: SuddenDeathKind = 'gravity';
  protected environmentDecided = false;
  /** Sudden death, collision course: where each ship drifts from and to while the pass's drift plays (the 'orbit' phase). */
  private drift: DriftMove[] | null = null;
  /** A finale of sudden death is playing (a supernova's shockwave, a meteor shower): the round ends once `finaleHold` seconds have gone by. */
  blasting = false;
  protected finaleHold = 0;
  private doomedPlanets: { seed: number; at: number }[] = [];

  /** The kinds of sudden death a round of this mode draws from. */
  protected get suddenDeathKinds(): readonly SuddenDeathKind[] {
    // The shower's bent paths would show where the planets are.
    return this.hiddenPlanets ? ['gravity', 'collision', 'overcharge', 'ufos'] : ['gravity', 'collision', 'overcharge', 'meteors', 'ufos'];
  }

  /** How many passes into sudden death the round is (1 the pass it sets in), or 0 before then or without the rule. */
  protected get suddenDeathStep(): number {
    return this.settings.suddenDeath ? Math.max(0, this.passes - SUDDEN_DEATH.START_PASS + 1) : 0;
  }

  /** Passes left before sudden death sets in (0 once it has), or null when the room plays without it. */
  get suddenDeathIn(): number | null {
    if (!this.settings.suddenDeath) return null;
    return Math.max(0, SUDDEN_DEATH.START_PASS - this.passes);
  }

  get salvo(): boolean {
    return this.settings.simultaneousShots;
  }

  /** Online salvos have no turns: everyone who hasn't locked in may aim. */
  canAim(id: number): boolean {
    if (this.replaying) return false;
    if (!(this.salvo && this.simultaneous)) return super.canAim(id);
    const p = this.players[id];
    return this.phase === 'aiming' && !!p && p.alive && !p.away && !p.cpu && !p.locked;
  }

  get shotClock(): number | null {
    if (!this.salvo || this.phase !== 'aiming') return null;
    const aiming = this.simultaneous ? this.players.some((p) => this.canAim(p.id)) : this.isHumanTurn;
    return aiming ? Math.max(0, this.planClock) : null;
  }

  get rules(): ShotRules {
    return { bounce: this.settings.bounce, timeLimit: this.settings.shotTime };
  }

  protected get stylePays(): boolean {
    return this.settings.styleBonuses;
  }

  protected get survivorBonus(): number {
    // In a duel the survivor is simply the one who scored the hit — no extra bonus there.
    return this.players.length > 2 ? SCORING.SURVIVOR : 0;
  }

  protected beginRound(): void {
    this.fired.clear();
    this.passes = 0;
    this.environmentDecided = false;
    this.drift = null;
    this.blasting = false;
    this.doomedPlanets = [];
    // Its own stream, so the draw never changes what the world's generator, the storm or the twists draw.
    this.suddenDeathKind = pick(createRng(this.worldSeed ^ SUDDEN_DEATH.SALT), this.suddenDeathKinds);
    if (this.salvo) {
      this.salvoNo = 0;
      return this.startPlanning();
    }
    // Rotate who opens each round.
    if (this.teamMode) {
      this.teamCursor = (this.round - 1) % this.teamMode;
      this.memberCursor = new Array(this.teamMode).fill(-1);
      this.giveTeamTurn();
    } else {
      this.giveTurn((this.round - 1) % this.players.length);
    }
  }

  commit(): void {
    if (this.skipReveal()) return;
    // The fire key during a flight: an armed splitter forks the shot.
    if (this.phase === 'flying') {
      this.splitInFlight(this.viewer ?? this.current);
      return;
    }
    // While a ship aims a teleport or a black hole, fire places it; the placement spends its shot, so it shoots nothing after.
    const by = this.viewer ?? this.current;
    if (this.placingFor(by)) {
      if (this.confirmPlacement(by)) this.spend(by);
      return;
    }
    if (!this.isHumanTurn) return;
    if (this.salvo || !this.betWindowDone) this.lock(this.current);
    else this.fire();
  }

  adjustPlayer(id: number, dAngle: number, dPower: number): void {
    if (!this.canAim(id)) return;
    const player = this.players[id];
    this.setPlayerAim(id, player.angle + dAngle, player.power + dPower);
  }

  setPlayerAim(id: number, angle: number, power: number): void {
    if (!this.canAim(id)) return;
    const player = this.players[id];
    player.angle = ((angle % 360) + 360) % 360;
    if (!this.settings.fixedPower) player.power = Math.min(this.settings.maxPower, Math.max(AIM.MIN_POWER, power));
  }

  commitPlayer(id: number): void {
    if (this.skipReveal()) return;
    // The fire key during a flight: an armed splitter forks the shot.
    if (this.phase === 'flying') {
      this.splitInFlight(id);
      return;
    }
    if (!this.canAim(id)) return;
    // While a ship aims a teleport or a black hole, fire places it; the placement spends its shot, so it shoots nothing after.
    if (this.placingFor(id)) {
      if (this.confirmPlacement(id)) this.spend(id);
      return;
    }
    if (this.salvo || !this.betWindowDone) this.lock(id);
    else this.fire();
  }

  /** The ship spent its shot on a teleport: it fires nothing, and the turn moves on. */
  private spend(id: number): void {
    this.players[id].passed = true;
    this.lock(id);
  }

  // ————————————————————————————— Simultaneous shots —————————————————————————————

  private startPlanning(): void {
    this.salvoNo++;
    const alive = this.alive;
    for (const p of alive) {
      p.locked = false;
      p.passed = false;
    }
    // Rotate who aims first so nobody always waits last.
    const start = (this.round + this.salvoNo) % alive.length;
    const order = [...alive.slice(start), ...alive.slice(0, start)];
    this.queue = this.simultaneous ? [] : order.filter((p) => !p.cpu).map((p) => p.id);
    this.cpuJobs.clear();
    this.setPhase('aiming');
    this.openOracle('salvo');
    if (this.simultaneous) {
      this.current = -1;
      this.planClock = HORIZON.SIMULTANEOUS_CLOCK;
    } else {
      this.nextHuman();
    }
  }

  private nextHuman(): void {
    this.current = this.queue.shift() ?? -1;
    this.planClock = HORIZON.SHOT_CLOCK;
    if (this.current >= 0) this.emit({ type: 'turn', player: this.current });
  }

  private lock(id: number): void {
    this.players[id].locked = true;
    this.emit({ type: 'lock', player: id });
    if (this.salvo && !this.simultaneous) this.nextHuman();
  }

  private updatePlanning(dt: number): void {
    const cpus = this.alive.filter((p) => p.cpu && !p.locked);
    if (cpus.length) {
      // All CPUs think in parallel while the humans aim.
      this.runCpu(cpus.map((p) => p.id), 8, 0.8);
      for (const p of cpus) {
        const job = this.cpuJob(p.id);
        if (this.cpuRescueIfBlind(p, job)) continue;
        const place = this.cpuPlacementAim(p);
        if (place && !job?.placeFailed && this.phaseTime >= 0.5) {
          // It lays the placement once its aim is on the spot; the placement spends its shot, so it fires nothing.
          if (!this.swingTowards(p, place, dt, 2)) continue;
          if (this.placeForCpu(p.id)) {
            p.passed = true;
            p.locked = true;
            this.emit({ type: 'lock', player: p.id });
            continue;
          }
          // Nowhere to lay it this volley: it keeps the power-up and aims a shot instead.
          if (job) job.placeFailed = true;
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
        this.planClock -= dt;
        if (this.planClock <= 0) for (const p of waiting) this.lock(p.id);
      }
    } else if (this.current >= 0) {
      this.planClock -= dt;
      if (this.planClock <= 0) this.commit();
    }
    // With every ship still in off the field (their people away), the volley waits for them rather than flying empty.
    if (this.alive.length && this.alive.every((p) => p.locked) && this.phaseTime > 0.6 && this.betWindowDone) this.launchVolley();
  }

  protected playTurn(turn: ReplayTurn): void {
    if (this.salvo) {
      if (this.stageTurn(turn, this.alive)) this.launchVolley();
      return;
    }
    // One ship's turn: the recording has a shot of theirs or none.
    const p = this.players[this.current];
    if (turn.shots.some((shot) => shot.player !== p.id)) {
      this.replayState = 'drifted';
      return;
    }
    if (this.stageTurn(turn, [p])) this.fire();
  }

  private launchVolley(): void {
    this.makeHeldPlacements();
    const aims = this.alive.filter((p) => !p.passed).flatMap((p) => this.aimsFor(p));
    for (const p of this.alive) if (!p.passed) p.shots++;
    this.notice = { text: t('notice.volley'), color: COLORS.bone, at: this.clock };
    this.emit({ type: 'volley' });
    this.launch(aims, true);
  }

  private fire(): void {
    const p = this.players[this.current];
    p.locked = false;
    // A ship that spent its shot on a teleport fires nothing; the turn still moves on.
    const aims = p.passed ? [] : this.aimsFor(p);
    if (!p.passed) p.shots++;
    p.passed = false;
    // Trick shots are always tracked (the scorecard counts them); they only pay points when the option is on.
    this.launch(aims, true);
  }

  protected updatePhase(dt: number): void {
    if (this.phase === 'orbit') return this.blasting ? this.updateFinale() : this.updateDrift();
    if (this.phase !== 'aiming') return;
    if (this.salvo) return this.updatePlanning(dt);
    if (this.current < 0) return;
    const p = this.players[this.current];
    if (p.locked) {
      if (this.betWindowDone) this.fire();
      return;
    }
    if (!p.cpu) return;
    this.runCpu([p.id], 6, 1);
    const job = this.cpuJob(p.id);
    if (this.cpuRescueIfBlind(p, job)) return;
    const place = this.cpuPlacementAim(p);
    if (place && !job?.placeFailed && this.phaseTime >= 0.7) {
      // It lays the placement once its aim is on the spot; the placement spends its shot, so the turn moves on.
      if (!this.swingTowards(p, place, dt)) return;
      if (this.placeForCpu(p.id)) {
        this.spend(p.id);
        return;
      }
      // Nowhere to lay it this turn: it keeps the power-up and shoots instead.
      if (job) job.placeFailed = true;
    }
    if (!job?.target || this.phaseTime < 0.7) return;
    if (this.swingTowards(p, job.target, dt)) {
      job.settle += dt;
      if (job.settle > 0.35) this.fire();
    }
  }

  protected afterVolley(): void {
    if (this.decided) return this.endRound();
    if (this.passOver() && this.endPass()) return;
    this.nextTurn();
  }

  /** Whether this volley finished a pass: everybody still in has had a shot (with simultaneous shots, every volley does). */
  private passOver(): boolean {
    if (this.salvo) for (const p of this.alive) this.fired.add(p.id);
    else this.fired.add(this.current);
    if (this.alive.some((p) => !this.fired.has(p.id))) return false;
    this.fired.clear();
    this.passes++;
    return true;
  }

  /**
   * A pass is over. True when the mode moves the round on by itself (a Solar System turns first, a finale plays).
   * Sudden death is announced as it sets in, steps up every pass, and after its last pass plays its finale, if its kind has one.
   */
  protected endPass(): boolean {
    const step = this.suddenDeathStep;
    if (!step) return false;
    if (step === 1) this.announceSuddenDeath();
    this.suddenDeathPass(step);
    if (step === SUDDEN_DEATH.FINALE_STEP && this.finale()) return true;
    return this.startDrift();
  }

  private announceSuddenDeath(): void {
    this.notice = { text: t(`notice.${this.suddenDeathKind}`), color: COLORS.danger, at: this.clock };
    this.emit({ type: 'suddenDeath', kind: this.suddenDeathKind });
  }

  /** Sudden death's `step`th pass is over: it grows stronger. */
  protected suddenDeathPass(step: number): void {
    if (this.suddenDeathKind === 'gravity') this.tightenPull(step);
    else if (this.suddenDeathKind === 'collision') this.planDrift(step);
    else if (this.suddenDeathKind === 'overcharge') this.chargeUp(step);
  }

  /** Sudden death's last pass is over. True when a finale plays that ends the round; the gravity well has none. */
  protected finale(): boolean {
    if (this.suddenDeathKind === 'meteors') this.meteorShower();
    else if (this.suddenDeathKind === 'ufos') this.ufoInvasion();
    else return false;
    return true;
  }

  /**
   * The finale of the meteor shower: a meteor flies in at every ship still in and at every planet (the paths are drawn
   * from the round's seed), and the round ends without a winner once the last has landed. The ships are out at once;
   * each planet is gone, and the screen blows each one up, as its meteor gets there.
   */
  private meteorShower(): void {
    const paths = planMeteors(this.world, this.alive.map((p) => p.id), createRng(this.worldSeed ^ SUDDEN_DEATH.METEORS.SALT));
    this.emit({ type: 'meteors', paths: paths.map((path) => ({ ship: path.ship, planet: this.planetFor(path.planet), angle: this.angleOf(path.ship), delay: path.delay, points: path.points })) });
    this.endInFinale('meteor', paths.map((path) => ({ planet: path.planet, at: landing(path) })), SUDDEN_DEATH.METEORS.HOLD);
  }

  /** The finale of the UFO invasion: a saucer settles by every ship still in and zaps it, and one more for every planet zaps that; the round ends once the last has. */
  private ufoInvasion(): void {
    const paths = planUfos(this.world, this.alive.map((p) => p.id), createRng(this.worldSeed ^ SUDDEN_DEATH.UFOS.SALT));
    this.emit({ type: 'ufos', paths: paths.map((path) => ({ ship: path.ship, planet: this.planetFor(path.planet), angle: this.angleOf(path.ship), delay: path.delay, points: path.points, charge: path.charge, target: path.target })) });
    this.endInFinale('ufo', paths.map((path) => ({ planet: path.planet, at: zapAt(path) })), SUDDEN_DEATH.UFOS.HOLD);
  }

  /** What the screen needs to blow up planet number `index`, or null for none. */
  private planetFor(index: number | null): FinalePlanet | null {
    const planet = index === null ? undefined : this.world.planets[index];
    return planet ? { x: planet.x, y: planet.y, radius: planet.radius, color: planet.tint } : null;
  }

  /** The way a ship points (the screen draws it as it is taken), or 0 for no ship. */
  private angleOf(ship: number | null): number {
    return ship === null ? 0 : this.players[ship].angle;
  }

  /**
   * A finale takes every ship still in at once, and every planet as its `strikes` land (`at` seconds into it); the round is
   * held `hold` seconds after the last, so it can be watched to the end.
   */
  private endInFinale(source: KillSource, strikes: { planet: number | null; at: number }[], hold: number): void {
    for (const p of this.alive) this.takeShip(p.id, source);
    this.doomedPlanets = strikes.flatMap((s) => (s.planet === null ? [] : [{ seed: this.world.planets[s.planet].seed, at: s.at }]));
    this.finaleHold = Math.max(0, ...strikes.map((s) => s.at)) + hold;
    this.blasting = true;
    this.setPhase('orbit');
  }

  /** The finale plays on: each planet whose strike has landed is gone (and the cannons on it), and the round ends once the hold is over. */
  private updateFinale(): void {
    const gone = this.doomedPlanets.filter((d) => d.at <= this.phaseTime);
    if (gone.length) {
      this.doomedPlanets = this.doomedPlanets.filter((d) => !gone.includes(d));
      this.world.planets = this.world.planets.filter((p) => !gone.some((d) => d.seed === p.seed));
      this.world.defenses = this.world.defenses.filter((d) => this.world.planets.some((p) => p.seed === d.planet));
      this.world.version++;
    }
    if (this.phaseTime < this.finaleHold) return;
    this.blasting = false;
    this.endRound();
  }

  /** Passes left before this round's finale plays, once sudden death has set in (null for a kind with none, or before then). */
  get finaleIn(): number | null {
    const step = this.suddenDeathStep;
    if ((this.suddenDeathKind !== 'meteors' && this.suddenDeathKind !== 'ufos') || !step) return null;
    return Math.max(0, SUDDEN_DEATH.FINALE_STEP - step);
  }

  /** This round's kind of sudden death (the HUD names what its countdown is for). */
  get suddenDeathType(): SuddenDeathKind {
    return this.suddenDeathKind;
  }

  /** Sudden death took the ship, not a player: no points either way, and if that decides the round, nobody wins it. */
  protected takeShip(id: number, source: KillSource): void {
    this.players[id].alive = false;
    this.world.ships[id].alive = false;
    if (this.decided) this.environmentDecided = true;
    this.recordKill({ killer: null, victim: id, points: 0, self: false, friendly: false, source, combo: [], multiplier: 1, shots: 0, power: 0, at: this.clock });
  }

  protected get noWinner(): boolean {
    return this.environmentDecided;
  }

  /** Whether sudden death, not a player, has decided the round (the HUD then says nobody wins it). */
  get decidedBySuddenDeath(): boolean {
    return this.environmentDecided;
  }

  /** The next turn, or the next volley's aiming. */
  protected nextTurn(): void {
    if (this.salvo) return this.startPlanning();
    if (this.teamMode) this.giveTeamTurn();
    else this.giveTurn(this.current + 1);
  }

  /** Sudden death: every ship pulls its enemies' shots in, a little harder each pass, up to a limit. */
  private tightenPull(step: number): void {
    const pull = Math.min(step, SUDDEN_DEATH.PULL_STEPS) * SUDDEN_DEATH.PULL_STEP;
    for (const p of this.players) {
      const ship = this.world.ships[p.id];
      ship.pull = pull;
      ship.team = p.team;
    }
  }

  /** Sudden death, overcharge: every ship's hit zone reaches a little further than the pass before, up to a limit. */
  private chargeUp(step: number): void {
    const reach = Math.min(step, SUDDEN_DEATH.OVERCHARGE.STEPS) * SUDDEN_DEATH.OVERCHARGE.REACH_STEP;
    for (const ship of this.world.ships) ship.reach = reach;
  }

  /** Sudden death, collision course: the ships still in drift together a little further. Nothing moves once they can get no closer. */
  private planDrift(step: number): void {
    const moves = planCollision(this.world, this.alive.map((p) => p.id), step).filter((m) => Math.hypot(m.toX - m.fromX, m.toY - m.fromY) > 0.5);
    this.drift = moves.length ? moves : null;
  }

  /** The drift is played as the pass's turn, in the 'orbit' phase. True when there is one. */
  private startDrift(): boolean {
    if (!this.drift) return false;
    // The shots' trails point at where the ships were: they would mislead.
    this.trails = [];
    this.setPhase('orbit');
    return true;
  }

  /** Whether the ships are drifting together right now (the HUD says so). */
  get adrift(): boolean {
    return this.drift !== null;
  }

  private updateDrift(): void {
    const moves = this.drift;
    if (!moves) return this.nextTurn();
    const k = Math.min(1, this.phaseTime / SUDDEN_DEATH.COLLISION.DRIFT_TIME);
    const eased = k * k * (3 - 2 * k);
    for (const m of moves) {
      if (!this.players[m.id].alive) continue;
      const ship = this.world.ships[m.id];
      ship.x = m.fromX + (m.toX - m.fromX) * eased;
      ship.y = m.fromY + (m.toY - m.fromY) * eased;
    }
    if (k < 1) return;
    this.drift = null;
    if (this.decided) this.endRound();
    else this.nextTurn();
  }

  /** Dev and tests: gives the round this kind of sudden death, whatever its seed drew. */
  debugSuddenDeath(kind: SuddenDeathKind): void {
    this.suddenDeathKind = kind;
  }

  /** Dev and tests: ends the pass under way as if every ship still in had fired, `passes` passes into the round. */
  debugEndPass(passes = this.passes + 1): void {
    this.passes = passes - 1;
    for (const p of this.alive) this.fired.add(p.id);
    this.afterVolley();
  }

  protected passTurnOf(id: number): void {
    // A salvo waits for the ships still in; the one that left (or is away) is not among them.
    if (this.salvo) super.passTurnOf(id);
    else if (this.current === id) this.afterVolley();
  }

  protected giveTurnBackTo(id: number): void {
    if (this.salvo) super.giveTurnBackTo(id);
    // The turn was waiting with somebody else who dropped out (nobody on the field could take it): whoever is back takes it.
    else if (this.players[this.current]?.away) this.takeTurn(id);
  }

  protected volleyQueue(): number[] | null {
    return this.salvo && !this.simultaneous ? this.queue : null;
  }

  protected nextInQueue(): void {
    this.nextHuman();
  }

  /**
   * Free for all: hand the turn to the next living player starting at `from`, passing over those who
   * dropped out. When nobody else is there to shoot, the turn waits with one of them.
   */
  private giveTurn(from: number): void {
    const n = this.players.length;
    for (const passOver of [true, false]) {
      for (let i = 0; i < n; i++) {
        const id = (from + i) % n;
        const p = this.players[id];
        if (p.alive && !(passOver && p.away)) return this.setTurn(id);
      }
    }
  }

  /**
   * Team mode: teams take turns (a small team shoots as often as a big one), and within a
   * team the living members rotate.
   */
  private giveTeamTurn(): void {
    // As in a free for all: those who dropped out are passed over while anybody else can shoot.
    for (const passOver of [true, false]) {
      for (let k = 0; k < this.teamMode; k++) {
        const team = (this.teamCursor + k) % this.teamMode;
        const members = this.players.filter((p) => p.team === team);
        for (let i = 1; i <= members.length; i++) {
          const idx = (this.memberCursor[team] + i) % members.length;
          if (!members[idx].alive || (passOver && members[idx].away)) continue;
          return this.takeTurn(members[idx].id);
        }
      }
    }
  }

  /** This ship takes the turn; in team mode its team and its place in the team are where the rotation goes on from. */
  private takeTurn(id: number): void {
    const team = this.players[id].team;
    if (this.teamMode && team !== null) {
      this.memberCursor[team] = this.players.filter((p) => p.team === team).findIndex((p) => p.id === id);
      this.teamCursor = (team + 1) % this.teamMode;
    }
    this.setTurn(id);
  }

  private setTurn(id: number): void {
    this.players[id].locked = false;
    this.current = id;
    this.setPhase('aiming');
    // A CPU shoots within a second or two — too quick to tip on.
    if (this.players[id].cpu) {
      this.oracle.close();
      this.stands.close();
    }
    else this.openOracle('shot', id);
    this.emit({ type: 'turn', player: id });
  }

  protected killPoints(vs: VolleyShot): { points: number; combo: StyleKind[]; multiplier: number } {
    const shooter = this.players[vs.owner];
    const combo = this.settings.styleBonuses ? (vs.shot.style ?? []).map((e) => e.kind) : [];
    const { points, multiplier } = scoreChallengeHit(shooter.shots, vs.shot.power, this.settings.fixedPower, combo);
    return { points, combo, multiplier };
  }

  protected roundTitle(survivor: number | null): RoundTitle {
    if (this.environmentDecided && (this.suddenDeathKind === 'meteors' || this.suddenDeathKind === 'ufos')) return this.suddenDeathKind;
    // Only a volley can take every ship down at once.
    if (survivor === null) return 'noneLeft';
    return this.lastKill?.self ? 'selfHit' : 'hit';
  }
}
