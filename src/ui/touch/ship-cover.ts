/**
 * A ship (or a target drone in the daily challenge) can lie under a touch control: the field is as big as the phone allows
 * and the wheel, the power bar and the buttons sit on top of it. A control over a ship fades, so the ship shows through and
 * the control still takes the touch. This is the geometry, and the class the fading is done with.
 */

export interface Point {
  x: number;
  y: number;
}

/** A control's box on the screen. `corner` marks a quarter disc as wide as the box, centred on the box's bottom corner on that side: the wheel. */
export interface CoverShape {
  left: number;
  top: number;
  right: number;
  bottom: number;
  corner?: 'left' | 'right';
}

/** A ship is about as big as this, so one that is this close to a control is partly under it. */
export const COVER_MARGIN = 12;

export function covers(shape: CoverShape, p: Point, margin = COVER_MARGIN): boolean {
  if (shape.corner) {
    const cx = shape.corner === 'left' ? shape.left : shape.right;
    return p.y >= shape.top - margin && Math.hypot(p.x - cx, p.y - shape.bottom) <= shape.right - shape.left + margin;
  }
  return p.x >= shape.left - margin && p.x <= shape.right + margin && p.y >= shape.top - margin && p.y <= shape.bottom + margin;
}

/** For each shape, whether any of the points is under it. */
export function coveredShapes(shapes: readonly CoverShape[], points: readonly Point[], margin = COVER_MARGIN): boolean[] {
  return shapes.map((shape) => points.some((p) => covers(shape, p, margin)));
}

/** The class a control wears while it is over a ship (see touch.css). */
export const OVER_SHIP = 'over-ship';

/**
 * Fades the controls that are over a ship and brings back the others. A control that is hidden is left out, and never kept
 * faded. `viewportWidth` tells which side of the screen a wheel is on.
 */
export function fadeOverShips(controls: readonly HTMLElement[], points: readonly Point[], viewportWidth: number): void {
  for (const el of controls) {
    if (el.hidden || el.getClientRects().length === 0) {
      el.classList.remove(OVER_SHIP);
      continue;
    }
    const r = el.getBoundingClientRect();
    const shape: CoverShape = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    if (el.classList.contains('twheel')) shape.corner = r.left + r.width / 2 < viewportWidth / 2 ? 'left' : 'right';
    el.classList.toggle(OVER_SHIP, points.some((p) => covers(shape, p)));
  }
}

/** Takes the fading off every control (when the field is not what the player looks at: a menu, a killcam). */
export function clearFade(controls: readonly HTMLElement[]): void {
  for (const el of controls) el.classList.remove(OVER_SHIP);
}
