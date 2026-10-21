import { AIM, CHALLENGE, FIELD, NEBULA, SCORING } from './config';
import { Shot, simulateShot, type Planet, type Ship, type ShotEnd, type ShotRules, type World } from './physics';
import { POWER_UP } from './powerups';
import { createRng, hashSeed, pick, range, shuffle, type Rng } from './rng';
import { generateWorld } from './world';

/**
 * The daily challenge: five sectors, each a fresh battlefield with stationary targets, the same for
 * everyone on a given calendar day. Everything here is a pure function of the date, so two players
 * on two continents fly exactly the same run — which is what makes comparing scores meaningful.
 *
 * Targets are placed by flying a random probe shot from the player's ship and parking the target on
 * its path. Every target therefore has at least one known solution, however nasty the layout.
 */

// ————————————————————————————— Calendar —————————————————————————————

/** Local calendar day as YYYY-MM-DD. The challenge follows the player's own midnight, like Wordle. */
export function dateKey(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function isDateKey(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** The day `days` after (or before) `key`. */
export function shiftDate(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
}

function dayIndex(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

export function challengeNumber(key: string): number {
  return dayIndex(key) - dayIndex(CHALLENGE.EPOCH) + 1;
}

/** 0 = Monday … 6 = Sunday. */
export function weekday(key: string): number {
  return (((dayIndex(key) + 3) % 7) + 7) % 7;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

// ————————————————————————————— Themes —————————————————————————————

export type ThemeId = 'classic' | 'billiard' | 'blind' | 'singularity' | 'heavy' | 'precision' | 'sniper' | 'bastion' | 'murk' | 'hammerhead' | 'skewer';

/** The seven themes of the first weeks: days before `VARIANTS_FROM` keep their old rotation, so no past or running day changes. */
const CLASSIC_THEMES: readonly ThemeId[] = ['classic', 'billiard', 'blind', 'singularity', 'heavy', 'precision', 'sniper'];

export const THEMES: readonly ThemeId[] = [...CLASSIC_THEMES, 'bastion', 'murk', 'hammerhead', 'skewer'];

/** Challenge #21 (2026-10-22), the first day with the flak, nebula and ammo variations. */
const VARIANTS_FROM = 21;

/** What the pilot's shots are made of in a sector: plasma (hard to bend, ignores clouds) or armor piercing (flies through ships). */
export type Ammo = 'plasma' | 'piercing';

/** Per-sector rule twists a theme can switch on. `from` = first sector index (0-based) it may appear in. */
interface Rate {
  from: number;
  p: number;
}

interface ThemeRule {
  bounce?: Rate;
  invisible?: Rate;
  fixedPower?: Rate;
  hole?: Rate;
  heavy?: Rate;
  /** A flak cannon (a planetary defense on the targets' side) guards a planet. */
  flak?: Rate;
  /** A nebula cloud lies over the field. */
  nebula?: Rate;
  /** Every shot of the pilot is of this kind. */
  ammo?: { kind: Ammo; from: number };
  /** One more target than usual from sector 2 on, with one spare shot less (but always at least one). */
  sniper?: boolean;
}

const THEME_RULES: Record<ThemeId, ThemeRule> = {
  classic: { bounce: { from: 2, p: 0.25 }, fixedPower: { from: 1, p: 0.2 }, heavy: { from: 2, p: 0.25 }, hole: { from: 3, p: 0.2 } },
  billiard: { bounce: { from: 1, p: 1 } },
  blind: { invisible: { from: 2, p: 1 } },
  singularity: { hole: { from: 2, p: 1 } },
  heavy: { heavy: { from: 1, p: 1 } },
  precision: { fixedPower: { from: 1, p: 1 } },
  sniper: { sniper: true, bounce: { from: 3, p: 0.3 } },
  bastion: { flak: { from: 1, p: 1 } },
  murk: { nebula: { from: 1, p: 1 } },
  hammerhead: { ammo: { kind: 'plasma', from: 1 } },
  skewer: { ammo: { kind: 'piercing', from: 1 } },
};

/** Classic dailies from the variations on may spice a sector with a flak cannon or a cloud, never with fixed ammo. */
const CLASSIC_VARIANTS: Pick<ThemeRule, 'flak' | 'nebula'> = { nebula: { from: 1, p: 0.2 }, flak: { from: 3, p: 0.25 } };

/**
 * One theme per day, every theme once per cycle of seven days in a seeded order — an even
 * spread instead of the clumps pure randomness gives — and never the same theme twice in a row.
 */
export function themeFor(number: number): ThemeId {
  // The days up to the variations keep the old seven-day cycles, so nobody's past (or today's) challenge changes.
  if (number < VARIANTS_FROM) return cycleTheme(number - 1, CLASSIC_THEMES, 'slingshot-themes');
  return cycleTheme(number - VARIANTS_FROM, THEMES, 'slingshot-themes-v2');
}

function cycleTheme(idx: number, themes: readonly ThemeId[], salt: string): ThemeId {
  const n = themes.length;
  const cycle = Math.floor(idx / n);
  const pos = ((idx % n) + n) % n;
  const order = cycleOrder(cycle, themes, salt);
  // Don't open a cycle with the theme that closed the last one (only ever touches the first two slots).
  if (order[0] === cycleOrder(cycle - 1, themes, salt)[n - 1]) [order[0], order[1]] = [order[1], order[0]];
  return order[pos];
}

function cycleOrder(cycle: number, themes: readonly ThemeId[], salt: string): ThemeId[] {
  return shuffle(createRng(hashSeed(salt, cycle)), themes);
}

// ————————————————————————————— Sector specs —————————————————————————————

type Difficulty = 1 | 2 | 3 | 4 | 5;
type Modifier = 'bounce' | 'invisible' | 'fixedPower' | 'hole' | 'heavy' | 'flak' | 'nebula' | 'plasma' | 'piercing';

export interface SectorSpec {
  index: number;
  seed: number;
  difficulty: Difficulty;
  targets: number;
  /** Planet count is drawn from this range. */
  planets: [min: number, max: number];
  /** Shots the player gets for the whole sector. */
  shots: number;
  bounce: boolean;
  invisible: boolean;
  fixedPower: boolean;
  /** A black hole sits in the middle (it does not grow, unlike Event Horizon). */
  hole: boolean;
  /** Planet mass multiplier. */
  gravity: number;
  /** A flak cannon on one planet shoots at the pilot's shots, never at the targets' (it is not a target itself). */
  flak: boolean;
  /** Clouds on the field: they slow a shot and bend it harder. */
  nebulae: number;
  /** The pilot has only this kind of shot. */
  ammo: Ammo | null;
}

export interface Challenge {
  dateKey: string;
  number: number;
  theme: ThemeId;
  sectors: SectorSpec[];
}

/** Difficulty curve over the five sectors, shifted by the day of the week: gentle Monday, spicy weekend. */
const CURVE: Difficulty[] = [1, 2, 3, 3, 4];
const WEEKDAY_TILT = [-1, -1, 0, 0, 0, 1, 1];

const PLANETS: Record<Difficulty, [number, number]> = { 1: [2, 3], 2: [3, 4], 3: [3, 5], 4: [4, 6], 5: [5, 7] };
/** Shots on top of one per target. */
const SLACK: Record<Difficulty, number> = { 1: 3, 2: 3, 3: 2, 4: 2, 5: 1 };
const HEAVY = 1.7;

export function dailyChallenge(key: string): Challenge {
  const number = challengeNumber(key);
  const theme = themeFor(number);
  const tilt = WEEKDAY_TILT[weekday(key)];
  const rng = createRng(hashSeed('slingshot-daily', key));
  const sectors = Array.from({ length: CHALLENGE.SECTORS }, (_, i) => {
    const difficulty = Math.min(5, Math.max(1, CURVE[i] + tilt)) as Difficulty;
    return sectorSpec(ruleOf(theme, number), i, difficulty, rng, hashSeed('slingshot-sector', key, i));
  });
  return { dateKey: key, number, theme, sectors };
}

function ruleOf(theme: ThemeId, number: number): ThemeRule {
  return theme === 'classic' && number >= VARIANTS_FROM ? { ...THEME_RULES.classic, ...CLASSIC_VARIANTS } : THEME_RULES[theme];
}

function sectorSpec(rule: ThemeRule, index: number, difficulty: Difficulty, rng: Rng, seed: number): SectorSpec {
  // Always draw the same number of values, so one sector's choices never shift another's.
  const roll = { bounce: rng(), invisible: rng(), fixedPower: rng(), hole: rng(), heavy: rng(), extra: rng() };
  const on = (rate: Rate | undefined, r: number) => !!rate && index >= rate.from && r < rate.p;

  const invisible = on(rule.invisible, roll.invisible);
  // A hidden hole would hide planets and hole alike — that is cruel, not clever.
  const hole = !invisible && on(rule.hole, roll.hole);
  const bounce = on(rule.bounce, roll.bounce);
  const fixedPower = on(rule.fixedPower, roll.fixedPower);
  const heavy = on(rule.heavy, roll.heavy);
  // The variations roll on a stream of their own, so adding them never shifts the dice of the older rules.
  const variant = createRng(hashSeed(seed, 'variants'));
  const rollFlak = variant();
  const rollNebula = variant();
  // A cannon on a hidden planet would be a cannon out of nowhere — cruel, not clever.
  const flak = !invisible && on(rule.flak, rollFlak);
  const nebulae = on(rule.nebula, rollNebula) ? 1 + +(difficulty >= 4) : 0;
  const ammo = rule.ammo && index >= rule.ammo.from ? rule.ammo.kind : null;

  let targets = { 1: 1, 2: 1 + +(roll.extra < 0.4), 3: 1 + +(roll.extra < 0.6), 4: 2, 5: 2 + +(roll.extra < 0.5) }[difficulty];
  let slack = SLACK[difficulty];
  if (rule.sniper && index >= 1) {
    targets = Math.min(3, targets + 1);
    // Tight, but never without a spare shot: one mistake is allowed.
    slack = Math.max(1, slack - 1);
  }

  // Armor piercing rewards lining targets up: from the middle of the run there are always at least two.
  if (ammo === 'piercing' && index >= 2) targets = Math.min(3, Math.max(2, targets));

  let planets = PLANETS[difficulty];
  if (invisible) planets = [2, Math.min(4, planets[1])];
  if (hole) planets = [Math.max(2, planets[0] - 1), Math.max(3, planets[1] - 2)];

  return { index, seed, difficulty, targets, planets, shots: targets + slack, bounce, invisible, fixedPower, hole, gravity: heavy ? HEAVY : 1, flak, nebulae, ammo };
}

export function modifiersOf(spec: SectorSpec): Modifier[] {
  const out: Modifier[] = [];
  if (spec.bounce) out.push('bounce');
  if (spec.invisible) out.push('invisible');
  if (spec.fixedPower) out.push('fixedPower');
  if (spec.hole) out.push('hole');
  if (spec.gravity > 1) out.push('heavy');
  if (spec.flak) out.push('flak');
  if (spec.nebulae) out.push('nebula');
  if (spec.ammo === 'plasma') out.push('plasma');
  if (spec.ammo === 'piercing') out.push('piercing');
  return out;
}

export function sectorRules(spec: SectorSpec): ShotRules {
  return { bounce: spec.bounce, timeLimit: CHALLENGE.FLIGHT_TIME };
}

/** What the pilot fires in a sector: the rules of the flight, and the kind of shot. */
interface Load {
  rules: ShotRules;
  pierce: boolean;
  heavy: boolean;
}

const loadOf = (spec: SectorSpec): Load => ({ rules: sectorRules(spec), pierce: spec.ammo === 'piercing', heavy: spec.ammo === 'plasma' });

// ————————————————————————————— Ranking —————————————————————————————

/** Score of a flawless-but-plain run: every target on the first try, no trick shots, gentle power factor of 1. */
export function baselineScore(challenge: Challenge): number {
  return challenge.sectors.reduce((sum, s) => sum + s.targets * SCORING.BASE + CHALLENGE.CLEAR_BONUS, 0);
}

/** 0 (cadet) … 5 (gravity master). */
export function rankOf(score: number, challenge: Challenge): number {
  const share = score / baselineScore(challenge);
  let rank = 0;
  CHALLENGE.RANKS.forEach((min, i) => {
    if (share >= min) rank = i;
  });
  return rank;
}

// ————————————————————————————— Building a sector —————————————————————————————

/** A known way to hit one target: proof that the sector can be solved. */
interface Solution {
  /** Index into `world.ships`. */
  target: number;
  angle: number;
  power: number;
  /** Angle tolerance in degrees around the solution at the same power — how forgiving the shot is. */
  window: number;
  /** The straight line to the target is blocked by a planet. */
  blocked: boolean;
}

export interface Sector {
  spec: SectorSpec;
  /** Ship 0 is the player, the rest are targets. Treat as read-only; clone before playing. */
  world: World;
  solutions: Solution[];
}

/** Hardness each difficulty aims for — see `hardness()`. */
const AIM_HARDNESS: Record<Difficulty, number> = { 1: 0.9, 2: 2.3, 3: 3.7, 4: 4.9, 5: 5.9 };
const CANDIDATES = 36;
/** Narrower than this and a solution is a lottery ticket, not a skill shot. */
const MIN_WINDOW = 0.08;
/** Angle offsets (degrees) probed on each side of a solution to measure how forgiving it is. */
const WINDOW_PROBES = [0.01, 0.02, 0.04, 0.08, 0.16, 0.32, 0.64, 1.28, 2.56];
/** A target must be at least this far from every field edge, and below the HUD strip. */
const EDGE = 46;
const TOP = 96;

export function buildSector(spec: SectorSpec): Sector {
  // A bad layout (no valid placement at all) is vanishingly rare; the retry just keeps it deterministic.
  for (let salt = 0; salt < 8; salt++) {
    const sector = tryBuild(spec, spec.seed + salt);
    if (sector) return sector;
  }
  throw new Error(`Daily sector ${spec.index} (seed ${spec.seed}) has no valid layout`);
}

function tryBuild(spec: SectorSpec, seed: number): Sector | null {
  const world = generateWorld(seed, {
    minPlanets: spec.planets[0],
    maxPlanets: spec.planets[1],
    players: 1 + spec.targets,
    blackHole: spec.hole,
    teams: null,
  });
  for (const p of world.planets) p.mass *= spec.gravity;
  const load = loadOf(spec);
  const rng = createRng(hashSeed(seed, 'targets'));
  // The hazards go up before the targets, so every target is placed (and proven reachable) with them in the way.
  const hazards = createRng(hashSeed(seed, 'hazards'));
  if (spec.flak) raiseFlak(world, spec.targets, hazards);
  for (let i = 0; i < spec.nebulae; i++) raiseCloud(world, hazards);

  const ships: Ship[] = [world.ships[0]];
  const solutions: Solution[] = [];
  for (let i = 0; i < spec.targets; i++) {
    const placed = placeTarget(world, ships, solutions, spec, load, rng);
    if (!placed) return null;
    ships.push(placed.ship);
    solutions.push(placed.solution);
  }
  world.ships = ships;
  return { spec, world, solutions };
}

interface Placement {
  ship: Ship;
  solution: Solution;
}

function placeTarget(world: World, ships: Ship[], solved: Solution[], spec: SectorSpec, load: Load, rng: Rng): Placement | null {
  const index = ships.length;
  const want = AIM_HARDNESS[spec.difficulty];
  const me = ships[0];
  let best: (Placement & { miss: number }) | null = null;

  for (let attempt = 0; attempt < CANDIDATES; attempt++) {
    const power = spec.fixedPower ? AIM.FIXED_POWER : round2(range(rng, 28, 100));
    const angle = round2(rng() * 360);
    const path = tracePath({ ...world, ships }, angle, power, load);
    const spots = candidateSpots(world, ships, path);
    if (!spots.length) continue;

    for (let pick = 0; pick < 2; pick++) {
      const spot = spots[Math.floor(rng() * spots.length)];
      const ship: Ship = { x: spot.x, y: spot.y, alive: true };
      const all = [...ships, ship];
      // The new target must not shadow an earlier solution.
      if (!solved.every((s) => hits(world, all, s.angle, s.power, s.target, load))) continue;

      const blocked = lineBlocked(world, me, ship);
      const window = angleWindow(world, all, angle, power, index, load);
      if (window < MIN_WINDOW) continue;
      const miss = Math.abs(hardness(window, blocked, spot.curve) - want);
      if (!best || miss < best.miss) best = { ship, solution: { target: index, angle, power, window, blocked }, miss };
    }
    if (best && best.miss < 0.4) break;
  }
  return best;
}

interface Path {
  /** Flat [x, y] per physics step. */
  points: number[];
  /** Accumulated turn of the velocity up to each step, radians. */
  curve: number[];
}

/** Fly a probe from the player's ship and record where it goes. */
function tracePath(world: World, angle: number, power: number, { rules, pierce, heavy }: Load): Path {
  const shot = new Shot(world, 0, angle, power, rules, false, [], pierce, heavy);
  const points: number[] = [];
  const curve: number[] = [];
  let turned = 0;
  let end: ShotEnd | null = null;
  while (!end) {
    const hx = shot.vx;
    const hy = shot.vy;
    end = shot.step();
    const turn = Math.atan2(hx * shot.vy - hy * shot.vx, hx * shot.vx + hy * shot.vy);
    // A bounce flips the velocity — that is no gravity turn.
    if (Math.abs(turn) < 0.5) turned += Math.abs(turn);
    points.push(shot.x, shot.y);
    curve.push(turned);
  }
  // The last point is where the probe died (planet, ship, edge…) — never a place for a target.
  points.length -= 2;
  curve.length -= 1;
  return { points, curve };
}

/** Points along a probe path where a target would be fair: in the field, clear of everything, not right next door. */
function candidateSpots(world: World, ships: Ship[], path: Path): { x: number; y: number; curve: number }[] {
  const out: { x: number; y: number; curve: number }[] = [];
  const { planets, holes } = world;
  // Skip the first ~0.9 s of flight: a target that close is a straight shot at best.
  for (let i = 216; i < path.curve.length; i += 6) {
    const x = path.points[i * 2];
    const y = path.points[i * 2 + 1];
    if (x < EDGE || x > FIELD.width - EDGE || y < TOP || y > FIELD.height - EDGE) continue;
    if (planets.some((p) => Math.hypot(p.x - x, p.y - y) < p.radius + 28)) continue;
    if (holes.some((h) => Math.hypot(h.x - x, h.y - y) < h.radius + 70)) continue;
    if (ships.some((s, k) => Math.hypot(s.x - x, s.y - y) < (k === 0 ? 170 : 110))) continue;
    out.push({ x, y, curve: path.curve[i] });
  }
  return out;
}

/** Does the shot take the target down, and never its own ship? An armor-piercing one counts the ships it flies through. */
function hits(world: World, ships: Ship[], angle: number, power: number, target: number, { rules, pierce, heavy }: Load): boolean {
  const { end, pierced } = simulateShot({ ...world, ships }, 0, angle, power, rules, [], [], pierce, heavy);
  if (pierced.includes(0) || (end.kind === 'ship' && end.ship === 0)) return false;
  return (end.kind === 'ship' && end.ship === target) || pierced.includes(target);
}

/**
 * Angle tolerance of a solution in degrees. Probes offsets of doubling size on both sides and
 * keeps the last one that still hits without a gap, so the result is accurate to a factor of two.
 */
function angleWindow(world: World, ships: Ship[], angle: number, power: number, target: number, load: Load): number {
  const side = (dir: 1 | -1) => {
    let reach = 0;
    for (const off of WINDOW_PROBES) {
      if (!hits(world, ships, angle + dir * off, power, target, load)) break;
      reach = off;
    }
    return reach;
  };
  return side(1) + side(-1);
}

/** Does a planet sit on the straight line between two ships? */
function lineBlocked(world: World, a: Ship, b: Ship): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  return world.planets.some((p: Planet) => {
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
    return Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y) < p.radius + 8;
  });
}

/**
 * How nasty a shot is to find: every halving of the angle tolerance below 4° counts one, a planet
 * in the way adds more, and so does every half-turn of bending on the way.
 */
function hardness(window: number, blocked: boolean, curve: number): number {
  return Math.log2(4 / window) + (blocked ? 1.5 : 0) + curve / Math.PI;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Stands a flak cannon on one planet, on the side that faces the middle of the field. It belongs to the first
 * target and spares all of them; the pilot's own ship is spared its stray missiles, so a cannon never ends a run.
 */
function raiseFlak(world: World, targets: number, rng: Rng): void {
  if (!world.planets.length) return;
  const planet = pick(rng, world.planets);
  const toMiddle = Math.atan2(FIELD.height / 2 - planet.y, FIELD.width / 2 - planet.x);
  world.defenses.push({
    x: planet.x + Math.cos(toMiddle) * planet.radius,
    y: planet.y + Math.sin(toMiddle) * planet.radius,
    radius: planet.radius * POWER_UP.DEFENSE_RADIUS_SHARE,
    planet: planet.seed,
    owner: 1,
    protects: Array.from({ length: targets }, (_, i) => i + 1),
    spares: [0],
  });
}

/** Lays a cloud somewhere in the field, clear of the pilot's ship so the shot does not start inside it. */
function raiseCloud(world: World, rng: Rng): void {
  const me = world.ships[0];
  let spot = { x: FIELD.width / 2, y: FIELD.height / 2 };
  for (let attempt = 0; attempt < 40; attempt++) {
    const x = range(rng, NEBULA.RADIUS * 0.8, FIELD.width - NEBULA.RADIUS * 0.8);
    const y = range(rng, TOP + NEBULA.RADIUS * 0.4, FIELD.height - NEBULA.RADIUS * 0.8);
    spot = { x, y };
    if (Math.hypot(x - me.x, y - me.y) > NEBULA.RADIUS + 60 && world.nebulae.every((n) => Math.hypot(x - n.x, y - n.y) > NEBULA.RADIUS)) break;
  }
  world.nebulae.push({ ...spot, radius: NEBULA.RADIUS, seed: rng() });
}
