import { DARK_MARGIN } from '../../game/dark-matter';
import { FIELD } from '../../sim/config';
import type { DarkMasks } from './painter';

/**
 * How a look keeps its fog: at what share of the field's size it is painted; how often its moving texture is
 * repainted (`fps`, 0 = it stands still) and how often its glowing edge is (`rimFps`).
 */
export interface FogQuality {
  scale: number;
  fps: number;
  rimFps?: number;
  /** Softens the masks by this many of their cells, so the cells do not show as steps. */
  blur?: number;
}

/** A shot tears the matter every step, but the picture is repainted at most this often (s): the edge may trail a frame or two. */
const MIN_GAP = 1 / 30;

const FULL_W = FIELD.width + 2 * DARK_MARGIN;
const FULL_H = FIELD.height + 2 * DARK_MARGIN;

interface Kept {
  stamp: string | null;
  bucket: number;
  at: number;
}

interface Layer {
  body: HTMLCanvasElement;
  rim: HTMLCanvasElement;
  w: number;
  h: number;
  keptBody: Kept;
  keptRim: Kept;
  /** Where the rim was painted last, in the layer's pixels. */
  rimBox: { x: number; y: number; w: number; h: number } | null;
}

const layers = new Map<number, Layer>();

function layerFor(scale: number): Layer {
  let l = layers.get(scale);
  if (!l) {
    const w = Math.ceil(FULL_W * scale);
    const h = Math.ceil(FULL_H * scale);
    const make = (): HTMLCanvasElement => Object.assign(document.createElement('canvas'), { width: w, height: h });
    const kept = (): Kept => ({ stamp: null, bucket: -1, at: -1 });
    l = { body: make(), rim: make(), w, h, keptBody: kept(), keptRim: kept(), rimBox: null };
    layers.set(scale, l);
  }
  return l;
}

/** Whether a kept picture is to be repainted now; if so it is marked as done. */
function due(k: Kept, stamp: string, fps: number, time: number): boolean {
  const bucket = fps ? Math.floor(time * fps) : 0;
  const changed = k.stamp !== stamp;
  const fieldOf = (s: string) => s.split(':', 2).join(':');
  const swapped = k.stamp !== null && fieldOf(k.stamp) !== fieldOf(stamp);
  if (!(k.stamp === null || swapped || bucket !== k.bucket || (changed && time - k.at >= MIN_GAP) || time < k.at)) return false;
  k.stamp = stamp;
  k.bucket = bucket;
  k.at = time;
  return true;
}

/** The mask softened (on its own small canvas, which costs next to nothing). */
const softened = new Map<CanvasImageSource, HTMLCanvasElement>();
function soften(mask: CanvasImageSource, blur: number): CanvasImageSource {
  const source = mask as HTMLCanvasElement;
  if (!blur || typeof source.getContext !== 'function') return mask;
  let s = softened.get(mask);
  if (!s) {
    s = Object.assign(document.createElement('canvas'), { width: source.width, height: source.height });
    softened.set(mask, s);
  }
  const c = s.getContext('2d')!;
  c.clearRect(0, 0, s.width, s.height);
  c.filter = `blur(${blur}px)`;
  c.drawImage(mask, 0, 0);
  c.filter = 'none';
  return s;
}

/** Paints `paint` into `target` within `box` (all of it when null), then keeps it only where `mask` is. */
function paintMasked(target: HTMLCanvasElement, box: { x: number; y: number; w: number; h: number } | null, mask: CanvasImageSource, paint: (c: CanvasRenderingContext2D, w: number, h: number) => void): void {
  const c = target.getContext('2d')!;
  const { width: w, height: h } = target;
  c.save();
  c.globalCompositeOperation = 'source-over';
  c.globalAlpha = 1;
  if (box) {
    c.beginPath();
    c.rect(box.x, box.y, box.w, box.h);
    c.clip();
    c.clearRect(box.x, box.y, box.w, box.h);
  } else c.clearRect(0, 0, w, h);
  paint(c, w, h);
  c.globalCompositeOperation = 'destination-in';
  c.globalAlpha = 1;
  c.imageSmoothingEnabled = true;
  c.drawImage(mask, 0, 0, w, h);
  c.restore();
}

/**
 * Dark Matter, shared by every look: `body` makes the look's own texture of the matter, `rim` the light along its torn
 * edge (laid on with a glow); the masks cut them out. Both pictures are kept and only laid over the field each frame;
 * each is repainted when the masks changed (at most every `MIN_GAP`) or when its moving texture is due, and the rim only
 * where the edge runs. Draws in field units.
 */
export function fog(
  ctx: CanvasRenderingContext2D,
  masks: DarkMasks,
  quality: FogQuality,
  time: number,
  body: (c: CanvasRenderingContext2D, w: number, h: number) => void,
  rim?: (c: CanvasRenderingContext2D, w: number, h: number) => void,
): void {
  const l = layerFor(quality.scale);
  const blur = quality.blur ?? 0;
  if (due(l.keptBody, masks.stamp, quality.fps, time)) paintMasked(l.body, null, soften(masks.body, blur), body);
  ctx.drawImage(l.body, -DARK_MARGIN, -DARK_MARGIN, FULL_W, FULL_H);
  if (!rim) return;
  if (due(l.keptRim, masks.stamp, quality.rimFps ?? quality.fps, time)) {
    const b = masks.rimBounds;
    const k = quality.scale;
    // the old box is cleared too, so nothing of an edge that moved is left behind
    if (l.rimBox) l.rim.getContext('2d')!.clearRect(l.rimBox.x, l.rimBox.y, l.rimBox.w, l.rimBox.h);
    l.rimBox = b ? { x: Math.floor((b.x + DARK_MARGIN) * k), y: Math.floor((b.y + DARK_MARGIN) * k), w: Math.ceil(b.w * k) + 2, h: Math.ceil(b.h * k) + 2 } : null;
    if (l.rimBox) paintMasked(l.rim, l.rimBox, soften(masks.rim, blur), rim);
  }
  const r = l.rimBox;
  if (!r) return;
  ctx.globalCompositeOperation = 'lighter';
  ctx.drawImage(l.rim, r.x, r.y, r.w, r.h, r.x / quality.scale - DARK_MARGIN, r.y / quality.scale - DARK_MARGIN, r.w / quality.scale, r.h / quality.scale);
  ctx.globalCompositeOperation = 'source-over';
}

/**
 * Draws the matter's lines (`draw`, in field units) everywhere but in the aiming ship's clearing, as faint as the matter
 * is while it lifts.
 */
export function beyondClearing(ctx: CanvasRenderingContext2D, masks: DarkMasks, draw: () => void): void {
  if (masks.fade <= 0) return;
  ctx.save();
  ctx.globalAlpha = masks.fade;
  const c = masks.clearing;
  if (c) {
    const cut = new Path2D();
    cut.rect(-DARK_MARGIN, -DARK_MARGIN, FULL_W, FULL_H);
    cut.arc(c.x, c.y, c.r * 0.8, 0, Math.PI * 2);
    ctx.clip(cut, 'evenodd');
  }
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  draw();
  ctx.restore();
}

/** A number from 0 to 1 for `i` and `j`, the same each time. */
export function hash2(i: number, j: number): number {
  const v = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
  return v - Math.floor(v);
}

/** Per-cell visual density (`vis`) + fresh-tear dissolve energy (`wake`) chasing the instantaneous `cover` grid. */
export interface DarkDissolve {
  fieldId: string | null;
  version: number;
  tick: number;
  active: boolean;
  vis: Float32Array;
  wake: Float32Array;
  stepAt: number;
  /** Inclusive grid bounds currently dissolving (`c1 < 0` when none). */
  c0: number;
  c1: number;
  r0: number;
  r1: number;
}

export const createDarkDissolve = (): DarkDissolve => ({
  fieldId: null,
  version: -1,
  tick: 0,
  active: false,
  vis: new Float32Array(0),
  wake: new Float32Array(0),
  stepAt: -1,
  c0: 0,
  c1: -1,
  r0: 0,
  r1: -1,
});

/**
 * Advances `d.vis` smoothly toward `cover` while raising `d.wake` in freshly torn cells so looks can dissolve the edge
 * smoothly at full frame rate instead of snapping on every grid update. Returns whether any cell is still dissolving.
 */
export function stepDarkDissolve(
  d: DarkDissolve,
  id: string,
  cover: Float32Array,
  cols: number,
  rows: number,
  version: number,
  time: number,
): boolean {
  if (d.fieldId !== id || d.vis.length !== cover.length || time < d.stepAt) {
    if (d.vis.length !== cover.length) {
      d.vis = new Float32Array(cover.length);
      d.wake = new Float32Array(cover.length);
    }
    d.vis.set(cover);
    d.wake.fill(0);
    d.fieldId = id;
    d.version = version;
    d.active = false;
    d.c0 = 0;
    d.c1 = -1;
    d.r0 = 0;
    d.r1 = -1;
    d.tick++;
    d.stepAt = time;
    return false;
  }
  if (!d.active && d.version === version) {
    d.stepAt = time;
    return false;
  }
  const dt = Math.min(0.05, Math.max(0, time - d.stepAt));
  d.stepAt = time;
  d.version = version;
  const wakeDecay = dt > 0 ? Math.exp(-dt / 0.24) : 1;
  const wakeCool = dt * 0.65;
  const { vis, wake } = d;
  let active = false;
  let c0 = cols;
  let c1 = -1;
  let r0 = rows;
  let r1 = -1;
  for (let r = 0; r < rows; r++) {
    const base = r * cols;
    for (let c = 0; c < cols; c++) {
      const i = base + c;
      const target = cover[i];
      let v = vis[i];
      let w = wake[i];
      if (v === target && w === 0) continue;
      if (v > target) {
        const rem = v - target;
        const drop = Math.min(rem, dt * (11.0 * rem + 1.8));
        v -= drop;
        w = Math.min(1, w * wakeDecay + drop * 1.55);
        if (v > target || w > 0.002) active = true;
        else w = 0;
      } else {
        if (target > v) v = target;
        if (w > 0) {
          w = w * wakeDecay - wakeCool;
          if (w <= 0.002) w = 0;
          else active = true;
        }
      }
      vis[i] = v;
      wake[i] = w;
      if (w > 0 || v > target) {
        if (c < c0) c0 = c;
        if (c > c1) c1 = c;
        if (r < r0) r0 = r;
        if (r > r1) r1 = r;
      }
    }
  }
  d.c0 = c0;
  d.c1 = c1;
  d.r0 = r0;
  d.r1 = r1;
  d.active = active;
  d.tick++;
  return active;
}

/** A small canvas painted once and kept under `key`. */
const made = new Map<string, HTMLCanvasElement>();
export function tile(key: string, w: number, h: number, paint: (c: CanvasRenderingContext2D, w: number, h: number) => void): HTMLCanvasElement {
  let t = made.get(key);
  if (!t) {
    t = Object.assign(document.createElement('canvas'), { width: w, height: h });
    paint(t.getContext('2d')!, w, h);
    made.set(key, t);
  }
  return t;
}
