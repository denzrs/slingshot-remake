import { describe, expect, it } from 'vitest';
import { createMatch, infallAt, type HorizonMatch } from '../../src/game';
import { DEFAULT_SETTINGS, type Seat } from '../../src/data/settings';

function duel(): HorizonMatch {
  const seats: Seat[] = ['human', 'human', 'human', 'off', 'off', 'off'];
  return createMatch('horizon', { ...DEFAULT_SETTINGS, seats, rounds: 0 }, { seats, names: ['A', 'B', 'C'], seed: 3 }) as HorizonMatch;
}

/** A match whose ship 2 and first planet are about to be eaten. */
function doomed(): HorizonMatch {
  const match = duel();
  const hole = match.world.holes[0];
  Object.assign(match.world.ships[2], { x: hole.x + hole.radius + 20, y: hole.y });
  Object.assign(match.world.planets[0], { x: hole.x - hole.radius - 30, y: hole.y, radius: 20 });
  return match;
}

describe('falling into the black hole', () => {
  it('spirals in from where it stood to the middle, turning the way the disk does', () => {
    expect(infallAt(100, 0, 0, 0, 0)).toEqual({ x: 100, y: 0 });
    const end = infallAt(100, 0, 0, 0, 1);
    expect(end.x).toBeCloseTo(0);
    expect(end.y).toBeCloseTo(0);
    const mid = infallAt(100, 0, 0, 0, 0.7);
    expect(Math.hypot(mid.x, mid.y)).toBeCloseTo(100 * (1 - 0.49));
    // Clockwise on the screen: from +x towards +y, y running down.
    expect(mid.y).toBeGreaterThan(0);
  });

  it('reports what falls, and nothing once it is gone', () => {
    const match = doomed();
    expect(match.falling()).toEqual([]);
    match.debugCollapse();
    match.update(1 / 30);
    const falling = match.falling();
    expect(falling.map((f) => f.key).sort()).toEqual([`planet${match.world.planets[0].seed}`, 'ship2'].sort());
    const ship = falling.find((f) => f.key === 'ship2')!;
    expect(ship.color).toBe(match.players[2].color);
    expect({ x: ship.x, y: ship.y }).toEqual({ x: match.world.ships[2].x, y: match.world.ships[2].y });
    for (let t = 0; t < 5 && match.phase === 'collapse'; t += 1 / 30) match.update(1 / 30);
    expect(match.falling()).toEqual([]);
    expect(match.players[2].alive).toBe(false);
  });

  it('marks a falling ship when it starts down, from where it is', () => {
    const match = doomed();
    const { x, y } = match.world.ships[2];
    const devoured: { x: number; y: number }[] = [];
    match.on((e) => e.type === 'devour' && devoured.push({ x: e.x, y: e.y }));
    match.debugCollapse();
    expect(devoured).toContainEqual({ x, y });
    const count = devoured.length;
    for (let t = 0; t < 5 && match.phase === 'collapse'; t += 1 / 30) match.update(1 / 30);
    expect(devoured.length).toBe(count);
  });
});
