import { COLORS } from '../../sim/config';
import { rgba } from '../color';
import type { LoopGate } from './painter';

/** One lens-shaped sliver, upright: from (dx, -half) over the bulge `width` to (dx, half) and back. */
function sliver(ctx: CanvasRenderingContext2D, half: number, width: number, dx = 0): void {
  ctx.beginPath();
  ctx.moveTo(dx, -half);
  ctx.quadraticCurveTo(dx + width, 0, dx, half);
  ctx.quadraticCurveTo(dx - width, 0, dx, -half);
}

/**
 * A gate of a loop in forged light: a tear in space. A white-hot sliver with colour fringes (the light bends apart as in a
 * lens), rings of light running out of it and streaks of light being drawn in from where the shot comes from.
 */
export function drawForgedGate(ctx: CanvasRenderingContext2D, { x, y, out, color, strength, time }: LoopGate): void {
  if (strength <= 0) return;
  const reach = 54 * (0.45 + 0.55 * strength);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(out);
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';

  // The glow round the tear, narrow across it.
  ctx.save();
  ctx.scale(0.4, 1);
  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, reach * 1.6);
  glow.addColorStop(0, rgba(COLORS.bone, 0.5 * strength));
  glow.addColorStop(0.35, rgba(color, 0.28 * strength));
  glow.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, 0, reach * 1.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Rings of light running out of it.
  ctx.lineWidth = 1.2;
  for (let k = 0; k < 2; k++) {
    const phase = (time * 1.1 + k / 2) % 1;
    ctx.strokeStyle = rgba(color, 0.5 * strength * (1 - phase));
    ctx.beginPath();
    ctx.ellipse(0, 0, 8 + phase * 34, reach * (0.8 + phase * 0.55), 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Streaks of light drawn into it from the side the shot comes from, quicker the closer they are.
  for (let i = 0; i < 9; i++) {
    const phase = (time * 1.4 + i / 9) % 1;
    const across = (((i * 5) % 9) / 8 - 0.5) * reach * 1.7;
    const head = -64 * (1 - phase);
    ctx.strokeStyle = rgba(i % 3 === 0 ? COLORS.bone : color, 0.75 * strength * Math.sin(Math.PI * phase));
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(head - 11 * phase, across * (1 - phase * 0.9));
    ctx.lineTo(head, across * (1 - phase * 0.9));
    ctx.stroke();
  }

  // The colour fringes, the sliver itself and its bright edge.
  for (const [dx, fringe] of [[3.4, '#ff6fae'], [-3.4, '#5fd8ff']] as const) {
    sliver(ctx, reach * 0.95, 10 * strength + 1.5, dx);
    ctx.strokeStyle = rgba(fringe, 0.55 * strength);
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }
  sliver(ctx, reach, 12 * strength + 2);
  const core = ctx.createLinearGradient(0, -reach, 0, reach);
  core.addColorStop(0, rgba(color, 0));
  core.addColorStop(0.5, rgba(COLORS.bone, 0.95 * strength));
  core.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = core;
  ctx.fill();
  ctx.strokeStyle = rgba(color, 0.9 * strength);
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.restore();
}
