import { describe, expect, it } from 'vitest';
import { planShotNow } from '../src/ai';
import { FIELD, HORIZON, PHYSICS } from '../src/config';
import { cloneWorld, Shot, simulateShot, type Planet, type World } from '../src/physics';
import { createRng } from '../src/rng';
import { comboMultiplier, scoreHit, scoreHorizonKill } from '../src/scoring';
import { Volley } from '../src/volley';
import { generateWorld } from '../src/world';

const rules = { bounce: false, timeLimit: 20 };

function emptyWorld(ships: [number, number][] = [[100, 400], [1180, 400]]): World {
  return {
    width: FIELD.width,
    height: FIELD.height,
    planets: [],
    ships: ships.map(([x, y]) => ({ x, y, alive: true })),
    hole: null,
    version: 0,
  };
}

const planet = (x: number, y: number, radius: number): Planet => ({ x, y, radius, mass: radius ** 3, seed: x * 31 + y, style: 'rocky', tint: '#fff' });

describe('shot physics', () => {
  it('flies straight without planets and hits the opposite ship', () => {
    expect(simulateShot(emptyWorld(), 0, 0, 50, rules).end).toEqual({ kind: 'ship', ship: 1 });
  });

  it('is deterministic for the same world and aim', () => {
    const world = generateWorld(1234, { maxPlanets: 5, players: 2, blackHole: false });
    expect(simulateShot(world, 0, 17.25, 63.5, rules)).toEqual(simulateShot(world, 0, 17.25, 63.5, rules));
  });

  it('bends towards a planet', () => {
    const world = emptyWorld();
    world.planets.push(planet(640, 520, 40));
    const shot = new Shot(world, 0, 0, 50, rules);
    while (shot.x < 1000 && !shot.step());
    expect((Math.atan2(shot.vy, shot.vx) * 180) / Math.PI).toBeGreaterThan(15);
  });

  it('counts a shot as lost once it leaves the field, unless edges reflect', () => {
    expect(simulateShot(emptyWorld(), 0, 90, 60, rules).end.kind).toBe('lost');
    const bounced = simulateShot(emptyWorld(), 0, 90, 60, { bounce: true, timeLimit: 3 });
    expect(['timeout', 'ship']).toContain(bounced.end.kind);
  });

  it('passes through ships that are already destroyed', () => {
    const world = emptyWorld([[100, 400], [640, 400], [1180, 400]]);
    world.ships[1].alive = false;
    expect(simulateShot(world, 0, 0, 50, rules).end).toEqual({ kind: 'ship', ship: 2 });
  });

  it('flies straight through the ships it is told to spare', () => {
    const world = emptyWorld([[100, 400], [600, 400], [1180, 400]]);
    const shot = new Shot(world, 0, 0, 50, rules, false, [1]);
    let end = shot.step();
    while (!end) end = shot.step();
    expect(end).toEqual({ kind: 'ship', ship: 2 });
  });

  it('swallows shots that cross the event horizon', () => {
    const world = emptyWorld();
    world.hole = { x: 640, y: 400, radius: HORIZON.START_RADIUS, mass: HORIZON.START_MASS };
    expect(simulateShot(world, 0, 0, 40, rules).end.kind).toBe('hole');
  });
});

describe('trick-shot detection', () => {
  it('logs a swing-by when a planet bends the shot hard', () => {
    const world = emptyWorld();
    world.planets.push(planet(640, 500, 45));
    const shot = new Shot(world, 0, 0, 45, { bounce: false, timeLimit: 10 }, true);
    while (!shot.step());
    expect(shot.style!.map((e) => e.kind)).toContain('swingby');
  });

  it('logs every bank off a reflecting edge', () => {
    const shot = new Shot(emptyWorld(), 0, 80, 70, { bounce: true, timeLimit: 3 }, true);
    while (!shot.step());
    expect(shot.style!.filter((e) => e.kind === 'bank').length).toBeGreaterThanOrEqual(2);
  });

  it('stacks multipliers and caps them', () => {
    expect(comboMultiplier([])).toBe(1);
    expect(comboMultiplier(['swingby', 'bank'])).toBeCloseTo(1.875);
    expect(comboMultiplier(['photon', 'photon', 'photon'])).toBe(12);
    expect(scoreHorizonKill(50, ['swingby'], false).points).toBe(1500);
  });
});

describe('volleys', () => {
  it('annihilates projectiles that meet head-on', () => {
    const world = emptyWorld();
    const volley = new Volley(world, [{ player: 0, angle: 0, power: 50 }, { player: 1, angle: 180, power: 50 }], rules, false);
    while (!volley.done) volley.step();
    expect(volley.shots.map((s) => s.shot.end?.kind)).toEqual(['clash', 'clash']);
    expect(world.ships.every((s) => s.alive)).toBe(true);
  });

  it('keeps who is spared in its snapshot, so guests and killcams fly the same shots', () => {
    const world = emptyWorld([[100, 400], [600, 400], [1180, 400]]);
    const volley = new Volley(world, [{ player: 0, angle: 0, power: 50, spare: [1] }], rules, false);
    expect(volley.snapshot().aims).toEqual([{ player: 0, angle: 0, power: 50, spare: [1] }]);
  });

  it('replays a volley exactly from a snapshot (killcam)', () => {
    const world = generateWorld(77, { maxPlanets: 6, players: 5, blackHole: true });
    const aims = world.ships.map((_, i) => ({ player: i, angle: i * 61 + 13.37, power: 35 + i * 9 }));
    const run = () => {
      const v = new Volley(cloneWorld(world), aims, { bounce: true, timeLimit: HORIZON.SHOT_TIME }, true);
      const log: string[] = [];
      while (!v.done) for (const e of v.step()) log.push(`${v.steps}:${e.index}:${e.type === 'end' ? e.end.kind : e.event.kind}`);
      return { log, ends: v.shots.map((s) => [s.shot.x, s.shot.y]), alive: v.world.ships.map((s) => s.alive) };
    };
    expect(run()).toEqual(run());
  });
});

describe('world generation', () => {
  it('keeps planets clear of ships, of each other and of the black hole', () => {
    for (let seed = 1; seed < 120; seed++) {
      for (const players of [2, 3, 4, 6]) {
        for (const blackHole of [false, true]) {
          const w = generateWorld(seed, { maxPlanets: 8, players, blackHole });
          expect(w.ships).toHaveLength(players);
          expect(w.planets.length).toBeGreaterThanOrEqual(2);
          for (const s of w.ships) {
            expect(s.x).toBeGreaterThan(40);
            expect(s.x).toBeLessThan(FIELD.width - 40);
            expect(s.y).toBeGreaterThan(125); // clear of the scoreboard
            expect(s.y).toBeLessThan(FIELD.height - 40);
          }
          for (const p of w.planets) {
            if (players > 2 || blackHole) expect(p.y - p.radius).toBeGreaterThan(110); // clear of the scoreboard
            for (const s of w.ships) expect(Math.hypot(p.x - s.x, p.y - s.y)).toBeGreaterThan(p.radius + PHYSICS.SHIP_RADIUS + 50);
            for (const q of w.planets) if (q !== p) expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeGreaterThan(p.radius + q.radius);
            if (w.hole) expect(Math.hypot(p.x - w.hole.x, p.y - w.hole.y)).toBeGreaterThan(p.radius + w.hole.radius + 50);
          }
        }
      }
    }
  });

  it('spreads many ships apart', () => {
    const w = generateWorld(5, { maxPlanets: 4, players: 6, blackHole: true });
    for (const a of w.ships) for (const b of w.ships) if (a !== b) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(150);
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
    const seeds = 16;
    for (let seed = 1; seed <= seeds; seed++) {
      const world = generateWorld(seed * 7919, { maxPlanets: 5, players: 2, blackHole: false });
      // Late attempt on "hard" → practically no aim error.
      const aim = planShotNow(world, 0, { rules, level: 'hard', attempt: 30, fixedPower: null, rng: createRng(seed) });
      if (simulateShot(world, 0, aim.angle, aim.power, rules).end.kind === 'ship') hits++;
    }
    expect(hits).toBeGreaterThanOrEqual(seeds * 0.8);
  });

  it('hits some enemy in a crowded black-hole arena', () => {
    const horizonRules = { bounce: true, timeLimit: HORIZON.SHOT_TIME };
    let hits = 0;
    const seeds = 10;
    for (let seed = 1; seed <= seeds; seed++) {
      const world = generateWorld(seed * 104729, { maxPlanets: 4, players: 5, blackHole: true });
      const aim = planShotNow(world, 2, { rules: horizonRules, level: 'hard', attempt: 30, fixedPower: null, rng: createRng(seed), effort: 0.6 });
      const end = simulateShot(world, 2, aim.angle, aim.power, horizonRules).end;
      if (end.kind === 'ship' && end.ship !== 2) hits++;
    }
    expect(hits).toBeGreaterThanOrEqual(seeds * 0.7);
  });
});

describe('teams', () => {
  it('lines two teams up left vs right', () => {
    for (let seed = 1; seed < 40; seed++) {
      const w = generateWorld(seed, { maxPlanets: 4, players: 4, blackHole: false, teams: [0, 1, 0, 1] });
      const avg = (team: number) => w.ships.filter((_, i) => i % 2 === team).reduce((s, sh) => s + sh.x, 0) / 2;
      expect(avg(0)).toBeLessThan(FIELD.width / 2);
      expect(avg(1)).toBeGreaterThan(FIELD.width / 2);
    }
  });

  it('never plans a shot into a teammate', () => {
    // Teammate parked on the direct line to the enemy.
    const world = emptyWorld([[100, 400], [640, 400], [1180, 400]]);
    for (let seed = 1; seed <= 5; seed++) {
      const aim = planShotNow(world, 0, { rules, level: 'hard', attempt: 30, fixedPower: null, rng: createRng(seed), friends: [1] });
      const end = simulateShot(world, 0, aim.angle, aim.power, rules, [1]).end;
      expect(end).not.toEqual({ kind: 'ship', ship: 1 });
    }
  });
});
