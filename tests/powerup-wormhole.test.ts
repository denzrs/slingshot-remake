import { describe, expect, it } from 'vitest';
import { FIELD, WORMHOLE } from '../src/config';
import { isWormholeJump, Shot, type World } from '../src/physics';
import { PORTAL_PAIRS, portalPair } from '../src/render/powerup-art';

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

  it('does not trip over the mouth it last left when that wormhole is gone', () => {
    const w = world();
    w.wormholes.push({ ax: 400, ay: 100, bx: 700, by: 100, radius: WORMHOLE.RADIUS });
    w.wormholes = [w.wormholes[1], w.wormholes[0]];
    const shot = new Shot(w, 0, 0, 50, rules);
    for (let i = 0; i < 4000 && !shot.end && !shot.warps.length; i++) shot.step();
    expect(shot.warps.length).toBe(1);
    // The pair the shot just left by is removed while the other stays: the stale mouth must not be read.
    w.wormholes.shift();
    expect(() => { for (let i = 0; i < 50 && !shot.end; i++) shot.step(); }).not.toThrow();
  });
});

describe('wormhole trail jump', () => {
  const wormholes = [{ ax: 401.23, ay: 399.87, bx: 902.46, by: 700.04, radius: WORMHOLE.RADIUS }];
  const rounded = (n: number): number => Math.round(n * 10) / 10;

  it('is found in a trail the wire has rounded to a tenth', () => {
    const exact = [380, 395, 401.23, 399.87, 902.46, 700.04, 920, 702];
    const wire = exact.map(rounded);
    expect(isWormholeJump(wire, 4, wormholes)).toBe(true);
    expect(isWormholeJump(wire, 2, wormholes)).toBe(false);
    expect(isWormholeJump(wire, 6, wormholes)).toBe(false);
  });

  it('is found in both directions, and not for flight that merely passes a mouth', () => {
    expect(isWormholeJump([902.46, 700.04, 401.23, 399.87], 2, wormholes)).toBe(true);
    expect(isWormholeJump([400, 400, 403, 401], 2, wormholes)).toBe(false);
  });
});

describe('wormhole portal colours', () => {
  it('gives every portal on the field a colour of its own, until the palette is used up', () => {
    const colours = PORTAL_PAIRS.flatMap((pair) => [pair.entry, pair.exit]);
    expect(new Set(colours).size).toBe(colours.length);
  });

  it('starts over with the first pair after the last', () => {
    expect(portalPair(0)).toBe(PORTAL_PAIRS[0]);
    expect(portalPair(PORTAL_PAIRS.length)).toBe(PORTAL_PAIRS[0]);
    expect(portalPair(PORTAL_PAIRS.length + 2)).toBe(PORTAL_PAIRS[2]);
  });
});
