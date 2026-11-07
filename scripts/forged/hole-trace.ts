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

/** How far (radians) the path with impact parameter `b` sweeps before it falls in or leaves, between the traced paths. */
export function endAt(p: Paths, b: number): number {
  const fi = Math.min(B_STEPS - 1.001, (b / B_MAX) * (B_STEPS - 1));
  const i = Math.floor(fi);
  return p.end[i] + (p.end[i + 1] - p.end[i]) * (fi - i);
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
      streaks[j * MAP_A + i] = 0.2 + 1.2 * clump + 0.95 * lines - 0.55 * gaps + 0.55 * arms * (0.4 + clump);
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
  /** How deep in the shadow each pixel is, 0 (at its edge) → 1: the faint light that is dropped over the shadow is dropped by this much, so the disk does not change where the shadow begins. */
  depth: Float32Array;
  /** The thin photon ring's light at each pixel: a clean line just outside the shadow, where the traced paths leave a dim, dashed gap. */
  ring: Float32Array;
  /** The pixels that have a crossing or any shadow: the only ones painted. */
  active: Int32Array;
  /**
   * For the white hole, what each pixel in the shadow sees of the horizon its path ends on: how far round the path swept
   * before it got there (radians: 0 is the point facing the eye, past π the far side, wound into thin rings at the edge),
   * where round the screen it is (radians), and how much of it the disk in front lets through.
   */
  sweep: Float32Array;
  around: Float32Array;
  through: Float32Array;
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
  const depth = new Float32Array(n);
  const ring = new Float32Array(n);
  const sweep = new Float32Array(n);
  const around = new Float32Array(n);
  const through = new Float32Array(n);
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
        const light = 3.4 * (DISK_IN / r) ** 1.8 * smoothstep(DISK_IN * 0.9, DISK_IN * 1.15, r) * (1 - smoothstep(DISK_OUT * 0.7, DISK_OUT, r));
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
      if (dark > 0) {
        sweep[y * size + x] = endAt(p, b);
        around[y * size + x] = Math.atan2(c, a);
        through[y * size + x] = seen;
      }
      depth[y * size + x] = 1 - smoothstep(SHADOW * (1 - DEPTH), SHADOW, b);
      const off = (b - SHADOW - per * RING_AT) / (per * RING_WIDTH);
      // The ring is behind the disk's near side, which hides it as far as it is opaque.
      ring[y * size + x] = Math.exp(-off * off) * seen;
      if (count > before || dark > 0 || ring[y * size + x] > 0.01) active.push(y * size + x);
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
    depth,
    ring,
    active: Int32Array.from(active),
    sweep,
    around,
    through,
  };
}

/** Light (summed, before toning) below this is not shown over the shadow, fully at `DEPTH` of the shadow's radius in. */
const SHADOW_CUT = 0.18;
const DEPTH = 0.2;
/** The photon ring: this many pixels outside the shadow's edge, this wide (pixels), this bright (summed light, white-warm). */
const RING_AT = 1.6;
const RING_WIDTH = 1.5;
const RING_LIGHT = 1.9;
const RING_COLOUR = [1, 0.93, 0.8];

/**
 * The disk as it has turned by `time`: each crossing's streak, lit, summed and toned so the hottest parts run to white.
 * RGBA, straight (not premultiplied). With `loop` (s), every ring turns a whole number of times in it (the nearest to its
 * own speed, once at the least), so the picture at `loop` is the one at 0.
 */
export function paint(hole: Hole, time: number, loop: number): Uint8ClampedArray {
  const map = streakMap();
  const sum = new Float32Array(hole.size * hole.size * 3);
  for (let h = 0; h < hole.count; h++) {
    const spin = Math.max(1, Math.round(hole.spin[h] * loop)) / loop;
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
    const cut = SHADOW_CUT * hole.depth[k];
    const ring = RING_LIGHT * hole.ring[k];
    const r = tone(Math.max(0, sum[k * 3] - cut) + ring * RING_COLOUR[0]);
    const g = tone(Math.max(0, sum[k * 3 + 1] - cut) + ring * RING_COLOUR[1]);
    const b = tone(Math.max(0, sum[k * 3 + 2] - cut) + ring * RING_COLOUR[2]);
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

// ------------------------------------------------------------------ the white hole ----

/** The light that runs out of the white hole's horizon: how far it gets in a loop (radians of sweep), and its colour: blue where it is faint, burning to white where it is bright. */
const OUTFLOW = 2.2;
const WHITE_COLOUR = [0.55, 0.78, 1.15];

/**
 * The horizon's plasma at `sweep` (radians from the point facing the eye) and `around` (radians round the screen), moved
 * `flow` radians outwards. It is looked up on the horizon as a sphere, so the middle, where every direction meets, has no seam.
 */
function plasma(sweep: number, around: number, flow: number): number {
  const s = sweep - flow;
  const x = Math.sin(s) * Math.cos(around);
  const y = Math.sin(s) * Math.sin(around);
  const z = Math.cos(s);
  // Broad fronts of hot gas, cells inside them, and thin bright filaments; dark lanes between.
  const fronts = smoothstep(0.38, 0.8, fbm(x * 1.7, y * 1.7, z * 1.7, 83, 4));
  const cells = smoothstep(0.42, 0.75, fbm(x * 4.2, y * 4.2, z * 4.2, 89, 3));
  const threads = smoothstep(0.62, 0.9, fbm(x * 9, y * 9, z * 9, 97, 3));
  return 0.25 + 1.5 * fronts * (0.45 + 0.75 * cells) + 0.7 * threads * (0.3 + fronts);
}

/**
 * The white hole: time run backwards, so every path that would fall into the shadow comes out of the horizon instead, and
 * the shadow is filled with the horizon's light. The paths that skim the photon sphere wind round it, so the far side of
 * the horizon shows as thin rings packed at the edge; the plasma runs from the middle out and the rings carry it round.
 * Only the light in the shadow, RGBA, straight; it is added over the black hole's frame, which stays as it is. With `loop`
 * (s), the picture at `loop` is the one at 0: two passes of the flow, a loop apart, are mixed by how far through it is.
 */
export function paintWhite(hole: Hole, time: number, loop: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(hole.size * hole.size * 4);
  const tone = (x: number): number => 1 - Math.exp(-x * 1.4);
  const per = SHADOW / (hole.size / HOLE_SPAN);
  const half = hole.size / 2;
  const mix = time / loop;
  const flow = (OUTFLOW * time) / loop;
  for (const k of hole.active) {
    const shadow = hole.shadow[k];
    if (shadow <= 0) continue;
    const sweep = hole.sweep[k];
    const around = hole.around[k];
    const b = Math.hypot((k % hole.size) + 0.5 - half, Math.floor(k / hole.size) + 0.5 - half) * per;
    const lit = (1 - mix) * plasma(sweep, around, flow) + mix * plasma(sweep, around, flow - OUTFLOW);
    // Hottest in the middle, where the light comes straight at the eye; brighter again where the far side is packed in at the edge.
    const centre = 1 + 4 * (1 - b / SHADOW) ** 2.5;
    const edge = 1 + 0.8 * smoothstep(0.82, 1, b / SHADOW);
    const light = 1.6 * lit * centre * edge * hole.through[k] * shadow;
    const r = tone(light * WHITE_COLOUR[0]);
    const g = tone(light * WHITE_COLOUR[1]);
    const bl = tone(light * WHITE_COLOUR[2]);
    const alpha = Math.max(r, g, bl);
    if (alpha <= 0.002) continue;
    data[k * 4] = (255 * r) / alpha;
    data[k * 4 + 1] = (255 * g) / alpha;
    data[k * 4 + 2] = (255 * bl) / alpha;
    data[k * 4 + 3] = 255 * alpha;
  }
  return data;
}
