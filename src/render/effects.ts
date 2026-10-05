import { COLORS, FONTS, PHYSICS } from '../config';
import type { World } from '../physics';
import { rgba } from './color';

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
}

interface GravityBody {
  x: number;
  y: number;
  radius: number;
}

const MAX_SPARKS = 1800;

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
  shake = 0;
  flash = 0;

  constructor(
    public particles: boolean,
    private readonly reducedMotion: boolean,
  ) {}

  clear(): void {
    this.sparks = [];
    this.rings = [];
    this.callouts = [];
    this.shake = 0;
    this.flash = 0;
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
        drag: 0.24,
        tier: 'medium',
      });
    }
  }

  /** The horizon swelling: a ring that contracts onto the hole. */
  collapse(x: number, y: number): void {
    this.rings.push({ x, y, radius: 220, life: 1.2, max: 1.2, color: COLORS.danger, inward: true });
    if (!this.reducedMotion) this.shake = Math.max(this.shake, 3);
  }

  /** Floating text, e.g. "SWING-BY ×1,5" or "+820". */
  callout(text: string, x: number, y: number, color: string, big = false): void {
    this.callouts.push({ text, x, y, color, life: big ? 1.8 : 1.4, max: big ? 1.8 : 1.4, big });
  }

  update(dt: number, world: World): void {
    this.shake = Math.max(0, this.shake - dt * 30);
    this.flash = Math.max(0, this.flash - dt * 2.5);
    const fragments: Spark[] = [];
    const remaining: Spark[] = [];
    const steps = Math.max(1, Math.ceil(dt / PHYSICS.DT));
    const step = dt / steps;
    for (const s of this.sparks) {
      let collided = false;
      for (let i = 0; i < steps; i++) {
        let ax = 0;
        let ay = 0;
        for (const body of world.planets) {
          const dx = body.x - s.x;
          const dy = body.y - s.y;
          const d2 = Math.max(64, dx * dx + dy * dy);
          const a = (PHYSICS.G * body.mass) / (d2 * Math.sqrt(d2));
          ax += a * dx;
          ay += a * dy;
        }
        if (world.hole) {
          const dx = world.hole.x - s.x;
          const dy = world.hole.y - s.y;
          const d2 = Math.max(64, dx * dx + dy * dy);
          const a = (PHYSICS.G * world.hole.mass) / (d2 * Math.sqrt(d2));
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
      if (!collided) remaining.push(s);
    }
    this.sparks = remaining;
    this.sparks.push(...fragments.slice(0, MAX_SPARKS - remaining.length));
    for (const r of this.rings) r.life -= dt;
    this.rings = this.rings.filter((r) => r.life > 0);
    for (const c of this.callouts) c.life -= dt;
    this.callouts = this.callouts.filter((c) => c.life > 0);
  }

  draw(ctx: CanvasRenderingContext2D): void {
    for (const r of this.rings) {
      const t = 1 - r.life / r.max;
      const radius = r.inward ? r.radius * (1 - easeOut(t)) : r.radius * easeOut(t);
      ctx.beginPath();
      ctx.arc(r.x, r.y, Math.max(0, radius), 0, Math.PI * 2);
      ctx.strokeStyle = rgba(r.color, 0.8 * (1 - t));
      ctx.lineWidth = 1.5 + 2 * (1 - t);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'lighter';
    for (const s of this.sparks) {
      ctx.fillStyle = s.color;
      ctx.fillRect(s.x - s.size / 2, s.y - s.size / 2, s.size, s.size);
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
      ctx.strokeText(c.text, c.x, y);
      ctx.fillStyle = rgba(c.color, alpha);
      ctx.fillText(c.text, c.x, y);
    }
  }

  private burst(x: number, y: number, count: number, minSpeed: number, maxSpeed: number, color: string, tier: SparkTier = 'medium', inheritedVx = 0, inheritedVy = 0): void {
    if (!this.particles) return;
    for (let i = 0; i < count && this.sparks.length < MAX_SPARKS; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = minSpeed + Math.random() * (maxSpeed - minSpeed);
      this.sparks.push(this.spark(x, y, Math.cos(a) * sp + inheritedVx, Math.sin(a) * sp + inheritedVy, color, tier));
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
    return { x, y, vx, vy, size, color, drag: 0.12, tier };
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
    const hole = world.hole;
    return hole && Math.hypot(hole.x - spark.x, hole.y - spark.y) <= hole.radius ? hole : null;
  }

  private ring(x: number, y: number, radius: number, life: number, color: string): void {
    this.rings.push({ x, y, radius, life, max: life, color, inward: false });
  }
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
