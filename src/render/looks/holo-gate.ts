import { rgba } from '../color';
import type { LoopGate } from './painter';

const GLOW = '#7fe8ff';

/** A hexagon with its points up and down, as tall as `r`. */
function hexagon(ctx: CanvasRenderingContext2D, r: number): void {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3 - Math.PI / 2;
    const px = Math.cos(a) * r;
    const py = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/**
 * A gate of a loop as a projection: a tunnel of thin hexagons that run into the glass, a scan line with a bright node
 * travelling along it, a few slices of the picture that slip sideways like a bad signal, and bits drawn in from the side the shot comes from.
 */
export function drawHoloGate(ctx: CanvasRenderingContext2D, { x, y, out, color, strength, time }: LoopGate): void {
  if (strength <= 0) return;
  const reach = 46 * (0.5 + 0.5 * strength);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(out);
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineJoin = 'round';

  // The frame: a bright hexagon, flattened so the gate stands like a doorway, over a soft glow.
  ctx.save();
  ctx.scale(0.5, 1);
  const wash = ctx.createRadialGradient(0, 0, 0, 0, 0, reach * 1.2);
  wash.addColorStop(0, rgba(color, 0.16 * strength));
  wash.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = wash;
  ctx.fillRect(-reach * 1.2, -reach * 1.2, reach * 2.4, reach * 2.4);
  for (const [lineWidth, alpha] of [[4, 0.06], [1, 0.85]] as const) {
    hexagon(ctx, reach * 1.1);
    ctx.strokeStyle = rgba(GLOW, alpha * strength);
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
  // The tunnel: hexagons that shrink into the glass, one after the other.
  for (let k = 0; k < 4; k++) {
    const phase = (time * 0.8 + k / 4) % 1;
    hexagon(ctx, reach * (1.05 - phase * 0.9));
    ctx.strokeStyle = rgba(k % 2 ? color : GLOW, 0.8 * strength * Math.sin(Math.PI * phase));
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.restore();

  // The scan line and its node.
  ctx.strokeStyle = rgba(GLOW, 0.45 * strength);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, -reach);
  ctx.lineTo(0, reach);
  ctx.stroke();
  const node = Math.sin(time * 3.2) * reach * 0.9;
  ctx.fillStyle = rgba('#ffffff', 0.9 * strength);
  ctx.fillRect(-2.2, node - 2.2, 4.4, 4.4);

  // Slices that slip sideways, a dozen times a second.
  const frame = Math.floor(time * 12);
  ctx.strokeStyle = rgba(color, 0.7 * strength);
  for (let i = 0; i < 3; i++) {
    const at = (((frame * 7 + i * 13) % 17) / 17 - 0.5) * 2 * reach;
    const slip = ((frame * 3 + i * 5) % 9) - 4;
    ctx.beginPath();
    ctx.moveTo(-12 + slip, at);
    ctx.lineTo(12 + slip, at);
    ctx.stroke();
  }

  // Bits of the picture drawn in from the side the shot comes from.
  for (let i = 0; i < 7; i++) {
    const phase = (time * 1.2 + i / 7) % 1;
    const across = (((i * 3) % 7) / 6 - 0.5) * reach * 1.6;
    ctx.fillStyle = rgba(i % 2 ? color : GLOW, 0.8 * strength * Math.sin(Math.PI * phase));
    ctx.fillRect(-56 * (1 - phase) - 1, across * (1 - phase * 0.85) - 1, 2, 2);
  }
  ctx.restore();
}
