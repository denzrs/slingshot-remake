import { describe, expect, it } from 'vitest';
import { Effects, SCAR_LIFE } from '../../src/render/effects';
import type { World } from '../../src/sim/physics';

const planet = { x: 400, y: 300, radius: 40, mass: 64_000, seed: 7, style: 'rocky', tint: '#ffffff' };
const sun = { x: 900, y: 300, radius: 60, mass: 1, seed: 8, style: 'star', tint: '#ffffff', sun: true };
const world = { planets: [planet, sun], holes: [], ships: [] } as unknown as World;

describe('the scars shots leave on planets', () => {
  it('marks the planet an impact struck, at the angle it struck from', () => {
    const effects = new Effects(false, false, 'low');
    effects.impact(planet.x, planet.y - planet.radius - 2, '#ff0000');
    effects.update(1 / 60, world);
    const scars = effects.scarsOn(planet.seed);
    expect(scars).toHaveLength(1);
    expect(scars[0].angle).toBeCloseTo(-Math.PI / 2);
  });

  it('leaves no scar for an impact in open space, or on the sun', () => {
    const effects = new Effects(false, false, 'low');
    effects.impact(100, 100, '#ff0000');
    effects.impact(sun.x - sun.radius, sun.y, '#ff0000');
    effects.update(1 / 60, world);
    expect(effects.scarsOn(planet.seed)).toHaveLength(0);
    expect(effects.scarsOn(sun.seed)).toHaveLength(0);
  });

  it('ages a scar until it has healed, and forgets them all with the round', () => {
    const effects = new Effects(false, false, 'low');
    effects.impact(planet.x + planet.radius, planet.y, '#ff0000');
    effects.update(1 / 60, world);
    effects.update(SCAR_LIFE / 2, world);
    expect(effects.scarsOn(planet.seed)[0].age).toBeGreaterThan(SCAR_LIFE / 2 - 0.1);
    effects.update(SCAR_LIFE, world);
    expect(effects.scarsOn(planet.seed)).toHaveLength(0);
    effects.impact(planet.x + planet.radius, planet.y, '#ff0000');
    effects.update(1 / 60, world);
    effects.clear();
    expect(effects.scarsOn(planet.seed)).toHaveLength(0);
  });
});
