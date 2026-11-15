import { COLORS } from '../../sim/config';
import { rgba } from '../color';
import { beyondClearing, fog, tile } from './dark-fog';
import type { DarkMasks } from './painter';

/**
 * Einfach: the matter is the blank of a survey map, territory nobody has charted. The plate is inked over and hatched
 * in its own line colour, and where a shot has charted it the edge is drawn as contours, as the gravity is: the coast in
 * bone, two depth lines inside it in the plate's blue.
 */
export function drawEngravedDark(ctx: CanvasRenderingContext2D, masks: DarkMasks, time: number): void {
  const hatch = tile('classic-dark-hatch', 5, 5, (c) => {
    c.strokeStyle = rgba(COLORS.line, 0.32);
    c.lineWidth = 0.6;
    c.beginPath();
    c.moveTo(-1, 6);
    c.lineTo(6, -1);
    c.stroke();
  });
  fog(ctx, masks, { scale: 0.5, fps: 0 }, time, (c, w, h) => {
    c.fillStyle = '#050b18';
    c.fillRect(0, 0, w, h);
    c.fillStyle = c.createPattern(hatch, 'repeat')!;
    c.fillRect(0, 0, w, h);
  });
  beyondClearing(ctx, masks, () => {
    ctx.strokeStyle = rgba(COLORS.line, 0.32);
    ctx.lineWidth = 0.6;
    ctx.stroke(masks.iso(0.93).path);
    ctx.strokeStyle = rgba(COLORS.line, 0.55);
    ctx.lineWidth = 0.7;
    ctx.setLineDash([5, 3]);
    ctx.stroke(masks.iso(0.78).path);
    ctx.setLineDash([]);
    ctx.strokeStyle = rgba(COLORS.bone, 0.85);
    ctx.lineWidth = 1.1;
    ctx.stroke(masks.iso(0.5).path);
  });
}

/**
 * Einfach: found. An engraved range finder in the danger red closes on the ship: four corner marks drawing in, a ring
 * with ticks turning round it, as the plan marks a target.
 */
export function drawEngravedDarkAlert(ctx: CanvasRenderingContext2D, x: number, y: number, age: number): void {
  const fade = Math.min(1, (3 - age) / 0.6);
  if (fade <= 0) return;
  const close = (age * 1.25) % 1;
  const r = 18 + (1 - close) ** 2 * 34;
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = rgba(COLORS.danger, 0.95 * fade);
  ctx.lineWidth = 1.3;
  ctx.lineCap = 'square';
  for (let k = 0; k < 4; k++) {
    ctx.save();
    ctx.rotate((k * Math.PI) / 2);
    ctx.beginPath();
    ctx.moveTo(r, r - 7);
    ctx.lineTo(r, r);
    ctx.lineTo(r - 7, r);
    ctx.stroke();
    ctx.restore();
  }
  // the ring with its ticks, turning
  ctx.rotate(age * 0.8);
  ctx.strokeStyle = rgba(COLORS.danger, 0.55 * fade);
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.arc(0, 0, 24, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    const len = k % 3 === 0 ? 6 : 3;
    ctx.moveTo(Math.cos(a) * 24, Math.sin(a) * 24);
    ctx.lineTo(Math.cos(a) * (24 + len), Math.sin(a) * (24 + len));
  }
  ctx.stroke();
  // a blink at the heart, as a mark is struck
  if (Math.floor(age * 4) % 2 === 0) {
    ctx.fillStyle = rgba(COLORS.danger, 0.9 * fade);
    ctx.beginPath();
    ctx.arc(0, 0, 1.8, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
