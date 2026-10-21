import { describe, expect, it } from 'vitest';
import { createMatch, SolarMatch } from '../src/game';
import { SOLAR } from '../src/config';
import { DEFAULT_SETTINGS, type Seat } from '../src/settings';
import { generateWorld, orbitTurn, solarCenter } from '../src/world';

const cpus = (n: number): Seat[] => [...Array(n).fill('medium'), ...Array(6 - n).fill('off')];
const dist = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(a.x - b.x, a.y - b.y);

describe('solar system world', () => {
  it.each([2, 3, 4, 6])('puts the sun in the middle and every body on a clear orbit with %i ships', (players) => {
    for (let seed = 1; seed <= 60; seed++) {
      const world = generateWorld(seed, { maxPlanets: 6, players, blackHole: false, solar: true });
      const centre = solarCenter();
      const sun = world.planets[0];
      expect(sun.sun).toBe(true);
      expect(dist(sun, centre)).toBe(0);
      expect(world.ships).toHaveLength(players);
      // Even a full table leaves room for planets.
      expect(world.planets.length).toBeGreaterThanOrEqual(5);
      // Turning the system any amount never brings two bodies closer than they are now on their orbits: compare orbit radii.
      const bodies = [
        ...world.planets.slice(1).map((p) => ({ r: dist(p, centre), reach: p.radius })),
        ...world.ships.map((s) => ({ r: dist(s, centre), reach: SOLAR.SHIP_BAND / 2 })),
      ];
      for (const b of bodies) {
        expect(b.r - b.reach).toBeGreaterThan(sun.radius);
        expect(b.r + b.reach).toBeLessThan(SOLAR.OUTER_ORBIT + 1);
      }
      for (let i = 0; i < bodies.length; i++) {
        for (let j = i + 1; j < bodies.length; j++) {
          const gap = Math.abs(bodies[i].r - bodies[j].r);
          // Bodies on one orbit keep their distance; others never get nearer than their orbits are apart.
          if (gap > 0.01) expect(gap).toBeGreaterThan(bodies[i].reach + bodies[j].reach);
        }
      }
    }
  });

  it('turns the inner orbits quicker', () => {
    expect(orbitTurn(100)).toBeGreaterThan(orbitTurn(200));
    expect(orbitTurn(200)).toBeGreaterThan(orbitTurn(300));
  });
});

describe('solar system match', () => {
  it('turns the planets and ships round the sun after a volley, keeping their orbits', () => {
    const seats = cpus(3);
    const match = createMatch('solar', { ...DEFAULT_SETTINGS, rounds: 1, seats }, { seats, seed: 5, deterministicCpu: true });
    try {
      expect(match).toBeInstanceOf(SolarMatch);
      const centre = solarCenter();
      const radii = () => [...match.world.planets.map((p) => dist(p, centre)), ...match.world.ships.map((s) => dist(s, centre))];
      const before = radii();
      const sun = { ...match.world.planets[0] };
      const first = { ...match.world.planets[1] };
      let turned = false;
      for (let t = 0; t < 400 && match.phase !== 'roundOver'; t += 1 / 30) {
        match.update(1 / 30);
        if (match.phase === 'orbit') turned = true;
        if (match.phase === 'killcam') match.advance();
      }
      expect(turned).toBe(true);
      expect(match.world.planets[0].x).toBe(sun.x);
      expect(match.world.planets[0].y).toBe(sun.y);
      if (match.world.planets[1].seed === first.seed) expect(dist(match.world.planets[1], first)).toBeGreaterThan(1);
      radii().forEach((r, i) => expect(r).toBeCloseTo(before[i], 3));
    } finally {
      match.dispose();
    }
  });

  it('plays a round to its end with CPUs', () => {
    const seats = cpus(2);
    const match = createMatch('solar', { ...DEFAULT_SETTINGS, rounds: 1, seats }, { seats, seed: 9, deterministicCpu: true });
    try {
      for (let t = 0; t < 900 && match.phase !== 'gameOver'; t += 1 / 30) {
        match.update(1 / 30);
        if (match.phase === 'roundOver') match.advance();
      }
      expect(match.phase).toBe('gameOver');
    } finally {
      match.dispose();
    }
  });
});
