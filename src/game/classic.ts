import type { ShotRules, StyleKind, World } from '../physics';
import { scoreChallengeHit } from '../scoring';
import { SCORING } from '../config';
import { Volley, type VolleyShot } from '../volley';
import { Match, type RoundTitle } from './match';

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
    this.volley = null;
    if (snapshot.volley) {
      const volley = new Volley(snapshot.world, snapshot.volley.aims, this.rules, false);
      volley.restore(snapshot.volley);
      this.volley = volley;
    }
  }

  /** Team mode: which team shoots next, and per team the member who shot last. */
  private teamCursor = 0;
  private memberCursor: number[] = [];

  get rules(): ShotRules {
    return { bounce: this.settings.bounce, timeLimit: this.settings.shotTime };
  }

  protected get survivorBonus(): number {
    // In a duel the survivor is simply the one who scored the hit — no extra bonus there.
    return this.players.length > 2 ? SCORING.SURVIVOR : 0;
  }

  protected beginRound(): void {
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
    if (this.isHumanTurn) this.fire();
  }

  adjustPlayer(id: number, dAngle: number, dPower: number): void {
    if (this.phase !== 'aiming' || this.current !== id || this.players[id]?.cpu) return;
    const player = this.players[id];
    this.setPlayerAim(id, player.angle + dAngle, player.power + dPower);
  }

  setPlayerAim(id: number, angle: number, power: number): void {
    if (this.phase !== 'aiming' || this.current !== id || this.players[id]?.cpu) return;
    const player = this.players[id];
    player.angle = ((angle % 360) + 360) % 360;
    if (!this.settings.fixedPower) player.power = Math.min(100, Math.max(0, power));
  }

  commitPlayer(id: number): void {
    if (this.phase === 'aiming' && this.current === id && !this.players[id]?.cpu) this.fire();
  }

  private fire(): void {
    const p = this.players[this.current];
    p.shots++;
    this.launch([{ player: p.id, angle: p.angle, power: p.power }], this.settings.styleBonuses);
  }

  protected updatePhase(dt: number): void {
    if (this.phase !== 'aiming' || this.current < 0) return;
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
    this.emit({ type: 'turn', player: id });
  }

  protected killPoints(vs: VolleyShot): { points: number; combo: StyleKind[]; multiplier: number } {
    const shooter = this.players[vs.owner];
    // Without the option no trick shots are tracked, so this is the plain hit score.
    const combo = (vs.shot.style ?? []).map((e) => e.kind);
    const { points, multiplier } = scoreChallengeHit(shooter.shots, vs.shot.power, this.settings.fixedPower, combo);
    return { points, combo, multiplier };
  }

  protected roundTitle(): RoundTitle {
    return this.lastKill?.self ? 'selfHit' : 'hit';
  }
}
