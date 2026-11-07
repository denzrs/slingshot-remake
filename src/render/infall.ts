import { infallAt, type Falling } from '../game';

/** Points along the way a falling body bends to. */
const SAMPLES = 72;
/** How long a slice of it comes out (field units), and the most slices on each side of its middle. */
const SLICE = 2.5;
const MAX_SLICES = 140;
/** How far along its way the side nearest the hole and the far side have been drawn out at the end of a fall. */
const HEAD_STRETCH = 9;
const TAIL_STRETCH = 3.5;

let scratch: HTMLCanvasElement | null = null;

interface Way {
  x: number[];
  y: number[];
  /** The distance along the way at each point. */
  at: number[];
}

/** The whole fall as points, begun a little before it starts, so that what is behind a body at the start has somewhere to lie. */
function wayOf(f: Falling): Way {
  const first = infallAt(f.fromX, f.fromY, f.toX, f.toY, 0.04);
  const back = Math.hypot(first.x - f.fromX, first.y - f.fromY) || 1;
  const x = [f.fromX + ((f.fromX - first.x) / back) * f.radius * 4];
  const y = [f.fromY + ((f.fromY - first.y) / back) * f.radius * 4];
  const at = [0];
  for (let i = 0; i <= SAMPLES; i++) {
    const p = infallAt(f.fromX, f.fromY, f.toX, f.toY, i / SAMPLES);
    at.push(at[at.length - 1] + Math.hypot(p.x - x[x.length - 1], p.y - y[y.length - 1]));
    x.push(p.x);
    y.push(p.y);
  }
  return { x, y, at };
}

function pointOn(way: Way, distance: number): { x: number; y: number } {
  let i = 1;
  while (i < way.at.length - 1 && way.at[i] < distance) i++;
  const k = (distance - way.at[i - 1]) / (way.at[i] - way.at[i - 1] || 1);
  return { x: way.x[i - 1] + (way.x[i] - way.x[i - 1]) * k, y: way.y[i - 1] + (way.y[i] - way.y[i - 1]) * k };
}

/** Which way the fall runs at a distance along it. */
function headingOn(way: Way, distance: number): number {
  const a = pointOn(way, distance - 2);
  const b = pointOn(way, distance + 2);
  return Math.atan2(b.y - a.y, b.x - a.x);
}

/**
 * Draws something falling into a hole, bent along the way it has to go: it starts whole, then its near side is drawn
 * out ahead of it and its far side after it, thinner the longer, until it lies round the hole as a stream that the hole
 * takes bit by bit. `paint` draws it round (0, 0), `reach` (field units) being as far as it goes. It is painted once and
 * cut into slices, so this works for anything a look can draw.
 */
export function drawFalling(ctx: CanvasRenderingContext2D, f: Falling, reach: number, ps: number, paint: (c: CanvasRenderingContext2D) => void): void {
  const way = wayOf(f);
  // Where it is on the way: the point is the fall at `t`, measured along the samples.
  const step = f.t * SAMPLES;
  const below = Math.floor(step);
  const here = way.at[below + 1] + (way.at[Math.min(below + 2, way.at.length - 1)] - way.at[below + 1]) * (step - below);
  const end = way.at[way.at.length - 1];

  const size = Math.ceil(reach * 2 * ps);
  scratch ??= document.createElement('canvas');
  if (scratch.width < size) scratch.width = scratch.height = size;
  const c = scratch.getContext('2d')!;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, size, size);
  // Painted with the way running along +x, so that a slice laid on the way ends up as it was painted.
  c.setTransform(ps, 0, 0, ps, size / 2, size / 2);
  c.rotate(-headingOn(way, here));
  paint(c);

  const pull = f.t * f.t;
  const head = 1 + HEAD_STRETCH * pull;
  // The far side is drawn out too, then reeled in, so that nothing is left outside the hole when the fall ends.
  const reel = Math.min(1, Math.max(0, (f.t - 0.65) / 0.35));
  const tail = (1 + TAIL_STRETCH * pull) * (1 - reel * reel * (3 - 2 * reel));
  // How much each part of it is drawn out, running smoothly from the far side to the near side.
  const stretchAt = (u: number): number => {
    const k = Math.min(1, Math.max(0, (u / f.radius + 1) / 2));
    return tail + (head - tail) * k * k * (3 - 2 * k);
  };
  const toPixel = (u: number): number => (u + reach) * ps;
  const thickness = (u: number, stretch: number): number => Math.max(0.1, Math.min(1, 1 / Math.sqrt(stretch)) * (1 - (Math.max(0, u) / reach) * pull * 0.5));
  const drawSlice = (from: number, to: number, distance: number, stretch: number): void => {
    const length = (to - from) * stretch;
    const thin = thickness((from + to) / 2, stretch);
    const at = pointOn(way, distance);
    const heading = headingOn(way, distance);
    const turn = headingOn(way, distance + length) - heading;
    // Longer than its slice by what the bend opens on its outer edge, so that no gap shows there.
    const bend = Math.min(0.2, Math.abs(Math.atan2(Math.sin(turn), Math.cos(turn))));
    const long = length + 1.6 + bend * reach * thin;
    ctx.save();
    ctx.translate(at.x, at.y);
    ctx.rotate(heading);
    ctx.drawImage(scratch!, toPixel(from), 0, (to - from) * ps, size, -long / 2, -reach * thin, long, reach * 2 * thin);
    ctx.restore();
  };

  ctx.save();
  ctx.imageSmoothingQuality = 'high';
  // Cut so that each slice comes out about as long as the next, however far it is drawn out: outwards from the middle both ways.
  const least = reach / MAX_SLICES;
  for (let u = 0, distance = here; u < reach && distance < end;) {
    const stretch = stretchAt(u);
    const du = Math.max(least, SLICE / stretch);
    drawSlice(u, u + du, distance + (stretch * du) / 2, stretch);
    distance += stretch * du;
    u += du;
  }
  for (let u = 0, distance = here; u > -reach;) {
    const stretch = stretchAt(u);
    const du = Math.min(reach / 24, Math.max(least, SLICE / stretch));
    // Gone down the hole: only at the very end is the far side reeled in this far.
    if (stretch > 0.001) drawSlice(u - du, u, distance - (stretch * du) / 2, stretch);
    distance -= stretch * du;
    u -= du;
  }
  ctx.restore();
}
