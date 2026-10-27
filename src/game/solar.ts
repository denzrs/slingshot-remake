import { FIELD, PHYSICS, SOLAR, SOLAR_STORM, SUDDEN_DEATH } from '../sim/config';
import type { Nebula, Planet } from '../sim/physics';
import { createRng, intRange, range, type Rng } from '../sim/rng';
import { onOrbit, orbitOf, orbitTurn } from '../sim/world';
import { ClassicMatch, type ClassicSnapshot } from './classic';
import type { RoundTitle, SuddenDeathKind } from './match';

/** How the red giant grows through the turn under way. */
interface Swelling {
  fromRadius: number;
  toRadius: number;
  fromMass: number;
  toMass: number;
  fromGiant: number;
  toGiant: number;
}

export interface SolarSnapshot extends ClassicSnapshot {
  /** Hosts from before sudden death send none. */
  solar?: { turned: number; swelling: Swelling | null; nova: boolean; blasting: boolean };
}

/**
 * "Sonnensystem" — Classic's rules in a system that never stands still. A sun sits in the middle, the planets
 * and the ships ride orbits round it, and after every pass (once every ship still in has fired, or after a volley
 * with simultaneous shots) the whole system turns on: a circle takes 4 passes near the sun, 8 in the middle and
 * 12 far out. So the gravity field changes under everyone's feet. Once in a round the sun bursts in a storm that
 * throws plasma clouds over the field; a few passes later they thin away again. With sudden death, a round that drags
 * on sees the sun swell to a red giant that swallows what it reaches, and then go supernova, which leaves nobody.
 */
export class SolarMatch extends ClassicMatch {
  readonly mode = 'solar';

  /** How far into the turn the system has got (eased, 0 → 1): the turn is applied in small steps as it plays. */
  private turned = 0;
  /** The pass after which the sun bursts in a storm. */
  private stormAt = 0;
  private stormRng: Rng = createRng(0);
  /** Sudden death: how the red giant grows through the turn under way. */
  private swelling: Swelling | null = null;
  /** Sudden death: the sun went supernova and took every ship with it. */
  private nova = false;
  /** The supernova's shockwave is still sweeping the field: the round ends once it has. */
  blasting = false;

  startRound(): void {
    this.swelling = null;
    this.nova = false;
    this.blasting = false;
    super.startRound();
    this.drawStorm();
  }

  /** Its own stream, so the storm never changes what the world's generator or the twists draw. */
  private drawStorm(): void {
    this.stormRng = createRng(this.worldSeed ^ 0x5702a);
    this.stormAt = intRange(this.stormRng, SOLAR_STORM.FIRST_PASS, SOLAR_STORM.LAST_PASS);
  }

  snapshot(): SolarSnapshot {
    return { ...super.snapshot(), solar: { turned: this.turned, swelling: this.swelling, nova: this.nova, blasting: this.blasting } };
  }

  restoreSnapshot(snapshot: SolarSnapshot): void {
    super.restoreSnapshot(snapshot);
    this.drawStorm();
    this.turned = snapshot.solar?.turned ?? 0;
    this.swelling = snapshot.solar?.swelling ?? null;
    this.nova = snapshot.solar?.nova ?? false;
    this.blasting = snapshot.solar?.blasting ?? false;
  }

  protected get suddenDeathKinds(): readonly SuddenDeathKind[] {
    return ['redGiant'];
  }

  /** The system turns once a pass is over (and only then; nothing turns once the round is decided). */
  protected endPass(): boolean {
    // The shots' trails point at where things were: they would mislead.
    this.trails = [];
    this.turned = 0;
    if (this.passes === this.stormAt) this.erupt();
    // The storm has run its course: the clouds thin away through this turn.
    if (this.passes === this.stormAt + SOLAR_STORM.LIFETIME) for (const n of this.world.nebulae) if (n.storm) n.fading = true;
    // Sudden death: the sun grows through the turns of its red giant, and at the pass after them goes supernova.
    if (super.endPass()) return true;
    this.setPhase('orbit');
    return true;
  }

  protected suddenDeathPass(step: number): void {
    if (this.suddenDeathKind !== 'redGiant') return super.suddenDeathPass(step);
    if (step <= SUDDEN_DEATH.GIANT_RADII.length) this.swell(step);
  }

  protected finale(): boolean {
    if (this.suddenDeathKind !== 'redGiant') return super.finale();
    this.supernova();
    return true;
  }

  private get sun(): Planet | undefined {
    return this.world.planets.find((p) => p.sun);
  }

  /** The sun grows to its next size as the system turns. */
  private swell(step: number): void {
    const sun = this.sun;
    if (!sun) return;
    this.swelling = {
      fromRadius: sun.radius,
      toRadius: SUDDEN_DEATH.GIANT_RADII[step - 1],
      fromMass: sun.mass,
      toMass: sun.mass * SUDDEN_DEATH.GIANT_MASS,
      fromGiant: sun.giant ?? 0,
      toGiant: step / SUDDEN_DEATH.GIANT_RADII.length,
    };
  }

  /** What the growing sun touches is gone: planets (and the defenses on them), pickups, and ships. Checked all through its turn. */
  private swallow(): void {
    const sun = this.sun;
    if (!sun) return;
    const reach = (o: { x: number; y: number }, margin: number): boolean => Math.hypot(o.x - sun.x, o.y - sun.y) < sun.radius + margin;
    const eaten = this.world.planets.filter((p) => !p.sun && reach(p, p.radius * 0.5));
    for (const p of eaten) this.emit({ type: 'devour', x: p.x, y: p.y, toX: sun.x, toY: sun.y, color: p.tint, vx: 0, vy: 0 });
    if (eaten.length) {
      this.world.planets = this.world.planets.filter((p) => !eaten.includes(p));
      this.world.defenses = this.world.defenses.filter((d) => this.world.planets.some((p) => p.seed === d.planet));
      this.world.version++;
    }
    const gone = this.pickups.filter((pickup) => reach(pickup, 0));
    for (const pickup of gone) this.emit({ type: 'pickupFade', kind: pickup.kind, x: pickup.x, y: pickup.y });
    if (gone.length) this.pickups = this.pickups.filter((pickup) => !gone.includes(pickup));
    for (const p of this.players) {
      const ship = this.world.ships[p.id];
      if (!p.alive || !reach(ship, PHYSICS.SHIP_RADIUS)) continue;
      // The hull bursts in the heat, and what is left of it is drawn into the sun.
      this.emit({ type: 'explode', x: ship.x, y: ship.y, ship: p.id, vx: 0, vy: 0 });
      this.emit({ type: 'devour', x: ship.x, y: ship.y, toX: sun.x, toY: sun.y, color: p.color, vx: 0, vy: 0 });
      this.takeShip(p.id, 'sun');
    }
  }

  /**
   * The red giant blows apart and takes every ship still in: the round ends without a winner. What is left is a
   * neutron star, in the nebula of what the star threw off. The ships are out at once; the screen blows each one up as the shockwave gets to it. The wave shatters
   * the planets too, each as it gets there, and the round's banner waits until it has swept the field.
   */
  private supernova(): void {
    const sun = this.sun ?? { x: FIELD.width / 2, y: FIELD.height / 2 };
    this.nova = true;
    const doomed = this.players.filter((p) => p.alive);
    this.emit({
      type: 'supernova',
      x: sun.x,
      y: sun.y,
      ships: doomed.map((p) => ({ ship: p.id, x: this.world.ships[p.id].x, y: this.world.ships[p.id].y, angle: p.angle })),
      planets: this.world.planets.filter((p) => !p.sun).map((p) => ({ x: p.x, y: p.y, radius: p.radius, color: p.tint })),
    });
    if (this.sun) {
      this.sun.radius = SUDDEN_DEATH.NEUTRON_RADIUS;
      this.sun.giant = 0;
      this.sun.neutron = true;
      this.world.version++;
    }
    for (const p of doomed) this.takeShip(p.id, 'sun');
    this.blasting = true;
    this.setPhase('orbit');
  }

  /** The supernova's shockwave takes each planet (and the defense on it) as it gets there. */
  private shatter(): void {
    const sun = this.sun;
    if (!sun) return;
    const front = SUDDEN_DEATH.NOVA_SPEED * this.phaseTime;
    const kept = this.world.planets.filter((p) => p.sun || Math.hypot(p.x - sun.x, p.y - sun.y) > front);
    if (kept.length === this.world.planets.length) return;
    this.world.planets = kept;
    this.world.defenses = this.world.defenses.filter((d) => kept.some((p) => p.seed === d.planet));
    this.world.version++;
  }

  /** A round the sun decides — by swallowing a ship, or going supernova — has no winner, even with a ship left in it. */
  protected roundTitle(survivor: number | null): RoundTitle {
    if (this.nova) return 'supernova';
    if (this.environmentDecided) return 'swallowed';
    return super.roundTitle(survivor);
  }

  /**
   * The sun bursts: a few clouds of plasma land round it, away from each other. They stay a few passes (or until the
   * round ends), and scramble each shot with a brief electric kick as it enters. No shot flies while the system turns,
   * so the clouds are in place before anybody aims.
   */
  private erupt(): void {
    const world = this.world;
    const rng = this.stormRng;
    const clouds: Nebula[] = [];
    const wanted = intRange(rng, SOLAR_STORM.MIN_CLOUDS, SOLAR_STORM.MAX_CLOUDS);
    for (let tries = 0; tries < 60 && clouds.length < wanted; tries++) {
      const radius = range(rng, SOLAR_STORM.MIN_RADIUS, SOLAR_STORM.MAX_RADIUS);
      const spot = onOrbit(range(rng, SOLAR_STORM.MIN_DIST, SOLAR_STORM.MAX_DIST), rng() * Math.PI * 2);
      const inside = spot.x > radius * 0.4 && spot.x < FIELD.width - radius * 0.4 && spot.y > radius * 0.4 && spot.y < FIELD.height - radius * 0.4;
      if (!inside || clouds.some((c) => Math.hypot(c.x - spot.x, c.y - spot.y) < (c.radius + radius) * SOLAR_STORM.OVERLAP)) continue;
      clouds.push({ ...spot, radius, seed: rng(), storm: true });
    }
    world.nebulae.push(...clouds);
    world.version++;
  }

  protected updatePhase(dt: number): void {
    if (this.phase !== 'orbit') return super.updatePhase(dt);
    if (this.blasting) {
      this.shatter();
      if (this.phaseTime < SUDDEN_DEATH.NOVA_HOLD) return;
      this.blasting = false;
      return this.endRound();
    }
    const k = Math.min(1, this.phaseTime / SOLAR.TURN_TIME);
    const eased = k * k * (3 - 2 * k);
    this.turn(eased - this.turned);
    this.turned = eased;
    const swelling = this.swelling;
    const sun = this.sun;
    if (swelling && sun) {
      sun.radius = swelling.fromRadius + (swelling.toRadius - swelling.fromRadius) * eased;
      sun.mass = swelling.fromMass + (swelling.toMass - swelling.fromMass) * eased;
      sun.giant = swelling.fromGiant + (swelling.toGiant - swelling.fromGiant) * eased;
      // Whatever it touches on the way is gone, not only what lies inside it once it has grown.
      this.swallow();
    }
    if (k < 1) return;
    // The clouds that were thinning away are gone.
    this.world.nebulae = this.world.nebulae.filter((n) => !n.fading);
    this.world.version++;
    this.swelling = null;
    // A planted black hole may have come round onto a pickup.
    this.power.sweep();
    if (this.decided) this.endRound();
    else this.nextTurn();
  }

  /** Turns everything that rides an orbit by `share` of a step: the bodies, the ships, the pickups and what the power-ups planted. */
  private turn(share: number): void {
    const world = this.world;
    const move = (o: { x: number; y: number }, free = false): void => {
      const { r, a } = orbitOf(o.x, o.y);
      const to = onOrbit(r, a + orbitTurn(r) * share);
      // What was dropped off its orbit (a teleported ship, a pickup) is kept on the field.
      o.x = free ? Math.min(FIELD.width - 24, Math.max(24, to.x)) : to.x;
      o.y = free ? Math.min(FIELD.height - 24, Math.max(24, to.y)) : to.y;
    };
    for (const p of world.planets) {
      if (p.sun) continue;
      const [ox, oy] = [p.x, p.y];
      move(p);
      // A defense stands on its planet and rides with it.
      for (const d of world.defenses) {
        if (d.planet !== p.seed) continue;
        d.x += p.x - ox;
        d.y += p.y - oy;
      }
    }
    // A ship whose person is away still rides along, so it is back where its orbit has taken it.
    for (const p of this.players) if (p.alive) move(world.ships[p.id], true);
    for (const pickup of this.pickups) move(pickup, true);
    // What the power-ups planted rides along too; each wormhole mouth on its own orbit. The storm's clouds stay where they broke out.
    for (const hole of world.holes) move(hole, true);
    for (const n of world.nebulae) if (!n.storm) move(n, true);
    for (const w of world.wormholes) {
      const [a, b] = [{ x: w.ax, y: w.ay }, { x: w.bx, y: w.by }];
      move(a, true);
      move(b, true);
      [w.ax, w.ay, w.bx, w.by] = [a.x, a.y, b.x, b.y];
    }
  }
}
