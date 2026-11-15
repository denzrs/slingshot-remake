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
  const t = (a: number, b: number): number => (a === b ? 0.5 : (level - a) / (b - a));
  const seg = (x0: number, y0: number, x1: number, y1: number): void => {
    path.moveTo(x0, y0);
    path.lineTo(x1, y1);
    out.push(x0, y0, x1, y1);
  };
  for (let r = 0; r < rows - 1; r++) {
    const base = r * cols;
    const py0 = (r + 0.5) * DARK_CELL - DARK_MARGIN;
    const py1 = py0 + DARK_CELL;
    for (let c = 0; c < cols - 1; c++) {
      const i = base + c;
      const a = cover[i];
      const b = cover[i + 1];
      const e = cover[i + cols];
      const d = cover[i + cols + 1];
      const k = (a > level ? 8 : 0) | (b > level ? 4 : 0) | (d > level ? 2 : 0) | (e > level ? 1 : 0);
      if (k === 0 || k === 15) continue;
      const px0 = (c + 0.5) * DARK_CELL - DARK_MARGIN;
      const px1 = px0 + DARK_CELL;
      switch (k) {
        case 1: case 14: seg(px0, py0 + t(a, e) * DARK_CELL, px0 + t(e, d) * DARK_CELL, py1); break;
        case 2: case 13: seg(px0 + t(e, d) * DARK_CELL, py1, px1, py0 + t(b, d) * DARK_CELL); break;
        case 3: case 12: seg(px0, py0 + t(a, e) * DARK_CELL, px1, py0 + t(b, d) * DARK_CELL); break;
        case 4: case 11: seg(px0 + t(a, b) * DARK_CELL, py0, px1, py0 + t(b, d) * DARK_CELL); break;
        case 6: case 9: seg(px0 + t(a, b) * DARK_CELL, py0, px0 + t(e, d) * DARK_CELL, py1); break;
        case 7: case 8: seg(px0, py0 + t(a, e) * DARK_CELL, px0 + t(a, b) * DARK_CELL, py0); break;
        case 5:
          seg(px0, py0 + t(a, e) * DARK_CELL, px0 + t(a, b) * DARK_CELL, py0);
          seg(px0 + t(e, d) * DARK_CELL, py1, px1, py0 + t(b, d) * DARK_CELL);
          break;
        case 10:
          seg(px0 + t(a, b) * DARK_CELL, py0, px1, py0 + t(b, d) * DARK_CELL);
          seg(px0, py0 + t(a, e) * DARK_CELL, px0 + t(e, d) * DARK_CELL, py1);
          break;
      }
    }
  }
  return { path, segments: new Float32Array(out) };
}
