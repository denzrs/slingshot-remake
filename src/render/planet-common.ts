import type { Planet } from '../physics';
import { range } from '../rng';

export type Vec3 = [number, number, number];

/** A planet ready to draw. `size` is its width in device pixels; `draw` puts it centred on a point, `ps` device pixels per field unit. */
export interface PlanetSprite {
  size: number;
  draw(ctx: CanvasRenderingContext2D, x: number, y: number, ps: number, time: number): void;
}

/** Light comes from the upper left, slightly in front. */
export const LIGHT: Vec3 = normalize([-0.62, -0.5, 0.6]);

export interface Crater {
  c: Vec3;
  /** Cosine of the crater's angular radius. */
  cosR: number;
  depth: number;
}

export function makeCraters(p: Planet, rng: () => number): Crater[] {
  if (p.style === 'gas') return [];
  const count = p.style === 'rocky' ? 6 + Math.floor(rng() * 8) : 2 + Math.floor(rng() * 3);
  const out: Crater[] = [];
  for (let i = 0; i < count; i++) {
    const c = normalize([rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1]);
    const r = range(rng, 0.12, 0.42) * (i === 0 ? 1.3 : 1);
    out.push({ c, cosR: Math.cos(r), depth: range(rng, 0.25, 0.5) });
  }
  return out;
}

/** Bowl shading with a bright rim, 1 outside every crater. */
export function crater(x: number, y: number, z: number, craters: Crater[]): number {
  let f = 1;
  for (const k of craters) {
    const d = x * k.c[0] + y * k.c[1] + z * k.c[2];
    if (d < k.cosR - 0.02) continue;
    // t: 0 at crater centre, 1 at its rim.
    const t = (1 - d) / (1 - k.cosR);
    if (t < 0.85) f *= 1 - k.depth * (1 - t * 0.6);
    else if (t < 1.15) f *= 1 + 0.25 * (1 - Math.abs(t - 1) / 0.15);
  }
  return f;
}

export function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const mix = (a: number, b: number, t: number) => a + (b - a) * t;
