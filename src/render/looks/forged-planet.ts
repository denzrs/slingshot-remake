import type { Planet } from '../../sim/physics';
import { createRng, range } from '../../sim/rng';
import { hexToRgb, rgba } from '../color';
import { fbm } from '../noise';
import { clamp01, LIGHT, mix, smoothstep, type PlanetSprite } from '../planet-common';
import { image, type Name } from './forged-assets';
import { renderLitPlanet } from './forged-lit-planet';

/**
 * A planet in the forged look: the Blender map wrapped round a sphere and lit from the upper left, with what a still
 * texture cannot give it: a surface that turns, with a layer of cloud sliding over it (a gas giant's bands run at different
 * speeds), the warm band of dusk along the terminator, the lights of settlements on the night side of rock, and rings
 * on most gas giants. What does not move (the light, the rim, the glow) is baked once; the sphere and its cloud are painted again ten times a second.
 */

type Rgb = [number, number, number];

/** A glow past the limb, as a share of the radius. */
const GLOW = 0.22;
const ATMOSPHERE: Record<string, Rgb> = { gas: [255, 214, 160], ice: [191, 230, 255], rocky: [255, 176, 122] };
/** The light of dusk, added along the terminator. */
const DUSK: Record<string, Rgb> = { gas: [255, 150, 90], ice: [140, 190, 255], rocky: [255, 110, 50] };
const NIGHT: Rgb = [16, 30, 60];
const CITY: Rgb = [255, 196, 120];

/** How often the sphere and its cloud are painted again (s), and how fast the cloud turns (turns per second). */
const CLOUD_EVERY = 1 / 10;
const CLOUD_RATE = 0.018;
/** How fast the planet itself turns (turns per second): a little slower than its cloud, which slides over it. */
const SURFACE_RATE = 0.012;
/** The rings reach this many radii from the planet's middle, at most. */
const RING_OUT = 2.05;

// ---------------------------------------------------------------- the maps ----

interface Texture {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}
const textures = new Map<Name, Texture>();

function texture(name: Name): Texture | null {
  const known = textures.get(name);
  if (known) return known;
  const img = image(name);
  if (!img) return null;
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const c = canvas.getContext('2d')!;
  c.drawImage(img, 0, 0);
  const made = { data: c.getImageData(0, 0, canvas.width, canvas.height).data, width: canvas.width, height: canvas.height };
  textures.set(name, made);
  return made;
}

/** The procedural maps are this big (a power of two in width, so a wrap is a mask). */
const MAP_W = 256;
const MAP_H = 128;
type MapKind = 'wisp' | 'band' | 'haze' | 'city';
const maps = new Map<MapKind, Uint8Array>();

/** A map of cloud, or of the lights of settlements, over a whole sphere (no seam: it is noise on the sphere, not on the strip). */
function proceduralMap(kind: MapKind): Uint8Array {
  const known = maps.get(kind);
  if (known) return known;
  const out = new Uint8Array(MAP_W * MAP_H);
  const cosLon = new Float32Array(MAP_W);
  const sinLon = new Float32Array(MAP_W);
  for (let i = 0; i < MAP_W; i++) {
    const lon = ((i + 0.5) / MAP_W) * Math.PI * 2;
    cosLon[i] = Math.cos(lon);
    sinLon[i] = Math.sin(lon);
  }
  for (let j = 0; j < MAP_H; j++) {
    const lat = ((j + 0.5) / MAP_H - 0.5) * Math.PI;
    const cl = Math.cos(lat);
    const y = Math.sin(lat);
    for (let i = 0; i < MAP_W; i++) {
      const x = cl * cosLon[i];
      const z = cl * sinLon[i];
      let v: number;
      if (kind === 'wisp') v = smoothstep(0.5, 0.72, fbm(x * 2.6 + 3, y * 3.6 + 7, z * 2.6 + 1, 5, 4)) * 0.9;
      else if (kind === 'band') v = smoothstep(0.44, 0.68, fbm(x * 1.2 + 4, y * 10, z * 1.2, 17, 4)) * 0.6;
      else if (kind === 'haze') v = smoothstep(0.5, 0.78, fbm(x * 1.8, y * 2.2, z * 1.8, 29, 3)) * 0.5;
      else v = Math.min(1, smoothstep(0.6, 0.78, fbm(x * 4.5 + 2, y * 4.5, z * 4.5, 41, 4)) * smoothstep(0.55, 0.75, fbm(x * 26, y * 26, z * 26, 43, 2)) * 2.2);
      out[j * MAP_W + i] = Math.round(v * 255);
    }
  }
  maps.set(kind, out);
  return out;
}

// ------------------------------------------------------------ the variants ----

/**
 * The maps a planet of each style may wear (painted by `scripts/forged/render_planets.py`; the first of each is the original).
 * `cities`: settlements may light its night side. `clouds: false`: it has no air.
 */
interface Variant {
  name: Name;
  cities?: boolean;
  clouds?: boolean;
}
const VARIANTS: Record<string, readonly Variant[]> = {
  rocky: [{ name: 'rock', cities: true }, { name: 'rockDesert', cities: true }, { name: 'rockOcean', cities: true }, { name: 'rockMoon', clouds: false }, { name: 'rockAlien' }],
  gas: [{ name: 'gas' }, { name: 'gasNeptune' }, { name: 'gasViolet' }, { name: 'gasToxic' }, { name: 'gasCrimson' }, { name: 'gasStormy' }],
  ice: [{ name: 'ice' }, { name: 'iceGlacier' }, { name: 'iceMethane' }, { name: 'iceDusty' }, { name: 'iceRose' }],
};

/** The map this planet wears, by its seed (the same on every screen), and its place in the style's list. */
function variantOf(p: Planet): Variant & { index: number } {
  const list = VARIANTS[p.style] ?? VARIANTS.rocky;
  const index = (Math.imul(p.seed ^ 0x9e3779b9, 0x85ebca6b) >>> 8) % list.length;
  return { ...list[index], index };
}

// ---------------------------------------------------------------- a planet ----

/** Every pixel of the disc, with where on the map it lies and how it is lit: what the surface and the cloud layer need to be painted again cheaply as the planet turns. */
interface Surface {
  count: number;
  /** Index into the sprite's pixels, longitude (turns), map row, light (0 → 1) and how much of the pixel the disc covers. */
  index: Int32Array;
  lon: Float32Array;
  row: Uint8Array;
  /** The pixel's latitude on the planet's map, which never changes as it turns: where the map's rows above and below it start in its data, and how far it lies between them. */
  above: Int32Array;
  below: Int32Array;
  between: Float32Array;
  lit: Float32Array;
  cover: Float32Array;
  /** What is added to the map's colour whatever turns: the sheen of ice, the rim of the atmosphere, dusk (three values a pixel). */
  add: Float32Array;
  /** How dark the night is where settlements would shine (0 where there are none). */
  night: Float32Array;
}

interface Baked {
  size: number;
  /** The glow past the limb, painted once. */
  glow: HTMLCanvasElement;
  surface: Surface;
  /** The sphere itself, painted again as it turns. */
  sphere: { canvas: HTMLCanvasElement; image: ImageData; map: Texture; gain: number[]; city: Uint8Array | null; shift: Float32Array };
  cloud: { kind: MapKind; enabled: boolean; colour: Rgb; canvas: HTMLCanvasElement; image: ImageData; shift: Float32Array; direction: number; phase: number; at: number };
  rings: { back: HTMLCanvasElement; front: HTMLCanvasElement } | null;
  moon: Moon | null;
  /** Where on a gas giant's night side lightning strikes are shown. */
  storms: boolean;
}

/** A moon on a slanted orbit round a planet, in field units: how far out and how flat the orbit, its tilt, size, period (s), where it starts and which way it goes, and its colour. */
interface Moon {
  orbit: number;
  squash: number;
  tilt: number;
  radius: number;
  period: number;
  start: number;
  direction: number;
  colour: Rgb;
}

function bake(p: Planet, ps: number): Baked | null {
  const variant = variantOf(p);
  const map = texture(variant.name);
  if (!map) return null;
  const R = p.radius * ps;
  const reach = R * (1 + GLOW);
  const size = Math.ceil(reach * 2 + 4);
  const half = size / 2;
  const rng = createRng(p.seed);
  const spin = rng() * Math.PI * 2;
  const tilt = range(rng, -0.35, 0.35);
  const direction = rng() < 0.5 ? -1 : 1;
  const phase = rng() * Math.PI * 2;
  const ringed = rng() < (p.style === 'gas' ? 0.7 : p.style === 'ice' ? 0.2 : 0);
  const settled = !!variant.cities && rng() < 0.75;
  const [tr, tg, tb] = hexToRgb(p.tint);
  const mean = (tr + tg + tb) / 3 || 1;
  // The map's own colours, nudged towards the planet's tint so two planets of a style are not twins; a map with a palette of its own (toxic green, crimson) barely.
  const nudge = variant.index === 0 ? 0.45 : 0.12;
  const gain = [mix(1, tr / mean, nudge), mix(1, tg / mean, nudge), mix(1, tb / mean, nudge)];
  const rim = ATMOSPHERE[p.style] ?? ATMOSPHERE.rocky;
  const dusk = DUSK[p.style] ?? DUSK.rocky;
  const specular = p.style === 'ice' ? 0.35 : 0;

  const cs = Math.cos(spin);
  const sn = Math.sin(spin);
  const ct = Math.cos(tilt);
  const st = Math.sin(tilt);
  const half3 = [LIGHT[0], LIGHT[1], LIGHT[2] + 1];
  const hl = Math.hypot(half3[0], half3[1], half3[2]);
  const surface: Surface = {
    count: 0,
    index: new Int32Array(size * size),
    lon: new Float32Array(size * size),
    row: new Uint8Array(size * size),
    above: new Int32Array(size * size),
    below: new Int32Array(size * size),
    between: new Float32Array(size * size),
    lit: new Float32Array(size * size),
    cover: new Float32Array(size * size),
    add: new Float32Array(size * size * 3),
    night: new Float32Array(size * size),
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5 - half) / R;
      const dy = (y + 0.5 - half) / R;
      const rr = dx * dx + dy * dy;
      const dist = Math.sqrt(rr);
      const coverage = smoothstep(1 + 1 / R, 1 - 1 / R, dist);
      if (coverage <= 0) continue;
      const nz = Math.sqrt(Math.max(0, 1 - rr));
      // The point on the sphere, turned about the vertical by the seed and tipped by the tilt, as longitude and latitude.
      const ty = dy * ct + nz * st;
      const tz = -dy * st + nz * ct;
      const tx = dx * cs + tz * sn;
      const tzz = -dx * sn + tz * cs;
      const u = Math.atan2(tx, tzz) / (Math.PI * 2) + 0.5;
      const v = 0.5 + Math.asin(Math.max(-1, Math.min(1, ty))) / Math.PI;
      const lam = dx * LIGHT[0] + dy * LIGHT[1] + nz * LIGHT[2];
      const lit = clamp01(0.06 + 0.98 * Math.max(0, lam) ** 0.85);
      const spec = specular ? specular * Math.max(0, (dx * half3[0] + dy * half3[1] + nz * half3[2]) / hl) ** 36 : 0;
      const fresnel = (1 - nz) ** 2.6 * (0.3 + 0.7 * smoothstep(-0.25, 0.6, lam));
      // Dusk: a warm band just on the lit side of the terminator.
      const twilight = smoothstep(-0.14, 0, lam) * (1 - smoothstep(0, 0.32, lam)) * 0.22;
      const n = surface.count++;
      surface.index[n] = y * size + x;
      surface.lon[n] = u;
      surface.row[n] = Math.min(MAP_H - 1, Math.floor(v * MAP_H));
      const ty0 = Math.min(map.height - 1.001, Math.max(0, v * map.height - 0.5));
      const y0 = Math.floor(ty0);
      surface.above[n] = y0 * map.width * 4;
      surface.below[n] = (y0 + 1) * map.width * 4;
      surface.between[n] = ty0 - y0;
      surface.lit[n] = lit;
      surface.cover[n] = coverage;
      for (let k = 0; k < 3; k++) surface.add[n * 3 + k] = spec * 255 + rim[k] * fresnel * 0.55 + dusk[k] * twilight;
      // On the night side, the lights of settlements.
      surface.night[n] = settled ? smoothstep(0.05, -0.3, lam) * 0.95 : 0;
    }
  }
  const sphere = document.createElement('canvas');
  sphere.width = sphere.height = size;

  const glow = document.createElement('canvas');
  glow.width = glow.height = size;
  const c = glow.getContext('2d')!;
  const glowColor = `#${rim.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
  const gradient = c.createRadialGradient(half, half, R * 0.9, half, half, reach);
  gradient.addColorStop(0, rgba(glowColor, 0.07));
  gradient.addColorStop(1, rgba(glowColor, 0));
  c.fillStyle = gradient;
  c.beginPath();
  c.arc(half, half, reach, 0, Math.PI * 2);
  c.fill();
  // Light scattered in the atmosphere: more of it on the side the sun is on.
  const lx = LIGHT[0] / Math.hypot(LIGHT[0], LIGHT[1]);
  const ly = LIGHT[1] / Math.hypot(LIGHT[0], LIGHT[1]);
  const scatter = c.createRadialGradient(half + lx * R * 0.3, half + ly * R * 0.3, R * 0.7, half + lx * R * 0.3, half + ly * R * 0.3, reach);
  scatter.addColorStop(0, rgba(glowColor, 0.09));
  scatter.addColorStop(1, rgba(glowColor, 0));
  c.fillStyle = scatter;
  c.beginPath();
  c.arc(half, half, reach, 0, Math.PI * 2);
  c.fill();

  // Cloud: wisps over rock, haze over ice, long streaks over a gas giant.
  const kind: MapKind = p.style === 'gas' ? 'band' : p.style === 'ice' ? 'haze' : 'wisp';
  const colour2: Rgb = p.style === 'gas' ? [mix(tr, 255, 0.55), mix(tg, 245, 0.55), mix(tb, 230, 0.55)] : p.style === 'ice' ? [235, 245, 255] : [255, 236, 215];
  const cloudCanvas = document.createElement('canvas');
  cloudCanvas.width = cloudCanvas.height = size;
  const rings = ringed ? bakeRings(R, tr, tg, tb, rng) : null;
  // A planet without rings may have a moon: small, grey with a hint of the planet's colour, on a slanted orbit.
  const moon: Moon | null =
    !ringed && rng() < 0.3
      ? {
          orbit: p.radius * range(rng, 1.55, 2),
          squash: range(rng, 0.25, 0.4),
          tilt: range(rng, -0.6, 0.6),
          radius: p.radius * range(rng, 0.08, 0.13),
          period: range(rng, 30, 70),
          start: rng() * Math.PI * 2,
          direction: rng() < 0.5 ? -1 : 1,
          colour: [mix(190, tr, 0.25), mix(186, tg, 0.25), mix(180, tb, 0.25)],
        }
      : null;
  return {
    size,
    glow,
    surface,
    sphere: { canvas: sphere, image: sphere.getContext('2d')!.createImageData(size, size), map, gain, city: settled ? proceduralMap('city') : null, shift: new Float32Array(MAP_H) },
    cloud: { kind, enabled: variant.clouds !== false, colour: colour2, canvas: cloudCanvas, image: cloudCanvas.getContext('2d')!.createImageData(size, size), shift: new Float32Array(MAP_H), direction, phase, at: -1 },
    rings,
    moon,
    storms: p.style === 'gas',
  };
}

/**
 * Paints the sphere as it stands at `time`: the map turned about the axis by how far the planet has come round, lit as
 * it was. A gas giant's bands turn at speeds of their own (faster towards the equator), so they slide against each other.
 */
function paintSurface(b: Baked, time: number): void {
  const { sphere, surface, cloud } = b;
  const turn = time * SURFACE_RATE * cloud.direction;
  const shift = sphere.shift;
  for (let r = 0; r < MAP_H; r++) shift[r] = cloud.kind === 'band' ? turn * (1 + 0.5 * Math.sin((r / MAP_H) * Math.PI * 3 + cloud.phase)) : turn;
  const cloudMap = proceduralMap(cloud.kind);
  const data = sphere.image.data;
  const { data: texels, width } = sphere.map;
  for (let k = 0; k < surface.count; k++) {
    const row = surface.row[k];
    const u = surface.lon[k] + shift[row];
    // The map's colour here, smoothly between the four texels round it (the longitude wraps).
    const tx = u * width - 0.5;
    const tx0 = Math.floor(tx);
    const fx = tx - tx0;
    const x0 = (((tx0 % width) + width) % width) * 4;
    const x1 = x0 + 4 === width * 4 ? 0 : x0 + 4;
    const a0 = surface.above[k] + x0;
    const a1 = surface.above[k] + x1;
    const b0 = surface.below[k] + x0;
    const b1 = surface.below[k] + x1;
    const fy = surface.between[k];
    const lit = surface.lit[k];
    const night = surface.night[k];
    const lights = night && sphere.city ? (sphere.city[row * MAP_W + (Math.floor((u - Math.floor(u)) * MAP_W) & (MAP_W - 1))] / 255) * night : 0;
    // The cloud's shadow: the same map as the cloud layer, read a little to the side, darkens the ground under it.
    let uc = surface.lon[k] + cloud.shift[row] - SHADOW;
    uc -= Math.floor(uc);
    const shadow = !cloud.enabled ? 1 : 1 - SHADOW_DEPTH * (cloudMap[row * MAP_W + (Math.floor(uc * MAP_W) & (MAP_W - 1))] / 255) * (0.4 + 0.6 * lit);
    const i = surface.index[k] * 4;
    for (let c = 0; c < 3; c++) {
      const top = texels[a0 + c] + (texels[a1 + c] - texels[a0 + c]) * fx;
      const bottom = texels[b0 + c] + (texels[b1 + c] - texels[b0 + c]) * fx;
      const albedo = Math.min(255, (top + (bottom - top) * fy) * sphere.gain[c]) * shadow;
      data[i + c] = Math.min(255, mix(NIGHT[c], albedo, lit) + surface.add[k * 3 + c] + CITY[c] * lights);
    }
    data[i + 3] = 255 * surface.cover[k];
  }
  sphere.canvas.getContext('2d')!.putImageData(sphere.image, 0, 0);
}

/** How far the clouds' shadows lie from them (turns of longitude), and how dark they are. */
const SHADOW = 0.012;
const SHADOW_DEPTH = 0.5;

/** Where each row of the cloud has turned to at `time`: the gas giant's bands at speeds of their own, other cloud as one. */
function cloudShifts(b: Baked, time: number): void {
  const { cloud } = b;
  const turn = time * CLOUD_RATE * cloud.direction;
  for (let r = 0; r < MAP_H; r++) cloud.shift[r] = cloud.kind === 'band' ? turn * (1 + 0.8 * Math.sin((r / MAP_H) * Math.PI * 3 + cloud.phase)) : turn;
}

/** Paints the cloud layer as `cloudShifts` left it: the map turned round by how far it has drifted, lit like the sphere under it. */
function paintClouds(b: Baked): void {
  const { cloud, surface } = b;
  const map = proceduralMap(cloud.kind);
  const data = cloud.image.data;
  const [cr, cg, cb] = cloud.colour;
  for (let k = 0; k < surface.count; k++) {
    const row = surface.row[k];
    let u = surface.lon[k] + cloud.shift[row];
    u -= Math.floor(u);
    const a = map[row * MAP_W + (Math.floor(u * MAP_W) & (MAP_W - 1))];
    const lit = surface.lit[k];
    const shade = 0.12 + 0.88 * lit;
    const i = surface.index[k] * 4;
    data[i] = cr * shade;
    data[i + 1] = cg * shade;
    data[i + 2] = cb * shade;
    data[i + 3] = a * surface.cover[k] * (0.25 + 0.75 * lit);
  }
  cloud.canvas.getContext('2d')!.putImageData(cloud.image, 0, 0);
}

/** The rings, as two layers of one flat disc seen at a slant: the half behind the planet and the half in front of it. */
function bakeRings(R: number, tr: number, tg: number, tb: number, rng: () => number): Baked['rings'] {
  const span = Math.ceil(R * 2 * RING_OUT + 6);
  const middle = span / 2;
  const slant = range(rng, 0.2, 0.36);
  const turn = range(rng, -0.55, 0.55);
  const sand: Rgb = [235, 220, 190];
  const bands: { from: number; to: number; alpha: number; warm: number }[] = [];
  for (let r = 1.3; r < RING_OUT - 0.1; ) {
    const width = range(rng, 0.03, 0.12);
    // Some stretches are left empty: the gaps between bands.
    if (rng() > 0.25) bands.push({ from: r, to: r + width, alpha: range(rng, 0.25, 0.65), warm: rng() });
    r += width + range(rng, 0, 0.05);
  }
  const half = (from: number, to: number): HTMLCanvasElement => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = span;
    const c = canvas.getContext('2d')!;
    c.translate(middle, middle);
    c.rotate(turn);
    c.scale(1, slant);
    for (const band of bands) {
      const k = 0.5 + 0.3 * band.warm;
      c.strokeStyle = `rgba(${Math.round(mix(tr, sand[0], k))},${Math.round(mix(tg, sand[1], k))},${Math.round(mix(tb, sand[2], k))},${band.alpha})`;
      c.lineWidth = (band.to - band.from) * R;
      c.beginPath();
      c.arc(0, 0, ((band.from + band.to) / 2) * R, from, to);
      c.stroke();
    }
    // The ring is lit like the planet: dark on the side away from the light, and where the planet's own shadow falls on it.
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = 'source-atop';
    const lx = LIGHT[0] / Math.hypot(LIGHT[0], LIGHT[1]);
    const ly = LIGHT[1] / Math.hypot(LIGHT[0], LIGHT[1]);
    const shade = c.createLinearGradient(middle + lx * R * 1.5, middle + ly * R * 1.5, middle - lx * R * 1.5, middle - ly * R * 1.5);
    shade.addColorStop(0, 'rgba(6,12,28,0)');
    shade.addColorStop(1, 'rgba(6,12,28,0.6)');
    c.fillStyle = shade;
    c.fillRect(0, 0, span, span);
    const shadow = c.createRadialGradient(middle - lx * R * 1.35, middle - ly * R * 1.35, R * 0.4, middle - lx * R * 1.35, middle - ly * R * 1.35, R * 1.15);
    shadow.addColorStop(0, 'rgba(4,8,20,0.55)');
    shadow.addColorStop(1, 'rgba(4,8,20,0)');
    c.fillStyle = shadow;
    c.fillRect(0, 0, span, span);
    return canvas;
  };
  // After the squash the upper half of the ring (angles π → 2π) is the far side.
  return { back: half(Math.PI, Math.PI * 2), front: half(0, Math.PI) };
}

/** Where a moon is at `time`, in the sprite's frame (field units from the planet's middle), and whether it is on the near side. */
function moonAt(m: Moon, time: number): { x: number; y: number; front: boolean } {
  const a = m.start + (time / m.period) * Math.PI * 2 * m.direction;
  const ex = Math.cos(a) * m.orbit;
  const ey = Math.sin(a) * m.orbit * m.squash;
  return { x: ex * Math.cos(m.tilt) - ey * Math.sin(m.tilt), y: ex * Math.sin(m.tilt) + ey * Math.cos(m.tilt), front: Math.sin(a) * m.direction > 0 };
}

/** A moon: a small grey ball lit from the same side as the planet, dark on the other. */
function drawMoon(ctx: CanvasRenderingContext2D, x: number, y: number, m: Moon, at: { x: number; y: number }): void {
  const mx = x + at.x;
  const my = y + at.y;
  const [r, g, b] = m.colour;
  const shade = ctx.createRadialGradient(mx + LIGHT[0] * m.radius * 0.5, my + LIGHT[1] * m.radius * 0.5, m.radius * 0.1, mx, my, m.radius * 1.1);
  shade.addColorStop(0, `rgb(${r | 0},${g | 0},${b | 0})`);
  shade.addColorStop(0.6, `rgb(${(r * 0.5) | 0},${(g * 0.5) | 0},${(b * 0.55) | 0})`);
  shade.addColorStop(1, 'rgb(12,20,40)');
  ctx.fillStyle = shade;
  ctx.beginPath();
  ctx.arc(mx, my, m.radius, 0, Math.PI * 2);
  ctx.fill();
}

/** Lightning in a gas giant's night side: now and then a flash, sometimes twice, lighting the cloud round it. */
function drawLightning(ctx: CanvasRenderingContext2D, x: number, y: number, p: Planet, time: number): void {
  const cycle = time / 3.7 + (p.seed % 13) / 13;
  const beat = Math.floor(cycle);
  const phase = cycle - beat;
  const flash = phase < 0.05 ? Math.sin((phase / 0.05) * Math.PI) : phase > 0.09 && phase < 0.13 ? 0.6 * Math.sin(((phase - 0.09) / 0.04) * Math.PI) : 0;
  if (flash <= 0) return;
  const hash = (k: number): number => {
    const h = Math.sin((p.seed + beat * 7.3 + k) * 127.1) * 43758.5453;
    return h - Math.floor(h);
  };
  // On the side away from the light (the lower right), well inside the disc.
  const angle = 0.25 + hash(1) * 1.2;
  const reach = p.radius * (0.25 + 0.5 * hash(2));
  const fx = x + Math.cos(angle) * reach;
  const fy = y + Math.sin(angle) * reach;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const r = p.radius * 0.5;
  const glow = ctx.createRadialGradient(fx, fy, 0, fx, fy, r);
  glow.addColorStop(0, `rgba(215,232,255,${0.65 * flash})`);
  glow.addColorStop(0.3, `rgba(150,190,255,${0.22 * flash})`);
  glow.addColorStop(1, 'rgba(150,190,255,0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, p.radius * 0.97, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillRect(fx - r, fy - r, r * 2, r * 2);
  ctx.restore();
}

/** A planet's sprite in the forged look: baked on first draw once its map has loaded, the lit planet of `forged-lit-planet.ts` until then. */
export function renderForgedPlanet(p: Planet, ps: number): PlanetSprite {
  // The stand-in is made only if it is drawn: once the map has loaded (nearly always, after the first planets) it never is.
  let fallback: PlanetSprite | null = null;
  let baked: Baked | null = null;
  const place = (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, x: number, y: number, scale: number): void => {
    ctx.drawImage(canvas, x - canvas.width / scale / 2, y - canvas.height / scale / 2, canvas.width / scale, canvas.height / scale);
  };
  return {
    size: Math.ceil(p.radius * ps * (1 + GLOW) * 2 + 4),
    draw(ctx, x, y, scale, time) {
      baked ??= bake(p, ps);
      if (!baked) {
        fallback ??= renderLitPlanet(p, ps);
        fallback.draw(ctx, x, y, scale, time);
        return;
      }
      // Each planet is painted again on its own beat, so they do not all fall in one frame.
      if (baked.cloud.at < 0 || time - baked.cloud.at >= CLOUD_EVERY) {
        if (baked.cloud.at < 0) baked.cloud.at = time - ((p.seed % 7) / 7) * CLOUD_EVERY;
        else baked.cloud.at = time;
        cloudShifts(baked, time);
        paintSurface(baked, time);
        if (baked.cloud.enabled) paintClouds(baked);
      }
      const moon = baked.moon ? moonAt(baked.moon, time) : null;
      place(ctx, baked.glow, x, y, scale);
      if (moon && !moon.front) drawMoon(ctx, x, y, baked.moon!, moon);
      if (baked.rings) place(ctx, baked.rings.back, x, y, scale);
      place(ctx, baked.sphere.canvas, x, y, scale);
      if (baked.cloud.enabled) place(ctx, baked.cloud.canvas, x, y, scale);
      if (baked.storms) drawLightning(ctx, x, y, p, time);
      if (baked.rings) place(ctx, baked.rings.front, x, y, scale);
      if (moon?.front) drawMoon(ctx, x, y, baked.moon!, moon);
    },
  };
}
