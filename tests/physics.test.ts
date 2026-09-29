import { describe, expect, it } from 'vitest';
import { planShotNow } from '../src/ai';
import { FIELD, PHYSICS } from '../src/config';
import { Shot, simulateShot, type World } from '../src/physics';
import { createRng } from '../src/rng';
import { scoreHit } from '../src/scoring';
import { generateWorld } from '../src/world';

const rules = { bounce: false, timeLimit: 20 };

function emptyWorld(): World {
  return {
    width: FIELD.width,
    height: FIELD.height,
    planets: [],
    ships: [{ x: 100, y: 400 }, { x: 1180, y: 400 }],
  };
}

describe('shot physics', () => {
  it('flies straight without planets and hits the opposite ship', () => {
    const out = simulateShot(emptyWorld(), 0, 0, 50, rules);
    expect(out.end).toEqual({ kind: 'ship', ship: 1 });
  });

  it('is deterministic for the same world and aim', () => {
    const world = generateWorld(1234, 5);
    const a = simulateShot(world, 0, 17.25, 63.5, rules);
    const b = simulateShot(world, 0, 17.25, 63.5, rules);
    expect(a).toEqual(b);
  });

  it('bends towards a planet', () => {
    const world = emptyWorld();
    world.planets.push({ x: 640, y: 520, radius: 40, mass: 40 ** 3, seed: 1, style: 'rocky', tint: '#fff' });
    const shot = new Shot(world, 0, 0, 50, rules);
    while (shot.x < 1000 && !shot.step());
    const bendDeg = (Math.atan2(shot.vy, shot.vx) * 180) / Math.PI;
    expect(bendDeg).toBeGreaterThan(15);
  });

  it('counts a shot as lost once it leaves the field, unless edges reflect', () => {
    const lost = simulateShot(emptyWorld(), 0, 90, 60, rules);
    expect(lost.end.kind).toBe('lost');
    const bounced = simulateShot(emptyWorld(), 0, 90, 60, { bounce: true, timeLimit: 3 });
    expect(['timeout', 'ship']).toContain(bounced.end.kind);
  });
});

describe('world generation', () => {
  it('keeps planets clear of ships and of each other', () => {
    for (let seed = 1; seed < 200; seed++) {
      const w = generateWorld(seed, 8);
      expect(w.planets.length).toBeGreaterThanOrEqual(2);
      for (const p of w.planets) {
        for (const s of w.ships) expect(Math.hypot(p.x - s.x, p.y - s.y)).toBeGreaterThan(p.radius + PHYSICS.SHIP_RADIUS + 50);
        for (const q of w.planets) if (q !== p) expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeGreaterThan(p.radius + q.radius);
      }
    }
  });
});

describe('scoring', () => {
  it('rewards fewer shots and less power', () => {
    expect(scoreHit(1, 50, false).points).toBe(1000);
    expect(scoreHit(1, 20, false).points).toBeGreaterThan(scoreHit(1, 80, false).points);
    expect(scoreHit(2, 50, false).points).toBeGreaterThan(scoreHit(5, 50, false).points);
    expect(scoreHit(20, 100, false).points).toBeGreaterThan(0);
    expect(scoreHit(1, 90, true).points).toBe(1000);
  });
});

describe('cpu planner', () => {
  it('finds hits on most battlefields when aiming without error', () => {
    let hits = 0;
    const seeds = 20;
    const t0 = performance.now();
    for (let seed = 1; seed <= seeds; seed++) {
      const world = generateWorld(seed * 7919, 5);
      // Late attempt on "hard" → practically no aim error.
      const aim = planShotNow(world, 0, { rules, level: 'hard', attempt: 30, fixedPower: null, rng: createRng(seed) });
      if (simulateShot(world, 0, aim.angle, aim.power, rules).end.kind === 'ship') hits++;
    }
    const ms = (performance.now() - t0) / seeds;
    console.log(`cpu: ${hits}/${seeds} hits, ${ms.toFixed(0)} ms per plan`);
    expect(hits).toBeGreaterThanOrEqual(seeds * 0.8);
  });
});
