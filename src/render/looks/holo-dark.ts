import { DARK_CELL, DARK_MARGIN } from '../../game/dark-matter';
import { COLORS, FIELD } from '../../sim/config';
import { rgba } from '../color';
import { traceDarkIso, type DarkIso } from '../dark-iso';
import { beyondClearing, createDarkDissolve, hash2, stepDarkDissolve, tile, type DarkDissolve } from './dark-fog';
import { holoPolygon } from './holo-art';
import type { DarkMasks } from './painter';

const GLOW = '#7fe8ff';
const FULL_W = FIELD.width + 2 * DARK_MARGIN;
const FULL_H = FIELD.height + 2 * DARK_MARGIN;
const BODY_SCALE = 0.5;
const BODY_W = Math.ceil(FULL_W * BODY_SCALE);
const BODY_H = Math.ceil(FULL_H * BODY_SCALE);
const IDLE_FPS = 6;
/** Honeycomb size in field units for cells that light up and shrink as a shot scans/dissolves the projection. */
const HEX_R = 11;
const HEX_DX = Math.sqrt(3) * HEX_R;
const HEX_DY = 1.5 * HEX_R;
const HEX_VERTS = Array.from({ length: 6 }, (_, k) => {
  const a = (Math.PI / 3) * k + Math.PI / 6;
  return [Math.cos(a), Math.sin(a)] as const;
});

interface HoloDarkState {
  dissolve: DarkDissolve;
  mask: HTMLCanvasElement;
  maskData: ImageData | null;
  body: HTMLCanvasElement;
  stamp: string | null;
  bucket: number;
  isoTick: number;
  isoMid: DarkIso | null;
  isoOuter: DarkIso | null;
}

const holoByCtx = new WeakMap<CanvasRenderingContext2D, HoloDarkState>();

function sampleGrid(data: Float32Array, cols: number, rows: number, fx: number, fy: number): number {
  const gx = (fx + DARK_MARGIN) / DARK_CELL - 0.5;
  const gy = (fy + DARK_MARGIN) / DARK_CELL - 0.5;
  if (gx < -0.5 || gy < -0.5 || gx >= cols - 0.5 || gy >= rows - 0.5) return 0;
  const c0 = Math.max(0, Math.min(cols - 1, Math.floor(gx)));
  const r0 = Math.max(0, Math.min(rows - 1, Math.floor(gy)));
  const c1 = Math.min(cols - 1, c0 + 1);
  const r1 = Math.min(rows - 1, r0 + 1);
  const tx = Math.max(0, Math.min(1, gx - c0));
  const ty = Math.max(0, Math.min(1, gy - r0));
  const i00 = r0 * cols + c0;
  const i10 = r0 * cols + c1;
  const i01 = r1 * cols + c0;
  const i11 = r1 * cols + c1;
  const top = data[i00] + (data[i10] - data[i00]) * tx;
  const bot = data[i01] + (data[i11] - data[i01]) * tx;
  return top + (bot - top) * ty;
}

/** Paints the de-materializing holographic hex cells and micro-packets over the actively dissolving wake. */
function drawHoloDissolveHexes(
  ctx: CanvasRenderingContext2D,
  d: DarkDissolve,
  cols: number,
  rows: number,
  color: string,
): void {
  if (!d.active || d.c1 < d.c0) return;
  const fx0 = (d.c0 - 1) * DARK_CELL - DARK_MARGIN;
  const fx1 = (d.c1 + 2) * DARK_CELL - DARK_MARGIN;
  const fy0 = (d.r0 - 1) * DARK_CELL - DARK_MARGIN;
  const fy1 = (d.r1 + 2) * DARK_CELL - DARK_MARGIN;
  const rMin = Math.floor((fy0 + DARK_MARGIN) / HEX_DY);
  const rMax = Math.ceil((fy1 + DARK_MARGIN) / HEX_DY);
  const cMin = Math.floor((fx0 + DARK_MARGIN) / HEX_DX) - 1;
  const cMax = Math.ceil((fx1 + DARK_MARGIN) / HEX_DX) + 1;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineWidth = 0.75;
  for (let row = rMin; row <= rMax; row++) {
    const hy = row * HEX_DY - DARK_MARGIN;
    const xShift = row & 1 ? HEX_DX * 0.5 : 0;
    for (let col = cMin; col <= cMax; col++) {
      const hx = col * HEX_DX + xShift - DARK_MARGIN;
      const w = sampleGrid(d.wake, cols, rows, hx, hy);
      if (w <= 0.025) continue;
      const v = sampleGrid(d.vis, cols, rows, hx, hy);
      const j = hash2(col, row);
      const env = Math.min(1, w * (0.85 + 0.5 * j));
      const r = HEX_R * (0.28 + 0.72 * Math.min(1, v * 0.55 + env * 0.65));
      ctx.beginPath();
      for (let k = 0; k < 6; k++) {
        const px = hx + HEX_VERTS[k][0] * r;
        const py = hy + HEX_VERTS[k][1] * r;
        if (k) ctx.lineTo(px, py);
        else ctx.moveTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = rgba(j > 0.72 ? color : GLOW, 0.12 * env);
      ctx.fill();
      ctx.strokeStyle = rgba(GLOW, 0.62 * env);
      ctx.stroke();
      if (env > 0.35) {
        const spark = 4 * env * (1 - env * 0.5);
        ctx.fillStyle = rgba(j > 0.4 ? '#ffffff' : GLOW, 0.75 * env);
        ctx.fillRect(hx + (j - 0.5) * r * 0.9 - 0.8, hy + (hash2(row, col) - 0.5) * r * 0.9 - 0.8, 1.6 * Math.max(0.7, spark), 1.6);
      }
    }
  }
  ctx.restore();
}

/**
 * Holo: the matter is where the projection has no data. The glass goes dark, only the bare hexagon lattice of the
 * projector shows in it, brightening and dimming in a slow pulse; as a shot tears through it, the dark glass recedes
 * smoothly while holographic hex cells light up, shrink and dissolve along the scanned wake, leaving the glowing edge
 * with its dashed scan line and hopping data packets.
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

  const { id, cover, cols, rows, version } = masks.field;
  let state = holoByCtx.get(ctx);
  if (!state) {
    state = {
      dissolve: createDarkDissolve(),
      mask: Object.assign(document.createElement('canvas'), { width: cols, height: rows }),
      maskData: null,
      body: Object.assign(document.createElement('canvas'), { width: BODY_W, height: BODY_H }),
      stamp: null,
      bucket: -1,
      isoTick: -1,
      isoMid: null,
      isoOuter: null,
    };
    holoByCtx.set(ctx, state);
  }
  const active = stepDarkDissolve(state.dissolve, id, cover, cols, rows, version, time);
  const clearingKey = masks.clearing ? `${Math.round(masks.clearing.x)},${Math.round(masks.clearing.y)},${Math.round(masks.clearing.r)}` : '-';
  const stamp = `${id}:${version}:${clearingKey}`;
  const bucket = Math.floor(time * IDLE_FPS);
  if (state.stamp !== stamp || bucket !== state.bucket || active) {
    if (state.mask.width !== cols || state.mask.height !== rows) {
      state.mask.width = cols;
      state.mask.height = rows;
      state.maskData = null;
    }
    const mc = state.mask.getContext('2d')!;
    const img = (state.maskData ??= mc.createImageData(cols, rows));
    const { vis } = state.dissolve;
    for (let i = 0; i < vis.length; i++) img.data[i * 4 + 3] = (vis[i] * 255 + 0.5) | 0;
    mc.putImageData(img, 0, 0);

    const bc = state.body.getContext('2d')!;
    bc.save();
    bc.globalCompositeOperation = 'source-over';
    bc.globalAlpha = 1;
    bc.clearRect(0, 0, BODY_W, BODY_H);
    bc.fillStyle = '#010509';
    bc.fillRect(0, 0, BODY_W, BODY_H);
    bc.fillStyle = bc.createPattern(hex, 'repeat')!;
    bc.fillRect(0, 0, BODY_W, BODY_H);
    // the lattice breathes: slowly a little brighter, slowly back, as the projector keeps searching
    const pulse = 0.5 - 0.5 * Math.cos((time / 6) * Math.PI * 2);
    bc.globalAlpha = 0.35 * pulse;
    bc.fillStyle = bc.createPattern(hex, 'repeat')!;
    bc.fillRect(0, 0, BODY_W, BODY_H);
    bc.globalAlpha = 1;
    bc.globalCompositeOperation = 'destination-in';
    bc.imageSmoothingEnabled = true;
    bc.drawImage(state.mask, 0, 0, BODY_W, BODY_H);
    if (masks.clearing) {
      const hx = (masks.clearing.x + DARK_MARGIN) * BODY_SCALE;
      const hy = (masks.clearing.y + DARK_MARGIN) * BODY_SCALE;
      const r = masks.clearing.r * BODY_SCALE;
      const g = bc.createRadialGradient(hx, hy, r * 0.35, hx, hy, r);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      bc.globalCompositeOperation = 'destination-out';
      bc.fillStyle = g;
      bc.fillRect(hx - r - 1, hy - r - 1, r * 2 + 2, r * 2 + 2);
    }
    bc.restore();
    state.stamp = stamp;
    state.bucket = bucket;
  }

  ctx.save();
  ctx.globalAlpha = masks.fade;
  ctx.drawImage(state.body, -DARK_MARGIN, -DARK_MARGIN, FULL_W, FULL_H);
  ctx.restore();

  beyondClearing(ctx, masks, () => {
    let mid: DarkIso;
    let outer: DarkIso;
    if (active) {
      if (state.isoTick !== state.dissolve.tick || !state.isoMid || !state.isoOuter) {
        state.isoMid = traceDarkIso(state.dissolve.vis, cols, rows, 0.5);
        state.isoOuter = traceDarkIso(state.dissolve.vis, cols, rows, 0.85);
        state.isoTick = state.dissolve.tick;
      }
      mid = state.isoMid;
      outer = state.isoOuter;
    } else {
      mid = masks.iso(0.5);
      outer = masks.iso(0.85);
    }
    drawHoloDissolveHexes(ctx, state.dissolve, cols, rows, masks.color);
    ctx.save();
    ctx.setLineDash([3, 5]);
    ctx.lineDashOffset = -time * 18;
    ctx.strokeStyle = rgba(GLOW, 0.4);
    ctx.lineWidth = 0.7;
    ctx.stroke(outer.path);
    ctx.restore();
    // the edge glows as the projection's lines do: a wide faint pass, a narrower one, the line
    const alpha = 0.85 + 0.1 * Math.sin(time * 5);
    for (const [width, a] of [[3, 0.14], [0.9, 0.95]] as const) {
      ctx.strokeStyle = rgba(GLOW, a * alpha);
      ctx.lineWidth = width;
      ctx.stroke(mid.path);
    }
    ctx.globalCompositeOperation = 'lighter';
    // packets hopping along the edge
    const segs = mid.segments;
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
