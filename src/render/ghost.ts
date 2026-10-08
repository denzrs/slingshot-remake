import { COLORS, FIELD, FONTS, GHOST } from '../config';
import { aimDirection, type Shot } from '../physics';
import { fmt, t, type Key } from '../i18n';
import type { GhostLane, LaneResult } from '../ghost';
import { rgba } from './color';
import { setSpacing } from './text';

/** The ghost's body, the same one that sits next to the version on the title screen. */
export const GHOST_BODY = new Path2D('M3 19V10a7 7 0 0 1 14 0v9l-2.33-2-2.34 2-2.33-2-2.33 2-2.34-2-2.33 2z');

/** The sayings of a result: `quip` picks one, the same for every ghost. */
const SAY: Record<LaneResult['kind'], readonly Key[]> = {
  hit: ['ghost.hit.0', 'ghost.hit.1', 'ghost.hit.2'],
  near: ['ghost.near.0', 'ghost.near.1'],
  miss: ['ghost.miss.0', 'ghost.miss.1'],
  out: ['ghost.out.0', 'ghost.out.1'],
};

/** Height of the header and the footer in units of a 320-pixel-wide panel; the field fills what is between at the game's aspect ratio. */
const HEADER = 40;
const FOOTER = 16;
/** Seconds a saying stays on the field. */
const SAY_SECONDS = 1.6;
const CONFETTI = 46;

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
  reducedMotion: boolean;
}

/**
 * The ghost lane's panel: a small canvas of its own, drawn in a few strokes. The main renderer is
 * tied to the window size, so it is no use here.
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
  /** The close button's box in CSS pixels of the panel, as drawn last. */
  private closeBox = { x: 0, y: 0, size: 0 };
  private confetti: Confetti[] = [];
  /** The result on show and since when; null until the first one of this lane. */
  private said: { lane: GhostLane; id: number; since: number } | null = null;

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

  /** Whether a pointer position (client px) is over the close button. */
  isClose(clientX: number, clientY: number): boolean {
    const rect = this.canvas.getBoundingClientRect();
    const px = ((clientX - rect.left) / rect.width) * this.cssWidth;
    const py = ((clientY - rect.top) / rect.height) * this.cssHeight;
    const { x, y, size } = this.closeBox;
    // A little margin around the cross: it is small, and a finger is not.
    const m = 4 * this.k;
    return px >= x - m && px <= x + size + m && py >= y - m && py <= y + size + m;
  }

  /** Forget what was on show, so the next lane starts without leftover confetti. */
  reset(): void {
    this.confetti = [];
    this.said = null;
  }

  draw(lane: GhostLane, opts: GhostDrawOptions, dt: number): void {
    this.fit();
    const { ctx, cssWidth: w, cssHeight: h, k } = this;
    this.time += dt;
    this.watch(lane, opts);
    this.stepConfetti(dt);

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = rgba(COLORS.plate, 0.9);
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = rgba(opts.color, 0.55);
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);

    this.drawHeader(lane, opts);

    const fieldH = FIELD.height * this.scale;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, this.offsetY, w, fieldH);
    ctx.clip();
    ctx.translate(this.offsetX, this.offsetY);
    ctx.scale(this.scale, this.scale);
    this.drawField(lane, opts);
    this.drawConfetti();
    ctx.restore();

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
    this.scale = Math.min(rect.width / FIELD.width, (rect.height - (HEADER + FOOTER) * this.k) / FIELD.height);
    this.offsetX = (rect.width - FIELD.width * this.scale) / 2;
  }

  /** Notices a new result and reacts: a saying for all of them, confetti for a hit. */
  private watch(lane: GhostLane, opts: GhostDrawOptions): void {
    const r = lane.result;
    if (this.said && this.said.lane !== lane) this.reset();
    if (!r || this.said?.id === r.id) return;
    this.said = { lane, id: r.id, since: this.time };
    if (r.kind === 'hit' && !opts.reducedMotion) this.burst(lane, opts.color);
  }

  private burst(lane: GhostLane, color: string): void {
    const { x, y } = lane.target;
    const tints = [color, COLORS.bone, COLORS.sodium];
    for (let i = 0; i < CONFETTI; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = 120 + Math.random() * 340;
      this.confetti.push({
        x,
        y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed - 140,
        spin: (Math.random() - 0.5) * 14,
        size: 5 + Math.random() * 7,
        age: Math.random() * 0.2,
        tint: tints[i % tints.length],
      });
    }
  }

  private stepConfetti(dt: number): void {
    for (const c of this.confetti) {
      c.age += dt;
      c.vy += 620 * dt;
      c.vx *= 1 - 1.4 * dt;
      c.x += c.vx * dt;
      c.y += c.vy * dt;
    }
    this.confetti = this.confetti.filter((c) => c.age < 1.5);
  }

  private drawConfetti(): void {
    const { ctx } = this;
    for (const c of this.confetti) {
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(c.spin * c.age);
      ctx.globalAlpha = Math.max(0, Math.min(1, (1.5 - c.age) / 0.6));
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

    // The close button in the corner; the score stands next to it.
    const size = 16 * k;
    this.closeBox = { x: w - pad - size, y: 5 * k, size };
    this.drawClose(opts.color);

    ctx.textAlign = 'right';
    ctx.fillStyle = COLORS.bone;
    ctx.font = `700 ${17 * k}px ${FONTS.mono}`;
    ctx.fillText(String(lane.score), w - pad - size - 8 * k, 20 * k);

    ctx.textAlign = 'left';
    ctx.fillStyle = COLORS.boneDim;
    ctx.font = `400 ${10 * k}px ${FONTS.mono}`;
    const shot = Math.min(GHOST.SHOTS, lane.phase === 'aiming' ? lane.shots + 1 : Math.max(1, lane.shots));
    ctx.fillText(`${t('ghost.lane', { n: lane.lane + 1 })} · ${t('ghost.shot', { n: shot, max: GHOST.SHOTS })}`, pad, 33 * k);

    // The series: what the next cleared lane is worth.
    ctx.textAlign = 'right';
    ctx.fillStyle = lane.streak ? COLORS.sodium : COLORS.boneDim;
    ctx.fillText(`${t('ghost.streak')} ${lane.streak}  ×${fmt(lane.multiplier, 1).replace(/[.,]0$/, '')}`, w - pad, 33 * k);
  }

  private drawClose(color: string): void {
    const { ctx, k } = this;
    const { x, y, size } = this.closeBox;
    ctx.strokeStyle = rgba(color, 0.55);
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);
    const inset = 4.5 * k;
    ctx.strokeStyle = COLORS.bone;
    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x + inset, y + inset);
    ctx.lineTo(x + size - inset, y + size - inset);
    ctx.moveTo(x + size - inset, y + inset);
    ctx.lineTo(x + inset, y + size - inset);
    ctx.stroke();
    ctx.lineCap = 'butt';
  }

  private drawField(lane: GhostLane, opts: GhostDrawOptions): void {
    const { ctx } = this;
    const { world } = lane;
    ctx.lineJoin = 'round';

    for (const p of world.planets) {
      const g = ctx.createRadialGradient(p.x - p.radius * 0.35, p.y - p.radius * 0.35, p.radius * 0.1, p.x, p.y, p.radius);
      g.addColorStop(0, rgba(p.tint, 0.9));
      g.addColorStop(1, rgba(p.tint, 0.38));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fill();
    }

    // Earlier shots of this lane stay on the board as faint mist, the way trails do in the real game.
    ctx.lineWidth = 3;
    ctx.strokeStyle = rgba(opts.color, 0.22);
    for (const path of lane.oldPaths) this.trace(path);
    if (lane.phase === 'flying' || lane.phase === 'cleared') this.drawMist(lane.path, opts.color);
    if (lane.shot && !lane.shot.end) this.drawWisp(lane.shot, lane.path, opts);

    this.drawTarget(lane);
    const me = world.ships[0];
    if (lane.canAim) this.drawAim(lane, opts);
    this.drawGhostShip(me.x, me.y, lane.angle, opts.color);
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

    // The field is drawn small: the flame is big for what it is.
    const size = 1.7;
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

  private drawTarget(lane: GhostLane): void {
    const { ctx } = this;
    const { x, y } = lane.target;
    const cleared = lane.phase === 'cleared';
    const pulse = cleared ? 0 : 0.5 + 0.5 * Math.sin(this.time * 4);
    ctx.strokeStyle = cleared ? COLORS.sodium : COLORS.bone;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, 24 + pulse * 4 + (cleared ? 18 : 0), 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = cleared ? 0.4 : 1;
    ctx.beginPath();
    ctx.arc(x, y, 9, 0, Math.PI * 2);
    ctx.moveTo(x - 36, y);
    ctx.lineTo(x - 17, y);
    ctx.moveTo(x + 17, y);
    ctx.lineTo(x + 36, y);
    ctx.moveTo(x, y - 36);
    ctx.lineTo(x, y - 17);
    ctx.moveTo(x, y + 17);
    ctx.lineTo(x, y + 36);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  /** The aim: a dashed line from the ghost with an arrowhead at its tip — the power is its length. */
  private drawAim(lane: GhostLane, opts: GhostDrawOptions): void {
    const { ctx } = this;
    const me = lane.world.ships[0];
    const dir = aimDirection(lane.angle);
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
    // The head is a solid triangle, big enough to read at the panel's small scale.
    const size = 22;
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
    ctx.scale(3.4, 3.4);
    // The ghost's path is drawn in a 20 × 22 box; its middle sits on the ship's position.
    ctx.translate(-10, -11);
    ctx.shadowColor = color;
    ctx.shadowBlur = 14;
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

  /** The saying of the latest result, floating up from the target. */
  private drawSaying(lane: GhostLane): void {
    const r = lane.result;
    const said = this.said;
    if (!r || !said || said.lane !== lane || said.id !== r.id) return;
    const age = this.time - said.since;
    if (age > SAY_SECONDS) return;
    const { ctx, k } = this;
    const key = SAY[r.kind][r.quip % SAY[r.kind].length];
    const alpha = Math.min(1, (SAY_SECONDS - age) / 0.5);
    const x = Math.max(70 * k, Math.min(this.cssWidth - 70 * k, this.offsetX + lane.target.x * this.scale));
    const y = this.offsetY + lane.target.y * this.scale - 26 * k - age * 14 * k;
    ctx.globalAlpha = alpha;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `800 ${22 * k}px ${FONTS.display}`;
    setSpacing(ctx, 1.5 * k);
    ctx.fillStyle = r.kind === 'hit' ? COLORS.sodium : COLORS.bone;
    ctx.fillText(t(key).toUpperCase(), x, y);
    setSpacing(ctx, 0);
    if (r.kind === 'hit') {
      ctx.font = `700 ${12 * k}px ${FONTS.mono}`;
      const bonus = r.swingbys ? `  ·  ${t('style.swingby')}` : '';
      ctx.fillText(`+${r.points}${r.multiplier > 1 ? `  ×${fmt(r.multiplier, 1).replace(/[.,]0$/, '')}` : ''}${bonus}`, x, y + 18 * k);
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
    ctx.fillText(`${fmt(lane.angle, 2)}°  ${fmt(lane.power, 2)}`, this.offsetX + pad, this.offsetY + FIELD.height * this.scale - 6 * k);
    if (opts.touch) return;
    ctx.textAlign = 'center';
    ctx.fillStyle = rgba(COLORS.boneDim, 0.9);
    ctx.font = `400 ${9 * k}px ${FONTS.mono}`;
    ctx.fillText(t('ghost.keys'), w / 2, h - 5 * k);
  }
}
