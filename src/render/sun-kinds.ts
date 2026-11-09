import type { Planet } from '../sim/physics';

type Rgb = readonly [number, number, number];

/** The kinds of star a Solar System's sun may be. Only how it looks: its size, mass and storms are the same for each. */
export const SUN_KINDS = ['yellow', 'orange', 'red', 'blue', 'pulsing'] as const;
export type SunKindId = (typeof SUN_KINDS)[number];

/**
 * How one kind of sun is coloured and how it behaves on screen. The plasma's ramp runs from the coolest seams to the
 * hottest middle of a fold, at the same five steps for every kind (0, 0.3, 0.58, 0.82, 1).
 */
export interface SunKind {
  id: SunKindId;
  ramp: readonly [Rgb, Rgb, Rgb, Rgb, Rgb];
  /** The corona at the surface and far out. */
  corona: readonly [Rgb, Rgb];
  /** The glows, wide to tight: each its colour in the middle and towards its edge. */
  glows: readonly [readonly [string, string], readonly [string, string], readonly [string, string]];
  /** The thin rim just outside the ball. */
  chromosphere: string;
  /** Light from inside: the hot middle, halfway out, and the rim. */
  core: readonly [string, string, string];
  /** A magnetic loop: its wide faint body, its middle and its bright thread. */
  loops: readonly [string, string, string];
  /** The light thrown over the field round it, as `r,g,b`. */
  wash: string;
  /** The colour of the projected star. */
  holo: string;
  /** How much of the surface the dark spots cover (0 → 1): a red dwarf is freckled with them. */
  spots: number;
  /** How far the corona reaches, against a yellow sun's. */
  reach: number;
  /** How fine the rising cells are, against a yellow sun's: a hot star's are finer. */
  grain: number;
  /** How fast the gas churns, against a yellow sun's. */
  churn: number;
}

const YELLOW: SunKind = {
  id: 'yellow',
  ramp: [[120, 26, 8], [226, 76, 14], [255, 150, 30], [255, 214, 90], [255, 248, 200]],
  corona: [[255, 222, 150], [214, 74, 26]],
  glows: [['#ff7a24', '#a82410'], ['#ffb347', '#ff6a1c'], ['#ffe9a8', '#ffa03a']],
  chromosphere: '#ff4a2c',
  core: ['#fff4cc', '#ffc04a', '#ff8a2e'],
  loops: ['#ff5a1a', '#ff8a2e', '#ffe2a6'],
  wash: '255,196,110',
  holo: '#ffd27a',
  spots: 0,
  reach: 1,
  grain: 1,
  churn: 1,
};

const KINDS: Record<SunKindId, SunKind> = {
  yellow: YELLOW,
  /** A K star: cooler than ours, amber all through, with a few spots. */
  orange: {
    id: 'orange',
    ramp: [[90, 14, 4], [184, 44, 8], [232, 92, 16], [252, 140, 40], [255, 196, 120]],
    corona: [[255, 190, 120], [190, 52, 18]],
    glows: [['#ff5e18', '#8a1c0a'], ['#ff9a36', '#f04e14'], ['#ffcf88', '#ff8a2a']],
    chromosphere: '#ff3f22',
    core: ['#ffe2a8', '#ffa236', '#ff6e22'],
    loops: ['#ff4a12', '#ff7a22', '#ffcf8a'],
    wash: '255,160,80',
    holo: '#ffaa55',
    spots: 0.35,
    reach: 0.9,
    grain: 0.9,
    churn: 0.85,
  },
  /** A red dwarf: small and cool, deep red, freckled with big dark spots, and restless: it flares now and then on its own. */
  red: {
    id: 'red',
    ramp: [[70, 8, 6], [160, 26, 12], [214, 54, 22], [246, 96, 40], [255, 170, 120]],
    corona: [[255, 140, 110], [150, 24, 16]],
    glows: [['#e8301a', '#6a0a06'], ['#ff5a30', '#c41e0c'], ['#ff9a70', '#ff4a24']],
    chromosphere: '#ff2a20',
    core: ['#ffc0a0', '#ff6a3a', '#e8301a'],
    loops: ['#e8241a', '#ff5a30', '#ffb090'],
    wash: '255,96,64',
    holo: '#ff7a5a',
    spots: 1,
    reach: 0.75,
    grain: 0.8,
    churn: 1.25,
  },
  /** A hot blue-white star: the gas runs from violet seams to white, the cells are fine and fast, the corona long and pale. */
  blue: {
    id: 'blue',
    ramp: [[40, 40, 140], [70, 110, 230], [130, 180, 255], [200, 226, 255], [250, 252, 255]],
    corona: [[210, 230, 255], [70, 100, 220]],
    glows: [['#4a7aff', '#1a2a8a'], ['#8ab8ff', '#3a64e8'], ['#e4f0ff', '#8ab4ff']],
    chromosphere: '#7a8aff',
    core: ['#ffffff', '#b8d4ff', '#6a9aff'],
    loops: ['#3a6aff', '#7aa8ff', '#e8f2ff'],
    wash: '150,190,255',
    holo: '#8ec8ff',
    spots: 0,
    reach: 1.3,
    grain: 1.5,
    churn: 1.4,
  },
  /** A pulsating variable: a pale gold star that breathes, brightening and dimming every few seconds. */
  pulsing: {
    id: 'pulsing',
    ramp: [[140, 50, 14], [236, 120, 30], [255, 190, 70], [255, 232, 150], [255, 254, 236]],
    corona: [[255, 240, 190], [230, 120, 40]],
    glows: [['#ffa040', '#b04014'], ['#ffd070', '#ff9030'], ['#fff4c8', '#ffc860']],
    chromosphere: '#ff6a3a',
    core: ['#fffbe8', '#ffd870', '#ffa040'],
    loops: ['#ff7a2a', '#ffaa44', '#fff0c0'],
    wash: '255,214,140',
    holo: '#ffe08a',
    spots: 0,
    reach: 1.1,
    grain: 1.1,
    churn: 1,
  },
};

/** The share of suns each kind takes, from a byte of the seed (out of 256): ours is the most common. */
const SHARES: readonly [SunKindId, number][] = [['yellow', 96], ['orange', 48], ['red', 40], ['blue', 40], ['pulsing', 32]];

/** What kind of star a sun is, from its seed, so every look and every screen agree. */
export function sunKind(sun: Pick<Planet, 'seed'>): SunKind {
  let byte = (Math.imul(sun.seed ^ 0x5bd1e995, 0x2c1b3c6d) >>> 12) & 255;
  for (const [id, share] of SHARES) {
    if (byte < share) return KINDS[id];
    byte -= share;
  }
  return YELLOW;
}

/** A seeded [0, 1) for one slot of a sun, the same on every screen. */
const slot = (seed: number, k: number): number => {
  const h = Math.sin((seed + k * 0.618) * 127.1) * 43758.5453;
  return h - Math.floor(h);
};

/**
 * How bright a sun is just now, against its usual (1). A pulsing star breathes on a slow beat; a red dwarf flares now and
 * then, a sharp rise and a slower fall, every 7–13 s; the others stay steady.
 */
export function sunBeat(kind: SunKind, seed: number, time: number): { glow: number; flare: number } {
  if (kind.id === 'pulsing') {
    const period = 4.5 + slot(seed, 3) * 2;
    // A Cepheid brightens fast and dims slowly.
    const phase = (time / period + slot(seed, 5)) % 1;
    const wave = phase < 0.3 ? Math.sin((phase / 0.3) * (Math.PI / 2)) : Math.cos(((phase - 0.3) / 0.7) * (Math.PI / 2));
    return { glow: 0.7 + 0.55 * wave, flare: 0 };
  }
  if (kind.id === 'red') {
    const period = 7 + slot(seed, 7) * 6;
    const age = ((time / period + slot(seed, 9)) % 1) * period;
    const burst = age < 0.25 ? age / 0.25 : Math.exp(-(age - 0.25) * 1.6);
    return { glow: 1, flare: 0.45 * burst * burst };
  }
  return { glow: 1, flare: 0 };
}

/** The plasma's colour at heat `t` (0 cool, 1 hot) on a kind's ramp. */
export function sunHeat(kind: SunKind, t: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, t));
  for (let i = 1; i < RAMP_STEPS.length; i++) {
    if (x > RAMP_STEPS[i]) continue;
    const k = (x - RAMP_STEPS[i - 1]) / (RAMP_STEPS[i] - RAMP_STEPS[i - 1]);
    const a = kind.ramp[i - 1];
    const b = kind.ramp[i];
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  }
  const top = kind.ramp[4];
  return [top[0], top[1], top[2]];
}
export const RAMP_STEPS = [0, 0.3, 0.58, 0.82, 1] as const;

/**
 * A kind as it turns into a red giant (`giant` 0 → 1): every star swells into the same cool red one, so its ramp and
 * corona slide to a yellow sun's, which the giant's own reddening then takes on.
 */
export function towardsGiant(kind: SunKind, giant: number): SunKind {
  const k = Math.min(1, giant * 1.6);
  if (k <= 0 || kind.id === 'yellow') return kind;
  const mixRgb = (a: Rgb, b: Rgb): Rgb => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  return {
    ...kind,
    ramp: kind.ramp.map((c, i) => mixRgb(c, YELLOW.ramp[i])) as unknown as SunKind['ramp'],
    corona: [mixRgb(kind.corona[0], YELLOW.corona[0]), mixRgb(kind.corona[1], YELLOW.corona[1])],
    // Its glows, rim and loops change over at once halfway: blended, a blue star's would pass through violet.
    ...(k >= 0.5 ? { glows: YELLOW.glows, chromosphere: YELLOW.chromosphere, core: YELLOW.core, loops: YELLOW.loops, wash: YELLOW.wash } : {}),
  };
}
