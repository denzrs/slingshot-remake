import type { MarkKind } from '../game';

/**
 * The marks on a ship's card each have a colour and a symbol of their own, drawn like the power-ups': strokes in the
 * current line style, so a mark reads at a glance in the HUD. Gold is the crown, the bounty on whoever leads.
 */
export const MARK_COLORS: Record<MarkKind, string> = {
  bounty: '#ffcf3f',
  revenge: '#ff5c5c',
  domination: '#ff4fd8',
  shutdown: '#ff7a1a',
  avenger: '#3ff0ff',
  underdog: '#4dffb0',
  comeback: '#4db8ff',
  firstBlood: '#ff4f6a',
  opener: '#dfe7f5',
  chain: '#ffd9a0',
};

/** Two short strokes folded back from a tip at (x, y) that points along (dx, dy). */
function arrowHead(ctx: CanvasRenderingContext2D, x: number, y: number, dx: number, dy: number, size: number): void {
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  for (const wing of [-1, 1]) {
    ctx.moveTo(x, y);
    ctx.lineTo(x - ux * size - uy * wing * size * 0.7, y - uy * size + ux * wing * size * 0.7);
  }
}

/** The path of `points` (pairs in units of `r` around (x, y)), as one polyline, closed or not. */
function polyline(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, points: number[], close = false): void {
  for (let i = 0; i < points.length; i += 2) {
    if (i === 0) ctx.moveTo(x + points[i] * r, y + points[i + 1] * r);
    else ctx.lineTo(x + points[i] * r, y + points[i + 1] * r);
  }
  if (close) ctx.closePath();
}

/** Strokes the open path, with a faint fill of the same colour behind it for the shapes that are solid. */
function outline(ctx: CanvasRenderingContext2D, fill: boolean): void {
  if (fill) {
    ctx.save();
    ctx.globalAlpha *= 0.32;
    ctx.fill();
    ctx.restore();
  }
  ctx.stroke();
}

/** Draws a mark's symbol centred on (x, y), about `r` in size, in the current stroke and fill style. */
export function drawMarkSymbol(ctx: CanvasRenderingContext2D, kind: MarkKind, x: number, y: number, r: number): void {
  ctx.beginPath();
  if (kind === 'bounty') {
    // A crown: three peaks over a band.
    polyline(ctx, x, y, r, [-0.85, 0.55, -0.9, -0.55, -0.42, -0.05, 0, -0.8, 0.42, -0.05, 0.9, -0.55, 0.85, 0.55], true);
    outline(ctx, true);
    ctx.beginPath();
    polyline(ctx, x, y, r, [-0.75, 0.9, 0.75, 0.9]);
    ctx.stroke();
  } else if (kind === 'revenge') {
    // A return arrow: a ring that curls back on itself, and the one it comes for in the middle.
    const radius = r * 0.72;
    const start = -0.3 * Math.PI;
    const end = start - 1.55 * Math.PI;
    ctx.arc(x, y, radius, start, end, true);
    // Anticlockwise, the end point moves along (sin a, −cos a).
    arrowHead(ctx, x + Math.cos(end) * radius, y + Math.sin(end) * radius, Math.sin(end), -Math.cos(end), r * 0.55);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, r * 0.22, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === 'domination') {
    // Three claw marks.
    for (const i of [-1, 0, 1]) polyline(ctx, x, y, r, [i * 0.55 - 0.18, -0.85, i * 0.55 + 0.22, 0.85]);
    ctx.stroke();
  } else if (kind === 'shutdown') {
    // A flame: the spree that is to be put out.
    const p = (px: number, py: number) => [x + px * r, y + py * r] as const;
    ctx.moveTo(...p(0, -0.95));
    ctx.bezierCurveTo(...p(0.15, -0.5), ...p(0.7, -0.25), ...p(0.7, 0.3));
    ctx.bezierCurveTo(...p(0.7, 0.7), ...p(0.4, 0.95), ...p(0, 0.95));
    ctx.bezierCurveTo(...p(-0.4, 0.95), ...p(-0.7, 0.7), ...p(-0.7, 0.3));
    ctx.bezierCurveTo(...p(-0.7, -0.05), ...p(-0.5, -0.3), ...p(-0.35, -0.4));
    ctx.bezierCurveTo(...p(-0.3, -0.15), ...p(-0.15, -0.05), ...p(-0.05, -0.1));
    ctx.bezierCurveTo(...p(-0.1, -0.45), ...p(-0.1, -0.7), ...p(0, -0.95));
    ctx.closePath();
    outline(ctx, true);
  } else if (kind === 'avenger') {
    // Two blades crossed, with a guard on each.
    polyline(ctx, x, y, r, [-0.8, 0.8, 0.75, -0.75]);
    polyline(ctx, x, y, r, [0.8, 0.8, -0.75, -0.75]);
    polyline(ctx, x, y, r, [-0.62, 0.3, -0.3, 0.62]);
    polyline(ctx, x, y, r, [0.62, 0.3, 0.3, 0.62]);
    ctx.stroke();
  } else if (kind === 'underdog') {
    // An arrow climbing off a floor.
    polyline(ctx, x, y, r, [0, 0.6, 0, -0.7]);
    polyline(ctx, x, y, r, [-0.58, -0.15, 0, -0.78, 0.58, -0.15]);
    polyline(ctx, x, y, r, [-0.65, 0.95, 0.65, 0.95]);
    ctx.stroke();
  } else if (kind === 'comeback') {
    // A swing from the bottom left that rises into an arrow.
    ctx.moveTo(x - r * 0.85, y + r * 0.7);
    ctx.quadraticCurveTo(x + r * 0.25, y + r * 0.8, x + r * 0.68, y - r * 0.45);
    arrowHead(ctx, x + r * 0.68, y - r * 0.45, 0.43, -1.25, r * 0.6);
    ctx.stroke();
  } else if (kind === 'firstBlood') {
    // A drop.
    const p = (px: number, py: number) => [x + px * r, y + py * r] as const;
    ctx.moveTo(...p(0, -0.95));
    ctx.bezierCurveTo(...p(0.5, -0.25), ...p(0.65, 0.12), ...p(0.65, 0.35));
    ctx.bezierCurveTo(...p(0.65, 0.75), ...p(0.35, 0.95), ...p(0, 0.95));
    ctx.bezierCurveTo(...p(-0.35, 0.95), ...p(-0.65, 0.75), ...p(-0.65, 0.35));
    ctx.bezierCurveTo(...p(-0.65, 0.12), ...p(-0.5, -0.25), ...p(0, -0.95));
    ctx.closePath();
    outline(ctx, true);
  } else if (kind === 'opener') {
    // The first shot: a bolt with its streaks behind it.
    ctx.arc(x + r * 0.5, y, r * 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    polyline(ctx, x, y, r, [-0.9, 0, 0.1, 0]);
    polyline(ctx, x, y, r, [-0.55, -0.45, -0.05, -0.45]);
    polyline(ctx, x, y, r, [-0.55, 0.45, -0.05, 0.45]);
    ctx.stroke();
  } else {
    // 'chain': three links of a chain, slanting up.
    for (const [px, py] of [[-0.55, 0.45], [0, 0], [0.55, -0.45]]) {
      ctx.moveTo(x + (px + 0.3) * r, y + py * r);
      ctx.arc(x + px * r, y + py * r, r * 0.3, 0, Math.PI * 2);
    }
    ctx.stroke();
  }
}
