import { image } from './forged-assets';
import { BAND_TOP, COLUMNS, FRAME, FRAME_H, FRAMES, HOLE_SPAN, LOOP } from './forged-hole-sheet';

/**
 * The forged black hole: a sheet of frames of its disk turning (`forged/hole.webp`, traced by `scripts/forged/hole-trace.ts`
 * as light bends round a hole, made by `scripts/forged/hole-frames.mjs`), played as a loop. Between two frames the
 * picture is a mix of both, so the turning does not step.
 */

let scratch: HTMLCanvasElement | null = null;

/** The picture `time` seconds into the loop, mixed from the two frames it falls between, drawn `span` wide round (0, 0). */
function drawMixed(ctx: CanvasRenderingContext2D, sheet: HTMLImageElement, time: number, span: number): void {
  const at = (((time / LOOP) % 1) + 1) % 1 * FRAMES;
  const first = Math.floor(at) % FRAMES;
  const next = (first + 1) % FRAMES;
  const mix = at - Math.floor(at);
  scratch ??= Object.assign(document.createElement('canvas'), { width: FRAME, height: FRAME_H });
  const s = scratch.getContext('2d')!;
  // The frames' premultiplied light added by their shares: a true mix, which keeps the shadow's soft edge from thickening.
  s.globalCompositeOperation = 'copy';
  s.globalAlpha = 1 - mix;
  s.drawImage(sheet, (first % COLUMNS) * FRAME, Math.floor(first / COLUMNS) * FRAME_H, FRAME, FRAME_H, 0, 0, FRAME, FRAME_H);
  s.globalCompositeOperation = 'lighter';
  s.globalAlpha = mix;
  s.drawImage(sheet, (next % COLUMNS) * FRAME, Math.floor(next / COLUMNS) * FRAME_H, FRAME, FRAME_H, 0, 0, FRAME, FRAME_H);
  ctx.imageSmoothingQuality = 'high';
  const k = span / FRAME;
  ctx.drawImage(scratch, -span / 2, -span / 2 + BAND_TOP * k, span, FRAME_H * k);
}

/** Draws the hole of `radius` (field units) centred, in the frame the caller has set (the disk's tilt applied). False until the sheet has loaded. */
export function drawLensedHole(ctx: CanvasRenderingContext2D, radius: number, time: number): boolean {
  const sheet = image('hole');
  if (!sheet) return false;
  const span = radius * HOLE_SPAN;
  ctx.save();
  drawMixed(ctx, sheet, time, span);
  ctx.restore();
  return true;
}
