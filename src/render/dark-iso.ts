import { DARK_CELL, DARK_MARGIN } from '../game/dark-matter';

/** A line of equal darkness through the matter, in field units: as a path to stroke, and as its segments (x0, y0, x1, y1, …). */
export interface DarkIso {
  path: Path2D;
  segments: Float32Array;
}

/**
 * Traces where the cover of a Dark Matter field crosses `level` (marching squares over the cells' middles). The
 * pieces are not joined into one line: they are stroked with round caps, which hides the seams.
 */
export function traceDarkIso(cover: Float32Array, cols: number, rows: number, level: number): DarkIso {
  const path = new Path2D();
  const out: number[] = [];
  const at = (c: number, r: number): number => cover[r * cols + c];
  const px = (c: number): number => (c + 0.5) * DARK_CELL - DARK_MARGIN;
  const py = (r: number): number => (r + 0.5) * DARK_CELL - DARK_MARGIN;
  const t = (a: number, b: number): number => (a === b ? 0.5 : (level - a) / (b - a));
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = at(c, r);
      const b = at(c + 1, r);
      const d = at(c + 1, r + 1);
      const e = at(c, r + 1);
      const k = (a > level ? 8 : 0) | (b > level ? 4 : 0) | (d > level ? 2 : 0) | (e > level ? 1 : 0);
      if (k === 0 || k === 15) continue;
      // Where the line crosses each side of the square.
      const top = (): [number, number] => [px(c + t(a, b)), py(r)];
      const right = (): [number, number] => [px(c + 1), py(r + t(b, d))];
      const bottom = (): [number, number] => [px(c + t(e, d)), py(r + 1)];
      const left = (): [number, number] => [px(c), py(r + t(a, e))];
      const seg = (p: [number, number], q: [number, number]): void => {
        path.moveTo(p[0], p[1]);
        path.lineTo(q[0], q[1]);
        out.push(p[0], p[1], q[0], q[1]);
      };
      switch (k) {
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
  }
  return { path, segments: new Float32Array(out) };
}
