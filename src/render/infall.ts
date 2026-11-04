import { infallAt, type Falling } from '../game';
import { COLORS } from '../sim/config';
import { rgba } from './color';

const SAMPLES = 30;

/** The stream drawn from something falling into a hole. */
export interface InfallStream {
  /** The way it has left to go, as x, y pairs from where it is now to the middle of the hole. */
  points: number[];
  /** How wide the stream is where it leaves the body. */
  width: number;
  color: string;
  /** It builds up as the body comes apart (0 → 1). */
  strength: number;
}

export function infallStream(f: Falling): InfallStream {
  const points: number[] = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const at = infallAt(f.fromX, f.fromY, f.toX, f.toY, f.t + ((1 - f.t) * i) / SAMPLES);
    points.push(at.x, at.y);
  }
  const rise = Math.min(1, f.t / 0.4);
  return { points, width: Math.max(1.5, f.radius * 0.5 * (1 - f.t * 0.7)), color: f.color, strength: rise * rise * (3 - 2 * rise) };
}

/** Lays the stream's whole way as the current path. */
export function streamPath(ctx: CanvasRenderingContext2D, stream: InfallStream): void {
  const { points } = stream;
  ctx.beginPath();
  ctx.moveTo(points[0], points[1]);
  for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i], points[i + 1]);
}

/** Strokes the stream narrowing towards the hole, at `scale` of its width. */
export function strokeTapered(ctx: CanvasRenderingContext2D, stream: InfallStream, scale: number, color: string, alpha: number): void {
  const { points } = stream;
  const count = points.length / 2 - 1;
  ctx.strokeStyle = rgba(color, alpha * stream.strength);
  for (let i = 0; i < count; i++) {
    ctx.lineWidth = Math.max(0.5, stream.width * scale * (1 - (i / count) * 0.85));
    ctx.beginPath();
    ctx.moveTo(points[i * 2], points[i * 2 + 1]);
    ctx.lineTo(points[i * 2 + 2], points[i * 2 + 3]);
    ctx.stroke();
  }
}

/** The engraved stream: one narrowing line of ink and light. */
export function drawInfall(ctx: CanvasRenderingContext2D, stream: InfallStream): void {
  ctx.save();
  strokeTapered(ctx, stream, 1, stream.color, 0.65);
  strokeTapered(ctx, stream, 0.3, COLORS.bone, 0.6);
  ctx.restore();
}
