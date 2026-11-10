import type { Planet, PlanetStyle } from '../../sim/physics';
import { createRng, range } from '../../sim/rng';
import { hexToRgb, rgba } from '../color';
import { fbm } from '../noise';
import { clamp01, hasLifeBand, LIGHT, LOCK_SUN, lockFace, SEA_SUN, mix, smoothstep, type LockFace, type PlanetSprite, type Scar } from '../planet-common';
import { image, type Name } from './forged-assets';
import { place as placeShaded } from './forged-gl';
import { GLOW, renderLitPlanet, spriteSize } from './forged-lit-planet';
import { EMIT_FROM, EMIT_FULL, emitBreath, GLINT_POWER, MAX_IMPACTS, shadePlanet, WET_FROM, WET_FULL, type PlanetCracks, type PlanetShade } from './forged-planet-gl';
import {
  drawDust, drawGlints, drawLanes, drawMeteors, drawPlumes, drawScar, drawShimmer, drawStormLightning,
  rollDust, rollGlints, rollLanes, rollMeteors, rollStorms, rollVents,
  type Dust, type Glints, type Lanes, type Meteors, type Storms, type Surface as Turning, type Vents,
} from './forged-planet-events';
import { SCAR_LIFE } from '../effects';
import { instabilityPulse } from './instability';

/**
 * A planet in the forged look: the Blender map wrapped round a sphere and lit from the upper left, with what a still
 * texture cannot give it: a surface that turns, with a layer of cloud sliding over it (a gas giant's bands run at different
 * speeds), the warm band of dusk along the terminator, the lights of settlements on the night side of rock, and rings
 * on most gas giants. The sphere and its cloud are painted again ten times a second: by a shader (`forged-planet-gl.ts`), which
 * adds a lit atmosphere and relief, or without shaders on the CPU, from what does not move (the light, the rim), baked once on
 * first use. The glow is baked once either way.
 */

type Rgb = [number, number, number];

const NIGHT: Rgb = [16, 30, 60];
const CITY: Rgb = [255, 196, 120];

/** Weights on a map's colour (0 → 1 a channel): red above blue (what is molten, a lamp), blue above red (a sea, ice, a living world's veins), green above red (an acid lake). */
const HOT: Rgb = [1, 0, -1];
const BLUE: Rgb = [-1, 0, 1];
const ACID: Rgb = [-1, 1.5, -0.5];
/** Red well above green: a volcanic moon's molten caldera floors, and not its sulphur, which is red and green alike. */
const RED: Rgb = [1, -1.3, 0];

/**
 * How a style is dressed in the forged look. `rim` is its air's colour, `dusk` the light along its terminator; `relief` how
 * strongly the map's light and dark are read as height (gas none, lava's turned over: its bright parts are the low channels); the cloud
 * over it (its colour null: from the tint, as a gas giant's); the sheen of ice; what of the map glows (`emit`: by its key,
 * at night only or always, breathing or steady) and what is water (`wet`); and how often it has rings.
 */
interface Dress {
  rim: Rgb;
  dusk: Rgb;
  relief: number;
  cloud: MapKind;
  cloudColour: Rgb | null;
  specular: number;
  emit?: { key: Rgb; night?: boolean; pulse?: number; strength?: number };
  wet?: { key: Rgb; strength: number };
  rings: number;
}
const DRESS: Record<Exclude<PlanetStyle, 'star'>, Dress> = {
  rocky: { rim: [255, 176, 122], dusk: [255, 110, 50], relief: 3, cloud: 'wisp', cloudColour: [255, 236, 215], specular: 0, rings: 0.08 },
  gas: { rim: [255, 214, 160], dusk: [255, 150, 90], relief: 0, cloud: 'band', cloudColour: null, specular: 0, rings: 0.7 },
  ice: { rim: [191, 230, 255], dusk: [140, 190, 255], relief: 1.4, cloud: 'haze', cloudColour: [235, 245, 255], specular: 0.35, rings: 0.2 },
  lava: { rim: [255, 112, 52], dusk: [255, 80, 30], relief: -1, cloud: 'wisp', cloudColour: [96, 84, 78], specular: 0, emit: { key: HOT }, rings: 0.08 },
  ocean: { rim: [150, 200, 255], dusk: [255, 140, 90], relief: 0.6, cloud: 'wisp', cloudColour: [250, 252, 255], specular: 0, wet: { key: BLUE, strength: 1.4 }, rings: 0.05 },
  desert: { rim: [255, 200, 140], dusk: [255, 120, 60], relief: 2.5, cloud: 'haze', cloudColour: [230, 200, 160], specular: 0, rings: 0.08 },
  acid: { rim: [210, 230, 110], dusk: [230, 180, 60], relief: 1.2, cloud: 'haze', cloudColour: [222, 222, 150], specular: 0, wet: { key: ACID, strength: 1.1 }, rings: 0.05 },
  carbon: { rim: [150, 150, 170], dusk: [200, 140, 100], relief: 2, cloud: 'haze', cloudColour: [62, 54, 48], specular: 0.12, rings: 0.15 },
  crystal: { rim: [210, 170, 255], dusk: [255, 150, 200], relief: 1.2, cloud: 'wisp', cloudColour: [240, 230, 255], specular: 0.45, rings: 0.25 },
  living: { rim: [140, 255, 200], dusk: [255, 150, 90], relief: 1.5, cloud: 'wisp', cloudColour: [245, 255, 248], specular: 0, emit: { key: BLUE, night: true, pulse: 0.7 }, rings: 0.05 },
  machine: { rim: [180, 200, 220], dusk: [255, 170, 90], relief: 1.5, cloud: 'haze', cloudColour: [190, 195, 205], specular: 0.15, emit: { key: HOT, night: true, strength: 1.8 }, rings: 0.12 },
  iron: { rim: [200, 210, 225], dusk: [255, 170, 110], relief: 2, cloud: 'haze', cloudColour: [200, 200, 205], specular: 0.55, rings: 0.1 },
  eyeball: { rim: [150, 200, 255], dusk: [255, 150, 100], relief: 0.5, cloud: 'wisp', cloudColour: [250, 252, 255], specular: 0.3, wet: { key: BLUE, strength: 1.4 }, rings: 0.05 },
  hycean: { rim: [140, 230, 220], dusk: [255, 170, 120], relief: 0, cloud: 'band', cloudColour: null, specular: 0, wet: { key: BLUE, strength: 0.8 }, rings: 0.25 },
  fungal: { rim: [220, 170, 255], dusk: [255, 140, 110], relief: 1.2, cloud: 'haze', cloudColour: [200, 180, 170], specular: 0, emit: { key: BLUE, night: true, pulse: 0.6 }, rings: 0.05 },
  volcanic: { rim: [255, 220, 120], dusk: [255, 140, 60], relief: 1.6, cloud: 'haze', cloudColour: [240, 220, 150], specular: 0, emit: { key: RED }, rings: 0.05 },
};
/** A locked world's ice and molten rock: the melt faces the sun and glows, the ice lies in the dark, steam drifts over both. */
const LOCKED: Partial<Dress> = { relief: 1, specular: 0, cloud: 'haze', cloudColour: [228, 226, 230], emit: { key: HOT }, wet: { key: BLUE, strength: 0.6 } };
/** A locked world's ice and bare rock: the rock faces the sun, baked dry, cratered and cracked, in deep relief (more than a rocky world's: nothing wears it down); nothing glows, a thin haze drifts. */
const LOCKED_ROCK: Partial<Dress> = { rim: [255, 214, 170], dusk: [255, 140, 80], relief: 4, specular: 0.2, cloud: 'haze', cloudColour: [228, 226, 230] };

/** How often the sphere and its cloud are painted again (s), and how fast the cloud turns (turns per second). */
const CLOUD_EVERY = 1 / 10;
const CLOUD_RATE = 0.018;
/** How fast the planet itself turns (turns per second): a little slower than its cloud, which slides over it. */
const SURFACE_RATE = 0.012;
/** An unstable planet is painted again this often (s): its magma pulses faster than the cloud turns. */
const CRACKS_EVERY = 1 / 30;
/** Where a hit is shown striking, in radii from the middle: on the near side, just in from the limb. */
const IMPACT_AT = 0.86;
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
type MapKind = 'wisp' | 'band' | 'haze' | 'city' | 'works';
const maps = new Map<MapKind, Uint8Array>();

/** A procedural map's value (0 → 1) at a point of the unit sphere. */
function mapValue(kind: MapKind, x: number, y: number, z: number): number {
  if (kind === 'wisp') return smoothstep(0.5, 0.72, fbm(x * 2.6 + 3, y * 3.6 + 7, z * 2.6 + 1, 5, 4)) * 0.9;
  if (kind === 'band') return smoothstep(0.44, 0.68, fbm(x * 1.2 + 4, y * 10, z * 1.2, 17, 4)) * 0.6;
  if (kind === 'haze') return smoothstep(0.5, 0.78, fbm(x * 1.8, y * 2.2, z * 1.8, 29, 3)) * 0.5;
  if (kind === 'works') return Math.min(1, smoothstep(0.4, 0.56, fbm(x * 3, y * 3, z * 3, 51, 3)) * (0.3 + 0.7 * smoothstep(0.48, 0.66, fbm(x * 40, y * 40, z * 40, 53, 2))) * 1.5);
  return Math.min(1, smoothstep(0.6, 0.78, fbm(x * 4.5 + 2, y * 4.5, z * 4.5, 41, 4)) * smoothstep(0.55, 0.75, fbm(x * 26, y * 26, z * 26, 43, 2)) * 2.2);
}

/** A cloud map with a world's hurricanes in it is this much finer than the shared maps, so their bands show. */
const STORM_FINE = 2;

/**
 * A planet's cloud layer with its hurricanes in it, so they drift, are lit and cast their shadows as the rest of its
 * cloud: each a dense overcast round a clear eye, its rain bands winding out of it in a logarithmic spiral (anticlockwise
 * seen from above in the north, the upper half of the map's rows, clockwise in the south), the ordinary cloud
 * cleared round it.
 */
function stormMap(kind: MapKind, storms: Storms, seed: number): Uint8Array {
  const W = MAP_W * STORM_FINE;
  const H = MAP_H * STORM_FINE;
  const out = new Uint8Array(W * H);
  const centres = storms.map((st) => {
    const lon = st.u * Math.PI * 2;
    const lat = (st.v - 0.5) * Math.PI;
    const [cl, sl, co, so] = [Math.cos(lat), Math.sin(lat), Math.cos(lon), Math.sin(lon)];
    return {
      c: [cl * co, sl, cl * so],
      // East and the way of rising latitude there: the map's own frame round the storm (the latter runs down the screen).
      east: [-so, 0, co],
      up: [-sl * co, cl, -sl * so],
      span: st.size * 3.4,
      turn: st.turn,
    };
  });
  for (let j = 0; j < H; j++) {
    const lat = ((j + 0.5) / H - 0.5) * Math.PI;
    const cl = Math.cos(lat);
    const y = Math.sin(lat);
    for (let i = 0; i < W; i++) {
      const lon = ((i + 0.5) / W) * Math.PI * 2;
      const x = cl * Math.cos(lon);
      const z = cl * Math.sin(lon);
      let v = mapValue(kind, x, y, z);
      for (const st of centres) {
        const dot = x * st.c[0] + y * st.c[1] + z * st.c[2];
        const r = Math.acos(Math.max(-1, Math.min(1, dot))) / st.span;
        if (r > 1.5) continue;
        const theta = Math.atan2(x * st.up[0] + y * st.up[1] + z * st.up[2], x * st.east[0] + y * st.east[1] + z * st.east[2]);
        const rag = fbm(x * 9, y * 9, z * 9, seed + 61, 3);
        // Three rain bands, wound out of the eye.
        const spiral = 0.5 + 0.5 * Math.cos(3 * (theta - st.turn * 2.4 * Math.log(Math.max(r, 0.02))) + 3 * (rag - 0.5));
        const bands = spiral ** 2 * smoothstep(1.1, 0.3, r) * (0.8 + 0.6 * (rag - 0.5));
        const overcast = smoothstep(0.6, 0.15, r) * (0.85 + 0.3 * (rag - 0.5));
        const wall = 0.25 * smoothstep(0.06, 0, Math.abs(r - 0.1));
        const storm = Math.min(1, Math.max(overcast, bands) + wall) * smoothstep(0.03, 0.065, r);
        v = Math.max(v * (1 - 0.8 * smoothstep(1.45, 0.95, r)), storm);
      }
      out[j * W + i] = Math.round(Math.min(1, v) * 255);
    }
  }
  return out;
}

/** A planet's cloud layer: its map, and how many texels wide and high it is. */
interface CloudMap {
  name: string;
  data: () => Uint8Array;
  width: number;
  height: number;
}

/** The cloud layer a planet wears: the shared map of its kind, or one of its own with its hurricanes in it. */
function cloudMapOf(kind: MapKind, storms: Storms | null, seed: number): CloudMap {
  if (!storms) return { name: kind, data: () => proceduralMap(kind), width: MAP_W, height: MAP_H };
  let made: Uint8Array | null = null;
  return { name: `${kind}:storms:${seed}`, data: () => (made ??= stormMap(kind, storms, seed)), width: MAP_W * STORM_FINE, height: MAP_H * STORM_FINE };
}

/** A map of cloud, or of the lights of settlements (`works`: a machine world's, over most of it), over a whole sphere (no seam: it is noise on the sphere, not on the strip). */
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
      out[j * MAP_W + i] = Math.round(mapValue(kind, x, y, z) * 255);
    }
  }
  maps.set(kind, out);
  return out;
}

// ------------------------------------------------------------ the variants ----

/**
 * The maps a planet of each style may wear (painted by `scripts/forged/render_planets.py`; the first of each is the original).
 * `cities`: settlements may light its night side (`lit`: always do). `clouds: false`: it has no air. `geysers`: an icy moon's cryovolcanoes.
 * The last of lava and the last four of ice, `locked`, are worn only by a tidally locked world, the one for the face it turns to its sun (`lockFace`), and by every one of them; an eyeball world is never anything else.
 */
interface Variant {
  name: Name;
  cities?: boolean;
  lit?: boolean;
  clouds?: boolean;
  geysers?: boolean;
  locked?: LockFace;
  /** A locked rock world's green band of life (`hasLifeBand`). */
  band?: boolean;
}
const VARIANTS: Record<Exclude<PlanetStyle, 'star'>, readonly Variant[]> = {
  rocky: [
    { name: 'rock', cities: true }, { name: 'rockDesert', cities: true }, { name: 'rockOcean', cities: true }, { name: 'rockMoon', clouds: false }, { name: 'rockAlien' },
    { name: 'rockJungle', cities: true }, { name: 'rockTundra', cities: true }, { name: 'rockSavanna', cities: true }, { name: 'rockAutumn', cities: true },
  ],
  gas: [{ name: 'gas' }, { name: 'gasNeptune' }, { name: 'gasViolet' }, { name: 'gasToxic' }, { name: 'gasCrimson' }, { name: 'gasStormy' }],
  ice: [{ name: 'ice' }, { name: 'iceGlacier' }, { name: 'iceMethane' }, { name: 'iceDusty' }, { name: 'iceRose' }, { name: 'iceCryo', clouds: false, geysers: true }, { name: 'iceLocked', locked: 'molten' }, { name: 'eyeball', locked: 'sea' }, { name: 'iceLockedRock', locked: 'rock' }, { name: 'iceLockedLife', locked: 'rock', band: true }],
  lava: [{ name: 'lavaRivers' }, { name: 'lavaMagma', clouds: false }, { name: 'lavaAsh' }, { name: 'lavaLocked', locked: 'molten' }],
  ocean: [{ name: 'oceanDeep' }, { name: 'oceanReef', cities: true }],
  desert: [{ name: 'desertDunes' }, { name: 'desertSalt', cities: true }],
  acid: [{ name: 'acidLakes' }, { name: 'acidSulfur' }],
  carbon: [{ name: 'carbonGraphite', clouds: false }, { name: 'carbonTar' }],
  crystal: [{ name: 'crystalAmethyst', clouds: false }, { name: 'crystalQuartz', clouds: false }],
  living: [{ name: 'livingMoss' }, { name: 'livingCoral' }],
  machine: [{ name: 'machinePanels', clouds: false, lit: true }, { name: 'machineHive', lit: true }],
  iron: [{ name: 'ironCore', clouds: false }, { name: 'ironRust', clouds: false }],
  eyeball: [{ name: 'eyeball', locked: 'sea' }],
  hycean: [{ name: 'hyceanTeal' }, { name: 'hyceanDeep' }],
  fungal: [{ name: 'fungalCaps' }, { name: 'fungalMycelium' }],
  volcanic: [{ name: 'volcanicIo', clouds: false }, { name: 'volcanicRed', clouds: false }],
};

const dressOf = (p: Planet): Dress => DRESS[p.style as keyof typeof DRESS] ?? DRESS.rocky;

/** The map this planet wears, by its seed (the same on every screen), and its place in the style's list. */
function variantOf(p: Planet): Variant & { index: number } {
  const list = VARIANTS[p.style as keyof typeof VARIANTS] ?? VARIANTS.rocky;
  const face = lockFace(p);
  if (face) {
    const band = hasLifeBand(p);
    const index = list.findIndex((v) => v.locked === face && !!v.band === band);
    return { ...list[index], index };
  }
  const free = list.filter((v) => !v.locked).length;
  const index = (Math.imul(p.seed ^ 0x9e3779b9, 0x85ebca6b) >>> 8) % free;
  return { ...list[index], index };
}

/**
 * How a locked world is turned: the middle of its map (where its melt, sea or bare rock is) at its sun (`LOCK_SUN`, a sea's
 * `SEA_SUN`). Its tilt tips the point under the sun onto the equator, its spin then turns it to longitude ½ (the shader's `mapAt` undone).
 */
function turnTowards([ax, ay, az]: readonly number[]): { tilt: number; spin: number } {
  const tilt = Math.atan2(-ay, az);
  const tz = -ay * Math.sin(tilt) + az * Math.cos(tilt);
  return { tilt, spin: Math.atan2(-ax, tz) };
}
const LOCKED_TURN = turnTowards(LOCK_SUN);
const SEA_TURN = turnTowards(SEA_SUN);

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
  /** How dark the night is, settled or not, for what glows only at night. */
  dark: Float32Array;
  /** The sun's glint on water here, were it water. */
  glint: Float32Array;
}

/** What is painted on the CPU when there are no shaders, made the first time it is needed. */
interface Soft {
  surface: Surface;
  /** The sphere itself, painted again as it turns. */
  sphere: { canvas: HTMLCanvasElement; image: ImageData; map: Texture; gain: number[]; city: Uint8Array | null; emit: Dress['emit'] | null; wet: Dress['wet'] | null; rate: number; phase: number; shift: Float32Array };
  cloud: { kind: MapKind; map: CloudMap; enabled: boolean; colour: Rgb; canvas: HTMLCanvasElement; image: ImageData; shift: Float32Array; direction: number; phase: number; at: number };
}

interface Baked {
  size: number;
  /** The glow past the limb, painted once. */
  glow: HTMLCanvasElement;
  /** What the shader draws the sphere and its cloud from. */
  shade: PlanetShade;
  /** The shader's latest picture of it, and when that was. */
  still: { canvas: HTMLCanvasElement | null; at: number; hits: number };
  soft: () => Soft | null;
  rings: { back: HTMLCanvasElement; front: HTMLCanvasElement } | null;
  moon: Moon | null;
  /** Where on a gas giant's night side lightning strikes are shown. */
  storms: boolean;
  /** Light over the poles of some gas giants. */
  aurora: Aurora | null;
  /** A lava world's meteor strikes. */
  meteors: Meteors | null;
  /** Its volcanoes, or an icy moon's geysers. */
  vents: Vents | null;
  /** A desert's dust storms, the glints of carbon and crystal, a machine world's trains of light (an ocean's hurricanes are in its cloud map). */
  dust: Dust | null;
  glints: Glints | null;
  lanes: Lanes | null;
  /** An ocean's or hycean world's hurricanes (painted in its cloud layer), for the lightning in them. */
  hurricanes: Storms | null;
  /** Heat haze over the limb of a molten world. */
  hot: boolean;
  /** The planet's tilt, which sets where its poles stand in the sprite. */
  tilt: number;
}

/** An aurora: a ring round each pole at `latitude` (radians from the equator), in `colour`, how tall its curtains stand and where in its beat it starts. */
interface Aurora {
  latitude: number;
  colour: Rgb;
  height: number;
  phase: number;
}

const AURORA_COLOURS: Rgb[] = [
  [90, 255, 160],
  [170, 120, 255],
  [255, 110, 160],
];

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

/** Everything about a planet that its seed decides, rolled in a fixed order so the same seed is the same planet on every screen. */
function rollPlanet(p: Planet, variant: Variant) {
  const rng = createRng(p.seed);
  const spin = rng() * Math.PI * 2;
  const tilt = range(rng, -0.35, 0.35);
  const direction = rng() < 0.5 ? -1 : 1;
  const phase = rng() * Math.PI * 2;
  const ringed = rng() < dressOf(p).rings;
  // A world that is always lit draws no more than one that never is, so the rolls after stay where they were.
  const settled = (!!variant.cities && rng() < 0.75) || !!variant.lit;
  const rings = ringed ? rollRings(rng) : null;
  // A planet without rings may have a moon: small, on a slanted orbit.
  const moon: Omit<Moon, 'colour'> | null =
    !ringed && rng() < 0.3
      ? {
          orbit: p.radius * range(rng, 1.55, 2),
          squash: range(rng, 0.25, 0.4),
          tilt: range(rng, -0.6, 0.6),
          radius: p.radius * range(rng, 0.08, 0.13),
          period: range(rng, 30, 70),
          start: rng() * Math.PI * 2,
          direction: rng() < 0.5 ? -1 : 1,
        }
      : null;
  // Rolled after the moon's draws so the planets that already exist keep their looks.
  const aurora: Aurora | null =
    p.style === 'gas' && rng() < 0.5
      ? { latitude: range(rng, 1.18, 1.32), colour: AURORA_COLOURS[Math.floor(rng() * AURORA_COLOURS.length)], height: range(rng, 0.09, 0.15), phase: rng() * 100 }
      : null;
  // A locked world's face is set by the light, not the seed; it rolled the same draws all the same, so the rest are as they were.
  const turn = variant.locked === 'sea' ? SEA_TURN : variant.locked ? LOCKED_TURN : { spin, tilt };
  return { ...turn, direction, phase, rings, settled, moon, aurora };
}

/** What a planet's seed gives it in the forged look, for the look gallery to pick seeds that show every kind. */
export function forgedPlanetTraits(p: Planet): { map: string; index: number; clouds: boolean; settled: boolean; ringed: boolean; moon: boolean; aurora: boolean; storms: boolean; locked: boolean } {
  const variant = variantOf(p);
  const roll = rollPlanet(p, variant);
  return { map: variant.name, index: variant.index, clouds: variant.clouds !== false, settled: roll.settled, ringed: !!roll.rings, moon: !!roll.moon, aurora: !!roll.aurora, storms: p.style === 'gas', locked: !!variant.locked };
}

function bake(p: Planet, ps: number): Baked | null {
  const variant = variantOf(p);
  const mapImage = image(variant.name);
  if (!mapImage) return null;
  const R = p.radius * ps;
  const reach = R * (1 + GLOW);
  const size = spriteSize(p, ps);
  const half = size / 2;
  const { spin, tilt, direction, phase, rings: ringSpec, settled, moon: moonRoll, aurora } = rollPlanet(p, variant);
  const [tr, tg, tb] = hexToRgb(p.tint);
  const mean = (tr + tg + tb) / 3 || 1;
  // The map's own colours, nudged towards the planet's tint so two planets of a style are not twins; a map with a palette of its own (toxic green, crimson) barely.
  const nudge = variant.index === 0 ? 0.45 : 0.12;
  const gain = [mix(1, tr / mean, nudge), mix(1, tg / mean, nudge), mix(1, tb / mean, nudge)];
  // A locked world's open sea and ice are dressed as an eyeball world's; its melt and ice as `LOCKED`, its bare rock and ice as `LOCKED_ROCK`.
  const dress: Dress = variant.locked === 'sea' ? DRESS.eyeball : variant.locked === 'molten' ? { ...dressOf(p), ...LOCKED } : variant.locked === 'rock' ? { ...dressOf(p), ...LOCKED_ROCK } : dressOf(p);
  const { rim, dusk, specular, emit, wet } = dress;
  // A locked world does not turn under its sun; its steam still drifts.
  const surfaceRate = variant.locked ? 0 : SURFACE_RATE * direction;

  // Cloud: wisps over rock, haze over ice, long streaks over a gas giant, smoke over lava, dust over a desert.
  const kind = dress.cloud;
  // An ocean's or hycean world's hurricanes are part of its cloud layer.
  const hurricanes = p.style === 'ocean' || p.style === 'hycean' ? rollStorms(p) : null;
  const clouds = cloudMapOf(kind, hurricanes, p.seed);
  const lights: MapKind = variant.lit ? 'works' : 'city';
  const colour2: Rgb = dress.cloudColour ?? [mix(tr, 255, 0.55), mix(tg, 245, 0.55), mix(tb, 230, 0.55)];

  let soft: Soft | null = null;
  /** Every pixel of the disc worked out once, for painting on the CPU. */
  const makeSoft = (): Soft | null => {
    if (soft) return soft;
    const map = texture(variant.name);
    if (!map) return null;
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
      dark: new Float32Array(size * size),
      glint: new Float32Array(size * size),
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
        surface.dark[n] = smoothstep(0.05, -0.3, lam);
        surface.glint[n] = wet ? wet.strength * 255 * Math.max(0, (dx * half3[0] + dy * half3[1] + nz * half3[2]) / hl) ** GLINT_POWER : 0;
      }
    }
    const sphere = document.createElement('canvas');
    sphere.width = sphere.height = size;
    const cloudCanvas = document.createElement('canvas');
    cloudCanvas.width = cloudCanvas.height = size;
    soft = {
      surface,
      sphere: { canvas: sphere, image: sphere.getContext('2d')!.createImageData(size, size), map, gain, city: settled ? proceduralMap(lights) : null, emit: emit ?? null, wet: wet ?? null, rate: surfaceRate, phase, shift: new Float32Array(MAP_H) },
      cloud: { kind, map: clouds, enabled: variant.clouds !== false, colour: colour2, canvas: cloudCanvas, image: cloudCanvas.getContext('2d')!.createImageData(size, size), shift: new Float32Array(MAP_H), direction, phase, at: -1 },
    };
    return soft;
  };

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

  const rings = ringSpec ? bakeRings(R, tr, tg, tb, ringSpec) : null;
  // Grey with a hint of the planet's colour.
  const moon: Moon | null = moonRoll ? { ...moonRoll, colour: [mix(190, tr, 0.25), mix(186, tg, 0.25), mix(180, tb, 0.25)] } : null;
  return {
    size,
    glow,
    shade: {
      mapName: variant.name,
      map: mapImage,
      cloudName: clouds.name,
      cloud: clouds.data,
      cloudSize: [clouds.width, clouds.height],
      city: settled ? () => proceduralMap(lights) : null,
      cityName: lights,
      mapSize: [MAP_W, MAP_H],
      radius: R,
      half,
      spin,
      tilt,
      gain,
      rim: rim.map((v) => v / 255),
      dusk: dusk.map((v) => v / 255),
      night: NIGHT.map((v) => v / 255),
      cityLight: CITY.map((v) => v / 255),
      specular,
      emitKey: emit?.key ?? HOT,
      emit: emit ? (emit.strength ?? 1) : 0,
      emitNight: !!emit?.night,
      emitPulse: emit?.pulse ?? 0,
      wetKey: wet?.key ?? BLUE,
      wet: wet?.strength ?? 0,
      relief: dress.relief,
      air: variant.clouds !== false,
      cloudColour: colour2.map((v) => v / 255),
      band: kind === 'band',
      surfaceRate,
      cloudRate: CLOUD_RATE * direction,
      phase,
      shadow: SHADOW,
      shadowDepth: SHADOW_DEPTH,
    },
    still: { canvas: null, at: -1, hits: 0 },
    soft: makeSoft,
    rings,
    moon,
    storms: p.style === 'gas',
    aurora,
    meteors: p.style === 'lava' ? rollMeteors(p) : null,
    vents: p.style === 'lava' && !variant.locked ? rollVents(p, 'ash') : p.style === 'volcanic' ? rollVents(p, 'sulfur') : variant.geysers ? rollVents(p, 'ice') : null,
    dust: p.style === 'desert' ? rollDust(p) : null,
    glints: p.style === 'carbon' || p.style === 'iron' ? rollGlints(p, false, [255, 255, 255]) : p.style === 'crystal' ? rollGlints(p, true, [mix(tr, 255, 0.5), mix(tg, 255, 0.5), mix(tb, 255, 0.5)]) : null,
    lanes: p.style === 'machine' ? rollLanes(p) : null,
    hurricanes,
    hot: p.style === 'lava',
    tilt,
  };
}

/**
 * Paints the sphere as it stands at `time`: the map turned about the axis by how far the planet has come round, lit as
 * it was. A gas giant's bands turn at speeds of their own (faster towards the equator), so they slide against each other.
 */
function paintSurface(b: Soft, time: number): void {
  const { sphere, surface, cloud } = b;
  const turn = time * sphere.rate;
  const shift = sphere.shift;
  const emit = sphere.emit;
  const wet = sphere.wet;
  const breath = emit ? emitBreath(emit.pulse ?? 0, time, sphere.phase) : 0;
  for (let r = 0; r < MAP_H; r++) shift[r] = cloud.kind === 'band' ? turn * (1 + 0.5 * Math.sin((r / MAP_H) * Math.PI * 3 + cloud.phase)) : turn;
  const { width: cloudW, height: cloudH } = cloud.map;
  const cloudMap = cloud.map.data();
  const fine = cloudH / MAP_H;
  const data = sphere.image.data;
  const { data: texels, width } = sphere.map;
  const albedo = [0, 0, 0];
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
    const shadow = !cloud.enabled ? 1 : 1 - SHADOW_DEPTH * (cloudMap[row * fine * cloudW + (Math.floor(uc * cloudW) & (cloudW - 1))] / 255) * (0.4 + 0.6 * lit);
    const i = surface.index[k] * 4;
    for (let c = 0; c < 3; c++) {
      const top = texels[a0 + c] + (texels[a1 + c] - texels[a0 + c]) * fx;
      const bottom = texels[b0 + c] + (texels[b1 + c] - texels[b0 + c]) * fx;
      albedo[c] = Math.min(255, (top + (bottom - top) * fy) * sphere.gain[c]);
    }
    // What of the map shines by itself, and what is water mirroring the sun (as in the shader).
    const keyed = (key: Rgb): number => (albedo[0] * key[0] + albedo[1] * key[1] + albedo[2] * key[2]) / 255;
    const glow = emit ? smoothstep(EMIT_FROM, EMIT_FULL, keyed(emit.key)) * 1.1 * (emit.strength ?? 1) * breath * (emit.night ? surface.dark[k] : 1) : 0;
    const glint = wet ? surface.glint[k] * smoothstep(WET_FROM, WET_FULL, keyed(wet.key)) : 0;
    for (let c = 0; c < 3; c++) {
      data[i + c] = Math.min(255, Math.max(mix(NIGHT[c], albedo[c] * shadow, lit) + CITY[c] * lights, albedo[c] * glow) + surface.add[k * 3 + c] + glint);
    }
    data[i + 3] = 255 * surface.cover[k];
  }
  sphere.canvas.getContext('2d')!.putImageData(sphere.image, 0, 0);
}

/** How far the clouds' shadows lie from them (turns of longitude), and how dark they are. */
const SHADOW = 0.012;
const SHADOW_DEPTH = 0.5;

/** Where each row of the cloud has turned to at `time`: the gas giant's bands at speeds of their own, other cloud as one. */
function cloudShifts(b: Soft, time: number): void {
  const { cloud } = b;
  const turn = time * CLOUD_RATE * cloud.direction;
  for (let r = 0; r < MAP_H; r++) cloud.shift[r] = cloud.kind === 'band' ? turn * (1 + 0.8 * Math.sin((r / MAP_H) * Math.PI * 3 + cloud.phase)) : turn;
}

/** Paints the cloud layer as `cloudShifts` left it: the map turned round by how far it has drifted, lit like the sphere under it. */
function paintClouds(b: Soft): void {
  const { cloud, surface } = b;
  const { width: cloudW, height: cloudH } = cloud.map;
  const map = cloud.map.data();
  const fine = cloudH / MAP_H;
  const data = cloud.image.data;
  const [cr, cg, cb] = cloud.colour;
  for (let k = 0; k < surface.count; k++) {
    const row = surface.row[k];
    let u = surface.lon[k] + cloud.shift[row];
    u -= Math.floor(u);
    const a = map[row * fine * cloudW + (Math.floor(u * cloudW) & (cloudW - 1))];
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

/** What a planet's rings are made of: how flat they lie, how they are turned, and their bands (in planet radii). */
interface RingSpec {
  slant: number;
  turn: number;
  bands: { from: number; to: number; alpha: number; warm: number }[];
}

function rollRings(rng: () => number): RingSpec {
  const slant = range(rng, 0.2, 0.36);
  const turn = range(rng, -0.55, 0.55);
  const bands: RingSpec['bands'] = [];
  for (let r = 1.3; r < RING_OUT - 0.1; ) {
    const width = range(rng, 0.03, 0.12);
    // Some stretches are left empty: the gaps between bands.
    if (rng() > 0.25) bands.push({ from: r, to: r + width, alpha: range(rng, 0.25, 0.65), warm: rng() });
    r += width + range(rng, 0, 0.05);
  }
  return { slant, turn, bands };
}

/** The rings, as two layers of one flat disc seen at a slant: the half behind the planet and the half in front of it. */
function bakeRings(R: number, tr: number, tg: number, tb: number, { slant, turn, bands }: RingSpec): Baked['rings'] {
  const span = Math.ceil(R * 2 * RING_OUT + 6);
  const middle = span / 2;
  const sand: Rgb = [235, 220, 190];
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
function moonAt(m: Moon, time: number): MoonAt {
  const a = m.start + (time / m.period) * Math.PI * 2 * m.direction;
  const ex = Math.cos(a) * m.orbit;
  const ey = Math.sin(a) * m.orbit * m.squash;
  // The orbit is a circle seen at a slant: what the squash takes off its height is its depth.
  const z = Math.sin(a) * m.direction * m.orbit * Math.sqrt(1 - m.squash * m.squash);
  return { x: ex * Math.cos(m.tilt) - ey * Math.sin(m.tilt), y: ex * Math.sin(m.tilt) + ey * Math.cos(m.tilt), z, front: z > 0 };
}

interface MoonAt {
  x: number;
  y: number;
  /** Towards the viewer. */
  z: number;
  front: boolean;
}

/** How much of the sun the planet leaves a moon: 0 when it is deep in the planet's shadow. */
function moonLight(m: MoonAt, planetRadius: number): number {
  const along = m.x * LIGHT[0] + m.y * LIGHT[1] + m.z * LIGHT[2];
  if (along >= 0) return 1;
  const off = Math.sqrt(Math.max(0, m.x * m.x + m.y * m.y + m.z * m.z - along * along));
  return smoothstep(planetRadius * 0.85, planetRadius * 1.15, off);
}

/** The moon's shadow on the planet's disc, where the ray from the moon away from the light meets the sphere. Only the lit, near side is painted. */
function drawMoonShadow(ctx: CanvasRenderingContext2D, x: number, y: number, planetRadius: number, m: Moon, at: MoonAt): void {
  const dot = at.x * LIGHT[0] + at.y * LIGHT[1] + at.z * LIGHT[2];
  const disc = dot * dot - (at.x * at.x + at.y * at.y + at.z * at.z) + planetRadius * planetRadius;
  if (disc <= 0) return;
  const t = dot - Math.sqrt(disc);
  if (t <= 0) return;
  const px = at.x - t * LIGHT[0];
  const py = at.y - t * LIGHT[1];
  const pz = at.z - t * LIGHT[2];
  if (pz <= 0) return;
  // Where the surface turns from the light the shadow thins out; the skin of the limb stays clear.
  const facing = (px * LIGHT[0] + py * LIGHT[1] + pz * LIGHT[2]) / planetRadius;
  if (facing <= 0.05) return;
  const nz = pz / planetRadius;
  const stretch = Math.min(2.2, 1 / facing);
  const radial = Math.atan2(py, px);
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, planetRadius * 0.97, 0, Math.PI * 2);
  ctx.clip();
  ctx.translate(x + px, y + py);
  ctx.rotate(radial);
  // Across the radial direction it is as wide as the moon; along it the sphere's curve squeezes it, the slant of the light stretches it.
  ctx.scale(Math.max(0.2, Math.min(1, nz * stretch)), 1);
  const r = m.radius * 1.15;
  const g = ctx.createRadialGradient(0, 0, r * 0.35, 0, 0, r);
  const a = 0.6 * smoothstep(0.05, 0.4, facing);
  g.addColorStop(0, `rgba(3,6,16,${a})`);
  g.addColorStop(1, 'rgba(3,6,16,0)');
  ctx.fillStyle = g;
  ctx.fillRect(-r, -r, r * 2, r * 2);
  ctx.restore();
}

/** A moon: a small grey ball lit from the same side as the planet, dark on the other. */
function drawMoon(ctx: CanvasRenderingContext2D, x: number, y: number, m: Moon, at: MoonAt, planetRadius: number): void {
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
  // In the planet's shadow the moon goes dark.
  const lit = moonLight(at, planetRadius);
  if (lit < 1) {
    ctx.fillStyle = `rgba(6,10,22,${0.85 * (1 - lit)})`;
    ctx.fill();
  }
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

const AURORA_RAYS = 56;

/** Curtains of light over a gas giant's poles: a glowing ring at the magnetic latitude and rays standing off it, rippling along the ring. Stronger on the night side. */
function drawAurora(ctx: CanvasRenderingContext2D, x: number, y: number, R: number, a: Aurora, tilt: number, time: number): void {
  const ct = Math.cos(tilt);
  const st = Math.sin(tilt);
  const [r, g, b] = a.colour;
  const ring = new Path2D();
  const dim = new Path2D();
  const bright = new Path2D();
  for (const sign of [-1, 1]) {
    const ty = Math.sin(a.latitude) * sign;
    const cl = Math.cos(a.latitude);
    let pen = false;
    for (let k = 0; k <= AURORA_RAYS; k++) {
      const lon = (k / AURORA_RAYS) * Math.PI * 2;
      const tz = Math.cos(lon) * cl;
      // The point on the sphere in screen terms: undo the tilt.
      const dy = ty * ct - tz * st;
      const nz = ty * st + tz * ct;
      if (nz <= 0.03) {
        pen = false;
        continue;
      }
      const dx = Math.sin(lon) * cl;
      const px = x + dx * R;
      const py = y + dy * R;
      if (pen) ring.lineTo(px, py);
      else ring.moveTo(px, py);
      pen = true;
      if (k === AURORA_RAYS) continue;
      // The curtain's height ripples along the ring and over time.
      const wave = 0.5 + 0.5 * Math.sin(time * 1.1 + lon * 4 + a.phase + Math.sin(time * 0.6 + lon * 2.5) * 1.8);
      const reach = a.height * R * (0.25 + 0.75 * wave) * (0.6 + 0.4 * nz);
      // Outwards from the surface: the normal, seen from the side.
      const path = dx * LIGHT[0] + dy * LIGHT[1] + nz * LIGHT[2] > 0.35 ? dim : bright;
      path.moveTo(px, py);
      path.lineTo(px + dx * reach, py + dy * reach);
    }
  }
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const sway = 0.8 + 0.2 * Math.sin(time * 0.9 + a.phase);
  ctx.strokeStyle = `rgba(${r},${g},${b},${0.06 * sway})`;
  ctx.lineWidth = R * 0.13;
  ctx.stroke(ring);
  ctx.strokeStyle = `rgba(${r},${g},${b},${0.16 * sway})`;
  ctx.lineWidth = R * 0.05;
  ctx.stroke(ring);
  ctx.lineWidth = R * 0.02;
  ctx.strokeStyle = `rgba(${r},${g},${b},${0.14 * sway})`;
  ctx.stroke(dim);
  ctx.strokeStyle = `rgba(${r},${g},${b},${0.4 * sway})`;
  ctx.stroke(bright);
  ctx.restore();
}

const NO_SCARS: readonly Scar[] = [];

/** A planet's sprite in the forged look: baked on first draw once its map has loaded, the lit planet of `forged-lit-planet.ts` until then. */
export function renderForgedPlanet(p: Planet, ps: number): PlanetSprite {
  // The stand-in is made only if it is drawn: once the map has loaded (nearly always, after the first planets) it never is.
  let fallback: PlanetSprite | null = null;
  let baked: Baked | null = null;
  /** When each of the planet's hits was first drawn, so its crack turns away with the surface from where it struck, and when it flared (long ago for the hits it already had when the sprite was made). */
  const hitAt: { at: number; flare: number }[] = [];
  let seen = false;
  const impacts = new Float32Array(MAX_IMPACTS * 4);
  /** The damage of `planet` as the shader takes it, or null while it is whole or the crack map is still loading. */
  const cracksOf = (planet: Planet, time: number, surfaceRate: number, turn: number): PlanetCracks | null => {
    const hits = planet.fractures ?? [];
    if (hits.length < hitAt.length) hitAt.length = hits.length;
    // A sprite made after the hits (a new size, a new look) shows them settled, not flaring all at once.
    while (hitAt.length < hits.length) hitAt.push({ at: time, flare: seen ? time : time - 10 });
    seen = true;
    const warning = instabilityPulse(planet, time);
    const map = warning ? image('cracks') : null;
    if (!warning || !map) return null;
    const shown = Math.min(hits.length, MAX_IMPACTS);
    for (let i = 0; i < shown; i++) {
      // The latest hits, if there are more than the shader takes. The angle is the field's, turned into the sprite's frame.
      const k = hits.length - shown + i;
      const a = hits[k] - turn;
      impacts.set([Math.cos(a) * IMPACT_AT, Math.sin(a) * IMPACT_AT, hitAt[k].at * surfaceRate, time - hitAt[k].flare], i * 4);
    }
    return { map, impacts, hits: shown, danger: warning.danger, glow: warning.pulse };
  };
  const place = (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, x: number, y: number, scale: number): void => {
    ctx.drawImage(canvas, x - canvas.width / scale / 2, y - canvas.height / scale / 2, canvas.width / scale, canvas.height / scale);
  };
  return {
    size: spriteSize(p, ps),
    draw(ctx, x, y, scale, time, planet = p, scars = NO_SCARS, turn = 0) {
      baked ??= bake(p, ps);
      if (!baked) {
        fallback ??= renderLitPlanet(p, ps);
        fallback.draw(ctx, x, y, scale, time);
        return;
      }
      const moon = baked.moon ? moonAt(baked.moon, time) : null;
      place(ctx, baked.glow, x, y, scale);
      if (moon && !moon.front) drawMoon(ctx, x, y, baked.moon!, moon, p.radius);
      if (baked.rings) place(ctx, baked.rings.back, x, y, scale);
      // A planet turns slowly: the shader's picture is kept and worked out again on the planet's own beat, so they do not all fall in one frame.
      const still = baked.still;
      const cracks = cracksOf(planet, time, baked.shade.surfaceRate, turn);
      const every = cracks ? CRACKS_EVERY : CLOUD_EVERY;
      const struck = (planet.fractures?.length ?? 0) !== still.hits;
      if (!still.canvas || still.at < 0 || time < still.at || time - still.at >= every || struck) {
        still.at = still.at < 0 ? time - ((p.seed % 7) / 7) * CLOUD_EVERY : time;
        still.hits = planet.fractures?.length ?? 0;
        const shaded = shadePlanet(baked.shade, time, cracks);
        if (shaded) {
          still.canvas ??= document.createElement('canvas');
          if (still.canvas.width !== shaded.w || still.canvas.height !== shaded.h) {
            still.canvas.width = shaded.w;
            still.canvas.height = shaded.h;
          }
          const c = still.canvas.getContext('2d')!;
          c.globalCompositeOperation = 'copy';
          placeShaded(c, shaded, 0, 0, shaded.w, shaded.h);
        } else {
          still.canvas = null;
        }
      }
      if (still.canvas) {
        const span = baked.size / scale;
        ctx.drawImage(still.canvas, x - span / 2, y - span / 2, span, span);
      } else {
        const soft = baked.soft();
        if (soft) {
          // Each planet is painted again on its own beat, so they do not all fall in one frame.
          if (soft.cloud.at < 0 || time - soft.cloud.at >= CLOUD_EVERY) {
            if (soft.cloud.at < 0) soft.cloud.at = time - ((p.seed % 7) / 7) * CLOUD_EVERY;
            else soft.cloud.at = time;
            cloudShifts(soft, time);
            paintSurface(soft, time);
            if (soft.cloud.enabled) paintClouds(soft);
          }
          place(ctx, soft.sphere.canvas, x, y, scale);
          if (soft.cloud.enabled) place(ctx, soft.cloud.canvas, x, y, scale);
        }
      }
      if (moon?.front) drawMoonShadow(ctx, x, y, p.radius, baked.moon!, moon);
      if (baked.storms) drawLightning(ctx, x, y, p, time);
      const turning: Turning = { spin: baked.shade.spin, tilt: baked.shade.tilt, rate: baked.shade.surfaceRate };
      for (const scar of scars) drawScarOf(ctx, x, y, p.radius, turning, scar, turn, time);
      if (baked.dust) drawDust(ctx, x, y, p, turning, baked.dust, time);
      if (baked.hurricanes) {
        const drifting: Turning = { ...turning, rate: baked.shade.cloudRate };
        drawStormLightning(ctx, x, y, p, drifting, baked.hurricanes, time, baked.shade.band ? { phase: baked.shade.phase } : null);
      }
      if (baked.lanes) drawLanes(ctx, x, y, p, turning, baked.lanes, time);
      if (baked.glints) drawGlints(ctx, x, y, p, turning, baked.glints, time);
      if (baked.meteors) drawMeteors(ctx, x, y, p, turning, baked.meteors, time);
      if (baked.vents) drawPlumes(ctx, x, y, p, turning, baked.vents, time);
      if (baked.hot) drawShimmer(ctx, x, y, p.radius, p.seed, time);
      if (baked.aurora) drawAurora(ctx, x, y, p.radius, baked.aurora, baked.tilt, time);
      if (baked.rings) place(ctx, baked.rings.front, x, y, scale);
      if (moon?.front) drawMoon(ctx, x, y, baked.moon!, moon, p.radius);
    },
  };
}

/** A shot's scar, struck where the shot met the rim (the field's angle, turned into the sprite's frame by `turn`), just in from the limb. */
function drawScarOf(ctx: CanvasRenderingContext2D, x: number, y: number, R: number, s: Turning, scar: Scar, turn: number, time: number): void {
  const a = scar.angle - turn;
  drawScar(ctx, x, y, R, s, { x: Math.cos(a) * IMPACT_AT, y: Math.sin(a) * IMPACT_AT }, scar.age, SCAR_LIFE, time);
}
