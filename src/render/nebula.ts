import { rgba } from './color';

/**
 * A nebula cloud is drawn as a few overlapping blobs with uneven, wobbly edges rather than a plain disc, so
 * it reads as gas. The shape comes from the cloud's seed, so it is a fixed random version: whoever draws the
 * cloud draws the same one, and it never shifts while it is being aimed or after it is laid.
 */

/** Three stable [0, 2π) phases for one cloud's seed, so no two directions of its edge match. */
function phases(seed: number): [number, number, number] {
  const at = (k: number): number => {
    const h = Math.sin((seed + k * 0.618) * 127.1) * 43758.5453;
    return (h - Math.floor(h)) * Math.PI * 2;
  };
  return [at(0), at(1), at(2)];
}

/** How far in or out the edge bulges at `angle`: three waves, so the outline is uneven but smooth. */
function wobble(angle: number, [p0, p1, p2]: readonly [number, number, number]): number {
  return 1 + 0.18 * Math.sin(3 * angle + p0) + 0.11 * Math.sin(5 * angle + p1) + 0.06 * Math.sin(7 * angle + p2);
}

const EDGE_STEPS = 24;

/** Traces a cloud's outline as a closed path around (x, y), ready to fill or stroke. */
export function traceNebula(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, seed: number): void {
  const p = phases(seed);
  ctx.beginPath();
  for (let i = 0; i <= EDGE_STEPS; i++) {
    const angle = (i / EDGE_STEPS) * Math.PI * 2;
    const edge = r * wobble(angle, p);
    const px = x + Math.cos(angle) * edge;
    const py = y + Math.sin(angle) * edge;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/** One soft blob of a cloud: a radial fade with the wobbly outline, so its edge is uneven and never a circle. */
function blob(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, alpha: number, seed: number): void {
  const fade = ctx.createRadialGradient(x, y, r * 0.12, x, y, r * 1.08);
  fade.addColorStop(0, rgba(color, alpha));
  fade.addColorStop(0.55, rgba(color, alpha * 0.42));
  fade.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = fade;
  traceNebula(ctx, x, y, r, seed);
  ctx.fill();
}

/** Draws a whole cloud: a main body with two lobes off its side, each one wobbly and fading out. */
export function drawNebula(ctx: CanvasRenderingContext2D, n: { x: number; y: number; radius: number; seed: number }, color: string): void {
  const [, a1, a2] = phases(n.seed);
  blob(ctx, n.x, n.y, n.radius, color, 0.3, n.seed);
  blob(ctx, n.x + Math.cos(a1) * n.radius * 0.42, n.y + Math.sin(a1) * n.radius * 0.42, n.radius * 0.66, color, 0.2, n.seed + 0.11);
  blob(ctx, n.x + Math.cos(a2) * n.radius * 0.5, n.y + Math.sin(a2) * n.radius * 0.5, n.radius * 0.58, color, 0.16, n.seed + 0.29);
}
