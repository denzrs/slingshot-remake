import { describe, expect, it } from 'vitest';
import { B_MAX, B_STEPS, PHI_STEP, SHADOW, paths } from '../../scripts/forged/hole-trace';

/** The path table of the forged black hole needs no canvas: light past a still hole, by its impact parameter b (in masses). */
const index = (b: number): number => Math.round((b / B_MAX) * (B_STEPS - 1));

describe('forged hole path table', () => {
  it('lets a ray nearer than 3√3 fall in and one farther escape', () => {
    const p = paths();
    const steps = p.u.length / B_STEPS;
    // The nearest a path comes, as 1/r: a falling path runs past the horizon (1/2), an escaping one turns back before the photon sphere (1/3).
    const nearest = (b: number): number => Math.max(...p.u.subarray(index(b) * steps, (index(b) + 1) * steps));
    expect(SHADOW).toBeCloseTo(3 * Math.sqrt(3));
    for (const b of [1, 3, 4.5, 5.1]) expect(nearest(b)).toBeGreaterThan(0.5);
    for (const b of [5.3, 6, 10, 30]) expect(nearest(b)).toBeLessThan(1 / 3);
  });

  it('bends a far ray by about 4/b', () => {
    const p = paths();
    for (const b of [20, 30]) {
      // The sweep of an escaping path is π plus the deflection, which is 4/b + 15π/(4b²) to second order.
      const deflection = p.end[index(b)] - Math.PI;
      expect(Math.abs(deflection - (4 / b + (15 * Math.PI) / (4 * b * b)))).toBeLessThan(PHI_STEP * 1.5);
    }
  });
});
