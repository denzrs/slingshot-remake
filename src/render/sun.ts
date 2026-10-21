import { COLORS } from '../config';
import type { Planet } from '../physics';
import { rgba } from './color';
import { fbm } from './noise';

const YELLOW = [255, 226, 70] as const;
const PALE = [255, 242, 140] as const;
const AMBER = [255, 140, 20] as const;
const SPOT = [120, 40, 10] as const;
const TEX = 256;

const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

/** A cell's random point and brightness: the same for the same grid square and seed. */
function cellHash(x: number, y: number, seed: number): [number, number, number] {
  const h = (k: number): number => {
    let n = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(k + 1, 1440662683) ^ seed;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  };
  return [h(0), h(1), h(2)];
}

/**
 * The sun's face, drawn once per sun: irregular convection cells (a Worley pattern — bright middles, amber seams)
 * and ragged sunspots with a dark core and a softer penumbra, dimmed towards the limb. Same seed, same face.
 */
function makeFace(seed: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = TEX;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(TEX, TEX);
  const scale = 3.4;
  for (let py = 0; py < TEX; py++) {
    for (let px = 0; px < TEX; px++) {
      const x = ((px + 0.5) / TEX) * 2 - 1;
      const y = ((py + 0.5) / TEX) * 2 - 1;
      const rr = Math.hypot(x, y);
      if (rr > 1) continue;
      // Worley: nearest and second-nearest cell point.
      const gx = x * scale;
      const gy = y * scale;
      let f1 = 9;
      let f2 = 9;
      let tone = 0.5;
      for (let j = -1; j <= 1; j++) {
        for (let i = -1; i <= 1; i++) {
          const cx = Math.floor(gx) + i;
          const cy = Math.floor(gy) + j;
          const [hx, hy, ht] = cellHash(cx, cy, seed);
          const d = Math.hypot(cx + hx - gx, cy + hy - gy);
          if (d < f1) {
            f2 = f1;
            f1 = d;
            tone = ht;
          } else if (d < f2) f2 = d;
        }
      }
      const seam = smooth(0, 0.16, f2 - f1);
      const warm = 0.35 + 0.65 * (1 - f1 * 0.9) * (0.55 + 0.45 * tone);
      let r = mix(AMBER[0], mix(YELLOW[0], PALE[0], warm), seam);
      let g = mix(AMBER[1], mix(YELLOW[1], PALE[1], warm), seam);
      let b = mix(AMBER[2], mix(YELLOW[2], PALE[2], warm), seam);

      // Sunspots: where a slow noise runs high — ragged because finer noise rides on it.
      const n = fbm(x * 1.9 + 3, y * 1.9 + 3, 0.5, seed, 3) + 0.12 * (fbm(x * 9, y * 9, 2, seed, 2) - 0.5);
      const pen = smooth(0.6, 0.67, n);
      const umbra = smooth(0.67, 0.73, n);
      r = mix(r, mix(AMBER[0] * 0.8, SPOT[0], umbra), pen * 0.95);
      g = mix(g, mix(AMBER[1] * 0.5, SPOT[1], umbra), pen * 0.95);
      b = mix(b, mix(AMBER[2] * 0.5, SPOT[2], umbra), pen * 0.95);

      const limb = 1 - 0.15 * rr ** 3;
      const i = (py * TEX + px) * 4;
      img.data[i] = r * limb;
      img.data[i + 1] = g * limb;
      img.data[i + 2] = b * limb;
      img.data[i + 3] = 255 * smooth(1, 0.985, rr);
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

const faces = new Map<number, HTMLCanvasElement>();

/**
 * The sun of the Solar System mode, in the black hole's line-art style: a strong glow, a bright disc with the bone
 * ring just outside it, a few thick arcs of flare and a close corona of dashed rings streaming round it, the inner
 * ones faster. The surface churns: two copies of its face turn slowly against each other.
 */
export function drawSun(ctx: CanvasRenderingContext2D, sun: Planet, time: number, alpha = 1): void {
  const R = sun.radius;
  let face = faces.get(sun.seed);
  if (!face) {
    if (faces.size > 8) faces.clear();
    faces.set(sun.seed, (face = makeFace(sun.seed)));
  }
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(sun.x, sun.y);

  // A strong glow: a tight bright one under a wide one.
  ctx.globalCompositeOperation = 'lighter';
  for (const [reach, strength] of [[6, 0.26], [2.6, 0.55]] as const) {
    const halo = ctx.createRadialGradient(0, 0, R * 0.8, 0, 0, R * reach);
    halo.addColorStop(0, rgba('#ffe03d', strength));
    halo.addColorStop(0.4, rgba('#ff9a1f', strength * 0.3));
    halo.addColorStop(1, rgba('#ff9a1f', 0));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(0, 0, R * reach, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';

  // A close corona of streaming rings (inner = faster), as the hole's accretion disk.
  const rings = 3;
  for (let i = 0; i < rings; i++) {
    const t = i / (rings - 1);
    const r = R * (1.45 + t * 0.55);
    ctx.strokeStyle = rgba(t < 0.4 ? COLORS.bone : COLORS.sodium, 0.6 - t * 0.3);
    ctx.lineWidth = Math.max(0.8, R * (0.1 - t * 0.04));
    ctx.setLineDash([R * (0.6 + t), R * (0.3 + t * 0.5)]);
    ctx.lineDashOffset = -time * (60 / (0.6 + t)) * (R / 34);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;

  // Thick arcs of flare close above the surface, drifting slowly round.
  ctx.lineCap = 'round';
  ctx.strokeStyle = rgba(COLORS.sodium, 0.55);
  ctx.lineWidth = R * 0.2;
  for (let i = 0; i < 3; i++) {
    const a = time * 0.12 + (i * Math.PI * 2) / 3;
    ctx.beginPath();
    ctx.arc(0, 0, R * (1.24 + 0.04 * Math.sin(time * 0.8 + i * 2)), a, a + 0.8);
    ctx.stroke();
  }

  // The face, twice, turning against each other so the cells seem to churn.
  ctx.save();
  ctx.rotate(time * 0.05);
  ctx.drawImage(face, -R, -R, R * 2, R * 2);
  ctx.rotate(-time * 0.11 - 1.3);
  ctx.globalAlpha = alpha * 0.3;
  ctx.drawImage(face, -R, -R, R * 2, R * 2);
  ctx.restore();

  // The glow inside: a hot, pulsing core and a bright rim, added on top of the face.
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, Math.PI * 2);
  ctx.clip();
  ctx.globalCompositeOperation = 'lighter';
  const pulse = 0.85 + 0.15 * Math.sin(time * 1.4);
  const core = ctx.createRadialGradient(0, 0, 0, 0, 0, R);
  core.addColorStop(0, rgba('#fff6c0', 0.5 * pulse * alpha));
  core.addColorStop(0.5, rgba('#ffe03d', 0.22 * alpha));
  core.addColorStop(1, rgba('#ffe03d', 0));
  ctx.fillStyle = core;
  ctx.fillRect(-R, -R, R * 2, R * 2);
  const rim = ctx.createRadialGradient(0, 0, R * 0.7, 0, 0, R);
  rim.addColorStop(0, rgba('#ffb030', 0));
  rim.addColorStop(1, rgba('#ffd060', 0.45 * alpha));
  ctx.fillStyle = rim;
  ctx.fillRect(-R, -R, R * 2, R * 2);
  ctx.restore();

  ctx.strokeStyle = rgba(COLORS.bone, 0.95);
  ctx.lineWidth = Math.max(1, R * 0.07);
  ctx.beginPath();
  ctx.arc(0, 0, R * 1.07, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}
