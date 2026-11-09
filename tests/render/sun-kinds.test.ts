import { describe, expect, it } from 'vitest';
import { SUN_KINDS, sunBeat, sunHeat, sunKind, towardsGiant } from '../../src/render/sun-kinds';

describe('sun kinds', () => {
  it('picks a kind from the seed alone, every kind turning up, a yellow sun most often', () => {
    const counts = new Map<string, number>();
    for (let seed = 0; seed < 20_000; seed++) {
      const id = sunKind({ seed: seed * 7919 }).id;
      expect(sunKind({ seed: seed * 7919 }).id).toBe(id);
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    for (const id of SUN_KINDS) expect(counts.get(id) ?? 0).toBeGreaterThan(1000);
    expect(Math.max(...counts.values())).toBe(counts.get('yellow'));
  });

  it('turns every kind into the same red giant', () => {
    const yellow = sunKind({ seed: [...Array(200).keys()].find((s) => sunKind({ seed: s }).id === 'yellow')! });
    for (const id of SUN_KINDS) {
      const seed = [...Array(2000).keys()].find((s) => sunKind({ seed: s }).id === id)!;
      const giant = towardsGiant(sunKind({ seed }), 1);
      expect(giant.ramp).toEqual(yellow.ramp);
      expect(giant.glows).toEqual(yellow.glows);
    }
  });

  it('runs the ramp from its coolest colour to its hottest', () => {
    const kind = sunKind({ seed: 1 });
    expect(sunHeat(kind, -1)).toEqual([...kind.ramp[0]]);
    expect(sunHeat(kind, 2)).toEqual([...kind.ramp[4]]);
  });

  it('keeps a steady star steady, and lets a pulsing one breathe and a red dwarf flare', () => {
    const seedOf = (id: string): number => [...Array(2000).keys()].find((s) => sunKind({ seed: s }).id === id)!;
    const over = (id: string) => Array.from({ length: 400 }, (_, i) => sunBeat(sunKind({ seed: seedOf(id) }), seedOf(id), i * 0.05));
    for (const beat of over('yellow')) expect(beat).toEqual({ glow: 1, flare: 0 });
    const glows = over('pulsing').map((b) => b.glow);
    expect(Math.max(...glows) - Math.min(...glows)).toBeGreaterThan(0.4);
    expect(Math.max(...over('red').map((b) => b.flare))).toBeGreaterThan(0.3);
  });
});
