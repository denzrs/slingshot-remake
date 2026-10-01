import { PHYSICS } from './config';

export type PlanetStyle = 'rocky' | 'gas' | 'ice';

export interface Planet {
  x: number;
  y: number;
  radius: number;
  mass: number;
  /** Purely visual — texture seed (also the planet's identity for render caches), look and tint. */
  seed: number;
  style: PlanetStyle;
  tint: string;
}

export interface Ship {
  x: number;
  y: number;
  alive: boolean;
}

export interface BlackHole {
  x: number;
  y: number;
  /** Event horizon: whatever crosses it is gone. */
  radius: number;
  mass: number;
}

export interface World {
  width: number;
  height: number;
  planets: Planet[];
  /** One ship per player, indexed like the players. */
  ships: Ship[];
  hole: BlackHole | null;
  /** Bumped whenever planets or the hole change, so cached render layers know to rebuild. */
  version: number;
}

export interface ShotRules {
  bounce: boolean;
  /** Seconds of flight before a shot fizzles out. */
  timeLimit: number;
}

export type ShotEnd =
  | { kind: 'ship'; ship: number }
  | { kind: 'planet'; planet: number }
  | { kind: 'hole' }
  | { kind: 'clash'; other: number }
  | { kind: 'lost' }
  | { kind: 'timeout' };

/** Trick-shot moments a projectile can rack up on its way. */
export type StyleKind = 'swingby' | 'bank' | 'graze' | 'photon' | 'airtime';

export interface StyleEvent {
  kind: StyleKind;
  x: number;
  y: number;
}

/** A pass counts as a swing-by once gravity has turned the shot by this much. */
const SWING_TURN = (40 * Math.PI) / 180;
/** Closer than this to a planet's surface (without touching) is a graze. */
const GRAZE_GAP = 5;
/** Flight time in seconds that earns the airtime bonus on a hit. */
const AIRTIME = 6;

interface Encounter {
  inside: boolean;
  /** Accumulated signed turn of the velocity while inside, radians. */
  turn: number;
  minGap: number;
  photons: number;
}

/** Unit vector of an aim angle. 0° points right, angles grow counter-clockwise (screen y points down). */
export function aimDirection(angleDeg: number): { x: number; y: number } {
  const a = (angleDeg * Math.PI) / 180;
  return { x: Math.cos(a), y: -Math.sin(a) };
}

export function normalizeAngle(deg: number): number {
  const a = deg % 360;
  return a < 0 ? a + 360 : a;
}

export function cloneWorld(w: World): World {
  return {
    ...w,
    planets: w.planets.map((p) => ({ ...p })),
    ships: w.ships.map((s) => ({ ...s })),
    hole: w.hole ? { ...w.hole } : null,
  };
}

/**
 * One projectile, advanced in fixed steps with semi-implicit Euler (stable for orbits).
 * The live game, the CPU planner and the killcam all drive this class, so a replay is exact.
 */
export class Shot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  time = 0;
  end: ShotEnd | null = null;
  /** Trick-shot log; null when not tracked (CPU planning skips it for speed). */
  readonly style: StyleEvent[] | null;
  /** One per planet, plus one for the black hole at the end. */
  private readonly encounters: Encounter[] | null;

  constructor(
    private readonly world: World,
    readonly shooter: number,
    readonly angle: number,
    readonly power: number,
    private readonly rules: ShotRules,
    trackStyle = false,
  ) {
    const ship = world.ships[shooter];
    const dir = aimDirection(angle);
    const speed = power * PHYSICS.SPEED_PER_POWER;
    this.x = ship.x + dir.x * PHYSICS.MUZZLE;
    this.y = ship.y + dir.y * PHYSICS.MUZZLE;
    this.vx = dir.x * speed;
    this.vy = dir.y * speed;
    this.style = trackStyle ? [] : null;
    this.encounters = trackStyle
      ? Array.from({ length: world.planets.length + 1 }, () => ({ inside: false, turn: 0, minGap: Infinity, photons: 0 }))
      : null;
  }

  /** End the shot from outside (e.g. two projectiles colliding). */
  terminate(end: ShotEnd): void {
    if (!this.end) this.end = end;
  }

  /** Advance one physics step. Returns the end state once the shot is over. */
  step(): ShotEnd | null {
    if (this.end) return this.end;
    const dt = PHYSICS.DT;
    const { planets, ships, hole, width, height } = this.world;
    const hx = this.vx;
    const hy = this.vy;

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
    if (hole) {
      const dx = hole.x - this.x;
      const dy = hole.y - this.y;
      const d2 = dx * dx + dy * dy;
      const d = Math.sqrt(d2);
      const a = (PHYSICS.G * hole.mass) / d2;
      ax += (a * dx) / d;
      ay += (a * dy) / d;
    }
    this.vx += ax * dt;
    this.vy += ay * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.time += dt;

    let bounced = false;
    if (this.rules.bounce) {
      if (this.x < 0) { this.x = -this.x; this.vx = -this.vx; bounced = true; }
      else if (this.x > width) { this.x = 2 * width - this.x; this.vx = -this.vx; bounced = true; }
      if (this.y < 0) { this.y = -this.y; this.vy = -this.vy; bounced = true; }
      else if (this.y > height) { this.y = 2 * height - this.y; this.vy = -this.vy; bounced = true; }
    }
    if (this.style) this.trackStyle(hx, hy, bounced);

    const r2 = PHYSICS.SHIP_RADIUS * PHYSICS.SHIP_RADIUS;
    for (let i = 0; i < ships.length; i++) {
      const s = ships[i];
      if (!s.alive) continue;
      const dx = s.x - this.x;
      const dy = s.y - this.y;
      if (dx * dx + dy * dy < r2) return this.finish({ kind: 'ship', ship: i });
    }
    for (let i = 0; i < planets.length; i++) {
      const p = planets[i];
      const dx = p.x - this.x;
      const dy = p.y - this.y;
      if (dx * dx + dy * dy < p.radius * p.radius) return this.finish({ kind: 'planet', planet: i });
    }
    if (hole) {
      const dx = hole.x - this.x;
      const dy = hole.y - this.y;
      if (dx * dx + dy * dy < hole.radius * hole.radius) return this.finish({ kind: 'hole' });
    }
    const m = PHYSICS.OUT_MARGIN;
    if (this.x < -m || this.x > width + m || this.y < -m || this.y > height + m) return this.finish({ kind: 'lost' });
    if (this.time >= this.rules.timeLimit) return this.finish({ kind: 'timeout' });
    return null;
  }

  get inField(): boolean {
    return this.x >= 0 && this.x <= this.world.width && this.y >= 0 && this.y <= this.world.height;
  }

  private finish(end: ShotEnd): ShotEnd {
    this.end = end;
    if (this.style && end.kind === 'ship') {
      // Encounters still open at impact count too — e.g. a target parked right next to a planet.
      this.encounters!.forEach((e, i) => e.inside && this.closeEncounter(i));
      if (this.time >= AIRTIME) this.style.push({ kind: 'airtime', x: this.x, y: this.y });
    }
    return end;
  }

  private trackStyle(hx: number, hy: number, bounced: boolean): void {
    const style = this.style!;
    const encs = this.encounters!;
    if (bounced) style.push({ kind: 'bank', x: this.x, y: this.y });
    // How far gravity turned the velocity this step (a bounce is not a turn).
    const turn = bounced ? 0 : Math.atan2(hx * this.vy - hy * this.vx, hx * this.vx + hy * this.vy);
    const { planets, hole } = this.world;

    for (let i = 0; i < planets.length; i++) {
      const p = planets[i];
      const d = Math.hypot(p.x - this.x, p.y - this.y);
      const e = encs[i];
      if (d < p.radius * 2.5 + 25) {
        if (!e.inside) Object.assign(e, { inside: true, turn: 0, minGap: Infinity, photons: 0 });
        e.turn += turn;
        e.minGap = Math.min(e.minGap, d - p.radius);
      } else if (e.inside) {
        this.closeEncounter(i);
      }
    }

    if (hole) {
      const i = planets.length;
      const e = encs[i];
      const d = Math.hypot(hole.x - this.x, hole.y - this.y);
      if (d < hole.radius * 6 + 40) {
        if (!e.inside) Object.assign(e, { inside: true, turn: 0, minGap: Infinity, photons: 0 });
        e.turn += turn;
        // Every full loop around the hole is a photon ring.
        if (Math.abs(e.turn) >= 2 * Math.PI * (e.photons + 1)) {
          e.photons++;
          style.push({ kind: 'photon', x: this.x, y: this.y });
        }
      } else if (e.inside) {
        this.closeEncounter(i);
      }
    }
  }

  private closeEncounter(i: number): void {
    const e = this.encounters![i];
    e.inside = false;
    const isHole = i === this.world.planets.length;
    if (Math.abs(e.turn) >= SWING_TURN && e.photons === 0) this.style!.push({ kind: 'swingby', x: this.x, y: this.y });
    if (!isHole && e.minGap < GRAZE_GAP) this.style!.push({ kind: 'graze', x: this.x, y: this.y });
  }
}

export interface ShotOutcome {
  end: ShotEnd;
  /** Closest approach to any living enemy ship's centre. */
  closest: number;
  /** Closest the shot came to its own ship (once it had left the muzzle) or to a teammate. */
  selfClosest: number;
}

/**
 * Fly a shot to completion without rendering (used by the CPU and tests).
 * `friends` are teammates: not targets, and passing close to them counts as risky.
 */
export function simulateShot(
  world: World,
  shooter: number,
  angle: number,
  power: number,
  rules: ShotRules,
  friends: readonly number[] = [],
): ShotOutcome {
  const shot = new Shot(world, shooter, angle, power, rules);
  const targets = world.ships.filter((s, i) => i !== shooter && s.alive && !friends.includes(i));
  const own = world.ships[shooter];
  const mates = friends.map((i) => world.ships[i]).filter((s) => s.alive);
  let closest2 = Infinity;
  let self2 = Infinity;
  let end: ShotEnd | null = null;
  while (!end) {
    end = shot.step();
    for (const t of targets) {
      const dx = t.x - shot.x;
      const dy = t.y - shot.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < closest2) closest2 = d2;
    }
    for (const m of shot.time > 0.25 ? [own, ...mates] : mates) {
      const dx = m.x - shot.x;
      const dy = m.y - shot.y;
      self2 = Math.min(self2, dx * dx + dy * dy);
    }
  }
  return { end, closest: Math.sqrt(closest2), selfClosest: Math.sqrt(self2) };
}
