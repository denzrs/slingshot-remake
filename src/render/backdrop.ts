import { COLORS } from '../config';
import { createRng } from '../rng';
import { plateUnits } from './layout';
import { rgba } from './color';

export interface View {
  /** CSS pixel size of the canvas. */
  cssWidth: number;
  cssHeight: number;
  dpr: number;
  /** CSS pixels per field unit, and the field's top-left in CSS pixels. */
  scale: number;
  offsetX: number;
  offsetY: number;
  /** Held upright on a phone, the HUD gets this box (above the controls, the whole width) instead of the field's. */
  stage?: { x: number; y: number; w: number; h: number };
  /** The field is turned a quarter round (its left side at the bottom): see `layout.ts`. */
  rotated?: boolean;
}

/**
 * The static plate behind everything: ink gradient, stars, emulsion grain and
 * the plotter frame with registration marks. Rebuilt only on resize or when edges change.
 */
export function renderBackdrop(view: View, walls: boolean): HTMLCanvasElement {
  const { cssWidth, cssHeight, dpr, scale, offsetX, offsetY } = view;
  const plate = plateUnits(!!view.rotated);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);

  const cx = offsetX + (plate.w * scale) / 2;
  const cy = offsetY + (plate.h * scale) / 2;
  const g = ctx.createRadialGradient(cx, cy * 0.9, 0, cx, cy, Math.hypot(cssWidth, cssHeight) * 0.62);
  g.addColorStop(0, COLORS.plateLift);
  g.addColorStop(1, COLORS.plate);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, cssWidth, cssHeight);

  const rng = createRng(0x5eed);
  // Emulsion grain.
  const grains = Math.round((cssWidth * cssHeight) / 90);
  for (let i = 0; i < grains; i++) {
    ctx.fillStyle = rgba(COLORS.bone, 0.012 + rng() * 0.03);
    ctx.fillRect(rng() * cssWidth, rng() * cssHeight, 1, 1);
  }
  // Stars: mostly pin-pricks, a few bright ones with a soft halo.
  const stars = Math.round((cssWidth * cssHeight) / 2600);
  for (let i = 0; i < stars; i++) {
    const x = rng() * cssWidth;
    const y = rng() * cssHeight;
    const m = Math.pow(rng(), 3);
    const r = 0.35 + m * 1.1;
    if (m > 0.55) {
      const halo = ctx.createRadialGradient(x, y, 0, x, y, r * 5);
      halo.addColorStop(0, rgba(COLORS.bone, 0.22));
      halo.addColorStop(1, rgba(COLORS.bone, 0));
      ctx.fillStyle = halo;
      ctx.fillRect(x - r * 5, y - r * 5, r * 10, r * 10);
    }
    ctx.fillStyle = rgba(rng() < 0.15 ? COLORS.sodium : COLORS.bone, 0.35 + m * 0.6);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  drawFrame(ctx, scale, offsetX, offsetY, walls, plate);
  return canvas;
}

function drawFrame(ctx: CanvasRenderingContext2D, scale: number, ox: number, oy: number, walls: boolean, plate: { w: number; h: number }): void {
  const W = plate.w * scale;
  const H = plate.h * scale;
  ctx.save();
  ctx.translate(ox, oy);
  ctx.lineWidth = 1;

  if (walls) {
    ctx.strokeStyle = rgba(COLORS.line, 0.6);
    ctx.lineWidth = 1.5;
    ctx.strokeRect(0.75, 0.75, W - 1.5, H - 1.5);
    ctx.lineWidth = 1;
  }

  // Ruler ticks every 40 field units, longer every 200.
  ctx.strokeStyle = rgba(COLORS.line, 0.45);
  ctx.beginPath();
  for (let u = 40; u < plate.w; u += 40) {
    const len = u % 200 === 0 ? 9 : 4;
    const x = Math.round(u * scale) + 0.5;
    ctx.moveTo(x, 0); ctx.lineTo(x, len);
    ctx.moveTo(x, H); ctx.lineTo(x, H - len);
  }
  for (let u = 40; u < plate.h; u += 40) {
    const len = u % 200 === 0 ? 9 : 4;
    const y = Math.round(u * scale) + 0.5;
    ctx.moveTo(0, y); ctx.lineTo(len, y);
    ctx.moveTo(W, y); ctx.lineTo(W - len, y);
  }
  ctx.stroke();

  // Registration marks in the corners.
  ctx.strokeStyle = rgba(COLORS.bone, 0.4);
  for (const [x, y] of [[0, 0], [W, 0], [0, H], [W, H]]) {
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.moveTo(x - 13, y); ctx.lineTo(x + 13, y);
    ctx.moveTo(x, y - 13); ctx.lineTo(x, y + 13);
    ctx.stroke();
  }
  ctx.restore();
}
