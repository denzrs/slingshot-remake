import { COLORS } from '../../sim/config';
import { rgba } from '../color';
import { beyondClearing, fog, hash2, tile } from './dark-fog';
import { holoPolygon } from './holo-art';
import type { DarkMasks } from './painter';

const GLOW = '#7fe8ff';

/**
 * Holo: the matter is where the projection has no data. The glass goes dark, only the bare hexagon lattice of the
 * projector shows in it, brightening and dimming in a slow pulse; the edge of what was scanned is a glowing line with a
 * dashed scan line crawling behind it and packets of data hopping along it.
 */
export function drawHoloDark(ctx: CanvasRenderingContext2D, masks: DarkMasks, time: number): void {
  const hex = tile('holo-dark-hex-lines', 28, 48, (c) => {
    c.strokeStyle = 'rgba(70,220,255,0.15)';
    c.lineWidth = 1;
    const r = 8;
    const hexAt = (cx: number, cy: number): void => {
      c.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = (Math.PI / 3) * k + Math.PI / 6;
        c.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      }
      c.closePath();
      c.stroke();
    };
    hexAt(7, 8);
    hexAt(21, 32);
    hexAt(21, -16);
    hexAt(7, 56);
    // the projector's scan lines, in the tile so they cost nothing
    c.fillStyle = 'rgba(70,220,255,0.035)';
    for (let y = 0; y < 48; y += 4) c.fillRect(0, y, 28, 1);
  });
  fog(ctx, masks, { scale: 0.5, fps: 6 }, time, (c, w, h) => {
    c.fillStyle = '#010509';
    c.fillRect(0, 0, w, h);
    c.fillStyle = c.createPattern(hex, 'repeat')!;
    c.fillRect(0, 0, w, h);
    // the lattice breathes: slowly a little brighter, slowly back, as the projector keeps searching
    const pulse = 0.5 - 0.5 * Math.cos((time / 6) * Math.PI * 2);
    c.globalAlpha = 0.35 * pulse;
    c.fillStyle = c.createPattern(hex, 'repeat')!;
    c.fillRect(0, 0, w, h);
    c.globalAlpha = 1;
  });
  beyondClearing(ctx, masks, () => {
    ctx.save();
    ctx.setLineDash([3, 5]);
    ctx.lineDashOffset = -time * 18;
    ctx.strokeStyle = rgba(GLOW, 0.4);
    ctx.lineWidth = 0.7;
    ctx.stroke(masks.iso(0.85).path);
    ctx.restore();
    const edge = masks.iso(0.5);
    // the edge glows as the projection's lines do: a wide faint pass, a narrower one, the line
    const alpha = 0.85 + 0.1 * Math.sin(time * 5);
    for (const [width, a] of [[3, 0.14], [0.9, 0.95]] as const) {
      ctx.strokeStyle = rgba(GLOW, a * alpha);
      ctx.lineWidth = width;
      ctx.stroke(edge.path);
    }
    ctx.globalCompositeOperation = 'lighter';
    // packets hopping along the edge
    const segs = edge.segments;
    const n = segs.length / 4;
    for (let i = 0; i < 30 && n; i++) {
      const hop = Math.floor(time * 6 + i * 0.37);
      const s = Math.floor(hash2(i, Math.floor(hop / 8)) * n + (hop % 8)) % n * 4;
      ctx.fillStyle = rgba(i % 3 ? GLOW : '#ffffff', 0.9);
      ctx.fillRect(segs[s] - 1, segs[s + 1] - 1, 2, 2);
    }
    ctx.globalCompositeOperation = 'source-over';
  });
}

/**
 * Holo: found. The projector flags the ship: red hexagons sent out from it like a signal, a warning hexagon round it
 * filled with scan lines that flicker, and three chevrons pointing in.
 */
export function drawHoloDarkAlert(ctx: CanvasRenderingContext2D, x: number, y: number, age: number): void {
  const fade = Math.min(1, (3 - age) / 0.6);
  if (fade <= 0) return;
  const red = COLORS.danger;
  ctx.save();
  ctx.translate(x, y);
  ctx.globalCompositeOperation = 'lighter';
  for (let k = 0; k < 3; k++) {
    const t = (age * 0.8 + k / 3) % 1;
    holoPolygon(ctx, 16 + t * 44, 6, Math.PI / 6);
    ctx.strokeStyle = rgba(red, 0.8 * (1 - t) * fade);
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.save();
  holoPolygon(ctx, 20, 6, Math.PI / 6);
  ctx.clip();
  if (Math.floor(age * 10) % 3) {
    ctx.fillStyle = rgba(red, 0.32 * fade);
    for (let yy = -20; yy < 20; yy += 2.5) ctx.fillRect(-20, yy, 40, 0.8);
  }
  ctx.restore();
  holoPolygon(ctx, 20, 6, Math.PI / 6);
  ctx.strokeStyle = rgba('#ffd0d4', 0.9 * fade);
  ctx.lineWidth = 1.1;
  ctx.stroke();
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 - Math.PI / 2 + age * 0.6;
    const r = 30 + Math.sin(age * 8) * 2;
    ctx.save();
    ctx.rotate(a);
    ctx.translate(r, 0);
    ctx.beginPath();
    ctx.moveTo(4, -4);
    ctx.lineTo(0, 0);
    ctx.lineTo(4, 4);
    ctx.strokeStyle = rgba(red, 0.95 * fade);
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}
