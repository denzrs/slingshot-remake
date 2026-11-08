import { PHYSICS } from './config';
import { Shot, planetDurability, type WhiteExit, type Missile, type ShotEnd, type ShotRules, type StormContactSnapshot, type StyleEvent, type World } from './physics';

export interface VolleyAim {
  player: number;
  angle: number;
  power: number;
  /** Ships this shot passes through unharmed. */
  spare?: number[];
  /** Shots of one splitter share a fan id: they start from the same muzzle and never cancel each other. */
  fan?: number;
  /** Armor piercing: the shot goes through ships instead of stopping on them (the armor-piercing power-up). */
  pierce?: boolean;
  /** Plasma: the shot is hard to bend and flies through clouds (the plasma power-up). */
  plasma?: boolean;
  /** A defense's missile that lost its shot and flies on as a shot of its own: the index of the shot it left. Made by the volley, never aimed. */
  stray?: number;
  /** Fusion: a shot two others melted into. Made by the volley, never aimed. */
  fused?: boolean;
  /** Fusion: the second player the melted shot belongs to, beside `player`. */
  partner?: number;
}

export interface VolleyShot {
  shot: Shot;
  owner: number;
  /** The splitter fan the shot belongs to, if any: the shots of one fan draw as one. */
  fan?: number;
  /** True for a shot that keeps travelling after it goes through a ship. */
  pierce?: boolean;
  /** True for a plasma shot. */
  plasma?: boolean;
  /** True for a defense's missile that lost its shot: it counts for the defense's owner, not as one of their shots. */
  stray?: boolean;
  /** Fusion: a shot two others melted into. */
  fused?: boolean;
  /** Fusion: the second player a melted shot belongs to (the first is `owner`). Both share what it scores. */
  partner?: number;
  /** Flat [x0, y0, x1, y1, …] polyline in field units. */
  trail: number[];
}

export interface VolleySnapshot {
  /** Identifies the Volley instance, so a receiver can tell "same flight, more trail" from "a new flight". */
  id: number;
  aims: VolleyAim[];
  steps: number;
  script?: VolleyScript[];
  shots: { owner: number; trail: number[]; x: number; y: number; vx: number; vy: number; time: number; end: ShotEnd | null; style: StyleEvent[] | null; fired?: boolean[]; missiles?: Missile[]; seed?: number; stormContacts?: StormContactSnapshot[]; armed?: boolean; stormUntil?: number; whiteExit?: WhiteExit }[];
}

/** Something done to a flight after it started, so a replay can do it at the same step: a split, or a shield put on or taken off. */
export type VolleyScript =
  | { at: number; kind: 'split'; index: number; fan: number; turns: number[] }
  | { at: number; kind: 'shield'; ship: number; on: boolean };

/**
 * The shot of the original aims that shot `index` branched off from, through any number of splits (the shot itself
 * if it is one of them). A replay has not made the forks yet at its start, so this is who it follows until then.
 */
export function shotSource(aims: number, script: readonly VolleyScript[], index: number): number {
  let next = aims;
  for (const entry of script) {
    if (entry.kind !== 'split') continue;
    if (index >= next && index < next + entry.turns.length) return shotSource(aims, script, entry.index);
    next += entry.turns.length;
  }
  return index;
}

export type VolleyEvent =
  | { type: 'end'; index: number; end: ShotEnd; x: number; y: number; vx: number; vy: number }
  | { type: 'reflect'; index: number; ship: number; x: number; y: number }
  /** An armor-piercing shot went through a ship: the ship is out, and the shot flies on. */
  | { type: 'pierce'; index: number; ship: number; x: number; y: number; vx: number; vy: number }
  /** An armor-piercing shot struck a planet next to a cannon and wrecked it. */
  | { type: 'wreck'; index: number; defense: number; x: number; y: number }
  | { type: 'style'; index: number; event: StyleEvent }
  /** A planetary defense fired a missile at the shot, which is at (x, y). */
  | { type: 'intercept'; index: number; defense: number; x: number; y: number }
  /** A defense's missile lost its shot at (x, y) and flies on. */
  | { type: 'interceptMiss'; index: number; defense: number; x: number; y: number }
  /** Trick Shots Only: the shot was armed at (x, y), and can kill from now on. */
  | { type: 'arm'; index: number; x: number; y: number }
  /** Trick Shots Only: an unarmed shot flew through a ship, which it only warned. */
  | { type: 'warn'; index: number; ship: number; x: number; y: number }
  /** Pinball: the shot came off a planet at (x, y). */
  | { type: 'bump'; index: number; planet: number; x: number; y: number; vx: number; vy: number }
  /** Unstable: shot `index` broke a planet (at x, y) open for good. */
  | { type: 'planetShatter'; index: number; x: number; y: number; radius: number; color: string }
  /** Fusion: shots `from` met and melted into shot `index`, at (x, y). */
  | { type: 'fusion'; index: number; from: [number, number]; x: number; y: number }
  /** Loop edge: the shot was carried across the field `count` times in one step. */
  | { type: 'loop'; index: number; count: number }
  /** White Hole: a black hole sent the shot back `count` times in one step. */
  | { type: 'whiteHole'; index: number; count: number };

const TRAIL_EVERY = 2;
let nextVolleyId = 1;

/**
 * Any number of shots in flight at once, advanced in lockstep. A ship that's hit drops out
 * immediately; projectiles that meet annihilate. Fully deterministic for the same world and
 * aims — which is what makes killcam replays exact. Mutates `world.ships[].alive`.
 */
export class Volley {
  readonly shots: VolleyShot[];
  private readonly aims: VolleyAim[];
  private readonly replaying: boolean;
  id = nextVolleyId++;
  steps = 0;
  /** What was done to the flight along the way. A volley built with the same script flies the same flight. */
  readonly script: VolleyScript[];

  constructor(
    readonly world: World,
    aims: VolleyAim[],
    private readonly rules: ShotRules,
    private readonly trackStyle: boolean,
    script: readonly VolleyScript[] = [],
  ) {
    // A replay carries the script it is to follow; a live flight starts empty and writes its own.
    this.replaying = script.length > 0;
    this.script = script.map((entry) => ({ ...entry }));
    this.aims = aims.map((aim) => ({ ...aim }));
    this.shots = aims.map((a) => {
      const shot = new Shot(world, a.player, a.angle, a.power, rules, trackStyle, a.spare, a.pierce, a.plasma);
      shot.fused = a.fused === true;
      return { shot, owner: a.player, trail: [shot.x, shot.y], fan: a.fan, pierce: a.pierce, plasma: a.plasma, stray: a.stray !== undefined, fused: a.fused, partner: a.partner };
    });
  }

  get done(): boolean {
    return this.shots.every((s) => s.shot.end);
  }

  snapshot(): VolleySnapshot {
    return {
      id: this.id,
      aims: this.aims.map((aim) => ({ ...aim })),
      steps: this.steps,
      script: this.script.map((entry) => ({ ...entry })),
      shots: this.shots.map(({ owner, trail, shot }) => ({
        owner, trail, x: shot.x, y: shot.y, vx: shot.vx, vy: shot.vy, time: shot.time, end: shot.end,
        style: shot.style ? [...shot.style] : null,
        fired: [...shot.fired],
        missiles: shot.missiles.map((m) => ({ ...m, trail: [...m.trail] })),
        seed: shot.seed,
        stormContacts: shot.snapshotStormContacts(),
        armed: shot.armed,
        stormUntil: shot.stormUntil,
        whiteExit: shot.whiteExit ? { ...shot.whiteExit } : undefined,
      })),
    };
  }

  restore(snapshot: VolleySnapshot): void {
    this.id = snapshot.id;
    this.steps = snapshot.steps;
    this.script.splice(0, Infinity, ...(snapshot.script ?? []));
    snapshot.shots.forEach((saved, i) => {
      const current = this.shots[i];
      if (!current) return;
      Object.assign(current.shot, { x: saved.x, y: saved.y, vx: saved.vx, vy: saved.vy, time: saved.time, end: saved.end });
      current.trail = saved.trail;
      if (current.shot.style && saved.style) current.shot.style.splice(0, Infinity, ...saved.style);
      current.shot.fired.splice(0, Infinity, ...(saved.fired ?? []));
      current.shot.missiles.splice(0, Infinity, ...(saved.missiles ?? []).map((m) => ({ ...m, trail: [...m.trail] })));
      if (saved.seed !== undefined) current.shot.seed = saved.seed;
      if (saved.armed !== undefined) current.shot.armed = saved.armed;
      current.shot.stormUntil = saved.stormUntil ?? 0;
      current.shot.whiteExit = saved.whiteExit ? { ...saved.whiteExit } : undefined;
      current.shot.restoreStormContacts(saved.stormContacts);
    });
  }

  /**
   * Splits a shot in flight: the shot keeps flying, and one copy per turn in `turns` (radians) branches off
   * from the same point. All of them join `fan`, so they never cancel each other out. False if there is nothing to split.
   */
  split(index: number, turns: readonly number[], fan: number): boolean {
    const vs = this.shots[index];
    if (!vs || vs.shot.end) return false;
    if (!this.replaying) this.script.push({ at: this.steps, kind: 'split', index, fan, turns: [...turns] });
    this.aims[index] = { ...this.aims[index], fan };
    vs.fan = fan;
    for (const turn of turns) {
      this.shots.push({ shot: vs.shot.fork(turn), owner: vs.owner, trail: [...vs.trail], fan, pierce: vs.pierce, plasma: vs.plasma });
      this.aims.push({ ...this.aims[index] });
    }
    return true;
  }

  /** Puts a shield on a ship, or takes it off, in the middle of the flight. */
  setShield(ship: number, on: boolean): void {
    if (!this.replaying) this.script.push({ at: this.steps, kind: 'shield', ship, on });
    this.world.ships[ship].shield = on;
  }

  /**
   * A defense's missile has lost shot `index`: it flies on as a shot of its own, from where it was and the way
   * it was going, for the defense's owner (who and whose side it passes through, as the defense does).
   * Live flight and replay both make it at the same step, so it needs no script entry.
   */
  private release(index: number, lost: { defense: number; x: number; y: number; vx: number; vy: number; trail: number[] }): void {
    const d = this.world.defenses[lost.defense];
    if (!d) return;
    const aim: VolleyAim = { player: d.owner, angle: 0, power: 0, spare: [...d.protects, ...(d.spares ?? [])], stray: index };
    const shot = new Shot(this.world, d.owner, aim.angle, aim.power, this.rules, this.trackStyle, aim.spare);
    shot.x = lost.x;
    shot.y = lost.y;
    shot.vx = lost.vx;
    shot.vy = lost.vy;
    shot.seed = Math.imul(this.shots[index].shot.seed ^ (lost.defense + 1), 16777619) >>> 0;
    this.aims.push(aim);
    this.shots.push({ shot, owner: d.owner, trail: [...lost.trail, lost.x, lost.y], stray: true });
  }

  /**
   * Fusion: shots `i` and `j` have met and melt into one, from the point between them, with the speed of both
   * (their momentum shared, as two equal masses that stick). It belongs to both shooters, carries on the longer
   * flight's clock, and is armed if either was. Live flight and replay both make it at the same step.
   */
  private fuse(i: number, j: number, events: VolleyEvent[]): void {
    const first = this.shots[i];
    const second = this.shots[j];
    const a = first.shot;
    const b = second.shot;
    const into = this.shots.length;
    const endA: ShotEnd = { kind: 'fused', into };
    const endB: ShotEnd = { kind: 'fused', into };
    a.terminate(endA);
    b.terminate(endB);
    events.push(
      { type: 'end', index: i, end: endA, x: a.x, y: a.y, vx: a.vx, vy: a.vy },
      { type: 'end', index: j, end: endB, x: b.x, y: b.y, vx: b.vx, vy: b.vy },
    );
    const owner = first.owner;
    const partner = second.owner !== owner ? second.owner : undefined;
    const aim: VolleyAim = { player: owner, angle: 0, power: 0, fused: true, ...(partner !== undefined ? { partner } : {}) };
    const shot = new Shot(this.world, owner, 0, 0, this.rules, this.trackStyle);
    shot.x = (a.x + b.x) / 2;
    shot.y = (a.y + b.y) / 2;
    shot.vx = (a.vx + b.vx) / 2;
    shot.vy = (a.vy + b.vy) / 2;
    shot.time = Math.max(a.time, b.time);
    shot.armed = a.armed || b.armed;
    shot.fused = true;
    shot.seed = Math.imul(a.seed ^ Math.imul(b.seed, 0x9e3779b1), 16777619) >>> 0;
    this.aims.push(aim);
    this.shots.push({ shot, owner, partner, fused: true, trail: [shot.x, shot.y] });
    events.push({ type: 'fusion', index: into, from: [i, j], x: shot.x, y: shot.y });
  }

  /** A replay does what was done to the original flight, right before the step it was done after. */
  private runScript(): void {
    if (!this.replaying) return;
    for (const entry of this.script) {
      if (entry.at !== this.steps) continue;
      if (entry.kind === 'split') this.split(entry.index, entry.turns, entry.fan);
      else this.world.ships[entry.ship].shield = entry.on;
    }
  }

  step(): VolleyEvent[] {
    const events: VolleyEvent[] = [];
    this.runScript();
    this.steps++;
    for (let i = 0; i < this.shots.length; i++) {
      const vs = this.shots[i];
      const shot = vs.shot;
      if (shot.end) continue;
      const styleBefore = shot.style?.length ?? 0;
      const end = shot.step();
      if (shot.style) {
        for (let k = styleBefore; k < shot.style.length; k++) events.push({ type: 'style', index: i, event: shot.style[k] });
      }
      // A wormhole jump puts both mouths in the trail, back to back: the drawing breaks the line there.
      for (const w of shot.warps) vs.trail.push(w.fromX, w.fromY, w.toX, w.toY);
      shot.warps.length = 0;
      for (const launch of shot.launches) events.push({ type: 'intercept', index: i, defense: launch.defense, x: shot.x, y: shot.y });
      shot.launches.length = 0;
      for (const miss of shot.misses) events.push({ type: 'interceptMiss', index: i, defense: miss.defense, x: miss.x, y: miss.y });
      shot.misses.length = 0;
      for (const lost of shot.strays) this.release(i, lost);
      shot.strays.length = 0;
      for (const arm of shot.arms) events.push({ type: 'arm', index: i, x: arm.x, y: arm.y });
      shot.arms.length = 0;
      for (const warning of shot.warnings) events.push({ type: 'warn', index: i, ship: warning.ship, x: warning.x, y: warning.y });
      shot.warnings.length = 0;
      for (const bump of shot.bumps) events.push({ type: 'bump', index: i, planet: bump.planet, x: bump.x, y: bump.y, vx: shot.vx, vy: shot.vy });
      shot.bumps.length = 0;
      if (shot.wraps) events.push({ type: 'loop', index: i, count: shot.wraps });
      shot.wraps = 0;
      if (shot.returns) events.push({ type: 'whiteHole', index: i, count: shot.returns });
      shot.returns = 0;
      if (end || this.steps % TRAIL_EVERY === 0) vs.trail.push(shot.x, shot.y);
      // A shield bounces the shot off: it is spent doing so, here where a live flight and a replay agree.
      for (const r of shot.reflects) {
        this.world.ships[r.ship].shield = false;
        if (!this.replaying) this.script.push({ at: this.steps, kind: 'shield', ship: r.ship, on: false });
        events.push({ type: 'reflect', index: i, ship: r.ship, x: r.x, y: r.y });
      }
      shot.reflects.length = 0;
      // An armor-piercing shot went through a hull: that ship is out, and the shot is still flying.
      for (const hit of shot.hits) {
        this.world.ships[hit.ship].alive = false;
        events.push({ type: 'pierce', index: i, ship: hit.ship, x: hit.x, y: hit.y, vx: shot.vx, vy: shot.vy });
      }
      shot.hits.length = 0;
      // An armor-piercing shot struck a planet at its cannon: the cannon is out for the rest of the round.
      for (const w of shot.wrecks) {
        const d = this.world.defenses[w.defense];
        if (!d || d.wrecked) continue;
        d.wrecked = true;
        this.world.version++;
        events.push({ type: 'wreck', index: i, defense: w.defense, x: w.x, y: w.y });
      }
      shot.wrecks.length = 0;
      if (end) {
        if (end.kind === 'ship') this.world.ships[end.ship].alive = false;
        events.push({ type: 'end', index: i, end, x: shot.x, y: shot.y, vx: shot.vx, vy: shot.vy });
      }
      for (const hit of shot.planetHits) {
        const index = this.world.planets.findIndex((p) => p.seed === hit.seed);
        const planet = this.world.planets[index];
        if (!planet || planet.sun) continue;
        (planet.fractures ??= []).push(hit.angle);
        this.world.version++;
        if (planet.fractures.length < planetDurability(planet)) continue;
        this.world.planets.splice(index, 1);
        // Keep defense indices stable while missiles are in flight; the destroyed turret stops firing.
        for (const d of this.world.defenses) if (d.planet === planet.seed) d.wrecked = true;
        for (const other of this.shots) other.shot.forgetPlanet(index);
        events.push({ type: 'planetShatter', index: i, x: planet.x, y: planet.y, radius: planet.radius, color: planet.tint });
      }
      shot.planetHits.length = 0;
    }

    // Projectiles that meet head-on cancel each other out, or (Fusion) melt into one. A melted shot never melts again: it cancels out what it meets.
    const r2 = PHYSICS.CLASH_RADIUS * PHYSICS.CLASH_RADIUS;
    for (let i = 0; i < this.shots.length; i++) {
      const a = this.shots[i].shot;
      if (a.end) continue;
      for (let j = i + 1; j < this.shots.length; j++) {
        const b = this.shots[j].shot;
        if (b.end) continue;
        const fan = this.aims[i].fan;
        if (fan !== undefined && fan === this.aims[j].fan) continue;
        // A missile that lost a shot starts next to it: they do not cancel each other out, nor its brothers.
        const { stray: strayI } = this.aims[i];
        const { stray: strayJ } = this.aims[j];
        if (strayI === j || strayJ === i || (strayI !== undefined && strayI === strayJ)) continue;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        if (dx * dx + dy * dy >= r2) continue;
        if (this.rules.fusion && !a.fused && !b.fused) {
          this.fuse(i, j, events);
          break;
        }
        const endA: ShotEnd = { kind: 'clash', other: j };
        const endB: ShotEnd = { kind: 'clash', other: i };
        a.terminate(endA);
        b.terminate(endB);
        events.push(
          { type: 'end', index: i, end: endA, x: a.x, y: a.y, vx: a.vx, vy: a.vy },
          { type: 'end', index: j, end: endB, x: b.x, y: b.y, vx: b.vx, vy: b.vy },
        );
        break;
      }
    }
    return events;
  }
}
