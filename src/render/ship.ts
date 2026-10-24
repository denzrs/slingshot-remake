import { COLORS } from '../config';
import { rgba } from './color';

/** Nose at +x. */
export const SHIP_HULL: [number, number][] = [
  [15, 0], [-2, -5], [-11, -11], [-7, -3.5], [-11, 0], [-7, 3.5], [-11, 11], [-2, 5],
];

const EMBERS = 6;

function hullPath(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  SHIP_HULL.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
}

/**
 * A ship, refined, in its own frame (centred, nose along +x): the classic hull in its solid colour, glowing the way
 * the player arrows of the menus do — a soft halo that breathes, a bloom hugging the silhouette and blinking wing lights — with an engine
 * plume behind it: a flame in three layers, always idling and roaring while the ship aims, and embers that fly off
 * the end and die. `thrust` is 0 (idle) to 1 (aiming); `phase` keeps the ships from flickering in step.
 */
export function drawRefinedShip(ctx: CanvasRenderingContext2D, color: string, time: number, thrust: number, phase: number): void {
  const breathe = 0.85 + 0.15 * Math.sin(time * 2.2 + phase);

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  // The glow: a wide soft halo, and the silhouette's own bloom (stacked wide strokes, which cost far less than shadowBlur).
  const halo = ctx.createRadialGradient(0, 0, 3, 0, 0, 30);
  halo.addColorStop(0, rgba(color, 0.3 * breathe));
  halo.addColorStop(0.5, rgba(color, 0.1 * breathe));
  halo.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = halo;
  ctx.fillRect(-30, -30, 60, 60);
  hullPath(ctx);
  ctx.lineJoin = 'round';
  for (const [width, alpha] of [[11, 0.05], [6.5, 0.09], [3.4, 0.15]] as const) {
    ctx.strokeStyle = rgba(color, alpha * breathe);
    ctx.lineWidth = width;
    ctx.stroke();
  }

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
  ctx.restore();

  // The hull, as it always was: solid colour, a dark edge, the dark canopy.
  hullPath(ctx);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = COLORS.plate;
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.fillStyle = COLORS.plate;
  ctx.beginPath();
  ctx.ellipse(4, 0, 3.2, 1.8, 0, 0, Math.PI * 2);
  ctx.fill();

  // Wing lights, blinking in turn.
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const side of [-1, 1]) {
    const on = 0.5 + 0.5 * Math.sin(time * 4 + phase + (side > 0 ? 0 : Math.PI));
    const light = ctx.createRadialGradient(-10.5, side * 10.5, 0, -10.5, side * 10.5, 4.5);
    light.addColorStop(0, rgba(COLORS.bone, 0.95 * on));
    light.addColorStop(0.35, rgba(color, 0.7 * on));
    light.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = light;
    ctx.fillRect(-15.5, side * 10.5 - 5, 10, 10);
  }
  ctx.restore();
}
