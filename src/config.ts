/** Logical play field. Physics runs in these units; rendering scales to the window. */
export const FIELD = { width: 1280, height: 800 } as const;

export const PHYSICS = {
  /** Gravitational constant tuned so mid-sized planets bend a 50 % shot by roughly 20–40°. */
  G: 70,
  /** Fixed simulation step in seconds. Everything (game + CPU) uses the same step, so shots are deterministic. */
  DT: 1 / 240,
  /** Launch speed in px/s per power point (power 0–100). */
  SPEED_PER_POWER: 8,
  SHIP_RADIUS: 13,
  /** Distance from ship centre where the projectile spawns. */
  MUZZLE: 20,
  /** How far a shot may leave the field before it counts as lost (without reflecting edges). */
  OUT_MARGIN: 300,
} as const;

export const AIM = {
  MIN_POWER: 0,
  MAX_POWER: 100,
  DEFAULT_POWER: 50,
  FIXED_POWER: 55,
  /** [angle step in degrees, power step] per modifier. */
  STEPS: {
    normal: [1, 1],
    large: [10, 10],
    small: [0.1, 0.1],
    tiny: [0.01, 0.01],
  },
} as const;

export const SCORING = {
  BASE: 1000,
  /** Points the opponent receives when a player destroys their own ship. */
  SELF_HIT: 300,
} as const;

/** Palette — "astrographic plate": deep prussian ink, bone-white graphite, two signal colours. */
export const COLORS = {
  plate: '#0b1a33',
  plateLift: '#12284d',
  line: '#5b7db3',
  bone: '#e8e4d8',
  boneDim: '#9aa6bd',
  sodium: '#ffd27a',
  players: ['#ff8660', '#6fe3c8'] as const,
} as const;

export const FONTS = {
  display: '"Big Shoulders Stencil Display", "Arial Narrow", sans-serif',
  body: '"B612", system-ui, sans-serif',
  mono: '"B612 Mono", ui-monospace, monospace',
} as const;
