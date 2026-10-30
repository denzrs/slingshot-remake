import { describe, expect, it } from 'vitest';
import { FIELD } from '../../src/sim/config';
import { fieldTransform, plateUnits, portraitLayout, rayHitsRect } from '../../src/render/layout';

const NO_INSET = { top: 0, bottom: 0 };
const UI = 1.2;

/** The field's corners as they appear on the screen. */
function plate(layout: NonNullable<ReturnType<typeof portraitLayout>>) {
  const u = plateUnits(layout.rotated);
  return { left: layout.offsetX, top: layout.offsetY, right: layout.offsetX + u.w * layout.scale, bottom: layout.offsetY + u.h * layout.scale };
}

describe('portrait layout', () => {
  it.each([
    [360, 640],
    [375, 667],
    [375, 812],
    [390, 844],
    [412, 915],
    [430, 932],
  ])('turns the field to fill a %i×%i screen', (width, height) => {
    const layout = portraitLayout(width, height, NO_INSET, UI)!;
    expect(layout.rotated).toBe(true);
    // Bigger than the straight field would be.
    expect(layout.scale).toBeGreaterThan((width - 8) / FIELD.width);
    const box = plate(layout);
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(width);
    // Under the HUD, above the button bar.
    expect(box.top).toBeGreaterThanOrEqual(layout.stage.y + 88);
    expect(box.bottom).toBeLessThanOrEqual(layout.stage.y + layout.stage.h);
  });

  it.each([
    [320, 568],
  ])('keeps the field straight on a short %i×%i screen, where that is the bigger one', (width, height) => {
    const layout = portraitLayout(width, height, NO_INSET, UI)!;
    expect(layout.rotated).toBe(false);
    expect(layout.scale).toBeCloseTo((width - 8) / FIELD.width);
    expect(plate(layout).bottom).toBeLessThanOrEqual(layout.stage.y + layout.stage.h);
  });

  it('keeps clear of the notch and the home bar', () => {
    const plain = portraitLayout(390, 844, NO_INSET, UI)!;
    const notched = portraitLayout(390, 844, { top: 47, bottom: 34 }, UI)!;
    expect(notched.stage.y).toBeGreaterThan(plain.stage.y);
    expect(notched.stage.y + notched.stage.h).toBeLessThan(plain.stage.y + plain.stage.h);
  });

  it('leaves a square-ish window to the usual centred layout', () => {
    expect(portraitLayout(700, 720, NO_INSET, UI)).toBeNull();
  });
});

describe('the field transform', () => {
  const apply = (m: number[], x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  const view = { dpr: 2, scale: 0.4, offsetX: 30, offsetY: 120 };

  it('draws a straight field from its corner', () => {
    const m = fieldTransform({ ...view, rotated: false });
    expect(apply(m, 0, 0)).toEqual([60, 240]);
    expect(apply(m, FIELD.width, FIELD.height)).toEqual([2 * (30 + FIELD.width * 0.4), 2 * (120 + FIELD.height * 0.4)]);
  });

  it('turns the field a quarter round: its left side at the bottom, its top at the left', () => {
    const m = fieldTransform({ ...view, rotated: true });
    // The top-left corner of the field goes to the bottom-left of the plate (width 800, height 1280 units on the screen)…
    expect(apply(m, 0, 0)).toEqual([2 * 30, 2 * (120 + FIELD.width * 0.4)]);
    // …the top-right corner to the top-left, the bottom-left to the bottom-right.
    expect(apply(m, FIELD.width, 0)).toEqual([2 * 30, 2 * 120]);
    expect(apply(m, 0, FIELD.height)).toEqual([2 * (30 + FIELD.height * 0.4), 2 * (120 + FIELD.width * 0.4)]);
  });

  it('puts the camera point in the middle of the plate, turned or not', () => {
    for (const rotated of [false, true]) {
      const m = fieldTransform({ ...view, rotated }, { x: 300, y: 500, zoom: 2.5 });
      const u = plateUnits(rotated);
      const [x, y] = apply(m, 300, 500);
      expect(x).toBeCloseTo(2 * (30 + (u.w * 0.4) / 2));
      expect(y).toBeCloseTo(2 * (120 + (u.h * 0.4) / 2));
    }
  });
});

describe('rayHitsRect', () => {
  const from = { x: 100, y: 100 };

  it('is true when the aim line runs through the card', () => {
    expect(rayHitsRect(from, { x: 1, y: 0 }, 300, 160, 80, 100, 40)).toBe(true);
  });

  it('is false when the card is beside the line, behind the ship, or farther out than the line reaches', () => {
    expect(rayHitsRect(from, { x: 1, y: 0 }, 300, 160, 200, 100, 40)).toBe(false);
    expect(rayHitsRect(from, { x: 1, y: 0 }, 300, -100, 80, 100, 40)).toBe(false);
    expect(rayHitsRect(from, { x: 1, y: 0 }, 50, 160, 80, 100, 40)).toBe(false);
  });

  it('works on a slant, and for lines straight up or down', () => {
    const slant = { x: Math.SQRT1_2, y: -Math.SQRT1_2 };
    expect(rayHitsRect(from, slant, 300, 150, 20, 40, 40)).toBe(true);
    expect(rayHitsRect(from, { x: 0, y: -1 }, 300, 80, 0, 40, 40)).toBe(true);
    expect(rayHitsRect(from, { x: 0, y: -1 }, 300, 160, 0, 40, 40)).toBe(false);
  });
});
