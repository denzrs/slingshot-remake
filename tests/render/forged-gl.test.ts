import { describe, expect, it } from 'vitest';
import { canShade, onScreen, seedOffset, shade, shadeKept, unit } from '../../src/render/looks/forged-gl';
import { shadePost } from '../../src/render/looks/forged-post-gl';

describe('forged shaders', () => {
  it('says there is nothing to shade with where there is no WebGL, so every element draws its own way', () => {
    expect(canShade()).toBe(false);
    expect(shade('', 64, 64, 64, () => {})).toBeNull();
    expect(shadePost({} as CanvasRenderingContext2D, {} as Parameters<typeof shadePost>[1], [], true)).toBe(false);
  });

  it('keeps a slow picture only where there are shaders', () => {
    expect(shadeKept('test', 0, 15, '', 64, 64, 64, () => {})).toBeNull();
  });

  it('says whether a square is on its canvas, in the frame it is drawn in', () => {
    const ctx = (a: number, e: number, f: number) => ({
      canvas: { width: 100, height: 100 },
      getTransform: () => ({ a, b: 0, c: 0, d: a, e, f }),
    }) as unknown as CanvasRenderingContext2D;
    expect(onScreen(ctx(1, 0, 0), 50, 50, 10)).toBe(true);
    expect(onScreen(ctx(1, 0, 0), 300, 50, 10)).toBe(false);
    expect(onScreen(ctx(1, 0, 0), 105, 50, 10)).toBe(true);
    expect(onScreen(ctx(2, -400, 0), 50, 50, 10)).toBe(false);
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
