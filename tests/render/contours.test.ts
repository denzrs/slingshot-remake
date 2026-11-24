import { describe, expect, it } from 'vitest';
import { contourKey } from '../../src/render/contours';
import { generateWorld } from '../../src/sim/world';

describe('contourKey', () => {
  const world = () => generateWorld(4242, { players: 2, maxPlanets: 5, minPlanets: 4, blackHole: true });

  it('stays when a planet only cracks or a cannon is wrecked: the map need not be drawn again', () => {
    const w = world();
    const before = contourKey(w);
    (w.planets[0].fractures ??= []).push(1.2);
    w.version++;
    expect(contourKey(w)).toBe(before);
  });

  it('changes when a planet is broken, turned round or a hole grows', () => {
    const base = contourKey(world());
    const broken = world();
    broken.planets.splice(1, 1);
    const turned = world();
    turned.planets[0].reversed = true;
    const grown = world();
    grown.holes[0].mass *= 1.5;
    for (const w of [broken, turned, grown]) expect(contourKey(w)).not.toBe(base);
  });
});
