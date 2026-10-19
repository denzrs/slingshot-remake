import type { ShotRules, World } from '../physics';
import { aimedPlanet, aimedSpot, CPU_IGNORES, nebulaSpot, pickKind, POWER_UP, previewPath, SPLIT_TURNS, spawnPickup, teleportSpot, touchedPickups, type Pickup, type PowerUpKind } from '../powerups';
import { NEBULA } from '../config';
import type { Rng } from '../rng';
import { bump, type StatBook } from '../stats';
import type { Volley, VolleyAim } from '../volley';
import type { GameEvent, Phase, PlayerState } from './match';

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
  clearCpuJobs(): void;
  /** Writes into the round's and the match's stat book, for the scorecard. */
  record(update: (book: StatBook) => void): void;
}

/** The power-ups a player aims at a spot on the field, rather than firing: a teleport, a black hole, a planet killer or a nebula. */
export type PlacementKind = 'teleport' | 'blackhole' | 'planetkiller' | 'nebula';

/** Whether this power-up is aimed at a spot and then confirmed, instead of armed and spent by a shot. */
export const isPlacement = (kind: PowerUpKind | null): kind is PlacementKind => kind === 'teleport' || kind === 'blackhole' || kind === 'planetkiller' || kind === 'nebula';

/** Where an aimed power-up would land or be planted, as the renderer sees it. */
export interface PlacementAim {
  owner: number;
  /** A teleport moves the ship there; a black hole, a nebula or a removed planet is targeted there. */
  kind: PlacementKind;
  /** The landing or planting spot, or null while the aim lands nowhere. */
  target: { x: number; y: number } | null;
}

/** What a guest needs besides the pickups to draw the power-ups: the pass the round is in, and who is aiming a placement. */
export interface PowerUpState {
  pass: number;
  /** The ships aiming a teleport or a black hole right now (their kind is on the player). */
  placing: number[];
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
 * Experimental power-ups (offline Classic): the pickups on the field, who holds what, and what each power-up
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
    this.cpuSplits(volley);
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
      const p = players[vs.owner];
      // A CPU has no use for a preview, so it leaves that lying.
      const hit = touchedPickups(this.pickups, vs.shot.x, vs.shot.y).find((i) => !(p.cpu && CPU_IGNORES[this.pickups[i].kind]));
      if (hit === undefined) continue;
      const [pickup] = this.pickups.splice(hit, 1);
      const dropped = p.powerUp;
      p.powerUp = pickup.kind;
      // A splitter, a shield and armor piercing need no key: they are ready from the start. A CPU holds everything armed.
      p.armed = p.cpu !== null || pickup.kind === 'splitter' || pickup.kind === 'shield' || pickup.kind === 'piercing';
      // The shield is on the ship itself, so every shot in the volley meets it. Swapping it away takes it off.
      volley.setShield(p.id, pickup.kind === 'shield');
      // A CPU that has just taken a repulse must plan its next shot pushed, so its plan made before is dropped.
      if (p.cpu !== null && pickup.kind === 'repulse') this.host.clearCpuJobs();
      this.host.emit({ type: 'pickup', player: p.id, kind: pickup.kind, x: pickup.x, y: pickup.y, dropped });
      this.host.record((book) => bump(book.pickups, p.id));
    }
  }

  // ————————————————————————————— Using them —————————————————————————————

  /**
   * The power-up key. A teleport or a black hole opens its aim: the angle and power set one spot, fire goes
   * there (jumps, or plants the hole), the key again or Esc thinks again. A preview is armed instead (press
   * again to disarm) and spent by the next shot. A splitter needs no key: it is armed, and the fire press
   * during the flight splits the shot.
   */
  use(id: number): void {
    const host = this.host;
    if (!this.enabled || !host.canAim(id)) return;
    const p = host.players()[id];
    if (!p.powerUp || p.powerUp === 'splitter' || p.powerUp === 'shield' || p.powerUp === 'piercing') return;
    if (p.powerUp === 'preview' || p.powerUp === 'repulse') {
      p.armed = !p.armed;
      this.previewKey = '';
      return;
    }
    if (this.aiming(id)) this.choosing.delete(id);
    else this.choosing.add(id);
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
    if (kind === 'planetkiller') {
      const planet = aimedPlanet(world, from, p.angle, p.power);
      target = planet ? { x: planet.x, y: planet.y } : null;
    } else if (kind === 'nebula') {
      target = nebulaSpot(world, from, p.angle, p.power);
    } else {
      target = aimedSpot(world, from, p.angle, p.power);
    }
    return { owner, kind, target };
  }

  /** Whether the ship at this screen (or on turn) is aiming a placement. */
  get placing(): boolean {
    return !!this.placementAim();
  }

  /** Whether a given ship is aiming a placement. */
  placingFor(owner: number): boolean {
    return !!this.placementAim(owner);
  }

  /** Fire while aiming: the ship jumps, or the placement happens. False when there is no aim, or it lands nowhere. */
  confirmPlacement(by: number = this.aimer): boolean {
    const aim = this.placementAim(by);
    if (!aim?.target) return false;
    this.choosing.delete(by);
    if (aim.kind === 'blackhole') return this.plantBlackHole(aim.owner, aim.target);
    if (aim.kind === 'nebula') return this.plantNebula(aim.owner, aim.target);
    if (aim.kind === 'planetkiller') {
      const world = this.host.world();
      const p = this.host.players()[aim.owner];
      const planet = aimedPlanet(world, world.ships[aim.owner], p.angle, p.power);
      return planet ? this.killPlanet(aim.owner, planet.index) : false;
    }
    return this.teleport(aim.owner, aim.target);
  }

  cancelPlacement(by: number = this.aimer): boolean {
    const had = this.choosing.has(by);
    this.choosing.delete(by);
    return had;
  }

  /**
   * Plants a black hole at `spot`. It stays for the rest of the round: a fixed horizon that bends and
   * swallows shots, on top of the Event Horizon one when there is one.
   */
  private plantBlackHole(id: number, spot: { x: number; y: number }): boolean {
    const world = this.host.world();
    world.holes.push({ x: spot.x, y: spot.y, radius: POWER_UP.BLACKHOLE_RADIUS, mass: POWER_UP.BLACKHOLE_MASS });
    world.version++;
    this.host.players()[id].powerUp = null;
    this.host.players()[id].armed = false;
    this.host.clearCpuJobs();
    this.host.emit({ type: 'blackhole', player: id, x: spot.x, y: spot.y });
    // A pickup sitting where the hole now opens is swallowed, and the field is filled up again.
    this.sweep();
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
    world.version++;
    this.host.players()[id].powerUp = null;
    this.host.players()[id].armed = false;
    this.host.clearCpuJobs();
    this.host.emit({ type: 'planetKiller', player: id, x: planet.x, y: planet.y, radius: planet.radius });
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
    this.host.players()[id].powerUp = null;
    this.host.players()[id].armed = false;
    this.host.clearCpuJobs();
    this.host.emit({ type: 'nebula', player: id, x: spot.x, y: spot.y });
    return true;
  }

  /**
   * A CPU lays the placement it holds at the spot its own aim points at: no aim key, no confirm, and the
   * shot is the caller's to spend. It handles only the three placements a CPU lays; a teleport it plans
   * with, like a shot. False when it holds none of them, or the aim lands nowhere.
   */
  placeForCpu(id: number): boolean {
    const p = this.host.players()[id];
    const kind = p.powerUp;
    if (kind !== 'blackhole' && kind !== 'nebula' && kind !== 'planetkiller') return false;
    const world = this.host.world();
    const from = world.ships[id];
    if (kind === 'planetkiller') {
      const planet = aimedPlanet(world, from, p.angle, p.power);
      return planet ? this.killPlanet(id, planet.index) : false;
    }
    const spot = kind === 'nebula' ? nebulaSpot(world, from, p.angle, p.power) : aimedSpot(world, from, p.angle, p.power);
    if (!spot) return false;
    return kind === 'nebula' ? this.plantNebula(id, spot) : this.plantBlackHole(id, spot);
  }

  /** Teleports a ship to `spot`, or to a random free one; false when there is none. */
  teleport(id: number, spot: { x: number; y: number } | null = teleportSpot(this.host.world(), this.host.rng(), this.pickups)): boolean {
    if (!spot) return false;
    const ship = this.host.world().ships[id];
    const [fromX, fromY] = [ship.x, ship.y];
    ship.x = spot.x;
    ship.y = spot.y;
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
      const index = volley.shots.findIndex((vs) => vs.owner === who && !vs.shot.end);
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
      if (!p.cpu || !p.armed || p.powerUp !== 'splitter' || vs.shot.end || vs.shot.time < POWER_UP.CPU_SPLIT_MIN_TIME) continue;
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
   * The aims a player's shot launches with. An armed preview is used up by the shot, an armed repulse is used up
   * by pushing the shot away from the planets, and armor piercing rides the next shot through its targets; a
   * splitter waits for the fire press during the flight, a shield for a hit.
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
    if (p.powerUp === 'preview' || p.powerUp === 'repulse') {
      if (p.powerUp === 'repulse') aim.pull = -1;
      p.powerUp = null;
      p.armed = false;
    }
    return [aim];
  }

  // ————————————————————————————— Drawing —————————————————————————————

  /** What the renderer draws of the power-ups. */
  /** What a guest needs on top of the pickups. */
  state(): PowerUpState {
    return { pass: this.pass, placing: [...this.choosing] };
  }

  /** The host's pass and aimed placements, as a guest has them. */
  restoreState(state: PowerUpState | undefined): void {
    this.pass = state?.pass ?? 0;
    this.choosing = new Set(state?.placing ?? []);
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
