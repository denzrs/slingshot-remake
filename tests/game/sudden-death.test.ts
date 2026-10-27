import { describe, expect, it } from 'vitest';
import { ClassicMatch, createMatch, SolarMatch } from '../../src/game';
import { FIELD, SOLAR, SUDDEN_DEATH } from '../../src/sim/config';
import { DEFAULT_SETTINGS, type Seat } from '../../src/data/settings';
import { simulateShot, type Ship, type World } from '../../src/sim/physics';
import { onOrbit } from '../../src/sim/world';

const cpus = (n: number): Seat[] => [...Array(n).fill('medium'), ...Array(6 - n).fill('off')];
const play = (mode: 'classic' | 'solar', seed: number, players = 3, suddenDeath = true) => {
  const seats = cpus(players);
  return createMatch(mode, { ...DEFAULT_SETTINGS, rounds: 1, seats, suddenDeath }, { seats, seed, deterministicCpu: true });
};

type Inner = { passes: number; fired: Set<number>; afterVolley(): void };
/** Ends the pass under way, as if every ship still in had just fired. */
const endPass = (match: ClassicMatch, passes: number): void => {
  const inner = match as unknown as Inner;
  inner.passes = passes - 1;
  inner.fired = new Set(match.alive.map((p) => p.id));
  inner.afterVolley();
};
/** Lets the system turn until it has. */
const turn = (match: ClassicMatch): void => {
  for (let t = 0; t < 10 && match.phase === 'orbit'; t += 1 / 30) match.update(1 / 30);
};

describe('a ship pulling shots in', () => {
  const world = (ships: Ship[]): World => ({ width: FIELD.width, height: FIELD.height, planets: [], ships, holes: [], nebulae: [], wormholes: [], defenses: [], version: 0 });
  const rules = { bounce: false, timeLimit: 20 };
  // A shot straight to the right, passing well above the second ship.
  const closest = (pull: number | undefined, teams: [number | null, number | null] = [null, null]): number =>
    simulateShot(world([
      { x: 100, y: 200, alive: true, pull, team: teams[0] },
      { x: 600, y: 330, alive: true, pull, team: teams[1] },
    ]), 0, 0, 50, rules).closest;

  it('bends an enemy\'s shot towards it', () => {
    expect(closest(SUDDEN_DEATH.PULL_STEP * SUDDEN_DEATH.PULL_STEPS)).toBeLessThan(closest(undefined) - 20);
  });

  it('leaves its teammates\' shots alone', () => {
    expect(closest(SUDDEN_DEATH.PULL_STEP * SUDDEN_DEATH.PULL_STEPS, [0, 0])).toBeCloseTo(closest(undefined), 6);
  });
});

describe('sudden death in Classic', () => {
  it('counts down, then has every ship pull a little harder each pass, up to a limit', () => {
    const match = play('classic', 3) as ClassicMatch;
    try {
      expect(match.suddenDeathIn).toBe(SUDDEN_DEATH.START_PASS);
      endPass(match, SUDDEN_DEATH.START_PASS - 1);
      expect(match.suddenDeathIn).toBe(1);
      expect(match.world.ships.some((s) => s.pull)).toBe(false);
      endPass(match, SUDDEN_DEATH.START_PASS);
      expect(match.suddenDeathIn).toBe(0);
      expect(match.world.ships.every((s) => s.pull === SUDDEN_DEATH.PULL_STEP)).toBe(true);
      endPass(match, SUDDEN_DEATH.START_PASS + 1);
      expect(match.world.ships.every((s) => s.pull === SUDDEN_DEATH.PULL_STEP * 2)).toBe(true);
      endPass(match, SUDDEN_DEATH.START_PASS + SUDDEN_DEATH.PULL_STEPS + 5);
      expect(match.world.ships.every((s) => s.pull === SUDDEN_DEATH.PULL_STEP * SUDDEN_DEATH.PULL_STEPS)).toBe(true);
    } finally {
      match.dispose();
    }
  });

  it('never comes while the rule is off', () => {
    const match = play('classic', 3, 3, false) as ClassicMatch;
    try {
      expect(match.suddenDeathIn).toBeNull();
      endPass(match, SUDDEN_DEATH.START_PASS + 3);
      expect(match.world.ships.some((s) => s.pull)).toBe(false);
    } finally {
      match.dispose();
    }
  });

  it('starts over with the next round', () => {
    const seats = cpus(2);
    const match = createMatch('classic', { ...DEFAULT_SETTINGS, rounds: 2, seats }, { seats, seed: 4, deterministicCpu: true }) as ClassicMatch;
    try {
      endPass(match, SUDDEN_DEATH.START_PASS);
      match.startRound();
      expect(match.suddenDeathIn).toBe(SUDDEN_DEATH.START_PASS);
      expect(match.world.ships.some((s) => s.pull)).toBe(false);
    } finally {
      match.dispose();
    }
  });
});

describe('sudden death in a Solar System', () => {
  it('swells the sun to a red giant over its turns, swallowing what it reaches', () => {
    const match = play('solar', 5, 3) as SolarMatch;
    try {
      const sun = match.world.planets.find((p) => p.sun)!;
      // A ship riding close round the sun is inside the first size the giant swells to, wherever its orbit takes it.
      Object.assign(match.world.ships[2], onOrbit(50, 1));
      endPass(match, SUDDEN_DEATH.START_PASS);
      expect(match.phase).toBe('orbit');
      turn(match);
      expect(sun.radius).toBeCloseTo(SUDDEN_DEATH.GIANT_RADII[0], 6);
      expect(sun.mass).toBeCloseTo(SOLAR.SUN_MASS * SUDDEN_DEATH.GIANT_MASS, 3);
      expect(sun.giant).toBeCloseTo(1 / SUDDEN_DEATH.GIANT_RADII.length, 6);
      expect(match.players[2].alive).toBe(false);
      expect(match.lastKill).toMatchObject({ killer: null, victim: 2, points: 0 });
      // Nothing else is left inside it.
      for (const p of match.world.planets) if (!p.sun) expect(Math.hypot(p.x - sun.x, p.y - sun.y)).toBeGreaterThanOrEqual(sun.radius + p.radius * 0.5);
    } finally {
      match.dispose();
    }
  });

  it('gives nobody the round when the sun swallows a ship and leaves one standing', () => {
    const match = play('solar', 5, 2) as SolarMatch;
    try {
      const scores = match.players.map((p) => p.score);
      Object.assign(match.world.ships[1], onOrbit(50, 1));
      endPass(match, SUDDEN_DEATH.START_PASS);
      turn(match);
      expect(match.phase).toBe('roundOver');
      expect(match.players[0].alive).toBe(true);
      expect(match.summary).toMatchObject({ title: 'swallowed', survivor: null, team: null, bonus: 0 });
      expect(match.players.map((p) => p.score)).toEqual(scores);
    } finally {
      match.dispose();
    }
  });

  it('goes supernova the pass after it has grown, and the round ends with nobody left and no points', () => {
    const match = play('solar', 6, 3) as SolarMatch;
    try {
      const scores = match.players.map((p) => p.score);
      const blasts: unknown[] = [];
      match.on((e) => e.type === 'supernova' && blasts.push(e));
      endPass(match, SUDDEN_DEATH.START_PASS + SUDDEN_DEATH.GIANT_RADII.length);
      // Every ship is out at once, and the screen is told where they stood, to blow each up as the wave gets there.
      expect(match.alive).toHaveLength(0);
      expect(blasts).toEqual([expect.objectContaining({ ships: [0, 1, 2].map((ship) => expect.objectContaining({ ship })) })]);
      // The banner waits until the shockwave has swept the field.
      expect(match.blasting).toBe(true);
      expect(match.phase).toBe('orbit');
      for (let t = 0; t < SUDDEN_DEATH.NOVA_HOLD - 0.2; t += 1 / 30) match.update(1 / 30);
      expect(match.phase).toBe('orbit');
      turn(match);
      expect(match.phase).toBe('roundOver');
      expect(match.summary).toMatchObject({ title: 'supernova', survivor: null, team: null, bonus: 0 });
      expect(match.players.map((p) => p.score)).toEqual(scores);
    } finally {
      match.dispose();
    }
  });

  it('never comes while the rule is off', () => {
    const match = play('solar', 6, 3, false) as SolarMatch;
    try {
      endPass(match, SUDDEN_DEATH.START_PASS + SUDDEN_DEATH.GIANT_RADII.length);
      turn(match);
      expect(match.phase).not.toBe('roundOver');
      expect(match.world.planets.find((p) => p.sun)!.radius).toBe(SOLAR.SUN_RADIUS);
      // Nor does the Classic pull, in a Solar System.
      expect(match.world.ships.some((s) => s.pull)).toBe(false);
    } finally {
      match.dispose();
    }
  });
});
