import { COLORS, FONTS, GHOST } from '../config';
import { aimDirection, type Shot } from '../physics';
import { fmt, t, type Key } from '../i18n';
import type { GhostLane, LaneEvent, LaneResult, Rock } from '../ghost';
import { rgba } from './color';
import { setSpacing } from './text';

/** The ghost's body, the same one that sits next to the version on the title screen. */
export const GHOST_BODY = new Path2D('M3 19V10a7 7 0 0 1 14 0v9l-2.33-2-2.34 2-2.33-2-2.33 2-2.34-2-2.33 2z');

/** The sayings of a result: `quip` picks one, the same for every ghost. */
const SAY: Record<LaneResult['kind'], readonly Key[]> = {
  cleared: ['ghost.cleared.0', 'ghost.cleared.1', 'ghost.cleared.2'],
  chain: ['ghost.chain.0', 'ghost.chain.1'],
  boom: ['ghost.boom.0', 'ghost.boom.1'],
  dud: ['ghost.dud.0', 'ghost.dud.1'],
  out: ['ghost.out.0', 'ghost.out.1'],
};

/** Height of the header and the footer in units of a 320-pixel-wide panel; the field fills what is between at the lane's aspect ratio. */
const HEADER = 46;
const FOOTER = 16;
/** Seconds a saying stays on the field. */
const SAY_SECONDS = 1.9;
/** Seconds the chain counter stays after the last thing went up. */
const COMBO_SECONDS = 1.1;
const CONFETTI = 60;

/** The look of the things that blow up. */
const FIRE: Record<LaneEvent['kind'], string> = { rock: COLORS.bone, bomb: COLORS.danger, gold: COLORS.sodium, planet: COLORS.sodium };

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  size: number;
  tint: string;
  /** Pulled towards the black hole. */
  fed: boolean;
}

interface Ring {
  x: number;
  y: number;
  radius: number;
  age: number;
  life: number;
  tint: string;
}

interface Confetti {
  x: number;
  y: number;
  vx: number;
  vy: number;
  spin: number;
  size: number;
  age: number;
  tint: string;
}

export interface GhostDrawOptions {
  /** The ghost's own colour: the ship, the trails and the confetti. */
  color: string;
  /** The match is in a killcam / between rounds: the lane waits. */
  paused: boolean;
  /** Touch device: no keys to show. */
  touch: boolean;
  /** The panel is in its big size. */
  big: boolean;
  reducedMotion: boolean;
}

/**
 * The ghost lane's panel: a canvas of its own, drawn in a few strokes. The main renderer is tied to
 * the window size, so it is no use here.
 */
export class GhostPanel {
  private readonly ctx: CanvasRenderingContext2D;
  private k = 1;
  private scale = 1;
  private offsetX = 0;
  private offsetY = 0;
  private cssWidth = 0;
  private cssHeight = 0;
  private time = 0;
  /** The header's buttons in CSS pixels of the panel, as drawn last. */
  private closeBox = { x: 0, y: 0, size: 0 };
  private bigBox = { x: 0, y: 0, size: 0 };
  private confetti: Confetti[] = [];
  private sparks: Spark[] = [];
  private rings: Ring[] = [];
  /** How hard the field shakes after a planet went up. */
  private shake = 0;
  /** The result on show and since when; null until the first one of this lane. */
  private said: { lane: GhostLane; id: number; since: number } | null = null;
  /** The shapes of the rocks, made once. */
  private readonly shapes = new WeakMap<Rock, Path2D>();

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  /** Convert a pointer position (client px) into field coordinates of the lane. */
  toField(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const px = ((clientX - rect.left) / rect.width) * this.cssWidth;
    const py = ((clientY - rect.top) / rect.height) * this.cssHeight;
    return { x: (px - this.offsetX) / this.scale, y: (py - this.offsetY) / this.scale };
  }

  private over(box: { x: number; y: number; size: number }, clientX: number, clientY: number): boolean {
    const rect = this.canvas.getBoundingClientRect();
    const px = ((clientX - rect.left) / rect.width) * this.cssWidth;
    const py = ((clientY - rect.top) / rect.height) * this.cssHeight;
    // A little margin around the icon: it is small, and a finger is not.
    const m = 4 * this.k;
    return px >= box.x - m && px <= box.x + box.size + m && py >= box.y - m && py <= box.y + box.size + m;
  }

  /** Whether a pointer position (client px) is over the close button. */
  isClose(clientX: number, clientY: number): boolean {
    return this.over(this.closeBox, clientX, clientY);
  }

  /** Whether a pointer position (client px) is over the button that makes the panel bigger or smaller. */
  isBig(clientX: number, clientY: number): boolean {
    return this.over(this.bigBox, clientX, clientY);
  }

  /** Forget what was on show, so the next lane starts without leftover confetti. */
  reset(): void {
    this.confetti = [];
    this.sparks = [];
    this.rings = [];
    this.shake = 0;
    this.said = null;
  }

  /** Draws the lane and returns what blew up since the last frame, for the sound. */
  draw(lane: GhostLane, opts: GhostDrawOptions, dt: number): LaneEvent[] {
    this.fit();
    const { ctx, cssWidth: w, cssHeight: h, k } = this;
    this.time += dt;
    const events = this.watch(lane, opts);
    this.step(lane, dt);

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = rgba(COLORS.plate, 0.92);
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = rgba(opts.color, 0.55);
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);

    this.drawHeader(lane, opts);

    const fieldH = GHOST.HEIGHT * this.scale;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, this.offsetY, w, fieldH);
    ctx.clip();
    const jitter = opts.reducedMotion ? 0 : this.shake * 7 * this.scale;
    ctx.translate(this.offsetX + (Math.random() - 0.5) * jitter, this.offsetY + (Math.random() - 0.5) * jitter);
    ctx.scale(this.scale, this.scale);
    this.drawField(lane, opts);
    this.drawEffects();
    this.drawConfetti();
    ctx.restore();

    this.drawOverlay(lane);
    this.drawSaying(lane);
    this.drawFooter(lane, opts);
    if (opts.paused) {
      ctx.fillStyle = rgba(COLORS.plate, 0.6);
      ctx.fillRect(0, this.offsetY, w, fieldH);
      ctx.fillStyle = COLORS.bone;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `800 ${22 * k}px ${FONTS.display}`;
      setSpacing(ctx, 3 * k);
      ctx.fillText(t('ghost.paused').toUpperCase(), w / 2, this.offsetY + fieldH / 2);
      setSpacing(ctx, 0);
    }
    return events;
  }

  /** Sizes the backing store to the CSS box (re-read every frame: the panel is sized by the stylesheet). */
  private fit(): void {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.cssWidth = rect.width;
    this.cssHeight = rect.height;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.k = rect.width / 320;
    this.offsetY = HEADER * this.k;
    this.scale = Math.min(rect.width / GHOST.WIDTH, (rect.height - (HEADER + FOOTER) * this.k) / GHOST.HEIGHT);
    this.offsetX = (rect.width - GHOST.WIDTH * this.scale) / 2;
  }

  // ————————————————————————————— What happens —————————————————————————————

  /** Notices what blew up and the new result: fire and debris for the first, a saying (and confetti for a cleared lane) for the second. */
  private watch(lane: GhostLane, opts: GhostDrawOptions): LaneEvent[] {
    if (this.said && this.said.lane !== lane) this.reset();
    const events = lane.takeEvents();
    for (const e of events) this.explode(e, lane, opts.reducedMotion);
    const r = lane.result;
    if (r && this.said?.id !== r.id) {
      this.said = { lane, id: r.id, since: this.time };
      if (r.kind === 'cleared' && !opts.reducedMotion) this.burst(opts.color);
    }
    return events;
  }

  private explode(e: LaneEvent, lane: GhostLane, reduced: boolean): void {
    const tint = FIRE[e.kind];
    const big = e.kind === 'planet';
    this.rings.push({ x: e.x, y: e.y, radius: e.blast * (big ? 1 : 0.75), age: 0, life: big ? 0.7 : 0.38, tint });
    if (big) {
      this.rings.push({ x: e.x, y: e.y, radius: e.blast * 0.55, age: -0.08, life: 0.5, tint: COLORS.bone });
      if (!reduced) this.shake = Math.min(1.4, this.shake + 1);
    } else if (e.kind === 'bomb' && !reduced) {
      this.shake = Math.min(1.4, this.shake + 0.35);
    }
    if (reduced) return;
    const hole = lane.world.holes[0];
    const count = big ? 70 : e.kind === 'bomb' ? 22 : e.kind === 'gold' ? 26 : 10;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = (big ? 60 : 40) + Math.random() * (big ? 360 : 220);
      // A planet's wreckage is chunks of the planet itself.
      const chunk = big && i < 24;
      this.sparks.push({
        x: e.x + Math.cos(a) * (big ? Math.random() * e.radius : 0),
        y: e.y + Math.sin(a) * (big ? Math.random() * e.radius : 0),
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        age: 0,
        life: 0.5 + Math.random() * (big ? 1.1 : 0.7),
        size: chunk ? 5 + Math.random() * 9 : 2 + Math.random() * (e.kind === 'rock' ? 3 : 4.5),
        tint: chunk ? e.tint : [tint, COLORS.bone, COLORS.sodium][i % 3],
        fed: e.fed && !!hole,
      });
    }
  }

  private burst(color: string): void {
    const x = GHOST.WIDTH / 2;
    const y = GHOST.HEIGHT / 2;
    const tints = [color, COLORS.bone, COLORS.sodium];
    for (let i = 0; i < CONFETTI; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = 160 + Math.random() * 420;
      this.confetti.push({
        x,
        y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed - 200,
        spin: (Math.random() - 0.5) * 14,
        size: 6 + Math.random() * 8,
        age: Math.random() * 0.2,
        tint: tints[i % tints.length],
      });
    }
  }

  private step(lane: GhostLane, dt: number): void {
    this.shake = Math.max(0, this.shake - dt * 2.4);
    const hole = lane.world.holes[0];
    for (const s of this.sparks) {
      s.age += dt;
      if (s.fed && hole) {
        // The black hole drinks it.
        const dx = hole.x - s.x;
        const dy = hole.y - s.y;
        const d = Math.hypot(dx, dy) || 1;
        s.vx += (dx / d) * 900 * dt;
        s.vy += (dy / d) * 900 * dt;
        if (d < hole.radius) s.age = s.life;
      }
      s.vx *= 1 - 1.6 * dt;
      s.vy *= 1 - 1.6 * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
    }
    this.sparks = this.sparks.filter((s) => s.age < s.life);
    for (const r of this.rings) r.age += dt;
    this.rings = this.rings.filter((r) => r.age < r.life);
    for (const c of this.confetti) {
      c.age += dt;
      c.vy += 620 * dt;
      c.vx *= 1 - 1.4 * dt;
      c.x += c.vx * dt;
      c.y += c.vy * dt;
    }
    this.confetti = this.confetti.filter((c) => c.age < 1.6);
  }

  // ————————————————————————————— The field —————————————————————————————

  private drawField(lane: GhostLane, opts: GhostDrawOptions): void {
    const { ctx } = this;
    const { world } = lane;
    ctx.lineJoin = 'round';

    for (const hole of world.holes) this.drawHole(hole);
    for (const p of world.planets) {
      if (p.radius <= 0) continue;
      const g = ctx.createRadialGradient(p.x - p.radius * 0.35, p.y - p.radius * 0.35, p.radius * 0.1, p.x, p.y, p.radius);
      g.addColorStop(0, rgba(p.tint, 0.9));
      g.addColorStop(1, rgba(p.tint, 0.38));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const rock of lane.rocks) if (rock.alive) this.drawRock(lane, rock);

    // Earlier shots of this lane stay on the board as faint mist, the way trails do in the real game.
    ctx.lineWidth = 3;
    ctx.strokeStyle = rgba(opts.color, 0.2);
    for (const path of lane.oldPaths) this.trace(path);
    if (lane.phase === 'flying' || lane.phase === 'cleared') this.drawMist(lane.path, opts.color);
    if (lane.shot && !lane.shot.end) this.drawWisp(lane.shot, lane.path, opts);

    const me = world.ships[0];
    if (lane.canAim) this.drawAim(lane, opts);
    this.drawGhostShip(me.x, me.y, lane.angle, opts.color);
  }

  private drawHole(hole: { x: number; y: number; radius: number }): void {
    const { ctx } = this;
    const spin = this.time * 0.9;
    const glow = ctx.createRadialGradient(hole.x, hole.y, hole.radius * 0.6, hole.x, hole.y, hole.radius * 4.2);
    glow.addColorStop(0, rgba(COLORS.sodium, 0.38));
    glow.addColorStop(1, rgba(COLORS.sodium, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(hole.x, hole.y, hole.radius * 4.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = rgba(COLORS.sodium, 0.7);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(hole.x, hole.y, hole.radius * 1.9, hole.radius * 0.8, spin * 0.2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#02050b';
    ctx.beginPath();
    ctx.arc(hole.x, hole.y, hole.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = rgba(COLORS.bone, 0.6);
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  /** A rock: an irregular lump, a red bomb with a spitting fuse, or the golden star; the cores glow. */
  private drawRock(lane: GhostLane, rock: Rock): void {
    const { ctx } = this;
    const lit = lane.isLit(rock);
    const flick = lit ? (Math.sin(this.time * 60 + rock.id) > 0 ? 1 : 0.35) : 1;
    ctx.save();
    ctx.translate(rock.x, rock.y);

    if (rock.core) {
      // A glowing core: a pulse around it says "this one".
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 4 + rock.id);
      ctx.strokeStyle = rgba(COLORS.sodium, 0.35 + 0.4 * pulse);
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, 0, rock.r + 6 + pulse * 3, 0, Math.PI * 2);
      ctx.stroke();
    }

    let shape = this.shapes.get(rock);
    if (!shape) {
      shape = this.shape(rock);
      this.shapes.set(rock, shape);
    }
    if (rock.kind === 'bomb') {
      ctx.fillStyle = rgba(COLORS.danger, 0.85 * flick);
      ctx.strokeStyle = rgba(COLORS.bone, 0.9);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, rock.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // The fuse, with a spark that dances.
      const spark = Math.sin(this.time * 14 + rock.id) * 2;
      ctx.strokeStyle = COLORS.bone;
      ctx.beginPath();
      ctx.moveTo(rock.r * 0.3, -rock.r * 0.8);
      ctx.quadraticCurveTo(rock.r * 0.9, -rock.r * 1.3, rock.r * 0.6, -rock.r * 1.55);
      ctx.stroke();
      ctx.fillStyle = COLORS.sodium;
      ctx.beginPath();
      ctx.arc(rock.r * 0.6 + spark, -rock.r * 1.6, 3.2, 0, Math.PI * 2);
      ctx.fill();
    } else if (rock.kind === 'gold') {
      ctx.shadowColor = COLORS.sodium;
      ctx.shadowBlur = 14;
      ctx.fillStyle = rgba(COLORS.sodium, 0.95 * flick);
      ctx.strokeStyle = COLORS.bone;
      ctx.lineWidth = 2;
      ctx.rotate(this.time * 0.6);
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = (i * Math.PI) / 5 - Math.PI / 2;
        const r = i % 2 ? rock.r * 0.5 : rock.r * 1.15;
        ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.fillStyle = lit ? rgba(COLORS.bone, flick) : rgba(COLORS.line, rock.core ? 0.95 : 0.7);
      ctx.fill(shape);
      ctx.strokeStyle = rgba(COLORS.bone, rock.core ? 0.95 : 0.55);
      ctx.lineWidth = rock.core ? 2.5 : 1.8;
      ctx.stroke(shape);
      if (rock.core) {
        ctx.fillStyle = COLORS.sodium;
        ctx.beginPath();
        ctx.arc(0, 0, rock.r * 0.28, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  /** An irregular lump, the same one every frame. */
  private shape(rock: Rock): Path2D {
    const path = new Path2D();
    const n = 8;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      // A cheap, stable wobble out of the rock's id.
      const wobble = 0.82 + 0.28 * Math.abs(Math.sin(rock.id * 12.9898 + i * 78.233));
      const x = Math.cos(a) * rock.r * wobble;
      const y = Math.sin(a) * rock.r * wobble;
      if (i === 0) path.moveTo(x, y);
      else path.lineTo(x, y);
    }
    path.closePath();
    return path;
  }

  /** The blasts: rings that spread, and the debris. */
  private drawEffects(): void {
    const { ctx } = this;
    for (const r of this.rings) {
      if (r.age < 0) continue;
      const f = r.age / r.life;
      ctx.globalAlpha = (1 - f) * 0.9;
      ctx.strokeStyle = r.tint;
      ctx.lineWidth = 5 * (1 - f) + 1;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.radius * (0.25 + 0.75 * Math.sqrt(f)), 0, Math.PI * 2);
      ctx.stroke();
      if (f < 0.35) {
        ctx.globalAlpha = (0.35 - f) * 1.6;
        ctx.fillStyle = r.tint;
        ctx.beginPath();
        ctx.arc(r.x, r.y, r.radius * (0.2 + f), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    for (const s of this.sparks) {
      const f = s.age / s.life;
      ctx.globalAlpha = Math.min(1, (1 - f) * 1.6);
      ctx.fillStyle = s.tint;
      const size = s.size * (1 - 0.5 * f);
      ctx.fillRect(s.x - size / 2, s.y - size / 2, size, size);
    }
    ctx.globalAlpha = 1;
  }

  /** The wisp's trail: thin and faint at the start, thick and bright by the flame. */
  private drawMist(points: number[], color: string): void {
    const { ctx } = this;
    const n = points.length / 2 - 1;
    for (let i = 0; i < n; i++) {
      const f = (i + 1) / n;
      ctx.strokeStyle = rgba(color, 0.07 + 0.6 * f * f);
      ctx.lineWidth = 2 + 6 * f;
      ctx.beginPath();
      ctx.moveTo(points[i * 2], points[i * 2 + 1]);
      ctx.lineTo(points[i * 2 + 2], points[i * 2 + 3]);
      ctx.stroke();
    }
  }

  /** The shot as a will-o'-the-wisp: a flickering flame that trails away from its flight, with a few sparks drifting in its wake. */
  private drawWisp(shot: Shot, path: number[], opts: GhostDrawOptions): void {
    const { ctx } = this;
    const time = this.time;
    const flick = opts.reducedMotion ? 0 : Math.sin(time * 38) * 0.12 + Math.sin(time * 23 + 1) * 0.08;
    const speed = Math.hypot(shot.vx, shot.vy) || 1;
    const dx = shot.vx / speed;
    const dy = shot.vy / speed;

    const size = 1.15;
    ctx.save();
    ctx.translate(shot.x, shot.y);
    ctx.scale(size, size);
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 28 * (1 + flick));
    glow.addColorStop(0, rgba(COLORS.bone, 0.55));
    glow.addColorStop(0.35, rgba(opts.color, 0.35));
    glow.addColorStop(1, rgba(opts.color, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, 28 * (1 + flick), 0, Math.PI * 2);
    ctx.fill();

    // A teardrop with its round head forward; the tail licks about behind.
    ctx.rotate(Math.atan2(shot.vy, shot.vx));
    const tail = -26 * (1 + flick * 2);
    const lick = opts.reducedMotion ? 0 : Math.sin(time * 30) * 3;
    const drop = (scale: number): void => {
      ctx.beginPath();
      ctx.moveTo(tail * scale, lick * scale);
      ctx.quadraticCurveTo(-9 * scale, -8 * scale, 0, -7 * scale);
      ctx.arc(0, 0, 7 * scale, -Math.PI / 2, Math.PI / 2);
      ctx.quadraticCurveTo(-9 * scale, 8 * scale, tail * scale, lick * scale);
      ctx.closePath();
    };
    ctx.fillStyle = rgba(opts.color, 0.85);
    drop(1);
    ctx.fill();
    ctx.fillStyle = rgba(COLORS.bone, 0.95);
    drop(0.5);
    ctx.fill();
    ctx.restore();

    // Sparks, shaken off the flame and left behind on the path.
    const last = path.length / 2 - 1;
    for (let k = 1; k <= 5; k++) {
      const i = last - k * 5;
      if (i < 0) break;
      const off = opts.reducedMotion ? 0 : Math.sin(time * 9 + k * 2.1) * (3 + k * 1.4);
      ctx.fillStyle = rgba(k % 2 ? COLORS.bone : opts.color, 0.85 - k * 0.14);
      ctx.beginPath();
      ctx.arc(path[i * 2] - dy * off * size, path[i * 2 + 1] + dx * off * size, (2.6 - k * 0.35) * size, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private trace(points: number[]): void {
    if (points.length < 4) return;
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(points[0], points[1]);
    for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i], points[i + 1]);
    ctx.stroke();
  }

  /**
   * The aim: the first stretch of the flight as a dotted line that fades out — it shows where the
   * planets bend the shot — and an arrow whose length is the power.
   */
  private drawAim(lane: GhostLane, opts: GhostDrawOptions): void {
    const { ctx } = this;
    const me = lane.world.ships[0];
    const dir = aimDirection(lane.angle);
    const preview = lane.preview();
    const dots = preview.length / 2;
    for (let i = 3; i < dots; i += 2) {
      const f = i / dots;
      ctx.fillStyle = rgba(opts.color, 0.8 * (1 - f * 0.85));
      ctx.beginPath();
      ctx.arc(preview[i * 2], preview[i * 2 + 1], 3.2 - 1.4 * f, 0, Math.PI * 2);
      ctx.fill();
    }
    const from = 40;
    const to = from + (lane.power / 100) * 130;
    const tipX = me.x + dir.x * to;
    const tipY = me.y + dir.y * to;
    ctx.strokeStyle = rgba(opts.color, 0.9);
    ctx.lineWidth = 4;
    ctx.setLineDash([10, 9]);
    ctx.beginPath();
    ctx.moveTo(me.x + dir.x * from, me.y + dir.y * from);
    ctx.lineTo(tipX - dir.x * 10, tipY - dir.y * 10);
    ctx.stroke();
    ctx.setLineDash([]);
    const size = 18;
    ctx.fillStyle = rgba(opts.color, 0.95);
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX - dir.x * size - dir.y * size * 0.55, tipY - dir.y * size + dir.x * size * 0.55);
    ctx.lineTo(tipX - dir.x * size + dir.y * size * 0.55, tipY - dir.y * size - dir.x * size * 0.55);
    ctx.closePath();
    ctx.fill();
  }

  /** The player as a ghost: a see-through shadow in their colour, bobbing, its eyes on the aim. */
  private drawGhostShip(x: number, y: number, angle: number, color: string): void {
    const { ctx } = this;
    const bob = Math.sin(this.time * 2.4) * 3;
    const look = aimDirection(angle);
    ctx.save();
    ctx.translate(x, y + bob);
    ctx.scale(2.6, 2.6);
    // The ghost's path is drawn in a 20 × 22 box; its middle sits on the ship's position.
    ctx.translate(-10, -11);
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    ctx.fillStyle = rgba(color, 0.45);
    ctx.fill(GHOST_BODY);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = rgba(color, 0.95);
    ctx.lineWidth = 0.7;
    ctx.stroke(GHOST_BODY);
    ctx.fillStyle = rgba(COLORS.bone, 0.95);
    for (const ex of [7.4, 12.6]) {
      ctx.beginPath();
      ctx.arc(ex, 10, 1.9, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = COLORS.plate;
    for (const ex of [7.4, 12.6]) {
      ctx.beginPath();
      ctx.arc(ex + look.x * 0.8, 10 + look.y * 0.8, 0.95, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.ellipse(10, 14.2, 1.2, 1.6, 0, 0, Math.PI * 2);
    ctx.fillStyle = rgba(COLORS.plate, 0.85);
    ctx.fill();
    ctx.restore();
  }

  private drawConfetti(): void {
    const { ctx } = this;
    for (const c of this.confetti) {
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(c.spin * c.age);
      ctx.globalAlpha = Math.max(0, Math.min(1, (1.6 - c.age) / 0.6));
      ctx.fillStyle = c.tint;
      ctx.fillRect(-c.size / 2, -c.size / 4, c.size, c.size / 2);
      ctx.restore();
    }
  }

  // ————————————————————————————— Pieces —————————————————————————————

  private drawHeader(lane: GhostLane, opts: GhostDrawOptions): void {
    const { ctx, k, cssWidth: w } = this;
    const pad = 10 * k;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.fillStyle = opts.color;
    ctx.font = `800 ${17 * k}px ${FONTS.display}`;
    setSpacing(ctx, 2 * k);
    ctx.fillText(t('ghost.name').toUpperCase(), pad, 20 * k);
    setSpacing(ctx, 0);

    // The buttons in the corner: bigger or smaller, and close; the score stands next to them.
    const size = 16 * k;
    this.closeBox = { x: w - pad - size, y: 5 * k, size };
    this.bigBox = { x: w - pad - size * 2 - 6 * k, y: 5 * k, size };
    this.drawButton(this.closeBox, opts.color, 'close');
    this.drawButton(this.bigBox, opts.color, opts.big ? 'smaller' : 'bigger');

    ctx.textAlign = 'right';
    ctx.fillStyle = COLORS.bone;
    ctx.font = `700 ${17 * k}px ${FONTS.mono}`;
    ctx.fillText(fmt(lane.score, 0), w - pad - size * 2 - 14 * k, 20 * k);

    // The lane and the series; the shots left as dots.
    ctx.textAlign = 'left';
    ctx.fillStyle = lane.streak ? COLORS.sodium : COLORS.boneDim;
    ctx.font = `400 ${10 * k}px ${FONTS.mono}`;
    const streak = lane.streak ? `  ·  ${t('ghost.streak')} ${lane.streak}  ×${fmt(lane.multiplier, 1).replace(/[.,]0$/, '')}` : '';
    ctx.fillText(`${t('ghost.lane', { n: lane.lane + 1 })}${streak}`, pad, 34 * k);
    const shotsLeft = lane.phase === 'flying' ? lane.shotsLeft : lane.shotsLeft;
    for (let i = 0; i < GHOST.SHOTS; i++) {
      const filled = i < shotsLeft;
      ctx.beginPath();
      ctx.arc(w - pad - 4 * k - (GHOST.SHOTS - 1 - i) * 11 * k, 31 * k, 3.6 * k, 0, Math.PI * 2);
      if (filled) {
        ctx.fillStyle = opts.color;
        ctx.fill();
      } else {
        ctx.strokeStyle = rgba(COLORS.boneDim, 0.7);
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
  }

  private drawButton(box: { x: number; y: number; size: number }, color: string, icon: 'close' | 'bigger' | 'smaller'): void {
    const { ctx, k } = this;
    const { x, y, size } = box;
    ctx.strokeStyle = rgba(color, 0.55);
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);
    const inset = 4.5 * k;
    ctx.strokeStyle = COLORS.bone;
    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    if (icon === 'close') {
      ctx.moveTo(x + inset, y + inset);
      ctx.lineTo(x + size - inset, y + size - inset);
      ctx.moveTo(x + size - inset, y + inset);
      ctx.lineTo(x + inset, y + size - inset);
    } else {
      // Two corner brackets, pointing out to make it bigger and in to make it smaller.
      const a = icon === 'bigger' ? inset : size / 2 - 0.5 * k;
      const b = icon === 'bigger' ? size - inset : size / 2 + 0.5 * k;
      const len = 3.4 * k;
      ctx.moveTo(x + a, y + a + len * (icon === 'bigger' ? 1 : -1));
      ctx.lineTo(x + a, y + a);
      ctx.lineTo(x + a + len * (icon === 'bigger' ? 1 : -1), y + a);
      ctx.moveTo(x + b, y + b - len * (icon === 'bigger' ? 1 : -1));
      ctx.lineTo(x + b, y + b);
      ctx.lineTo(x + b - len * (icon === 'bigger' ? 1 : -1), y + b);
    }
    ctx.stroke();
    ctx.lineCap = 'butt';
  }

  /** On the field: the cores still to go, and the chain of the shot in the air. */
  private drawOverlay(lane: GhostLane): void {
    const { ctx, k } = this;
    const left = this.offsetX + 10 * k;
    const top = this.offsetY + 14 * k;
    // The cores, one diamond each: lit while it stands.
    const total = lane.coresTotal;
    const left_ = lane.coresLeft;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = `700 ${9.5 * k}px ${FONTS.mono}`;
    setSpacing(ctx, 1.4 * k);
    ctx.fillStyle = COLORS.sodium;
    ctx.fillText(t('ghost.cores').toUpperCase(), left, top);
    const label = ctx.measureText(t('ghost.cores').toUpperCase()).width;
    setSpacing(ctx, 0);
    const size = 4.2 * k;
    for (let i = 0; i < total; i++) {
      const cx = left + label + 12 * k + i * size * 2.6;
      ctx.beginPath();
      ctx.moveTo(cx, top - size);
      ctx.lineTo(cx + size, top);
      ctx.lineTo(cx, top + size);
      ctx.lineTo(cx - size, top);
      ctx.closePath();
      if (i < left_) {
        ctx.fillStyle = COLORS.sodium;
        ctx.fill();
      } else {
        ctx.strokeStyle = rgba(COLORS.boneDim, 0.7);
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    // The chain: grows with every thing that goes up, and stays a moment after the last.
    const age = lane.clock - lane.comboAt;
    if (lane.combo >= 2 && age < COMBO_SECONDS) {
      const alpha = Math.min(1, (COMBO_SECONDS - age) / 0.4);
      const pop = 1 + Math.max(0, 0.35 - age * 2);
      ctx.globalAlpha = alpha;
      ctx.textAlign = 'center';
      ctx.fillStyle = lane.combo >= 10 ? COLORS.danger : COLORS.sodium;
      ctx.font = `800 ${(24 + Math.min(lane.combo, 20)) * k * pop}px ${FONTS.display}`;
      setSpacing(ctx, 2 * k);
      ctx.fillText(`${t('ghost.chain').toUpperCase()} ${lane.combo}`, this.cssWidth / 2, this.offsetY + 30 * k);
      setSpacing(ctx, 0);
      ctx.globalAlpha = 1;
    }
  }

  /** The saying of the latest result, floating up from the middle of the field. */
  private drawSaying(lane: GhostLane): void {
    const r = lane.result;
    const said = this.said;
    if (!r || !said || said.lane !== lane || said.id !== r.id) return;
    const age = this.time - said.since;
    if (age > SAY_SECONDS) return;
    const { ctx, k } = this;
    const key = SAY[r.kind][r.quip % SAY[r.kind].length];
    const alpha = Math.min(1, (SAY_SECONDS - age) / 0.5);
    const x = this.cssWidth / 2;
    const y = this.offsetY + (GHOST.HEIGHT * this.scale) / 2 - age * 12 * k;
    ctx.globalAlpha = alpha;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const title = t(key).toUpperCase();
    const parts: string[] = [];
    if (r.points) {
      parts.push(`+${fmt(r.points, 0)}`);
      if (r.multiplier > 1) parts.push(`×${fmt(r.multiplier, 1).replace(/[.,]0$/, '')}`);
      if (r.swingbys) parts.push(t('style.swingby'));
      if (r.planets) parts.push(t('ghost.planet'));
      if (r.perfect) parts.push(t('ghost.perfect'));
    }
    const detail = parts.join('  ·  ');
    // The points line shrinks to fit the panel, and the plate behind covers both lines.
    const room = this.cssWidth - 24 * k;
    ctx.font = `700 ${13 * k}px ${FONTS.mono}`;
    const detailSize = Math.min(13 * k, (13 * k * room) / Math.max(room, ctx.measureText(detail).width));
    ctx.font = `700 ${detailSize}px ${FONTS.mono}`;
    const detailW = detail ? ctx.measureText(detail).width : 0;
    ctx.font = `800 ${28 * k}px ${FONTS.display}`;
    setSpacing(ctx, 1.5 * k);
    const titleW = ctx.measureText(title).width;
    const width = Math.min(this.cssWidth - 8 * k, Math.max(titleW, detailW) + 36 * k);
    ctx.fillStyle = rgba(COLORS.plate, 0.8);
    ctx.fillRect(x - width / 2, y - 22 * k, width, detail ? 54 * k : 34 * k);
    ctx.fillStyle = r.kind === 'cleared' || r.kind === 'chain' ? COLORS.sodium : COLORS.bone;
    ctx.fillText(title, x, y - 4 * k);
    setSpacing(ctx, 0);
    if (detail) {
      ctx.font = `700 ${detailSize}px ${FONTS.mono}`;
      ctx.fillStyle = COLORS.sodium;
      ctx.fillText(detail, x, y + 22 * k);
    }
    ctx.globalAlpha = 1;
  }

  private drawFooter(lane: GhostLane, opts: GhostDrawOptions): void {
    const { ctx, k, cssWidth: w, cssHeight: h } = this;
    const pad = 10 * k;
    // The aim, in the corner of the field.
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.font = `400 ${10 * k}px ${FONTS.mono}`;
    ctx.fillStyle = COLORS.bone;
    ctx.fillText(`${fmt(lane.angle, 2)}°  ${fmt(lane.power, 2)}`, this.offsetX + pad, this.offsetY + GHOST.HEIGHT * this.scale - 6 * k);
    if (opts.touch) return;
    ctx.textAlign = 'center';
    ctx.fillStyle = rgba(COLORS.boneDim, 0.9);
    ctx.font = `400 ${9 * k}px ${FONTS.mono}`;
    ctx.fillText(t('ghost.keys'), w / 2, h - 5 * k);
  }
}
