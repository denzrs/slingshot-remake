import { SOLAR } from '../config';
import { orbitTurn, solarCenter } from '../world';
import { ClassicMatch } from './classic';

/**
 * "Sonnensystem" — Classic's rules in a system that never stands still. A sun sits in the middle, the planets
 * and the ships ride orbits round it, and after every shot (or every volley with simultaneous shots) the whole
 * system turns on, the inner orbits quicker than the outer ones. So the gravity field changes under everyone's feet.
 */
export class SolarMatch extends ClassicMatch {
  readonly mode = 'solar';

  /** How far into the turn the system has got (eased, 0 → 1): the turn is applied in small steps as it plays. */
  private turned = 0;

  protected afterVolley(): void {
    // Nothing turns once the round is decided.
    if (this.decided) return super.afterVolley();
    // The shots' trails point at where things were: they would mislead.
    this.trails = [];
    this.turned = 0;
    this.setPhase('orbit');
  }

  protected updatePhase(dt: number): void {
    if (this.phase !== 'orbit') return super.updatePhase(dt);
    const t = Math.min(1, this.phaseTime / SOLAR.TURN_TIME);
    const eased = t * t * (3 - 2 * t);
    this.turn(eased - this.turned);
    this.turned = eased;
    if (t < 1) return;
    this.world.version++;
    super.afterVolley();
  }

  /** Turns everything that rides an orbit by `share` of a step. */
  private turn(share: number): void {
    const centre = solarCenter();
    const world = this.world;
    const move = (o: { x: number; y: number }): void => {
      const dx = o.x - centre.x;
      const dy = o.y - centre.y;
      const a = orbitTurn(Math.hypot(dx, dy)) * share;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      o.x = centre.x + dx * cos - dy * sin;
      o.y = centre.y + dx * sin + dy * cos;
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
    for (const p of this.alive) move(world.ships[p.id]);
    for (const pickup of this.pickups) move(pickup);
  }
}
