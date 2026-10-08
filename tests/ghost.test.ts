import { describe, expect, it } from 'vitest';
import { GHOST } from '../src/config';
import { GhostLane, ghostSeed, laneSpec, multiplierFor } from '../src/ghost';
import { generateWorld } from '../src/world';

/** Runs the clock until the shot in the air has landed. */
function fly(lane: GhostLane): void {
  for (let i = 0; i < 20_000 && lane.phase === 'flying'; i++) lane.update(0.05);
}

/** Aims at the known solution of the lane and fires. */
function shootSolution(lane: GhostLane): void {
  const { angle, power } = lane.sector.solutions[0];
  lane.setAim(angle, power);
  lane.fire();
  fly(lane);
}

/** Aims straight up at full power — into the void. */
function shootAway(lane: GhostLane): void {
  lane.setAim(90, 100);
  // A straight-up shot can still be bent into a planet or the target; that is fine, we only need it not to hit.
  lane.fire();
  fly(lane);
}

const world = () => generateWorld(7, { maxPlanets: 4, players: 3, blackHole: false });

describe('ghost seed', () => {
  it('is the same for the same round and world, and differs between rounds and worlds', () => {
    expect(ghostSeed(2, world())).toBe(ghostSeed(2, world()));
    expect(ghostSeed(3, world())).not.toBe(ghostSeed(2, world()));
    expect(ghostSeed(2, generateWorld(8, { maxPlanets: 4, players: 3, blackHole: false }))).not.toBe(ghostSeed(2, world()));
  });
});

describe('lanes', () => {
  it('are the same for every ghost with the same seed', () => {
    const a = new GhostLane(1234);
    const b = new GhostLane(1234);
    for (let n = 0; n < 3; n++) {
      expect(a.world.ships).toEqual(b.world.ships);
      expect(a.world.planets).toEqual(b.world.planets);
      shootSolution(a);
      shootSolution(b);
      a.update(GHOST.PAUSE_CLEARED + 0.1);
      b.update(GHOST.PAUSE_CLEARED + 0.1);
    }
  });

  it('are small worlds of two or three planets and one target, getting harder', () => {
    for (let n = 0; n < 6; n++) {
      const spec = laneSpec(99, n);
      expect(spec.targets).toBe(1);
      expect(spec.planets).toEqual([2, 3]);
      expect(spec.shots).toBe(GHOST.SHOTS);
    }
    expect(laneSpec(99, 0).difficulty).toBeLessThan(laneSpec(99, 5).difficulty);
  });

  it('can always be solved', () => {
    for (let seed = 1; seed <= 4; seed++) {
      const lane = new GhostLane(seed);
      for (let n = 0; n < 4; n++) {
        shootSolution(lane);
        expect(lane.result?.kind).toBe('hit');
        lane.update(GHOST.PAUSE_CLEARED + 0.1);
      }
    }
  });
});

describe('shooting', () => {
  it('scores a first-shot hit and moves on to the next lane after a short rest', () => {
    const lane = new GhostLane(5);
    shootSolution(lane);
    expect(lane.phase).toBe('cleared');
    expect(lane.result).toMatchObject({ kind: 'hit', points: GHOST.HIT, streak: 1, multiplier: 1 });
    expect(lane.score).toBe(GHOST.HIT);
    lane.update(GHOST.PAUSE_CLEARED / 2);
    expect(lane.lane).toBe(0);
    lane.update(GHOST.PAUSE_CLEARED);
    expect(lane.lane).toBe(1);
    expect(lane.phase).toBe('aiming');
    expect(lane.shots).toBe(0);
  });

  it('raises the multiplier with every lane cleared in a row', () => {
    const lane = new GhostLane(5);
    shootSolution(lane);
    lane.update(GHOST.PAUSE_CLEARED + 0.1);
    shootSolution(lane);
    expect(lane.result).toMatchObject({ streak: 2, multiplier: 1.5 });
    expect(lane.score).toBeGreaterThan(2 * GHOST.HIT);
    expect(multiplierFor(1)).toBe(1);
    expect(multiplierFor(50)).toBe(GHOST.MAX_MULTIPLIER);
  });

  it('pays less for a later shot', () => {
    const lane = new GhostLane(5);
    shootAway(lane);
    expect(lane.result?.kind).not.toBe('hit');
    expect(lane.phase).toBe('aiming');
    expect(lane.shotsLeft).toBe(GHOST.SHOTS - 1);
    shootSolution(lane);
    expect(lane.result?.points).toBe(Math.round((GHOST.HIT * GHOST.SHOT_FACTOR[1]) / 10) * 10);
  });

  it('ends the series after the last miss and starts a new lane', () => {
    const lane = new GhostLane(5);
    shootSolution(lane);
    lane.update(GHOST.PAUSE_CLEARED + 0.1);
    expect(lane.streak).toBe(1);
    for (let i = 0; i < GHOST.SHOTS; i++) shootAway(lane);
    expect(lane.phase).toBe('failed');
    expect(lane.result?.kind).toBe('out');
    expect(lane.streak).toBe(0);
    expect(lane.bestStreak).toBe(1);
    const failedLane = lane.lane;
    lane.update(GHOST.PAUSE_FAILED + 0.1);
    expect(lane.lane).toBe(failedLane + 1);
    expect(lane.phase).toBe('aiming');
  });

  it('locks the aim and ignores a second shot while one is in the air', () => {
    const lane = new GhostLane(5);
    lane.setAim(30, 40);
    expect(lane.fire()).toBe(true);
    lane.adjust(10, 10);
    expect(lane.angle).toBe(30);
    expect(lane.power).toBe(40);
    expect(lane.fire()).toBe(false);
    expect(lane.shots).toBe(1);
  });

  it('keeps the aim in range', () => {
    const lane = new GhostLane(5);
    lane.setAim(-10, 150);
    expect(lane.angle).toBe(350);
    expect(lane.power).toBe(100);
    lane.setAim(0, -5);
    expect(lane.power).toBe(0);
  });

  it('numbers every result so a screen can tell a new one', () => {
    const lane = new GhostLane(5);
    shootAway(lane);
    const first = lane.result!.id;
    shootAway(lane);
    expect(lane.result!.id).toBe(first + 1);
  });
});
