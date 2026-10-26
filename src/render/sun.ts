import type { Planet } from '../sim/physics';
import { rgba } from './color';
import { fbm } from './noise';

const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

/** The colour of the surface by temperature (0 cool, 1 hot): ember red, orange, gold, and nearly white where it is hottest. */
const RAMP: readonly (readonly [number, number, number, number])[] = [
  [0, 120, 26, 8],
  [0.3, 226, 76, 14],
  [0.58, 255, 150, 30],
  [0.82, 255, 214, 90],
  [1, 255, 248, 200],
];
function heat(t: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, t));
  for (let i = 1; i < RAMP.length; i++) {
    if (x > RAMP[i][0]) continue;
    const [t0, r0, g0, b0] = RAMP[i - 1];
    const [t1, r1, g1, b1] = RAMP[i];
    const k = (x - t0) / (t1 - t0);
    return [mix(r0, r1, k), mix(g0, g1, k), mix(b0, b1, k)];
  }
  return [255, 248, 200];
}

/** The plasma is worked out on a small grid and drawn up to the sun's size: it is all soft flow, so nothing is lost. */
const PLASMA = 120;
/** How often the surface is worked out again (s): the flow is slow, so this is plenty. */
const PLASMA_STEP = 1 / 24;

interface Plasma {
  canvas: HTMLCanvasElement;
  img: ImageData;
  at: number;
}
const plasmas = new Map<number, Plasma>();

/**
 * The sun's surface at `time`: gas that flows. One flow field warps another, so the gas folds in on itself and
 * churns; it is hot and bright in the middle of a fold and cool and dark in the seams, and the edge is dimmed and
 * reddened as on a ball seen from outside. It is worked out per pixel, a few times a second, and kept per sun.
 */
function plasma(seed: number, time: number): HTMLCanvasElement {
  let p = plasmas.get(seed);
  if (!p) {
    if (plasmas.size > 8) plasmas.clear();
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = PLASMA;
    p = { canvas, img: canvas.getContext('2d')!.createImageData(PLASMA, PLASMA), at: -Infinity };
    plasmas.set(seed, p);
  }
  if (time >= p.at && time - p.at < PLASMA_STEP) return p.canvas;
  p.at = time;
  const t = time * 0.16;
  const data = p.img.data;
  for (let py = 0; py < PLASMA; py++) {
    for (let px = 0; px < PLASMA; px++) {
      const x = ((px + 0.5) / PLASMA) * 2 - 1;
      const y = ((py + 0.5) / PLASMA) * 2 - 1;
      const rr = Math.hypot(x, y);
      const i = (py * PLASMA + px) * 4;
      if (rr >= 1) {
        data[i + 3] = 0;
        continue;
      }
      const z = Math.sqrt(1 - rr * rr);
      const qx = fbm(x * 1.9 + t, y * 1.9, z * 1.9, seed, 3);
      const qy = fbm(x * 1.9, y * 1.9 + t * 0.8, z * 1.9 + 4, seed + 7, 3);
      const f = fbm(x * 2.8 + qx * 2.6 + 1.7, y * 2.8 + qy * 2.6 + 9.2, z * 2.8 + t * 0.6, seed + 13, 3);
      const temp = (0.12 + 1.05 * Math.pow(f, 1.4)) * (0.5 + 0.5 * Math.pow(z, 0.5));
      const [r, g, b] = heat(temp);
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255 * smooth(1, 0.97, rr);
    }
  }
  p.canvas.getContext('2d')!.putImageData(p.img, 0, 0);
  return p.canvas;
}

/** How far the corona sprite reaches, in sun radii, and how many pixels across it is. */
const CORONA_REACH = 3.6;
const CORONA_TEX = 400;

/**
 * The corona, drawn once per sun in polar terms: a soft glow that thins out with distance, and rays of gas along it that
 * bend a little with the distance, from a noise on the angle. White-gold at the surface, orange, then deep red.
 */
function makeCorona(seed: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = CORONA_TEX;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(CORONA_TEX, CORONA_TEX);
  for (let py = 0; py < CORONA_TEX; py++) {
    for (let px = 0; px < CORONA_TEX; px++) {
      const u = (((px + 0.5) / CORONA_TEX) * 2 - 1) * CORONA_REACH;
      const v = (((py + 0.5) / CORONA_TEX) * 2 - 1) * CORONA_REACH;
      const rho = Math.hypot(u, v);
      if (rho >= CORONA_REACH || rho < 0.85) continue;
      // The angle, bent by the distance so the rays curve; read as a circle so there is no seam.
      const bend = rho * 0.22;
      const theta = Math.atan2(v, u) + bend;
      const c = Math.cos(theta);
      const s = Math.sin(theta);
      const broad = fbm(c * 1.7 + 4, s * 1.7, rho * 0.18, seed + 5, 3);
      const fine = fbm(c * 4.6, s * 4.6 + 9, rho * 0.35, seed + 13, 3);
      const ray = Math.pow(smooth(0.3, 0.78, broad * 0.65 + fine * 0.35), 1.5);
      const falloff = Math.exp(-(rho - 1) * 1.1);
      const glow = 0.16 * Math.exp(-(rho - 1) * 1.9);
      const a = Math.min(1, (ray * falloff * 0.9 + glow) * smooth(CORONA_REACH, CORONA_REACH * 0.7, rho) * smooth(0.85, 1.05, rho));
      const t = Math.min(1, (rho - 1) / 1.9);
      const i = (py * CORONA_TEX + px) * 4;
      img.data[i] = mix(255, 214, t);
      img.data[i + 1] = mix(222, 74, t);
      img.data[i + 2] = mix(150, 26, t);
      img.data[i + 3] = 255 * a;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

const coronas = new Map<number, HTMLCanvasElement>();

/** A seeded [0, 1) for one slot of a sun's loose parts (streamers, loops), the same on every screen. */
const slot = (seed: number, k: number): number => {
  const h = Math.sin((seed + k * 0.618) * 127.1) * 43758.5453;
  return h - Math.floor(h);
};

const LOOPS = 4;

/**
 * The sun of the Solar System mode: a ball of flowing plasma that folds and churns, a thin pink chromosphere round
 * it, magnetic loops that rise off the surface and fall back, a corona of curving rays, and a wide warm glow.
 * `flare` (0 → 1) is the storm breaking out: the glow swells, the loops leap high and the disc whitens.
 */
export function drawSun(ctx: CanvasRenderingContext2D, sun: Planet, time: number, alpha = 1, flare = 0): void {
  const R = sun.radius;
  const seed = sun.seed;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(sun.x, sun.y);
  ctx.globalCompositeOperation = 'lighter';

  // The glow: a tight bright one under a wide, deeper red one.
  const swell = 1 + flare * 0.9;
  for (const [reach, strength, inner, outer] of [[7, 0.2, '#ff7a24', '#a82410'], [3.2, 0.42, '#ffb347', '#ff6a1c'], [1.7, 0.5, '#ffe9a8', '#ffa03a']] as const) {
    const halo = ctx.createRadialGradient(0, 0, R * 0.7, 0, 0, R * reach * (reach > 3 ? 1 : swell));
    halo.addColorStop(0, rgba(inner, Math.min(1, strength * swell)));
    halo.addColorStop(0.35, rgba(outer, strength * 0.3 * swell));
    halo.addColorStop(1, rgba(outer, 0));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(0, 0, R * reach * swell, 0, Math.PI * 2);
    ctx.fill();
  }

  // The corona: its rays turn slowly, two layers against each other, and swell and ebb.
  let corona = coronas.get(seed);
  if (!corona) {
    if (coronas.size > 8) coronas.clear();
    coronas.set(seed, (corona = makeCorona(seed)));
  }
  const reach = R * CORONA_REACH * (1 + flare * 0.45);
  for (const [spin, turn0, strength] of [[0.02, 0, 0.9], [-0.034, 2.1, 0.55]] as const) {
    ctx.save();
    ctx.rotate(time * spin + turn0);
    ctx.globalAlpha = alpha * Math.min(1, strength * (0.82 + 0.18 * Math.sin(time * 0.5 + turn0 * 3)) * (1 + flare * 0.7));
    ctx.drawImage(corona, -reach, -reach, reach * 2, reach * 2);
    ctx.restore();
  }
  ctx.globalAlpha = alpha;

  // Magnetic loops: arches that rise off the surface, hang there a while, and sink back, each on its own beat.
  ctx.lineCap = 'round';
  for (let i = 0; i < LOOPS; i++) {
    const period = 11 + slot(seed, i + 80) * 9;
    const cycle = (time / period + slot(seed, i + 90)) % 1;
    const life = Math.sin(Math.PI * cycle) ** 1.6;
    const lift = Math.min(1, life + flare * 0.9);
    if (lift < 0.04) continue;
    const a0 = slot(seed, i + 100) * Math.PI * 2 + time * 0.01 + Math.floor(time / period + slot(seed, i + 90)) * 2.3;
    const span = 0.3 + slot(seed, i + 110) * 0.45;
    const a1 = a0 + span;
    const rise = R * (0.55 + slot(seed, i + 120) * 0.55) * lift * (1 + flare);
    const mid = a0 + span / 2;
    const base = (a: number, r: number): [number, number] => [Math.cos(a) * r, Math.sin(a) * r];
    const [x0, y0] = base(a0, R * 0.96);
    const [x1, y1] = base(a1, R * 0.96);
    const [cx0, cy0] = base(a0 + span * 0.12, R + rise * 1.35);
    const [cx1, cy1] = base(a1 - span * 0.12, R + rise * 1.35);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.bezierCurveTo(cx0, cy0, cx1, cy1, x1, y1);
    ctx.strokeStyle = rgba('#ff5a1a', 0.14 * lift);
    ctx.lineWidth = R * 0.34;
    ctx.stroke();
    ctx.strokeStyle = rgba('#ff8a2e', 0.5 * lift);
    ctx.lineWidth = R * 0.12;
    ctx.stroke();
    ctx.strokeStyle = rgba('#ffe2a6', 0.45 * lift);
    ctx.lineWidth = R * 0.04;
    ctx.stroke();
    // A glint where the arch peaks.
    const [px, py] = base(mid, R + rise);
    const spark = ctx.createRadialGradient(px, py, 0, px, py, R * 0.3);
    spark.addColorStop(0, rgba('#fff0c0', 0.55 * lift));
    spark.addColorStop(1, rgba('#ff8a2e', 0));
    ctx.fillStyle = spark;
    ctx.beginPath();
    ctx.arc(px, py, R * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';

  // The chromosphere: a thin pink-red rim just outside the ball.
  const chromo = ctx.createRadialGradient(0, 0, R * 0.96, 0, 0, R * 1.14);
  chromo.addColorStop(0, rgba('#ff3d28', 0));
  chromo.addColorStop(0.3, rgba('#ff4a2c', 0.8));
  chromo.addColorStop(1, rgba('#ff3d28', 0));
  ctx.fillStyle = chromo;
  ctx.beginPath();
  ctx.arc(0, 0, R * 1.14, 0, Math.PI * 2);
  ctx.fill();

  // The surface: flowing plasma.
  ctx.drawImage(plasma(seed, time), -R, -R, R * 2, R * 2);

  // Light from inside: a hot pulsing middle, a bright thin rim, and in a flare the whole disc whitens.
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, Math.PI * 2);
  ctx.clip();
  ctx.globalCompositeOperation = 'lighter';
  const pulse = 0.85 + 0.15 * Math.sin(time * 1.3);
  const core = ctx.createRadialGradient(-R * 0.12, -R * 0.14, 0, 0, 0, R);
  core.addColorStop(0, rgba('#fff4cc', (0.34 * pulse + flare * 0.5) * alpha));
  core.addColorStop(0.55, rgba('#ffc04a', (0.1 + flare * 0.3) * alpha));
  core.addColorStop(1, rgba('#ff8a2e', 0));
  ctx.fillStyle = core;
  ctx.fillRect(-R, -R, R * 2, R * 2);
  const rim = ctx.createRadialGradient(0, 0, R * 0.78, 0, 0, R);
  rim.addColorStop(0, rgba('#ff7a24', 0));
  rim.addColorStop(1, rgba('#ffb45a', 0.32 * alpha));
  ctx.fillStyle = rim;
  ctx.fillRect(-R, -R, R * 2, R * 2);
  ctx.restore();
  ctx.restore();
}
