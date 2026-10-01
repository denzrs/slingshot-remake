import { COLORS } from '../config';
import type { BlackHole } from '../physics';
import { rgba } from './color';

/** Lens rings: radius (× lens radius) and how strongly the starfield behind them is magnified. */
const LENS_STEPS = [
  [1, 1.06],
  [0.82, 1.16],
  [0.66, 1.32],
  [0.52, 1.55],
  [0.4, 1.9],
] as const;

const TILT = -0.2;

/**
 * Gravitational lensing: re-draws the static backdrop around the hole in nested discs,
 * each magnified a little more, so stars bulge away from the horizon.
 * Call with the field transform active, before contours and planets.
 */
export function drawLens(ctx: CanvasRenderingContext2D, hole: BlackHole, backdrop: HTMLCanvasElement): void {
  const m = ctx.getTransform();
  const c = m.transformPoint(new DOMPoint(hole.x, hole.y));
  const lens = (hole.radius * 5 + 34) * m.a;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  for (const [r, mag] of LENS_STEPS) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(c.x, c.y, lens * r, 0, Math.PI * 2);
    ctx.clip();
    ctx.translate(c.x, c.y);
    ctx.scale(mag, mag);
    ctx.translate(-c.x, -c.y);
    ctx.drawImage(backdrop, 0, 0);
    ctx.restore();
  }
  ctx.restore();
}

/**
 * The hole itself: accretion disk (back half), the black horizon, photon ring,
 * the lensed far side of the disk arching over the top, then the disk's front half.
 */
export function drawBlackHole(ctx: CanvasRenderingContext2D, hole: BlackHole, time: number): void {
  const R = hole.radius;
  ctx.save();
  ctx.translate(hole.x, hole.y);

  const halo = ctx.createRadialGradient(0, 0, R, 0, 0, R * 5);
  halo.addColorStop(0, rgba(COLORS.sodium, 0.22));
  halo.addColorStop(1, rgba(COLORS.sodium, 0));
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(0, 0, R * 5, 0, Math.PI * 2);
  ctx.fill();

  ctx.rotate(TILT);
  drawDisk(ctx, R, time, Math.PI, Math.PI * 2);

  // Far side of the disk, bent over the top by the hole's gravity.
  ctx.lineCap = 'round';
  ctx.strokeStyle = rgba(COLORS.sodium, 0.55);
  ctx.lineWidth = R * 0.3;
  ctx.beginPath();
  ctx.ellipse(0, -R * 0.08, R * 1.55, R * 1.42, 0, Math.PI * 1.08, Math.PI * 1.92);
  ctx.stroke();

  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = rgba(COLORS.bone, 0.95);
  ctx.lineWidth = Math.max(1, R * 0.07);
  ctx.beginPath();
  ctx.arc(0, 0, R * 1.07, 0, Math.PI * 2);
  ctx.stroke();

  drawDisk(ctx, R, time, 0, Math.PI);
  ctx.restore();
}

/** Concentric, flattened rings whose dashes stream around at Keplerian-ish speeds (inner = faster). */
function drawDisk(ctx: CanvasRenderingContext2D, R: number, time: number, from: number, to: number): void {
  const rings = 7;
  for (let i = 0; i < rings; i++) {
    const t = i / (rings - 1);
    const rx = R * (1.5 + t * 2.1);
    const ry = rx * 0.2;
    const color = t < 0.25 ? COLORS.bone : t < 0.6 ? COLORS.sodium : COLORS.players[0];
    ctx.strokeStyle = rgba(color, 0.85 - t * 0.6);
    ctx.lineWidth = Math.max(0.8, R * (0.16 - t * 0.08));
    ctx.setLineDash([R * (0.6 + t), R * (0.3 + t * 0.5)]);
    ctx.lineDashOffset = -time * (60 / (0.6 + t)) * (R / 16);
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, from, to);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;
}

/** Where the horizon will be after the next collapse — the "zone" everyone must stay out of. */
export function drawDangerRing(ctx: CanvasRenderingContext2D, hole: BlackHole, radius: number, time: number): void {
  ctx.save();
  ctx.strokeStyle = rgba(COLORS.danger, 0.6);
  ctx.lineWidth = 1.2;
  ctx.setLineDash([5, 6]);
  ctx.lineDashOffset = time * 8;
  ctx.beginPath();
  ctx.arc(hole.x, hole.y, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}
