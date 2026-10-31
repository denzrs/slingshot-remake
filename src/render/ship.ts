import { COLORS } from '../sim/config';
import { rgba } from './color';

/** Nose at +x. */
export const SHIP_HULL: [number, number][] = [
  [15, 0], [-2, -5], [-11, -11], [-7, -3.5], [-11, 0], [-7, 3.5], [-11, 11], [-2, 5],
];

const EMBERS = 6;

export function hullPath(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  SHIP_HULL.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
}

/**
 * The engine plume behind a ship, nose along +x: a flame in three layers that flickers, swells while aiming
 * and tapers to nothing, and embers that leave the end and burn out. Added to what is under it: the caller has
 * set 'lighter'.
 */
export function drawEngineFlame(ctx: CanvasRenderingContext2D, color: string, time: number, thrust: number, phase: number): void {
  // The plume: it flickers, swells while aiming, and tapers to nothing.
  const flicker = 0.75 + 0.25 * Math.sin(time * 31 + phase) * Math.sin(time * 17 + phase * 2);
  const len = (10 + 17 * thrust) * flicker;
  const wide = 3.4 + 1.2 * thrust;
  const layers = [
    { reach: 1.25, half: wide, from: color, alpha: 0.5 },
    { reach: 0.85, half: wide * 0.62, from: COLORS.sodium, alpha: 0.8 },
    { reach: 0.45, half: wide * 0.3, from: COLORS.bone, alpha: 0.95 },
  ];
  for (const { reach, half, from, alpha } of layers) {
    const l = len * reach;
    const flame = ctx.createLinearGradient(-9, 0, -9 - l, 0);
    flame.addColorStop(0, rgba(from, alpha));
    flame.addColorStop(1, rgba(from, 0));
    ctx.fillStyle = flame;
    ctx.beginPath();
    ctx.moveTo(-8, -half);
    ctx.quadraticCurveTo(-9 - l * 0.5, -half * 0.7, -9 - l, 0);
    ctx.quadraticCurveTo(-9 - l * 0.5, half * 0.7, -8, half);
    ctx.closePath();
    ctx.fill();
  }
  // Embers: specks that leave the flame, wander sideways and burn out.
  for (let i = 0; i < EMBERS; i++) {
    const age = (time * (0.7 + 0.5 * thrust) + i / EMBERS + phase * 0.13) % 1;
    const ex = -10 - age * (22 + 26 * thrust);
    const ey = Math.sin(i * 7.3 + phase + time * 2.4) * (1 + age * (4 + 3 * thrust));
    ctx.fillStyle = rgba(i % 2 ? COLORS.sodium : color, 0.85 * (1 - age) * (0.6 + 0.4 * flicker));
    ctx.beginPath();
    ctx.arc(ex, ey, 1.6 * (1 - age) + 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
}
