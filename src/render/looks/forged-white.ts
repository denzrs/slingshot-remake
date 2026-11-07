import type { BlackHole } from '../../sim/physics';
import { TILT } from '../blackhole';
import { rgba } from '../color';
import { fbm } from '../noise';
import { clamp01, smoothstep } from '../planet-common';
import { drawWhiteGlow, easeOut, WHITE_HOLE } from './classic-white';
import { drawWhiteLight } from './forged-hole';
import { WHITE_JUMP, type WhiteJump } from './painter';

const TAU = Math.PI * 2;
/** The cold fringe the white light breaks into at its edge. */
const FRINGE = '#9fd2ff';

/**
 * Anomaly White Hole in forged light, made as the hole is: the horizon's light is traced with the hole and played as a loop
 * of frames over it (`drawWhiteLight`), so the shadow shines from inside, lensed like the disk, its far side wound into
 * rings at the edge. Round it a cold haze, the light scattered, as the warm one round the black hole.
 */
export function drawForgedWhiteCore(ctx: CanvasRenderingContext2D, hole: BlackHole, time: number): void {
  const R = hole.radius;
  const breathe = 0.85 + 0.15 * Math.sin(time * 1.3);
  ctx.save();
  ctx.translate(hole.x, hole.y);
  ctx.globalCompositeOperation = 'lighter';
  // Nothing inside the shadow, which the traced light fills: the haze starts at its edge.
  const haze = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 5);
  haze.addColorStop(0, rgba(FRINGE, 0));
  haze.addColorStop(0.95 / 5, rgba(FRINGE, 0));
  haze.addColorStop(1.15 / 5, rgba(WHITE_HOLE, 0.3 * breathe));
  haze.addColorStop(2 / 5, rgba(FRINGE, 0.1 * breathe));
  haze.addColorStop(1, rgba(FRINGE, 0));
  ctx.fillStyle = haze;
  ctx.beginPath();
  ctx.arc(0, 0, R * 5, 0, TAU);
  ctx.fill();
  ctx.rotate(TILT);
  if (!drawWhiteLight(ctx, R, time)) {
    // Until the frames have loaded, a plain white-hot glow fills the shadow.
    const hot = ctx.createRadialGradient(0, 0, 0, 0, 0, R);
    hot.addColorStop(0, rgba('#ffffff', 0.95));
    hot.addColorStop(0.6, rgba(WHITE_HOLE, 0.55));
    hot.addColorStop(1, rgba(FRINGE, 0));
    ctx.fillStyle = hot;
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * A white-hole jump in forged light: the core flares as the shot goes in, and at the way out the white hole erupts into
 * the field (`drawEruption`), the shot riding out of it white-hot.
 */
export function drawForgedWhiteJump(ctx: CanvasRenderingContext2D, j: WhiteJump): void {
  const { age, hole } = j;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  if (hole && age < WHITE_JUMP.SWALLOW) {
    const s = age / WHITE_JUMP.SWALLOW;
    const R = hole.radius;
    const flare = ctx.createRadialGradient(hole.x, hole.y, 0, hole.x, hole.y, R * 3);
    flare.addColorStop(0, rgba('#ffffff', 0.9 * (1 - s)));
    flare.addColorStop(0.3, rgba(j.color, 0.35 * (1 - s)));
    flare.addColorStop(1, rgba(j.color, 0));
    ctx.fillStyle = flare;
    ctx.beginPath();
    ctx.arc(hole.x, hole.y, R * 3, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = rgba(j.color, 0.8 * (1 - s));
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(hole.x, hole.y, R * (2 - 1.6 * s * s), 0, TAU);
    ctx.stroke();
  }
  if (age < WHITE_JUMP.LIFE) drawEruption(ctx, j.x, j.y, j.out, age / WHITE_JUMP.LIFE);
  if (age < WHITE_JUMP.GLOW) drawWhiteGlow(ctx, j.shotX, j.shotY, 1 - age / WHITE_JUMP.GLOW, 22);
  ctx.restore();
}

// ------------------------------------------------------------ the eruption ----

/**
 * The eruption at the way out, made as the forged fireballs are: a sheet of frames of glowing gas, painted from noise a
 * couple of frames at a time (`warmEruptions`), here a plume bursting from a point on the edge into the field, white-hot at
 * its root and cooling to blue as it fans out, streaming outwards in tongues and thinning away.
 */
const COLS = 5;
const ROWS = 4;
const FRAMES = COLS * ROWS;
/** One frame's side, in pixels; the plume's root is at the middle of its right side. */
const CELL = 128;
const PER_CALL = 2;
/** The plume is this many field units long at its frame's full size. */
const PLUME = 185;

let sheet: HTMLCanvasElement | null = null;
let drawn = 0;

/** The heat → colour ramp of the white hole's light, as [heat, r, g, b]: deep blue where thin, white where hottest. */
const RAMP: readonly (readonly [number, number, number, number])[] = [
  [0, 20, 40, 110],
  [0.15, 50, 95, 205],
  [0.4, 120, 180, 255],
  [0.7, 210, 235, 255],
  [0.9, 250, 252, 255],
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
  // The plume shoots out fast and slows; it burns out from its tips back to the root.
  const reach = 0.1 + 0.72 * (1 - (1 - t) ** 2.2);
  const fuel = (1 - t) ** 1.1;
  for (let y = 0; y < CELL; y++) {
    for (let x = 0; x < CELL; x++) {
      // How far into the field (0 at the edge, 1 at the frame's far side) and how far along the edge.
      const depth = (CELL - x - 0.5) / CELL;
      const side = (y + 0.5) / CELL - 0.5;
      const r = Math.hypot(depth, side);
      const a = Math.atan2(side, depth);
      // A fan, strongest straight into the field.
      const lobe = Math.max(0, Math.cos(a * 0.85)) ** 1.1;
      // Gas billowing outwards: noise drifting into the field, bent by a slower one so it curls, and a third drawing it
      // out into broad tongues.
      const warp = 1.6 * (fbm(depth * 2 - t * 1.5, side * 2, 7.7, 41, 2) - 0.5);
      const n = fbm(depth * 3 - t * 2.4 + warp, side * 3 + warp, t * 0.8, 31, 4);
      const tongues = fbm(r * 2 - t * 3, a * 3, 3.3, 37, 3);
      const body = reach * lobe * (0.55 + 1.1 * n) + 0.12 * (tongues - 0.5) - r;
      if (body <= 0) continue;
      const density = smoothstep(0, 0.28 * reach, body);
      const core = clamp01(1 - r / (reach * 0.3)) ** 2 * (1 - t) ** 1.4;
      const heat = clamp01(density * fuel * (0.45 + 0.9 * tongues) + core * 0.9);
      ramp(heat, colour);
      const i = (y * CELL + x) * 4;
      img.data[i] = colour[0];
      img.data[i + 1] = colour[1];
      img.data[i + 2] = colour[2];
      // Fades before the frame's own border.
      img.data[i + 3] = 255 * clamp01(heat * 1.6) * smoothstep(1, 0.75, depth) * smoothstep(0.5, 0.36, Math.abs(side));
    }
  }
  c.putImageData(img, (index % COLS) * CELL, Math.floor(index / COLS) * CELL);
}

/** Paints the next frames of the eruption's sheet, until there are all of them. Called every frame the look draws. */
export function warmEruptions(): void {
  if (drawn >= FRAMES) return;
  if (!sheet) sheet = Object.assign(document.createElement('canvas'), { width: COLS * CELL, height: ROWS * CELL });
  const c = sheet.getContext('2d')!;
  for (let i = 0; i < PER_CALL && drawn < FRAMES; i++) paintFrame(c, drawn++);
}

/**
 * The white hole erupting at (x, y) on the edge, `out` pointing out of the field, `t` (0 → 1) through its life: a flash of
 * light along the edge as through a wide lens, a shock front with coloured fringes running into the field, and the plume.
 */
function drawEruption(ctx: CanvasRenderingContext2D, x: number, y: number, out: number, t: number): void {
  const k = 1 - t;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(out);
  ctx.globalCompositeOperation = 'lighter';

  // The root: a white bloom where it breaks through.
  const bloomR = 10 + 34 * k;
  const bloom = ctx.createRadialGradient(0, 0, 0, 0, 0, bloomR);
  bloom.addColorStop(0, rgba('#ffffff', 0.9 * k));
  bloom.addColorStop(0.4, rgba(WHITE_HOLE, 0.35 * k));
  bloom.addColorStop(1, rgba(FRINGE, 0));
  ctx.fillStyle = bloom;
  ctx.beginPath();
  ctx.arc(0, 0, bloomR, 0, TAU);
  ctx.fill();

  // The plume, two neighbouring frames blended (into the field is -x).
  if (sheet && drawn >= FRAMES) {
    const at = clamp01(t) * (FRAMES - 1);
    const first = Math.floor(at);
    const frac = at - first;
    for (const [index, alpha] of [[first, 1 - frac], [Math.min(FRAMES - 1, first + 1), frac]] as const) {
      if (alpha <= 0.01) continue;
      ctx.globalAlpha = alpha;
      // A pixel in from each side, or the root of the frame beside it bleeds in when the sheet is scaled.
      const inset = PLUME / CELL;
      ctx.drawImage(sheet, (index % COLS) * CELL + 1, Math.floor(index / COLS) * CELL + 1, CELL - 2, CELL - 2, -PLUME + inset, -PLUME / 2 + inset, PLUME - 2 * inset, PLUME - 2 * inset);
    }
    ctx.globalAlpha = 1;
  }

  // The shock front, quick: a half ring with its light split into colours at the edges.
  const shock = clamp01(t * 2.2);
  if (shock < 1) {
    const radius = 12 + 120 * easeOut(shock);
    for (const [dr, colour, alpha, width] of [[-2.5, '#ff6fae', 0.4, 1.4], [2.5, '#5fd8ff', 0.5, 1.4], [0, '#ffffff', 0.8, 1.2]] as const) {
      ctx.strokeStyle = rgba(colour, alpha * (1 - shock));
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.arc(0, 0, radius + dr, Math.PI / 2, Math.PI * 1.5);
      ctx.stroke();
    }
  }

  // The flash along the edge: a thin streak of light, as a wide lens draws a bright point out sideways.
  const length = 60 + 110 * easeOut(Math.min(1, t * 3));
  const fade = k ** 1.6;
  for (const [half, colour, alpha] of [[7, FRINGE, 0.22], [1.6, '#ffffff', 0.9]] as const) {
    const streak = ctx.createLinearGradient(0, -length, 0, length);
    streak.addColorStop(0, rgba(colour, 0));
    streak.addColorStop(0.5, rgba(colour, alpha * fade));
    streak.addColorStop(1, rgba(colour, 0));
    ctx.fillStyle = streak;
    ctx.fillRect(-2 - half, -length, half * 2, length * 2);
  }
  ctx.restore();
}
