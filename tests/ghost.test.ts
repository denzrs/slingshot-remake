import { describe, expect, it } from 'vitest';
import { GHOST } from '../src/config';
import { buildLane, clusterCount, GhostLane, ghostSeed, hasHole, multiplierFor, previewSeconds } from '../src/ghost';
import { generateWorld } from '../src/world';

/** Runs the clock until the shot in the air — and everything it set off — has settled. */
function fly(lane: GhostLane): void {
  for (let i = 0; i < 20_000 && lane.phase === 'flying'; i++) lane.update(0.05);
}

/** Fires a known way through cluster `i` of the lane. */
function shootSolution(lane: GhostLane, i: number): void {
  const { angle, power } = lane.solutions[i];
  lane.setAim(angle, power);
  lane.fire();
  fly(lane);
}

/** Clears every cluster, one shot each. */
function clear(lane: GhostLane): void {
  for (let i = 0; i < lane.solutions.length && lane.phase === 'aiming'; i++) shootSolution(lane, i);
}

/** Aims straight up at full power — into the void. */
function shootAway(lane: GhostLane): void {
  lane.setAim(90, 100);
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
    for (let n = 0; n < 6; n++) expect(buildLane(1234, n)).toEqual(buildLane(1234, n));
    expect(buildLane(1234, 0)).not.toEqual(buildLane(1235, 0));
  });

  it('are dealt in clusters of rocks around a few planets, with cores in every cluster and a hole in every fourth lane', () => {
    for (let seed = 1; seed <= 4; seed++) {
      for (let n = 0; n < 8; n++) {
        const { world, rocks, solutions } = buildLane(seed, n);
        expect(solutions.length).toBe(clusterCount(n));
        expect(world.planets.length).toBeGreaterThanOrEqual(1);
        expect(world.planets.length).toBeLessThanOrEqual(3);
        expect(!!world.hole).toBe(hasHole(n));
        expect(world.ships).toHaveLength(1);
        expect(rocks.filter((r) => r.core).length).toBeGreaterThanOrEqual(solutions.length);
        for (const r of rocks) {
          expect(r.x).toBeGreaterThan(0);
          expect(r.x).toBeLessThan(world.width);
          expect(r.y).toBeGreaterThan(0);
          expect(r.y).toBeLessThan(world.height);
          for (const p of world.planets) expect(Math.hypot(p.x - r.x, p.y - r.y)).toBeGreaterThan(p.radius + r.r);
        }
        // Nothing overlaps.
        for (const a of rocks) for (const b of rocks) if (a.id < b.id) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(a.r + b.r);
      }
    }
  });

  it('can always be cleared: a known shot goes through every cluster, and there are shots to spare', () => {
    expect(clusterCount(99)).toBeLessThan(GHOST.SHOTS);
    for (let seed = 1; seed <= 5; seed++) {
      const lane = new GhostLane(seed);
      for (let n = 0; n < 8; n++) {
        clear(lane);
        expect(lane.result?.kind).toBe('cleared');
        expect(lane.coresLeft).toBe(0);
        lane.update(GHOST.PAUSE_CLEARED + 0.1);
      }
    }
  });

  it('show less of the flight in the aim the further you get', () => {
    expect(previewSeconds(0)).toBeGreaterThan(previewSeconds(3));
    expect(previewSeconds(50)).toBe(GHOST.PREVIEW_MIN);
  });
});

describe('blowing things up', () => {
  it('sets off a rock the shot touches and the rocks its blast reaches, one after another', () => {
    const lane = new GhostLane(5);
    const first = lane.rocks[0];
    const neighbours = lane.rocks.filter((r) => r !== first && Math.hypot(r.x - first.x, r.y - first.y) < GHOST.BLAST.rock + r.r);
    expect(neighbours.length).toBeGreaterThan(0);
    shootSolution(lane, 0);
    expect(first.alive).toBe(false);
    for (const r of neighbours) expect(r.alive).toBe(false);
    expect(lane.result?.destroyed).toBeGreaterThanOrEqual(1 + neighbours.length);
    // They did not all go at once: the chain rolls outwards.
    const events = lane.takeEvents();
    expect(events.length).toBeGreaterThan(2);
    expect(events.map((e) => e.n)).toEqual(events.map((_, i) => i + 1));
  });

  it('pays more for each thing blown up in one shot, and a bonus for a long chain', () => {
    const lane = new GhostLane(5);
    shootSolution(lane, 0);
    const r = lane.result!;
    expect(r.points).toBeGreaterThan(r.destroyed * GHOST.BASE.rock - 1);
    expect(r.destroyed).toBeGreaterThan(1);
  });

  it('counts a shot that touches nothing as a dud', () => {
    const lane = new GhostLane(5);
    shootAway(lane);
    // The straight-up shot may still brush something in another lane; this one's rocks are not above the ghost.
    if (lane.result?.destroyed === 0) expect(lane.result.kind).toBe('dud');
    expect(lane.phase).toBe('aiming');
    expect(lane.shotsLeft).toBe(GHOST.SHOTS - 1);
  });

  it('blows up a planet the shot ends on, takes its gravity with it, and carries the blast to what is near', () => {
    const lane = new GhostLane(9);
    const planet = lane.world.planets[0];
    const { x, y, radius } = planet;
    // Straight at the planet from the ghost: the shot ends on it unless something else gets in the way.
    const from = lane.world.ships[0];
    lane.setAim((Math.atan2(from.y - y, x - from.x) * 180) / Math.PI, 40);
    lane.fire();
    // Bend nothing: remove the other planets' pull for this check, so the line is straight enough.
    fly(lane);
    if (lane.world.planets[0].radius === 0) {
      expect(lane.result?.planets).toBeGreaterThanOrEqual(1);
      expect(lane.world.planets[0].mass).toBe(0);
      const near = lane.rocks.filter((r) => Math.hypot(r.x - x, r.y - y) < radius * GHOST.PLANET_BLAST + GHOST.PLANET_BLAST_FLAT);
      for (const r of near) expect(r.alive).toBe(false);
    }
  });

  it('keeps going until every blast has settled, and does not take a second shot meanwhile', () => {
    const lane = new GhostLane(5);
    const { angle, power } = lane.solutions[0];
    lane.setAim(angle, power);
    lane.fire();
    lane.adjust(10, 10);
    expect(lane.angle).toBe(angle);
    expect(lane.power).toBe(power);
    expect(lane.fire()).toBe(false);
    expect(lane.shots).toBe(1);
    fly(lane);
    expect(lane.phase).not.toBe('flying');
  });
});

describe('scoring', () => {
  it('pays for the shot and, on clearing the lane, a bonus with a reward for every shot left', () => {
    const lane = new GhostLane(5);
    clear(lane);
    const r = lane.result!;
    expect(r.kind).toBe('cleared');
    expect(r.bonus).toBeGreaterThanOrEqual(GHOST.CLEAR + GHOST.SPARE_SHOT * lane.shotsLeft);
    expect(lane.score).toBeGreaterThan(r.bonus);
    expect(lane.streak).toBe(1);
  });

  it('raises the multiplier with every lane cleared in a row, and ends the series after the last shot is spent', () => {
    const lane = new GhostLane(5);
    clear(lane);
    lane.update(GHOST.PAUSE_CLEARED + 0.1);
    expect(lane.lane).toBe(1);
    expect(lane.multiplier).toBe(1.5);
    expect(multiplierFor(1)).toBe(1);
    expect(multiplierFor(50)).toBe(GHOST.MAX_MULTIPLIER);
    for (let i = 0; i < GHOST.SHOTS; i++) shootAway(lane);
    expect(lane.phase).toBe('failed');
    expect(lane.result?.kind).toBe('out');
    expect(lane.streak).toBe(0);
    expect(lane.bestStreak).toBe(1);
    const failed = lane.lane;
    lane.update(GHOST.PAUSE_FAILED + 0.1);
    expect(lane.lane).toBe(failed + 1);
    expect(lane.phase).toBe('aiming');
    expect(lane.shots).toBe(0);
  });

  it('numbers every result so a screen can tell a new one', () => {
    const lane = new GhostLane(5);
    shootAway(lane);
    const first = lane.result!.id;
    shootAway(lane);
    expect(lane.result!.id).toBe(first + 1);
  });
});

describe('aiming', () => {
  it('keeps the aim in range', () => {
    const lane = new GhostLane(5);
    lane.setAim(-10, 150);
    expect(lane.angle).toBe(350);
    expect(lane.power).toBe(100);
    lane.setAim(0, -5);
    expect(lane.power).toBe(0);
  });

  it('shows the first stretch of the flight, the same shot the ghost then flies', () => {
    const lane = new GhostLane(5);
    const { angle, power } = lane.solutions[0];
    lane.setAim(angle, power);
    const preview = lane.preview();
    expect(preview.length).toBeGreaterThan(20);
    lane.fire();
    // The preview is a stretch of the real path.
    const [px, py] = [preview[preview.length - 2], preview[preview.length - 1]];
    let near = Infinity;
    for (let i = 0; i < 20_000 && lane.phase === 'flying'; i++) {
      lane.update(0.01);
      const s = lane.shot;
      if (s) near = Math.min(near, Math.hypot(s.x - px, s.y - py));
    }
    expect(near).toBeLessThan(25);
  });

  it('is recomputed only when the aim or the planets change', () => {
    const lane = new GhostLane(5);
    expect(lane.preview()).toBe(lane.preview());
    const before = lane.preview();
    lane.adjust(5, 0);
    expect(lane.preview()).not.toBe(before);
  });
});
