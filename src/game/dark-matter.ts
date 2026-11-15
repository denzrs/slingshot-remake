import { FIELD } from '../sim/config';

/** One cell is this many field units wide: the mask is drawn from them, scaled up and smoothed. */
export const DARK_CELL = 10;
const CELL = DARK_CELL;
/** The matter lies this far beyond the field's edge on every side (field units), under whatever the window shows there. */
export const DARK_MARGIN = 400;
const COLS = Math.ceil((FIELD.width + 2 * DARK_MARGIN) / CELL);
const ROWS = Math.ceil((FIELD.height + 2 * DARK_MARGIN) / CELL);

/** How far from a shot's path the dark matter is torn away, in field units. */
export const DARK_CLEAR_RADIUS = 58;

/** How close a rival's shot must come to a ship for the ship to be found, in field units. */
export const DARK_FOUND_RADIUS = 80;

/** How long a ship's warning lasts, in seconds. */
export const DARK_FOUND_SECONDS = 3;

function lattice(c: number, r: number): number {
  const v = Math.sin(c * 127.1 + r * 311.7) * 43758.5453;
  return v - Math.floor(v);
}

/** Smooth value noise, 0 → 1, one lattice step every `step` cells: what makes the torn edge ragged like smoke. */
function raggedness(col: number, row: number, step = 3.5): number {
  const x = col / step;
  const y = row / step;
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const u = (x - xi) ** 2 * (3 - 2 * (x - xi));
  const v = (y - yi) ** 2 * (3 - 2 * (y - yi));
  const top = lattice(xi, yi) * (1 - u) + lattice(xi + 1, yi) * u;
  const bottom = lattice(xi, yi + 1) * (1 - u) + lattice(xi + 1, yi + 1) * u;
  return top * (1 - v) + bottom * v;
}

/** The ragged edge, worked out once for every cell: it is the same for every round and every shot. */
let raggedTable: Float32Array | null = null;
function ragged(): Float32Array {
  if (!raggedTable) {
    raggedTable = new Float32Array(COLS * ROWS);
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) raggedTable[r * COLS + c] = (raggedness(c, r) - 0.5) * 0.45;
  }
  return raggedTable;
}

let nextId = 1;

/**
 * Experiment `dark-matter`: a black matter that covers the whole field at the start of a round, hiding planets, ships
 * and the black hole alike. A shot clears it wherever it flies, but only for the one who fired it: everybody has a field
 * of their own, so you see your own traces and never the others'. A shot that passes close to a ship says so to that
 * ship (`found`), so a hidden ship learns it was seen. Only a picture: nothing in the sim reads it, it is not
 * in a snapshot and it draws no random numbers.
 */
export class DarkMatter {
  /** Tells one round's matter from another's, for pictures that are kept. */
  readonly id = nextId++;
  readonly cols = COLS;
  readonly rows = ROWS;
  /** 1 = dark, 0 = clear, per cell. */
  readonly covers: Float32Array[];
  /** Raised whenever a cell of a player's field changed, so a picture of the mask knows when to be redrawn. */
  readonly versions: number[];
  /** When (match clock) each ship was last found by somebody else's shot, null if not this round. */
  readonly found: (number | null)[];

  constructor(players: number) {
    this.covers = Array.from({ length: players }, () => new Float32Array(COLS * ROWS).fill(1));
    this.versions = new Array(players).fill(0);
    this.found = new Array(players).fill(null);
  }

  /** Tears the matter away round (x, y). The edge is soft. */
  clear(owner: number, fieldX: number, fieldY: number, radius = DARK_CLEAR_RADIUS): void {
    const cover = this.covers[owner];
    if (!cover) return;
    const x = fieldX + DARK_MARGIN;
    const y = fieldY + DARK_MARGIN;
    const reach = radius * 1.25;
    const c0 = Math.max(0, Math.floor((x - reach) / CELL));
    const c1 = Math.min(COLS - 1, Math.floor((x + reach) / CELL));
    const r0 = Math.max(0, Math.floor((y - reach) / CELL));
    const r1 = Math.min(ROWS - 1, Math.floor((y + reach) / CELL));
    const edge = ragged();
    let changed = false;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const d = Math.hypot((c + 0.5) * CELL - x, (r + 0.5) * CELL - y) / radius + edge[r * COLS + c];
        if (d >= 1) continue;
        const keep = d < 0.55 ? 0 : ((d - 0.55) / 0.45) ** 2 * (3 - 2 * ((d - 0.55) / 0.45));
        const i = r * COLS + c;
        if (keep < cover[i]) {
          cover[i] = keep;
          changed = true;
        }
      }
    }
    if (changed) this.versions[owner]++;
  }
}
