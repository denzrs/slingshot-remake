import { describe, expect, it } from 'vitest';
import { markPhi, pointerPhi, sliderFraction, sliderPower, WHEEL_GAIN, WHEEL_MARKER, wheelAngle } from '../src/touchaim';

describe('the angle wheel', () => {
  it('reads the direction of a finger from the corner', () => {
    expect(pointerPhi(0, -100)).toBe(90);
    expect(Math.abs(pointerPhi(-100, 0))).toBe(180);
    expect(pointerPhi(-100, -100)).toBe(135);
  });

  it('turns the angle by the gain times what the finger swept', () => {
    expect(wheelAngle(10, 100, 100)).toBe(10);
    expect(wheelAngle(10, 100, 110)).toBe(10 + 10 * WHEEL_GAIN);
    expect(wheelAngle(100, 120, 110)).toBe(100 - 10 * WHEEL_GAIN);
  });

  it('can be turned all the way round', () => {
    let angle = 0;
    let phi = 100;
    // Swipe back and forth over the quarter, a swipe at a time: 360° of angle needs 180° of swiping.
    for (let swipe = 0; swipe < 4; swipe++) {
      angle = wheelAngle(angle, phi, phi + 45);
    }
    expect(angle).toBe(0);
    expect(wheelAngle(350, 100, 110)).toBe(10);
    expect(wheelAngle(10, 100, 90)).toBe(350);
  });

  it('wraps the finger over the border of ±180°', () => {
    expect(wheelAngle(0, 175, -175)).toBe(10 * WHEEL_GAIN);
    expect(wheelAngle(0, -175, 175)).toBe(360 - 10 * WHEEL_GAIN);
  });

  it('snaps to half degrees', () => {
    const angle = wheelAngle(0, 100, 100.3);
    expect(angle * 2).toBe(Math.round(angle * 2));
  });

  it('puts the current angle under the marker and the others where the wheel has turned them', () => {
    expect(markPhi(200, 200)).toBe(WHEEL_MARKER);
    // A larger angle lies further round, towards the start of the quarter.
    expect(markPhi(200, 220)).toBe(WHEEL_MARKER - 20 / WHEEL_GAIN);
    expect(markPhi(200, 180)).toBe(WHEEL_MARKER + 20 / WHEEL_GAIN);
    expect(markPhi(355, 5)).toBe(WHEEL_MARKER - 10 / WHEEL_GAIN);
  });
});

describe('the power slider', () => {
  it('maps the height to the power', () => {
    expect(sliderPower(0)).toBe(0);
    expect(sliderPower(0.5)).toBe(50);
    expect(sliderPower(1)).toBe(100);
    expect(sliderPower(1.4)).toBe(100);
    expect(sliderPower(-0.2)).toBe(0);
  });

  it('never goes above the cap', () => {
    expect(sliderPower(0.9, 60)).toBe(60);
    expect(sliderPower(0.3, 60)).toBe(30);
  });

  it('shows a power as a height', () => {
    expect(sliderFraction(25)).toBe(0.25);
    expect(sliderFraction(130)).toBe(1);
  });
});
