import { AIM } from './config';
import { normalizeAngle } from './physics';

/**
 * The touch aiming controls, as plain maths: a wheel for the angle and a vertical slider for the power.
 * The wheel is a quarter circle in the corner of the screen that turns under the thumb, like a scroll wheel:
 * what it shows is a window onto the 360°, and the angle follows how far the finger has turned it.
 */

/** Degrees of angle per degree the finger sweeps round the corner: one swipe across the wheel turns it half way round. */
export const WHEEL_GAIN = 2;

/** The screen direction of the wheel's marker, in degrees counter-clockwise from the right: the middle of the quarter. */
export const WHEEL_MARKER = 135;

const STEP = 0.5;
const snap = (v: number): number => Math.round(v / STEP) * STEP;

/** The direction of a point seen from the wheel's centre (the screen corner), in degrees counter-clockwise from the right. `dy` is down. */
export const pointerPhi = (dx: number, dy: number): number => (Math.atan2(-dy, dx) * 180) / Math.PI;

/** A difference of two directions, the short way round: -180 to 180. */
const turn = (from: number, to: number): number => ((((to - from) % 360) + 540) % 360) - 180;

/** The angle after the finger went from one direction to another, having started with `startAngle`. */
export const wheelAngle = (startAngle: number, fromPhi: number, toPhi: number): number => normalizeAngle(snap(startAngle + turn(fromPhi, toPhi) * WHEEL_GAIN));

/** Where on the wheel (screen direction) the mark for `angle` sits while the wheel stands at `current`. */
export const markPhi = (current: number, angle: number): number => WHEEL_MARKER + turn(angle, current) / WHEEL_GAIN;

/** The power a finger selects on the slider: `fraction` is 0 at the bottom, 1 at the top. Never above the cap. */
export function sliderPower(fraction: number, cap: number = AIM.MAX_POWER): number {
  const power = Math.round(Math.min(1, Math.max(0, fraction)) * AIM.MAX_POWER);
  return Math.min(cap, Math.max(AIM.MIN_POWER, power));
}

export const sliderFraction = (power: number): number => Math.min(1, Math.max(0, power / AIM.MAX_POWER));
