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
  OUT_MARGIN: 400,
  /** Two projectiles closer than this annihilate each other. */
  CLASH_RADIUS: 7,
} as const;

/** The wormhole power-up: two mouths that carry a shot from one to the other, in both directions. */
export const WORMHOLE = {
  /** A shot whose centre comes this close to a mouth is carried through. */
  RADIUS: 22,
  /** Two portals closer than this overlap, and cannot be placed: centre to centre, the ovals' full height. */
  GAP: 50,
  /**
   * The colour of a wormhole's portals: both portals of one wormhole share it, and each wormhole on the field has
   * its own, so which portals belong together can be seen at once. The palette starts over after the last.
   */
  COLORS: ['#4db8ff', '#ff9d3a', '#5cf08a', '#ff5cd0', '#ffe14d', '#a98bff'],
} as const;

/** The planetary defense: a shot is not struck down on entering the dome but tracked, locked and then hit. */
export const DEFENSE = {
  /** A shot must stay this long (s) in the dome for the turret to lock on, or it flies through unharmed. */
  LOCK_TIME: 0.04,
  /** Once locked, the interceptor takes this long (s) to arrive, and the hit is sure even if the shot has left the dome by then. */
  TRAVEL_TIME: 0.05,
} as const;

/** Physics constants that only the nebula power-up uses. */
export const NEBULA = {
  /** Half a field across at most: a cloud big enough to fly through, small enough to miss. */
  RADIUS: 150,
  /** Velocity kept per physics step inside a cloud (compounding drag), so a shot slows hard without stopping. */
  DRAG: 0.995,
  /**
   * The slowest a shot may go inside a cloud (px/s). The drag may not take it below this, so a cloud can
   * never trap a shot: it always crawls out (or ends on something) instead of hanging there until it times out.
   */
  MIN_SPEED: 60,
  /** Gravity felt inside a cloud is this many times stronger, so shots bend into it. */
  GRAVITY: 1.7,
} as const;

export const AIM = {
  MIN_POWER: 0,
  MAX_POWER: 100,
  DEFAULT_POWER: 50,
  FIXED_POWER: 55,
  /** The choices for capping a shot's power, lowest first (the highest is no cap). */
  CAP_OPTIONS: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100] as readonly number[],
  /** The choices for the power every shot has when it is fixed: finer than the cap, so the classic 55 is one of them. */
  FIXED_OPTIONS: Array.from({ length: 19 }, (_, i) => 10 + i * 5) as readonly number[],
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
  /** High-five: two shots meet in mid-air. Both shooters get the points — a teammate's missile pays more. Like the trick shots it only pays where they do. */
  HIGH_FIVE_ENEMY: 50,
  HIGH_FIVE_TEAMMATE: 100,
  /**
   * The kill chain: one shot that takes more than one ship in a volley (a splitter's forks, an armor-piercing
   * round going through hulls) pays a bonus for every enemy after the first. Indexed by the kill it pays for.
   */
  MULTI_KILL: [0, 0, 250, 500, 750, 1000] as readonly number[],
  /** Combo multipliers can't run away completely. */
  MAX_COMBO: 12,
} as const;

/** Fading trails: the choices for how long a finished shot's path lasts in seconds (0 = it stays), and the share of that time it stays fully visible before fading. */
export const TRAIL_FADE = { OPTIONS: [0, 1, 2, 4], HOLD: 0.4 };

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
  /** Online, everybody aims at once, so the shared clock is a little longer than one hot-seat turn. */
  SIMULTANEOUS_CLOCK: 15,
  SHOT_TIME: 10,
  COLLAPSE_TIME: 1.5,
  /** Seconds the finished volley stays on screen before a killcam cuts in, so the last hit lands first. */
  KILLCAM_DELAY: 1,
} as const;

/** The oracle: eliminated players tip on what the others' shots do. A side standing — it never counts towards winning. */
export const ORACLE = {
  /** Base points for a right tip: "will it hit?" (turn by turn), a named ship, and "nobody" (salvos). */
  SHOT: 100,
  SHIP: 150,
  NOBODY: 75,
  /** Every right tip in a row raises the multiplier by this much, up to the cap. */
  STREAK_STEP: 0.5,
  MAX_MULTIPLIER: 3,
  /** Seconds the verdict stays on the card before the next question takes its place. */
  RESULT_SECONDS: 3,
  /** "Who wins the round?": base points per rival the winner had to beat when the tip was made (two ships left pay 1×, five pay 4×). */
  WINNER: 100,
  /** …and the base for tipping "nobody" when a round ends in a draw. */
  DRAW: 200,
  /** Flat bonus for a right tip against the crowd: with at least three tipsters, fewer than half named the same. */
  UNDERDOG: 50,
  UNDERDOG_MIN_TIPS: 3,
  /** Seconds between two tips turning over when the shots are away. */
  REVEAL_STEP: 0.28,
  /**
   * Betting on the round question with points of the match: a ghost may stake up to this share of their
   * score (in steps of `STAKE_STEP`, at least `STAKE_MIN`). The stakes of a round make one pot; whoever tipped
   * right shares it in proportion to their stakes, whoever tipped wrong loses theirs.
   */
  STAKE_SHARE: 0.5,
  STAKE_MIN: 20,
  STAKE_STEP: 10,
  /** Seconds a question stays open before a shot or salvo may fly, so ghosts have time to tip and bet. */
  MIN_BET_TIME: 3,
} as const;

/**
 * The ghost lane: planet smasher. A small field of rocks, bombs and a few planets for eliminated
 * players while the others play on. One shot blows up whatever it touches, and every blast sets off
 * its neighbours; the lane is cleared when every glowing core is gone. A side game — it never counts
 * towards winning.
 */
export const GHOST = {
  /** The lane's own field: smaller than the game's, so its rocks stay big in a small panel. */
  WIDTH: 900,
  HEIGHT: 560,
  /** Shots per lane. */
  SHOTS: 5,
  /** Seconds a shot may fly, and how much faster than real time it does. */
  FLIGHT_TIME: 9,
  SPEED: 3,
  /** Radii of rocks, bombs and the golden rock, and how close a shot has to pass to set one off. */
  ROCK_R: 15,
  BOMB_R: 18,
  GOLD_R: 20,
  SHOT_R: 7,
  /** Blast radius of a rock, a bomb and the golden rock; a planet blows up with `PLANET_BLAST × radius + PLANET_BLAST_FLAT`. */
  BLAST: { rock: 44, bomb: 104, gold: 80 },
  PLANET_BLAST: 1.2,
  PLANET_BLAST_FLAT: 90,
  /** Base points per thing blown up. */
  BASE: { rock: 10, bomb: 40, gold: 250, planet: 150 },
  /** Extra base points for a rock that goes up close to the black hole: "fed to the hole". */
  FEED: 40,
  FEED_RADIUS: 140,
  /** A blast reaches its neighbours after this many seconds plus `FUSE_PER_PX` per pixel, so a chain rolls outwards. */
  FUSE: 0.09,
  FUSE_PER_PX: 0.0012,
  /** The n-th thing blown up by one shot pays base × (1 + `COMBO_STEP` × (n − 1)), at most `COMBO_MAX`. */
  COMBO_STEP: 0.15,
  COMBO_MAX: 4,
  /** Every swing-by on the way raises the shot's total by this much. */
  SWINGBY: 0.5,
  /** Flat bonus for a chain of at least [things blown up by one shot, points]. */
  CHAINS: [[15, 500], [10, 250], [6, 100]] as readonly (readonly [number, number])[],
  /** Clearing a lane: a flat bonus, plus a bonus for every shot left and for blowing up everything. */
  CLEAR: 100,
  SPARE_SHOT: 50,
  PERFECT: 200,
  /** Every lane cleared in a row raises the multiplier by this much, up to the cap. */
  STREAK_STEP: 0.5,
  MAX_MULTIPLIER: 3,
  /** The aim shows this many seconds of the flight at first, and a little less with every lane, down to the minimum. */
  PREVIEW_START: 2.6,
  PREVIEW_STEP: 0.35,
  PREVIEW_MIN: 0.9,
  /** Seconds the lane rests after a cleared / failed lane before the next one appears. */
  PAUSE_CLEARED: 1.8,
  PAUSE_FAILED: 1.8,
  /** Seconds after being shot down before the hint to the lane appears. */
  TEASER_DELAY: 3,
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

/** Neighbour grace period: in a big game, nobody may snipe their nearest enemy while the round is young. */
export const GRACE = {
  /** Fewer ships than this and the nearest enemy is no real shortcut, so nothing is spared. */
  MIN_SHIPS: 4,
  /** The choices for how many of its first shots of a round each ship's pass through its nearest enemy (0 = off). */
  OPTIONS: [0, 1, 2] as readonly number[],
} as const;
