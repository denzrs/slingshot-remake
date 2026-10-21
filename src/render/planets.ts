import { COLORS } from '../config';
import type { Planet } from '../physics';
import { createRng, range } from '../rng';
import { hexToRgb } from './color';
import { fbm } from './noise';

/** Light comes from the upper left, slightly in front. */
const LIGHT = normalize([-0.62, -0.5, 0.6]);
/** Hatching: two engraving directions (radians) and line spacing in field px. */
const HATCH_A = (32 * Math.PI) / 180;
const HATCH_B = (-40 * Math.PI) / 180;
const HATCH_SPACING = 3.1;

type Vec3 = [number, number, number];

interface Crater {
  c: Vec3;
  /** Cosine of the crater's angular radius. */
  cosR: number;
  depth: number;
}

/**
 * Render a planet as an engraved, hand-hatched sphere: a lit tinted face, and a night side
 * drawn with line hatching that thickens and cross-hatches as it darkens into the plate.
 * `ps` = device pixels per field unit.
 */
export function renderPlanet(p: Planet, ps: number): HTMLCanvasElement {
  const R = p.radius * ps;
  const size = Math.ceil(R * 2 + 4);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const data = img.data;

  const rng = createRng(p.seed);
  const tint = hexToRgb(p.tint);
  const ink = hexToRgb(COLORS.plate);
  const seed = p.seed;
  const spin = rng() * Math.PI * 2;
  const tilt = range(rng, -0.35, 0.35);
  const bandFreq = range(rng, 9, 16);
  const craters = makeCraters(p, rng);
  const albedo = albedoFn(p, seed, tilt, bandFreq, craters);

  const cs = Math.cos(spin);
  const sn = Math.sin(spin);
  const cA = Math.cos(HATCH_A), sA = Math.sin(HATCH_A);
  const cB = Math.cos(HATCH_B), sB = Math.sin(HATCH_B);
  const aa = 0.8 / (HATCH_SPACING * ps);
  const center = size / 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5 - center) / R;
      const dy = (y + 0.5 - center) / R;
      const rr = dx * dx + dy * dy;
      const dist = Math.sqrt(rr);
      const coverage = smoothstep(1 + 1 / R, 1 - 1 / R, dist);
      if (coverage <= 0) continue;
      const nz = Math.sqrt(Math.max(0, 1 - rr));

      // Texture lookup on a rotated sphere so every planet shows a different face.
      const tx = dx * cs + nz * sn;
      const tz = -dx * sn + nz * cs;
      const a = albedo(tx, dy, tz);

      const lambert = Math.max(0, dx * LIGHT[0] + dy * LIGHT[1] + nz * LIGHT[2]);
      const v = clamp01(0.05 + 0.95 * lambert * a);
      const dark = 1 - v;

      const fx = (x + 0.5) / ps;
      const fy = (y + 0.5) / ps;
      const u1 = (fx * cA + fy * sA) / HATCH_SPACING;
      const u2 = (fx * cB + fy * sB) / HATCH_SPACING;
      const d1 = Math.abs(u1 - Math.round(u1));
      const d2 = Math.abs(u2 - Math.round(u2));
      const w1 = dark * 0.56;
      const w2 = Math.max(0, dark - 0.52) * 1.1;
      const inkAmt = Math.max(smoothstep(w1 + aa, w1 - aa, d1), w2 > 0 ? smoothstep(w2 + aa, w2 - aa, d2) : 0);

      // Lit paper brightens towards bone; the ink is the plate itself, so shadows melt into space.
      const lift = 0.72 + 0.4 * v;
      const i = (y * size + x) * 4;
      data[i] = mix(Math.min(255, tint[0] * lift), ink[0], inkAmt);
      data[i + 1] = mix(Math.min(255, tint[1] * lift), ink[1], inkAmt);
      data[i + 2] = mix(Math.min(255, tint[2] * lift), ink[2], inkAmt);
      data[i + 3] = 255 * coverage;
    }
  }
  ctx.putImageData(img, 0, 0);

  // A fine limb line keeps the planet's true size readable on its night side.
  ctx.beginPath();
  ctx.arc(center, center, R - 0.5 * ps, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(${tint[0]},${tint[1]},${tint[2]},0.55)`;
  ctx.lineWidth = Math.max(1, 0.9 * ps);
  ctx.stroke();
  return canvas;
}

function makeCraters(p: Planet, rng: () => number): Crater[] {
  if (p.style === 'gas') return [];
  const count = p.style === 'rocky' ? 6 + Math.floor(rng() * 8) : 2 + Math.floor(rng() * 3);
  const out: Crater[] = [];
  for (let i = 0; i < count; i++) {
    const c = normalize([rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1]);
    const r = range(rng, 0.12, 0.42) * (i === 0 ? 1.3 : 1);
    out.push({ c, cosR: Math.cos(r), depth: range(rng, 0.25, 0.5) });
  }
  return out;
}

function albedoFn(p: Planet, seed: number, tilt: number, bandFreq: number, craters: Crater[]) {
  switch (p.style) {
    case 'gas':
      return (x: number, y: number, z: number) => {
        const lat = y * Math.cos(tilt) + x * Math.sin(tilt);
        const turb = fbm(x * 1.8, y * 1.8, z * 1.8, seed, 3);
        const band = Math.sin(lat * bandFreq + turb * 3.2);
        return 0.74 + 0.2 * band + 0.1 * (turb - 0.5);
      };
    case 'ice':
      return (x: number, y: number, z: number) => {
        const n = fbm(x * 3, y * 3, z * 3, seed, 4);
        const crack = Math.abs(n - 0.5) < 0.018 ? 0.72 : 1;
        return (0.86 + 0.18 * (n - 0.5)) * crack * crater(x, y, z, craters);
      };
    default:
      return (x: number, y: number, z: number) => {
        const n = fbm(x * 2.4, y * 2.4, z * 2.4, seed, 4);
        return (0.66 + 0.5 * (n - 0.5)) * crater(x, y, z, craters);
      };
  }
}

/** Bowl shading with a bright rim, 1 outside every crater. */
function crater(x: number, y: number, z: number, craters: Crater[]): number {
  let f = 1;
  for (const k of craters) {
    const d = x * k.c[0] + y * k.c[1] + z * k.c[2];
    if (d < k.cosR - 0.02) continue;
    // t: 0 at crater centre, 1 at its rim.
    const t = (1 - d) / (1 - k.cosR);
    if (t < 0.85) f *= 1 - k.depth * (1 - t * 0.6);
    else if (t < 1.15) f *= 1 + 0.25 * (1 - Math.abs(t - 1) / 0.15);
  }
  return f;
}

function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
