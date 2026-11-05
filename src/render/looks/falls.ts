import { infallAt, type Falling } from '../../game';
import type { BlackHole } from '../../sim/physics';
import { strokeHoleFlare } from '../blackhole';
import { COLORS } from '../../sim/config';
import { rgba } from '../color';

/** The way a fall runs at `t`, as an angle. */
function headingAt(f: Falling, t: number): number {
  const a = infallAt(f.fromX, f.fromY, f.toX, f.toY, Math.max(0, t - 0.02));
  const b = infallAt(f.fromX, f.fromY, f.toX, f.toY, Math.min(1, t + 0.02));
  return Math.atan2(b.y - a.y, b.x - a.x);
}

/**
 * The body at `t` along its fall, drawn out towards the hole, squeezed across and shrinking, the way a tide takes it.
 * `paint` draws it round (0, 0) and upright, so it is stretched whole instead of being cut up.
 */
function stretched(ctx: CanvasRenderingContext2D, f: Falling, t: number, along: number, across: number, shrink: number, paint: (c: CanvasRenderingContext2D) => void): void {
  const p = t === f.t ? f : infallAt(f.fromX, f.fromY, f.toX, f.toY, t);
  const heading = headingAt(f, t);
  const pull = t ** 1.5;
  const s = 1 - shrink * pull;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(heading);
  ctx.scale((1 + along * pull) * s, (1 - across * pull) * s);
  ctx.rotate(-heading);
  paint(ctx);
  ctx.restore();
}

/**
 * Einfach: the way a body has always gone into the hole here: on a straight line that it speeds along, drawn out towards
 * the hole, squeezed across and shrinking (a planet also thins a little). It does not swing round: the spiral is for
 * the looks that draw one, and this look draws the body where the straight line would have it.
 */
export function drawInkFall(ctx: CanvasRenderingContext2D, f: Falling, _reach: number, _ps: number, paint: (c: CanvasRenderingContext2D) => void): void {
  const k = f.t * f.t;
  const x = f.fromX + (f.toX - f.fromX) * k;
  const y = f.fromY + (f.toY - f.fromY) * k;
  const toHole = Math.atan2(f.toY - y, f.toX - x);
  const ship = f.ship !== undefined;
  const shrink = 1 - f.t * 0.85;
  ctx.save();
  if (!ship) ctx.globalAlpha *= 1 - f.t * 0.4;
  ctx.translate(x, y);
  ctx.rotate(toHole);
  ctx.scale((1 + f.t * (ship ? 2 : 1.8)) * shrink, (1 - f.t * 0.6) * shrink);
  // A ship keeps its heading; a planet turns with the pull, as it always did.
  if (ship) ctx.rotate(-toHole);
  paint(ctx);
  ctx.restore();
}

function hexagon(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, turn: number): void {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = turn + (i * Math.PI) / 3;
    if (i) ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    else ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  ctx.closePath();
}

const STRANDS = 20;
const smooth = (a: number, b: number, x: number): number => {
  const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
};
/** A number from 0 to 1 that stays the same for one strand of one fall. */
function noise(key: string, i: number): number {
  let h = 2166136261 ^ i;
  for (let c = 0; c < key.length; c++) h = Math.imul(h ^ key.charCodeAt(c), 16777619);
  return ((h >>> 0) % 10007) / 10007;
}

/**
 * Holo: a projection of a fall. The wire body holds together, then comes apart into its lines: strands let go of it one
 * by one and each runs down the spiral on a line of its own, braiding together as they go in, a bright node at each
 * head, until the hole has taken the last. A hexagon locked on to the body closes as it goes.
 */
export function drawHoloFall(ctx: CanvasRenderingContext2D, f: Falling, _reach: number, ps: number, paint: (c: CanvasRenderingContext2D) => void): void {
  const alpha = ctx.globalAlpha;
  const line = Math.max(0.7, 1 / ps);
  const loose = smooth(0.1, 0.5, f.t);

  // The body, thinning out as its lines let go.
  ctx.globalAlpha = alpha * (1 - loose);
  if (loose < 1) stretched(ctx, f, f.t, 0.8, 0.3, 0.6 * loose, paint);
  ctx.globalAlpha = alpha;

  // The strands: each is a stretch of the spiral, set a little to the side of its middle, that closes in as it goes.
  const reel = smooth(0.7, 1, f.t);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineWidth = line;
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < STRANDS; i++) {
    const across = (i / (STRANDS - 1) - 0.5) * 2;
    const letGo = 0.06 + 0.34 * noise(f.key, i);
    if (f.t <= letGo) continue;
    const speed = 1.15 + 1.1 * noise(f.key, i + 99);
    const head = Math.min(1, letGo + (f.t - letGo) * speed);
    const length = (0.12 + 0.2 * noise(f.key, i + 33)) * (1 - reel);
    const tail = Math.max(letGo, head - length);
    const steps = 14;
    let prev: { x: number; y: number } | null = null;
    for (let k = 0; k <= steps; k++) {
      const t = tail + ((head - tail) * k) / steps;
      const p = infallAt(f.fromX, f.fromY, f.toX, f.toY, t);
      const h = headingAt(f, t);
      const side = across * f.radius * 0.95 * (1 - t) ** 0.9;
      const x = p.x - Math.sin(h) * side;
      const y = p.y + Math.cos(h) * side;
      if (prev) {
        ctx.strokeStyle = rgba(f.color, alpha * 0.85 * (k / steps) ** 1.3);
        ctx.beginPath();
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(x, y);
        ctx.stroke();
      }
      prev = { x, y };
    }
    if (prev && head < 1 && length > 0.01) {
      ctx.fillStyle = rgba(COLORS.bone, alpha * 0.9);
      ctx.beginPath();
      ctx.arc(prev.x, prev.y, Math.max(0.9, line * 1.3), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = rgba(f.color, alpha * 0.8 * (1 - loose * 0.6));
  ctx.lineWidth = line;
  ctx.setLineDash([6, 4]);
  hexagon(ctx, f.x, f.y, f.radius * (1.55 - 0.7 * f.t), f.t * 3);
  ctx.stroke();
  ctx.restore();
}

/**
 * Holo: what the hole answers with when something crosses its horizon: a hexagon of light that opens round it from where
 * the body went in, a spoke out to it, and the arc running round the rim.
 */
export function drawHoloFlare(ctx: CanvasRenderingContext2D, hole: BlackHole, strength: number, color: string, angle: number): void {
  const open = 1 - strength;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineWidth = 1.2;
  for (const [grow, share] of [[0.15, 1], [0.55, 0.55], [1, 0.3]] as const) {
    ctx.strokeStyle = rgba(color, strength * share);
    hexagon(ctx, hole.x, hole.y, hole.radius * (1.12 + grow * open * 1.1), angle);
    ctx.stroke();
  }
  ctx.strokeStyle = rgba(color, strength * 0.8);
  ctx.beginPath();
  ctx.moveTo(hole.x + Math.cos(angle) * hole.radius * 1.05, hole.y + Math.sin(angle) * hole.radius * 1.05);
  ctx.lineTo(hole.x + Math.cos(angle) * hole.radius * (1.2 + open * 1.6), hole.y + Math.sin(angle) * hole.radius * (1.2 + open * 1.6));
  ctx.stroke();
  strokeHoleFlare(ctx, hole, strength, color, angle, 2.4, 1);
  ctx.restore();
}
