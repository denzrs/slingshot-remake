import { rgba } from '../color';
import { fbm } from '../noise';
import { clamp01, smoothstep } from '../planet-common';
import type { EffectStyle } from './painter';

/**
 * Fireballs for the forged look. A fireball is a sheet of frames of burning gas — noise pushed out into a
 * ball that swells, whitens at its core, turns orange and red and thins to embers — drawn once, a couple of frames each
 * time the look draws anything, so the first blast finds the sheet finished and the game never stalls to make it. Until it
 * is finished the blasts are left to the rings and sparks that go with them.
 */

const COLS = 5;
const ROWS = 4;
const FRAMES = COLS * ROWS;
/** One frame's side, in pixels. */
const CELL = 96;
/** How many frames are drawn each time `warmBlasts` is called. */
const PER_CALL = 2;

let sheet: HTMLCanvasElement | null = null;
let drawn = 0;

/** The heat → colour ramp of burning gas, as [heat, r, g, b]. */
const RAMP: readonly (readonly [number, number, number, number])[] = [
  [0, 120, 20, 10],
  [0.12, 200, 40, 20],
  [0.35, 255, 120, 35],
  [0.6, 255, 205, 90],
  [0.85, 255, 250, 220],
  [1, 255, 255, 255],
];

function ramp(heat: number, out: [number, number, number]): void {
  for (let i = 1; i < RAMP.length; i++) {
    if (heat <= RAMP[i][0]) {
      const a = RAMP[i - 1];
      const b = RAMP[i];
      const k = (heat - a[0]) / (b[0] - a[0]);
      out[0] = a[1] + (b[1] - a[1]) * k;
      out[1] = a[2] + (b[2] - a[2]) * k;
      out[2] = a[3] + (b[3] - a[3]) * k;
      return;
    }
  }
  out[0] = out[1] = out[2] = 255;
}

function paintFrame(c: CanvasRenderingContext2D, index: number): void {
  const t = (index + 0.5) / FRAMES;
  const img = c.createImageData(CELL, CELL);
  const colour: [number, number, number] = [0, 0, 0];
  // The ball swells fast and slows; it burns out from the edge in.
  const reach = 0.28 + 0.66 * (1 - (1 - t) ** 2.4);
  const fuel = (1 - t) ** 1.15;
  for (let y = 0; y < CELL; y++) {
    for (let x = 0; x < CELL; x++) {
      const dx = ((x + 0.5) / CELL) * 2 - 1;
      const dy = ((y + 0.5) / CELL) * 2 - 1;
      const r = Math.hypot(dx, dy);
      if (r >= 1) continue;
      // Turbulence: the same noise every frame, drifting, so the ball boils instead of flickering; a finer one tears its edge into tongues.
      const n = fbm(dx * 2.3 + 5, dy * 2.3 + 5, t * 1.4, 11, 3);
      const fine = fbm(dx * 5.5 + 9, dy * 5.5 + 2, t * 2.2, 23, 3);
      const body = reach * (0.42 + 1.15 * n) + 0.1 * (fine - 0.5) - r;
      if (body <= 0) continue;
      const density = smoothstep(0, 0.5 * reach, body);
      // Only the very heart is white; round it, the gas shades from yellow out to red.
      const core = clamp01(1 - r / (reach * 0.42)) ** 2 * (1 - t) ** 1.8;
      const heat = clamp01(density * fuel * (0.3 + 0.95 * fine) + core * 0.85);
      ramp(heat, colour);
      const i = (y * CELL + x) * 4;
      img.data[i] = colour[0];
      img.data[i + 1] = colour[1];
      img.data[i + 2] = colour[2];
      // Fades to the edge of the frame, so no frame ever shows its own border.
      img.data[i + 3] = 255 * clamp01(heat * 1.6) * smoothstep(1, 0.8, r);
    }
  }
  c.putImageData(img, (index % COLS) * CELL, Math.floor(index / COLS) * CELL);
}

/** Paints the next frames of the fireball sheet, until there are all of them. Called every frame the look draws. */
export function warmBlasts(): void {
  if (drawn >= FRAMES) return;
  if (!sheet) {
    sheet = document.createElement('canvas');
    sheet.width = COLS * CELL;
    sheet.height = ROWS * CELL;
  }
  const c = sheet.getContext('2d')!;
  for (let i = 0; i < PER_CALL && drawn < FRAMES; i++) paintFrame(c, drawn++);
}

/** A fireball `size` wide, `t` (0 → 1) through its life: two neighbouring frames blended, turned by its seed, with a glow of its own colour under it. */
export const drawBlast: NonNullable<EffectStyle['blast']> = (ctx, blast, t) => {
  if (!sheet || drawn < FRAMES) return;
  const at = clamp01(t) * (FRAMES - 1);
  const first = Math.floor(at);
  const frac = at - first;
  const size = blast.size * (0.8 + 0.25 * t);
  ctx.save();
  ctx.translate(blast.x, blast.y);
  ctx.globalCompositeOperation = 'lighter';
  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, size * 0.75);
  glow.addColorStop(0, rgba(blast.color, 0.22 * (1 - t) ** 1.5));
  glow.addColorStop(1, rgba(blast.color, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(-size, -size, size * 2, size * 2);
  ctx.rotate(blast.seed * Math.PI * 2);
  const half = size / 2;
  for (const [index, alpha] of [[first, 1 - frac], [Math.min(FRAMES - 1, first + 1), frac]] as const) {
    if (alpha <= 0.01) continue;
    ctx.globalAlpha = alpha;
    ctx.drawImage(sheet, (index % COLS) * CELL, Math.floor(index / COLS) * CELL, CELL, CELL, -half, -half, size, size);
  }
  ctx.restore();
};
