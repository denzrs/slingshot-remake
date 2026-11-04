import { describe, expect, it } from 'vitest';
import type { Falling } from '../../src/game';
import { Effects } from '../../src/render/effects';
import type { World } from '../../src/sim/physics';

const hole = { x: 500, y: 300, radius: 40, mass: 200_000 };
const world = (planets: { x: number; y: number; radius: number; mass: number }[] = []) => ({ planets, holes: [hole] }) as unknown as World;
const fall = (x: number, t: number): Falling => ({ key: 'planet1', x, y: hole.y, fromX: 700, fromY: hole.y, toX: hole.x, toY: hole.y, radius: 30, color: '#ff0000', t });
const sparks = (effects: Effects) => (effects as unknown as { sparks: { x: number; y: number; falling?: boolean }[] }).sparks;

describe('effects of a fall', () => {
  it('sheds a little dust from a falling body, and more the deeper it is', () => {
    const count = (t: number): number => {
      const effects = new Effects(true, false, 'low');
      for (let i = 0; i < 60; i++) effects.infall([fall(700, t)], hole, 1 / 60);
      return sparks(effects).length;
    };
    expect(count(0.1)).toBe(0);
    expect(count(0.5)).toBeGreaterThan(0);
    expect(count(0.95)).toBeGreaterThan(count(0.5) * 0.9);
    expect(count(0.95)).toBeLessThan(80);
  });

  it('sheds no dust when the look draws the fall whole', () => {
    const effects = new Effects(true, false, 'low');
    for (let i = 0; i < 60; i++) effects.infall([fall(700, 0.5)], hole, 1 / 60, false);
    expect(sparks(effects).length).toBe(0);
  });

  it('answers once when something crosses the horizon, and again in the next fall', () => {
    const effects = new Effects(false, false, 'low');
    effects.infall([fall(700, 0.2)], hole, 1 / 60);
    expect(effects.holeFeed).toBe(0);
    effects.infall([fall(hole.x + 10, 0.9)], hole, 1 / 60);
    expect(effects.holeFeed).toBe(1);
    expect(effects.holeFeedAngle).toBeCloseTo(0);
    effects.update(0.2, world());
    const fading = effects.holeFeed;
    expect(fading).toBeLessThan(1);
    effects.infall([fall(hole.x + 5, 0.95)], hole, 1 / 60);
    expect(effects.holeFeed).toBe(fading);
    effects.infall([], hole, 1 / 60);
    effects.infall([fall(hole.x + 5, 0.95)], hole, 1 / 60);
    expect(effects.holeFeed).toBe(1);
  });

  it('keeps the matter of a devoured body alive on the body it left', () => {
    const effects = new Effects(true, false, 'low');
    const planet = { x: 700, y: hole.y, radius: 40, mass: 1000 };
    effects.devour(planet.x, planet.y, hole.x, hole.y, '#ff0000');
    const before = sparks(effects).length;
    effects.update(1 / 60, world([planet]));
    expect(before).toBeGreaterThan(0);
    expect(sparks(effects).length).toBe(before);
    expect(sparks(effects).every((s) => s.falling)).toBe(true);
  });

  it('swallows a spark that reaches a horizon whole, with no fragments', () => {
    const effects = new Effects(true, false, 'low');
    (effects as unknown as { sparks: object[] }).sparks.push({ x: hole.x, y: hole.y, vx: 0, vy: 0, size: 2, color: '#fff', drag: 0, tier: 'large', seed: 0 });
    effects.update(1 / 60, world());
    expect(sparks(effects).length).toBe(0);
  });

  it('leaves the field still under reduced motion', () => {
    const effects = new Effects(false, true, 'low');
    effects.infall([fall(hole.x, 1)], hole, 1 / 60);
    expect(effects.holeFeed).toBeGreaterThan(0);
    expect(effects.shake).toBe(0);
    expect(effects.flash).toBe(0);
  });
});
