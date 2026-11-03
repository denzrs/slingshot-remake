import { getPostLevel, type PostLevel } from '../../data/look';
import { createRng } from '../../sim/rng';
import { fbm } from '../noise';
import { smoothstep } from '../planet-common';
import type { FrameInfo } from './painter';

/**
 * What the forged look puts behind and over the field as a whole: a nebula and dust lanes baked into the backdrop, layers
 * of stars drifting at depths of their own, and over the finished field a bloom (the bright parts, blurred
 * wide and added back), a vignette, a grade and a little film grain.
 */

let current: FrameInfo | null = null;

/** Keeps the frame for the calls that follow it: the sky, the ships' light and the post pass read it. */
export function forgedBegin(frame: FrameInfo): void {
  current = frame;
  started = performance.now();
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

/** A star: its own little picture, and where its middle lies in the tile. */
interface Speck {
  sprite: HTMLCanvasElement;
  x: number;
  y: number;
}

/**
 * Each layer is a tile of specks repeated over the plate. The specks are drawn one by one rather than the tile filled in
 * as a pattern: the tile is nearly all empty, and a pattern laid at a fraction of a pixel has every pixel of the plate
 * sampled from it, which a canvas drawn without a GPU (Firefox on many machines) paid for with most of its frame.
 */
interface Tiles {
  dpr: number;
  farA: Speck[];
  farB: Speck[];
  grain: CanvasPattern;
}
let tiles: Tiles | null = null;

/** A speck's picture, `reach` pixels out from its middle each way; `draw` paints it round (0, 0). */
function speck(reach: number, x: number, y: number, draw: (c: CanvasRenderingContext2D) => void): Speck {
  const sprite = document.createElement('canvas');
  sprite.width = sprite.height = Math.ceil(reach) * 2 + 2;
  const c = sprite.getContext('2d')!;
  c.translate(sprite.width / 2, sprite.height / 2);
  draw(c);
  return { sprite, x, y };
}

function buildTiles(ctx: CanvasRenderingContext2D, dpr: number): Tiles {
  const stars = (count: number, seed: number): Speck[] => {
    const rng = createRng(seed);
    return Array.from({ length: count }, () => {
      const x = rng() * TILE;
      const y = rng() * TILE;
      const m = rng() ** 2;
      const r = (0.5 + m * 0.9) * dpr;
      const warm = rng();
      const [cr, cg, cb] = warm < 0.2 ? [255, 214, 160] : warm < 0.45 ? [170, 210, 255] : [232, 236, 248];
      return speck(m > 0.75 ? r * 5 : r, x, y, (c) => {
        if (m > 0.75) {
          const halo = c.createRadialGradient(0, 0, 0, 0, 0, r * 5);
          halo.addColorStop(0, `rgba(${cr},${cg},${cb},0.16)`);
          halo.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
          c.fillStyle = halo;
          c.fillRect(-r * 5, -r * 5, r * 10, r * 10);
        }
        c.fillStyle = `rgba(${cr},${cg},${cb},${0.45 + m * 0.5})`;
        c.beginPath();
        c.arc(0, 0, r, 0, Math.PI * 2);
        c.fill();
      });
    });
  };
  const grain = document.createElement('canvas');
  grain.width = grain.height = 128;
  const g = grain.getContext('2d')!;
  const img = g.createImageData(128, 128);
  const rng = createRng(0xf0d4);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = rng() * 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return { dpr, farA: stars(26, 0xf0a1), farB: stars(26, 0xf0b2), grain: ctx.createPattern(grain, 'repeat')! };
}

function layer(ctx: CanvasRenderingContext2D, specks: readonly Speck[], f: FrameInfo, alpha: number, vx: number, vy: number, depth: number): void {
  // The layer drifts, and slides against the field as the camera or the shake moves the field: the nearer, the more.
  const ox = f.time * vx * f.dpr + (f.field.e - f.plate.x) * depth;
  const oy = f.time * vy * f.dpr + (f.field.f - f.plate.y) * depth;
  const { x: px, y: py, w, h } = f.plate;
  ctx.globalAlpha = alpha;
  // Every copy of the tile that reaches the plate, starting a tile early for the specks that hang over its edge.
  for (let ty = oy + (Math.floor((py - oy) / TILE) - 1) * TILE; ty < py + h; ty += TILE) {
    for (let tx = ox + (Math.floor((px - ox) / TILE) - 1) * TILE; tx < px + w; tx += TILE) {
      for (const s of specks) {
        const half = s.sprite.width / 2;
        const x = tx + s.x;
        const y = ty + s.y;
        if (x + half < px || x - half > px + w || y + half < py || y - half > py + h) continue;
        ctx.drawImage(s.sprite, x - half, y - half);
      }
    }
  }
}

/** Stars that twinkle in turn and drift at two depths, over the plate. */
export function forgedSky(ctx: CanvasRenderingContext2D, f: FrameInfo): void {
  if (!tiles || tiles.dpr !== f.dpr) tiles = buildTiles(ctx, f.dpr);
  ctx.save();
  ctx.beginPath();
  ctx.rect(f.plate.x, f.plate.y, f.plate.w, f.plate.h);
  ctx.clip();
  ctx.globalCompositeOperation = 'lighter';
  const pulse = Math.sin(f.time * 1.3);
  layer(ctx, tiles.farA, f, 0.55 + 0.4 * pulse, 1.2, 0.4, 0.2);
  layer(ctx, tiles.farB, f, 0.55 - 0.4 * pulse, -0.8, 0.5, 0.2);
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
 * How much of the post pass a machine that cannot keep up is spared: 0 all of it is drawn; 1 not the grade and the grain;
 * 2 not the bloom either; 3 not the vignette either. Each is a pass over the whole screen, which a phone's GPU at its pixel
 * density, or a canvas drawn without a GPU, pays for dearly.
 *
 * It goes by how long a frame takes to draw (from `forgedBegin` to the end of the post pass), not by how far apart frames
 * come: a browser that hands out thirty frames a second to save the battery, a hidden tab or a menu over a still field
 * say nothing about the drawing. Each canvas keeps its own, so the gallery's cards do not judge each other. A step down
 * that saved nothing (the field itself is what is slow) is taken back and not tried again; one that did is undone once
 * the frames have room for what it saved, so a slow stretch from elsewhere does not strip the look for good.
 *
 * The post level chosen in the settings is where it starts and the most it ever draws; it only steps down from there.
 */
interface Pace {
  lean: number;
  /** The lean the settings ask for: it never steps up past it. */
  floor: number;
  /** Seconds a frame takes to draw, on average. */
  draw: number;
  /** Frames in a row that were slow, or had room to spare. */
  slow: number;
  fast: number;
  /** Seconds each step down saved, by the level it stepped down from (unknown until measured). */
  saved: number[];
  /** Set just after a step down: the average before it, and the frames left until its saving is measured. */
  check: { before: number; frames: number } | null;
  /** A step down saved nothing: the post pass is not what is slow, so it stops stepping down. */
  stuck: boolean;
}

const paces = new WeakMap<HTMLCanvasElement, Pace>();
const LEAN: Record<PostLevel, number> = { high: 0, medium: 1, low: 2, off: 3 };
let started = 0;
/** Pinned to the full pass, whatever the machine: the gallery's pixel snapshots must not depend on how fast it drew. */
let steady = false;
export function holdPostPass(on: boolean): void {
  steady = on;
}

/** Drawing slower than this (s), on average, does not leave room for sixty frames a second; for this many frames in a row, it steps down. */
const SLOW_DRAW = 1 / 60;
const SLOW_FOR = 120;
/** It steps back up after this many frames in a row with room for what the step saved, and a margin. */
const ROOM_FOR = 600;
const MARGIN = 0.8;
/** Frames after a step down before its saving is measured, and how much it must save (of the average before) to count. */
const SETTLE = 60;
const WORTH = 0.15;

function paceOf(canvas: HTMLCanvasElement): Pace {
  const floor = LEAN[getPostLevel()];
  let pace = paces.get(canvas);
  // A new setting starts over from it: what was learnt about the other levels no longer holds.
  if (pace?.floor !== floor) {
    pace = { lean: floor, floor, draw: 0, slow: 0, fast: 0, saved: [], check: null, stuck: false };
    paces.set(canvas, pace);
  }
  return pace;
}

/** Times the frame just drawn and steps the post pass down, or back up, by it. */
function keepPace(pace: Pace, drawn: number): void {
  pace.draw = pace.draw ? pace.draw + (drawn - pace.draw) * 0.1 : drawn;
  if (pace.check) {
    if (--pace.check.frames > 0) return;
    const saving = pace.check.before - pace.draw;
    const before = pace.check.before;
    pace.check = null;
    if (saving < before * WORTH) {
      pace.lean--;
      pace.stuck = true;
    } else {
      pace.saved[pace.lean - 1] = saving;
    }
    return;
  }
  const room = pace.lean > pace.floor && pace.draw + (pace.saved[pace.lean - 1] ?? Infinity) < SLOW_DRAW * MARGIN;
  pace.slow = pace.draw > SLOW_DRAW ? pace.slow + 1 : 0;
  pace.fast = room ? pace.fast + 1 : 0;
  if (pace.slow >= SLOW_FOR && !pace.stuck && pace.lean < 3) {
    pace.check = { before: pace.draw, frames: SETTLE };
    pace.lean++;
    pace.slow = 0;
  } else if (pace.fast >= ROOM_FOR) {
    pace.lean--;
    pace.fast = 0;
  }
}

/**
 * Bloom: the picture is shrunk, its dull parts are dropped (raised to the eighth power, so only what is nearly white stays), and what
 * is left is blurred by shrinking it further, then added back over the picture on the way up. A vignette, a grade
 * and grain over it, as much of it as the machine keeps up with (`Pace`). The flash and the supernova's white-out make it bloom wider.
 */
export function forgedPost(ctx: CanvasRenderingContext2D, f: FrameInfo): void {
  const pace = paceOf(ctx.canvas);
  const lean = steady ? 0 : pace.lean;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (lean < 2) bloom(ctx, f);
  if (lean < 3) drawVignette(ctx, f);
  if (lean < 1) {
    grade(ctx, f);
    grain(ctx, f);
  }
  ctx.restore();
  if (!steady) keepPace(pace, (performance.now() - started) / 1000);
}

function bloom(ctx: CanvasRenderingContext2D, f: FrameInfo): void {
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
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = Math.min(1, 0.35 + 0.4 * f.flash + 0.3 * f.whiteout);
  ctx.drawImage(c4.canvas, 0, 0, main.width, main.height);
  ctx.restore();
}

/** The vignette: the plate's corners fall into shadow. */
function drawVignette(ctx: CanvasRenderingContext2D, f: FrameInfo): void {
  const main = ctx.canvas;
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
}

/** The grade: cool in the high lights of the top, warm in the low ones. */
function grade(ctx: CanvasRenderingContext2D, f: FrameInfo): void {
  ctx.save();
  ctx.globalCompositeOperation = 'soft-light';
  const gradient = ctx.createLinearGradient(0, f.plate.y, 0, f.plate.y + f.plate.h);
  gradient.addColorStop(0, 'rgba(70,130,255,0.14)');
  gradient.addColorStop(1, 'rgba(255,150,70,0.1)');
  ctx.fillStyle = gradient;
  ctx.fillRect(f.plate.x, f.plate.y, f.plate.w, f.plate.h);
  ctx.restore();
}

/** Film grain: a tile of noise laid at a new place about fifteen times a second. */
function grain(ctx: CanvasRenderingContext2D, f: FrameInfo): void {
  if (!tiles) return;
  const step = Math.floor(f.time * 15);
  tiles.grain.setTransform(new DOMMatrix().translate((step * 37) % 128, (step * 91) % 128));
  ctx.save();
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = 0.05;
  ctx.fillStyle = tiles.grain;
  ctx.fillRect(f.plate.x, f.plate.y, f.plate.w, f.plate.h);
  ctx.restore();
}
