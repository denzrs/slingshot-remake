import { buildSector, type Sector, type SectorSpec } from './challenge';
import { AIM, GHOST, PHYSICS } from './config';
import { cloneWorld, normalizeAngle, Shot, type World } from './physics';
import { createRng, hashSeed } from './rng';

/**
 * The ghost lane: a tiny range of one-target sectors for eliminated players. Everything here is a
 * pure function of a seed, so every ghost of a round flies the very same lanes — and the seed is
 * derived from the round's world, which every screen has, so nothing needs to travel the network.
 */

/** The seed all screens of one round share: the round number and the world as it was dealt. */
export function ghostSeed(round: number, world: World): number {
  return hashSeed('slingshot-ghost', round, ...world.planets.map((p) => p.seed), ...world.ships.map((s) => `${Math.round(s.x)},${Math.round(s.y)}`));
}

/** Lane `n` (0-based) of a seed: two or three planets and a target, a little harder every second lane. */
export function laneSpec(seed: number, n: number): SectorSpec {
  const difficulty = Math.min(3, 1 + Math.floor(n / 2)) as SectorSpec['difficulty'];
  return {
    index: n,
    seed: hashSeed('slingshot-ghost-lane', seed, n),
    difficulty,
    targets: 1,
    planets: [2, 3],
    shots: GHOST.SHOTS,
    bounce: false,
    invisible: false,
    fixedPower: false,
    hole: false,
    gravity: 1,
  };
}

/** The ghost's ship is ship 0, the target ship 1. */
const TARGET = 1;
/** Physics steps between two recorded trail points. */
const TRAIL_EVERY = 6;

export type LanePhase = 'aiming' | 'flying' | 'cleared' | 'failed';

export interface LaneResult {
  /** Rises with every shot, so a screen can tell a new result from one it already showed. */
  id: number;
  kind: 'hit' | 'near' | 'miss' | 'out';
  points: number;
  swingbys: number;
  /** Lanes cleared in a row, this one included. */
  streak: number;
  multiplier: number;
  /** Picks one of a few sayings, the same for everybody. */
  quip: number;
}

export class GhostLane {
  /** 0-based number of the lane on the range. */
  lane = 0;
  score = 0;
  /** Lanes cleared in a row; a lane lost resets it. */
  streak = 0;
  bestStreak = 0;
  cleared = 0;
  phase: LanePhase = 'aiming';
  angle = 0;
  power: number = AIM.DEFAULT_POWER;
  /** Shots fired on this lane. */
  shots = 0;
  result: LaneResult | null = null;
  /** The shot in the air, and the paths of this lane's earlier shots (flat [x, y, …]). */
  shot: Shot | null = null;
  path: number[] = [];
  oldPaths: number[][] = [];
  sector!: Sector;
  world!: World;

  private budget = 0;
  private pause = 0;
  private closest = Infinity;
  private resultId = 0;

  constructor(readonly seed: number) {
    this.build();
  }

  get target(): { x: number; y: number } {
    return this.world.ships[TARGET];
  }

  get shotsLeft(): number {
    return GHOST.SHOTS - this.shots;
  }

  get canAim(): boolean {
    return this.phase === 'aiming';
  }

  /** The multiplier the next cleared lane would earn. */
  get multiplier(): number {
    return multiplierFor(this.streak + 1);
  }

  adjust(dAngle: number, dPower: number): void {
    this.setAim(this.angle + dAngle, this.power + dPower);
  }

  setAim(angle: number, power: number): void {
    if (!this.canAim) return;
    this.angle = normalizeAngle(Math.round(angle * 100) / 100);
    this.power = Math.max(AIM.MIN_POWER, Math.min(AIM.MAX_POWER, Math.round(power * 100) / 100));
  }

  fire(): boolean {
    if (!this.canAim) return false;
    this.shots++;
    this.shot = new Shot(this.world, 0, this.angle, this.power, { bounce: false, timeLimit: GHOST.FLIGHT_TIME }, 'metrics', [0]);
    this.path = [this.shot.x, this.shot.y];
    this.closest = Infinity;
    this.budget = 0;
    this.phase = 'flying';
    return true;
  }

  update(dt: number): void {
    if (this.phase === 'flying' && this.shot) {
      this.budget += dt * GHOST.SPEED / PHYSICS.DT;
      let steps = 0;
      while (this.budget >= 1 && !this.shot.end) {
        this.budget--;
        this.shot.step();
        const target = this.target;
        this.closest = Math.min(this.closest, Math.hypot(target.x - this.shot.x, target.y - this.shot.y));
        if (++steps % TRAIL_EVERY === 0) this.path.push(this.shot.x, this.shot.y);
      }
      if (this.shot.end) this.land(this.shot);
    } else if (this.phase === 'cleared' || this.phase === 'failed') {
      this.pause -= dt;
      if (this.pause <= 0) this.next();
    }
  }

  private land(shot: Shot): void {
    this.path.push(shot.x, shot.y);
    const hit = shot.end?.kind === 'ship' && shot.end.ship === TARGET;
    const quip = Math.floor(createRng(hashSeed(this.seed, this.lane, this.shots))() * 997);
    this.shot = null;
    if (hit) {
      this.streak++;
      this.bestStreak = Math.max(this.bestStreak, this.streak);
      this.cleared++;
      const multiplier = multiplierFor(this.streak);
      const base = GHOST.HIT * (GHOST.SHOT_FACTOR[this.shots - 1] ?? 1) + GHOST.SWINGBY * shot.swingbys;
      const points = Math.round((base * multiplier) / 10) * 10;
      this.score += points;
      this.result = { id: ++this.resultId, kind: 'hit', points, swingbys: shot.swingbys, streak: this.streak, multiplier, quip };
      this.phase = 'cleared';
      this.pause = GHOST.PAUSE_CLEARED;
      return;
    }
    this.oldPaths.push(this.path);
    const out = this.shotsLeft <= 0;
    const kind = out ? 'out' : this.closest <= GHOST.NEAR ? 'near' : 'miss';
    if (out) this.streak = 0;
    this.result = { id: ++this.resultId, kind, points: 0, swingbys: 0, streak: this.streak, multiplier: this.multiplier, quip };
    this.phase = out ? 'failed' : 'aiming';
    if (out) this.pause = GHOST.PAUSE_FAILED;
  }

  private next(): void {
    this.lane++;
    this.build();
  }

  private build(): void {
    this.sector = buildSector(laneSpec(this.seed, this.lane));
    this.world = cloneWorld(this.sector.world);
    const from = this.world.ships[0];
    const to = this.world.ships[TARGET];
    // Start facing the target, like a ship in the real game faces the middle.
    this.angle = normalizeAngle(Math.round((Math.atan2(from.y - to.y, to.x - from.x) * 180) / Math.PI));
    this.power = AIM.DEFAULT_POWER;
    this.shots = 0;
    this.shot = null;
    this.path = [];
    this.oldPaths = [];
    this.phase = 'aiming';
  }
}

/** The multiplier of the `streak`-th lane cleared in a row. */
export function multiplierFor(streak: number): number {
  return Math.min(GHOST.MAX_MULTIPLIER, 1 + GHOST.STREAK_STEP * Math.max(0, streak - 1));
}
