import type { ShotRules, StyleKind, World } from '../physics';
import { scoreChallengeHit } from '../scoring';
import { AIM, COLORS, HORIZON, SCORING } from '../config';
import { t } from '../i18n';
import { Volley, type VolleyShot } from '../volley';
import { Match, type RoundTitle } from './match';
import type { OracleSnapshot } from './oracle';

export interface ClassicSnapshot {
  phase: Match['phase'];
  phaseTime: number;
  clock: number;
  round: number;
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
  killFeed: Match['killFeed'];
  lastKill: Match['lastKill'];
  summary: Match['summary'];
  notice: Match['notice'];
  settings: Match['settings'];
  roundStats: Match['roundStats'];
  matchStats: Match['matchStats'];
  scoreHistory: number[][];
  /** Simultaneous shots: seconds left to aim. */
  planClock: number;
  oracle: OracleSnapshot;
}

/**
 * The original game, extended to any number of ships: players take turns, one shot each.
 * A hit ship is out; the round ends when one ship — or one team — is left.
 */
export class ClassicMatch extends Match {
  readonly mode = 'classic';

  snapshot(): ClassicSnapshot {
    return {
      phase: this.phase,
      phaseTime: this.phaseTime,
      clock: this.clock,
      round: this.round,
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
      killFeed: this.killFeed,
      lastKill: this.lastKill,
      summary: this.summary,
      notice: this.notice,
      settings: this.settings,
      roundStats: this.roundStats,
      matchStats: this.matchStats,
      scoreHistory: this.scoreHistory,
      planClock: this.planClock,
      oracle: this.oracle.snapshot(),
    };
  }

  restoreSnapshot(snapshot: ClassicSnapshot): void {
    if (snapshot.world.ships.length !== snapshot.players.length) return;
    this.settings = snapshot.settings;
    this.phase = snapshot.phase;
    this.phaseTime = snapshot.phaseTime;
    this.clock = snapshot.clock;
    this.round = snapshot.round;
    this.totalRounds = snapshot.totalRounds;
    this.hiddenPlanets = snapshot.hiddenPlanets;
    this.teamMode = snapshot.teamMode;
    this.teamCursor = snapshot.teamCursor;
    this.memberCursor = [...snapshot.memberCursor];
    this.players = snapshot.players.map((player) => ({ ...player }));
    this.current = snapshot.current;
    this.world = snapshot.world;
    this.trails = snapshot.trails;
    this.killFeed = snapshot.killFeed;
    this.lastKill = snapshot.lastKill;
    this.summary = snapshot.summary;
    this.notice = snapshot.notice;
    this.roundStats = snapshot.roundStats;
    this.matchStats = snapshot.matchStats;
    this.scoreHistory = snapshot.scoreHistory;
    this.planClock = snapshot.planClock;
    // Hosts from before the oracle send none.
    if (snapshot.oracle) this.oracle.restore(snapshot.oracle);
    this.volley = null;
    if (snapshot.volley) {
      const volley = new Volley(snapshot.world, snapshot.volley.aims, this.rules, true);
      volley.restore(snapshot.volley);
      this.volley = volley;
    }
    this.restarted();
  }

  /** Team mode: which team shoots next, and per team the member who shot last. */
  private teamCursor = 0;
  private memberCursor: number[] = [];

  // Simultaneous shots: everybody aims (the humans one after another at a shared keyboard, online all at once), then all fire.
  private planClock: number = HORIZON.SHOT_CLOCK;
  private queue: number[] = [];
  private salvoNo = 0;

  get salvo(): boolean {
    return this.settings.simultaneousShots;
  }

  /** Online salvos have no turns: everyone who hasn't locked in may aim. */
  canAim(id: number): boolean {
    if (!(this.salvo && this.simultaneous)) return super.canAim(id);
    const p = this.players[id];
    return this.phase === 'aiming' && !!p && p.alive && !p.cpu && !p.locked;
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
    if (!this.isHumanTurn) return;
    if (this.salvo) this.lock(this.current);
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
    if (!this.canAim(id)) return;
    if (this.salvo) this.lock(id);
    else this.fire();
  }

  // ————————————————————————————— Simultaneous shots —————————————————————————————

  private startPlanning(): void {
    this.salvoNo++;
    const alive = this.alive;
    for (const p of alive) p.locked = false;
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
    if (!this.simultaneous) this.nextHuman();
  }

  private updatePlanning(dt: number): void {
    const cpus = this.alive.filter((p) => p.cpu && !p.locked);
    if (cpus.length) {
      // All CPUs think in parallel while the humans aim.
      this.runCpu(cpus.map((p) => p.id), 8, 0.8);
      for (const p of cpus) {
        const job = this.cpuJob(p.id);
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
    if (this.alive.every((p) => p.locked) && this.phaseTime > 0.6) this.launchVolley();
  }

  private launchVolley(): void {
    const aims = this.alive.map((p) => ({ player: p.id, angle: p.angle, power: p.power, spare: this.sparedFor(p.id) }));
    for (const p of this.alive) p.shots++;
    this.notice = { text: t('notice.volley'), color: COLORS.bone, at: this.clock };
    this.emit({ type: 'volley' });
    this.launch(aims, true);
  }

  private fire(): void {
    const p = this.players[this.current];
    const spare = this.sparedFor(p.id);
    p.shots++;
    // Trick shots are always tracked (the scorecard counts them); they only pay points when the option is on.
    this.launch([{ player: p.id, angle: p.angle, power: p.power, spare }], true);
  }

  protected updatePhase(dt: number): void {
    if (this.phase !== 'aiming') return;
    if (this.salvo) return this.updatePlanning(dt);
    if (this.current < 0) return;
    const p = this.players[this.current];
    if (!p.cpu) return;
    this.runCpu([p.id], 6, 1);
    const job = this.cpuJob(p.id);
    if (!job?.target || this.phaseTime < 0.7) return;
    if (this.swingTowards(p, job.target, dt)) {
      job.settle += dt;
      if (job.settle > 0.35) this.fire();
    }
  }

  protected afterVolley(): void {
    if (this.decided) return this.endRound();
    if (this.salvo) return this.startPlanning();
    if (this.teamMode) this.giveTeamTurn();
    else this.giveTurn(this.current + 1);
  }

  /** Free for all: hand the turn to the next living player starting at `from`. */
  private giveTurn(from: number): void {
    const n = this.players.length;
    for (let i = 0; i < n; i++) {
      const id = (from + i) % n;
      if (this.players[id].alive) return this.setTurn(id);
    }
  }

  /**
   * Team mode: teams take turns (a small team shoots as often as a big one), and within a
   * team the living members rotate.
   */
  private giveTeamTurn(): void {
    for (let k = 0; k < this.teamMode; k++) {
      const team = (this.teamCursor + k) % this.teamMode;
      const members = this.players.filter((p) => p.team === team);
      for (let i = 1; i <= members.length; i++) {
        const idx = (this.memberCursor[team] + i) % members.length;
        if (!members[idx].alive) continue;
        this.memberCursor[team] = idx;
        this.teamCursor = (team + 1) % this.teamMode;
        return this.setTurn(members[idx].id);
      }
    }
  }

  private setTurn(id: number): void {
    this.current = id;
    this.setPhase('aiming');
    // A CPU shoots within a second or two — too quick to tip on.
    if (this.players[id].cpu) this.oracle.close();
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
    // Only a volley can take every ship down at once.
    if (survivor === null) return 'noneLeft';
    return this.lastKill?.self ? 'selfHit' : 'hit';
  }
}
