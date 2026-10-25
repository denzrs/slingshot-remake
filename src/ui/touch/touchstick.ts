import { AIM } from '../../sim/config';
import { normalizeAngle } from '../../sim/physics';

/**
 * The aiming stick, as plain maths: a knob that is pulled back from the middle of a circle, like the pouch of a
 * slingshot. The shot goes the other way, and the farther the knob is pulled the harder it goes.
 */

/** The share of the radius within which the knob counts as at rest: a finger there has no direction. */
export const STICK_REST = 0.08;

const STEP = 0.5;
const snap = (v: number): number => Math.round(v / STEP) * STEP;

/** The aim for a knob at `px`, `py` from the middle (`py` down); `radius` is the pull for full power. Null at rest. */
export function stickAim(px: number, py: number, radius: number, cap: number = AIM.MAX_POWER): { angle: number; power: number } | null {
  const length = Math.hypot(px, py);
  if (length < radius * STICK_REST) return null;
  // The shot's direction, counter-clockwise from the right, is the knob's the other way round.
  const phi = (Math.atan2(py, -px) * 180) / Math.PI;
  const power = Math.round(Math.min(1, length / radius) * AIM.MAX_POWER);
  return { angle: normalizeAngle(snap(phi)) || 0, power: Math.min(cap, Math.max(AIM.MIN_POWER, power)) };
}

/** Where the knob sits for an aim: the other way from the shot, as far as the power says. */
export function stickKnob(angle: number, power: number, radius: number): { x: number; y: number } {
  const a = (angle * Math.PI) / 180;
  const r = Math.min(1, Math.max(0, power / AIM.MAX_POWER)) * radius;
  return { x: -Math.cos(a) * r, y: Math.sin(a) * r };
}
