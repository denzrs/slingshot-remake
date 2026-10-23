import { nextWormholeId, portalFits, type ShotRules, type World } from '../physics';
import { aimedPlanet, blackHoleFits, aimedSpot, aimedSurface, cpuWormholeSpots, CPU_IGNORES, nebulaSpot, pickKind, POWER_UP, previewPath, SPLIT_TURNS, spawnPickup, teleportSpot, touchedPickups, type Pickup, type PowerUpKind } from '../powerups';
import { NEBULA, WORMHOLE } from '../config';
import type { Rng } from '../rng';
import { bump, type StatBook } from '../stats';
import type { Volley, VolleyAim } from '../volley';
import type { GameEvent, Phase, PlayerState } from './match';
import type { ReplayPlacement } from './replay';

/** What the power-ups need from the match they belong to. */
export interface PowerUpHost {
  /** Power-ups are on for this match at all. */
  enabled(): boolean;
  world(): World;
  players(): PlayerState[];
  rng(): Rng;
  rules(): ShotRules;
  volley(): Volley | null;
  phase(): Phase;
  /** The player sitting at this screen, null in hot-seat. */
  viewer(): number | null;
  /** The player on turn, -1 for nobody. */
  current(): number;
  localCanAim(): boolean;
  canAim(id: number): boolean;
  friendsOf(id: number): number[];
  sparedFor(id: number): number[];
  /** Volleys that make up one pass. */
  volleysPerPass(): number;
  /** The kinds of power-up in play, and how many pickups lie on the field (the settings). */
  kinds(): readonly PowerUpKind[];
  amount(): number;
  emit(event: GameEvent): void;
  /** A placement has been made: for the match's log of what was done. */
  placed(placement: ReplayPlacement): void;
  clearCpuJobs(): void;
  /** Writes into the round's and the match's stat book, for the scorecard. */
  record(update: (book: StatBook) => void): void;
}

/** The power-ups a player aims at a spot on the field, rather than firing: a teleport, a black hole, a planet killer, a nebula, a wormhole, a planetary defense or a antigravity. */
export type PlacementKind = 'teleport' | 'blackhole' | 'planetkiller' | 'nebula' | 'wormhole' | 'defense' | 'antigravity';

/** Whether this power-up is aimed at a spot and then confirmed, instead of armed and spent by a shot. */
export const isPlacement = (kind: PowerUpKind | null): kind is PlacementKind => kind === 'teleport' || kind === 'blackhole' || kind === 'planetkiller' || kind === 'nebula' || kind === 'wormhole' || kind === 'defense' || kind === 'antigravity';

/** Where an aimed power-up would land or be planted, as the renderer sees it. */
export interface PlacementAim {
  owner: number;
  /** A teleport moves the ship there; a black hole, a nebula or a removed planet is targeted there. */
  kind: PlacementKind;
  /** The landing or planting spot, or null while the aim lands nowhere. */
  target: { x: number; y: number } | null;
  /** A wormhole's first portal, already set: the aim now picks the second. */
  first?: { x: number; y: number } | null;
  /** A wormhole's aim that would overlap another portal, or a black hole's that is too close to another player, so the click does nothing. */
  blocked?: boolean;
}

/** What a guest needs besides the pickups to draw the power-ups: the pass the round is in, and who is aiming a placement. */
export interface PowerUpState {
  pass: number;
  /** The ships aiming a teleport or a black hole right now (their kind is on the player). */
  placing: number[];
  /** The first portal each aiming ship has set, by ship: a guest draws it while the second is aimed. */
  firsts?: [number, { x: number; y: number }][];
}

/** What the renderer draws of the power-ups. */
export interface PowerUpScene {
  pickups: readonly Pickup[];
  /** The pass the round is in, so the renderer can tell which pickups are about to fade. */
  pass: number;
  /** The armed preview's path while aiming. */
  preview: number[] | null;
  /** Where the aiming ship's teleport or black hole would go. */
  placement: PlacementAim | null;
}

/**
 * Power-ups: the pickups on the field, who holds what, and what each power-up
 * does. The match calls in at round start, on every step of a flight and when a volley is over.
 */
export class PowerUpField {
  pickups: Pickup[] = [];
  private pass = 0;
  private volleysThisPass = 0;
  private ids = 0;
  private previewKey = '';
  private previewCache: number[] | null = null;
  /** The ships aiming a teleport right now, by their id: online, several can aim at once. */
  private choosing = new Set<number>();
  /** The first mouth of a wormhole a ship has set, by ship: the second click sets the other and plants the pair. */
  private wormFirst = new Map<number, { x: number; y: number }>();
  /** The placements a salvo holds back, by ship: they are made when the volley takes off, not when their ship locks in. */
  private held = new Map<number, () => boolean>();

  constructor(private readonly host: PowerUpHost) {}

  get enabled(): boolean {
    return this.host.enabled();
  }

  /** How many pickups lie on the field: a round starts with that many, and a taken or faded one is replaced. Never more. */
  private get amount(): number {
    return Math.max(1, this.host.amount());
  }

  // ————————————————————————————— Pickups —————————————————————————————

  /** A new round: the old pickups and choices are gone, and the first pickups are laid. */
  startRound(): void {
    this.pickups = [];
    this.pass = 0;
    this.volleysThisPass = 0;
    this.choosing.clear();
    this.wormFirst.clear();
    this.held.clear();
    if (this.enabled) for (let i = 0; i < this.amount; i++) this.spawn();
  }

  /**
   * Sets a pickup on the path of a ship — often the one that is behind, so the field leans towards catching up.
   * Round start and refills are silent; the caller announces the others.
   */
  private spawn(): Pickup | null {
    if (this.pickups.length >= this.amount) return null;
    const host = this.host;
    const alive = host.players().filter((p) => p.alive);
    if (!alive.length) return null;
    const behind = Math.min(...alive.map((p) => p.score));
    const trailing = alive.filter((p) => p.score === behind);
    const rng = host.rng();
    // When everybody is level there is nobody to help, and every ship's paths are fair game.
    const sources = trailing.length < alive.length && rng() < POWER_UP.CATCH_UP_CHANCE ? [trailing[Math.floor(rng() * trailing.length)].id] : alive.map((p) => p.id);
    const kind = pickKind(rng, host.kinds());
    const pickup = spawnPickup(host.world(), rng, this.pickups, kind, ++this.ids, this.pass, { rules: host.rules(), sources });
    if (pickup) this.pickups.push(pickup);
    return pickup;
  }

  /**
   * A volley is over. Once a whole pass has gone by, old pickups fade. The field is then topped up to the amount,
   * so a new pickup only comes once there is room: a taken or faded one is replaced at once, and nothing is laid
   * on top of one that is still lying there.
   */
  onVolleyEnd(): void {
    if (!this.enabled) return;
    if (++this.volleysThisPass >= Math.max(1, this.host.volleysPerPass())) {
      this.volleysThisPass = 0;
      this.pass++;
      const kept = this.pickups.filter((p) => this.pass - p.born < POWER_UP.LIFETIME_PASSES);
      for (const gone of this.pickups.filter((p) => !kept.includes(p))) this.host.emit({ type: 'pickupFade', kind: gone.kind, x: gone.x, y: gone.y });
      this.pickups = kept;
    }
    while (this.pickups.length < this.amount) {
      const fresh = this.spawn();
      if (!fresh) break;
      this.announce(fresh);
    }
  }

  /** A black hole has grown — or a new one was planted: pickups it has swallowed are gone, and the field is filled up again. */
  sweep(): void {
    const holes = this.host.world().holes;
    if (!this.enabled || !holes.length) return;
    const swallowed = this.pickups.filter((p) => holes.some((hole) => Math.hypot(p.x - hole.x, p.y - hole.y) < hole.radius + POWER_UP.PICKUP_RADIUS));
    for (const gone of swallowed) this.host.emit({ type: 'pickupFade', kind: gone.kind, x: gone.x, y: gone.y });
    this.pickups = this.pickups.filter((p) => !swallowed.includes(p));
    while (this.pickups.length < this.amount) {
      const fresh = this.spawn();
      if (!fresh) break;
      this.announce(fresh);
    }
  }

  private announce(pickup: Pickup | null): void {
    if (pickup) this.host.emit({ type: 'pickupSpawn', kind: pickup.kind, x: pickup.x, y: pickup.y });
  }

  /** One step of a flight: shots take the pickups they pass, and CPUs with a splitter may fork. */
  onStep(volley: Volley): void {
    this.collect(volley);
    if (!this.scripted) this.cpuSplits(volley);
  }

  /**
   * Shots in flight take the pickups they pass close to. A ship holding one that takes another swaps it:
   * the old power-up is lost. A splitter is armed from the start: its fire press comes mid-flight, so there is
   * nothing to arm first. CPUs hold their power-up armed, since they use it on their own.
   */
  private collect(volley: Volley): void {
    if (!this.pickups.length) return;
    const players = this.host.players();
    for (const vs of volley.shots) {
      if (vs.stray) continue;
      const p = players[vs.owner];
      // A CPU has no use for a preview, so it leaves that lying.
      const hit = touchedPickups(this.pickups, vs.shot.x, vs.shot.y).find((i) => !(p.cpu && CPU_IGNORES[this.pickups[i].kind]));
      if (hit === undefined) continue;
      const [pickup] = this.pickups.splice(hit, 1);
      const dropped = p.powerUp;
      p.powerUp = pickup.kind;
      // A splitter and a shield need no key: they are ready from the start. A CPU holds everything armed, but a
      // plasma shot, which it keeps back until a plain one finds nothing to hit.
      p.armed = (p.cpu !== null && pickup.kind !== 'plasma') || pickup.kind === 'splitter' || pickup.kind === 'shield';
      // The shield is on the ship itself, so every shot in the volley meets it. Swapping it away takes it off.
      volley.setShield(p.id, pickup.kind === 'shield');
      this.host.emit({ type: 'pickup', player: p.id, kind: pickup.kind, x: pickup.x, y: pickup.y, dropped });
      this.host.record((book) => bump(book.pickups, p.id));
    }
  }

  // ————————————————————————————— Using them —————————————————————————————

  /**
   * The power-up key. A teleport or a black hole opens its aim: the angle and power set one spot, fire goes
   * there (jumps, or plants the hole), the key again or Esc thinks again. A preview, armor piercing or a plasma shot is armed
   * instead (press again to disarm) and spent by the next shot. A splitter needs no key: it is armed, and the fire press
   * during the flight splits the shot.
   */
  use(id: number): void {
    const host = this.host;
    if (!this.enabled || !host.canAim(id)) return;
    const p = host.players()[id];
    if (!p.powerUp || p.powerUp === 'splitter' || p.powerUp === 'shield') return;
    if (p.powerUp === 'preview' || p.powerUp === 'piercing' || p.powerUp === 'plasma') {
      p.armed = !p.armed;
      this.previewKey = '';
      return;
    }
    if (this.aiming(id)) {
      this.choosing.delete(id);
      this.wormFirst.delete(id);
    } else this.choosing.add(id);
  }

  /** The ship whose screen this is, or whose turn it is. */
  private get aimer(): number {
    return this.host.viewer() ?? this.host.current();
  }

  /** Whether a ship is aiming a placement: it cleans the aim up once the ship may no longer place. */
  private aiming(owner: number): boolean {
    if (!this.choosing.has(owner)) return false;
    const kind = this.host.players()[owner]?.powerUp ?? null;
    if (this.host.phase() === 'aiming' && isPlacement(kind) && this.host.canAim(owner)) return true;
    this.choosing.delete(owner);
    this.wormFirst.delete(owner);
    return false;
  }

  /** Where a ship's aim would put its placement, or null when it is not aiming one. */
  private placementAim(owner: number = this.aimer): PlacementAim | null {
    if (!this.aiming(owner)) return null;
    const p = this.host.players()[owner];
    const kind = p.powerUp as PlacementKind;
    const world = this.host.world();
    const from = world.ships[owner];
    let target: { x: number; y: number } | null;
    if (kind === 'planetkiller' || kind === 'antigravity') {
      const planet = aimedPlanet(world, from, p.angle);
      target = planet ? { x: planet.x, y: planet.y } : null;
    } else if (kind === 'defense') {
      target = aimedSurface(world, from, p.angle);
    } else if (kind === 'nebula') {
      target = nebulaSpot(world, from, p.angle, p.power);
    } else {
      target = aimedSpot(world, from, p.angle, p.power);
    }
    if (kind === 'blackhole') return { owner, kind, target, blocked: !!target && !blackHoleFits(world, target, owner) };
    if (kind !== 'wormhole') return { owner, kind, target };
    const first = this.wormFirst.get(owner) ?? null;
    return { owner, kind, target, first, blocked: !!target && !portalFits(world, target, first ? [first] : []) };
  }

  /** Whether the ship at this screen (or on turn) is aiming a placement. */
  get placing(): boolean {
    return !!this.placementAim();
  }

  /** Whether a given ship is aiming a placement. */
  placingFor(owner: number): boolean {
    return !!this.placementAim(owner);
  }

  /**
   * Fire while aiming: the ship jumps, or the placement happens. False when there is no aim, or it lands nowhere.
   * In a salvo (`hold`) the others are still aiming against the field as it is, so the placement is only taken
   * down here and made by `makeHeld` once the volley takes off.
   */
  confirmPlacement(by: number = this.aimer, hold = false): boolean {
    const aim = this.placementAim(by);
    if (!aim?.target) return false;
    if (aim.kind === 'blackhole' && aim.blocked) return false;
    let make: (() => boolean) | null;
    if (aim.kind === 'wormhole') {
      // A portal cannot overlap another, whatever the distance otherwise.
      if (aim.blocked) return false;
      const first = this.wormFirst.get(by);
      // The first click sets one portal and spends nothing; the second sets the other and plants the pair.
      if (!first) {
        this.wormFirst.set(by, aim.target);
        return false;
      }
      this.choosing.delete(by);
      this.wormFirst.delete(by);
      const second = aim.target;
      make = () => this.plantWormhole(aim.owner, first, second);
    } else {
      this.choosing.delete(by);
      make = this.placementOf(aim);
    }
    if (!make) return false;
    if (!hold) return make();
    this.held.set(by, make);
    return true;
  }

  /** What a placement does once it is made, or null when its aim lands on nothing. A planet is kept by itself, not its place, which a planet killer made before it may have shifted. */
  private placementOf(aim: PlacementAim): (() => boolean) | null {
    const target = aim.target;
    if (!target) return null;
    const world = this.host.world();
    const owner = aim.owner;
    const aimed = aimedPlanet(world, world.ships[owner], this.host.players()[owner].angle);
    switch (aim.kind) {
      case 'blackhole': return () => this.plantBlackHole(owner, target);
      case 'nebula': return () => this.plantNebula(owner, target);
      case 'defense': {
        const index = (target as { planet?: number }).planet;
        if (index === undefined) return () => this.plantDefense(owner, target);
        return this.onPlanet(world.planets[index], (i) => this.plantDefense(owner, { x: target.x, y: target.y, planet: i }));
      }
      case 'antigravity': return this.onPlanet(aimed ? world.planets[aimed.index] : undefined, (i) => this.turnAntigravity(owner, i));
      case 'planetkiller': return this.onPlanet(aimed ? world.planets[aimed.index] : undefined, (i) => this.killPlanet(owner, i), () => this.spendGone(owner));
      default: return () => this.teleport(owner, target);
    }
  }

  /** A placement on a planet that finds the planet again when it is made: the index it was aimed at may have moved by then. `gone` runs when the planet has been taken meanwhile. */
  private onPlanet(planet: World['planets'][number] | undefined, place: (index: number) => boolean, gone?: () => boolean): (() => boolean) | null {
    if (!planet) return null;
    const world = this.host.world();
    return () => {
      const index = world.planets.indexOf(planet);
      return index >= 0 ? place(index) : (gone?.() ?? false);
    };
  }

  /** A power-up used up without effect: two planet killers on one rock cost both ships theirs. */
  private spend(id: number): boolean {
    const p = this.host.players()[id];
    p.powerUp = null;
    p.armed = false;
    return false;
  }

  /** Whether this field only does what a replay's log says: nothing happens on a CPU's own mind. */
  scripted = false;

  /** Makes a placement the log says was made. False when it no longer lands: the replay has drifted from the game. */
  placeLogged(placement: ReplayPlacement): boolean {
    const { player: id, x = 0, y = 0, x2 = 0, y2 = 0, planet = 0 } = placement;
    switch (placement.kind) {
      case 'teleport': return placement.x === undefined ? this.teleport(id) : this.teleport(id, { x, y });
      case 'blackhole': return this.plantBlackHole(id, { x, y });
      case 'nebula': return this.plantNebula(id, { x, y });
      case 'wormhole': return this.plantWormhole(id, { x, y }, { x: x2, y: y2 });
      case 'planetkiller': return planet < 0 ? this.spend(id) : this.killPlanet(id, planet);
      case 'antigravity': return this.turnAntigravity(id, planet);
      case 'defense': return this.plantDefense(id, { x, y, planet });
    }
  }

  /** A planet killer whose planet was taken by another in the same volley: spent, and nothing to show for it. */
  private spendGone(id: number): boolean {
    this.host.placed({ player: id, kind: 'planetkiller', planet: -1 });
    return this.spend(id);
  }

  /** The volley takes off: the placements a salvo held back are made now, ship by ship. A ship whose placement no longer lands keeps its power-up, unless its planet killer found the planet gone. */
  makeHeld(): void {
    const held = [...this.held.values()];
    this.held.clear();
    for (const make of held) make();
  }

  cancelPlacement(by: number = this.aimer): boolean {
    const had = this.choosing.has(by);
    this.choosing.delete(by);
    this.wormFirst.delete(by);
    return had;
  }

  /**
   * Plants a black hole at `spot`. It stays for the rest of the round: a fixed horizon that bends and
   * swallows shots, on top of the Event Horizon one when there is one.
   */
  private plantBlackHole(id: number, spot: { x: number; y: number }): boolean {
    const world = this.host.world();
    // A salvo plants at takeoff, after the ships may have moved (a held teleport): the gap holds then too, and a refused hole keeps its power-up.
    if (!blackHoleFits(world, spot, id)) return false;
    world.holes.push({ x: spot.x, y: spot.y, radius: POWER_UP.BLACKHOLE_RADIUS, mass: POWER_UP.BLACKHOLE_MASS });
    world.version++;
    this.host.placed({ player: id, kind: 'blackhole', x: spot.x, y: spot.y });
    this.host.players()[id].powerUp = null;
    this.host.players()[id].armed = false;
    this.host.clearCpuJobs();
    this.host.emit({ type: 'blackhole', player: id, x: spot.x, y: spot.y });
    // A pickup sitting where the hole now opens is swallowed, and the field is filled up again.
    this.sweep();
    return true;
  }

  /** Plants a wormhole: two mouths that carry a shot from one to the other, for the rest of the round. */
  private plantWormhole(id: number, a: { x: number; y: number }, b: { x: number; y: number }): boolean {
    const world = this.host.world();
    world.wormholes.push({ id: nextWormholeId(world), ax: a.x, ay: a.y, bx: b.x, by: b.y, radius: WORMHOLE.RADIUS });
    world.version++;
    this.host.placed({ player: id, kind: 'wormhole', x: a.x, y: a.y, x2: b.x, y2: b.y });
    this.host.players()[id].powerUp = null;
    this.host.players()[id].armed = false;
    this.host.clearCpuJobs();
    this.host.emit({ type: 'wormhole', player: id, x: a.x, y: a.y, toX: b.x, toY: b.y });
    return true;
  }

  /**
   * Removes a planet from the field: its rock and its gravity are gone for the rest of the round, and any
   * shot already planned around it is now wrong. The pickups that lay near it stay where they are.
   */
  private killPlanet(id: number, index: number): boolean {
    const world = this.host.world();
    const planet = world.planets[index];
    if (!planet) return false;
    world.planets.splice(index, 1);
    this.host.placed({ player: id, kind: 'planetkiller', planet: index });
    // A defense stood on the rock: it goes with it.
    world.defenses = world.defenses.filter((d) => d.planet !== planet.seed);
    world.version++;
    this.host.players()[id].powerUp = null;
    this.host.players()[id].armed = false;
    this.host.clearCpuJobs();
    this.host.emit({ type: 'planetKiller', player: id, x: planet.x, y: planet.y, radius: planet.radius });
    return true;
  }

  /**
   * Turns a planet's gravity round: it pushes every shot away instead of pulling it in, whoever's, for the rest
   * of the round. A planet that is turned already is turned back, so the other side can undo it.
   */
  private turnAntigravity(id: number, index: number): boolean {
    const world = this.host.world();
    const planet = world.planets[index];
    if (!planet) return false;
    planet.reversed = !planet.reversed;
    world.version++;
    this.host.placed({ player: id, kind: 'antigravity', planet: index });
    this.host.players()[id].powerUp = null;
    this.host.players()[id].armed = false;
    this.host.clearCpuJobs();
    this.host.emit({ type: 'antigravity', player: id, x: planet.x, y: planet.y, radius: planet.radius, reversed: !!planet.reversed });
    return true;
  }

  /**
   * Sets a planetary defense on a planet's surface: it lasts the round and fires a missile at every enemy
   * shot that flies into its area, except those of the player who set it and their team. A planet has only one: a
   * defense set on a planet that already has one replaces it, whoever's it was. `spot.planet` is the planet's
   * place in `world.planets`, as `aimedSurface` gives it; without it the planet is found by the spot.
   */
  private plantDefense(id: number, spot: { x: number; y: number; planet?: number }): boolean {
    const world = this.host.world();
    const planet = spot.planet !== undefined ? world.planets[spot.planet] : world.planets.find((p) => Math.abs(Math.hypot(spot.x - p.x, spot.y - p.y) - p.radius) < 1);
    if (!planet) return false;
    world.defenses = world.defenses.filter((d) => d.planet !== planet.seed);
    world.defenses.push({ x: spot.x, y: spot.y, radius: planet.radius * POWER_UP.DEFENSE_RADIUS_SHARE, planet: planet.seed, owner: id, protects: [id, ...this.host.friendsOf(id)] });
    world.version++;
    this.host.placed({ player: id, kind: 'defense', x: spot.x, y: spot.y, planet: world.planets.indexOf(planet) });
    this.host.players()[id].powerUp = null;
    this.host.players()[id].armed = false;
    this.host.clearCpuJobs();
    this.host.emit({ type: 'defense', player: id, x: spot.x, y: spot.y });
    return true;
  }

  /**
   * Puts a nebula cloud on the field: a shot flying through it is slowed and the gravity it feels is
   * stronger, so it both lingers and bends inside the cloud. It lasts the round, like a planted black hole.
   */
  private plantNebula(id: number, spot: { x: number; y: number }): boolean {
    const world = this.host.world();
    const rng = this.host.rng();
    // The seed comes from the match rng, so a guest draws the very cloud the host laid.
    world.nebulae.push({ x: spot.x, y: spot.y, radius: NEBULA.RADIUS, seed: rng() });
    world.version++;
    this.host.placed({ player: id, kind: 'nebula', x: spot.x, y: spot.y });
    this.host.players()[id].powerUp = null;
    this.host.players()[id].armed = false;
    this.host.clearCpuJobs();
    this.host.emit({ type: 'nebula', player: id, x: spot.x, y: spot.y });
    return true;
  }

  /**
   * A CPU lays the placement it holds at the spot its own aim points at: no aim key, no confirm, and the
   * shot is the caller's to spend. It handles the placements a CPU lays; a teleport it plans
   * with, like a shot. False when it holds none of them, or the aim lands nowhere. A wormhole's portals
   * are not aimed one by one: the aim points at the first, and both are worked out from the world.
   */
  placeForCpu(id: number, hold = false): boolean {
    const make = this.cpuPlacement(id);
    if (!make) return false;
    if (!hold) return make();
    this.held.set(id, make);
    return true;
  }

  /** What a CPU's placement does once it is made, or null when it holds none or has nowhere to lay it. */
  private cpuPlacement(id: number): (() => boolean) | null {
    const p = this.host.players()[id];
    const kind = p.powerUp;
    if (kind !== 'blackhole' && kind !== 'nebula' && kind !== 'planetkiller' && kind !== 'defense' && kind !== 'wormhole' && kind !== 'antigravity') return null;
    const world = this.host.world();
    const from = world.ships[id];
    if (kind === 'wormhole') {
      const friends = this.host.friendsOf(id);
      const target = this.host.players()
        .filter((q) => q.alive && q.id !== id && !friends.includes(q.id))
        .map((q) => world.ships[q.id])
        .sort((a, b) => Math.hypot(a.x - from.x, a.y - from.y) - Math.hypot(b.x - from.x, b.y - from.y))[0];
      const spots = target && cpuWormholeSpots(world, from, target);
      return spots ? () => this.plantWormhole(id, spots[0], spots[1]) : null;
    }
    if (kind === 'antigravity') {
      // Only a planet that pulls: a CPU never turns one back.
      const planet = aimedPlanet(world, from, p.angle);
      return planet && !world.planets[planet.index].reversed ? this.onPlanet(world.planets[planet.index], (i) => this.turnAntigravity(id, i)) : null;
    }
    if (kind === 'defense') {
      const surface = aimedSurface(world, from, p.angle);
      if (!surface) return null;
      return this.onPlanet(world.planets[surface.planet], (i) => this.plantDefense(id, { ...surface, planet: i }))
    }
    if (kind === 'planetkiller') {
      const planet = aimedPlanet(world, from, p.angle);
      return planet ? this.onPlanet(world.planets[planet.index], (i) => this.killPlanet(id, i), () => this.spendGone(id)) : null;
    }
    const spot = kind === 'nebula' ? nebulaSpot(world, from, p.angle, p.power) : aimedSpot(world, from, p.angle, p.power);
    if (!spot || (kind === 'blackhole' && !blackHoleFits(world, spot, id))) return null;
    return kind === 'nebula' ? () => this.plantNebula(id, spot) : () => this.plantBlackHole(id, spot);
  }

  /** Teleports a ship to `spot`, or to a random free one; false when there is none. */
  teleport(id: number, aimed?: { x: number; y: number } | null): boolean {
    // A spot the game draws itself comes from the match's stream, so the log only notes that it did.
    const drawn = aimed === undefined;
    const spot = drawn ? teleportSpot(this.host.world(), this.host.rng(), this.pickups) : aimed;
    // A draw that found nowhere to land still used the stream: a replay has to draw it too.
    if (!spot) {
      if (drawn) this.host.placed({ player: id, kind: 'teleport' });
      return false;
    }
    const ship = this.host.world().ships[id];
    const [fromX, fromY] = [ship.x, ship.y];
    ship.x = spot.x;
    ship.y = spot.y;
    this.host.placed(drawn ? { player: id, kind: 'teleport' } : { player: id, kind: 'teleport', x: spot.x, y: spot.y });
    this.host.players()[id].powerUp = null;
    this.host.clearCpuJobs();
    this.host.emit({ type: 'teleport', player: id, fromX, fromY, toX: spot.x, toY: spot.y });
    return true;
  }

  /**
   * Fire while the shot is flying: an armed splitter forks it into three. Without a player (-1, as in a salvo,
   * where nobody is on turn) the first human whose shot is in the air and who holds a splitter splits it.
   */
  splitInFlight(id = -1): boolean {
    const volley = this.host.volley();
    if (!this.enabled || !volley) return false;
    const players = this.host.players();
    for (const who of id >= 0 ? [id] : players.filter((q) => !q.cpu).map((q) => q.id)) {
      const p = players[who];
      if (!p || !p.armed || p.powerUp !== 'splitter') continue;
      const index = volley.shots.findIndex((vs) => vs.owner === who && !vs.stray && !vs.shot.end);
      if (index < 0 || !volley.split(index, SPLIT_TURNS, ++this.ids)) continue;
      p.powerUp = null;
      p.armed = false;
      const { x, y } = volley.shots[index].shot;
      this.host.emit({ type: 'split', player: who, x, y });
      return true;
    }
    return false;
  }

  /** CPUs with an armed splitter fork their shot once it is close to an enemy ship. */
  private cpuSplits(volley: Volley): void {
    const host = this.host;
    const players = host.players();
    const world = host.world();
    const shots = volley.shots.length;
    for (let index = 0; index < shots; index++) {
      const vs = volley.shots[index];
      const p = players[vs.owner];
      if (vs.stray || !p.cpu || !p.armed || p.powerUp !== 'splitter' || vs.shot.end || vs.shot.time < POWER_UP.CPU_SPLIT_MIN_TIME) continue;
      const friends = host.friendsOf(p.id);
      const near = players.some((e) => e.alive && e.id !== p.id && !friends.includes(e.id) && Math.hypot(world.ships[e.id].x - vs.shot.x, world.ships[e.id].y - vs.shot.y) < POWER_UP.CPU_SPLIT_RANGE);
      if (near && volley.split(index, SPLIT_TURNS, ++this.ids)) {
        p.powerUp = null;
        p.armed = false;
        host.emit({ type: 'split', player: p.id, x: vs.shot.x, y: vs.shot.y });
      }
    }
  }

  /**
   * The aims a player's shot launches with. An armed preview is used up by the shot, an armed armor piercing
   * rides the next shot through its targets, and an armed plasma shot makes it hard to bend; a splitter waits for the fire press during the flight, a shield for a hit.
   */
  aimsFor(p: PlayerState): VolleyAim[] {
    const aim: VolleyAim = { player: p.id, angle: p.angle, power: p.power, spare: this.host.sparedFor(p.id) };
    if (!this.enabled || !p.armed) return [aim];
    if (p.powerUp === 'piercing') {
      aim.pierce = true;
      p.powerUp = null;
      p.armed = false;
      return [aim];
    }
    if (p.powerUp === 'plasma') {
      aim.plasma = true;
      p.powerUp = null;
      p.armed = false;
      return [aim];
    }
    if (p.powerUp === 'preview') {
      p.powerUp = null;
      p.armed = false;
    }
    return [aim];
  }

  // ————————————————————————————— Drawing —————————————————————————————

  /** What the renderer draws of the power-ups. */
  /** What a guest needs on top of the pickups. */
  state(): PowerUpState {
    return { pass: this.pass, placing: [...this.choosing], firsts: [...this.wormFirst] };
  }

  /** The host's pass and aimed placements, as a guest has them. */
  restoreState(state: PowerUpState | undefined): void {
    this.pass = state?.pass ?? 0;
    this.choosing = new Set(state?.placing ?? []);
    this.wormFirst = new Map(state?.firsts ?? []);
  }

  scene(): PowerUpScene {
    return { pickups: this.pickups, pass: this.pass, preview: this.armedPreview(), placement: this.placementAim() };
  }

  /** The path an armed preview shows for the aimer, cached until the aim or the ship moves. */
  private armedPreview(): number[] | null {
    const host = this.host;
    if (!this.enabled || host.phase() !== 'aiming') return null;
    const id = host.viewer() ?? host.current();
    const p = host.players()[id];
    if (!p || !p.armed || p.powerUp !== 'preview' || !host.localCanAim()) return null;
    const world = host.world();
    const ship = world.ships[id];
    const key = `${id}|${p.angle}|${p.power}|${ship.x}|${ship.y}`;
    if (key !== this.previewKey) {
      this.previewKey = key;
      this.previewCache = previewPath(world, id, p.angle, p.power, host.rules());
    }
    return this.previewCache;
  }
}
