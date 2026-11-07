import type { BlackHole } from '../../sim/physics';
import { rgba } from '../color';
import { WHITE_JUMP, type WhiteJump } from './painter';

/** The white hole's white: a little cooler than the plate's bone, so it reads as light and not as paper. */
export const WHITE_HOLE = '#edf7ff';

const TAU = Math.PI * 2;
export const easeOut = (t: number): number => 1 - (1 - t) ** 3;

/**
 * Anomaly White Hole in the engraved plan: a pale core filling the horizon, ringed in fine line, with short strokes running
 * out of it across the disk, the other way to everything that falls in.
 */
export function drawEngravedWhiteCore(ctx: CanvasRenderingContext2D, hole: BlackHole, time: number): void {
  const R = hole.radius;
  // Nearly the whole shadow: only a thin black rim is left of the hole.
  const core = Math.max(6, R * 0.92);
  const breathe = 0.85 + 0.15 * Math.sin(time * 2.4);
  ctx.save();
  ctx.translate(hole.x, hole.y);
  const fill = ctx.createRadialGradient(0, 0, 0, 0, 0, core);
  fill.addColorStop(0, rgba('#ffffff', 1));
  fill.addColorStop(0.7, rgba(WHITE_HOLE, 0.97 * breathe));
  fill.addColorStop(0.92, rgba(WHITE_HOLE, 0.8 * breathe));
  fill.addColorStop(1, rgba(WHITE_HOLE, 0));
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(0, 0, core, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = rgba(WHITE_HOLE, 0.9);
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.arc(0, 0, core * 0.9, 0, TAU);
  ctx.stroke();
  // Strokes running out of the core, each on a spoke of its own, born at the core and gone beyond the disk.
  ctx.lineCap = 'round';
  ctx.lineWidth = 1.5;
  const spokes = 12;
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * TAU + (i % 2) * 0.13;
    const phase = (time * 0.45 + ((i * 5) % spokes) / spokes) % 1;
    const r0 = core * 0.9 + phase * R * 1.5;
    const len = 4 + R * 0.3 * (1 - phase * 0.5);
    ctx.strokeStyle = rgba(WHITE_HOLE, 0.9 * Math.sin(Math.PI * phase));
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
    ctx.lineTo(Math.cos(a) * (r0 + len), Math.sin(a) * (r0 + len));
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * A white-hole jump in the engraved plan: a ring in the shooter's colour closes on the core and it flashes, and at the way
 * out half rings and rays open into the field, the shot glowing white as it comes through.
 */
export function drawEngravedWhiteJump(ctx: CanvasRenderingContext2D, j: WhiteJump): void {
  const { age, hole } = j;
  ctx.save();
  ctx.lineCap = 'round';
  if (hole && age < WHITE_JUMP.SWALLOW) {
    const s = age / WHITE_JUMP.SWALLOW;
    const R = hole.radius;
    ctx.strokeStyle = rgba(j.color, 0.9 * (1 - s));
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(hole.x, hole.y, R * (1.9 - 1.5 * s * s), 0, TAU);
    ctx.stroke();
    ctx.fillStyle = rgba(WHITE_HOLE, 0.9 * (1 - s));
    ctx.beginPath();
    ctx.arc(hole.x, hole.y, Math.max(6, R * 0.92) * (1 + 0.4 * (1 - s)), 0, TAU);
    ctx.fill();
  }
  if (age < WHITE_JUMP.LIFE) {
    const s = age / WHITE_JUMP.LIFE;
    const k = 1 - s;
    ctx.save();
    ctx.translate(j.x, j.y);
    ctx.rotate(j.out);
    // +x points out of the field: everything here opens towards -x.
    ctx.strokeStyle = rgba(WHITE_HOLE, 0.9 * k);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -8 - 26 * k);
    ctx.lineTo(0, 8 + 26 * k);
    ctx.stroke();
    for (const [reach, color, alpha] of [[70, WHITE_HOLE, 0.9], [42, j.color, 0.7]] as const) {
      ctx.strokeStyle = rgba(color, alpha * k);
      ctx.beginPath();
      ctx.arc(0, 0, 8 + reach * easeOut(s), Math.PI / 2, Math.PI * 1.5);
      ctx.stroke();
    }
    ctx.lineWidth = 1.1;
    const rays = 9;
    for (let i = 0; i < rays; i++) {
      const a = Math.PI + (i / (rays - 1) - 0.5) * 1.9;
      const r0 = 6 + 24 * easeOut(s);
      const r1 = r0 + (14 + (i % 3) * 8) * k;
      ctx.strokeStyle = rgba(i % 2 ? j.color : WHITE_HOLE, 0.8 * k);
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
      ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
      ctx.stroke();
    }
    ctx.restore();
  }
  if (age < WHITE_JUMP.GLOW) drawWhiteGlow(ctx, j.shotX, j.shotY, 1 - age / WHITE_JUMP.GLOW, 14);
  ctx.restore();
}

/** The white the shot carries out of the hole, `strength` (0 → 1) of it, `reach` across. */
export function drawWhiteGlow(ctx: CanvasRenderingContext2D, x: number, y: number, strength: number, reach: number): void {
  const glow = ctx.createRadialGradient(x, y, 0, x, y, reach);
  glow.addColorStop(0, rgba('#ffffff', 0.95 * strength));
  glow.addColorStop(0.35, rgba(WHITE_HOLE, 0.5 * strength));
  glow.addColorStop(1, rgba(WHITE_HOLE, 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, reach, 0, TAU);
  ctx.fill();
}
