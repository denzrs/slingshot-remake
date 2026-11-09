import { createRng } from '../../sim/rng';
import { fbm } from '../noise';
import { smoothstep } from '../planet-common';
import { closeShaderFrame, setShaderDetail } from './forged-gl';
import type { FrameInfo } from './painter';

/**
 * What the forged look puts behind and over the field as a whole: a nebula and dust lanes baked into the backdrop, layers
 * of still, twinkling stars, and over the finished field a vignette.
 */

let current: FrameInfo | null = null;

/** Keeps the frame for the calls that follow it: the sky, the ships' light and the post pass read it. */
export function forgedBegin(frame: FrameInfo): void {
  current = frame;
  const now = performance.now();
  // A pause (a hidden tab, a menu) is no measure of the frames.
  const since = lastBegin ? (now - lastBegin) / 1000 : 0;
  lastBegin = now;
  gap = since < PAUSE ? since : 0;
}

let lastBegin = 0;
/** The time since the last frame began (s), 0 when there was a pause. */
let gap = 0;
/** A gap longer than this (s) between two frames is a pause, not a slow frame. */
const PAUSE = 0.25;

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
 * as a pattern: the tile is nearly all empty, and a pattern has every pixel of the plate
 * sampled from it, which a canvas drawn without a GPU (Firefox on many machines) paid for with most of its frame.
 */
interface Tiles {
  dpr: number;
  farA: Speck[];
  farB: Speck[];
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

function buildTiles(dpr: number): Tiles {
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
  return { dpr, farA: stars(26, 0xf0a1), farB: stars(26, 0xf0b2) };
}

function layer(ctx: CanvasRenderingContext2D, specks: readonly Speck[], f: FrameInfo, alpha: number): void {
  const { x: px, y: py, w, h } = f.plate;
  ctx.globalAlpha = alpha;
  // Every copy of the tile that reaches the plate, starting a tile early for the specks that hang over its edge.
  for (let ty = (Math.floor(py / TILE) - 1) * TILE; ty < py + h; ty += TILE) {
    for (let tx = (Math.floor(px / TILE) - 1) * TILE; tx < px + w; tx += TILE) {
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

/** Stars that twinkle in turn, over the plate. */
export function forgedSky(ctx: CanvasRenderingContext2D, f: FrameInfo): void {
  if (!tiles || tiles.dpr !== f.dpr) tiles = buildTiles(f.dpr);
  ctx.save();
  ctx.beginPath();
  ctx.rect(f.plate.x, f.plate.y, f.plate.w, f.plate.h);
  ctx.clip();
  ctx.globalCompositeOperation = 'lighter';
  const pulse = Math.sin(f.time * 1.3);
  layer(ctx, tiles.farA, f, 0.55 + 0.4 * pulse);
  layer(ctx, tiles.farB, f, 0.55 - 0.4 * pulse);
  ctx.restore();
}

// ------------------------------------------------------------------- post ----

let vignette: { key: string; gradient: CanvasGradient } | null = null;

/** How much of its size a shaded sprite is drawn at, at each step of `Pace`. */
const DETAIL = [1, 0.8, 0.65];

/**
 * How far a machine that cannot keep up steps the shaded sprites down, by the time between frames, as no timer sees all their
 * work on every browser (the copies into the 2D frame least of all). A step down that saved nothing (the sprites are not what
 * is slow, or a browser is holding thirty frames a second) is taken back and not tried again until the frames have recovered,
 * so that browser keeps its full detail; one that did is undone once the frames have room for what it saved, though a
 * screen's refresh can hide that room, and then it stays.
 */
interface Pace {
  lean: number;
  /** Seconds between frames, on average. */
  time: number;
  /** Frames in a row that were slow, or had room to spare. */
  slow: number;
  fast: number;
  /** Seconds each step down saved, by the level it stepped down from (unknown until measured). */
  saved: number[];
  /** Set just after a step down: the average before it, and the frames left until its saving is measured. */
  check: { before: number; frames: number } | null;
  /** A step down saved nothing: the sprites are not what is slow, so it stops stepping down until the frames recover. */
  stuck: boolean;
}

export const newPace = (): Pace => ({ lean: 0, time: 0, slow: 0, fast: 0, saved: [], check: null, stuck: false });

const spritePace = newPace();
/**
 * Let go after a stretch at full detail, it starts again from there, but keeps what it learned: which steps saved anything,
 * and that stepping down did not help, so a browser that held its full detail keeps it.
 */
export function resumePace(pace: Pace): void {
  Object.assign(pace, { lean: 0, slow: 0, fast: 0, check: null });
}

/**
 * Why the sprites are pinned to full detail, whatever the machine: the gallery's pixel snapshots must not depend on how fast
 * it drew, and the player may turn the step-down off.
 */
const pins = new Set<'gallery' | 'player'>();
function pin(reason: 'gallery' | 'player', on: boolean): void {
  const pinned = pins.size > 0;
  if (on) pins.add(reason);
  else pins.delete(reason);
  if (pinned && !pins.size) resumePace(spritePace);
}
export const holdShaderDetail = (on: boolean): void => pin('gallery', on);
export const allowShaderStepDown = (on: boolean): void => pin('player', !on);

/**
 * Frames further apart than this (s), on average, for this many frames in a row, it steps down. A frame only just over a
 * sixtieth of a second or a short busy stretch keeps the detail.
 */
const SLOW_FRAME = 1 / 50;
const SLOW_FOR = 300;
/** It steps back up after this many frames in a row with room for what the step saved, and a margin: sixty frames a second with it back. */
const ROOM_FOR = 600;
const MARGIN = 0.8;
/** Frames after a step down before its saving is measured, and how much it must save (of the average before) to count. */
const SETTLE = 60;
const WORTH = 0.15;

/** Takes in the time since the last frame and steps the detail down, or back up, by it. */
export function keepPace(pace: Pace, since: number): void {
  pace.time = pace.time ? pace.time + (since - pace.time) * 0.1 : since;
  if (pace.check) {
    if (--pace.check.frames > 0) return;
    const saving = pace.check.before - pace.time;
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
  if (pace.time <= SLOW_FRAME) pace.stuck = false;
  const room = pace.lean > 0 && pace.time + (pace.saved[pace.lean - 1] ?? Infinity) < SLOW_FRAME * MARGIN;
  pace.slow = pace.time > SLOW_FRAME ? pace.slow + 1 : 0;
  pace.fast = room ? pace.fast + 1 : 0;
  if (pace.slow >= SLOW_FOR && !pace.stuck && pace.lean < DETAIL.length - 1) {
    pace.check = { before: pace.time, frames: SETTLE };
    pace.lean++;
    pace.slow = 0;
  } else if (pace.fast >= ROOM_FOR) {
    pace.lean--;
    pace.fast = 0;
  }
}

/** The vignette over the finished field. */
export function forgedPost(ctx: CanvasRenderingContext2D, f: FrameInfo): void {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  drawVignette(ctx, f);
  ctx.restore();
  closeShaderFrame();
  const full = pins.size > 0;
  if (!full && gap) keepPace(spritePace, gap);
  setShaderDetail(full ? 1 : DETAIL[spritePace.lean]);
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
