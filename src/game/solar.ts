import { FIELD, SOLAR, SOLAR_STORM } from '../sim/config';
import type { Nebula } from '../sim/physics';
import { createRng, intRange, range, type Rng } from '../sim/rng';
import { onOrbit, orbitOf, orbitTurn } from '../sim/world';
import { ClassicMatch } from './classic';

/**
 * "Sonnensystem" — Classic's rules in a system that never stands still. A sun sits in the middle, the planets
 * and the ships ride orbits round it, and after every pass (once every ship still in has fired, or after a volley
 * with simultaneous shots) the whole system turns on: a circle takes 4 passes near the sun, 8 in the middle and
 * 12 far out. So the gravity field changes under everyone's feet. Once in a round the sun bursts in a storm that
 * throws plasma clouds over the field; a few passes later they thin away again.
 */
export class SolarMatch extends ClassicMatch {
  readonly mode = 'solar';

  /** How far into the turn the system has got (eased, 0 → 1): the turn is applied in small steps as it plays. */
  private turned = 0;
  /** The ships that have fired in the pass under way, the passes this round has had, and the one after which the sun bursts. */
  private fired = new Set<number>();
  private passes = 0;
  private stormAt = 0;
  private stormRng: Rng = createRng(0);

  startRound(): void {
    super.startRound();
    this.fired.clear();
    this.passes = 0;
    // Its own stream, so the storm never changes what the world's generator or the twists draw.
    this.stormRng = createRng(this.worldSeed ^ 0x5702a);
    this.stormAt = intRange(this.stormRng, SOLAR_STORM.FIRST_PASS, SOLAR_STORM.LAST_PASS);
  }

  protected afterVolley(): void {
    // Nothing turns once the round is decided.
    if (this.decided) return super.afterVolley();
    // A volley is every ship's shot at once; otherwise the ships shoot one after another.
    if (this.salvo) for (const p of this.alive) this.fired.add(p.id);
    else this.fired.add(this.current);
    // The system waits until the pass is over: everybody still in has had a shot.
    if (this.alive.some((p) => !this.fired.has(p.id))) return super.afterVolley();
    this.fired.clear();
    // The shots' trails point at where things were: they would mislead.
    this.trails = [];
    this.turned = 0;
    if (++this.passes === this.stormAt) this.erupt();
    // The storm has run its course: the clouds thin away through this turn.
    if (this.passes === this.stormAt + SOLAR_STORM.LIFETIME) for (const n of this.world.nebulae) if (n.storm) n.fading = true;
    this.setPhase('orbit');
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
    const t = Math.min(1, this.phaseTime / SOLAR.TURN_TIME);
    const eased = t * t * (3 - 2 * t);
    this.turn(eased - this.turned);
    this.turned = eased;
    if (t < 1) return;
    // The clouds that were thinning away are gone.
    this.world.nebulae = this.world.nebulae.filter((n) => !n.fading);
    this.world.version++;
    super.afterVolley();
  }

  /** Turns everything that rides an orbit by `share` of a step. */
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
    for (const p of this.alive) move(world.ships[p.id], true);
    for (const pickup of this.pickups) move(pickup, true);
  }
}
