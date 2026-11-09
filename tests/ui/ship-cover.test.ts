import { describe, expect, it } from 'vitest';
import { covers, coveredShapes, type CoverShape } from '../../src/ui/touch/ship-cover';

const fire: CoverShape = { left: 300, top: 600, right: 380, bottom: 650 };
/** A wheel in the bottom right corner of a 400 × 800 screen, 180 wide. */
const wheel: CoverShape = { left: 220, top: 620, right: 400, bottom: 800, corner: 'right' };

describe('a ship under a control', () => {
  it('is under a button when it is inside its box, or at its edge', () => {
    expect(covers(fire, { x: 340, y: 625 })).toBe(true);
    expect(covers(fire, { x: 385, y: 625 })).toBe(true);
    expect(covers(fire, { x: 340, y: 700 })).toBe(false);
  });

  it('is under the wheel inside its quarter disc, not in the corner of its box that the disc leaves empty', () => {
    expect(covers(wheel, { x: 380, y: 780 })).toBe(true);
    expect(covers(wheel, { x: 300, y: 700 })).toBe(true);
    // The top left corner of the box is farther from the screen's corner than the disc reaches.
    expect(covers(wheel, { x: 225, y: 625 })).toBe(false);
  });

  it('knows a wheel on the left from one on the right', () => {
    const left: CoverShape = { left: 0, top: 620, right: 180, bottom: 800, corner: 'left' };
    expect(covers(left, { x: 20, y: 780 })).toBe(true);
    expect(covers(left, { x: 175, y: 625 })).toBe(false);
  });

  it('is told for each control separately', () => {
    expect(coveredShapes([fire, wheel], [{ x: 305, y: 605 }])).toEqual([true, false]);
    expect(coveredShapes([fire, wheel], [])).toEqual([false, false]);
    expect(coveredShapes([fire, wheel], [{ x: 305, y: 605 }, { x: 390, y: 790 }])).toEqual([true, true]);
  });
});
