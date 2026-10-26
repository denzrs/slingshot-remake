import { describe, expect, it } from 'vitest';
import {
  barFraction,
  barPower,
  markPhi,
  pointerPhi,
  stepAngle,
  stepPower,
  trackFraction,
  wheelAngle,
  wheelBand,
  wheelMarker,
} from '../../src/ui/touch/touchaim';

describe('the angle wheel', () => {
  it('reads the direction of a finger from the corner, counter-clockwise from the right', () => {
    expect(pointerPhi(10, 0)).toBeCloseTo(0);
    expect(pointerPhi(0, -10)).toBeCloseTo(90);
    expect(Math.abs(pointerPhi(-10, 0))).toBeCloseTo(180);
    expect(pointerPhi(0, 10)).toBeCloseTo(-90);
  });

  it('has a quick band inside, a fine one outside, and none where the readout is', () => {
    expect(wheelBand(10, 100)).toBeNull();
    expect(wheelBand(50, 100)).toBe('coarse');
    expect(wheelBand(90, 100)).toBe('fine');
    expect(wheelBand(140, 100)).toBe('fine');
  });

  it('turns the angle the way the finger turns, farther in the quick band than in the fine one', () => {
    expect(wheelAngle('coarse', 90, 135, 145)).toBe(110);
    expect(wheelAngle('fine', 90, 135, 145)).toBe(92.5);
    expect(wheelAngle('coarse', 90, 135, 125)).toBe(70);
    expect(wheelAngle('fine', 90, 135, 125)).toBe(87.5);
  });

  it('snaps to half a degree and wraps round the circle', () => {
    expect(wheelAngle('fine', 10, 100, 100.9)).toBe(10);
    expect(wheelAngle('fine', 10, 100, 101.1)).toBe(10.5);
    expect(wheelAngle('coarse', 350, 135, 155)).toBe(30);
    expect(wheelAngle('coarse', 10, 135, 115)).toBe(330);
  });

  it('crosses the 180° seam the short way', () => {
    // A finger going from 179° to -179° has moved two degrees, not 358.
    expect(wheelAngle('fine', 0, 179, -179)).toBe(0.5);
  });

  it('draws the mark of the angle under the marker, and the rest on either side by the band’s gain', () => {
    const marker = wheelMarker('right');
    expect(marker).toBe(135);
    expect(markPhi('coarse', marker, 40, 40)).toBe(marker);
    // A larger angle lies clockwise of the marker, a smaller one counter-clockwise.
    expect(markPhi('coarse', marker, 40, 50)).toBe(marker - 5);
    expect(markPhi('fine', marker, 40, 41)).toBe(marker - 4);
    expect(markPhi('fine', marker, 40, 39)).toBe(marker + 4);
  });

  it('keeps the wheel and the marks in step: the mark of the new angle was where the finger now is, turned back', () => {
    // The finger went 10° clockwise; before, the mark of the angle it set lay 10° counter-clockwise of the marker, and followed the finger to it.
    for (const band of ['coarse', 'fine'] as const) {
      const start = 100;
      const set = wheelAngle(band, start, 150, 140);
      expect(markPhi(band, 135, start, set)).toBeCloseTo(145, 5);
    }
  });

  it('has the marker in the middle of the quarter on either side', () => {
    expect(wheelMarker('left')).toBe(45);
  });

  it('steps by half degrees', () => {
    expect(stepAngle(0, -1)).toBe(359.5);
    expect(stepAngle(359.5, 1)).toBe(0);
  });
});

describe('the power bar', () => {
  it('finds the share of the track under a finger, with the handle kept inside', () => {
    // A track of 200 from 100, a handle of 40: the handle's middle runs from 120 to 280.
    expect(trackFraction(120, 100, 200, 40)).toBe(0);
    expect(trackFraction(200, 100, 200, 40)).toBe(0.5);
    expect(trackFraction(280, 100, 200, 40)).toBe(1);
    expect(trackFraction(50, 100, 200, 40)).toBe(0);
    expect(trackFraction(400, 100, 200, 40)).toBe(1);
  });

  it('turns a share into a power, never above the cap', () => {
    expect(barPower(0)).toBe(0);
    expect(barPower(0.5)).toBe(50);
    expect(barPower(1)).toBe(100);
    expect(barPower(1.4)).toBe(100);
    expect(barPower(0.9, 60)).toBe(60);
    expect(barPower(-1)).toBe(0);
  });

  it('puts the handle back where the finger had it', () => {
    for (const power of [0, 1, 37, 50, 99, 100]) expect(barPower(barFraction(power))).toBe(power);
  });

  it('steps by ones within the cap', () => {
    expect(stepPower(50, 1)).toBe(51);
    expect(stepPower(50.4, -1)).toBe(49);
    expect(stepPower(0, -1)).toBe(0);
    expect(stepPower(60, 1, 60)).toBe(60);
  });
});
