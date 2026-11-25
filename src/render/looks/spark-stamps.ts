import { COLORS } from '../../sim/config';
import type { EffectStyle, SparkView } from './painter';

/**
 * Sparks stamped from pictures of them. A planet that breaks throws over a thousand, and as many antialiased strokes and
 * paths a frame choke a phone's GPU: it fell to ten frames a second, with the main thread waiting for it. So each streak and
 * shard is drawn once, on a sheet of its colour, and stamped from there, which a GPU does by the hundred in one go. A sheet
 * holds a few lengths, sizes and shapes; a stamp is stretched to the spark's own.
 */

/** Values in steps of one ratio, from the smallest to the biggest. */
export interface Steps {
  from: number;
  to: number;
  count: number;
}

/** How a look's sparks are drawn. The pictures are drawn in field units; what they show is added to the field's light. */
export interface StampStyle {
  /** A spark flying fast is a streak: this long and wide, its round ends past its length. */
  length(speed: number, size: number): number;
  width(size: number): number;
  lengths: Steps;
  sizes: Steps;
  /** Draws a streak from its head at (0, 0) back to (-length, 0). */
  streak(c: CanvasRenderingContext2D, length: number, size: number, color: string): void;
  /** A bigger one is a shard, of one of this many shapes, at these sizes, reaching this far from its middle. */
  shapes: number;
  shards: Steps;
  reach(size: number): number;
  /** The shard's outline round (0, 0); `seed` is its shape's. */
  outline(size: number, seed: number): Path2D;
  /** Its solid body, laid over the field and not added to it, if it has one. */
  body?(c: CanvasRenderingContext2D, outline: Path2D, color: string): void;
  edge(c: CanvasRenderingContext2D, outline: Path2D, color: string): void;
  /** How fast it tumbles (radians a second). */
  spin(seed: number): number;
  /** Draws one nearly at rest, round (0, 0). */
  ember(ctx: CanvasRenderingContext2D, size: number, color: string): void;
}

/** A large spark bigger than this is a shard. */
export const SHARD_FROM = 3.4;
/** A spark faster than this (field units a second) is a streak. */
const STREAK_FROM = 8;
/** A spark that goes fades out in its last seconds. */
const FADE = 0.35;
/** A sheet has at least this many pixels to each one it is stamped on, so a stamp at an angle stays sharp. */
const FINER = 1.4;
/** Past this many sheets of one scale, or scales, they are drawn anew. */
const SHEETS_KEPT = 24;
const SCALES_KEPT = 4;
/** Clear room (pixels) round each picture, so a stamp never takes in its neighbour. */
const GAP = 2;
/** The colours every break throws: their sheets are drawn in the quiet frames, so the break does not wait for them, this many pictures a frame. */
const ALWAYS = [COLORS.sodium, COLORS.bone, COLORS.boneDim];
const WARM = 12;

const stepOf = (s: Steps, value: number): number => (s.count < 2 ? 0 : Math.min(s.count - 1, Math.max(0, Math.round((Math.log(value / s.from) / Math.log(s.to / s.from)) * (s.count - 1)))));
const valuesOf = (s: Steps): number[] => Array.from({ length: s.count }, (_, i) => s.from * (s.to / s.from) ** (i / Math.max(1, s.count - 1)));

/** The pictures of one colour; each is painted when a spark first needs it. */
interface Sheet {
  streaks: CanvasRenderingContext2D;
  /** The edges above, the bodies below: they are laid over the field in different ways. */
  shards: CanvasRenderingContext2D | null;
  painted: Uint8Array;
}

const canvas = (width: number, height: number): CanvasRenderingContext2D => Object.assign(document.createElement('canvas'), { width, height }).getContext('2d')!;
const isShard = (s: SparkView): boolean => s.tier === 'large' && s.size > SHARD_FROM;

/** The `EffectStyle.sparks` of a look whose sparks are drawn like `style`. */
export function stampedSparks(style: StampStyle): NonNullable<EffectStyle['sparks']> {
  const { lengths, sizes, shards, shapes } = style;
  const lengthOf = valuesOf(lengths);
  const sizeOf = valuesOf(sizes);
  const shardOf = valuesOf(shards);
  const widest = Math.max(...sizeOf.map((size) => style.width(size)));
  const scales = new Map<number, Map<string, Sheet>>();
  const warmed = new Map<number, number>();

  /** A spark's shape; its seed also turns it, so the shape is taken from the finer part of it. */
  const shapeOf = (seed: number): number => Math.floor(((seed * 61) % 1) * shapes);

  /** The sheets at `res` pixels a field unit. */
  function at(res: number) {
    const streakReach = (si: number): number => style.width(sizeOf[si]) / 2 + GAP / res;
    const shardReach = (zi: number): number => style.reach(shardOf[zi]) + GAP / res;
    const cellW = Math.ceil((lengths.to + widest) * res) + GAP * 2;
    const cellH = Math.ceil(widest * res) + GAP * 2;
    const side = Math.ceil(style.reach(shards.to) * 2 * res) + GAP * 2;
    let sheets = scales.get(res);
    if (!sheets) scales.set(res, (sheets = new Map()));
    const known = sheets;
    const sheetOf = (color: string): Sheet => {
      let sheet = known.get(color);
      if (!sheet) {
        sheet = { streaks: canvas(cellW * lengths.count, cellH * sizes.count), shards: null, painted: new Uint8Array(lengths.count * sizes.count + shapes * shards.count) };
        known.set(color, sheet);
      }
      return sheet;
    };
    const paintStreak = (color: string, li: number, si: number): void => {
      const sheet = sheetOf(color);
      const index = si * lengths.count + li;
      if (sheet.painted[index]) return;
      sheet.painted[index] = 1;
      const c = sheet.streaks;
      const reach = streakReach(si);
      c.setTransform(res, 0, 0, res, li * cellW + (lengthOf[li] + reach) * res, si * cellH + reach * res);
      c.globalCompositeOperation = 'lighter';
      style.streak(c, lengthOf[li], sizeOf[si], color);
    };
    const paintShard = (color: string, shape: number, zi: number): void => {
      const sheet = sheetOf(color);
      const index = lengths.count * sizes.count + zi * shapes + shape;
      if (sheet.painted[index]) return;
      sheet.painted[index] = 1;
      sheet.shards ??= canvas(side * shapes, side * shards.count * (style.body ? 2 : 1));
      const c = sheet.shards;
      const reach = shardReach(zi);
      const outline = style.outline(shardOf[zi], (shape + 0.5) / shapes);
      c.globalCompositeOperation = 'lighter';
      c.setTransform(res, 0, 0, res, shape * side + reach * res, zi * side + reach * res);
      style.edge(c, outline, color);
      if (!style.body) return;
      c.setTransform(res, 0, 0, res, shape * side + reach * res, (shards.count + zi) * side + reach * res);
      style.body(c, outline, color);
    };
    return { sheetOf, paintStreak, paintShard, streakReach, shardReach, cellW, cellH, side };
  }
  let current: { res: number; kit: ReturnType<typeof at> } | null = null;

  /** The next pictures of the colours every break throws. */
  function warm(res: number, kit: ReturnType<typeof at>): void {
    const streaks = lengths.count * sizes.count;
    const each = streaks + shapes * shards.count;
    let next = warmed.get(res) ?? 0;
    for (let i = 0; i < WARM && next < each * ALWAYS.length; i++, next++) {
      const color = ALWAYS[Math.floor(next / each)];
      const index = next % each;
      if (index < streaks) kit.paintStreak(color, index % lengths.count, Math.floor(index / lengths.count));
      // Of these colours only the first is thrown as shards.
      else if (color === ALWAYS[0]) kit.paintShard(color, (index - streaks) % shapes, Math.floor((index - streaks) / shapes));
    }
    warmed.set(res, next);
  }

  return (ctx, sparks) => {
    const m = ctx.getTransform();
    const res = 2 ** (Math.ceil(Math.log2(Math.hypot(m.a, m.b) * FINER) * 2) / 2);
    if (scales.size > SCALES_KEPT || (scales.get(res)?.size ?? 0) > SHEETS_KEPT) {
      scales.clear();
      warmed.clear();
      current = null;
    }
    if (current?.res !== res) current = { res, kit: at(res) };
    const { kit } = current;
    if (!sparks.length) return warm(res, kit);
    // All that is missing is painted before anything is stamped: a canvas painted between its stamps is copied each time.
    for (const s of sparks) {
      if (isShard(s)) kit.paintShard(s.color, shapeOf(s.seed), stepOf(shards, s.size));
      else {
        const speed = Math.hypot(s.vx, s.vy);
        if (speed > STREAK_FROM) kit.paintStreak(s.color, stepOf(lengths, style.length(speed, s.size)), stepOf(sizes, s.size));
      }
    }
    const now = performance.now() / 1000;
    ctx.globalCompositeOperation = 'lighter';
    for (const s of sparks) {
      ctx.globalAlpha = s.life !== undefined ? Math.min(1, s.life / FADE) : 1;
      const e = m.a * s.x + m.c * s.y + m.e;
      const f = m.b * s.x + m.d * s.y + m.f;
      if (isShard(s)) {
        const picture = kit.sheetOf(s.color).shards!.canvas;
        const zi = stepOf(shards, s.size);
        const turn = s.seed * Math.PI * 2 + now * style.spin(s.seed);
        const cos = Math.cos(turn);
        const sin = Math.sin(turn);
        ctx.setTransform(m.a * cos + m.c * sin, m.b * cos + m.d * sin, m.c * cos - m.a * sin, m.d * cos - m.b * sin, e, f);
        const reach = kit.shardReach(zi);
        const out = reach * (s.size / shardOf[zi]);
        const px = reach * 2 * res;
        const sx = shapeOf(s.seed) * kit.side;
        if (style.body) {
          ctx.globalCompositeOperation = 'source-over';
          ctx.drawImage(picture, sx, (shards.count + zi) * kit.side, px, px, -out, -out, out * 2, out * 2);
          ctx.globalCompositeOperation = 'lighter';
        }
        ctx.drawImage(picture, sx, zi * kit.side, px, px, -out, -out, out * 2, out * 2);
        continue;
      }
      const speed = Math.hypot(s.vx, s.vy);
      if (speed > STREAK_FROM) {
        const length = style.length(speed, s.size);
        const li = stepOf(lengths, length);
        const si = stepOf(sizes, s.size);
        const cos = s.vx / speed;
        const sin = s.vy / speed;
        ctx.setTransform(m.a * cos + m.c * sin, m.b * cos + m.d * sin, m.c * cos - m.a * sin, m.d * cos - m.b * sin, e, f);
        const reach = kit.streakReach(si);
        const kx = length / lengthOf[li];
        const ky = style.width(s.size) / style.width(sizeOf[si]);
        const w = lengthOf[li] + reach * 2;
        ctx.drawImage(kit.sheetOf(s.color).streaks.canvas, li * kit.cellW, si * kit.cellH, w * res, reach * 2 * res, -(lengthOf[li] + reach) * kx, -reach * ky, w * kx, reach * 2 * ky);
        continue;
      }
      ctx.setTransform(m.a, m.b, m.c, m.d, e, f);
      style.ember(ctx, s.size, s.color);
    }
    ctx.setTransform(m);
  };
}
