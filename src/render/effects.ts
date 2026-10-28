import { COLORS, DEBRIS, FIELD, FONTS, PHYSICS, SUDDEN_DEATH, type Debris } from '../sim/config';
import { landing } from '../sim/meteors';
import { zapAt } from '../sim/ufos';
import type { World } from '../sim/physics';
import { rgba } from './color';
import { SHIP_HULL } from './ship';
import { fillTextUpright, strokeTextUpright } from './orientation';

type SparkTier = 'large' | 'medium' | 'small';

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  drag: number;
  tier: SparkTier;
  /** Seconds left before the spark is gone; sparks without one drift on until the round ends. */
  life?: number;
}

interface GravityBody {
  x: number;
  y: number;
  radius: number;
}

const MAX_SPARKS = 1800;
/** A spark's drag at low debris; the debris setting scales it down from there. */
const SPARK_DRAG = 0.12;
const MAX_MOTES = 240;
/** Debris that drifts this far from the middle of the field is gone for good: nothing pulls it back. */
const DEBRIS_RANGE = 1000;
/** The fastest a power-up's pieces fly on their way to the ship. */
const MOTE_SPEED = 900;

/** A piece of a power-up that burst open, on its way to the ship that took it. */
interface Mote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  speed: number;
  size: number;
  color: string;
  /** Seconds of free flight before the piece turns towards the ship. */
  burst: number;
  age: number;
  target: { x: number; y: number };
}

interface Ring {
  x: number;
  y: number;
  radius: number;
  life: number;
  max: number;
  color: string;
  /** Contracting instead of expanding. */
  inward: boolean;
}

/** A bright line that fades: the streak of a teleport. */
interface Beam {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  life: number;
  max: number;
  color: string;
}

/** A plasma beam that burns for a moment: the planet killer's laser, drawn far wider than a teleport streak. */
interface Laser {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  life: number;
  max: number;
  color: string;
  /** Half-width in field units at full strength. */
  width: number;
}

/** A ship the supernova has doomed: it stands on, heating up, until the shockwave gets to it (`at`, seconds into the blast). */
interface Doomed {
  x: number;
  y: number;
  angle: number;
  color: string;
  at: number;
  done: boolean;
}

/** A planet the supernova's shockwave shatters when it gets there (`at`, seconds into the blast). */
interface DoomedPlanet {
  x: number;
  y: number;
  radius: number;
  color: string;
  at: number;
  done: boolean;
}

/** A supernova under way: its core, two shockwaves sweeping the field, and the ships and planets waiting for them. */
interface Nova {
  x: number;
  y: number;
  age: number;
  doomed: Doomed[];
  planets: DoomedPlanet[];
}

/** How long a supernova's light lasts on the field (s). */
const NOVA_LIFE = 3.2;

/** One meteor of a shower: its path, sampled `METEORS.RATE` times a second, from `delay` s into the shower. The ship it takes (if any) stands on, heating up, until it lands. */
interface MeteorFlight {
  points: number[];
  delay: number;
  at: number;
  color: string;
  angle: number;
  doomed: boolean;
  /** The planet it blows apart where it lands, if it is one's meteor. */
  planet: { x: number; y: number; radius: number; color: string } | null;
  done: boolean;
}

/** A meteor shower under way (`age` s into it). */
interface Shower {
  age: number;
  flights: MeteorFlight[];
}

/** How many samples of its path a meteor trails behind its head. */
const METEOR_TAIL = 18;

/** One saucer of an invasion: its flight in (`points`, sampled `UFOS.RATE` times a second, from `delay` s), then it hovers and charges until `at`, when it zaps `target`. */
interface UfoFlight {
  points: number[];
  delay: number;
  charge: number;
  at: number;
  target: [number, number];
  color: string;
  angle: number;
  doomed: boolean;
  planet: { x: number; y: number; radius: number; color: string } | null;
  done: boolean;
}

/** A UFO invasion under way (`age` s into it). */
interface Invasion {
  age: number;
  flights: UfoFlight[];
}

/** The green of the saucers' lights and beams, and how long a saucer lingers (and fades) after its zap. */
const UFO_GLOW = '#6dffb4';
const UFO_LEAVE = 0.9;

interface Callout {
  text: string;
  x: number;
  y: number;
  color: string;
  life: number;
  max: number;
  big: boolean;
}

/** Cosmetic particles, shockwaves, floating callouts and screen shake. Lives in field coordinates. */
export class Effects {
  private sparks: Spark[] = [];
  private rings: Ring[] = [];
  private callouts: Callout[] = [];
  private motes: Mote[] = [];
  private beams: Beam[] = [];
  private lasers: Laser[] = [];
  private novas: Nova[] = [];
  private showers: Shower[] = [];
  private invasions: Invasion[] = [];
  shake = 0;
  flash = 0;
  /** A supernova's white-out over the whole screen (0 → 1). */
  whiteout = 0;
  /** Seconds the supernova's quake still keeps the field shaking. */
  private quake = 0;

  constructor(
    public particles: boolean,
    private readonly reducedMotion: boolean,
    public debrisLevel: Debris,
  ) {}

  /** The drag a new spark gets: sparks already flying keep theirs when the setting changes. */
  private get sparkDrag(): number {
    return SPARK_DRAG * DEBRIS[this.debrisLevel];
  }

  clear(): void {
    this.sparks = [];
    this.rings = [];
    this.callouts = [];
    this.motes = [];
    this.beams = [];
    this.lasers = [];
    this.novas = [];
    this.showers = [];
    this.invasions = [];
    this.shake = 0;
    this.flash = 0;
    this.whiteout = 0;
    this.quake = 0;
  }

  explode(x: number, y: number, color: string, vx = 0, vy = 0): void {
    this.ring(x, y, 90, 0.7, color);
    this.ring(x, y, 150, 1.1, COLORS.sodium);
    this.burst(x, y, 110, 40, 360, color, 'large', vx, vy);
    this.burst(x, y, 70, 20, 220, COLORS.sodium, 'medium', vx, vy);
    this.burst(x, y, 30, 10, 90, COLORS.bone, 'small', vx, vy);
    if (!this.reducedMotion) this.shake = 11;
    this.flash = 1;
  }

  impact(x: number, y: number, color: string, vx = 0, vy = 0): void {
    this.ring(x, y, 26, 0.45, COLORS.bone);
    this.burst(x, y, 26, 20, 140, color, 'large', vx, vy);
    this.burst(x, y, 12, 10, 70, COLORS.boneDim, 'medium', vx, vy);
    if (!this.reducedMotion) this.shake = Math.max(this.shake, 2.5);
  }

  muzzle(x: number, y: number, angleDeg: number, color: string): void {
    const a = (angleDeg * Math.PI) / 180;
    this.ring(x, y, 14, 0.3, color);
    this.cone(x, y, a, 12, color);
  }

  fizzle(x: number, y: number, color: string, vx = 0, vy = 0): void {
    this.burst(x, y, 10, 10, 60, color, 'medium', vx, vy);
  }

  /** Two projectiles annihilating each other. */
  clash(x: number, y: number, a: string, b: string, velocities: [{ x: number; y: number }, { x: number; y: number }] = [{ x: 0, y: 0 }, { x: 0, y: 0 }]): void {
    this.ring(x, y, 46, 0.5, COLORS.bone);
    this.burst(x, y, 30, 40, 260, a, 'large', velocities[0].x, velocities[0].y);
    this.burst(x, y, 30, 40, 260, b, 'large', velocities[1].x, velocities[1].y);
    this.flash = Math.max(this.flash, 0.45);
    if (!this.reducedMotion) this.shake = Math.max(this.shake, 4);
  }

  /**
   * A power-up taken from the field: it bursts open, and its pieces stream to the ship that took it.
   * The burst is always shown; the pieces only with particles on.
   */
  pickup(x: number, y: number, color: string, target: { x: number; y: number }): void {
    this.ring(x, y, 70, 0.5, color);
    this.burst(x, y, 26, 60, 240, color, 'large', 0, 0, 0.9);
    this.burst(x, y, 10, 40, 140, COLORS.bone, 'small', 0, 0, 0.7);
    if (!this.particles) return;
    for (let i = 0; i < 44 && this.motes.length < MAX_MOTES; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 90 + Math.random() * 180;
      this.motes.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        speed: 0,
        size: 1.8 + Math.random() * 2.2,
        color: Math.random() < 0.25 ? COLORS.bone : color,
        burst: 0.16 + Math.random() * 0.16,
        age: 0,
        target,
      });
    }
  }

  /** A power-up appearing on the field: a ring closes in on it, with a few sparks. */
  spawn(x: number, y: number, color: string): void {
    this.rings.push({ x, y, radius: 40, life: 0.4, max: 0.4, color, inward: true });
    this.burst(x, y, 8, 20, 90, color, 'small', 0, 0, 0.6);
  }

  /** A power-up that ran out before anybody took it: it pops into dim sparks. */
  fade(x: number, y: number, color: string): void {
    this.ring(x, y, 26, 0.35, color);
    this.burst(x, y, 14, 20, 110, color, 'medium', 0, 0, 0.7);
  }

  /** The power-up a ship lost by taking another one: it bursts away from the ship. */
  drop(x: number, y: number, color: string): void {
    this.ring(x, y, 24, 0.3, color);
    this.burst(x, y, 12, 50, 170, color, 'medium', 0, 0, 0.8);
  }

  /** A ship leaving one spot and arriving at another: it collapses where it was, a streak joins the two, and it bursts out. */
  teleport(fromX: number, fromY: number, toX: number, toY: number, color: string): void {
    this.rings.push({ x: fromX, y: fromY, radius: 46, life: 0.4, max: 0.4, color, inward: true });
    this.burst(fromX, fromY, 16, 30, 140, color, 'medium', 0, 0, 0.7);
    this.beams.push({ x1: fromX, y1: fromY, x2: toX, y2: toY, life: 0.4, max: 0.4, color });
    this.ring(toX, toY, 70, 0.5, color);
    this.ring(toX, toY, 36, 0.35, COLORS.bone);
    this.burst(toX, toY, 36, 40, 260, color, 'large', 0, 0, 0.9);
    this.burst(toX, toY, 14, 20, 120, COLORS.bone, 'small', 0, 0, 0.7);
    this.flash = Math.max(this.flash, 0.3);
  }

  /** A shield soaking up a hit: a bright ring where the shot arrived, and sparks scattering off it. */
  shieldHit(x: number, y: number, color: string): void {
    this.ring(x, y, 44, 0.45, color);
    this.ring(x, y, 24, 0.3, COLORS.bone);
    this.burst(x, y, 24, 50, 220, color, 'large', 0, 0, 0.8);
    this.burst(x, y, 10, 30, 120, COLORS.bone, 'small', 0, 0, 0.6);
    this.flash = Math.max(this.flash, 0.25);
    if (!this.reducedMotion) this.shake = Math.max(this.shake, 3);
  }

  /** A planet's gravity turned round: rings pushed outward from the rock, or drawn back in when it is turned back. */
  antigravity(x: number, y: number, radius: number, reversed: boolean, color: string): void {
    for (let i = 0; i < 3; i++) {
      const ring = { x, y, radius: radius * (1.8 + i * 0.9), life: 0.7 + i * 0.12, max: 0.7 + i * 0.12, color, inward: !reversed };
      this.rings.push(ring);
    }
    this.burst(x, y, 18, 40, 160, color, 'large', 0, 0, 0.7);
    this.flash = Math.max(this.flash, 0.15);
  }

  /** A planetary defense firing: a flash at the turret, thrown towards the shot it has locked on to. */
  defenseFire(fromX: number, fromY: number, toX: number, toY: number, color: string): void {
    const angle = Math.atan2(toY - fromY, toX - fromX);
    this.ring(fromX, fromY, 18, 0.28, color);
    this.cone(fromX, fromY, angle, 16, color);
    this.burst(fromX, fromY, 6, 20, 90, COLORS.bone, 'small', Math.cos(angle) * 80, Math.sin(angle) * 80, 0.4);
  }

  /** The missile catching its shot: a ring in the defense's colour, a white one inside it, and sparks of both colours. */
  intercepted(x: number, y: number, defenseColor: string, shotColor: string, vx = 0, vy = 0): void {
    this.ring(x, y, 40, 0.42, defenseColor);
    this.ring(x, y, 20, 0.28, COLORS.bone);
    this.burst(x, y, 22, 40, 200, defenseColor, 'large', 0, 0, 0.75);
    this.burst(x, y, 14, 30, 130, shotColor, 'medium', vx * 0.2, vy * 0.2, 0.7);
    this.burst(x, y, 8, 20, 90, COLORS.bone, 'small', 0, 0, 0.5);
    this.flash = Math.max(this.flash, 0.2);
    if (!this.reducedMotion) this.shake = Math.max(this.shake, 2);
  }

  /** A missile that lost its shot: a small burst where it gave up. */
  missileLost(x: number, y: number, color: string): void {
    this.ring(x, y, 12, 0.25, color);
    this.burst(x, y, 8, 20, 80, color, 'small', 0, 0, 0.45);
  }

  /** A shot forking into three: a ring and a spray of sparks at the fork. */
  split(x: number, y: number, color: string): void {
    this.ring(x, y, 34, 0.35, color);
    this.ring(x, y, 18, 0.25, COLORS.bone);
    this.burst(x, y, 22, 60, 220, color, 'large', 0, 0, 0.8);
    this.flash = Math.max(this.flash, 0.2);
  }

  /** Matter spiralling into the black hole. */
  devour(x: number, y: number, toX: number, toY: number, color: string, vx = 0, vy = 0): void {
    if (!this.particles) return;
    const d = Math.hypot(toX - x, toY - y) || 1;
    const nx = (toX - x) / d;
    const ny = (toY - y) / d;
    for (let i = 0; i < 36 && this.sparks.length < MAX_SPARKS; i++) {
      const sp = 120 + Math.random() * 260;
      const swirl = (Math.random() - 0.3) * 160;
      const ox = (Math.random() - 0.5) * 30;
      const oy = (Math.random() - 0.5) * 30;
      this.sparks.push({
        x: x + ox,
        y: y + oy,
        vx: nx * sp - ny * swirl + vx,
        vy: ny * sp + nx * swirl + vy,
        size: 1.2 + Math.random() * 2,
        color: Math.random() < 0.3 ? COLORS.sodium : color,
        drag: 2 * this.sparkDrag,
        tier: 'medium',
      });
    }
  }

  /**
   * The red giant blows apart. The screen goes white, the field quakes, a blinding core swells, and two shockwaves —
   * white-hot, then a slower one of red plasma — sweep out over the whole field, throwing a storm of debris. Each
   * doomed ship glows hotter as the wave comes, and blows up as it gets there.
   */
  supernova(x: number, y: number, doomed: { x: number; y: number; angle: number; color: string }[], planets: { x: number; y: number; radius: number; color: string }[] = []): void {
    const at = (o: { x: number; y: number }): number => Math.hypot(o.x - x, o.y - y) / SUDDEN_DEATH.NOVA_SPEED;
    this.novas.push({
      x,
      y,
      age: 0,
      doomed: doomed.map((d) => ({ ...d, at: at(d), done: false })),
      planets: planets.map((p) => ({ ...p, at: at(p), done: false })),
    });
    // With reduced motion there is no full-screen flash, and the field stays still.
    if (!this.reducedMotion) {
      this.whiteout = 1;
      this.flash = 1;
      this.quake = 1.8;
      this.shake = 30;
    }
    this.ring(x, y, 1500, 2.6, COLORS.sodium);
    this.ring(x, y, 1100, 2.1, COLORS.danger);
    this.ring(x, y, 600, 1.4, COLORS.bone);
    this.ring(x, y, 260, 0.8, COLORS.bone);
    this.burst(x, y, 260, 120, 1100, COLORS.sodium, 'large');
    this.burst(x, y, 180, 80, 800, COLORS.danger, 'large');
    this.burst(x, y, 120, 40, 500, COLORS.bone, 'medium');
    this.burst(x, y, 80, 20, 260, '#ffe9a8', 'small');
  }

  /** The horizon swelling: a ring that contracts onto the hole. */
  collapse(x: number, y: number): void {
    this.rings.push({ x, y, radius: 220, life: 1.2, max: 1.2, color: COLORS.danger, inward: true });
    if (!this.reducedMotion) this.shake = Math.max(this.shake, 3);
  }

  /**
   * The planet killer's shot: a plasma laser from the ship to the rock, then the rock blows apart. The planet
   * is already off the field by the time this plays, so the beam and the blast are what is left of it.
   */
  laser(fromX: number, fromY: number, toX: number, toY: number, color: string, radius = 30): void {
    this.lasers.push({ x1: fromX, y1: fromY, x2: toX, y2: toY, life: 0.6, max: 0.6, color, width: 9 });
    const dx = toX - fromX;
    const dy = toY - fromY;
    const d = Math.hypot(dx, dy) || 1;
    this.burst(fromX, fromY, 16, 60, 260, color, 'medium', (dx / d) * 90, (dy / d) * 90, 0.45);
    this.shatter(toX, toY, color, radius);
  }

  /** A planet blowing apart: a wide shockwave, a bright core, and debris thrown in every direction. */
  shatter(toX: number, toY: number, color: string, radius = 30): void {
    this.ring(toX, toY, radius * 3.2, 0.75, color);
    this.ring(toX, toY, radius * 1.6, 0.5, COLORS.bone);
    this.burst(toX, toY, 70, 90, radius * 12, COLORS.sodium, 'large', 0, 0, 1);
    this.burst(toX, toY, 44, 60, radius * 9, color, 'large', 0, 0, 0.9);
    this.burst(toX, toY, 22, 30, radius * 5, COLORS.bone, 'small', 0, 0, 0.7);
    // The rock itself comes apart: a second, wider shockwave, and a great spray of ordinary sparks born across
    // the whole disc and thrown outwards. They have no lifetime, so like any other spark they stay on the field,
    // fall into the gravity of what is left, circle the planets and the holes and break up on the rocks they hit.
    this.ring(toX, toY, radius * 6, 1.1, COLORS.sodium);
    const scale = Math.max(0.6, Math.min(1.5, radius / 30));
    this.debris(toX, toY, radius, Math.round(220 * scale), 40, radius * 10, color, 'large');
    this.debris(toX, toY, radius, Math.round(260 * scale), 60, radius * 14, COLORS.sodium, 'medium');
    this.debris(toX, toY, radius, Math.round(180 * scale), 30, radius * 18, COLORS.boneDim, 'medium');
    this.debris(toX, toY, radius, Math.round(220 * scale), 80, radius * 22, COLORS.bone, 'small');
    this.flash = Math.max(this.flash, 1);
    if (!this.reducedMotion) this.shake = Math.max(this.shake, 14);
  }

  /**
   * A shot flying through a nebula: the gas it drags against. Wisps are shed from it and hang where they were
   * left while the shot goes on, so a slowed shot trails a cloud of its own and the drag can be seen.
   */
  nebulaDrag(x: number, y: number, vx: number, vy: number, dt: number, color: string): void {
    if (!this.particles) return;
    const want = dt * 55;
    const count = Math.floor(want) + (Math.random() < want % 1 ? 1 : 0);
    for (let i = 0; i < count && this.sparks.length < MAX_SPARKS; i++) {
      const spark = this.spark(
        x + (Math.random() - 0.5) * 5,
        y + (Math.random() - 0.5) * 5,
        vx * 0.1 + (Math.random() - 0.5) * 36,
        vy * 0.1 + (Math.random() - 0.5) * 36,
        Math.random() < 0.3 ? COLORS.bone : color,
        'medium',
      );
      // Strong drag so the wisp is left behind almost where the shot shed it, and gone within a second.
      spark.drag = 2.4;
      spark.life = 0.55 + Math.random() * 0.5;
      this.sparks.push(spark);
    }
  }

  /** Floating text, e.g. "SWING-BY ×1,5" or "+820". */
  callout(text: string, x: number, y: number, color: string, big = false): void {
    this.callouts.push({ text, x, y, color, life: big ? 1.8 : 1.4, max: big ? 1.8 : 1.4, big });
  }

  update(dt: number, world: World): void {
    this.shake = Math.max(0, this.shake - dt * 30);
    this.flash = Math.max(0, this.flash - dt * 2.5);
    this.whiteout = Math.max(0, this.whiteout - dt * 0.9);
    if (this.quake > 0) {
      this.quake = Math.max(0, this.quake - dt);
      // A rumble that dies down slowly, under the sharper jolts of the ships blowing up.
      this.shake = Math.max(this.shake, 4 + 10 * this.quake);
    }
    this.updateNovas(dt);
    this.updateShowers(dt);
    this.updateInvasions(dt);
    const fragments: Spark[] = [];
    const remaining: Spark[] = [];
    const steps = Math.max(1, Math.ceil(dt / PHYSICS.DT));
    const step = dt / steps;
    for (const s of this.sparks) {
      if (s.life !== undefined && (s.life -= dt) <= 0) continue;
      let collided = false;
      for (let i = 0; i < steps; i++) {
        let ax = 0;
        let ay = 0;
        for (const body of world.planets) {
          const dx = body.x - s.x;
          const dy = body.y - s.y;
          const d2 = Math.max(64, dx * dx + dy * dy);
          const a = ((body.reversed ? -PHYSICS.G : PHYSICS.G) * body.mass) / (d2 * Math.sqrt(d2));
          ax += a * dx;
          ay += a * dy;
        }
        for (const hole of world.holes) {
          const dx = hole.x - s.x;
          const dy = hole.y - s.y;
          const d2 = Math.max(64, dx * dx + dy * dy);
          const a = (PHYSICS.G * hole.mass) / (d2 * Math.sqrt(d2));
          ax += a * dx;
          ay += a * dy;
        }
        const drag = Math.exp(-s.drag * step);
        s.vx = (s.vx + ax * step) * drag;
        s.vy = (s.vy + ay * step) * drag;
        s.x += s.vx * step;
        s.y += s.vy * step;
        const body = this.collidingBody(s, world);
        if (body) {
          this.fragment(s, fragments, body);
          collided = true;
          break;
        }
      }
      if (!collided && Math.hypot(s.x - FIELD.width / 2, s.y - FIELD.height / 2) < DEBRIS_RANGE) remaining.push(s);
    }
    this.sparks = remaining;
    this.sparks.push(...fragments.slice(0, MAX_SPARKS - remaining.length));
    for (const r of this.rings) r.life -= dt;
    this.rings = this.rings.filter((r) => r.life > 0);
    for (const c of this.callouts) c.life -= dt;
    this.callouts = this.callouts.filter((c) => c.life > 0);
    for (const b of this.beams) b.life -= dt;
    this.beams = this.beams.filter((b) => b.life > 0);
    for (const l of this.lasers) l.life -= dt;
    this.lasers = this.lasers.filter((l) => l.life > 0);
    this.updateMotes(dt);
  }

  /** The shockwaves move on, and blow up each doomed ship they get to. */
  private updateNovas(dt: number): void {
    for (const nova of this.novas) {
      nova.age += dt;
      for (const d of nova.doomed) {
        if (d.done || nova.age < d.at) continue;
        d.done = true;
        const away = Math.atan2(d.y - nova.y, d.x - nova.x);
        this.explode(d.x, d.y, d.color, Math.cos(away) * 260, Math.sin(away) * 260);
        this.ring(d.x, d.y, 220, 1, COLORS.bone);
        this.burst(d.x, d.y, 60, 60, 420, COLORS.sodium, 'medium', Math.cos(away) * 300, Math.sin(away) * 300);
      }
      for (const p of nova.planets) {
        if (p.done || nova.age < p.at) continue;
        p.done = true;
        this.shatter(p.x, p.y, p.color, p.radius);
      }
    }
    this.novas = this.novas.filter((nova) => nova.age < NOVA_LIFE || nova.doomed.some((d) => !d.done) || nova.planets.some((p) => !p.done));
  }

  /** A ship that is as good as gone: its hull, glowing hotter (`heat`, 0 → 1) until what is coming for it gets there. */
  private drawDoomed(ctx: CanvasRenderingContext2D, d: { x: number; y: number; angle: number; color: string }, heat: number): void {
    ctx.save();
    ctx.translate(d.x, d.y);
    const glow = ctx.createRadialGradient(0, 0, 2, 0, 0, 22 + 26 * heat);
    glow.addColorStop(0, rgba('#fff4cc', 0.7 * heat));
    glow.addColorStop(1, rgba(COLORS.danger, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(-50, -50, 100, 100);
    ctx.rotate((-d.angle * Math.PI) / 180);
    ctx.beginPath();
    SHIP_HULL.forEach(([hx, hy], k) => (k ? ctx.lineTo(hx, hy) : ctx.moveTo(hx, hy)));
    ctx.closePath();
    ctx.fillStyle = d.color;
    ctx.fill();
    ctx.fillStyle = rgba('#fff4cc', heat * 0.85);
    ctx.fill();
    ctx.restore();
  }

  /**
   * The meteor shower of sudden death's finale: each meteor flies its path with a streak behind it, and where it lands it
   * blows up (a ship, if it is one's meteor; a small impact if not). The ships it takes stand on, glowing hotter, until then.
   */
  meteors(paths: { ship: number | null; planet: { x: number; y: number; radius: number; color: string } | null; angle: number; delay: number; points: number[]; color: string }[]): void {
    this.showers.push({
      age: 0,
      flights: paths.map((p) => ({ points: p.points, delay: p.delay, at: landing(p), color: p.color, angle: p.angle, doomed: p.ship !== null, planet: p.planet, done: false })),
    });
  }

  /** The meteors move on, and blow up where each lands. */
  private updateShowers(dt: number): void {
    for (const shower of this.showers) {
      shower.age += dt;
      for (const f of shower.flights) {
        if (f.done || shower.age < f.at) continue;
        f.done = true;
        const [x, y] = [f.points[f.points.length - 2], f.points[f.points.length - 1]];
        if (f.doomed) {
          this.explode(x, y, f.color, 0, 0);
          this.ring(x, y, 200, 0.9, COLORS.bone);
          this.burst(x, y, 50, 60, 380, COLORS.sodium, 'medium');
          if (!this.reducedMotion) this.shake = Math.max(this.shake, 12);
        } else if (f.planet) {
          this.shatter(f.planet.x, f.planet.y, f.planet.color, f.planet.radius);
          if (!this.reducedMotion) this.shake = Math.max(this.shake, 9);
        }
      }
    }
    this.showers = this.showers.filter((shower) => shower.flights.some((f) => !f.done) || shower.age < Math.max(...shower.flights.map((f) => f.at)) + 0.4);
  }

  private drawShower(ctx: CanvasRenderingContext2D, shower: Shower): void {
    for (const f of shower.flights) {
      const t = shower.age - f.delay;
      const last = f.points.length / 2 - 1;
      if (f.doomed && !f.done) {
        // Its ship waits at the end of the path.
        this.drawDoomed(ctx, { x: f.points[f.points.length - 2], y: f.points[f.points.length - 1], angle: f.angle, color: f.color }, Math.max(0, Math.min(1, t / Math.max(0.01, f.at - f.delay))));
      }
      if (f.done || t < 0) continue;
      const head = Math.min(last, t * SUDDEN_DEATH.METEORS.RATE);
      const i = Math.floor(head);
      const k = head - i;
      const at = (n: number): [number, number] => [f.points[2 * n], f.points[2 * n + 1]];
      const [x0, y0] = at(i);
      const [x1, y1] = at(Math.min(last, i + 1));
      const hx = x0 + (x1 - x0) * k;
      const hy = y0 + (y1 - y0) * k;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      // The streak: the samples behind the head, thinner and fainter the further back.
      let [px, py] = [hx, hy];
      for (let n = 0; n < METEOR_TAIL && i - n >= 0; n++) {
        const [qx, qy] = at(i - n);
        const fade = 1 - n / METEOR_TAIL;
        ctx.strokeStyle = rgba(n < 3 ? '#fff4cc' : COLORS.sodium, 0.75 * fade);
        ctx.lineWidth = 0.8 + 3.2 * fade;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(qx, qy);
        ctx.stroke();
        [px, py] = [qx, qy];
      }
      const glow = ctx.createRadialGradient(hx, hy, 0, hx, hy, 18);
      glow.addColorStop(0, rgba('#ffffff', 0.95));
      glow.addColorStop(0.35, rgba('#ffd79a', 0.5));
      glow.addColorStop(1, rgba(COLORS.danger, 0));
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(hx, hy, 18, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  /**
   * The UFO invasion of sudden death's finale: a saucer flies in from outside the field for each ship, settles near it,
   * charges, and zaps it (a few zap a planet instead). The ship it will take stands on, glowing hotter while it charges.
   */
  ufos(paths: { ship: number | null; planet: { x: number; y: number; radius: number; color: string } | null; angle: number; delay: number; points: number[]; charge: number; target: [number, number]; color: string }[]): void {
    this.invasions.push({
      age: 0,
      flights: paths.map((p) => ({ points: p.points, delay: p.delay, charge: p.charge, at: zapAt(p), target: p.target, color: p.color, angle: p.angle, doomed: p.ship !== null, planet: p.planet, done: false })),
    });
  }

  /** The saucers move on, and each zaps its target when it has charged. */
  private updateInvasions(dt: number): void {
    for (const invasion of this.invasions) {
      invasion.age += dt;
      for (const f of invasion.flights) {
        if (f.done || invasion.age < f.at) continue;
        f.done = true;
        const [sx, sy] = [f.points[f.points.length - 2], f.points[f.points.length - 1] + 6];
        const [tx, ty] = f.target;
        this.lasers.push({ x1: sx, y1: sy, x2: tx, y2: ty, life: 0.5, max: 0.5, color: UFO_GLOW, width: 7 });
        if (f.doomed) {
          this.explode(tx, ty, f.color, 0, 0);
          this.ring(tx, ty, 200, 0.9, COLORS.bone);
          this.burst(tx, ty, 50, 60, 380, UFO_GLOW, 'medium');
          if (!this.reducedMotion) this.shake = Math.max(this.shake, 12);
        } else if (f.planet) {
          this.shatter(f.planet.x, f.planet.y, f.planet.color, f.planet.radius);
          if (!this.reducedMotion) this.shake = Math.max(this.shake, 9);
        }
      }
    }
    this.invasions = this.invasions.filter((invasion) => invasion.age < Math.max(...invasion.flights.map((f) => f.at)) + UFO_LEAVE);
  }

  private drawInvasion(ctx: CanvasRenderingContext2D, invasion: Invasion): void {
    for (const f of invasion.flights) {
      const t = invasion.age - f.delay;
      if (t < 0) continue;
      const last = f.points.length / 2 - 1;
      const flight = last / SUDDEN_DEATH.UFOS.RATE;
      const head = Math.min(last, t * SUDDEN_DEATH.UFOS.RATE);
      const i = Math.floor(head);
      const k = head - i;
      const [x0, y0] = [f.points[2 * i], f.points[2 * i + 1]];
      const [x1, y1] = [f.points[2 * Math.min(last, i + 1)], f.points[2 * Math.min(last, i + 1) + 1]];
      // Charging starts when it has settled; after its zap it drifts up and fades.
      const charging = Math.max(0, Math.min(1, (t - flight) / Math.max(0.01, f.charge)));
      const gone = Math.max(0, invasion.age - f.at);
      const bob = t > flight ? Math.sin(invasion.age * 3 + f.delay * 7) * 2 : 0;
      const x = x0 + (x1 - x0) * k;
      const y = y0 + (y1 - y0) * k + bob - gone * 70;
      if (f.doomed && !f.done) this.drawDoomed(ctx, { x: f.target[0], y: f.target[1], angle: f.angle, color: f.color }, charging);
      if (charging > 0 && !f.done) {
        // The aim: a thin dashed line to the target that grows brighter as the beam charges.
        ctx.save();
        ctx.setLineDash([4, 6]);
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = rgba(UFO_GLOW, 0.12 + 0.5 * charging);
        ctx.beginPath();
        ctx.moveTo(x, y + 6);
        ctx.lineTo(f.target[0], f.target[1]);
        ctx.stroke();
        ctx.restore();
      }
      this.drawSaucer(ctx, x, y, Math.max(0, 1 - gone / UFO_LEAVE), invasion.age, charging);
    }
  }

  /** A flying saucer: a metal disc with a glass dome, blinking lights round its rim, and a glow beneath that swells as it charges. */
  private drawSaucer(ctx: CanvasRenderingContext2D, x: number, y: number, alpha: number, time: number, charging: number): void {
    ctx.save();
    ctx.translate(x, y);
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = 'lighter';
    const glow = ctx.createRadialGradient(0, 8, 0, 0, 8, 30 + 18 * charging);
    glow.addColorStop(0, rgba(UFO_GLOW, 0.3 + 0.45 * charging));
    glow.addColorStop(1, rgba(UFO_GLOW, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 8, 48, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    const body = ctx.createLinearGradient(0, -6, 0, 9);
    body.addColorStop(0, '#c7d3ea');
    body.addColorStop(0.55, '#6b7c9c');
    body.addColorStop(1, '#2c3650');
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.ellipse(0, 0, 24, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = rgba('#a8f5ff', 0.6);
    ctx.beginPath();
    ctx.ellipse(0, -3, 10, 8, 0, Math.PI, Math.PI * 2);
    ctx.fill();
    for (let n = 0; n < 5; n++) {
      ctx.fillStyle = Math.sin(time * 6 + n * 1.3) > 0 ? rgba(UFO_GLOW, 0.95) : rgba('#ffe08a', 0.55);
      ctx.beginPath();
      ctx.arc(-16 + 8 * n, 2.6, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawNova(ctx: CanvasRenderingContext2D, nova: Nova): void {
    const { x, y, age } = nova;
    const fade = Math.max(0, 1 - age / NOVA_LIFE);
    // The doomed ships, glowing hotter as the wave comes for them.
    for (const d of nova.doomed) if (!d.done) this.drawDoomed(ctx, d, Math.min(1, age / Math.max(0.01, d.at)));
    if (fade <= 0) return;
    ctx.globalCompositeOperation = 'lighter';
    // The core: a blinding ball that swells fast and burns out.
    const core = 40 + 340 * easeOut(Math.min(1, age / 0.7));
    const ball = ctx.createRadialGradient(x, y, 0, x, y, core);
    ball.addColorStop(0, rgba('#ffffff', fade));
    ball.addColorStop(0.25, rgba('#fff0c0', 0.85 * fade));
    ball.addColorStop(0.6, rgba(COLORS.sodium, 0.45 * fade));
    ball.addColorStop(1, rgba(COLORS.danger, 0));
    ctx.fillStyle = ball;
    ctx.beginPath();
    ctx.arc(x, y, core, 0, Math.PI * 2);
    ctx.fill();
    // The shockwaves: a white-hot front, and a slower, wider one of red plasma behind it.
    for (const [speed, width, inner, edge, strength] of [[1, 70, COLORS.sodium, '#ffffff', 1], [0.62, 140, COLORS.danger, '#ff8a2e', 0.8]] as const) {
      const front = SUDDEN_DEATH.NOVA_SPEED * speed * age;
      if (front < 4) continue;
      const band = ctx.createRadialGradient(x, y, Math.max(0, front - width), x, y, front + 12);
      band.addColorStop(0, rgba(inner, 0));
      band.addColorStop(0.7, rgba(inner, 0.45 * fade * strength));
      band.addColorStop(0.93, rgba(edge, 0.95 * fade * strength));
      band.addColorStop(1, rgba(edge, 0));
      ctx.fillStyle = band;
      ctx.beginPath();
      ctx.arc(x, y, front + 12, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  /** Pieces drift out for a moment, then steer at their ship and pulse on arrival. */
  private updateMotes(dt: number): void {
    const arrived: Mote[] = [];
    this.motes = this.motes.filter((m) => {
      m.age += dt;
      if (m.age < m.burst) {
        const drag = Math.exp(-5 * dt);
        m.vx *= drag;
        m.vy *= drag;
        m.x += m.vx * dt;
        m.y += m.vy * dt;
        return true;
      }
      const dx = m.target.x - m.x;
      const dy = m.target.y - m.y;
      const d = Math.hypot(dx, dy);
      if (d < 12) {
        arrived.push(m);
        return false;
      }
      m.speed = Math.min(MOTE_SPEED, m.speed + 2400 * dt);
      const blend = Math.min(1, 8 * dt);
      m.vx += ((dx / d) * m.speed - m.vx) * blend;
      m.vy += ((dy / d) * m.speed - m.vy) * blend;
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      return true;
    });
    for (const m of arrived) this.ring(m.target.x, m.target.y, 16, 0.28, m.color);
  }

  draw(ctx: CanvasRenderingContext2D): void {
    for (const nova of this.novas) this.drawNova(ctx, nova);
    for (const shower of this.showers) this.drawShower(ctx, shower);
    for (const invasion of this.invasions) this.drawInvasion(ctx, invasion);
    for (const r of this.rings) {
      const t = 1 - r.life / r.max;
      const radius = r.inward ? r.radius * (1 - easeOut(t)) : r.radius * easeOut(t);
      ctx.beginPath();
      ctx.arc(r.x, r.y, Math.max(0, radius), 0, Math.PI * 2);
      ctx.strokeStyle = rgba(r.color, 0.8 * (1 - t));
      ctx.lineWidth = 1.5 + 2 * (1 - t);
      ctx.stroke();
    }
    for (const b of this.beams) {
      const t = 1 - b.life / b.max;
      ctx.beginPath();
      ctx.moveTo(b.x1, b.y1);
      ctx.lineTo(b.x2, b.y2);
      ctx.strokeStyle = rgba(b.color, 0.7 * (1 - t));
      ctx.lineWidth = 3 * (1 - t) + 0.5;
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'lighter';
    for (const l of this.lasers) {
      const t = 1 - l.life / l.max;
      // It snaps on, holds, then thins and fades out.
      const on = Math.min(1, t / 0.1);
      const fade = 1 - Math.max(0, (t - 0.5) / 0.5);
      const a = on * fade;
      const w = l.width * (0.4 + 0.6 * on) * (0.45 + 0.55 * fade);
      ctx.lineCap = 'round';
      const line = (width: number, style: string): void => {
        ctx.beginPath();
        ctx.moveTo(l.x1, l.y1);
        ctx.lineTo(l.x2, l.y2);
        ctx.lineWidth = width;
        ctx.strokeStyle = style;
        ctx.stroke();
      };
      line(w * 2.6, rgba(l.color, 0.28 * a));
      line(w, rgba(l.color, 0.85 * a));
      line(Math.max(1, w * 0.34), rgba(COLORS.bone, 0.95 * a));
    }
    for (const s of this.sparks) {
      ctx.globalAlpha = s.life !== undefined ? Math.min(1, s.life / 0.35) : 1;
      ctx.fillStyle = s.color;
      ctx.fillRect(s.x - s.size / 2, s.y - s.size / 2, s.size, s.size);
    }
    ctx.globalAlpha = 1;
    for (const m of this.motes) {
      ctx.fillStyle = m.color;
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const c of this.callouts) {
      const t = 1 - c.life / c.max;
      const pop = t < 0.12 ? 1.35 - (t / 0.12) * 0.35 : 1;
      const alpha = t > 0.6 ? 1 - (t - 0.6) / 0.4 : 1;
      const size = (c.big ? 22 : 15) * pop;
      ctx.font = `800 ${size}px ${FONTS.display}`;
      const y = c.y - 18 - t * 26;
      ctx.lineWidth = 3;
      ctx.strokeStyle = rgba(COLORS.plate, 0.85 * alpha);
      strokeTextUpright(ctx, c.text, c.x, y);
      ctx.fillStyle = rgba(c.color, alpha);
      fillTextUpright(ctx, c.text, c.x, y);
    }
  }

  private burst(x: number, y: number, count: number, minSpeed: number, maxSpeed: number, color: string, tier: SparkTier = 'medium', inheritedVx = 0, inheritedVy = 0, life?: number): void {
    if (!this.particles) return;
    for (let i = 0; i < count && this.sparks.length < MAX_SPARKS; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = minSpeed + Math.random() * (maxSpeed - minSpeed);
      const spark = this.spark(x, y, Math.cos(a) * sp + inheritedVx, Math.sin(a) * sp + inheritedVy, color, tier);
      if (life !== undefined) spark.life = life * (0.7 + Math.random() * 0.3);
      this.sparks.push(spark);
    }
  }

  /** Sparks born at random places across a disc of `radius` and thrown straight out from its centre. They live on until the round ends. */
  private debris(x: number, y: number, radius: number, count: number, minSpeed: number, maxSpeed: number, color: string, tier: SparkTier): void {
    if (!this.particles) return;
    for (let i = 0; i < count && this.sparks.length < MAX_SPARKS; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * radius;
      const sp = minSpeed + Math.random() * (maxSpeed - minSpeed);
      this.sparks.push(this.spark(x + Math.cos(a) * r, y + Math.sin(a) * r, Math.cos(a) * sp, Math.sin(a) * sp, color, tier));
    }
  }

  private cone(x: number, y: number, angle: number, count: number, color: string): void {
    if (!this.particles) return;
    for (let i = 0; i < count && this.sparks.length < MAX_SPARKS; i++) {
      const a = angle + (Math.random() - 0.5) * 0.7;
      const sp = 60 + Math.random() * 160;
      this.sparks.push(this.spark(x, y, Math.cos(a) * sp, -Math.sin(a) * sp, color, 'small'));
    }
  }

  private spark(x: number, y: number, vx: number, vy: number, color: string, tier: SparkTier): Spark {
    const size = tier === 'large' ? 2.4 + Math.random() * 2 : tier === 'medium' ? 1.6 + Math.random() * 1.5 : 0.8 + Math.random() * 1.2;
    return { x, y, vx, vy, size, color, drag: this.sparkDrag, tier };
  }

  private fragment(spark: Spark, into: Spark[], body: GravityBody): void {
    if (!this.particles || spark.tier === 'small' || into.length >= MAX_SPARKS) return;
    let nx = spark.x - body.x;
    let ny = spark.y - body.y;
    const distance = Math.hypot(nx, ny);
    if (distance < 1e-6) {
      nx = -spark.vx;
      ny = -spark.vy;
    }
    const normalLength = Math.hypot(nx, ny) || 1;
    nx /= normalLength;
    ny /= normalLength;
    const count = 1 + (Math.random() < 0.35 ? 1 : 0);
    for (let i = 0; i < count && into.length < MAX_SPARKS; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = (30 + Math.random() * 70) * 1.5;
      const tier: SparkTier = spark.tier === 'large' && Math.random() < 0.65 ? 'medium' : 'small';
      const child = this.spark(
        body.x + nx * (body.radius + 3 + spark.size),
        body.y + ny * (body.radius + 3 + spark.size),
        Math.cos(angle) * speed,
        Math.sin(angle) * speed,
        spark.color,
        tier,
      );
      into.push(child);
    }
  }

  private collidingBody(spark: Spark, world: World): GravityBody | null {
    for (const body of world.planets) {
      if (Math.hypot(body.x - spark.x, body.y - spark.y) <= body.radius) return body;
    }
    return world.holes.find((hole) => Math.hypot(hole.x - spark.x, hole.y - spark.y) <= hole.radius) ?? null;
  }

  private ring(x: number, y: number, radius: number, life: number, color: string): void {
    this.rings.push({ x, y, radius, life, max: life, color, inward: false });
  }
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
