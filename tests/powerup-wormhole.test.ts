import { describe, expect, it } from 'vitest';
import { FIELD, WORMHOLE } from '../src/config';
import { Shot, type World } from '../src/physics';

const rules = { bounce: false, timeLimit: 20 };

const world = (): World => ({
  width: FIELD.width,
  height: FIELD.height,
  planets: [],
  ships: [{ x: 100, y: 400, alive: true }, { x: 1180, y: 700, alive: true }],
  holes: [],
  nebulae: [],
  wormholes: [{ ax: 400, ay: 400, bx: 900, by: 700, radius: WORMHOLE.RADIUS }],
  version: 0,
});

describe('wormhole', () => {
  it('carries a shot from one mouth to the other, keeping its velocity', () => {
    const shot = new Shot(world(), 0, 0, 50, rules);
    const vx = shot.vx;
    let jumped = false;
    for (let i = 0; i < 4000 && !shot.end && !jumped; i++) {
      const x = shot.x;
      shot.step();
      if (shot.x - x > 100) jumped = true;
    }
    expect(jumped).toBe(true);
    expect(shot.vx).toBe(vx);
    expect(shot.y).toBeCloseTo(700, -1);
  });

  it('works in both directions, and is not carried straight back', () => {
    const w = world();
    w.ships = [{ x: 1180, y: 700, alive: true }, { x: 100, y: 400, alive: true }];
    const shot = new Shot(w, 0, 180, 50, rules);
    while (!shot.end) shot.step();
    expect(shot.end).toEqual({ kind: 'ship', ship: 1 });
  });
});
