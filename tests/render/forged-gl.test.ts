import { describe, expect, it } from 'vitest';
import { canShade, seedOffset, shade, unit } from '../../src/render/looks/forged-gl';
import { shadePost } from '../../src/render/looks/forged-post-gl';

describe('forged shaders', () => {
  it('says there is nothing to shade with where there is no WebGL, so every element draws its own way', () => {
    expect(canShade()).toBe(false);
    expect(shade('', 64, 64, 64, () => {})).toBeNull();
    expect(shadePost({} as CanvasRenderingContext2D, {} as Parameters<typeof shadePost>[1], [], true)).toBe(false);
  });

  it('keeps a seed small enough for a shader float, the same for the same seed', () => {
    for (const seed of [0, 1, 0.5, 123456, -7]) {
      expect(seedOffset(seed)).toBeGreaterThanOrEqual(0);
      expect(seedOffset(seed)).toBeLessThan(200);
      expect(seedOffset(seed)).toBe(seedOffset(seed));
    }
  });

  it('turns a colour into 0 → 1 values', () => {
    expect(unit([255, 0, 51])).toEqual([1, 0, 0.2]);
  });
});
