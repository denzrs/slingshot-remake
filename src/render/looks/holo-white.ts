import type { BlackHole } from '../../sim/physics';
import { rgba } from '../color';
import { easeOut, WHITE_HOLE } from './classic-white';
import { holoPolygon } from './holo-art';
import { WHITE_JUMP, type WhiteJump } from './painter';

const TAU = Math.PI * 2;
const GLOW = '#7fe8ff';

/**
 * Anomaly White Hole as a projection: a scanned white hexagon in the horizon, hexagons sent out of it like a signal, and
 * packets running outwards along six spokes.
 */
export function drawHoloWhiteCore(ctx: CanvasRenderingContext2D, hole: BlackHole, time: number): void {
  const R = hole.radius;
  // Nearly the whole shadow: the hexagon's corners stay just inside the black.
  const core = Math.max(5, R * 0.9);
  ctx.save();
  ctx.translate(hole.x, hole.y);
  ctx.globalCompositeOperation = 'lighter';

  // The core: a hexagon filled with scan lines, a line rolling down it.
  ctx.save();
  holoPolygon(ctx, core, 6, time * 0.4);
  ctx.clip();
  ctx.fillStyle = rgba(WHITE_HOLE, 0.26);
  ctx.fillRect(-core, -core, core * 2, core * 2);
  ctx.fillStyle = rgba(WHITE_HOLE, 0.7);
  for (let y = -core; y < core; y += 2.5) ctx.fillRect(-core, y, core * 2, 0.8);
  const roll = ((time * 0.8) % 1) * core * 2 - core;
  ctx.fillStyle = rgba('#ffffff', 0.9);
  ctx.fillRect(-core, roll, core * 2, 1.4);
  ctx.restore();
  holoPolygon(ctx, core, 6, time * 0.4);
  ctx.strokeStyle = rgba('#ffffff', 0.9);
  ctx.lineWidth = 1;
  ctx.stroke();

  // Hexagons sent out, one after another.
  for (let k = 0; k < 3; k++) {
    const phase = (time * 0.6 + k / 3) % 1;
    holoPolygon(ctx, core + phase * R * 1.9, 6, time * 0.4);
    ctx.strokeStyle = rgba(k % 2 ? GLOW : WHITE_HOLE, 0.7 * (1 - phase));
    ctx.lineWidth = 0.9;
    ctx.stroke();
  }

  // Packets on six spokes, running out.
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + time * 0.4 + Math.PI / 6;
    const phase = (time * 0.9 + i * 0.37) % 1;
    const r = core + phase * R * 1.8;
    ctx.fillStyle = rgba(i % 2 ? GLOW : '#ffffff', 0.9 * Math.sin(Math.PI * phase));
    ctx.fillRect(Math.cos(a) * r - 1.2, Math.sin(a) * r - 1.2, 2.4, 2.4);
  }
  ctx.restore();
}

/**
 * A white-hole jump as a projection: a hexagon in the shooter's colour folds into the core, and at the way out half
 * hexagons spread into the field like a signal coming in, the shot scanned in white.
 */
export function drawHoloWhiteJump(ctx: CanvasRenderingContext2D, j: WhiteJump): void {
  const { age, hole } = j;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  if (hole && age < WHITE_JUMP.SWALLOW) {
    const s = age / WHITE_JUMP.SWALLOW;
    const R = hole.radius;
    ctx.save();
    ctx.translate(hole.x, hole.y);
    for (const [lag, color] of [[0, j.color], [0.25, '#ffffff']] as const) {
      const p = Math.min(1, s + lag);
      holoPolygon(ctx, R * (2 - 1.6 * p * p), 6, s * 2);
      ctx.strokeStyle = rgba(color, 0.9 * (1 - s));
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
    ctx.restore();
  }
  if (age < WHITE_JUMP.LIFE) {
    const s = age / WHITE_JUMP.LIFE;
    const k = 1 - s;
    ctx.save();
    ctx.translate(j.x, j.y);
    ctx.rotate(j.out);
    // Only the half inside the field.
    ctx.beginPath();
    ctx.rect(-200, -200, 200, 400);
    ctx.clip();
    for (let n = 0; n < 3; n++) {
      const p = Math.max(0, easeOut(s) - n * 0.18);
      if (p <= 0) continue;
      holoPolygon(ctx, 8 + p * 70, 6, Math.PI / 6);
      ctx.strokeStyle = rgba(n % 2 ? j.color : WHITE_HOLE, 0.85 * k);
      ctx.lineWidth = n ? 0.9 : 1.3;
      ctx.stroke();
    }
    // The edge it came through, scanned bright.
    ctx.fillStyle = rgba('#ffffff', 0.9 * k);
    ctx.fillRect(-1.2, -10 - 28 * k, 2.4, 20 + 56 * k);
    for (let i = 0; i < 9; i++) {
      const a = Math.PI + (((i * 4) % 9) / 8 - 0.5) * 1.8;
      const r = 10 + easeOut(s) * (30 + ((i * 7) % 5) * 10);
      ctx.fillStyle = rgba(i % 2 ? GLOW : '#ffffff', 0.9 * k);
      ctx.fillRect(Math.cos(a) * r - 1.2, Math.sin(a) * r - 1.2, 2.4, 2.4);
    }
    ctx.restore();
  }
  if (age < WHITE_JUMP.GLOW) {
    const g = 1 - age / WHITE_JUMP.GLOW;
    ctx.save();
    ctx.translate(j.shotX, j.shotY);
    holoPolygon(ctx, 7 + 5 * (1 - g), 6, j.time * 3);
    ctx.strokeStyle = rgba('#ffffff', 0.95 * g);
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}
