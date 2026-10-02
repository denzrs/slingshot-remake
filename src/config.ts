/** Logical play field. Physics runs in these units; rendering scales to the window. */
export const FIELD = { width: 1280, height: 800 } as const;

export const MAX_PLAYERS = 6;

export const PHYSICS = {
  /** Gravitational constant tuned so mid-sized planets bend a 50 % shot by roughly 20–40°. */
  G: 70,
  /** Fixed simulation step in seconds. Everything (game, CPU, killcam) uses the same step, so shots are deterministic. */
  DT: 1 / 240,
  /** Launch speed in px/s per power point (power 0–100). */
  SPEED_PER_POWER: 8,
  SHIP_RADIUS: 13,
  /** Distance from ship centre where the projectile spawns. */
  MUZZLE: 20,
  /** How far a shot may leave the field before it counts as lost (without reflecting edges). */
  OUT_MARGIN: 300,
  /** Two projectiles closer than this annihilate each other. */
  CLASH_RADIUS: 7,
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
  /** Penalty for destroying your own ship. */
  SELF_HIT: 300,
  /** Classic: bonus for the last ship standing. */
  SURVIVOR: 250,
  /** Event Horizon: bonus per volley survived, and for the last ship in orbit. */
  VOLLEY_SURVIVED: 50,
  LAST_IN_ORBIT: 500,
  /** Combo multipliers can't run away completely. */
  MAX_COMBO: 12,
} as const;

/** "Ereignishorizont" — the gravity royale mode. */
export const HORIZON = {
  START_RADIUS: 16,
  START_MASS: 220_000,
  /** Horizon growth per collapse: base + per-volley acceleration. */
  GROWTH: 6,
  GROWTH_ACCEL: 0.9,
  MASS_PER_VOLLEY: 45_000,
  /** Share of a devoured planet's mass the hole keeps. */
  FEED: 0.6,
  /** Orbital decay: drift = DRIFT · mass / distance², clamped. */
  DRIFT: 7.5,
  MIN_DRIFT: 8,
  MAX_DRIFT: 70,
  SHOT_CLOCK: 12,
  SHOT_TIME: 10,
  COLLAPSE_TIME: 1.5,
} as const;

/** Daily challenge: a fixed run of sectors against stationary targets, the same for everyone on a given day. */
export const CHALLENGE = {
  SECTORS: 5,
  /** Seconds a shot may fly before it fizzles out. */
  FLIGHT_TIME: 15,
  /** Bonus for clearing every target of a sector. */
  CLEAR_BONUS: 250,
  /** Challenge #1 — the calendar day the daily challenge launched. */
  EPOCH: '2026-10-02',
  /** Rank ladder: share of the flawless baseline (one first-try hit per target, plus clear bonuses) needed for each rank. */
  RANKS: [0, 0.3, 0.55, 0.8, 1.05, 1.35],
} as const;

/** Palette — "astrographic plate": deep prussian ink, bone-white graphite, six signal colours. */
export const COLORS = {
  plate: '#0b1a33',
  plateLift: '#12284d',
  line: '#5b7db3',
  bone: '#e8e4d8',
  boneDim: '#9aa6bd',
  sodium: '#ffd27a',
  danger: '#ff5a6e',
  players: ['#ff8660', '#6fe3c8', '#b99cff', '#62b6ff', '#ff6f9f', '#c6e86a'] as const,
} as const;

/**
 * Team mode: every team has a family of shades, so friend and foe read at a glance
 * while each ship's trail stays distinguishable. Names live in i18n (`team.0` …).
 */
export const TEAMS = [
  ['#ff8660', '#ffb98f', '#e0573a'],
  ['#6fe3c8', '#aef3e1', '#33b896'],
  ['#b99cff', '#dccdff', '#8a67ee'],
] as const;

export const FONTS = {
  display: '"Big Shoulders Stencil Display", "Arial Narrow", sans-serif',
  body: '"B612", system-ui, sans-serif',
  mono: '"B612 Mono", ui-monospace, monospace',
} as const;
