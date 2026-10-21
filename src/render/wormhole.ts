import { rgba } from './color';
import { portalColor } from './powerup-art';

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
 * One portal: an oval doorway turned to face its partner, floating a little, a swirl turning in its mouth. The
 * sprite does the plasma drawing; this adds only the motion, a few strokes per frame. Both portals of a
 * wormhole are drawn alike, because a shot goes through either one the same way.
 */
export function drawPortal(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  facing: number,
  radius: number,
  color: string,
  time: number,
  alpha = 1,
  phase = 0,
  size = 1,
): void {
  const { image, half } = sprite(color, radius);
  const rx = radius * WIDTH;
  const ry = radius * HEIGHT;
  const breathe = (1 + 0.04 * Math.sin(time * 2.3 + phase)) * size;
  ctx.save();
  ctx.translate(x, y + 1.6 * Math.sin(time * 1.7 + phase));
  ctx.rotate(facing);
  ctx.scale(breathe, breathe);
  ctx.globalAlpha = alpha;
  ctx.drawImage(image, -half, -half, half * 2, half * 2);

  // A swirl in the mouth: three arcs of different size turning together.
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.3;
  ctx.lineCap = 'round';
  for (let k = 0; k < 3; k++) {
    const a = time * 1.6 + phase + (k * Math.PI * 2) / 3;
    const scale = 0.85 - k * 0.2;
    ctx.globalAlpha = alpha * (0.8 - k * 0.15);
    ctx.beginPath();
    ctx.ellipse(0, 0, rx * scale, ry * scale, 0, a, a + 1.5);
    ctx.stroke();
  }

  // Sparks drifting around the rim.
  ctx.fillStyle = '#ffffff';
  for (let k = 0; k < 5; k++) {
    const a = time * 1.4 + (k / 5) * Math.PI * 2 + phase;
    ctx.globalAlpha = alpha * (0.4 + 0.4 * Math.sin(time * 3 + k * 2));
    ctx.beginPath();
    ctx.arc(Math.cos(a) * rx * 1.12, Math.sin(a) * ry * 1.12, 1.1, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * Both portals of a wormhole, turned to face each other, in the wormhole's own colour. `eaten` (0 to 1) is how
 * far the black hole has taken it: the portals shrink and fade as they fall in.
 */
export function drawWormhole(ctx: CanvasRenderingContext2D, ax: number, ay: number, bx: number, by: number, radius: number, time: number, id: number, eaten = 0): void {
  const color = portalColor(id);
  const fade = 1 - eaten;
  const toB = Math.atan2(by - ay, bx - ax);
  ctx.save();
  // A faint thread between the pair, in their colour, so which portals belong together can be followed.
  ctx.globalAlpha = 0.22 * fade;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 8]);
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.stroke();
  ctx.restore();
  drawPortal(ctx, ax, ay, toB, radius, color, time, fade, 0, 1 - eaten * 0.7);
  drawPortal(ctx, bx, by, toB + Math.PI, radius, color, time, fade, 0.5, 1 - eaten * 0.7);
}
