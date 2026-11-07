import { isTrailBreak, type Wormhole } from '../sim/physics';

/** Strokes a flat polyline `[x0, y0, x1, y1, …]` as one path; a jump between the two mouths of a wormhole, or across the field in a loop, is no flight, so the line breaks there. */
export function strokePolyline(ctx: CanvasRenderingContext2D, pts: number[], wormholes: readonly Wormhole[] = []): void {
  if (pts.length < 4) return;
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) {
    // A wormhole jump or a jump across the field in a loop is no flight: the line breaks there.
    if (isTrailBreak(pts, i, wormholes)) ctx.moveTo(pts[i], pts[i + 1]);
    else ctx.lineTo(pts[i], pts[i + 1]);
  }
  ctx.stroke();
}
