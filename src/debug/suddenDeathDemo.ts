import { createMatch, type ClassicMatch, type Match } from '../game';
import { DEFAULT_SETTINGS, type Seat } from '../data/settings';
import { SUDDEN_DEATH, type SuddenDeathKind } from '../sim/config';
import { SupernovaDemo } from './supernovaDemo';

/** What `?preview=` can play on a loop: the kind of sudden death to look at. */
export const SUDDEN_DEATH_PREVIEWS = ['supernova', 'gravity', 'collision', 'overcharge', 'meteors', 'ufos'] as const;
export type SuddenDeathPreview = (typeof SUDDEN_DEATH_PREVIEWS)[number];

/** A match that plays itself for the preview, one frame at a time. */
export interface SuddenDeathPreviewDemo {
  readonly match: Match;
  tick(dt: number): void;
}

/** Seconds each pass lingers before the demo ends it, how long a finished round stays on show, and how many passes of sudden death a loop shows. */
const PASS_PAUSE = 1;
const ROUND_SHOW = 4;
const LOOP_PASSES = 9;
/** The demo shots (gravity well, overcharge): how hard they are fired, and how many degrees wide of the next ship each aims. */
const SHOT_POWER = 62;
const MISS = { gravity: 9, overcharge: 5 } as const;

/**
 * Dev-only, `?preview=gravity`, `collision`, `overcharge`, `meteors` and `ufos`: a Classic round that starts two passes before sudden death
 * with this kind of it, so it can be looked at without playing ten passes first. Four ships that nobody steers. For the
 * gravity well and the overcharge they take turns to shoot a little wide of the next ship, so what sudden death does to
 * a shot (bends it in, or reaches out to it) grows visible from pass to pass; for the collision course and the finales
 * (the meteors, the UFOs) nobody shoots and the passes are ended one after another, so the drift together (or, after
 * pass 13, the shower or invasion that takes every ship) is all there is to see.
 */
export class SuddenDeathDemo implements SuddenDeathPreviewDemo {
  readonly match: ClassicMatch;
  private wait = 0;
  private shown = 0;
  private miss = 0;

  constructor(private readonly kind: Exclude<SuddenDeathKind, 'redGiant'>) {
    const seats: Seat[] = ['human', 'human', 'human', 'human', 'off', 'off'];
    this.match = createMatch('classic', { ...DEFAULT_SETTINGS, seats, rounds: 0, maxPlanets: 4, suddenDeath: true }, { seats, names: ['Ash', 'Bo', 'Cy', 'Di'], seed: 11 }) as ClassicMatch;
    this.prime();
  }

  /** The round skips on to two passes before sudden death, with its kind of it. */
  private prime(): void {
    this.match.debugSuddenDeath(this.kind);
    this.match.debugEndPass(SUDDEN_DEATH.START_PASS - 2);
    this.wait = 0;
    this.shown = 0;
  }

  /** One frame: start over once a finished round (or a full loop of passes) has been seen, and end the passes nobody shoots in. */
  tick(dt: number): void {
    const m = this.match;
    this.wait += dt;
    if (m.phase === 'roundOver') {
      if (this.wait < ROUND_SHOW) return;
      m.startRound();
      this.prime();
      return;
    }
    // The pause counts from when the ships are at rest again, not from when the last pass ended.
    if (m.phase !== 'aiming') this.wait = 0;
    if (m.phase !== 'aiming' || this.wait < PASS_PAUSE) return;
    this.wait = 0;
    if (this.kind === 'gravity' || this.kind === 'overcharge') return this.shoot();
    if (++this.shown > LOOP_PASSES) {
      m.startRound();
      this.prime();
      return;
    }
    m.debugEndPass();
  }

  /** The ship whose turn it is shoots at the next one, a little wide: only the pull of sudden death brings the shot home. */
  private shoot(): void {
    const m = this.match;
    const from = m.world.ships[m.current];
    const target = m.alive.find((p) => p.id > m.current) ?? m.alive.find((p) => p.id !== m.current);
    if (!target) return;
    const to = m.world.ships[target.id];
    const wide = this.kind === 'overcharge' ? MISS.overcharge : MISS.gravity;
    this.miss = this.miss > 0 ? -wide : wide;
    m.setAim((Math.atan2(from.y - to.y, to.x - from.x) * 180) / Math.PI + this.miss, SHOT_POWER);
    m.commit();
  }
}

/** The demo for `?preview=`, or null when it names none of them. */
export function createSuddenDeathPreview(name: string | null): SuddenDeathPreviewDemo | null {
  if (name === 'supernova') return new SupernovaDemo();
  if (name === 'gravity' || name === 'collision' || name === 'overcharge' || name === 'meteors' || name === 'ufos') return new SuddenDeathDemo(name);
  return null;
}
