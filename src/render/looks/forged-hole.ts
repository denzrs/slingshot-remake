import { image } from './forged-assets';
import { BAND_TOP, COLUMNS, FRAME, FRAME_H, FRAMES, HOLE_SPAN, LOOP, WHITE_COLUMNS, WHITE_FRAME } from './forged-hole-sheet';

/**
 * The forged black hole: a sheet of frames of its disk turning (`forged/hole.webp`, traced by `scripts/forged/hole-trace.ts`
 * as light bends round a hole, made by `scripts/forged/hole-frames.mjs`), played as a loop. Between two frames the
 * picture is a mix of both, so the turning does not step.
 */

/** How a sheet is laid out: a frame `w` × `h` pixels, `columns` to a row, cut `left` and `top` pixels into the square `FRAME` across round the hole. */
interface Sheet {
  w: number;
  h: number;
  columns: number;
  left: number;
  top: number;
}
const HOLE: Sheet = { w: FRAME, h: FRAME_H, columns: COLUMNS, left: 0, top: BAND_TOP };
const WHITE: Sheet = { w: WHITE_FRAME, h: WHITE_FRAME, columns: WHITE_COLUMNS, left: (FRAME - WHITE_FRAME) / 2, top: (FRAME - WHITE_FRAME) / 2 };

/** A canvas a frame is mixed on, one for each frame size. */
const scratches = new Map<number, HTMLCanvasElement>();

/** The picture `time` seconds into the loop, mixed from the two frames it falls between, drawn `span` wide round (0, 0) at the hole's scale. */
function drawMixed(ctx: CanvasRenderingContext2D, image: HTMLImageElement, layout: Sheet, time: number, span: number): void {
  const at = (((time / LOOP) % 1) + 1) % 1 * FRAMES;
  const first = Math.floor(at) % FRAMES;
  const next = (first + 1) % FRAMES;
  const mix = at - Math.floor(at);
  const { w, h, columns, left, top } = layout;
  let scratch = scratches.get(w * 10000 + h);
  if (!scratch) scratches.set(w * 10000 + h, (scratch = Object.assign(document.createElement('canvas'), { width: w, height: h })));
  const s = scratch.getContext('2d')!;
  // The frames' premultiplied light added by their shares: a true mix, which keeps the shadow's soft edge from thickening.
  s.globalCompositeOperation = 'copy';
  s.globalAlpha = 1 - mix;
  s.drawImage(image, (first % columns) * w, Math.floor(first / columns) * h, w, h, 0, 0, w, h);
  s.globalCompositeOperation = 'lighter';
  s.globalAlpha = mix;
  s.drawImage(image, (next % columns) * w, Math.floor(next / columns) * h, w, h, 0, 0, w, h);
  ctx.imageSmoothingQuality = 'high';
  const k = span / FRAME;
  ctx.drawImage(scratch, -span / 2 + left * k, -span / 2 + top * k, w * k, h * k);
}

/** Draws the hole of `radius` (field units) centred, in the frame the caller has set (the disk's tilt applied). False until the sheet has loaded. */
export function drawLensedHole(ctx: CanvasRenderingContext2D, radius: number, time: number): boolean {
  const sheet = image('hole');
  if (!sheet) return false;
  const span = radius * HOLE_SPAN;
  ctx.save();
  drawMixed(ctx, sheet, HOLE, time, span);
  ctx.restore();
  return true;
}

/**
 * The white hole's light in the shadow (`forged/white.webp`, traced with the hole: the horizon shining out instead of
 * swallowing), added over the hole drawn with the same `radius` and `time`, in the same frame. False until it has loaded.
 */
export function drawWhiteLight(ctx: CanvasRenderingContext2D, radius: number, time: number): boolean {
  const sheet = image('white');
  if (!sheet) return false;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  drawMixed(ctx, sheet, WHITE, time, radius * HOLE_SPAN);
  ctx.restore();
  return true;
}
