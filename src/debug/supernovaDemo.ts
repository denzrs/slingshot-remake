import { createMatch, type SolarMatch } from '../game';
import { DEFAULT_SETTINGS, type Seat } from '../data/settings';
import { SUDDEN_DEATH } from '../sim/config';
import { onOrbit } from '../sim/world';

/** Seconds each pass lingers before the demo ends it, and how long the remnant stays on show before it starts over. */
const PASS_PAUSE = 1;
const REMNANT_SHOW = 9;

/**
 * Dev-only, opened with ?preview=supernova: a Solar System's sudden death plays out on its own, over and over, so the
 * red giant, the supernova and what it leaves can be looked at without playing a game to pass 13. Four ships that
 * nobody steers (so nobody shoots); one rides close to the sun, so the giant swallows it on the way.
 */
export class SupernovaDemo {
  readonly match: SolarMatch;
  private wait = 0;

  constructor() {
    const seats: Seat[] = ['human', 'human', 'human', 'human', 'off', 'off'];
    this.match = createMatch('solar', { ...DEFAULT_SETTINGS, seats, rounds: 0, maxPlanets: 6, suddenDeath: true }, { seats, names: ['Ash', 'Bo', 'Cy', 'Di'], seed: 7 }) as SolarMatch;
    this.prime();
  }

  /** The round skips on to two passes before sudden death, with one ship on an orbit the red giant will reach. */
  private prime(): void {
    Object.assign(this.match.world.ships[3], onOrbit(70, 2.2));
    this.match.debugEndPass(SUDDEN_DEATH.START_PASS - 2);
    this.wait = 0;
  }

  /** One frame: end each pass once it has been seen, and start over once the remnant has been. */
  tick(dt: number): void {
    const m = this.match;
    if (m.phase !== 'aiming' && m.phase !== 'roundOver') return;
    this.wait += dt;
    if (m.phase === 'roundOver') {
      if (this.wait < REMNANT_SHOW) return;
      m.startRound();
      this.prime();
      return;
    }
    if (this.wait < PASS_PAUSE) return;
    this.wait = 0;
    m.debugEndPass();
  }
}
