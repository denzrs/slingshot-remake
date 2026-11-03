import { fbm } from '../../src/render/noise';
import { smoothstep } from '../../src/render/planet-common';
import { HOLE_SPAN } from '../../src/render/looks/forged-hole-sheet';

/**
 * The forged black hole, as light really bends round one: a thin accretion disk seen nearly edge on, its far side lifted
 * over the top of the shadow and its underside folded beneath it, a thin photon ring hugging the shadow, the disk
 * streaked and turning, faster towards the middle.
 *
 * Each pixel is a ray traced back from the eye past a hole that does not spin (Schwarzschild, in units of its mass). A
 * ray's path depends only on how near it passes (its impact parameter `b`), so the paths are traced once for a range of
 * `b` (`paths`) and every pixel looks its own up: where it crosses the disk's plane follows from its direction on the
 * screen alone. What a pixel sees (up to three crossings, front first, and whether it falls in) is baked (`bake`), and
 * the disk's streaks are painted from it at any moment (`paint`).
 *
 * This is the tool that makes `src/render/looks/forged/hole.webp` (`scripts/forged/hole-frames.mjs`): the game draws the
 * frames it paints, it does not trace anything itself.
 */

/** The shadow's radius, in the hole's mass: the image is scaled so that this is the hole's radius on the field. */
export const SHADOW = 3 * Math.sqrt(3);
/** The disk's inner and outer edge (masses). The inner edge sits inside the last stable orbit of a still hole, as round a spinning one. */
const DISK_IN = 3.6;
const DISK_OUT = 17;
/** How far above the disk's plane the eye is (radians): nearly edge on. */
const ELEVATION = 0.13;
/** A turn of the disk's inner edge takes this many seconds; further out, slower (Kepler). */
const INNER_TURN = 3;

// ------------------------------------------------------------------ paths ----

/** Impact parameters traced (masses), evenly from 0, and the angle step along a path (radians) and how far a path is followed. */
export const B_MAX = 32;
export const B_STEPS = 1200;
export const PHI_STEP = 0.02;
const PHI_MAX = 3.2 * Math.PI;
const PHI_STEPS = Math.ceil(PHI_MAX / PHI_STEP);

export interface Paths {
  /** 1/r along each path, `PHI_STEPS` values a path, by the angle swept since it left the eye. */
  u: Float32Array;
  /** How far (radians) each path goes before it falls in or leaves for good. */
  end: Float32Array;
}
let traced: Paths | null = null;

/**
 * The paths, traced once: the orbit equation of light, u'' = 3u² − u (u = 1/r), from far away inwards, step by step
 * (fourth-order Runge–Kutta in the angle), until the path falls through the horizon (r < 2) or runs back out.
 */
export function paths(): Paths {
  if (traced) return traced;
  const u = new Float32Array(B_STEPS * PHI_STEPS);
  const end = new Float32Array(B_STEPS);
  const accel = (x: number): number => 3 * x * x - x;
  for (let i = 0; i < B_STEPS; i++) {
    const b = Math.max(0.05, (i / (B_STEPS - 1)) * B_MAX);
    let x = 1e-3;
    let v = Math.sqrt(Math.max(0, 1 / (b * b) - x * x + 2 * x * x * x));
    end[i] = PHI_MAX;
    for (let j = 0; j < PHI_STEPS; j++) {
      u[i * PHI_STEPS + j] = x;
      if (x > 0.5) {
        end[i] = j * PHI_STEP;
        break;
      }
      if (x <= 0 && j > 0) {
        end[i] = j * PHI_STEP;
        break;
      }
      const h = PHI_STEP;
      const k1x = v;
      const k1v = accel(x);
      const k2x = v + (h / 2) * k1v;
      const k2v = accel(x + (h / 2) * k1x);
      const k3x = v + (h / 2) * k2v;
      const k3v = accel(x + (h / 2) * k2x);
      const k4x = v + h * k3v;
      const k4v = accel(x + h * k3x);
      x += (h / 6) * (k1x + 2 * k2x + 2 * k3x + k4x);
      v += (h / 6) * (k1v + 2 * k2v + 2 * k3v + k4v);
    }
  }
  traced = { u, end };
  return traced;
}

/** 1/r of the path with impact parameter `b` after sweeping `phi`, between the traced paths and steps; -1 past its end. */
export function uAt(p: Paths, b: number, phi: number): number {
  const fi = Math.min(B_STEPS - 1.001, (b / B_MAX) * (B_STEPS - 1));
  const i = Math.floor(fi);
  const t = fi - i;
  const end = p.end[i] + (p.end[i + 1] - p.end[i]) * t;
  if (phi >= end) return -1;
  const fj = Math.min(PHI_STEPS - 1.001, phi / PHI_STEP);
  const j = Math.floor(fj);
  const s = fj - j;
  const at = (row: number): number => p.u[row * PHI_STEPS + j] + (p.u[row * PHI_STEPS + j + 1] - p.u[row * PHI_STEPS + j]) * s;
  return at(i) + (at(i + 1) - at(i)) * t;
}

// ------------------------------------------------------------------ streaks ----

/** The disk's streaks: a map round the disk (angle across, radius down), long along the orbits and thin across them. */
const MAP_A = 512;
const MAP_R = 96;
let streaks: Float32Array | null = null;
function streakMap(): Float32Array {
  if (streaks) return streaks;
  streaks = new Float32Array(MAP_A * MAP_R);
  for (let j = 0; j < MAP_R; j++) {
    const r = j / MAP_R;
    for (let i = 0; i < MAP_A; i++) {
      const a = (i / MAP_A) * Math.PI * 2;
      // On a circle, so the map wraps round the disk without a seam; the radius changes it fast, the angle slowly.
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      // Clumps of hot gas, long along the orbit; thin filaments between them; two spiral arms that the differential turning shears.
      const clump = smoothstep(0.25, 0.8, fbm(ca * 1.8, sa * 1.8, r * 10, 61, 5));
      const filament = fbm(ca * 6, sa * 6, r * 46, 67, 4);
      const lines = smoothstep(0.55, 0.9, filament);
      const gaps = 1 - smoothstep(0.1, 0.4, fbm(ca * 3, sa * 3, r * 22, 71, 3));
      const arms = 0.5 + 0.5 * Math.cos(2 * a - r * 14);
      streaks[j * MAP_A + i] = 0.45 + 0.7 * clump + 0.5 * lines - 0.35 * gaps + 0.3 * arms * (0.4 + clump);
    }
  }
  return streaks;
}

/** The disk's colour by radius: white-hot inside, gold, then a deep orange at the rim (0 → 1 from the inner edge out). */
function diskColour(t: number): [number, number, number] {
  const stops: [number, [number, number, number]][] = [
    [0, [1, 0.93, 0.8]],
    [0.2, [1, 0.78, 0.45]],
    [0.5, [1, 0.58, 0.22]],
    [1, [0.9, 0.36, 0.1]],
  ];
  for (let k = 1; k < stops.length; k++) {
    if (t <= stops[k][0]) {
      const [t0, c0] = stops[k - 1];
      const [t1, c1] = stops[k];
      const f = (t - t0) / (t1 - t0);
      return [c0[0] + (c1[0] - c0[0]) * f, c0[1] + (c1[1] - c0[1]) * f, c0[2] + (c1[2] - c0[2]) * f];
    }
  }
  return stops[stops.length - 1][1];
}


// ------------------------------------------------------------------ the image ----

export interface Hole {
  size: number;
  /** Each crossing of the disk a pixel sees: its pixel, its colour already weighted (light, how much of it is seen past what is in front), the streak map's row, where round the disk it is (turns) and how fast that turns (turns a second). */
  count: number;
  pixel: Int32Array;
  colour: Float32Array;
  row: Float32Array;
  angle: Float32Array;
  spin: Float32Array;
  /** How much of each pixel the shadow covers, 0 → 1: black behind the disk's light, which covers the stars only as far as it shines. */
  shadow: Float32Array;
  /** The pixels that have a crossing or any shadow: the only ones painted. */
  active: Int32Array;
}

/** What every pixel of a `size` square image sees: the hole spans `HOLE_SPAN` shadow radii across it. */
export function bake(size: number): Hole {
  const p = paths();
  const per = SHADOW / (size / HOLE_SPAN);
  const sin = Math.sin(ELEVATION);
  const cos = Math.cos(ELEVATION);
  const n = size * size;
  const pixel = new Int32Array(n * 3);
  const colour = new Float32Array(n * 9);
  const row = new Float32Array(n * 3);
  const angle = new Float32Array(n * 3);
  const spin = new Float32Array(n * 3);
  const shadow = new Float32Array(n);
  const active: number[] = [];
  let count = 0;
  const half = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // The pixel on the sky, in masses: right and up.
      const a = (x + 0.5 - half) * per;
      const c = (half - y - 0.5) * per;
      const b = Math.hypot(a, c);
      if (b >= B_MAX) continue;
      // The path's plane holds the line to the eye (0, sin, cos) and the pixel's direction on the screen (e).
      const ex = a / (b || 1);
      const ey = (c / (b || 1)) * cos;
      const ez = (-c / (b || 1)) * sin;
      // It crosses the disk's plane (y = 0) where cos φ · sin + sin φ · ey = 0: every half turn from the first such angle.
      const first = Math.atan2(sin, -ey);
      let seen = 1;
      const before = count;
      for (let k = 0; k < 3; k++) {
        const phi = first + k * Math.PI;
        const uu = uAt(p, b, phi);
        if (uu <= 0) break;
        const r = 1 / uu;
        if (r < DISK_IN * 0.9 || r > DISK_OUT) continue;
        const px = r * (Math.sin(phi) * ex);
        const pz = r * (Math.cos(phi) * cos + Math.sin(phi) * ez);
        const t = (r - DISK_IN) / (DISK_OUT - DISK_IN);
        // Light: hottest just outside the inner edge, falling off outwards, both edges soft.
        const light = 4.2 * (DISK_IN / r) ** 1.8 * smoothstep(DISK_IN * 0.9, DISK_IN * 1.15, r) * (1 - smoothstep(DISK_OUT * 0.7, DISK_OUT, r));
        // The side of the disk that comes towards the eye a little brighter.
        const psi = Math.atan2(pz, px);
        const beaming = 1 + 0.22 * Math.cos(psi) * cos * Math.sqrt(DISK_IN / r);
        const opacity = 0.92 * smoothstep(DISK_IN * 0.9, DISK_IN * 1.05, r) * (1 - smoothstep(DISK_OUT * 0.8, DISK_OUT, r));
        const [cr, cg, cb] = diskColour(Math.max(0, t));
        const w = seen * light * beaming * Math.max(opacity, 0.25);
        const h = count++;
        pixel[h] = y * size + x;
        colour[h * 3] = cr * w;
        colour[h * 3 + 1] = cg * w;
        colour[h * 3 + 2] = cb * w;
        row[h] = Math.min(MAP_R - 1.001, Math.max(0, t * MAP_R - 0.5));
        angle[h] = psi / (Math.PI * 2);
        spin[h] = (DISK_IN / r) ** 1.5 / INNER_TURN;
        seen *= 1 - opacity;
      }
      // What falls in (every path nearer than the shadow's edge) is black, its edge softened over a pixel.
      const dark = 1 - smoothstep(SHADOW - per * 0.7, SHADOW + per * 0.7, b);
      shadow[y * size + x] = dark;
      if (count > before || dark > 0) active.push(y * size + x);
    }
  }
  return {
    size,
    count,
    pixel: pixel.slice(0, count),
    colour: colour.slice(0, count * 3),
    row: row.slice(0, count),
    angle: angle.slice(0, count),
    spin: spin.slice(0, count),
    shadow,
    active: Int32Array.from(active),
  };
}

/** Light (summed, before toning) below this is not shown over the shadow. */
const SHADOW_CUT = 0.18;

/**
 * The disk as it has turned by `time`: each crossing's streak, lit, summed and toned so the hottest parts run to white.
 * RGBA, straight (not premultiplied). With `loop` (s), every ring turns a whole number of times in it (the nearest to its
 * own speed; the outer ones, too slow to turn once, stand still), so the picture at `loop` is the one at 0.
 */
export function paint(hole: Hole, time: number, loop: number): Uint8ClampedArray {
  const map = streakMap();
  const sum = new Float32Array(hole.size * hole.size * 3);
  for (let h = 0; h < hole.count; h++) {
    const spin = Math.round(hole.spin[h] * loop) / loop;
    let turn = hole.angle[h] - spin * time;
    turn -= Math.floor(turn);
    // The streak map between its cells, round the disk and across it.
    const fa = turn * MAP_A;
    const a0 = Math.floor(fa);
    const a1 = a0 + 1 === MAP_A ? 0 : a0 + 1;
    const ta = fa - a0;
    const fr = hole.row[h];
    const r0 = Math.floor(fr);
    const tr = fr - r0;
    const m0 = r0 * MAP_A;
    const m1 = m0 + MAP_A;
    const s = (map[m0 + a0] * (1 - ta) + map[m0 + a1] * ta) * (1 - tr) + (map[m1 + a0] * (1 - ta) + map[m1 + a1] * ta) * tr;
    const i = hole.pixel[h] * 3;
    sum[i] += hole.colour[h * 3] * s;
    sum[i + 1] += hole.colour[h * 3 + 1] * s;
    sum[i + 2] += hole.colour[h * 3 + 2] * s;
  }
  const data = new Uint8ClampedArray(hole.size * hole.size * 4);
  const tone = (x: number): number => 1 - Math.exp(-x * 1.4);
  for (const k of hole.active) {
    const shadow = hole.shadow[k];
    // Faint light inside the shadow is dropped: dim orange over black reads as mud, not as the disk.
    const cut = SHADOW_CUT * shadow;
    const r = tone(Math.max(0, sum[k * 3] - cut));
    const g = tone(Math.max(0, sum[k * 3 + 1] - cut));
    const b = tone(Math.max(0, sum[k * 3 + 2] - cut));
    // It covers the stars as far as it shines, the shadow under it wholly.
    const alpha = shadow + (1 - shadow) * Math.max(r, g, b);
    if (alpha <= 0.002) continue;
    data[k * 4] = (255 * r) / alpha;
    data[k * 4 + 1] = (255 * g) / alpha;
    data[k * 4 + 2] = (255 * b) / alpha;
    data[k * 4 + 3] = 255 * alpha;
  }
  return data;
}

/** `image`, `from` wide, shrunk by a whole `factor` by averaging (the colours weighted by their alpha, so a soft edge keeps its colour). */
export function shrink(image: Uint8ClampedArray, from: number, factor: number): Uint8ClampedArray {
  const to = from / factor;
  const out = new Uint8ClampedArray(to * to * 4);
  for (let y = 0; y < to; y++) {
    for (let x = 0; x < to; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let dy = 0; dy < factor; dy++) {
        for (let dx = 0; dx < factor; dx++) {
          const i = ((y * factor + dy) * from + x * factor + dx) * 4;
          const w = image[i + 3];
          r += image[i] * w;
          g += image[i + 1] * w;
          b += image[i + 2] * w;
          a += w;
        }
      }
      const o = (y * to + x) * 4;
      if (a > 0) {
        out[o] = r / a;
        out[o + 1] = g / a;
        out[o + 2] = b / a;
      }
      out[o + 3] = a / (factor * factor);
    }
  }
  return out;
}
