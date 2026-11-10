import { COLORS } from '../sim/config';
import type { Planet } from '../sim/physics';
import { createRng, range } from '../sim/rng';
import { clamp01, crater, hasLifeBand, lavaVeins, LIGHT, LOCK_SUN, lockFace, SEA_SUN, makeCraters, mix, normalize, smoothstep, type Crater, type LockFace, type PlanetSprite, type Vec3 } from './planet-common';
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
/** An eyeball world's open sea, laid over its ice. */
const SEA: [number, number, number] = [40, 110, 190];
/** A locked world's bare rock under its sun, laid over its ice, and the green band of life some have round their terminator. */
const ROCK: [number, number, number] = [150, 118, 88];
const LIFE: [number, number, number] = [98, 118, 80];
/** Its meltwater, running off the ice into the rock. */
const MELTWATER: [number, number, number] = [58, 104, 150];
/** A locked world's face away from the light is ice whatever its style; how far round its melt reaches (in light, −1 → 1) is its style's. */
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
  const face = lockFace(p);
  const locked = face !== null;
  const tint = hexToRgb(locked ? LOCKED_ICE : p.tint);
  const ink = hexToRgb(COLORS.plate);
  const seed = p.seed;
  const spin = rng() * Math.PI * 2;
  const tilt = range(rng, -0.35, 0.35);
  const bandFreq = range(rng, 9, 16);
  const craters = makeCraters(p, rng);
  const reach = MELT_REACH[p.style] ?? 0;
  const albedo = face === 'sea' ? eyeballAlbedo(seed) : face === 'rock' ? lockedRockAlbedo(seed, rng) : face ? lockedAlbedo(seed, reach) : albedoFn(p, seed, tilt, bandFreq, craters);
  const glowing = glowFn(p, seed, face, reach);

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
      const hue = glowing?.hueAt?.(dx, dy, nz) ?? glowing?.colour ?? MOLTEN;
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
    case 'iron':
      // Bare metal, brushed along its latitude, pitted by craters; bright where it is polished.
      return (x: number, y: number, z: number) => {
        const brushed = Math.sin(y * 40 + 6 * fbm(x * 1.5, y * 6, z * 1.5, seed, 3));
        return (0.82 + 0.06 * brushed + 0.25 * (fbm(x * 2.2, y * 2.2, z * 2.2, seed + 3, 4) - 0.5)) * crater(x, y, z, craters);
      };
    case 'hycean':
      // Soft, wide bands of a deep sky, the sea dark in the gaps between them.
      return (x: number, y: number, z: number) => {
        const lat = y * Math.cos(tilt) + x * Math.sin(tilt);
        const band = Math.sin(lat * bandFreq * 0.45 + fbm(x * 1.6, y * 1.6, z * 1.6, seed, 3) * 2.4);
        const gap = smoothstep(0.58, 0.66, fbm(x * 2.8, y * 2.8, z * 2.8, seed + 6, 3));
        return 0.8 + 0.1 * band - 0.3 * gap;
      };
    case 'fungal':
      // Pale caps on a dark ground, in patches.
      return (x: number, y: number, z: number) => {
        const cap = fungalCap(x, y, z, seed);
        return mix(0.5 + 0.12 * (fbm(x * 3, y * 3, z * 3, seed, 3) - 0.5), 0.95, smoothstep(0.62, 0.66, cap));
      };
    case 'volcanic':
      // Mottled sulphur and frost, dark calderas (their molten floors glow: `glowFn`).
      return (x: number, y: number, z: number) => {
        const tone = 0.86 + 0.25 * (fbm(x * 2.6, y * 2.6, z * 2.6, seed, 4) - 0.5);
        return tone * (1 - 0.6 * smoothstep(0.66, 0.7, calderaFn(x, y, z, seed)));
      };
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

/** How much a fungal world's caps rise at a point of the sphere: past 0.62 a cap, its rim (gills) just round 0.62. */
function fungalCap(x: number, y: number, z: number, seed: number): number {
  return fbm(x * 4.5, y * 4.5, z * 4.5, seed + 17, 2) + 0.2 * (fbm(x * 1.4, y * 1.4, z * 1.4, seed + 19, 2) - 0.5);
}

/** A volcanic moon's calderas: past 0.66 a dark pit, past 0.72 its molten floor. */
function calderaFn(x: number, y: number, z: number, seed: number): number {
  return fbm(x * 5, y * 5, z * 5, seed + 23, 2);
}

/** An eyeball world, as seen (it does not turn): a round open sea towards the light, a dark shore round it, ice beyond. */
function eyeballAlbedo(seed: number) {
  return (dx: number, dy: number, nz: number) => {
    const towards = dx * SEA_SUN[0] + dy * SEA_SUN[1] + nz * SEA_SUN[2] + 0.2 * (fbm(dx * 2.4, dy * 2.4, nz * 2.4, seed, 3) - 0.5);
    const ice = 0.95 + 0.1 * (fbm(dx * 3, dy * 3, nz * 3, seed + 9, 3) - 0.5);
    const shore = smoothstep(0.08, 0, Math.abs(towards - 0.12));
    return mix(mix(ice, 0.5, smoothstep(0.09, 0.17, towards)), 0.35, shore * 0.7);
  };
}

/** A tidally locked world, as seen (it does not turn): the melt towards the light (`glowFn`), a dark crust round the terminator, and ice on the far, dark side. */
function lockedAlbedo(seed: number, reach: number) {
  return (dx: number, dy: number, nz: number) => {
    const away = -(dx * LOCK_SUN[0] + dy * LOCK_SUN[1] + nz * LOCK_SUN[2]) + 0.25 * (fbm(dx * 2.4, dy * 2.4, nz * 2.4, seed, 3) - 0.5);
    const ice = 0.92 + 0.12 * (fbm(dx * 3, dy * 3, nz * 3, seed + 9, 3) - 0.5);
    return mix(0.4, ice, smoothstep(reach - 0.05, reach + 0.15, away));
  };
}

/** A tidally locked world with no melt, as seen (it does not turn): bare cracked rock towards the light, cratered thick (its colour laid on by `glowFn`), ice on the far, dark side. */
function lockedRockAlbedo(seed: number, rng: () => number) {
  // More and deeper craters than a rocky world's, all on the side towards the light: nothing there wears them down.
  const craters: Crater[] = [];
  for (let i = 0, count = 9 + Math.floor(rng() * 7); i < count; i++) {
    const c = normalize([LOCK_SUN[0] + range(rng, -0.9, 0.9), LOCK_SUN[1] + range(rng, -0.9, 0.9), LOCK_SUN[2] + range(rng, -0.9, 0.9)]);
    const r = range(rng, 0.1, 0.34) * (i === 0 ? 1.4 : 1);
    craters.push({ c, cosR: Math.cos(r), depth: range(rng, 0.35, 0.6) });
  }
  return (dx: number, dy: number, nz: number) => {
    const towards = dx * LOCK_SUN[0] + dy * LOCK_SUN[1] + nz * LOCK_SUN[2] + 0.25 * (fbm(dx * 2.4, dy * 2.4, nz * 2.4, seed, 3) - 0.5);
    const ice = 0.92 + 0.12 * (fbm(dx * 3, dy * 3, nz * 3, seed + 9, 3) - 0.5);
    const crack = smoothstep(0.035, 0.012, Math.abs(fbm(dx * 3.5, dy * 3.5, nz * 3.5, seed + 4, 3) - 0.5));
    const rock = (0.68 + 0.45 * (fbm(dx * 4, dy * 4, nz * 4, seed + 6, 4) - 0.5) - 0.35 * crack) * crater(dx, dy, nz, craters);
    return mix(ice, rock, smoothstep(-0.15, 0.05, towards));
  };
}

/** What of a planet glows of itself in the engraving, and in what colour: a lava world's veins, a locked world's sunny side, a living world's veins and a machine world's lamps at night. */
function glowFn(p: Planet, seed: number, face: LockFace | null, reach: number): { colour: readonly number[]; hueAt?: (dx: number, dy: number, nz: number) => readonly number[]; at: (tx: number, dy: number, tz: number, dx: number, nz: number, lambert: number) => number } | null {
  if (face === 'rock') {
    // Not a glow: the rock's colour, laid over the engraving's one tint (ice's) as seen, and fading with the light into the hatching.
    const towardsAt = (dx: number, dy: number, nz: number): number => dx * LOCK_SUN[0] + dy * LOCK_SUN[1] + nz * LOCK_SUN[2] + 0.25 * (fbm(dx * 2.4, dy * 2.4, nz * 2.4, seed, 3) - 0.5);
    // Some have life: a ragged green band in the twilight between rock and ice.
    const ringAt = hasLifeBand(p)
      ? (dx: number, dy: number, nz: number): number => smoothstep(0.11, 0.04, Math.abs(towardsAt(dx, dy, nz) + 0.04)) * smoothstep(0.32, 0.5, fbm(dx * 6, dy * 6, nz * 6, seed + 31, 3))
      : null;
    // And rivers off the ice's edge, winding out across the band into the rock until they dry up.
    const riverAt = (dx: number, dy: number, nz: number): number => {
      const towards = towardsAt(dx, dy, nz);
      const reach = smoothstep(-0.14, -0.06, towards) * smoothstep(0.65, 0.3, towards);
      return reach * smoothstep(0.045, 0.02, Math.abs(fbm(dx * 3, dy * 3, nz * 3, seed + 37, 3) - 0.5));
    };
    const hue: number[] = [...ROCK];
    return {
      colour: ROCK,
      hueAt: ringAt
        ? (dx, dy, nz) => {
            const g = ringAt(dx, dy, nz);
            const w = riverAt(dx, dy, nz);
            for (let k = 0; k < 3; k++) hue[k] = mix(mix(ROCK[k], LIFE[k], g), MELTWATER[k], w);
            return hue;
          }
        : undefined,
      at: (_tx, dy, _tz, dx, nz, lambert) => {
        const rock = 0.6 * smoothstep(-0.15, 0.05, towardsAt(dx, dy, nz)) * clamp01(0.3 + lambert);
        return ringAt ? Math.max(rock, 0.7 * Math.max(ringAt(dx, dy, nz), 1.2 * riverAt(dx, dy, nz)) * clamp01(0.45 + lambert)) : rock;
      },
    };
  }
  if (face === 'molten') {
    return {
      colour: MOLTEN,
      // Looked up on the sphere as seen (`dy` is the same either way): the melt lies towards the light, not on the turned map.
      at: (_tx: number, dy: number, _tz: number, dx: number, nz: number) => {
        const towards = dx * LOCK_SUN[0] + dy * LOCK_SUN[1] + nz * LOCK_SUN[2] + 0.25 * (fbm(dx * 2.4, dy * 2.4, nz * 2.4, seed, 3) - 0.5);
        const sea = smoothstep(0.05 - reach, 0.25 - reach, towards);
        const crack = smoothstep(0.04, 0.012, Math.abs(fbm(dx * 3.5, dy * 3.5, nz * 3.5, seed + 4, 3) - 0.5)) * smoothstep(-0.15 - reach, 0.05 - reach, towards);
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
  if (face === 'sea') {
    // The engraving has one tint, ice's: its sea is laid over it in blue, as seen (it lies under the sun, so always lit).
    return {
      colour: SEA,
      at: (_tx: number, dy: number, _tz: number, dx: number, nz: number) => {
        const towards = dx * SEA_SUN[0] + dy * SEA_SUN[1] + nz * SEA_SUN[2] + 0.2 * (fbm(dx * 2.4, dy * 2.4, nz * 2.4, seed, 3) - 0.5);
        return 0.7 * smoothstep(0.11, 0.19, towards);
      },
    };
  }
  if (p.style === 'fungal') {
    // The gills round each cap glow at night.
    return {
      colour: BLOOM,
      at: (x: number, y: number, z: number, _dx: number, _nz: number, lambert: number) =>
        0.85 * smoothstep(0.025, 0.006, Math.abs(fungalCap(x, y, z, seed) - 0.62)) * smoothstep(0.15, -0.1, lambert),
    };
  }
  if (p.style === 'volcanic') {
    return { colour: MOLTEN, at: (x: number, y: number, z: number) => 0.9 * smoothstep(0.71, 0.74, calderaFn(x, y, z, seed)) };
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
