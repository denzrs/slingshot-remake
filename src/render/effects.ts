import { COLORS, FONTS } from '../config';
import { rgba } from './color';

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  drag: number;
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

  explode(x: number, y: number, color: string): void {
    this.ring(x, y, 90, 0.7, color);
    this.ring(x, y, 150, 1.1, COLORS.sodium);
    this.burst(x, y, 110, 40, 360, color, 1.6);
    this.burst(x, y, 70, 20, 220, COLORS.sodium, 1.2);
    this.burst(x, y, 30, 10, 90, COLORS.bone, 2.2);
    if (!this.reducedMotion) this.shake = 11;
    this.flash = 1;
  }

  impact(x: number, y: number, color: string): void {
    this.ring(x, y, 26, 0.45, COLORS.bone);
    this.burst(x, y, 26, 20, 140, color, 0.8);
    this.burst(x, y, 12, 10, 70, COLORS.boneDim, 1.1);
    if (!this.reducedMotion) this.shake = Math.max(this.shake, 2.5);
  }

  muzzle(x: number, y: number, angleDeg: number, color: string): void {
    const a = (angleDeg * Math.PI) / 180;
    this.ring(x, y, 14, 0.3, color);
    this.cone(x, y, a, 12, color);
  }

  fizzle(x: number, y: number, color: string): void {
    this.burst(x, y, 10, 10, 60, color, 0.7);
  }

  /** Two projectiles annihilating each other. */
  clash(x: number, y: number, a: string, b: string): void {
    this.ring(x, y, 46, 0.5, COLORS.bone);
    this.burst(x, y, 30, 40, 260, a, 0.9);
    this.burst(x, y, 30, 40, 260, b, 0.9);
    this.flash = Math.max(this.flash, 0.45);
    if (!this.reducedMotion) this.shake = Math.max(this.shake, 4);
  }

  /** Matter spiralling into the black hole. */
  devour(x: number, y: number, toX: number, toY: number, color: string): void {
    if (!this.particles) return;
    const d = Math.hypot(toX - x, toY - y) || 1;
    const nx = (toX - x) / d;
    const ny = (toY - y) / d;
    for (let i = 0; i < 36; i++) {
      const sp = 120 + Math.random() * 260;
      const swirl = (Math.random() - 0.3) * 160;
      const ox = (Math.random() - 0.5) * 30;
      const oy = (Math.random() - 0.5) * 30;
      this.sparks.push({
        x: x + ox,
        y: y + oy,
        vx: nx * sp - ny * swirl,
        vy: ny * sp + nx * swirl,
        life: 0.5 + Math.random() * 0.6,
        max: 1.1,
        size: 1.2 + Math.random() * 2,
        color: Math.random() < 0.3 ? COLORS.sodium : color,
        drag: 0.6,
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

  update(dt: number): void {
    this.shake = Math.max(0, this.shake - dt * 30);
    this.flash = Math.max(0, this.flash - dt * 2.5);
    for (const s of this.sparks) {
      s.life -= dt;
      const k = Math.exp(-s.drag * dt);
      s.vx *= k;
      s.vy *= k;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
    }
    this.sparks = this.sparks.filter((s) => s.life > 0);
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
      const t = s.life / s.max;
      ctx.fillStyle = rgba(s.color, Math.min(1, t * 1.4));
      const size = s.size * (0.4 + 0.6 * t);
      ctx.fillRect(s.x - size / 2, s.y - size / 2, size, size);
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

  private burst(x: number, y: number, count: number, minSpeed: number, maxSpeed: number, color: string, life: number): void {
    if (!this.particles) return;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = minSpeed + Math.random() * (maxSpeed - minSpeed);
      this.spark(x, y, Math.cos(a) * sp, Math.sin(a) * sp, life * (0.4 + Math.random() * 0.6), color);
    }
  }

  private cone(x: number, y: number, angle: number, count: number, color: string): void {
    if (!this.particles) return;
    for (let i = 0; i < count; i++) {
      const a = angle + (Math.random() - 0.5) * 0.7;
      const sp = 60 + Math.random() * 160;
      this.spark(x, y, Math.cos(a) * sp, -Math.sin(a) * sp, 0.25 + Math.random() * 0.25, color);
    }
  }

  private spark(x: number, y: number, vx: number, vy: number, life: number, color: string): void {
    this.sparks.push({ x, y, vx, vy, life, max: life, size: 1.2 + Math.random() * 2.2, color, drag: 2.2 });
  }

  private ring(x: number, y: number, radius: number, life: number, color: string): void {
    this.rings.push({ x, y, radius, life, max: life, color, inward: false });
  }
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
