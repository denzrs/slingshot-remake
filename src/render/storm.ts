import { rgba } from './color';
import { fbm } from './noise';

/** Seconds the clouds take to fly out from the sun, and how long the sun flares. */
const FLIGHT = 1.5;
const DELAY = 0.12;
const FLARE_RISE = 0.3;

const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** How strongly the sun is flaring `age` seconds after the storm broke out: a quick rise, a slow fall. */
export const stormFlare = (age: number): number => (age < 0 ? 0 : age < FLARE_RISE ? age / FLARE_RISE : Math.exp(-(age - FLARE_RISE) * 1.3));

/** A pseudo-random [0, 1) from a cloud's seed and a slot, so every screen draws the same wisps and embers. */
const slot = (seed: number, k: number): number => {
  const h = Math.sin((seed * 1000 + k * 0.618) * 127.1) * 43758.5453;
  return h - Math.floor(h);
};

/** The sprite reaches this many cloud radii either side of the middle, and its fields are worked out on a coarse grid. */
const REACH = 1.35;
const GRID = 96;
const SIZE = 288;
/** How opaque the thickest plasma gets: a haze like a nebula's, so ships and shots read over it. */
const DENSITY = 0.5;

/** The plasma's colour by heat: deep red at the thin edge, orange, then gold in the hottest veins. */
const RAMP: readonly (readonly [number, number, number, number])[] = [
  [0, 150, 40, 18],
  [0.4, 214, 92, 34],
  [0.75, 244, 134, 58],
  [1, 255, 188, 120],
];
function heat(t: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, t));
  for (let i = 1; i < RAMP.length; i++) {
    if (x > RAMP[i][0]) continue;
    const [t0, r0, g0, b0] = RAMP[i - 1];
    const [t1, r1, g1, b1] = RAMP[i];
    const k = (x - t0) / (t1 - t0);
    return [r0 + (r1 - r0) * k, g0 + (g1 - g0) * k, b0 + (b1 - b0) * k];
  }
  return [255, 188, 120];
}

const sprites = new Map<number, HTMLCanvasElement>();

/**
 * A cloud of plasma, painted once per cloud from its seed: warped billows of gas with an uneven edge, hot
 * veins running through the thick of it. It is a haze like a nebula's, but lit from inside.
 */
function paint(seed: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;
  const s = Math.floor(seed * 1e6) | 0;
  const ph = [slot(seed, 1), slot(seed, 2), slot(seed, 3)].map((x) => x * Math.PI * 2);
  const body = new Float32Array(GRID * GRID);
  const vein = new Float32Array(GRID * GRID);
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      const u = (((x + 0.5) / GRID) * 2 - 1) * REACH;
      const v = (((y + 0.5) / GRID) * 2 - 1) * REACH;
      const angle = Math.atan2(v, u);
      const edge = 1 + 0.2 * Math.sin(3 * angle + ph[0]) + 0.12 * Math.sin(5 * angle + ph[1]) + 0.07 * Math.sin(7 * angle + ph[2]);
      const envelope = smooth(1.02, 0.1, Math.hypot(u, v) / edge);
      if (envelope <= 0) continue;
      const wx = fbm(u * 1.6 + ph[0], v * 1.6, 1.7, s + 11, 3);
      const wy = fbm(u * 1.6, v * 1.6 + ph[1], 3.1, s + 29, 3);
      const gas = fbm(u * 2.4 + (wx - 0.5) * 2.2 + ph[0], v * 2.4 + (wy - 0.5) * 2.2 + ph[1], 0.4, s, 4);
      body[y * GRID + x] = envelope * (0.22 + 0.78 * smooth(0.24, 0.78, gas));
      // Veins: the ridges of another warped field, bright where the gas is thick.
      const ridge = 1 - Math.abs(2 * fbm(u * 4 + wx * 2.4, v * 4 + wy * 2.4, 3.3, s + 57, 3) - 1);
      vein[y * GRID + x] = smooth(0.8, 0.96, ridge);
    }
  }
  const sample = (field: Float32Array, gx: number, gy: number): number => {
    const x = Math.min(GRID - 1.001, Math.max(0, gx));
    const y = Math.min(GRID - 1.001, Math.max(0, gy));
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = x - xi;
    const fy = y - yi;
    const i = yi * GRID + xi;
    return (field[i] * (1 - fx) + field[i + 1] * fx) * (1 - fy) + (field[i + GRID] * (1 - fx) + field[i + GRID + 1] * fx) * fy;
  };
  const img = ctx.createImageData(SIZE, SIZE);
  const per = GRID / SIZE;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const f = sample(body, (x + 0.5) * per - 0.5, (y + 0.5) * per - 0.5);
      if (f <= 0.004) continue;
      const w = sample(vein, (x + 0.5) * per - 0.5, (y + 0.5) * per - 0.5);
      const [r, g, b] = heat(f * 0.74 + w * f * 0.16);
      const i = (y * SIZE + x) * 4;
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = 255 * DENSITY * smooth(0, 0.9, f);
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/**
 * The burst itself: two shock rings running out from the sun, fading as they go. Drawn behind the clouds.
 */
export function drawStormBurst(ctx: CanvasRenderingContext2D, sun: { x: number; y: number; radius: number }, age: number): void {
  if (age < 0 || age > 2.2) return;
  ctx.save();
  ctx.translate(sun.x, sun.y);
  ctx.globalCompositeOperation = 'lighter';
  for (const [delay, speed, width] of [[0, 560, 4], [0.2, 430, 2.5]] as const) {
    const t = age - delay;
    if (t <= 0) continue;
    const fade = Math.max(0, 1 - t / 1.6) ** 2;
    if (fade <= 0) continue;
    const r = sun.radius * 1.2 + t * speed * (1 - 0.35 * Math.min(1, t / 1.6));
    const ring = ctx.createRadialGradient(0, 0, Math.max(0, r - width * 2.5), 0, 0, r + width);
    ring.addColorStop(0, rgba('#ff5a1a', 0));
    ring.addColorStop(0.75, rgba('#ff8a3a', 0.15 * fade));
    ring.addColorStop(0.93, rgba('#ffe2a6', 0.42 * fade));
    ring.addColorStop(1, rgba('#ff5a1a', 0));
    ctx.fillStyle = ring;
    ctx.beginPath();
    ctx.arc(0, 0, r + width, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** A couple of electric arcs jump around a shot while it is inside the sun's storm. */
export function drawStormSparks(ctx: CanvasRenderingContext2D, x: number, y: number, time: number, seed: number): void {
  const beat = Math.floor(time * 24);
  ctx.save();
  ctx.translate(x, y);
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let arc = 0; arc < 2; arc++) {
    const phase = beat * 7 + arc * 19;
    const angle = slot(seed, phase) * Math.PI * 2;
    const length = 6 + slot(seed, phase + 1) * 6;
    const points: [number, number][] = [];
    for (let i = 0; i <= 4; i++) {
      const along = 2 + (length * i) / 4;
      const across = i === 0 || i === 4 ? 0 : (slot(seed, phase + i * 3) - 0.5) * 5;
      points.push([
        Math.cos(angle) * along - Math.sin(angle) * across,
        Math.sin(angle) * along + Math.cos(angle) * across,
      ]);
    }
    ctx.beginPath();
    points.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
    ctx.strokeStyle = rgba('#78dfff', 0.4);
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.strokeStyle = rgba('#e7fbff', 0.95);
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * One cloud of the sun's storm. It is flung out of the sun trailing fire, swelling
 * past its size and settling; after that it lies in place, a nebula's haze of plasma lit from inside, with a
 * pulsing heart and a few embers drifting round in it. `age` is the seconds since the storm broke out; `dissolve`
 * (0 → 1) is the cloud thinning away at the end of its life.
 */
export function drawStormCloud(
  ctx: CanvasRenderingContext2D,
  cloud: { x: number; y: number; radius: number; seed: number },
  sun: { x: number; y: number },
  age: number,
  time: number,
  dissolve = 0,
): void {
  const p = Math.min(1, (age - DELAY) / FLIGHT);
  if (p <= 0) return;
  let image = sprites.get(cloud.seed);
  if (!image) {
    if (sprites.size >= 16) sprites.delete(sprites.keys().next().value as number);
    sprites.set(cloud.seed, (image = paint(cloud.seed)));
  }
  const ease = 1 - (1 - p) ** 3;
  const size = 0.2 + 0.8 * ease + 0.1 * Math.sin(p * Math.PI);
  const x = sun.x + (cloud.x - sun.x) * ease;
  const y = sun.y + (cloud.y - sun.y) * ease;
  const r = cloud.radius * size;
  const base = ctx.globalAlpha;
  ctx.save();

  // The cloud is thrown out trailing fire: glowing puffs behind it, smaller and fainter the further back.
  if (p < 1) {
    ctx.globalCompositeOperation = 'lighter';
    for (let k = 1; k <= 9; k++) {
      const back = (k / 9) * Math.min(1, ease * 1.1) * 0.75;
      const px = x + (sun.x - x) * back;
      const py = y + (sun.y - y) * back;
      const rr = r * (0.55 - 0.4 * (k / 9));
      const puff = ctx.createRadialGradient(px, py, 0, px, py, rr);
      puff.addColorStop(0, rgba('#ffc47a', 0.26 * (1 - k / 10) * (1 - p) * base));
      puff.addColorStop(1, rgba('#ff5a1a', 0));
      ctx.fillStyle = puff;
      ctx.beginPath();
      ctx.arc(px, py, rr, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  // Two layers of the same gas turning against each other, once plainly and once glowing.
  const fade = base * smooth(0, 0.3, p) * (1 - dissolve);
  const half = r * REACH;
  for (const [angle, scale, alpha] of [
    [slot(cloud.seed, 4) * 6.3 + time * 0.02, 1, 1],
    [slot(cloud.seed, 5) * 6.3 - time * 0.03, 0.82, 0.55],
  ] as const) {
    ctx.save();
    ctx.globalAlpha = fade * alpha;
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.drawImage(image, -half * scale, -half * scale, half * 2 * scale, half * 2 * scale);
    ctx.restore();
  }

  // A heart of hot plasma, and embers drifting in the gas.
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = fade;
  const pulse = 0.8 + 0.2 * Math.sin(time * 1.6 + cloud.seed * 9);
  const heart = ctx.createRadialGradient(x, y, 0, x, y, r * 0.65);
  heart.addColorStop(0, rgba('#ffd9a0', 0.14 * pulse));
  heart.addColorStop(0.5, rgba('#ff7a2a', 0.05 * pulse));
  heart.addColorStop(1, rgba('#ff5a1a', 0));
  ctx.fillStyle = heart;
  ctx.beginPath();
  ctx.arc(x, y, r * 0.65, 0, Math.PI * 2);
  ctx.fill();
  for (let i = 0; i < 6; i++) {
    const a = slot(cloud.seed, i + 10) * Math.PI * 2 + time * (0.12 + slot(cloud.seed, i + 20) * 0.22) * (i % 2 ? 1 : -1);
    const d = r * (0.12 + slot(cloud.seed, i + 40) * 0.62);
    const flicker = 0.5 + 0.5 * Math.sin(time * (1.5 + slot(cloud.seed, i + 60) * 2) + i * 2.1);
    ctx.fillStyle = rgba('#ffe9b8', 0.08 + 0.3 * flicker);
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d * 0.85, 1 + slot(cloud.seed, i + 80) * 1.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  ctx.globalAlpha = base;
}
