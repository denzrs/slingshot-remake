import { createRng } from '../../sim/rng';
import { fbm } from '../noise';
import { smoothstep } from '../planet-common';
import type { FrameInfo } from './painter';

/**
 * What the forged look puts behind and over the field as a whole: a nebula and dust lanes baked into the backdrop, layers
 * of stars and dust drifting at depths of their own, and over the finished field a bloom (the bright parts, blurred
 * wide and added back), a vignette, a grade and a little film grain.
 */

let current: FrameInfo | null = null;

/** Keeps the frame for the calls that follow it: the sky, the ships' light and the post pass read it. */
export function forgedBegin(frame: FrameInfo): void {
  current = frame;
}

/** The frame being drawn, null before the first one. */
export const forgedFrame = (): FrameInfo | null => current;

// ----------------------------------------------------------------- nebula ----

/** One pixel of the nebula's map covers this many CSS pixels. */
const CELL = 5;

/** The nebula and the dust lanes across it, painted once onto the backdrop (CSS pixels). */
export function paintNebula(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const gw = Math.ceil(w / CELL);
  const gh = Math.ceil(h / CELL);
  const glow = new ImageData(gw, gh);
  const lanes = new ImageData(gw, gh);
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      // The same picture whatever the screen's shape: the map spans the screen, not a number of pixels.
      const nx = (x / gw) * 3.2;
      const ny = (y / gh) * 2.4;
      const wx = fbm(nx * 0.8 + 11, ny * 0.8, 0.5, 7, 3);
      const wy = fbm(nx * 0.8, ny * 0.8 + 23, 1.5, 9, 3);
      const density = fbm(nx + wx * 1.6, ny + wy * 1.6, 3.1, 21, 5);
      const dust = fbm(nx * 1.7 + 40, ny * 1.7, 8.2, 33, 4);
      const hue = fbm(nx * 0.6 + 90, ny * 0.6, 5.5, 55, 2);
      const cloud = smoothstep(0.46, 0.78, density);
      // Teal through violet to rose.
      const t = smoothstep(0.35, 0.65, hue);
      const i = (y * gw + x) * 4;
      glow.data[i] = t < 0.5 ? 40 + 140 * t : 110 + 80 * (t - 0.5) * 2;
      glow.data[i + 1] = t < 0.5 ? 150 - 80 * t * 2 : 70;
      glow.data[i + 2] = t < 0.5 ? 190 + 10 * t * 2 : 200 - 50 * (t - 0.5) * 2;
      glow.data[i + 3] = 255 * cloud * 0.26 * (0.6 + 0.4 * dust);
      lanes.data[i] = 5;
      lanes.data[i + 1] = 10;
      lanes.data[i + 2] = 24;
      lanes.data[i + 3] = 255 * smoothstep(0.58, 0.78, dust) * cloud * 0.35;
    }
  }
  const layer = (data: ImageData): HTMLCanvasElement => {
    const canvas = document.createElement('canvas');
    canvas.width = gw;
    canvas.height = gh;
    canvas.getContext('2d')!.putImageData(data, 0, 0);
    return canvas;
  };
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.globalCompositeOperation = 'lighter';
  ctx.drawImage(layer(glow), 0, 0, gw * CELL, gh * CELL);
  ctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(layer(lanes), 0, 0, gw * CELL, gh * CELL);
  ctx.restore();
}

// -------------------------------------------------------------------- sky ----

const TILE = 512;

interface Tiles {
  dpr: number;
  farA: CanvasPattern;
  farB: CanvasPattern;
  near: CanvasPattern;
  grain: CanvasPattern;
}
let tiles: Tiles | null = null;

function tile(draw: (c: CanvasRenderingContext2D, rng: () => number) => void, seed: number, ctx: CanvasRenderingContext2D, size = TILE): CanvasPattern {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  draw(canvas.getContext('2d')!, createRng(seed));
  return ctx.createPattern(canvas, 'repeat')!;
}

function buildTiles(ctx: CanvasRenderingContext2D, dpr: number): Tiles {
  const stars = (count: number, seed: number): CanvasPattern =>
    tile(
      (c, rng) => {
        for (let i = 0; i < count; i++) {
          const x = rng() * TILE;
          const y = rng() * TILE;
          const m = rng() ** 2;
          const r = (0.5 + m * 0.9) * dpr;
          const warm = rng();
          const [cr, cg, cb] = warm < 0.2 ? [255, 214, 160] : warm < 0.45 ? [170, 210, 255] : [232, 236, 248];
          if (m > 0.75) {
            const halo = c.createRadialGradient(x, y, 0, x, y, r * 5);
            halo.addColorStop(0, `rgba(${cr},${cg},${cb},0.16)`);
            halo.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
            c.fillStyle = halo;
            c.fillRect(x - r * 5, y - r * 5, r * 10, r * 10);
          }
          c.fillStyle = `rgba(${cr},${cg},${cb},${0.45 + m * 0.5})`;
          c.beginPath();
          c.arc(x, y, r, 0, Math.PI * 2);
          c.fill();
        }
      },
      seed,
      ctx,
    );
  return {
    dpr,
    farA: stars(26, 0xf0a1),
    farB: stars(26, 0xf0b2),
    // Out-of-focus motes, close to the eye.
    near: tile(
      (c, rng) => {
        for (let i = 0; i < 9; i++) {
          const x = rng() * TILE;
          const y = rng() * TILE;
          const r = (2 + rng() * 3.5) * dpr;
          const glow = c.createRadialGradient(x, y, 0, x, y, r);
          glow.addColorStop(0, `rgba(190,220,255,${0.05 + rng() * 0.07})`);
          glow.addColorStop(1, 'rgba(190,220,255,0)');
          c.fillStyle = glow;
          c.fillRect(x - r, y - r, r * 2, r * 2);
        }
      },
      0xf0c3,
      ctx,
    ),
    grain: tile(
      (c, rng) => {
        const img = c.createImageData(128, 128);
        for (let i = 0; i < img.data.length; i += 4) {
          const v = rng() * 255;
          img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
          img.data[i + 3] = 255;
        }
        c.putImageData(img, 0, 0);
      },
      0xf0d4,
      ctx,
      128,
    ),
  };
}

function layer(ctx: CanvasRenderingContext2D, pattern: CanvasPattern, f: FrameInfo, alpha: number, vx: number, vy: number, depth: number): void {
  // The layer drifts, and slides against the field as the camera or the shake moves the field: the nearer, the more.
  const ox = f.time * vx * f.dpr + (f.field.e - f.plate.x) * depth;
  const oy = f.time * vy * f.dpr + (f.field.f - f.plate.y) * depth;
  pattern.setTransform(new DOMMatrix().translate(ox, oy));
  ctx.globalAlpha = alpha;
  ctx.fillStyle = pattern;
  ctx.fillRect(f.plate.x, f.plate.y, f.plate.w, f.plate.h);
}

/** Stars that twinkle in turn and drift at two depths, and a few motes of dust close up, over the plate. */
export function forgedSky(ctx: CanvasRenderingContext2D, f: FrameInfo): void {
  if (!tiles || tiles.dpr !== f.dpr) tiles = buildTiles(ctx, f.dpr);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const pulse = Math.sin(f.time * 1.3);
  layer(ctx, tiles.farA, f, 0.55 + 0.4 * pulse, 1.2, 0.4, 0.2);
  layer(ctx, tiles.farB, f, 0.55 - 0.4 * pulse, -0.8, 0.5, 0.2);
  layer(ctx, tiles.near, f, 0.7, 7, 2.5, 0.55);
  ctx.restore();
}

// ------------------------------------------------------------------- post ----

interface Level {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}
/** The bloom's work canvases at ½, ¼, ⅛ and 1/16 of the screen, kept for each size that is drawn. */
const chains = new Map<string, Level[]>();

function chainFor(w: number, h: number): Level[] {
  const key = `${w}×${h}`;
  let chain = chains.get(key);
  if (!chain) {
    if (chains.size >= 4) chains.clear();
    chain = [2, 4, 8, 16].map((d) => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.ceil(w / d));
      canvas.height = Math.max(1, Math.ceil(h / d));
      return { canvas, ctx: canvas.getContext('2d')! };
    });
    chains.set(key, chain);
  }
  return chain;
}

function shrink(from: CanvasImageSource, to: Level): void {
  to.ctx.globalCompositeOperation = 'copy';
  to.ctx.drawImage(from, 0, 0, to.canvas.width, to.canvas.height);
  to.ctx.globalCompositeOperation = 'source-over';
}

let vignette: { key: string; gradient: CanvasGradient } | null = null;

/**
 * On a phone the grade and the grain are left out. Each is one more blend over the whole screen, and soft-light and overlay
 * have to read back what lies under them, which a phone's GPU pays for dearly at its pixel density; for a tint of a few percent.
 */
const phone = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

/**
 * Bloom: the picture is shrunk, its dull parts are dropped (raised to the eighth power, so only what is nearly white stays), and what
 * is left is blurred by shrinking it further, then added back over the picture on the way up. A vignette, a grade
 * and grain over it (not on a phone). The flash and the supernova's white-out make it bloom wider.
 */
export function forgedPost(ctx: CanvasRenderingContext2D, f: FrameInfo): void {
  const main = ctx.canvas;
  const [c2, c4, c8, c16] = chainFor(main.width, main.height);
  shrink(main, c2);
  shrink(c2.canvas, c4);
  // Squared three times (to the eighth power): a colour that is merely bright, like a ship's, falls away; only near-white blooms.
  c4.ctx.globalCompositeOperation = 'multiply';
  for (let i = 0; i < 3; i++) c4.ctx.drawImage(c4.canvas, 0, 0);
  c4.ctx.globalCompositeOperation = 'source-over';
  shrink(c4.canvas, c8);
  shrink(c8.canvas, c16);
  c8.ctx.globalCompositeOperation = 'lighter';
  c8.ctx.drawImage(c16.canvas, 0, 0, c8.canvas.width, c8.canvas.height);
  c8.ctx.globalCompositeOperation = 'source-over';
  c4.ctx.globalCompositeOperation = 'lighter';
  c4.ctx.drawImage(c8.canvas, 0, 0, c4.canvas.width, c4.canvas.height);
  c4.ctx.globalCompositeOperation = 'source-over';
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = Math.min(1, 0.35 + 0.4 * f.flash + 0.3 * f.whiteout);
  ctx.drawImage(c4.canvas, 0, 0, main.width, main.height);

  // The vignette: the plate's corners fall into shadow.
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  const key = `${main.width}×${main.height}|${f.plate.x}|${f.plate.y}`;
  if (vignette?.key !== key) {
    const cx = f.plate.x + f.plate.w / 2;
    const cy = f.plate.y + f.plate.h / 2;
    const reach = Math.hypot(f.plate.w, f.plate.h) * 0.62;
    const gradient = ctx.createRadialGradient(cx, cy, reach * 0.5, cx, cy, reach);
    gradient.addColorStop(0, 'rgba(2,5,12,0)');
    gradient.addColorStop(1, 'rgba(2,5,12,0.55)');
    vignette = { key, gradient };
  }
  ctx.fillStyle = vignette.gradient;
  ctx.fillRect(0, 0, main.width, main.height);
  if (phone) {
    ctx.restore();
    return;
  }

  // The grade: cool in the high lights of the top, warm in the low ones.
  ctx.globalCompositeOperation = 'soft-light';
  const grade = ctx.createLinearGradient(0, f.plate.y, 0, f.plate.y + f.plate.h);
  grade.addColorStop(0, 'rgba(70,130,255,0.14)');
  grade.addColorStop(1, 'rgba(255,150,70,0.1)');
  ctx.fillStyle = grade;
  ctx.fillRect(f.plate.x, f.plate.y, f.plate.w, f.plate.h);

  // Film grain: a tile of noise laid at a new place about fifteen times a second.
  if (tiles) {
    const step = Math.floor(f.time * 15);
    tiles.grain.setTransform(new DOMMatrix().translate((step * 37) % 128, (step * 91) % 128));
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = 0.05;
    ctx.fillStyle = tiles.grain;
    ctx.fillRect(f.plate.x, f.plate.y, f.plate.w, f.plate.h);
  }
  ctx.restore();
}
