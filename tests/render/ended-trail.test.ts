import { describe, expect, it } from 'vitest';
import { LOOKS } from '../../src/data/look';
import { painterFor } from '../../src/render/looks';

/** A canvas that only counts what is drawn on it. */
function counting(): { ctx: CanvasRenderingContext2D; strokes: number; fills: number } {
  const seen = { strokes: 0, fills: 0 };
  const gradient = { addColorStop: () => {} };
  const ctx = new Proxy({} as Record<string | symbol, unknown>, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === 'stroke') return () => seen.strokes++;
      if (key === 'fill' || key === 'fillRect') return () => seen.fills++;
      if (key === 'createRadialGradient' || key === 'createLinearGradient') return () => gradient;
      return () => {};
    },
    set(target, key, value) {
      target[key] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return {
    ctx,
    get strokes() {
      return seen.strokes;
    },
    get fills() {
      return seen.fills;
    },
  };
}

/** A straight track of `n` points. */
const track = (n: number): number[] => Array.from({ length: n }, (_, i) => [100 + i * 3, 200]).flat();

describe('the track of a shot that has ended while its volley still flies', () => {
  for (const look of LOOKS) {
    for (const plasma of [false, true]) {
      it(`keeps no hot head in ${look}${plasma ? ' (plasma)' : ''}: a few whole lines, however long the track`, () => {
        const draw = (n: number) => {
          const canvas = counting();
          painterFor(look).liveTrail(canvas.ctx, track(n), [], '#ff8040', plasma, 1.5, true);
          return canvas;
        };
        const short = draw(20);
        const long = draw(200);
        expect(long.strokes).toBe(short.strokes);
        expect(long.strokes).toBeGreaterThan(0);
        expect(long.fills).toBe(0);
      });
    }
  }

  it('is drawn with its head while the shot still flies', () => {
    const canvas = counting();
    painterFor('classic').liveTrail(canvas.ctx, track(200), [], '#ff8040', true, 1.5, false);
    expect(canvas.strokes + canvas.fills).toBeGreaterThan(10);
  });
});
