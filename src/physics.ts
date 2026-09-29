import { PHYSICS } from './config';

export type PlanetStyle = 'rocky' | 'gas' | 'ice';

export interface Planet {
  x: number;
  y: number;
  radius: number;
  mass: number;
  /** Purely visual — texture seed, look and tint. */
  seed: number;
  style: PlanetStyle;
  tint: string;
}

export interface Ship {
  x: number;
  y: number;
}

export interface World {
  width: number;
  height: number;
  planets: Planet[];
  ships: [Ship, Ship];
}

export interface ShotRules {
  bounce: boolean;
  /** Seconds of flight before a shot fizzles out. */
  timeLimit: number;
}

export type ShotEnd =
  | { kind: 'ship'; ship: 0 | 1 }
  | { kind: 'planet'; planet: number }
  | { kind: 'lost' }
  | { kind: 'timeout' };

/** Unit vector of an aim angle. 0° points right, angles grow counter-clockwise (screen y points down). */
export function aimDirection(angleDeg: number): { x: number; y: number } {
  const a = (angleDeg * Math.PI) / 180;
  return { x: Math.cos(a), y: -Math.sin(a) };
}

export function normalizeAngle(deg: number): number {
  const a = deg % 360;
  return a < 0 ? a + 360 : a;
}

/**
 * One projectile, advanced in fixed steps with semi-implicit Euler (stable for orbits).
 * Both the live game and the CPU planner drive this class, so what the CPU predicts is exactly what flies.
 */
export class Shot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  time = 0;
  end: ShotEnd | null = null;

  constructor(
    private readonly world: World,
    readonly shooter: 0 | 1,
    readonly angle: number,
    readonly power: number,
    private readonly rules: ShotRules,
  ) {
    const ship = world.ships[shooter];
    const dir = aimDirection(angle);
    const speed = power * PHYSICS.SPEED_PER_POWER;
    this.x = ship.x + dir.x * PHYSICS.MUZZLE;
    this.y = ship.y + dir.y * PHYSICS.MUZZLE;
    this.vx = dir.x * speed;
    this.vy = dir.y * speed;
  }

  /** Advance one physics step. Returns the end state once the shot is over. */
  step(): ShotEnd | null {
    if (this.end) return this.end;
    const dt = PHYSICS.DT;
    const { planets, ships, width, height } = this.world;

    let ax = 0;
    let ay = 0;
    for (const p of planets) {
      const dx = p.x - this.x;
      const dy = p.y - this.y;
      const d2 = dx * dx + dy * dy;
      const d = Math.sqrt(d2);
      const a = (PHYSICS.G * p.mass) / d2;
      ax += (a * dx) / d;
      ay += (a * dy) / d;
    }
    this.vx += ax * dt;
    this.vy += ay * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.time += dt;

    if (this.rules.bounce) {
      if (this.x < 0) { this.x = -this.x; this.vx = -this.vx; }
      else if (this.x > width) { this.x = 2 * width - this.x; this.vx = -this.vx; }
      if (this.y < 0) { this.y = -this.y; this.vy = -this.vy; }
      else if (this.y > height) { this.y = 2 * height - this.y; this.vy = -this.vy; }
    }

    const r2 = PHYSICS.SHIP_RADIUS * PHYSICS.SHIP_RADIUS;
    for (let i = 0; i < 2; i++) {
      const s = ships[i];
      const dx = s.x - this.x;
      const dy = s.y - this.y;
      if (dx * dx + dy * dy < r2) return (this.end = { kind: 'ship', ship: i as 0 | 1 });
    }
    for (let i = 0; i < planets.length; i++) {
      const p = planets[i];
      const dx = p.x - this.x;
      const dy = p.y - this.y;
      if (dx * dx + dy * dy < p.radius * p.radius) return (this.end = { kind: 'planet', planet: i });
    }
    const m = PHYSICS.OUT_MARGIN;
    if (this.x < -m || this.x > width + m || this.y < -m || this.y > height + m) {
      return (this.end = { kind: 'lost' });
    }
    if (this.time >= this.rules.timeLimit) return (this.end = { kind: 'timeout' });
    return null;
  }

  get inField(): boolean {
    return this.x >= 0 && this.x <= this.world.width && this.y >= 0 && this.y <= this.world.height;
  }
}

export interface ShotOutcome {
  end: ShotEnd;
  /** Closest approach to the opponent's ship centre. */
  closest: number;
}

/** Fly a shot to completion without rendering (used by the CPU and tests). */
export function simulateShot(
  world: World,
  shooter: 0 | 1,
  angle: number,
  power: number,
  rules: ShotRules,
): ShotOutcome {
  const shot = new Shot(world, shooter, angle, power, rules);
  const target = world.ships[shooter === 0 ? 1 : 0];
  let closest = Infinity;
  let end: ShotEnd | null = null;
  while (!end) {
    end = shot.step();
    const dx = target.x - shot.x;
    const dy = target.y - shot.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < closest) closest = d;
  }
  return { end, closest };
}
