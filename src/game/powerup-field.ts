import type { ShotRules, World } from '../physics';
import { CPU_IGNORES, pickKind, POWER_UP, previewPath, SPLIT_TURNS, spawnPickup, teleportCandidates, teleportSpot, touchedPickups, type Pickup, type PowerUpKind } from '../powerups';
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

/** A spot a ship may teleport to, as the renderer and the pointer see it. */
export interface TeleportSpots {
  owner: number;
  spots: { x: number; y: number }[];
  choice: number;
}

/** What the renderer draws of the power-ups. */
export interface PowerUpScene {
  pickups: readonly Pickup[];
  /** The pass the round is in, so the renderer can tell which pickups are about to fade. */
  pass: number;
  /** The armed preview's path while aiming. */
  preview: number[] | null;
  /** The offered teleport spots while a ship is choosing. */
  teleport: TeleportSpots | null;
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
  private choosing: TeleportSpots | null = null;

  constructor(private readonly host: PowerUpHost) {}

  get enabled(): boolean {
    return this.host.enabled();
  }

  /** How many pickups lie on the field: a round starts with that many and a taken one is replaced; one more may be laid. */
  private get amount(): number {
    return Math.max(1, this.host.amount());
  }

  // ————————————————————————————— Pickups —————————————————————————————

  /** A new round: the old pickups and choices are gone, and the first pickups are laid. */
  startRound(): void {
    this.pickups = [];
    this.pass = 0;
    this.volleysThisPass = 0;
    this.choosing = null;
    if (this.enabled) for (let i = 0; i < this.amount; i++) this.spawn();
  }

  /**
   * Sets a pickup on the path of a ship — often the one that is behind, so the field leans towards catching up.
   * Round start and refills are silent; the caller announces the others.
   */
  private spawn(): Pickup | null {
    if (this.pickups.length > this.amount) return null;
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
   * A volley is over. Once a whole pass has gone by, old pickups fade and a new one appears; and the field is
   * never left short of pickups, so a taken one is replaced at once.
   */
  onVolleyEnd(): void {
    if (!this.enabled) return;
    if (++this.volleysThisPass >= Math.max(1, this.host.volleysPerPass())) {
      this.volleysThisPass = 0;
      this.pass++;
      const kept = this.pickups.filter((p) => this.pass - p.born < POWER_UP.LIFETIME_PASSES);
      for (const gone of this.pickups.filter((p) => !kept.includes(p))) this.host.emit({ type: 'pickupFade', kind: gone.kind, x: gone.x, y: gone.y });
      this.pickups = kept;
      this.announce(this.spawn());
    }
    while (this.pickups.length < this.amount) {
      const fresh = this.spawn();
      if (!fresh) break;
      this.announce(fresh);
    }
  }

  /** The black hole has grown: pickups it has swallowed are gone, and the field is filled up again. */
  sweep(): void {
    const hole = this.host.world().hole;
    if (!this.enabled || !hole) return;
    const swallowed = this.pickups.filter((p) => Math.hypot(p.x - hole.x, p.y - hole.y) < hole.radius + POWER_UP.PICKUP_RADIUS);
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
      // A CPU has no use for a preview or a repulse, so it leaves those lying.
      const hit = touchedPickups(this.pickups, vs.shot.x, vs.shot.y).find((i) => !(p.cpu && CPU_IGNORES.has(this.pickups[i].kind)));
      if (hit === undefined) continue;
      const [pickup] = this.pickups.splice(hit, 1);
      const dropped = p.powerUp;
      p.powerUp = pickup.kind;
      // A splitter and a shield need no key: they are ready from the start. A CPU holds everything armed.
      p.armed = p.cpu !== null || pickup.kind === 'splitter' || pickup.kind === 'shield';
      // The shield is on the ship itself, so every shot in the volley meets it. Swapping it away takes it off.
      volley.setShield(p.id, pickup.kind === 'shield');
      this.host.emit({ type: 'pickup', player: p.id, kind: pickup.kind, x: pickup.x, y: pickup.y, dropped });
      this.host.record((book) => bump(book.pickups, p.id));
    }
  }

  // ————————————————————————————— Using them —————————————————————————————

  /**
   * The power-up key. A teleport offers a few spots to choose from (press again for the next, fire to jump,
   * Esc to think again). A preview is armed instead (press again to disarm) and spent by the next shot. A
   * splitter needs no key: it is armed, and the fire press during the flight splits the shot.
   */
  use(id: number): void {
    const host = this.host;
    if (!this.enabled || !host.canAim(id)) return;
    const p = host.players()[id];
    if (!p.powerUp || p.powerUp === 'splitter' || p.powerUp === 'shield') return;
    if (p.powerUp === 'preview' || p.powerUp === 'repulse') {
      p.armed = !p.armed;
      this.previewKey = '';
      return;
    }
    const open = this.teleportSpots();
    if (open && open.owner === id) {
      // One stop past the last spot means "stay": the next fire press just closes the choice.
      open.choice = (open.choice + 1) % (open.spots.length + 1);
      return;
    }
    const world = host.world();
    const spots = teleportCandidates(world, host.rng(), this.pickups, POWER_UP.TELEPORT_CHOICES, world.ships[id]);
    if (spots.length) this.choosing = { owner: id, spots, choice: 0 };
    else this.teleport(id);
  }

  /** The offered teleport spots (`choice` past the last one means "stay"), while the ship that is choosing can still jump. */
  private teleportSpots(): TeleportSpots | null {
    const c = this.choosing;
    if (c && this.host.phase() === 'aiming' && this.host.players()[c.owner]?.powerUp === 'teleport' && this.host.canAim(c.owner)) return c;
    this.choosing = null;
    return null;
  }

  /** Whether the ship on turn is choosing where to jump. */
  get teleporting(): boolean {
    return !!this.teleportSpots();
  }

  /** Fire while choosing: the ship jumps to the spot picked — or, on the "stay" stop, nobody jumps and the choice closes. */
  confirmTeleport(): boolean {
    const c = this.teleportSpots();
    if (!c) return false;
    this.choosing = null;
    if (c.choice < c.spots.length) this.teleport(c.owner, c.spots[c.choice]);
    return true;
  }

  cancelTeleport(): boolean {
    const had = !!this.teleportSpots();
    this.choosing = null;
    return had;
  }

  /** A number key while choosing: spot `index` (0-based) is picked and the ship jumps there. False if there is no such spot. */
  chooseTeleportIndex(index: number): boolean {
    const c = this.teleportSpots();
    if (!c || index < 0 || index >= c.spots.length) return false;
    c.choice = index;
    return this.confirmTeleport();
  }

  /** A click or tap at a point of the field: on an offered spot it jumps there. */
  chooseTeleportAt(x: number, y: number): boolean {
    const c = this.teleportSpots();
    if (!c) return false;
    const index = c.spots.findIndex((s) => Math.hypot(s.x - x, s.y - y) <= POWER_UP.TELEPORT_PICK_RADIUS);
    if (index < 0) return false;
    c.choice = index;
    return this.confirmTeleport();
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
   * by pushing the shot away from the planets; a splitter waits for the fire press during the flight, a shield
   * for a hit.
   */
  aimsFor(p: PlayerState): VolleyAim[] {
    const aim: VolleyAim = { player: p.id, angle: p.angle, power: p.power, spare: this.host.sparedFor(p.id) };
    if (this.enabled && p.armed && (p.powerUp === 'preview' || p.powerUp === 'repulse')) {
      if (p.powerUp === 'repulse') aim.pull = -1;
      p.powerUp = null;
      p.armed = false;
    }
    return [aim];
  }

  // ————————————————————————————— Drawing —————————————————————————————

  /** What the renderer draws of the power-ups. */
  scene(): PowerUpScene {
    return { pickups: this.pickups, pass: this.pass, preview: this.armedPreview(), teleport: this.teleportSpots() };
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
