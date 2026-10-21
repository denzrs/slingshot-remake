import { describe, expect, it } from 'vitest';
import { createMatch, type Match } from '../src/game';
import { aimedSpot, blackHoleFits, POWER_UP } from '../src/powerups';
import { Shot, type World } from '../src/physics';
import { DEFAULT_SETTINGS } from '../src/settings';

const rules = { bounce: false, timeLimit: 20 };

/** A human duel with power-ups on, no planets, so flights are straight and predictable. */
function duel(seed = 7): Match {
  const seats = ['human', 'human', 'off', 'off', 'off', 'off'] as const;
  return createMatch('classic', { ...DEFAULT_SETTINGS, powerUps: true, rounds: 1, maxPlanets: 0, seats: [...seats] }, { seats: [...seats], seed });
}

describe('black hole power-up', () => {
  it('is aimed like a teleport, and fire plants a hole at the spot and spends the shot', () => {
    const match = duel();
    const shooter = match.players[match.current];
    shooter.powerUp = 'blackhole';
    const events: string[] = [];
    match.on((e) => events.push(e.type));

    match.usePowerUp();
    expect(match.placing).toBe(true);
    expect(match.scene().placement!.kind).toBe('blackhole');
    const aimed = match.scene().placement!.target!;
    expect(match.world.holes).toHaveLength(0);

    match.commit();
    expect(match.world.holes).toHaveLength(1);
    expect(match.world.holes[0].x).toBeCloseTo(aimed.x, 5);
    expect(match.world.holes[0].y).toBeCloseTo(aimed.y, 5);
    expect(match.world.holes[0].radius).toBe(POWER_UP.BLACKHOLE_RADIUS);
    expect(match.world.holes[0].mass).toBe(POWER_UP.BLACKHOLE_MASS);
    expect(shooter.powerUp).toBeNull();
    expect(match.placing).toBe(false);
    expect(events).toContain('blackhole');
    // Planting spent the shot: the turn moves on and the ship fires nothing.
    expect(shooter.passed).toBe(true);
    expect(match.phase).toBe('aiming');
  });

  it('lets a ship think again before planting, and keeps the power-up', () => {
    const match = duel();
    const shooter = match.players[match.current];
    shooter.powerUp = 'blackhole';
    match.usePowerUp();
    expect(match.placing).toBe(true);
    match.usePowerUp();
    expect(match.placing).toBe(false);
    expect(match.world.holes).toHaveLength(0);
    expect(shooter.powerUp).toBe('blackhole');
  });
});

describe('a second black hole on the field', () => {
  const ship = { x: 200, y: 400, alive: true };
  const world: World = {
    width: 1280,
    height: 800,
    planets: [],
    ships: [ship, { x: 1100, y: 400, alive: true }],
    // A negligible hole out of the way, then the one the shot flies into: the index names which.
    holes: [
      { x: 1200, y: 720, radius: 5, mass: 1 },
      { x: 700, y: 400, radius: 30, mass: 220_000 },
    ],
    nebulae: [], wormholes: [], defenses: [],
    version: 0,
  };

  it('swallows a shot that crosses it, and reports which hole it was', () => {
    const shot = new Shot(world, 0, 0, 100, rules);
    let end = null;
    while (!(end = shot.step()));
    expect(end.kind).toBe('hole');
    expect(end.kind === 'hole' && end.hole).toBe(1);
  });

  it('does not swallow a shot that flies clear of every hole', () => {
    // Due west, away from both holes.
    const shot = new Shot(world, 0, 180, 20, rules);
    let end = null;
    while (!(end = shot.step()));
    expect(end.kind).not.toBe('hole');
  });

  it('never aims a new hole at a spot that is inside an existing one', () => {
    const from = { x: 200, y: 400 };
    const target = aimedSpot(world, from, 0, 100);
    if (target) {
      for (const hole of world.holes) {
        expect(Math.hypot(target.x - hole.x, target.y - hole.y)).toBeGreaterThanOrEqual(hole.radius + POWER_UP.HOLE_GAP - 1e-6);
      }
    }
  });
});

describe('black hole placement near players', () => {
  it('refuses a spot closer than the gap to another ship, and allows it far away or on its owner', () => {
    const world = { ships: [{ x: 100, y: 100, alive: true }, { x: 400, y: 100, alive: true }, { x: 150, y: 100, alive: false }] } as World;
    const near = { x: 400 + POWER_UP.BLACKHOLE_PLAYER_GAP - 1, y: 100 };
    const far = { x: 400 + POWER_UP.BLACKHOLE_PLAYER_GAP, y: 100 };
    expect(blackHoleFits(world, near, 0)).toBe(false);
    expect(blackHoleFits(world, far, 0)).toBe(true);
    // Its own ship does not count, nor does a dead one.
    expect(blackHoleFits(world, { x: 110, y: 100 }, 0)).toBe(true);
  });
});
