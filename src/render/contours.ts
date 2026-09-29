import { COLORS, PHYSICS } from '../config';
import type { World } from '../physics';
import { rgba } from './color';

const GRID = 6;
/** Spacing of contour levels in ln(potential). Every 5th line is an index contour, as on a topo map. */
const LEVEL_STEP = 0.11;

/**
 * Draw the battlefield's gravity as a topographic map: equipotential lines of the
 * summed planet potential, traced with marching squares. `ps` = device pixels per field unit.
 */
export function renderContours(world: World, ps: number): HTMLCanvasElement {
  const { width, height, planets } = world;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(width * ps);
  canvas.height = Math.ceil(height * ps);
  if (planets.length === 0) return canvas;

  const cols = Math.ceil(width / GRID) + 1;
  const rows = Math.ceil(height / GRID) + 1;
  const field = new Float32Array(cols * rows);
  let min = Infinity;
  let max = -Infinity;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const x = i * GRID;
      const y = j * GRID;
      let phi = 0;
      for (const p of planets) {
        const d = Math.max(Math.hypot(p.x - x, p.y - y), p.radius);
        phi += (PHYSICS.G * p.mass) / d;
      }
      const v = Math.log(phi);
      field[j * cols + i] = v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }

  const first = Math.ceil(min / LEVEL_STEP);
  const last = Math.floor(max / LEVEL_STEP);
  const minor = new Path2D();
  const major = new Path2D();

  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const a = field[j * cols + i]; // top-left
      const b = field[j * cols + i + 1]; // top-right
      const c = field[(j + 1) * cols + i + 1]; // bottom-right
      const d = field[(j + 1) * cols + i]; // bottom-left
      const lo = Math.min(a, b, c, d);
      const hi = Math.max(a, b, c, d);
      const from = Math.max(first, Math.ceil(lo / LEVEL_STEP));
      const to = Math.min(last, Math.floor(hi / LEVEL_STEP));
      for (let k = from; k <= to; k++) {
        const level = k * LEVEL_STEP;
        traceCell(k % 5 === 0 ? major : minor, i * GRID, j * GRID, a, b, c, d, level, ps);
      }
    }
  }

  const ctx = canvas.getContext('2d')!;
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(1, ps * 0.6);
  ctx.strokeStyle = rgba(COLORS.line, 0.17);
  ctx.stroke(minor);
  ctx.lineWidth = Math.max(1, ps * 0.8);
  ctx.strokeStyle = rgba(COLORS.line, 0.34);
  ctx.stroke(major);
  return canvas;
}

function traceCell(
  path: Path2D,
  x: number,
  y: number,
  a: number,
  b: number,
  c: number,
  d: number,
  level: number,
  ps: number,
): void {
  const idx = (a > level ? 8 : 0) | (b > level ? 4 : 0) | (c > level ? 2 : 0) | (d > level ? 1 : 0);
  if (idx === 0 || idx === 15) return;
  const t = (v0: number, v1: number) => (level - v0) / (v1 - v0);
  // Edge crossing points in device pixels.
  const top = (): [number, number] => [(x + GRID * t(a, b)) * ps, y * ps];
  const right = (): [number, number] => [(x + GRID) * ps, (y + GRID * t(b, c)) * ps];
  const bottom = (): [number, number] => [(x + GRID * t(d, c)) * ps, (y + GRID) * ps];
  const left = (): [number, number] => [x * ps, (y + GRID * t(a, d)) * ps];
  const seg = (p: [number, number], q: [number, number]) => {
    path.moveTo(p[0], p[1]);
    path.lineTo(q[0], q[1]);
  };
  switch (idx) {
    case 1: case 14: seg(left(), bottom()); break;
    case 2: case 13: seg(bottom(), right()); break;
    case 3: case 12: seg(left(), right()); break;
    case 4: case 11: seg(top(), right()); break;
    case 6: case 9: seg(top(), bottom()); break;
    case 7: case 8: seg(left(), top()); break;
    case 5: seg(left(), top()); seg(bottom(), right()); break;
    case 10: seg(top(), right()); seg(left(), bottom()); break;
  }
}
