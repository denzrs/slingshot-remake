import { COLORS } from '../sim/config';
import type { Planet } from '../sim/physics';
import { createRng, range } from '../sim/rng';
import { clamp01, crater, isLocked, lavaVeins, LIGHT, makeCraters, mix, normalize, smoothstep, type Crater, type PlanetSprite, type Vec3 } from './planet-common';
import { hexToRgb } from './color';
import { fbm } from './noise';

/** Hatching: two engraving directions (radians) and line spacing in field px. */
const HATCH_A = (32 * Math.PI) / 180;
const HATCH_B = (-40 * Math.PI) / 180;
const HATCH_SPACING = 3.1;
/** The glow of a lava planet's molten veins: the same by day and by night, laid over the hatching. */
const MOLTEN: [number, number, number] = [255, 168, 84];
/** What glows only in the dark: a living world's veins, a machine world's lamps. */
const BLOOM: [number, number, number] = [110, 240, 225];
const LAMPS: [number, number, number] = [255, 190, 100];
/** A locked world's face to the light is ice whatever its style; how far round its melt reaches (in light, −1 → 1) is its style's. */
const LOCKED_ICE = '#bcd3dc';
const MELT_REACH: Partial<Record<Planet['style'], number>> = { lava: 0.2, ice: 0 };

/** A planet's sprite in the classic look. The sprite may reach past the planet (a forged one has a glow): draw it with `draw`, centred. */
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
  const locked = isLocked(p);
  const tint = hexToRgb(locked ? LOCKED_ICE : p.tint);
  const ink = hexToRgb(COLORS.plate);
  const seed = p.seed;
  const spin = rng() * Math.PI * 2;
  const tilt = range(rng, -0.35, 0.35);
  const bandFreq = range(rng, 9, 16);
  const craters = makeCraters(p, rng);
  const reach = MELT_REACH[p.style] ?? 0;
  const albedo = locked ? lockedAlbedo(seed, reach) : albedoFn(p, seed, tilt, bandFreq, craters);
  const glowing = glowFn(p, seed, locked, reach);

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
      // A locked world's faces are set by the light, so it is looked up on the sphere as seen, not turned.
      const a = locked ? albedo(dx, dy, nz) : albedo(tx, dy, tz);

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
      const glow = glowing ? glowing.at(tx, dy, tz, dx, nz, dx * LIGHT[0] + dy * LIGHT[1] + nz * LIGHT[2]) : 0;
      const hue = glowing?.colour ?? MOLTEN;
      data[i] = mix(mix(Math.min(255, tint[0] * lift), ink[0], inkAmt), hue[0], glow);
      data[i + 1] = mix(mix(Math.min(255, tint[1] * lift), ink[1], inkAmt), hue[1], glow);
      data[i + 2] = mix(mix(Math.min(255, tint[2] * lift), ink[2], inkAmt), hue[2], glow);
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
    case 'lava':
      // A dark crust: the veins between its plates glow on their own (`moltenFn`).
      return (x: number, y: number, z: number) => 0.5 + 0.3 * (fbm(x * 3.2, y * 3.2, z * 3.2, seed + 7, 3) - 0.5);
    case 'ocean':
      // Calm water, a few islands, a cap of ice at each pole.
      return (x: number, y: number, z: number) => {
        const n = fbm(x * 2.2, y * 2.2, z * 2.2, seed, 4);
        const land = smoothstep(0.64, 0.68, n);
        return mix(0.8 + 0.06 * (n - 0.5), 0.62, land) + 0.25 * smoothstep(0.85, 0.95, Math.abs(y));
      };
    case 'desert':
      // Long dunes, wind-bent, over a darker bedrock showing through here and there.
      return (x: number, y: number, z: number) => {
        const warp = fbm(x * 1.6, y * 1.6, z * 1.6, seed, 3);
        const dune = Math.sin((x + z) * 14 + warp * 9);
        return 0.78 + 0.14 * dune - 0.25 * smoothstep(0.62, 0.7, fbm(x * 1.3, y * 1.3, z * 1.3, seed + 5, 3));
      };
    case 'acid':
      // Pale crust, and bright lakes ringed in dark.
      return (x: number, y: number, z: number) => {
        const n = fbm(x * 1.8, y * 1.8, z * 1.8, seed + 3, 4);
        const rim = smoothstep(0.03, 0, Math.abs(n - 0.6));
        return n > 0.6 ? 0.98 : 0.68 + 0.2 * (fbm(x * 3, y * 3, z * 3, seed, 3) - 0.5) - 0.35 * rim;
      };
    case 'carbon':
      // Dark, with diamonds glinting in it (its tints are dark already: the engraving still has to show it against the plate).
      return (x: number, y: number, z: number) => {
        const sparkle = smoothstep(0.74, 0.8, fbm(x * 22, y * 22, z * 22, seed + 11, 2));
        return 0.62 + 0.2 * (fbm(x * 2.6, y * 2.6, z * 2.6, seed, 4) - 0.5) + 1.2 * sparkle;
      };
    case 'crystal':
      return facetFn(seed);
    case 'living':
      // Living land and dark seas, as on a rocky world but with no craters.
      return (x: number, y: number, z: number) => {
        const n = fbm(x * 2, y * 2, z * 2, seed, 4);
        return n > 0.5 ? 0.8 + 0.2 * (n - 0.5) : 0.55;
      };
    case 'machine':
      return panelFn(seed);
    default:
      return (x: number, y: number, z: number) => {
        const n = fbm(x * 2.4, y * 2.4, z * 2.4, seed, 4);
        return (0.66 + 0.5 * (n - 0.5)) * crater(x, y, z, craters);
      };
  }
}


/** A crystal: flat facets round some points of the sphere, each its own shade, their edges catching the light. */
function facetFn(seed: number) {
  const rng = createRng(seed ^ 0x51ed27);
  const points: Vec3[] = Array.from({ length: 34 }, () => normalize([rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1]));
  const shades = points.map(() => range(rng, 0.62, 1.05));
  return (x: number, y: number, z: number) => {
    let best = -2;
    let second = -2;
    let shade = 1;
    points.forEach((q, k) => {
      const d = x * q[0] + y * q[1] + z * q[2];
      if (d > best) {
        second = best;
        best = d;
        shade = shades[k];
      } else if (d > second) second = d;
    });
    return shade + 0.35 * smoothstep(0.015, 0, best - second);
  };
}

/** A machine world: plating in panels along its latitude and longitude, dark seams between, each panel its own shade. */
function panelFn(seed: number) {
  return (x: number, y: number, z: number) => {
    const lon = (Math.atan2(x, z) / Math.PI + 1) * 12;
    const lat = (Math.asin(Math.max(-1, Math.min(1, y))) / Math.PI + 0.5) * 12;
    const seam = Math.min(Math.abs(lon - Math.round(lon)), Math.abs(lat - Math.round(lat)));
    const cell = Math.sin(Math.floor(lon) * 12.9898 + Math.floor(lat) * 78.233 + seed) * 43758.5453;
    return seam < 0.06 ? 0.45 : 0.7 + 0.22 * (cell - Math.floor(cell));
  };
}

/** A tidally locked world, as seen (it does not turn): ice towards the light, a dark crust round the terminator, and on the far side the melt (`glowFn`). */
function lockedAlbedo(seed: number, reach: number) {
  return (dx: number, dy: number, nz: number) => {
    const towards = dx * LIGHT[0] + dy * LIGHT[1] + nz * LIGHT[2] + 0.25 * (fbm(dx * 2.4, dy * 2.4, nz * 2.4, seed, 3) - 0.5);
    const ice = 0.92 + 0.12 * (fbm(dx * 3, dy * 3, nz * 3, seed + 9, 3) - 0.5);
    return mix(0.4, ice, smoothstep(reach - 0.05, reach + 0.15, towards));
  };
}

/** What of a planet glows of itself in the engraving, and in what colour: a lava world's veins, a locked world's far side, a living world's veins and a machine world's lamps at night. */
function glowFn(p: Planet, seed: number, locked: boolean, reach: number) {
  if (locked) {
    return {
      colour: MOLTEN,
      // Looked up on the sphere as seen (`dy` is the same either way): the melt lies away from the light, not on the turned map.
      at: (_tx: number, dy: number, _tz: number, dx: number, nz: number) => {
        const away = -(dx * LIGHT[0] + dy * LIGHT[1] + nz * LIGHT[2]) + 0.25 * (fbm(dx * 2.4, dy * 2.4, nz * 2.4, seed, 3) - 0.5);
        const sea = smoothstep(0.05 - reach, 0.25 - reach, away);
        const crack = smoothstep(0.04, 0.012, Math.abs(fbm(dx * 3.5, dy * 3.5, nz * 3.5, seed + 4, 3) - 0.5)) * smoothstep(-0.15 - reach, 0.05 - reach, away);
        return 0.9 * Math.max(sea * (0.75 + 0.25 * fbm(dx * 5, dy * 5, nz * 5, seed + 2, 2)), crack);
      },
    };
  }
  if (p.style === 'lava') {
    const molten = moltenFn(seed);
    return { colour: MOLTEN, at: (x: number, y: number, z: number) => molten(x, y, z) };
  }
  if (p.style === 'living') {
    return {
      colour: BLOOM,
      at: (x: number, y: number, z: number, _dx: number, _nz: number, lambert: number) => {
        const vein = smoothstep(0.03, 0.01, Math.abs(fbm(x * 3, y * 3, z * 3, seed + 21, 3) - 0.5));
        return 0.85 * vein * smoothstep(0.5, 0.52, fbm(x * 2, y * 2, z * 2, seed, 4)) * smoothstep(0.15, -0.1, lambert);
      },
    };
  }
  if (p.style === 'machine') {
    return {
      colour: LAMPS,
      at: (x: number, y: number, z: number, _dx: number, _nz: number, lambert: number) => {
        const lights = smoothstep(0.6, 0.66, fbm(x * 9, y * 9, z * 9, seed + 13, 2));
        return 0.9 * lights * smoothstep(0.15, -0.1, lambert);
      },
    };
  }
  return null;
}

/** How much a lava planet's surface glows at a point of the sphere (0 → 1): thin veins where the noise crosses its middle, wider where they meet. */
function moltenFn(seed: number) {
  return (x: number, y: number, z: number) => {
    const pool = fbm(x * 1.3, y * 1.3, z * 1.3, seed + 31, 2);
    return 0.9 * lavaVeins(x, y, z, seed, 0.03 + 0.05 * smoothstep(0.55, 0.75, pool));
  };
}
