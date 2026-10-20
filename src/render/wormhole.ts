import { FONTS } from '../config';
import { rgba } from './color';
import { portalPair } from './powerup-art';

/** The half-axes of a portal as shares of the wormhole's radius: a tall oval seen edge-on, like a doorway. */
const WIDTH = 0.7;
const HEIGHT = 1.12;
/** How far the glow reaches past the rim, as a share of the oval's height. */
const HALO = 1.7;
/** The sprites are drawn at this multiple of their size, so they stay sharp on a high-density screen. */
const DETAIL = 2;

interface Sprite {
  image: HTMLCanvasElement;
  /** Half the sprite's width and height, in field units. */
  half: number;
}

const sprites = new Map<string, Sprite>();

/** The still part of a portal (glow, dark mouth, rim), drawn once per colour and size and reused every frame. */
function sprite(color: string, radius: number): Sprite {
  const key = `${color}:${radius}`;
  const known = sprites.get(key);
  if (known) return known;
  const rx = radius * WIDTH;
  const ry = radius * HEIGHT;
  const half = Math.ceil(ry * HALO);
  const image = document.createElement('canvas');
  image.width = image.height = half * 2 * DETAIL;
  const ctx = image.getContext('2d')!;
  ctx.scale(DETAIL, DETAIL);
  ctx.translate(half, half);

  // Glow: a circle of light squeezed into the oval's proportions.
  ctx.save();
  ctx.scale(rx / ry, 1);
  const glow = ctx.createRadialGradient(0, 0, ry * 0.7, 0, 0, half);
  glow.addColorStop(0, rgba(color, 0.4));
  glow.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, 0, half, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // The mouth: dark, tinted towards the rim.
  ctx.save();
  ctx.scale(rx / ry, 1);
  const mouth = ctx.createRadialGradient(0, 0, 0, 0, 0, ry);
  mouth.addColorStop(0, 'rgba(4, 8, 16, 0.92)');
  mouth.addColorStop(0.7, 'rgba(4, 8, 16, 0.8)');
  mouth.addColorStop(1, rgba(color, 0.5));
  ctx.fillStyle = mouth;
  ctx.beginPath();
  ctx.arc(0, 0, ry, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // The rim: a bright band in the colour, with a white-hot line inside it.
  ctx.shadowColor = color;
  ctx.shadowBlur = 8;
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  ctx.stroke();

  const made = { image, half };
  sprites.set(key, made);
  return made;
}

/**
 * One portal: an oval doorway turned to face its partner, floating a little, its mouth alive with rings that
 * run inwards on the entry and outwards on the exit. The sprite does the heavy drawing; this adds only the
 * motion, a few strokes per frame.
 */
export function drawPortal(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  facing: number,
  radius: number,
  color: string,
  time: number,
  exit: boolean,
  alpha = 1,
  phase = 0,
  mark?: string,
): void {
  const { image, half } = sprite(color, radius);
  const rx = radius * WIDTH;
  const ry = radius * HEIGHT;
  const breathe = 1 + 0.04 * Math.sin(time * 2.3 + phase);
  ctx.save();
  ctx.translate(x, y + 1.6 * Math.sin(time * 1.7 + phase));
  ctx.rotate(facing);
  ctx.scale(breathe, breathe);
  ctx.globalAlpha = alpha;
  ctx.drawImage(image, -half, -half, half * 2, half * 2);

  // Rings crossing the mouth: shrinking into the entry, growing out of the exit.
  ctx.lineWidth = 1.2;
  for (let k = 0; k < 3; k++) {
    const t = (time * 0.7 + k / 3 + phase) % 1;
    const size = exit ? t : 1 - t;
    ctx.globalAlpha = alpha * 0.7 * Math.sin(size * Math.PI);
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.ellipse(0, 0, rx * 0.85 * size, ry * 0.85 * size, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Sparks drifting around the rim.
  ctx.fillStyle = '#ffffff';
  for (let k = 0; k < 5; k++) {
    const a = (exit ? -1 : 1) * time * 1.4 + (k / 5) * Math.PI * 2 + phase;
    ctx.globalAlpha = alpha * (0.4 + 0.4 * Math.sin(time * 3 + k * 2));
    ctx.beginPath();
    ctx.arc(Math.cos(a) * rx * 1.12, Math.sin(a) * ry * 1.12, 1.1, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // The number of its wormhole, upright in the mouth.
  if (mark) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = `700 ${Math.round(radius * 0.7)}px ${FONTS.mono}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(4, 8, 16, 0.85)';
    ctx.strokeText(mark, x, y + 1);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(mark, x, y + 1);
    ctx.restore();
  }
}

/**
 * Both portals of a wormhole, the entry and the exit, turned to face each other, in the colours of the
 * wormhole's own pair. `mark` (its number) goes on both when there is more than one wormhole to tell apart.
 */
export function drawWormhole(ctx: CanvasRenderingContext2D, ax: number, ay: number, bx: number, by: number, radius: number, time: number, index: number, mark?: string): void {
  const colors = portalPair(index);
  const toB = Math.atan2(by - ay, bx - ax);
  ctx.save();
  // A faint thread between the pair, so two wormholes on one field can be told apart.
  ctx.globalAlpha = 0.1;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 8]);
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.stroke();
  ctx.restore();
  drawPortal(ctx, ax, ay, toB, radius, colors.entry, time, false, 1, 0, mark);
  drawPortal(ctx, bx, by, toB + Math.PI, radius, colors.exit, time, true, 1, 0.5, mark);
}
