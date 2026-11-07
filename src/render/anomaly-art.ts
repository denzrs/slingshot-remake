import type { Anomaly } from '../sim/config';

/** Each anomaly's colour, on its tile in the rules and wherever it is named. */
export const ANOMALY_COLORS: Record<Anomaly, string> = {
  // Dark shades of red and blue, bright enough to read on the field: a crimson, a royal blue, a blood red, an indigo.
  trickShots: '#d24a5e',
  pinball: '#4a7ce0',
  fuse: '#b02f47',
  fusion: '#5b6fd6',
  whiteHole: '#d9e6ff',
  unstable: '#ee8469',
};

/**
 * An anomaly's symbol, centred on (x, y) and `r` across, in the stroke and fill the caller has set:
 * the long way round a wall to a flash, a ball off a bumper, a bomb with its fuse alight, two shots becoming one.
 */
export function drawAnomalySymbol(ctx: CanvasRenderingContext2D, anomaly: Anomaly, x: number, y: number, r: number): void {
  ctx.beginPath();
  if (anomaly === 'trickShots') {
    // A shot flies up to a wall, comes off it and arms: a spark where it turned.
    ctx.moveTo(x - r, y + r * 0.7);
    ctx.lineTo(x + r * 0.55, y - r * 0.55);
    ctx.lineTo(x - r * 0.15, y - r);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + r * 0.85, y - r);
    ctx.lineTo(x + r * 0.85, y + r);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x + r * 0.55, y - r * 0.55, r * 0.2, 0, Math.PI * 2);
    ctx.fill();
  } else if (anomaly === 'pinball') {
    // A planet, and a ball coming off it in a V.
    ctx.arc(x, y + r * 0.45, r * 0.45, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x - r, y - r * 0.8);
    ctx.lineTo(x, y - r * 0.05);
    ctx.lineTo(x + r, y - r * 0.8);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x + r, y - r * 0.8, r * 0.17, 0, Math.PI * 2);
    ctx.fill();
  } else if (anomaly === 'fuse') {
    // A bomb, its fuse curling up to a spark.
    ctx.arc(x - r * 0.15, y + r * 0.2, r * 0.62, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + r * 0.25, y - r * 0.3);
    ctx.quadraticCurveTo(x + r * 0.55, y - r * 0.95, x + r * 0.85, y - r * 0.7);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x + r * 0.85, y - r * 0.7, r * 0.18, 0, Math.PI * 2);
    ctx.fill();
  } else if (anomaly === 'whiteHole') {
    ctx.ellipse(x, y, r * .55, r, -.4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - r, y); ctx.lineTo(x + r, y);
    ctx.moveTo(x + r * .65, y - r * .3); ctx.lineTo(x + r, y); ctx.lineTo(x + r * .65, y + r * .3);
    ctx.stroke();
  } else if (anomaly === 'unstable') {
    ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + r * .3, y - r); ctx.lineTo(x - r * .25, y - r * .2);
    ctx.lineTo(x + r * .3, y + r * .1); ctx.lineTo(x - r * .2, y + r);
    ctx.moveTo(x - r * .25, y - r * .2); ctx.lineTo(x - r * .8, y - r * .4);
    ctx.stroke();
  } else {
    // Two shots coming together, and the one they make flying on.
    ctx.moveTo(x - r, y - r * 0.75);
    ctx.lineTo(x - r * 0.1, y);
    ctx.moveTo(x - r, y + r * 0.75);
    ctx.lineTo(x - r * 0.1, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x + r * 0.45, y, r * 0.42, 0, Math.PI * 2);
    ctx.fill();
  }
}
