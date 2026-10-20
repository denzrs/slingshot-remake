import { AIM, GHOST, HORIZON, PHYSICS } from './config';
import { aimDirection, cloneWorld, normalizeAngle, Shot, type Planet, type PlanetStyle, type World } from './physics';
import { createRng, hashSeed, intRange, pick, range, type Rng } from './rng';
import { TINTS } from './world';

/**
 * The ghost lane: planet smasher. A small field of rocks, bombs and a few planets; one shot blows up
 * whatever it touches, every blast sets off its neighbours a moment later, and a shot that ends on a
 * planet blows the planet up — and with it the gravity it bent shots with. A lane is cleared when every
 * glowing core is gone.
 *
 * Everything here is a pure function of a seed, so every ghost of a round flies the very same lanes — and
 * the seed is derived from the round's world, which every screen has, so nothing needs to travel the network.
 */

/** The seed all screens of one round share: the round number and the world as it was dealt. */
export function ghostSeed(round: number, world: World): number {
  return hashSeed('slingshot-ghost', round, ...world.planets.map((p) => p.seed), ...world.ships.map((s) => `${Math.round(s.x)},${Math.round(s.y)}`));
}

export type RockKind = 'rock' | 'bomb' | 'gold';

export interface Rock {
  id: number;
  x: number;
  y: number;
  r: number;
  kind: RockKind;
  /** A glowing core: the lane is cleared when all of them are gone. */
  core: boolean;
  alive: boolean;
}

export interface Aim {
  angle: number;
  power: number;
}

/** A lane as dealt: the world (ship 0 is the ghost), the rocks, and for every cluster of rocks a shot that is known to go through it. */
export interface Layout {
  world: World;
  rocks: Rock[];
  solutions: Aim[];
}

const ROUND = (n: number) => Math.round(n * 100) / 100;
const radiusOf = (kind: RockKind) => (kind === 'bomb' ? GHOST.BOMB_R : kind === 'gold' ? GHOST.GOLD_R : GHOST.ROCK_R);

/** Number of clusters of rocks in lane `n` — a few more later on, never more than there are shots to spare. */
export function clusterCount(n: number): number {
  return Math.min(GHOST.SHOTS - 1, 3 + Math.floor(n / 4));
}

/** Whether lane `n` has a black hole: every fourth. */
export const hasHole = (n: number): boolean => n % 4 === 3;

/** Seconds of the flight the aim shows in lane `n`. */
export function previewSeconds(n: number): number {
  return Math.max(GHOST.PREVIEW_MIN, GHOST.PREVIEW_START - GHOST.PREVIEW_STEP * n);
}

/** The path of a probe shot, as flat [x, y, …] every few steps; null when it ends on a planet or in the hole (those blow things up and change the world). */
function probe(world: World, aim: Aim): number[] | null {
  const shot = new Shot(world, 0, aim.angle, aim.power, { bounce: false, timeLimit: GHOST.FLIGHT_TIME }, false, [0]);
  const path: number[] = [];
  for (let i = 0; !shot.end && i < GHOST.FLIGHT_TIME / PHYSICS.DT; i++) {
    shot.step();
    if (i % 6 === 0 && shot.inField) path.push(shot.x, shot.y);
  }
  return shot.end?.kind === 'planet' || shot.end?.kind === 'hole' ? null : path;
}

/**
 * Deals lane `n` of a seed. The rocks sit in clusters, each laid out around a point of a probe shot's
 * path, so every cluster has a known way in; the rocks of a cluster are close enough for a blast to
 * reach the next one, so one touch sets off all of them — save for a straggler or two that only a bomb
 * reaches. The cores are always part of the chain.
 */
export function buildLane(seed: number, n: number): Layout {
  const rng = createRng(hashSeed('slingshot-ghost-lane', seed, n));
  const { WIDTH: width, HEIGHT: height } = GHOST;
  const ship = { x: range(rng, 70, 140), y: range(rng, 110, height - 110), alive: true };
  const world: World = { width, height, planets: [], ships: [ship], holes: [], nebulae: [], wormholes: [], defenses: [], version: 0 };

  if (hasHole(n)) {
    world.holes.push({ x: range(rng, width * 0.45, width * 0.7), y: range(rng, height * 0.3, height * 0.7), radius: HORIZON.START_RADIUS + 6, mass: HORIZON.START_MASS });
  }
  const planetCount = n === 0 ? intRange(rng, 1, 2) : n < 3 ? 2 : intRange(rng, 2, 3);
  const big = Math.min(n, 6) * 3;
  for (let attempt = 0; world.planets.length < planetCount && attempt < 200; attempt++) {
    const radius = 20 + big + 22 * Math.pow(rng(), 1.3);
    const x = range(rng, 230, width - 80);
    const y = range(rng, radius + 40, height - radius - 40);
    if (Math.hypot(x - ship.x, y - ship.y) < radius + 120) continue;
    if (world.planets.some((p) => Math.hypot(p.x - x, p.y - y) < p.radius + radius + 40)) continue;
    if (world.holes.some((h) => Math.hypot(h.x - x, h.y - y) < radius + h.radius + 110)) continue;
    const style: PlanetStyle = radius > 38 ? pick(rng, ['gas', 'gas', 'rocky', 'ice']) : pick(rng, ['rocky', 'rocky', 'ice']);
    world.planets.push({ x, y, radius, mass: range(rng, 0.75, 1.3) * radius ** 3, seed: Math.floor(rng() * 2 ** 31), style, tint: pick(rng, TINTS[style]) });
  }

  const rocks: Rock[] = [];
  const solutions: Aim[] = [];
  const centers: { x: number; y: number }[] = [];
  const count = clusterCount(n);
  for (let attempt = 0; centers.length < count && attempt < 400; attempt++) {
    const aim: Aim = { angle: normalizeAngle(ROUND(range(rng, -50, 50))), power: ROUND(range(rng, 30, 90)) };
    const path = probe(world, aim);
    if (!path || path.length < 40) continue;
    // Somewhere in the middle of the flight.
    const i = intRange(rng, Math.floor((path.length / 2) * 0.3), Math.floor((path.length / 2) * 0.9) - 1);
    const x = path[i * 2];
    const y = path[i * 2 + 1];
    if (x < 90 || x > width - 70 || y < 60 || y > height - 60 || Math.hypot(x - ship.x, y - ship.y) < 170) continue;
    if (world.planets.some((p) => Math.hypot(p.x - x, p.y - y) < p.radius + 62)) continue;
    if (world.holes.some((h) => Math.hypot(h.x - x, h.y - y) < h.radius + 90)) continue;
    if (centers.some((c) => Math.hypot(c.x - x, c.y - y) < 190)) continue;
    centers.push({ x, y });
    solutions.push(aim);
    growCluster(rng, world, rocks, { x, y }, centers.length - 1, n);
  }
  return { world, rocks, solutions };
}

/** Lays out one cluster around `at`, the first rock exactly there, and appends it to `rocks`. */
function growCluster(rng: Rng, world: World, rocks: Rock[], at: { x: number; y: number }, index: number, n: number): void {
  const members: Rock[] = [];
  const free = (x: number, y: number, r: number): boolean =>
    x > 40 + r && x < world.width - 40 - r && y > 40 + r && y < world.height - 40 - r &&
    Math.hypot(x - world.ships[0].x, y - world.ships[0].y) > 100 &&
    world.planets.every((p) => Math.hypot(p.x - x, p.y - y) > p.radius + r + 8) &&
    world.holes.every((h) => Math.hypot(h.x - x, h.y - y) > h.radius + r + 40) &&
    rocks.every((o) => Math.hypot(o.x - x, o.y - y) > o.r + r + 4);
  const add = (x: number, y: number, kind: RockKind): Rock => {
    const rock: Rock = { id: rocks.length, x: ROUND(x), y: ROUND(y), r: radiusOf(kind), kind, core: false, alive: true };
    rocks.push(rock);
    members.push(rock);
    return rock;
  };
  add(at.x, at.y, 'rock');

  // The body: each rock close enough to its neighbour for a blast to carry on.
  const size = intRange(rng, 5, 7);
  const bombAt = index % 2 === 1 || n >= 4 ? intRange(rng, 1, size - 1) : -1;
  for (let attempt = 0; members.length < size && attempt < 120; attempt++) {
    const from = members[Math.floor(rng() * members.length)];
    const a = rng() * Math.PI * 2;
    const d = range(rng, 34, 44);
    const kind: RockKind = members.length === bombAt ? 'bomb' : 'rock';
    const x = from.x + Math.cos(a) * d;
    const y = from.y + Math.sin(a) * d;
    if (free(x, y, radiusOf(kind))) add(x, y, kind);
  }

  // The farthest ones from the way in are the cores (one in an early lane, two later): the chain has to carry through to them.
  const body = members.filter((m) => m.kind === 'rock' && m !== members[0]);
  body.sort((a, b) => Math.hypot(b.x - at.x, b.y - at.y) - Math.hypot(a.x - at.x, a.y - at.y));
  for (const core of body.slice(0, n >= 2 ? 2 : 1)) core.core = true;
  if (!members.some((m) => m.core)) members[0].core = true;

  // Stragglers just out of a rock's reach — a bomb gets them — and, in the first clusters, the golden rock.
  const reach = GHOST.BLAST.rock + GHOST.ROCK_R;
  const stragglers = intRange(rng, 1, 2);
  for (let k = 0, attempt = 0; k < stragglers && attempt < 80; attempt++) {
    const from = members[Math.floor(rng() * members.length)];
    const a = rng() * Math.PI * 2;
    const d = range(rng, reach + 6, reach + 18);
    const x = from.x + Math.cos(a) * d;
    const y = from.y + Math.sin(a) * d;
    const kind: RockKind = index === 0 && k === 0 ? 'gold' : 'rock';
    if (free(x, y, radiusOf(kind))) {
      add(x, y, kind);
      k++;
    }
  }
}

// ————————————————————————————— The lane —————————————————————————————

/** Physics steps between two recorded trail points. */
const TRAIL_EVERY = 6;
/** Seconds after which a blown-out chain is cut short, should something go wrong. */
const RESOLVE_LIMIT = 12;

export type LanePhase = 'aiming' | 'flying' | 'cleared' | 'failed';

export interface LaneResult {
  /** Rises with every shot, so a screen can tell a new result from one it already showed. */
  id: number;
  /** `dud` blew up nothing, `boom` something, `chain` a long chain; `cleared` and `out` end the lane. */
  kind: 'dud' | 'boom' | 'chain' | 'cleared' | 'out';
  /** What the shot earned, and — on a cleared lane — what the clearing earned on top. */
  points: number;
  bonus: number;
  /** Things the shot blew up, and the planets among them. */
  destroyed: number;
  planets: number;
  swingbys: number;
  /** Lanes cleared in a row, this one included. */
  streak: number;
  multiplier: number;
  /** Everything on the lane went up. */
  perfect: boolean;
  /** Picks one of a few sayings, the same for everybody. */
  quip: number;
}

/** Something blew up: the panel turns these into fire, debris and noise. */
export interface LaneEvent {
  /** Rises with every event. */
  id: number;
  kind: RockKind | 'planet';
  x: number;
  y: number;
  /** How far the blast reaches. */
  blast: number;
  /** The n-th thing this shot has blown up. */
  n: number;
  /** A planet's own size and tint, for its wreckage. */
  radius: number;
  tint: string;
  /** Went up close to the black hole. */
  fed: boolean;
}

/** What waits to go off: a rock or a planet, and when. */
interface Fuse {
  planet: boolean;
  index: number;
  at: number;
  seq: number;
}

export class GhostLane {
  /** 0-based number of the lane on the range. */
  lane = 0;
  score = 0;
  /** Lanes cleared in a row; a lane lost resets it. */
  streak = 0;
  bestStreak = 0;
  cleared = 0;
  phase: LanePhase = 'aiming';
  angle = 0;
  power: number = AIM.DEFAULT_POWER;
  /** Shots fired on this lane. */
  shots = 0;
  result: LaneResult | null = null;
  /** The shot in the air, and the paths of this lane's earlier shots (flat [x, y, …]). */
  shot: Shot | null = null;
  path: number[] = [];
  oldPaths: number[][] = [];
  world!: World;
  rocks: Rock[] = [];
  /** The aims that go through each cluster of this lane. */
  solutions: Aim[] = [];
  /** Things the current shot has blown up so far, and when (seconds into the lane) the last one went. */
  combo = 0;
  comboAt = -Infinity;
  /** Seconds since the lane was dealt, for the effects. */
  clock = 0;
  /** What blew up since the panel last looked. */
  events: LaneEvent[] = [];

  private pause = 0;
  private budget = 0;
  private simTime = 0;
  private fuses: Fuse[] = [];
  private primed = new Set<string>();
  private seq = 0;
  private eventId = 0;
  private resultId = 0;
  private raw = 0;
  private planetsBlown = 0;
  private endedAt = 0;
  private previewKey = '';
  private previewCache: number[] = [];

  constructor(readonly seed: number) {
    this.build();
  }

  get shotsLeft(): number {
    return GHOST.SHOTS - this.shots;
  }

  get canAim(): boolean {
    return this.phase === 'aiming';
  }

  /** The multiplier the lane's shots earn: what the next lane cleared in a row would be worth. */
  get multiplier(): number {
    return multiplierFor(this.streak + 1);
  }

  /** Cores still standing. */
  get coresLeft(): number {
    return this.rocks.filter((r) => r.alive && r.core).length;
  }

  get coresTotal(): number {
    return this.rocks.filter((r) => r.core).length;
  }

  adjust(dAngle: number, dPower: number): void {
    this.setAim(this.angle + dAngle, this.power + dPower);
  }

  setAim(angle: number, power: number): void {
    if (!this.canAim) return;
    this.angle = normalizeAngle(Math.round(angle * 100) / 100);
    this.power = Math.max(AIM.MIN_POWER, Math.min(AIM.MAX_POWER, Math.round(power * 100) / 100));
  }

  fire(): boolean {
    if (!this.canAim) return false;
    this.shots++;
    this.shot = new Shot(this.world, 0, this.angle, this.power, { bounce: false, timeLimit: GHOST.FLIGHT_TIME }, 'metrics', [0]);
    this.path = [this.shot.x, this.shot.y];
    this.budget = 0;
    this.combo = 0;
    this.raw = 0;
    this.planetsBlown = 0;
    this.fuses = [];
    this.primed.clear();
    this.endedAt = 0;
    this.phase = 'flying';
    return true;
  }

  /** Whether a rock has been set off and is about to go: the panel makes it flicker. */
  isLit(rock: Rock): boolean {
    return rock.alive && this.primed.has(`r${rock.id}`);
  }

  /** Takes what blew up since the last call. */
  takeEvents(): LaneEvent[] {
    const events = this.events;
    this.events = [];
    return events;
  }

  /** The first stretch of the flight the current aim would fly, as flat [x, y, …]: the aim's help, shorter with every lane. */
  preview(): readonly number[] {
    const key = `${this.angle}|${this.power}|${this.world.planets.map((p) => p.radius).join(',')}|${this.lane}`;
    if (key === this.previewKey) return this.previewCache;
    this.previewKey = key;
    const seconds = previewSeconds(this.lane);
    const shot = new Shot(this.world, 0, this.angle, this.power, { bounce: false, timeLimit: seconds }, false, [0]);
    const out = [shot.x, shot.y];
    for (let i = 0; !shot.end && i < seconds / PHYSICS.DT; i++) {
      shot.step();
      if (i % 4 === 0) out.push(shot.x, shot.y);
    }
    this.previewCache = out;
    return out;
  }

  update(dt: number): void {
    this.clock += dt;
    if (this.phase === 'flying' && this.shot) {
      this.budget += (dt * GHOST.SPEED) / PHYSICS.DT;
      while (this.budget >= 1 && this.phase === 'flying') {
        this.budget--;
        this.tick();
      }
    } else if (this.phase === 'cleared' || this.phase === 'failed') {
      this.pause -= dt;
      if (this.pause <= 0) this.next();
    }
  }

  // ————————————————————————————— One step of the simulation —————————————————————————————

  private tick(): void {
    const shot = this.shot!;
    this.simTime += PHYSICS.DT;
    if (!shot.end) {
      const end = shot.step();
      this.trail(shot);
      for (const rock of this.rocks) {
        if (!rock.alive || this.primed.has(`r${rock.id}`)) continue;
        const reach = rock.r + GHOST.SHOT_R;
        if ((rock.x - shot.x) ** 2 + (rock.y - shot.y) ** 2 < reach * reach) this.light(false, rock.id, 0);
      }
      if (end) {
        this.path.push(shot.x, shot.y);
        this.endedAt = this.simTime;
        // Ending on a planet blows it up.
        if (end.kind === 'planet') this.light(true, end.planet, 0);
      }
    }
    this.burn();
    if (shot.end && this.fuses.length === 0) this.settle();
    else if (shot.end && this.simTime - this.endedAt > RESOLVE_LIMIT) this.settle();
  }

  private trail(shot: Shot): void {
    if (Math.round(shot.time / PHYSICS.DT) % TRAIL_EVERY === 0) this.path.push(shot.x, shot.y);
  }

  /** Sets a fuse: the rock or planet goes up `delay` seconds from now. */
  private light(planet: boolean, index: number, delay: number): void {
    const key = `${planet ? 'p' : 'r'}${index}`;
    if (this.primed.has(key)) return;
    this.primed.add(key);
    this.fuses.push({ planet, index, at: this.simTime + delay, seq: this.seq++ });
    this.fuses.sort((a, b) => a.at - b.at || a.seq - b.seq);
  }

  /** Lets off whatever is due. */
  private burn(): void {
    while (this.fuses.length && this.fuses[0].at <= this.simTime) {
      const fuse = this.fuses.shift()!;
      if (fuse.planet) this.blowPlanet(fuse.index);
      else this.blowRock(this.rocks[fuse.index]);
    }
  }

  private blowRock(rock: Rock): void {
    rock.alive = false;
    const fed = this.world.holes.some((hole) => Math.hypot(hole.x - rock.x, hole.y - rock.y) < GHOST.FEED_RADIUS);
    const blast = GHOST.BLAST[rock.kind];
    this.pay(GHOST.BASE[rock.kind] + (fed ? GHOST.FEED : 0));
    this.events.push({ id: ++this.eventId, kind: rock.kind, x: rock.x, y: rock.y, blast, n: this.combo, radius: rock.r, tint: '', fed });
    // The blast carries on to what is within reach — the next rock along, a bomb's wider ring catching the stragglers.
    for (const other of this.rocks) {
      if (!other.alive) continue;
      const d = Math.hypot(other.x - rock.x, other.y - rock.y);
      if (d < blast + other.r) this.light(false, other.id, GHOST.FUSE + d * GHOST.FUSE_PER_PX);
    }
  }

  private blowPlanet(index: number): void {
    const p: Planet = this.world.planets[index];
    if (p.radius <= 0) return;
    const blast = p.radius * GHOST.PLANET_BLAST + GHOST.PLANET_BLAST_FLAT;
    const wreck = { radius: p.radius, tint: p.tint, x: p.x, y: p.y };
    // Gone, and its gravity with it.
    p.mass = 0;
    p.radius = 0;
    this.world.version++;
    this.planetsBlown++;
    this.pay(GHOST.BASE.planet);
    this.events.push({ id: ++this.eventId, kind: 'planet', x: wreck.x, y: wreck.y, blast, n: this.combo, radius: wreck.radius, tint: wreck.tint, fed: false });
    for (const other of this.rocks) {
      if (!other.alive) continue;
      const d = Math.hypot(other.x - wreck.x, other.y - wreck.y);
      if (d < blast + other.r) this.light(false, other.id, GHOST.FUSE + d * GHOST.FUSE_PER_PX);
    }
    // A planet's blast also takes the planets around it.
    this.world.planets.forEach((other, i) => {
      if (other.radius <= 0) return;
      const d = Math.hypot(other.x - wreck.x, other.y - wreck.y);
      if (d < blast + other.radius) this.light(true, i, GHOST.FUSE * 2 + d * GHOST.FUSE_PER_PX);
    });
  }

  /** The n-th thing this shot blows up pays more than the one before. */
  private pay(base: number): void {
    this.combo++;
    this.comboAt = this.clock;
    this.raw += base * Math.min(GHOST.COMBO_MAX, 1 + GHOST.COMBO_STEP * (this.combo - 1));
  }

  // ————————————————————————————— After the shot —————————————————————————————

  /** The shot is over and everything it set off has gone: pay it out and decide what happens to the lane. */
  private settle(): void {
    const shot = this.shot!;
    const swingbys = shot.swingbys;
    this.oldPaths.push(this.path);
    this.shot = null;
    const chain = GHOST.CHAINS.find(([n]) => this.combo >= n)?.[1] ?? 0;
    const points = this.combo ? Math.round((this.raw * (1 + GHOST.SWINGBY * swingbys) * this.multiplier) / 10) * 10 + chain : 0;
    this.score += points;
    const quip = Math.floor(createRng(hashSeed(this.seed, this.lane, this.shots))() * 997);
    const base = { points, bonus: 0, destroyed: this.combo, planets: this.planetsBlown, swingbys, perfect: false, quip };

    if (this.coresLeft === 0) {
      const perfect = this.rocks.every((r) => !r.alive);
      const bonus = GHOST.CLEAR + GHOST.SPARE_SHOT * this.shotsLeft + (perfect ? GHOST.PERFECT : 0);
      this.score += bonus;
      this.streak++;
      this.bestStreak = Math.max(this.bestStreak, this.streak);
      this.cleared++;
      this.result = { id: ++this.resultId, kind: 'cleared', ...base, points: points + bonus, bonus, perfect, streak: this.streak, multiplier: this.multiplier };
      this.phase = 'cleared';
      this.pause = GHOST.PAUSE_CLEARED;
      return;
    }
    if (this.shotsLeft <= 0) {
      this.streak = 0;
      this.result = { id: ++this.resultId, kind: 'out', ...base, streak: 0, multiplier: this.multiplier };
      this.phase = 'failed';
      this.pause = GHOST.PAUSE_FAILED;
      return;
    }
    const kind = this.combo >= 6 ? 'chain' : this.combo > 0 ? 'boom' : 'dud';
    this.result = { id: ++this.resultId, kind, ...base, streak: this.streak, multiplier: this.multiplier };
    this.phase = 'aiming';
  }

  private next(): void {
    this.lane++;
    this.build();
  }

  private build(): void {
    const layout = buildLane(this.seed, this.lane);
    this.world = cloneWorld(layout.world);
    this.rocks = layout.rocks;
    this.solutions = layout.solutions;
    const from = this.world.ships[0];
    // Start facing the first cluster, like a ship in the real game faces the middle.
    const first = this.rocks[0];
    this.angle = first ? normalizeAngle(Math.round((Math.atan2(from.y - first.y, first.x - from.x) * 180) / Math.PI)) : 0;
    this.power = AIM.DEFAULT_POWER;
    this.shots = 0;
    this.shot = null;
    this.path = [];
    this.oldPaths = [];
    this.fuses = [];
    this.primed.clear();
    this.events = [];
    this.combo = 0;
    this.comboAt = -Infinity;
    this.clock = 0;
    this.phase = 'aiming';
    this.previewKey = '';
  }

  /** The direction the ghost looks, for its eyes. */
  get look(): { x: number; y: number } {
    return aimDirection(this.angle);
  }
}

/** The multiplier of the `streak`-th lane cleared in a row. */
export function multiplierFor(streak: number): number {
  return Math.min(GHOST.MAX_MULTIPLIER, 1 + GHOST.STREAK_STEP * Math.max(0, streak - 1));
}
