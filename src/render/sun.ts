import type { Planet } from '../physics';
import { rgba } from './color';
import { fbm } from './noise';

const TEX = 288;

const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

/** The colour of the photosphere by temperature (0 cool, 1 hot): ember red, orange, gold, and nearly white in the hottest cells. */
const RAMP: readonly (readonly [number, number, number, number])[] = [
  [0, 150, 36, 8],
  [0.28, 232, 84, 14],
  [0.55, 255, 156, 36],
  [0.8, 255, 214, 98],
  [1, 255, 248, 214],
];
function heat(t: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, t));
  for (let i = 1; i < RAMP.length; i++) {
    if (x > RAMP[i][0]) continue;
    const [t0, r0, g0, b0] = RAMP[i - 1];
    const [t1, r1, g1, b1] = RAMP[i];
    const k = (x - t0) / (t1 - t0);
    return [mix(r0, r1, k), mix(g0, g1, k), mix(b0, b1, k)];
  }
  return [255, 248, 214];
}

/** A cell's random point and brightness: the same for the same grid cube and seed. */
function cellHash(x: number, y: number, z: number, seed: number): [number, number, number, number] {
  const h = (k: number): number => {
    let n = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647) ^ Math.imul(k + 1, 1440662683) ^ seed;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  };
  return [h(0), h(1), h(2), h(3)];
}

/**
 * The sun's face, drawn once per sun, as a ball seen from outside. Granulation: a 3D Worley pattern on the surface,
 * hot bright middles in cool dark seams, so the cells crowd together and squash towards the edge as on a real sphere.
 * Limb darkening reddens and dims the edge. A few sunspots (a dark core in a softer penumbra) and bright faculae
 * near the limb sit on top. Same seed, same face.
 */
function makeFace(seed: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = TEX;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(TEX, TEX);
  const scale = 8.6;
  // Turns the whole ball by a seed's worth, so every sun shows another side.
  const phase = (seed % 997) / 997 * Math.PI * 2;
  const [cs, sn] = [Math.cos(phase), Math.sin(phase)];
  for (let py = 0; py < TEX; py++) {
    for (let px = 0; px < TEX; px++) {
      const x = ((px + 0.5) / TEX) * 2 - 1;
      const y = ((py + 0.5) / TEX) * 2 - 1;
      const rr = Math.hypot(x, y);
      if (rr >= 1) continue;
      const z = Math.sqrt(1 - rr * rr);
      // The surface point, turned about the vertical axis.
      const sx = x * cs + z * sn;
      const sz = -x * sn + z * cs;
      const gx = sx * scale;
      const gy = y * scale;
      const gz = sz * scale;
      let f1 = 9;
      let f2 = 9;
      let tone = 0.5;
      for (let k = -1; k <= 1; k++) {
        for (let j = -1; j <= 1; j++) {
          for (let i = -1; i <= 1; i++) {
            const cx = Math.floor(gx) + i;
            const cy = Math.floor(gy) + j;
            const cz = Math.floor(gz) + k;
            const [hx, hy, hz, ht] = cellHash(cx, cy, cz, seed);
            const d = Math.hypot(cx + hx - gx, cy + hy - gy, cz + hz - gz);
            if (d < f1) {
              f2 = f1;
              f1 = d;
              tone = ht;
            } else if (d < f2) f2 = d;
          }
        }
      }
      const seam = smooth(0, 0.3, f2 - f1);
      // Broad patches of hotter and cooler surface under the cells, and a fine grain over them.
      const patch = fbm(sx * 1.9 + 5, y * 1.9, sz * 1.9, seed, 3);
      const grain = fbm(sx * 24, y * 24, sz * 24, seed + 31, 2);
      let temp = 0.46 + 0.3 * seam + 0.16 * (1 - f1 * 0.7) * (0.5 + 0.5 * tone) + 0.36 * (patch - 0.5) + 0.1 * (grain - 0.5);

      // Sunspots: where a slow noise runs high; finer noise makes the edge ragged.
      const n = fbm(sx * 1.5 + 11, y * 1.5, sz * 1.5, seed + 7, 3) + 0.1 * (fbm(sx * 8, y * 8, sz * 8, seed + 3, 2) - 0.5);
      const pen = smooth(0.64, 0.7, n);
      const umbra = smooth(0.7, 0.75, n);
      temp = mix(temp, mix(0.18, 0.02, umbra), pen * 0.92);

      // Faculae: bright veins in the active zones towards the limb.
      const veins = fbm(sx * 3.4, y * 3.4 + 2, sz * 3.4, seed + 19, 3);
        temp += smooth(0.58, 0.72, veins) * smooth(0.55, 0.95, rr) * 0.18 * (1 - pen);

      // Limb darkening: the edge is seen through more cool gas.
      const mu = z;
      temp *= 0.48 + 0.52 * Math.pow(mu, 0.55);
      const [r, g, b] = heat(temp);
      const i = (py * TEX + px) * 4;
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = 255 * smooth(1, 0.985, rr);
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

const faces = new Map<number, HTMLCanvasElement>();

/** How far the corona sprite reaches, in sun radii, and how many pixels across it is. */
const CORONA_REACH = 3.6;
const CORONA_TEX = 400;

/**
 * The corona, drawn once per sun in polar terms: a soft glow that thins out with distance, and rays of gas along it that
 * bend a little with the distance, from a noise on the angle. White-gold at the surface, orange, then deep red.
 */
function makeCorona(seed: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = CORONA_TEX;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(CORONA_TEX, CORONA_TEX);
  for (let py = 0; py < CORONA_TEX; py++) {
    for (let px = 0; px < CORONA_TEX; px++) {
      const u = (((px + 0.5) / CORONA_TEX) * 2 - 1) * CORONA_REACH;
      const v = (((py + 0.5) / CORONA_TEX) * 2 - 1) * CORONA_REACH;
      const rho = Math.hypot(u, v);
      if (rho >= CORONA_REACH || rho < 0.85) continue;
      // The angle, bent by the distance so the rays curve; read as a circle so there is no seam.
      const bend = rho * 0.22;
      const theta = Math.atan2(v, u) + bend;
      const c = Math.cos(theta);
      const s = Math.sin(theta);
      const broad = fbm(c * 1.7 + 4, s * 1.7, rho * 0.18, seed + 5, 3);
      const fine = fbm(c * 4.6, s * 4.6 + 9, rho * 0.35, seed + 13, 3);
      const ray = Math.pow(smooth(0.3, 0.78, broad * 0.65 + fine * 0.35), 1.5);
      const falloff = Math.exp(-(rho - 1) * 1.1);
      const glow = 0.16 * Math.exp(-(rho - 1) * 1.9);
      const a = Math.min(1, (ray * falloff * 0.9 + glow) * smooth(CORONA_REACH, CORONA_REACH * 0.7, rho) * smooth(0.85, 1.05, rho));
      const t = Math.min(1, (rho - 1) / 1.9);
      const i = (py * CORONA_TEX + px) * 4;
      img.data[i] = mix(255, 214, t);
      img.data[i + 1] = mix(222, 74, t);
      img.data[i + 2] = mix(150, 26, t);
      img.data[i + 3] = 255 * a;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

const coronas = new Map<number, HTMLCanvasElement>();

/** A seeded [0, 1) for one slot of a sun's loose parts (streamers, loops), the same on every screen. */
const slot = (seed: number, k: number): number => {
  const h = Math.sin((seed + k * 0.618) * 127.1) * 43758.5453;
  return h - Math.floor(h);
};

const LOOPS = 4;

/**
 * The sun of the Solar System mode: a boiling granulated ball with a reddish limb and sunspots, a thin pink
 * chromosphere round it, magnetic loops that rise off the surface and fall back, a corona of curving rays, and a wide
 * warm glow. Two copies of the face turn slowly against each other so the cells seem to churn. `flare` (0 → 1) is the
 * storm breaking out: the glow swells, the loops leap high and the disc whitens.
 */
export function drawSun(ctx: CanvasRenderingContext2D, sun: Planet, time: number, alpha = 1, flare = 0): void {
  const R = sun.radius;
  const seed = sun.seed;
  let face = faces.get(seed);
  if (!face) {
    if (faces.size > 8) faces.clear();
    faces.set(seed, (face = makeFace(seed)));
  }
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(sun.x, sun.y);
  ctx.globalCompositeOperation = 'lighter';

  // The glow: a tight bright one under a wide, deeper red one.
  const swell = 1 + flare * 0.9;
  for (const [reach, strength, inner, outer] of [[7, 0.2, '#ff7a24', '#a82410'], [3.2, 0.42, '#ffb347', '#ff6a1c'], [1.7, 0.5, '#ffe9a8', '#ffa03a']] as const) {
    const halo = ctx.createRadialGradient(0, 0, R * 0.7, 0, 0, R * reach * (reach > 3 ? 1 : swell));
    halo.addColorStop(0, rgba(inner, Math.min(1, strength * swell)));
    halo.addColorStop(0.35, rgba(outer, strength * 0.3 * swell));
    halo.addColorStop(1, rgba(outer, 0));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(0, 0, R * reach * swell, 0, Math.PI * 2);
    ctx.fill();
  }

  // The corona: its rays turn slowly, two layers against each other, and swell and ebb.
  let corona = coronas.get(seed);
  if (!corona) {
    if (coronas.size > 8) coronas.clear();
    coronas.set(seed, (corona = makeCorona(seed)));
  }
  const reach = R * CORONA_REACH * (1 + flare * 0.45);
  for (const [spin, turn0, strength] of [[0.02, 0, 0.9], [-0.034, 2.1, 0.55]] as const) {
    ctx.save();
    ctx.rotate(time * spin + turn0);
    ctx.globalAlpha = alpha * Math.min(1, strength * (0.82 + 0.18 * Math.sin(time * 0.5 + turn0 * 3)) * (1 + flare * 0.7));
    ctx.drawImage(corona, -reach, -reach, reach * 2, reach * 2);
    ctx.restore();
  }
  ctx.globalAlpha = alpha;

  // Magnetic loops: arches that rise off the surface, hang there a while, and sink back, each on its own beat.
  ctx.lineCap = 'round';
  for (let i = 0; i < LOOPS; i++) {
    const period = 11 + slot(seed, i + 80) * 9;
    const cycle = (time / period + slot(seed, i + 90)) % 1;
    const life = Math.sin(Math.PI * cycle) ** 1.6;
    const lift = Math.min(1, life + flare * 0.9);
    if (lift < 0.04) continue;
    const a0 = slot(seed, i + 100) * Math.PI * 2 + time * 0.01 + Math.floor(time / period + slot(seed, i + 90)) * 2.3;
    const span = 0.3 + slot(seed, i + 110) * 0.45;
    const a1 = a0 + span;
    const rise = R * (0.55 + slot(seed, i + 120) * 0.55) * lift * (1 + flare);
    const mid = a0 + span / 2;
    const base = (a: number, r: number): [number, number] => [Math.cos(a) * r, Math.sin(a) * r];
    const [x0, y0] = base(a0, R * 0.96);
    const [x1, y1] = base(a1, R * 0.96);
    const [cx0, cy0] = base(a0 + span * 0.12, R + rise * 1.35);
    const [cx1, cy1] = base(a1 - span * 0.12, R + rise * 1.35);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.bezierCurveTo(cx0, cy0, cx1, cy1, x1, y1);
    ctx.strokeStyle = rgba('#ff5a1a', 0.14 * lift);
    ctx.lineWidth = R * 0.34;
    ctx.stroke();
    ctx.strokeStyle = rgba('#ff8a2e', 0.5 * lift);
    ctx.lineWidth = R * 0.12;
    ctx.stroke();
    ctx.strokeStyle = rgba('#ffe2a6', 0.45 * lift);
    ctx.lineWidth = R * 0.04;
    ctx.stroke();
    // A glint where the arch peaks.
    const [px, py] = base(mid, R + rise);
    const spark = ctx.createRadialGradient(px, py, 0, px, py, R * 0.3);
    spark.addColorStop(0, rgba('#fff0c0', 0.55 * lift));
    spark.addColorStop(1, rgba('#ff8a2e', 0));
    ctx.fillStyle = spark;
    ctx.beginPath();
    ctx.arc(px, py, R * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';

  // The chromosphere: a thin pink-red rim just outside the ball.
  const chromo = ctx.createRadialGradient(0, 0, R * 0.96, 0, 0, R * 1.14);
  chromo.addColorStop(0, rgba('#ff3d28', 0));
  chromo.addColorStop(0.3, rgba('#ff4a2c', 0.8));
  chromo.addColorStop(1, rgba('#ff3d28', 0));
  ctx.fillStyle = chromo;
  ctx.beginPath();
  ctx.arc(0, 0, R * 1.14, 0, Math.PI * 2);
  ctx.fill();

  // The face, twice, turning against each other so the cells seem to churn.
  ctx.save();
  ctx.rotate(time * 0.035);
  ctx.drawImage(face, -R, -R, R * 2, R * 2);
  ctx.rotate(-time * 0.085 - 1.3);
  ctx.globalAlpha = alpha * 0.28;
  ctx.drawImage(face, -R, -R, R * 2, R * 2);
  ctx.restore();

  // Light from inside: a hot pulsing middle, a bright thin rim, and in a flare the whole disc whitens.
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, Math.PI * 2);
  ctx.clip();
  ctx.globalCompositeOperation = 'lighter';
  const pulse = 0.85 + 0.15 * Math.sin(time * 1.3);
  const core = ctx.createRadialGradient(-R * 0.12, -R * 0.14, 0, 0, 0, R);
  core.addColorStop(0, rgba('#fff4cc', (0.34 * pulse + flare * 0.5) * alpha));
  core.addColorStop(0.55, rgba('#ffc04a', (0.1 + flare * 0.3) * alpha));
  core.addColorStop(1, rgba('#ff8a2e', 0));
  ctx.fillStyle = core;
  ctx.fillRect(-R, -R, R * 2, R * 2);
  const rim = ctx.createRadialGradient(0, 0, R * 0.78, 0, 0, R);
  rim.addColorStop(0, rgba('#ff7a24', 0));
  rim.addColorStop(1, rgba('#ffb45a', 0.32 * alpha));
  ctx.fillStyle = rim;
  ctx.fillRect(-R, -R, R * 2, R * 2);
  ctx.restore();
  ctx.restore();
}
