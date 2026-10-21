import { DEFENSE, HEAVY, NEBULA, PHYSICS, WORMHOLE } from './config';

// Read once: Shot.step is the innermost loop of every CPU search and killcam, and an imported binding is slower to read than a local one.
const { DT, G, SHIP_RADIUS, OUT_MARGIN } = PHYSICS;

export type PlanetStyle = 'rocky' | 'gas' | 'ice' | 'star';

export interface Planet {
  x: number;
  y: number;
  radius: number;
  mass: number;
  /** Purely visual — texture seed (also the planet's identity for render caches), look and tint. */
  seed: number;
  style: PlanetStyle;
  tint: string;
  /** The polarity power-up has turned this planet's gravity round: it pushes shots away instead of pulling them in. */
  reversed?: boolean;
  /** The sun of the Solar System mode: the system turns around it, and no power-up can touch it. */
  sun?: boolean;
}

export interface Ship {
  x: number;
  y: number;
  alive: boolean;
  /** Power-ups: a shield soaks up the next shot that would hit the ship (it is used up doing so). */
  shield?: boolean;
}

export interface BlackHole {
  x: number;
  y: number;
  /** Event horizon: whatever crosses it is gone. */
  radius: number;
  mass: number;
}

/** A cloud the nebula power-up has placed: shots inside it are slowed and feel the gravity harder. */
export interface Nebula {
  x: number;
  y: number;
  radius: number;
  /** Fixes the cloud's uneven outline, so it is drawn the same everywhere and never changes once laid. */
  seed: number;
}

/** A pair of mouths the wormhole power-up has placed: a shot entering one leaves by the other. No gravity, no kill. */
export interface Wormhole {
  /** Which wormhole this is, for its colours and number: it keeps them when another is swallowed. */
  id: number;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  radius: number;
}

/** The id the next wormhole gets: one past the highest on the field, so a swallowed one never renumbers the rest. */
export function nextWormholeId(world: Pick<World, 'wormholes'>): number {
  return world.wormholes.reduce((next, w) => Math.max(next, w.id + 1), 0);
}

/**
 * Whether a portal can be set at this spot: clear of every portal on the field and of the `others` (the entry
 * of the pair being set), so that no two portals overlap. Any distance is fine beyond that.
 */
export function portalFits(world: Pick<World, 'wormholes'>, spot: { x: number; y: number }, others: readonly { x: number; y: number }[] = []): boolean {
  const clear = (x: number, y: number): boolean => Math.hypot(spot.x - x, spot.y - y) >= WORMHOLE.GAP;
  return world.wormholes.every((w) => clear(w.ax, w.ay) && clear(w.bx, w.by)) && others.every((o) => clear(o.x, o.y));
}

/** How far a trail point may sit from a mouth and still be that mouth: the wire rounds points to a tenth. */
const MOUTH_TOLERANCE = 0.06;

/**
 * Whether the trail segment ending at point `i` (an index into the flat x, y list) is a wormhole jump from one
 * mouth to the other rather than flight. Compared with a tolerance, because a guest's trail arrives rounded.
 */
export function isWormholeJump(points: readonly number[], i: number, wormholes: readonly Wormhole[]): boolean {
  const near = (x: number, y: number, mx: number, my: number): boolean => Math.abs(x - mx) <= MOUTH_TOLERANCE && Math.abs(y - my) <= MOUTH_TOLERANCE;
  const [x0, y0, x1, y1] = [points[i - 2], points[i - 1], points[i], points[i + 1]];
  return wormholes.some((w) => (near(x0, y0, w.ax, w.ay) && near(x1, y1, w.bx, w.by)) || (near(x0, y0, w.bx, w.by) && near(x1, y1, w.ax, w.ay)));
}

/** A planetary defense the power-up has set on a planet's surface: it tracks every shot that flies through its dome, bar its owner's side, and shoots it down. */
export interface Defense {
  /** Where it stands: on the planet's surface. */
  x: number;
  y: number;
  /** The dome it covers: 1.7 times the planet's radius round the turret. Only the part outside the rock counts. */
  radius: number;
  /** The seed of the planet it stands on: it goes where that planet goes, and is gone when the planet is. */
  planet: number;
  /** Who set it: its ring and turret are drawn in this player's colour. */
  owner: number;
  /** The players whose shots fly through unharmed: whoever set it, and their team. */
  protects: number[];
}

/** A missile a planetary defense has fired at a shot. It lives with the shot it chases (`Shot.missiles`). */
export interface Missile {
  /** The defense it came from, an index into `world.defenses`. */
  defense: number;
  x: number;
  y: number;
  heading: number;
  /** Seconds in the air. */
  age: number;
  /** The throw of the dice for this missile, 0 to 1, made when it was fired: it hits if this is below the chance where it catches the shot. */
  roll: number;
  /** Still after its shot. A missile that has lost it is taken out of the list and flies on as a shot of its own (`Shot.strays`). */
  chasing: boolean;
  /** Where it has been, [x0, y0, x1, y1, …], newest last: its exhaust. */
  trail: number[];
}

/** How surely a missile of this defense hits a shot it catches at `distance` from the turret: 0 beyond the area. */
export function defenseChance(d: Pick<Defense, 'radius'>, distance: number): number {
  for (const zone of DEFENSE.ZONES) if (distance < d.radius * zone.reach) return zone.chance;
  return 0;
}

/** A number from 0 to 1 that is the same for the same seed and salt, and unlike for another: the dice of a replay. */
function dice(seed: number, salt: number): number {
  let h = (seed ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export interface World {
  width: number;
  height: number;
  planets: Planet[];
  /** One ship per player, indexed like the players. */
  ships: Ship[];
  /** Every black hole on the field: the Event Horizon one (if any) first, then any the black-hole power-up has spawned. */
  holes: BlackHole[];
  /** Every nebula cloud the nebula power-up has placed. */
  nebulae: Nebula[];
  /** Every wormhole the wormhole power-up has placed. */
  wormholes: Wormhole[];
  /** Every planetary defense the defense power-up has set. */
  defenses: Defense[];
  /** Bumped whenever planets, the holes, the nebulae, the wormholes or the defenses change, so cached render layers know to rebuild. */
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
  /** Which black hole swallowed it, as an index into `world.holes`. */
  | { kind: 'hole'; hole: number }
  /** Which defense shot it down, as an index into `world.defenses`. */
  | { kind: 'shotdown'; defense: number }
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

/** Whether a point is inside any nebula cloud: where a shot is slowed, and where the renderer shows it. */
export function inNebula(nebulae: readonly Nebula[], x: number, y: number): boolean {
  return nebulae.some((n) => {
    const dx = n.x - x;
    const dy = n.y - y;
    return dx * dx + dy * dy < n.radius * n.radius;
  });
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
    holes: w.holes.map((h) => ({ ...h })),
    nebulae: w.nebulae.map((n) => ({ ...n })),
    wormholes: w.wormholes.map((o) => ({ ...o })),
    defenses: w.defenses.map((d) => ({ ...d, protects: [...d.protects] })),
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
  /** Trick-shot log; null when not recorded (CPU planning skips event storage). */
  readonly style: StyleEvent[] | null;
  /** Production swing-by events, including repeated passes of the same body. */
  swingbys = 0;
  /**
   * The shields this shot has bounced off, in order: the volley consumes each shield and turns these
   * into events. Cleared by the caller, never by the shot, so a live volley and a replay see the same.
   */
  readonly reflects: { ship: number; x: number; y: number }[] = [];
  /**
   * The ships this shot has passed through (armor piercing), each once, in order. The volley kills them;
   * the shot itself only records them, so a planner's sample never mutates the world.
   */
  readonly hits: { ship: number; x: number; y: number }[] = [];
  /** One per planet, then one per black hole. */
  private readonly encounters: Encounter[] | null;
  /** The wormhole jumps this shot has made since the caller last cleared them: the volley puts both mouths in the trail, so a drawn trail can break between them. */
  readonly warps: { fromX: number; fromY: number; toX: number; toY: number }[] = [];
  /** Which defenses have fired at this shot already (an index into `world.defenses`): each fires once. */
  readonly fired: boolean[] = [];
  /** The missiles chasing this shot, and those that lost it and are still flying out. */
  readonly missiles: Missile[] = [];
  /** The dice of this shot, the same on every replay: it is made from the aim, so identical shots meet identical luck. */
  seed: number;
  /** The defenses that fired at this shot since the caller last cleared this. */
  readonly launches: { defense: number }[] = [];
  /** The missiles that lost the shot since the caller last cleared this. */
  readonly misses: { defense: number; x: number; y: number }[] = [];
  /**
   * The missiles that lost this shot since the caller last cleared this, each with the way it was flying: the
   * volley sends every one on as a shot of its own, which gravity bends and which hits what it meets.
   */
  readonly strays: { defense: number; x: number; y: number; vx: number; vy: number; trail: number[] }[] = [];
  /** The mouth (wormhole index * 2 + end) this shot last left by: it is ignored until the shot is clear of it, so it is not carried back at once. */
  private portal = -1;
  /** Ships already passed through, so one hull is only ever reported once. */
  private readonly pierced = new Set<number>();

  constructor(
    private readonly world: World,
    readonly shooter: number,
    readonly angle: number,
    readonly power: number,
    private readonly rules: ShotRules,
    trackStyle: boolean | 'metrics' = false,
    /** Ships this shot flies straight through (the neighbour grace period). */
    private readonly spare: readonly number[] = [],
    /** Armor piercing: the shot goes through ships — shields and all — instead of stopping on them. */
    private readonly pierce = false,
    /** Heavy: the shot is hard to bend, and the clouds leave it alone. */
    private readonly heavy = false,
  ) {
    const ship = world.ships[shooter];
    const dir = aimDirection(angle);
    const speed = power * PHYSICS.SPEED_PER_POWER;
    this.x = ship.x + dir.x * PHYSICS.MUZZLE;
    this.y = ship.y + dir.y * PHYSICS.MUZZLE;
    this.vx = dir.x * speed;
    this.vy = dir.y * speed;
    let seed = 0x811c9dc5;
    for (const n of [shooter, Math.round(angle * 1000), Math.round(power * 1000)]) seed = Math.imul(seed ^ (n | 0), 16777619);
    this.seed = seed >>> 0;
    this.style = trackStyle === true ? [] : null;
    this.encounters = trackStyle
      ? Array.from({ length: world.planets.length + world.holes.length }, () => ({ inside: false, turn: 0, minGap: Infinity, photons: 0 }))
      : null;
  }

  /** End the shot from outside (e.g. two projectiles colliding). */
  terminate(end: ShotEnd): void {
    if (!this.end) this.end = end;
  }

  /**
   * A copy of this shot that flies on from the same point, its velocity turned by `turn` radians:
   * how a splitter forks a shot in mid-flight. The original keeps flying as it was.
   */
  fork(turn: number): Shot {
    const copy = new Shot(this.world, this.shooter, this.angle, this.power, this.rules, this.style !== null, this.spare, this.pierce, this.heavy);
    copy.x = this.x;
    copy.y = this.y;
    copy.time = this.time;
    copy.swingbys = this.swingbys;
    copy.portal = this.portal;
    copy.fired.push(...this.fired);
    copy.missiles.push(...this.missiles.map((m) => ({ ...m, trail: [...m.trail] })));
    copy.seed = Math.imul(this.seed ^ Math.round(turn * 1e6), 16777619) >>> 0;
    const c = Math.cos(turn);
    const s = Math.sin(turn);
    copy.vx = this.vx * c - this.vy * s;
    copy.vy = this.vx * s + this.vy * c;
    if (this.style && copy.style) copy.style.push(...this.style);
    return copy;
  }

  /** Advance one physics step. Returns the end state once the shot is over. */
  step(): ShotEnd | null {
    if (this.end) return this.end;
    const dt = DT;
    const { planets, ships, holes, nebulae, defenses, width, height } = this.world;
    const hx = this.vx;
    const hy = this.vy;

    let ax = 0;
    let ay = 0;
    for (const p of planets) {
      const dx = p.x - this.x;
      const dy = p.y - this.y;
      const d2 = dx * dx + dy * dy;
      const d = Math.sqrt(d2);
      const a = ((p.reversed ? -G : G) * p.mass) / d2;
      ax += (a * dx) / d;
      ay += (a * dy) / d;
    }
    for (const hole of holes) {
      const dx = hole.x - this.x;
      const dy = hole.y - this.y;
      const d2 = dx * dx + dy * dy;
      const d = Math.sqrt(d2);
      const a = (G * hole.mass) / d2;
      ax += (a * dx) / d;
      ay += (a * dy) / d;
    }
    // A heavy shot feels only a share of every pull, and a cloud neither deepens it nor drags on it.
    if (this.heavy) {
      ax *= HEAVY.GRAVITY;
      ay *= HEAVY.GRAVITY;
    }
    // A cloud deepens the gravity and drags on the shot, so it both bends into the cloud and slows inside it.
    const clouded = !this.heavy && inNebula(nebulae, this.x, this.y);
    if (clouded) {
      ax *= NEBULA.GRAVITY;
      ay *= NEBULA.GRAVITY;
    }
    this.vx += ax * dt;
    this.vy += ay * dt;
    if (clouded) {
      this.vx *= NEBULA.DRAG;
      this.vy *= NEBULA.DRAG;
      // The cloud may slow a shot, never stop it: below the floor the drag lets go entirely, so the shot
      // always crawls out of the cloud rather than hanging in it until the clock runs out.
      const speed2 = this.vx * this.vx + this.vy * this.vy;
      const floor = NEBULA.MIN_SPEED;
      if (speed2 > 0 && speed2 < floor * floor) {
        const k = floor / Math.sqrt(speed2);
        this.vx *= k;
        this.vy *= k;
      }
    }
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
    if (this.encounters) this.trackStyle(hx, hy, bounced);
    if (this.world.wormholes.length) this.warp();

    const r2 = SHIP_RADIUS * SHIP_RADIUS;
    for (let i = 0; i < ships.length; i++) {
      const s = ships[i];
      if (!s.alive || this.spare.includes(i)) continue;
      const dx = s.x - this.x;
      const dy = s.y - this.y;
      if (dx * dx + dy * dy >= r2) continue;
      // Armor piercing runs through a ship, shield or not: the hull is reported and the shot flies on. A
      // planet or a black hole still stops it, they are not hulls.
      if (this.pierce) {
        if (!this.pierced.has(i)) {
          this.pierced.add(i);
          this.hits.push({ ship: i, x: this.x, y: this.y });
        }
        continue;
      }
      // A shield bounces the shot off instead of letting it through: the shot flies on, and the shield is spent.
      if (s.shield) this.reflect(i, s.x, s.y);
      else return this.finish({ kind: 'ship', ship: i });
    }
    for (let i = 0; i < planets.length; i++) {
      const p = planets[i];
      const dx = p.x - this.x;
      const dy = p.y - this.y;
      if (dx * dx + dy * dy < p.radius * p.radius) return this.finish({ kind: 'planet', planet: i });
    }
    for (let i = 0; i < holes.length; i++) {
      const hole = holes[i];
      const dx = hole.x - this.x;
      const dy = hole.y - this.y;
      if (dx * dx + dy * dy < hole.radius * hole.radius) return this.finish({ kind: 'hole', hole: i });
    }
    // Planetary defenses: a shot that flies into a defense's area (bar its own side's) gets a missile after it,
    // once per defense. The missile homes in, and where it catches the shot decides whether it hits.
    for (let i = 0; i < defenses.length; i++) {
      const d = defenses[i];
      if (this.fired[i] || d.protects.includes(this.shooter)) continue;
      if ((d.x - this.x) ** 2 + (d.y - this.y) ** 2 >= d.radius * d.radius) continue;
      this.fired[i] = true;
      this.missiles.push({ defense: i, x: d.x, y: d.y, heading: Math.atan2(this.y - d.y, this.x - d.x), age: 0, roll: dice(this.seed, i), chasing: true, trail: [d.x, d.y] });
      this.launches.push({ defense: i });
    }
    for (let k = this.missiles.length - 1; k >= 0; k--) {
      const missile = this.missiles[k];
      const d = defenses[missile.defense];
      missile.age += dt;
      if (missile.chasing) {
        // Pure pursuit with a limited turn: it follows a shot that bends, and loses one that cuts across too fast.
        let turn = Math.atan2(this.y - missile.y, this.x - missile.x) - missile.heading;
        turn = Math.atan2(Math.sin(turn), Math.cos(turn));
        const most = DEFENSE.MISSILE_TURN * dt;
        missile.heading += Math.max(-most, Math.min(most, turn));
      }
      missile.x += Math.cos(missile.heading) * DEFENSE.MISSILE_SPEED * dt;
      missile.y += Math.sin(missile.heading) * DEFENSE.MISSILE_SPEED * dt;
      const last = missile.trail.length;
      if (Math.hypot(missile.x - missile.trail[last - 2], missile.y - missile.trail[last - 1]) >= 6) {
        missile.trail.push(missile.x, missile.y);
        if (missile.trail.length > 36) missile.trail.splice(0, 2);
      }
      if (missile.chasing) {
        if (Math.hypot(this.x - missile.x, this.y - missile.y) < DEFENSE.HIT_RADIUS) {
          if (missile.roll < defenseChance(d, Math.hypot(this.x - d.x, this.y - d.y))) {
            this.missiles.splice(k, 1);
            return this.finish({ kind: 'shotdown', defense: missile.defense });
          }
          this.lose(missile, k);
        } else if (missile.age > DEFENSE.MISSILE_LIFE || Math.hypot(missile.x - d.x, missile.y - d.y) > d.radius * 1.5) {
          this.lose(missile, k);
        }
      }
    }
    const m = OUT_MARGIN;
    if (this.x < -m || this.x > width + m || this.y < -m || this.y > height + m) return this.finish({ kind: 'lost' });
    if (this.time >= this.rules.timeLimit) return this.finish({ kind: 'timeout' });
    return null;
  }

  /** A missile has lost this shot: it is reported, and sent on as a shot of its own along the way it was flying. */
  private lose(missile: Missile, index: number): void {
    this.misses.push({ defense: missile.defense, x: missile.x, y: missile.y });
    this.strays.push({
      defense: missile.defense,
      x: missile.x,
      y: missile.y,
      vx: Math.cos(missile.heading) * DEFENSE.MISSILE_SPEED,
      vy: Math.sin(missile.heading) * DEFENSE.MISSILE_SPEED,
      trail: missile.trail,
    });
    this.missiles.splice(index, 1);
  }

  /** Wormholes: a shot that reaches a mouth comes out of the other one with its velocity unchanged. Gravity never touches it. */
  private warp(): void {
    const { wormholes } = this.world;
    if (this.portal >= 0) {
      const w = wormholes[this.portal >> 1];
      if (!w) this.portal = -1;
      else {
        const [mx, my] = this.portal & 1 ? [w.bx, w.by] : [w.ax, w.ay];
        if (Math.hypot(this.x - mx, this.y - my) > w.radius) this.portal = -1;
      }
    }
    for (let i = 0; i < wormholes.length; i++) {
      const w = wormholes[i];
      for (let end = 0; end < 2; end++) {
        const id = i * 2 + end;
        if (id === this.portal) continue;
        const [mx, my] = end ? [w.bx, w.by] : [w.ax, w.ay];
        if (Math.hypot(this.x - mx, this.y - my) >= w.radius) continue;
        const [tx, ty] = end ? [w.ax, w.ay] : [w.bx, w.by];
        this.warps.push({ fromX: mx, fromY: my, toX: tx, toY: ty });
        this.x = tx;
        this.y = ty;
        this.portal = id ^ 1;
        return;
      }
    }
  }

  get inField(): boolean {
    return this.x >= 0 && this.x <= this.world.width && this.y >= 0 && this.y <= this.world.height;
  }

  /**
   * Bounce the shot off a shielded ship: mirror the velocity about the hull's normal and set the shot just
   * outside the hull, so it leaves along the reflection instead of hitting the same shield again next step.
   * The ship is not touched here — the volley reads `reflects` and spends the shield, so a CPU search that
   * only samples the world does not consume anything.
   */
  private reflect(ship: number, cx: number, cy: number): void {
    const dx = this.x - cx;
    const dy = this.y - cy;
    const d = Math.hypot(dx, dy);
    const nx = d > 0 ? dx / d : 1;
    const ny = d > 0 ? dy / d : 0;
    const dot = this.vx * nx + this.vy * ny;
    this.vx -= 2 * dot * nx;
    this.vy -= 2 * dot * ny;
    const out = SHIP_RADIUS + 0.5;
    this.x = cx + nx * out;
    this.y = cy + ny * out;
    this.reflects.push({ ship, x: this.x, y: this.y });
  }

  private finish(end: ShotEnd): ShotEnd {
    this.end = end;
    if (this.encounters && end.kind === 'ship') {
      // Encounters still open at impact count too — e.g. a target parked right next to a planet.
      this.encounters!.forEach((e, i) => e.inside && this.closeEncounter(i));
      if (this.time >= AIRTIME) this.recordStyle('airtime');
    }
    return end;
  }

  private trackStyle(hx: number, hy: number, bounced: boolean): void {
    const encs = this.encounters!;
    if (bounced) this.recordStyle('bank');
    // How far gravity turned the velocity this step (a bounce is not a turn).
    const turn = bounced ? 0 : Math.atan2(hx * this.vy - hy * this.vx, hx * this.vx + hy * this.vy);
    const { planets, holes } = this.world;

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

    for (let i = 0; i < holes.length; i++) {
      const hole = holes[i];
      const e = encs[planets.length + i];
      const d = Math.hypot(hole.x - this.x, hole.y - this.y);
      if (d < hole.radius * 6 + 40) {
        if (!e.inside) Object.assign(e, { inside: true, turn: 0, minGap: Infinity, photons: 0 });
        e.turn += turn;
        // Every full loop around the hole is a photon ring.
        if (Math.abs(e.turn) >= 2 * Math.PI * (e.photons + 1)) {
          e.photons++;
          this.recordStyle('photon');
        }
      } else if (e.inside) {
        this.closeEncounter(planets.length + i);
      }
    }
  }

  private closeEncounter(i: number): void {
    const e = this.encounters![i];
    e.inside = false;
    const isHole = i >= this.world.planets.length;
    if (Math.abs(e.turn) >= SWING_TURN && e.photons === 0) this.recordStyle('swingby');
    if (!isHole && e.minGap < GRAZE_GAP) this.recordStyle('graze');
  }

  private recordStyle(kind: StyleKind): void {
    if (kind === 'swingby') this.swingbys++;
    this.style?.push({ kind, x: this.x, y: this.y });
  }
}

/** A circular point of interest a shot can pass through — the planner uses it to value power-up pickups. */
export interface ShotGate {
  x: number;
  y: number;
  r: number;
}

export interface ShotOutcome {
  end: ShotEnd;
  /** Closest approach to any living enemy ship's centre. */
  closest: number;
  /** Closest the shot came to its own ship (once it had left the muzzle) or to a teammate. */
  selfClosest: number;
  /** Indices of the `gates` circles this shot passed through, in the order it met them. */
  gates: number[];
  /** Ships an armor-piercing shot went through (they would be killed), in the order it met them. */
  pierced: number[];
}

/**
 * Fly a shot to completion without rendering (used by the CPU and tests).
 * `friends` are teammates: not targets, and passing close to them counts as risky.
 * `gates` are circles of interest (power-up pickups): the outcome lists the ones the shot passed through.
 */
export function simulateShot(
  world: World,
  shooter: number,
  angle: number,
  power: number,
  rules: ShotRules,
  friends: readonly number[] = [],
  gates: readonly ShotGate[] = [],
  pierce = false,
  heavy = false,
): ShotOutcome {
  const shot = new Shot(world, shooter, angle, power, rules, false, [], pierce, heavy);
  const targets = world.ships.filter((s, i) => i !== shooter && s.alive && !friends.includes(i));
  const own = world.ships[shooter];
  const mates = friends.map((i) => world.ships[i]).filter((s) => s.alive);
  let closest2 = Infinity;
  let self2 = Infinity;
  let end: ShotEnd | null = null;
  const passed: number[] = [];
  const taken = new Set<number>();
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
    gates.forEach((gate, i) => {
      if (taken.has(i)) return;
      const dx = gate.x - shot.x;
      const dy = gate.y - shot.y;
      if (dx * dx + dy * dy < gate.r * gate.r) {
        taken.add(i);
        passed.push(i);
      }
    });
  }
  return { end, closest: Math.sqrt(closest2), selfClosest: Math.sqrt(self2), gates: passed, pierced: shot.hits.map((hit) => hit.ship) };
}

export interface StyledShotOutcome extends ShotOutcome {
  swingbys: number;
  flightTime: number;
  pathLength: number;
}

/** Full production flight/style evaluation, sliced so long orbits do not block a frame. */
export function* simulateStyledShot(
  world: World,
  shooter: number,
  angle: number,
  power: number,
  rules: ShotRules,
  friends: readonly number[] = [],
  pierce = false,
  heavy = false,
): Generator<void, StyledShotOutcome> {
  const shot = new Shot(world, shooter, angle, power, rules, 'metrics', [], pierce, heavy);
  const targets = world.ships.filter((s, i) => i !== shooter && s.alive && !friends.includes(i));
  const own = world.ships[shooter];
  const mates = friends.map((i) => world.ships[i]).filter((s) => s.alive);
  let closest2 = Infinity;
  let self2 = Infinity;
  let pathLength = 0;
  let steps = 0;
  let end: ShotEnd | null = null;
  while (!end) {
    const x = shot.x;
    const y = shot.y;
    end = shot.step();
    pathLength += Math.hypot(shot.x - x, shot.y - y);
    for (const t of targets) {
      const dx = t.x - shot.x;
      const dy = t.y - shot.y;
      closest2 = Math.min(closest2, dx * dx + dy * dy);
    }
    // Identical muzzle grace and teammate proximity rules to simulateShot.
    if (shot.time > 0.25) {
      const dx = own.x - shot.x;
      const dy = own.y - shot.y;
      self2 = Math.min(self2, dx * dx + dy * dy);
    }
    for (const mate of mates) {
      const dx = mate.x - shot.x;
      const dy = mate.y - shot.y;
      self2 = Math.min(self2, dx * dx + dy * dy);
    }
    if (!end && ++steps % 240 === 0) yield;
  }
  return {
    end, closest: Math.sqrt(closest2), selfClosest: Math.sqrt(self2), gates: [], pierced: shot.hits.map((hit) => hit.ship),
    swingbys: shot.swingbys, flightTime: shot.time, pathLength,
  };
}
