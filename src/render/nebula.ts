import { COLORS } from '../sim/config';
import { hexToRgb } from './color';
import { fbm } from './noise';

/**
 * A nebula is a haze: soft billows of gas, thin at the edge and thicker in the middle, tinted towards the plate's
 * own blue so it sits with the chart. It stays dim and low in contrast, with no outlines, veins or white highlights, so
 * ships and shots read over it, and a little fine grain breaks the smoothness up. The gas is a domain-warped
 * noise field from the cloud's seed, so whoever draws the cloud draws the same one. It is painted once per
 * cloud into a sprite, and drawn as two layers drifting slowly against each other.
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

/** Half the sprite's width in cloud radii: room for the widest bulge of the edge. */
const REACH = 1.4;
/** The thickness field is worked out on a coarse grid of this many cells, then sampled smoothly. */
const GRID = 160;
/** How opaque the thickest gas gets. Low, so the cloud is a haze and never a wall. */
const DENSITY = 0.4;

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** A [0, 1) value for an integer cell, for the grain. */
function cellHash(i: number, j: number, seed: number): number {
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ seed;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/** The sprite sizes on offer, in device pixels: the one nearest the size the cloud is drawn at is used. */
const SIZES = [384, 512, 768] as const;
const sprites = new Map<string, HTMLCanvasElement>();

/** The cloud's thickness on the coarse grid: 0 outside, rising to 1 in its densest gas. */
function thickness(seed: number): Float32Array {
  const p = phases(seed);
  const s = Math.floor(seed * 1e6) | 0;
  const ox = p[0] * 3;
  const oy = p[1] * 3;
  const field = new Float32Array(GRID * GRID);
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      const u = (((x + 0.5) / GRID) * 2 - 1) * REACH;
      const v = (((y + 0.5) / GRID) * 2 - 1) * REACH;
      const envelope = smoothstep(1.02, 0.1, Math.hypot(u, v) / wobble(Math.atan2(v, u), p));
      if (envelope <= 0) continue;
      // Warp the domain with two slower fields so the gas curls instead of lying in blobs.
      const wx = fbm(u * 1.4 + ox, v * 1.4, 1.7, s + 11, 3);
      const wy = fbm(u * 1.4, v * 1.4 + oy, 3.1, s + 29, 3);
      const body = fbm(u * 2.1 + (wx - 0.5) * 1.8 + ox, v * 2.1 + (wy - 0.5) * 1.8 + oy, 0.4, s, 5);
      // A base of thickness under the whole cloud keeps it one body; the billows ride on top of it.
      field[y * GRID + x] = envelope * (0.22 + 0.78 * smoothstep(0.24, 0.78, body));
    }
  }
  return field;
}

/** Paints one cloud at `size` pixels across. */
function paint(seed: number, color: string, size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const data = img.data;
  const edge = hexToRgb(color);
  // The thick middle is a lighter tint of the same colour, never white.
  const core = hexToRgb(blend(color, COLORS.boneDim, 0.45));
  const field = thickness(seed);
  const s = Math.floor(seed * 1e6) | 0;

  /** Bilinear sample of the coarse grid, in grid cells. */
  const sample = (gx: number, gy: number): number => {
    const x = Math.min(GRID - 1.001, Math.max(0, gx));
    const y = Math.min(GRID - 1.001, Math.max(0, gy));
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = x - xi;
    const fy = y - yi;
    const i = yi * GRID + xi;
    return (field[i] * (1 - fx) + field[i + 1] * fx) * (1 - fy) + (field[i + GRID] * (1 - fx) + field[i + GRID + 1] * fx) * fy;
  };

  const perPx = GRID / size;
  const grain = Math.max(1, Math.round(size / 300));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const f = sample((x + 0.5) * perPx - 0.5, (y + 0.5) * perPx - 0.5);
      if (f <= 0.004) continue;
      const mix = smoothstep(0.35, 1, f) * 0.8;
      // Grain: a few percent either way, in blocks of a pixel or two, so the haze is not smooth as plastic.
      const noise = 0.88 + 0.24 * cellHash(Math.floor(x / grain), Math.floor(y / grain), s);
      const i = (y * size + x) * 4;
      data[i] = edge[0] + (core[0] - edge[0]) * mix;
      data[i + 1] = edge[1] + (core[1] - edge[1]) * mix;
      data[i + 2] = edge[2] + (core[2] - edge[2]) * mix;
      data[i + 3] = 255 * DENSITY * smoothstep(0, 0.9, f) * noise;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** The painting for a cloud at about `pixels` across, made once and kept (the last few clouds only). */
function sprite(seed: number, color: string, pixels: number): HTMLCanvasElement {
  const size = SIZES.find((s) => s >= pixels * 0.85) ?? SIZES[SIZES.length - 1];
  const key = `${seed}:${color}:${size}`;
  let canvas = sprites.get(key);
  if (!canvas) {
    if (sprites.size >= 12) sprites.delete(sprites.keys().next().value as string);
    canvas = paint(seed, color, size);
    sprites.set(key, canvas);
  }
  return canvas;
}

/**
 * Draws a whole cloud: two layers of the same haze, turning slowly against each other, and breathing a little.
 * `color` is the power-up's colour, eased towards the plate's line colour so it sits with the rest of the chart.
 */
export function drawNebula(ctx: CanvasRenderingContext2D, n: { x: number; y: number; radius: number; seed: number }, color: string, time = 0): void {
  const [p0, p1] = phases(n.seed);
  const r = n.radius * (1 + 0.02 * Math.sin(time * 0.7 + p1));
  const scale = ctx.getTransform().a;
  const image = sprite(n.seed, blend(color, COLORS.line, 0.3), r * REACH * 2 * scale);
  const base = ctx.globalAlpha;
  const layer = (angle: number, size: number, alpha: number): void => {
    const half = r * REACH * size;
    ctx.save();
    ctx.globalAlpha = base * alpha;
    ctx.translate(n.x, n.y);
    ctx.rotate(angle);
    ctx.drawImage(image, -half, -half, half * 2, half * 2);
    ctx.restore();
  };
  layer(p0 + time * 0.02, 1, 1);
  layer(p1 - time * 0.03, 0.82, 0.55);
}

/** `a` eased towards `b` by `t`, as a hex colour. */
function blend(a: string, b: string, t: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  const c = (i: number): string =>
    Math.round(x[i] + (y[i] - x[i]) * t)
      .toString(16)
      .padStart(2, '0');
  return `#${c(0)}${c(1)}${c(2)}`;
}
