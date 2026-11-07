import { LOOP_MARGIN } from '../sim/config';

/** A shot between an edge of a loop's field and the line beyond it where it is carried across: the gate it is flying at. */
export interface Lens {
  /** The direction out of the field at that edge: 0 right, π left, π/2 bottom, -π/2 top. */
  out: number;
  /** Where along the edge: y on the left and right edge, x on the top and bottom one. */
  at: number;
  /** How open the gate is, 0 → 1: it opens quickly as the shot dives in and eases off a little at the line. */
  strength: number;
  /** The point of the line the shot is flying at, where its gate opens. */
  x: number;
  y: number;
  /** 0 at the edge of the field, 1 at the line, where the shot is gone. */
  depth: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** The gate a shot at (x, y) is flying at, or null while it is inside the field. */
export function lensAt(x: number, y: number, width: number, height: number): Lens | null {
  const beyondX = Math.max(-x, x - width);
  const beyondY = Math.max(-y, y - height);
  const beyond = Math.max(beyondX, beyondY);
  if (beyond <= 0) return null;
  const depth = Math.min(1, beyond / LOOP_MARGIN);
  const strength = Math.min(1, depth * 3) * (1 - depth * 0.35);
  const out = beyondX >= beyondY ? (x > width ? 0 : Math.PI) : y > height ? Math.PI / 2 : -Math.PI / 2;
  const sideways = out === 0 || out === Math.PI;
  const at = sideways ? clamp(y, 0, height) : clamp(x, 0, width);
  return { out, at, strength, ...gatePoint(out, at, width, height), depth };
}

/** The point on the carry-across line on the side `out` points out of, at `at` along it. */
export function gatePoint(out: number, at: number, width: number, height: number): { x: number; y: number } {
  if (out === 0) return { x: width + LOOP_MARGIN, y: at };
  if (out === Math.PI) return { x: -LOOP_MARGIN, y: at };
  if (out === Math.PI / 2) return { x: at, y: height + LOOP_MARGIN };
  return { x: at, y: -LOOP_MARGIN };
}

/** The direction out of the field at the edge across from the one `out` points out of. */
export const acrossOf = (out: number): number => (out === 0 ? Math.PI : out === Math.PI ? 0 : -out);
