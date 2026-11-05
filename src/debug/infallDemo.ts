import { createMatch, type HorizonMatch } from '../game';
import { DEFAULT_SETTINGS, type Seat } from '../data/settings';

/** Seconds between the end of one fall and the next. */
const PAUSE = 1;

/**
 * Dev-only, opened with ?preview=infall: the black hole eats three planets of different sizes and a ship, over and
 * over, so the fall can be looked at without playing a game until it happens. Nobody steers (so nobody shoots).
 */
export class InfallDemo {
  readonly match: HorizonMatch;
  private wait = 0;

  constructor() {
    const seats: Seat[] = ['human', 'human', 'human', 'human', 'off', 'off'];
    this.match = createMatch('horizon', { ...DEFAULT_SETTINGS, seats, rounds: 0, maxPlanets: 6 }, { seats, names: ['Ash', 'Bo', 'Cy', 'Di'], seed: 7 }) as HorizonMatch;
    this.prime();
  }

  /** A fresh round, with what is to fall put close to the hole and started down. */
  private prime(): void {
    const { world } = this.match;
    const hole = world.holes[0];
    hole.radius = 42;
    hole.mass = 600_000;
    const near = [[92, -0.6], [108, 2.2], [84, 3.6]] as const;
    world.planets.slice(0, near.length).forEach((p, i) => {
      p.radius = [24, 44, 16][i];
      p.x = hole.x + near[i][0] * Math.cos(near[i][1]);
      p.y = hole.y + near[i][0] * Math.sin(near[i][1]);
    });
    Object.assign(world.ships[3], { x: hole.x + 66, y: hole.y + 62 });
    world.version++;
    this.match.debugCollapse();
    this.wait = 0;
  }

  /** One frame: start over once the last fall has been seen. */
  tick(dt: number): void {
    const m = this.match;
    if (m.phase === 'collapse') return;
    this.wait += dt;
    if (this.wait < PAUSE) return;
    m.startRound();
    this.prime();
  }
}
