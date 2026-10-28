import { describe, expect, it } from 'vitest';
import { FIELD, PHYSICS } from '../../src/sim/config';
import { Shot, simulateShot, type Ship, type World } from '../../src/sim/physics';

const world = (ships: Ship[]): World => ({ width: FIELD.width, height: FIELD.height, planets: [], ships, holes: [], nebulae: [], wormholes: [], defenses: [], version: 0 });
const rules = { bounce: false, timeLimit: 20 };
const R = PHYSICS.SHIP_RADIUS;

/** A shot straight to the right from the first ship, passing the second ship `off` px above it. */
const fly = (off: number, reach?: number, own?: number) =>
  simulateShot(world([{ x: 100, y: 400, alive: true, reach: own }, { x: 600, y: 400 - off, alive: true, reach }]), 0, 0, 50, rules, [], [], false, false).end;

describe('a ship\'s reach', () => {
  it('lets a shot that passes outside the hull hit when it is within the reach', () => {
    expect(fly(30)).toMatchObject({ kind: 'lost' });
    expect(fly(30, 30)).toMatchObject({ kind: 'ship', ship: 1 });
  });

  it('is the hull plus the reach, and no more', () => {
    expect(fly(R + 20, 25)).toMatchObject({ kind: 'ship', ship: 1 });
    expect(fly(R + 40, 25)).toMatchObject({ kind: 'lost' });
  });

  it('changes nothing at zero or without it', () => {
    expect(fly(5)).toMatchObject({ kind: 'ship', ship: 1 });
    expect(fly(5, 0)).toMatchObject({ kind: 'ship', ship: 1 });
    expect(fly(R + 2, 0)).toMatchObject({ kind: 'lost' });
  });

  it('never has a shot hit its own ship at the muzzle, however far the zone reaches', () => {
    const end = fly(300, undefined, 60);
    expect(end).not.toMatchObject({ kind: 'ship', ship: 0 });
  });

  it('puts a shot a shield bounced off outside the grown zone', () => {
    const w = world([{ x: 100, y: 400, alive: true }, { x: 600, y: 400, alive: true, shield: true, reach: 30 }]);
    const shot = new Shot(w, 0, 0, 50, rules);
    for (let i = 0; i < 4000 && !shot.reflects.length; i++) shot.step();
    expect(shot.reflects).toHaveLength(1);
    expect(Math.hypot(shot.x - 600, shot.y - 400)).toBeGreaterThanOrEqual(R + 30);
  });
});
