import { AIM } from '../../sim/config';
import { normalizeAngle } from '../../sim/physics';

/**
 * The touch aiming controls, as plain maths: a wheel for the angle and a bar for the power.
 *
 * The wheel is a quarter circle in a corner of the screen that turns under the thumb, like a jog dial: what it shows
 * is a window onto the 360°, and the angle follows how far the finger has turned it. It has two bands. The inner one
 * is quick (a swipe across it turns the angle twice as far), the outer one is fine (a quarter of the way): a thumb
 * puts the angle near with the inner band and then sets the last half degree on the outer.
 */

export type WheelBand = 'coarse' | 'fine';

/** Degrees of angle per degree the finger sweeps round the corner, in each band. */
export const WHEEL_GAIN: Record<WheelBand, number> = { coarse: 2, fine: 0.25 };

/** Where the bands lie, as shares of the wheel's radius: under `DEAD` is the readout, up to `SPLIT` the quick band. */
export const WHEEL_DEAD = 0.34;
export const WHEEL_SPLIT = 0.68;

/** The wheel's quarter, as screen directions in degrees counter-clockwise from the right, by the side of the screen it sits on. */
export const WHEEL_QUARTER = { right: { from: 90, to: 180 }, left: { from: 0, to: 90 } } as const;

/** The screen direction of the wheel's marker: the middle of the quarter. */
export const wheelMarker = (side: 'left' | 'right'): number => (WHEEL_QUARTER[side].from + WHEEL_QUARTER[side].to) / 2;

const STEP = 0.5;
const snap = (v: number): number => Math.round(v / STEP) * STEP;

/** The direction of a point seen from the wheel's centre (the screen corner), in degrees counter-clockwise from the right. `dy` is down. */
export const pointerPhi = (dx: number, dy: number): number => (Math.atan2(-dy, dx) * 180) / Math.PI;

/** A difference of two directions, the short way round: -180 to 180. */
const turn = (from: number, to: number): number => ((((to - from) % 360) + 540) % 360) - 180;

/** The band a finger at `distance` from the corner starts in; null in the middle, where a finger has no direction. */
export function wheelBand(distance: number, radius: number): WheelBand | null {
  if (distance < radius * WHEEL_DEAD) return null;
  return distance < radius * WHEEL_SPLIT ? 'coarse' : 'fine';
}

/** How far a finger's turn from one direction to another turns the angle in a band (not yet snapped, so that small turns add up). */
export const wheelDelta = (band: WheelBand, fromPhi: number, toPhi: number): number => turn(fromPhi, toPhi) * WHEEL_GAIN[band];

/** An angle to the half degree, within 0–360. */
export const snapAngle = (angle: number): number => normalizeAngle(snap(angle)) || 0;

/** The angle after the finger went from one direction to another in a band, having started with `startAngle`. */
export const wheelAngle = (band: WheelBand, startAngle: number, fromPhi: number, toPhi: number): number => snapAngle(startAngle + wheelDelta(band, fromPhi, toPhi));

/** Where on the wheel (screen direction) the mark for `angle` sits, in a band, while the wheel stands at `current`. */
export const markPhi = (band: WheelBand, marker: number, current: number, angle: number): number => marker + turn(angle, current) / WHEEL_GAIN[band];

/** The share of a bar's track that a finger at `at` selects: `at` and `start` are measured the same way along the bar, `length` is the track and `handle` the handle that must stay inside it. */
export const trackFraction = (at: number, start: number, length: number, handle: number): number => {
  const run = length - handle;
  return run > 0 ? Math.min(1, Math.max(0, (at - start - handle / 2) / run)) : 0;
};

/** The power a finger selects on the bar: `fraction` is 0 at the low end, 1 at the high one. Never above the cap. */
export function barPower(fraction: number, cap: number = AIM.MAX_POWER): number {
  const power = Math.round(Math.min(1, Math.max(0, fraction)) * AIM.MAX_POWER);
  return Math.min(cap, Math.max(AIM.MIN_POWER, power));
}

export const barFraction = (power: number): number => Math.min(1, Math.max(0, power / AIM.MAX_POWER));

/** What a tap on the bar's ends moves: the power in ones, and the angle by arrow keys in half degrees. */
export const POWER_STEP = 1;
export const ANGLE_STEP = STEP;

export const stepPower = (power: number, direction: number, cap: number = AIM.MAX_POWER): number =>
  Math.min(cap, Math.max(AIM.MIN_POWER, Math.round(power) + direction * POWER_STEP));

export const stepAngle = (angle: number, direction: number): number => snapAngle(angle + direction * ANGLE_STEP);
