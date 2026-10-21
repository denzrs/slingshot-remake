import { COLORS } from '../config';
import type { Planet } from '../physics';
import { rgba } from './color';

const RAYS = 28;

/**
 * The sun of the Solar System mode, drawn like the black hole: a warm halo, a bright disc with a fine limb ring,
 * dashed corona rings streaming round it (inner = faster, like the orbits) and a crown of short flickering rays.
 */
export function drawSun(ctx: CanvasRenderingContext2D, sun: Planet, time: number, alpha = 1): void {
  const R = sun.radius;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(sun.x, sun.y);

  const halo = ctx.createRadialGradient(0, 0, R * 0.9, 0, 0, R * 4.2);
  halo.addColorStop(0, rgba(COLORS.sodium, 0.34));
  halo.addColorStop(0.35, rgba(COLORS.sodium, 0.1));
  halo.addColorStop(1, rgba(COLORS.sodium, 0));
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(0, 0, R * 4.2, 0, Math.PI * 2);
  ctx.fill();

  // Rays: short strokes of uneven length that breathe slowly.
  ctx.lineCap = 'round';
  ctx.strokeStyle = rgba(COLORS.sodium, 0.7);
  ctx.lineWidth = Math.max(1, R * 0.06);
  for (let i = 0; i < RAYS; i++) {
    const a = (i / RAYS) * Math.PI * 2 + time * 0.03;
    const len = R * (0.12 + 0.1 * (0.5 + 0.5 * Math.sin(time * 1.3 + i * 2.1)) + (i % 2 ? 0.12 : 0));
    const from = R * 1.12;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * from, Math.sin(a) * from);
    ctx.lineTo(Math.cos(a) * (from + len), Math.sin(a) * (from + len));
    ctx.stroke();
  }

  // Corona rings: dashes streaming round, the inner ones quicker.
  const rings = 3;
  for (let i = 0; i < rings; i++) {
    const t = i / (rings - 1);
    const r = R * (1.42 + t * 0.5);
    ctx.strokeStyle = rgba(t < 0.4 ? COLORS.bone : COLORS.sodium, 0.75 - t * 0.4);
    ctx.lineWidth = Math.max(0.8, R * (0.07 - t * 0.03));
    ctx.setLineDash([R * (0.5 + t * 0.4), R * (0.3 + t * 0.4)]);
    ctx.lineDashOffset = -time * (36 / (0.7 + t)) * (R / 34);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;

  const disc = ctx.createRadialGradient(0, 0, 0, 0, 0, R);
  disc.addColorStop(0, rgba(COLORS.bone, 1));
  disc.addColorStop(0.55, rgba(COLORS.sodium, 1));
  disc.addColorStop(1, rgba(COLORS.players[0], 1));
  ctx.fillStyle = disc;
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = rgba(COLORS.bone, 0.95);
  ctx.lineWidth = Math.max(1, R * 0.05);
  ctx.beginPath();
  ctx.arc(0, 0, R * 1.07, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}
