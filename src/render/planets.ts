import { COLORS } from '../sim/config';
import type { Planet } from '../sim/physics';
import { createRng, range } from '../sim/rng';
import { clamp01, crater, LIGHT, makeCraters, mix, smoothstep, type Crater, type PlanetSprite } from './planet-common';
import { hexToRgb } from './color';
import { fbm } from './noise';

/** Hatching: two engraving directions (radians) and line spacing in field px. */
const HATCH_A = (32 * Math.PI) / 180;
const HATCH_B = (-40 * Math.PI) / 180;
const HATCH_SPACING = 3.1;

/** A planet's sprite in the classic look. The sprite may reach past the planet (a luminous one has a glow): draw it with `draw`, centred. */
export function renderPlanet(p: Planet, ps: number): PlanetSprite {
  const canvas = renderClassicPlanet(p, ps);
  return {
    size: canvas.width,
    draw: (ctx, x, y, scale) => ctx.drawImage(canvas, x - canvas.width / scale / 2, y - canvas.height / scale / 2, canvas.width / scale, canvas.height / scale),
  };
}

/**
 * Render a planet as an engraved, hand-hatched sphere: a lit tinted face, and a night side
 * drawn with line hatching that thickens and cross-hatches as it darkens into the plate.
 * `ps` = device pixels per field unit.
 */
function renderClassicPlanet(p: Planet, ps: number): HTMLCanvasElement {
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

