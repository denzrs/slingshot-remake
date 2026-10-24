import { fbm } from '../../src/render/noise';
import { rgba } from '../../src/render/color';

/**
 * Six ways the Solar System's sun could look, for choosing between. Every one is the same sun (radius 44, the same
 * seed) drawn by `drawStar` from a style — except the plasma, which is animated per pixel, and the chart sun, which is flat.
 */

const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

type Stops = readonly (readonly [number, number, number, number])[];
function ramp(stops: Stops, t: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, t));
  for (let i = 1; i < stops.length; i++) {
    if (x > stops[i][0]) continue;
    const [t0, r0, g0, b0] = stops[i - 1];
    const [t1, r1, g1, b1] = stops[i];
    const k = (x - t0) / (t1 - t0);
    return [mix(r0, r1, k), mix(g0, g1, k), mix(b0, b1, k)];
  }
  const last = stops[stops.length - 1];
  return [last[1], last[2], last[3]];
}

function cellHash(x: number, y: number, z: number, seed: number): [number, number, number, number] {
  const h = (k: number): number => {
    let n = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647) ^ Math.imul(k + 1, 1440662683) ^ seed;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  };
  return [h(0), h(1), h(2), h(3)];
}

const slot = (seed: number, k: number): number => {
  const h = Math.sin((seed + k * 0.618) * 127.1) * 43758.5453;
  return h - Math.floor(h);
};

// ————————————————————————————————— The face —————————————————————————————————

interface FaceSpec {
  size: number;
  mode: 'worley' | 'ridge';
  /** Granulation cells across the ball (worley) or the scale of the veins (ridge). */
  cells: number;
  /** How dark the seams between cells are. */
  seam: number;
  base: number;
  /** Strength of the fine grain. */
  grain: number;
  ramp: Stops;
  /** Limb darkening: 0 none … 1 the edge goes black; and how quickly it sets in. */
  limb: number;
  limbPow: number;
  /** Sunspots (0 none), faculae near the limb (0 none). */
  spots: number;
  faculae: number;
}

function buildFace(seed: number, spec: FaceSpec): HTMLCanvasElement {
  const N = spec.size;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = N;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(N, N);
  const phase = ((seed % 997) / 997) * Math.PI * 2;
  const [cs, sn] = [Math.cos(phase), Math.sin(phase)];
  for (let py = 0; py < N; py++) {
    for (let px = 0; px < N; px++) {
      const x = ((px + 0.5) / N) * 2 - 1;
      const y = ((py + 0.5) / N) * 2 - 1;
      const rr = Math.hypot(x, y);
      if (rr >= 1) continue;
      const z = Math.sqrt(1 - rr * rr);
      const sx = x * cs + z * sn;
      const sz = -x * sn + z * cs;
      let temp: number;
      if (spec.mode === 'worley') {
        const gx = sx * spec.cells, gy = y * spec.cells, gz = sz * spec.cells;
        let f1 = 9, f2 = 9, tone = 0.5;
        for (let k = -1; k <= 1; k++) for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
          const cx = Math.floor(gx) + i, cy = Math.floor(gy) + j, cz = Math.floor(gz) + k;
          const [hx, hy, hz, ht] = cellHash(cx, cy, cz, seed);
          const d = Math.hypot(cx + hx - gx, cy + hy - gy, cz + hz - gz);
          if (d < f1) { f2 = f1; f1 = d; tone = ht; } else if (d < f2) f2 = d;
        }
        const seam = smooth(0, 0.3, f2 - f1);
        const patch = fbm(sx * 1.9 + 5, y * 1.9, sz * 1.9, seed, 3);
        const grain = fbm(sx * 26, y * 26, sz * 26, seed + 31, 2);
        temp = spec.base + spec.seam * seam + 0.16 * (1 - f1 * 0.7) * (0.5 + 0.5 * tone) + 0.36 * (patch - 0.5) + spec.grain * (grain - 0.5);
      } else {
        // Ridged, warped noise: bright filaments on a dark ground, like the chromosphere in extreme ultraviolet.
        const wx = fbm(sx * 2.2 + 3, y * 2.2, sz * 2.2, seed + 3, 3);
        const wy = fbm(sx * 2.2, y * 2.2 + 8, sz * 2.2, seed + 9, 3);
        const ridge = (k: number, off: number): number => 1 - Math.abs(2 * fbm(sx * k + wx * 2.2 + off, y * k + wy * 2.2, sz * k, seed + 21, 4) - 1);
        const coarse = Math.pow(ridge(spec.cells, 0), 2.2);
        const fine = Math.pow(ridge(spec.cells * 2.6, 5), 3);
        const patch = fbm(sx * 1.6 + 5, y * 1.6, sz * 1.6, seed, 3);
        temp = spec.base + spec.seam * coarse + 0.28 * fine + 0.3 * (patch - 0.5) + spec.grain * (fbm(sx * 24, y * 24, sz * 24, seed + 31, 2) - 0.5);
      }
      if (spec.spots > 0) {
        const n = fbm(sx * 1.5 + 11, y * 1.5, sz * 1.5, seed + 7, 3) + 0.1 * (fbm(sx * 8, y * 8, sz * 8, seed + 3, 2) - 0.5);
        const lo = 0.7 - 0.06 * spec.spots;
        const pen = smooth(lo, lo + 0.06, n);
        const umbra = smooth(lo + 0.06, lo + 0.11, n);
        temp = mix(temp, mix(0.2, 0.03, umbra), pen * 0.92);
      }
      if (spec.faculae > 0) {
        const veins = fbm(sx * 3.4, y * 3.4 + 2, sz * 3.4, seed + 19, 3);
        temp += smooth(0.58, 0.72, veins) * smooth(0.55, 0.95, rr) * spec.faculae;
      }
      temp *= 1 - spec.limb + spec.limb * Math.pow(z, spec.limbPow);
      const [r, g, b] = ramp(spec.ramp, temp);
      const i = (py * N + px) * 4;
      img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b;
      img.data[i + 3] = 255 * smooth(1, 0.985, rr);
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

// ————————————————————————————————— The corona —————————————————————————————————

interface CoronaSpec {
  reach: number;
  size: number;
  /** How strong the rays are, how fast they fade with distance, and the soft glow under them. */
  rays: number;
  falloff: number;
  glow: number;
  /** Colour at the surface and far out. */
  near: readonly [number, number, number];
  far: readonly [number, number, number];
  /** How many rays there are (angular noise frequency). */
  freq: number;
}

function buildCorona(seed: number, spec: CoronaSpec): HTMLCanvasElement {
  const N = spec.size;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = N;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(N, N);
  for (let py = 0; py < N; py++) {
    for (let px = 0; px < N; px++) {
      const u = (((px + 0.5) / N) * 2 - 1) * spec.reach;
      const v = (((py + 0.5) / N) * 2 - 1) * spec.reach;
      const rho = Math.hypot(u, v);
      if (rho >= spec.reach || rho < 0.85) continue;
      const theta = Math.atan2(v, u) + rho * 0.22;
      const c = Math.cos(theta), s = Math.sin(theta);
      const broad = fbm(c * spec.freq * 0.37 + 4, s * spec.freq * 0.37, rho * 0.18, seed + 5, 3);
      const fine = fbm(c * spec.freq, s * spec.freq + 9, rho * 0.35, seed + 13, 3);
      const ray = Math.pow(smooth(0.3, 0.78, broad * 0.65 + fine * 0.35), 1.5);
      const a = Math.min(1, (ray * Math.exp(-(rho - 1) * spec.falloff) * spec.rays + spec.glow * Math.exp(-(rho - 1) * spec.falloff * 1.7)) * smooth(spec.reach, spec.reach * 0.7, rho) * smooth(0.85, 1.05, rho));
      const t = Math.min(1, (rho - 1) / 1.9);
      const i = (py * N + px) * 4;
      img.data[i] = mix(spec.near[0], spec.far[0], t);
      img.data[i + 1] = mix(spec.near[1], spec.far[1], t);
      img.data[i + 2] = mix(spec.near[2], spec.far[2], t);
      img.data[i + 3] = 255 * a;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

// ————————————————————————————————— Styles —————————————————————————————————

interface Style {
  name: string;
  note: string;
  face: FaceSpec;
  corona: CoronaSpec | null;
  coronaAlpha: number;
  glow: readonly (readonly [number, number, string, string])[];
  loops: { n: number; lift: number; width: number; dark: string; mid: string; bright: string } | null;
  chromo: readonly [string, number] | null;
  innerLight: number;
  rim: readonly [string, number];
}

const CURRENT_RAMP: Stops = [[0, 150, 36, 8], [0.28, 232, 84, 14], [0.55, 255, 156, 36], [0.8, 255, 214, 98], [1, 255, 248, 214]];
const PHOTO_RAMP: Stops = [[0, 96, 38, 10], [0.3, 214, 104, 24], [0.62, 255, 178, 72], [0.86, 255, 228, 156], [1, 255, 250, 228]];
const EUV_RAMP: Stops = [[0, 34, 4, 6], [0.28, 140, 18, 10], [0.55, 222, 56, 20], [0.8, 255, 132, 50], [1, 255, 214, 160]];
const GIANT_RAMP: Stops = [[0, 54, 12, 8], [0.35, 150, 36, 14], [0.7, 226, 88, 30], [1, 255, 156, 70]];

const STYLES: Record<string, Style> = {
  aktuell: {
    name: 'Aktuell', note: 'Zum Vergleich: der Stand von jetzt.',
    face: { size: 288, mode: 'worley', cells: 8.6, seam: 0.3, base: 0.46, grain: 0.1, ramp: CURRENT_RAMP, limb: 0.52, limbPow: 0.55, spots: 1, faculae: 0.18 },
    corona: { reach: 3.6, size: 400, rays: 0.9, falloff: 1.1, glow: 0.16, near: [255, 222, 150], far: [214, 74, 26], freq: 4.6 }, coronaAlpha: 1,
    glow: [[7, 0.2, '#ff7a24', '#a82410'], [3.2, 0.42, '#ffb347', '#ff6a1c'], [1.7, 0.5, '#ffe9a8', '#ffa03a']],
    loops: { n: 4, lift: 1, width: 1, dark: '#ff5a1a', mid: '#ff8a2e', bright: '#ffe2a6' },
    chromo: ['#ff4a2c', 0.8], innerLight: 0.34, rim: ['#ffb45a', 0.32],
  },
  foto: {
    name: 'Foto', note: 'Wie in Weißlicht-Aufnahmen: feine Körnung, kräftige Randverdunkelung, kaum Schein.',
    face: { size: 288, mode: 'worley', cells: 15, seam: 0.34, base: 0.5, grain: 0.16, ramp: PHOTO_RAMP, limb: 0.72, limbPow: 0.62, spots: 0.7, faculae: 0.22 },
    corona: { reach: 3.2, size: 400, rays: 0.34, falloff: 1.7, glow: 0.1, near: [255, 240, 214], far: [210, 150, 100], freq: 5.2 }, coronaAlpha: 0.9,
    glow: [[5, 0.09, '#ffd9a0', '#a05a2a'], [2.2, 0.2, '#ffe6bd', '#e0883a']],
    loops: null, chromo: ['#ff7a5a', 0.32], innerLight: 0.1, rim: ['#ffd9a0', 0.12],
  },
  filament: {
    name: 'Filament', note: 'Wie in Ultraviolett-Bildern: dunkle Glut, leuchtende Fäden, große Protuberanzen.',
    face: { size: 288, mode: 'ridge', cells: 3.4, seam: 0.52, base: 0.12, grain: 0.08, ramp: EUV_RAMP, limb: 0.3, limbPow: 0.8, spots: 0, faculae: 0 },
    corona: { reach: 3.6, size: 400, rays: 0.62, falloff: 1.0, glow: 0.1, near: [255, 150, 90], far: [150, 30, 20], freq: 5.4 }, coronaAlpha: 0.95,
    glow: [[6.5, 0.2, '#e0431c', '#7a1408'], [2.6, 0.3, '#ff8a3c', '#c0301a']],
    loops: { n: 7, lift: 1.25, width: 1.1, dark: '#d8301a', mid: '#ff7a2e', bright: '#ffd08a' },
    chromo: ['#ff5a2c', 0.9], innerLight: 0.12, rim: ['#ff8a4a', 0.4],
  },
  riese: {
    name: 'Roter Riese', note: 'Große, träge Zellen, dumpfes Rot, ein staubiger Hof statt Strahlen.',
    face: { size: 288, mode: 'worley', cells: 3.2, seam: 0.4, base: 0.4, grain: 0.1, ramp: GIANT_RAMP, limb: 0.5, limbPow: 0.7, spots: 0.5, faculae: 0 },
    corona: { reach: 3.6, size: 400, rays: 0.0, falloff: 0.7, glow: 0.34, near: [255, 150, 90], far: [150, 40, 20], freq: 3 }, coronaAlpha: 0.9,
    glow: [[8, 0.26, '#c8401a', '#5a1208'], [3, 0.3, '#ee6a2a', '#a82a12']],
    loops: { n: 2, lift: 0.8, width: 1.4, dark: '#a82a12', mid: '#e0602a', bright: '#ffb070' }, chromo: null, innerLight: 0.12, rim: ['#e0702a', 0.24],
  },
};

const faceCache = new Map<string, HTMLCanvasElement>();
const coronaCache = new Map<string, HTMLCanvasElement>();

function drawStar(ctx: CanvasRenderingContext2D, key: string, R: number, seed: number, time: number): void {
  const style = STYLES[key];
  let face = faceCache.get(key);
  if (!face) faceCache.set(key, (face = buildFace(seed, style.face)));
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const [reach, strength, inner, outer] of style.glow) {
    const halo = ctx.createRadialGradient(0, 0, R * 0.7, 0, 0, R * reach);
    halo.addColorStop(0, rgba(inner, Math.min(1, strength)));
    halo.addColorStop(0.35, rgba(outer, strength * 0.3));
    halo.addColorStop(1, rgba(outer, 0));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(0, 0, R * reach, 0, Math.PI * 2);
    ctx.fill();
  }
  if (style.corona) {
    let corona = coronaCache.get(key);
    if (!corona) coronaCache.set(key, (corona = buildCorona(seed, style.corona)));
    const reach = R * style.corona.reach;
    for (const [spin, turn0, strength] of [[0.02, 0, 0.9], [-0.034, 2.1, 0.55]] as const) {
      ctx.save();
      ctx.rotate(time * spin + turn0);
      ctx.globalAlpha = Math.min(1, strength * style.coronaAlpha * (0.82 + 0.18 * Math.sin(time * 0.5 + turn0 * 3)));
      ctx.drawImage(corona, -reach, -reach, reach * 2, reach * 2);
      ctx.restore();
    }
  }
  if (style.loops) {
    const L = style.loops;
    ctx.lineCap = 'round';
    for (let i = 0; i < L.n; i++) {
      const period = 11 + slot(seed, i + 80) * 9;
      const cycle = (time / period + slot(seed, i + 90)) % 1;
      const lift = Math.sin(Math.PI * cycle) ** 1.6;
      if (lift < 0.04) continue;
      const a0 = slot(seed, i + 100) * Math.PI * 2 + Math.floor(time / period + slot(seed, i + 90)) * 2.3;
      const span = 0.3 + slot(seed, i + 110) * 0.45;
            const rise = R * (0.55 + slot(seed, i + 120) * 0.55) * lift * L.lift;
      // An arch hugging the limb: up from one footpoint, over a bump, down at the other.
      const path = (): void => {
        ctx.beginPath();
        for (let k = 0; k <= 28; k++) {
          const u = k / 28;
          const a = a0 + span * u;
          const r = R * 0.97 + rise * Math.pow(Math.sin(Math.PI * u), 0.75);
          const x = Math.cos(a) * r, y = Math.sin(a) * r;
          if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        }
      };
      path(); ctx.strokeStyle = rgba(L.dark, 0.14 * lift); ctx.lineWidth = R * 0.3 * L.width; ctx.stroke();
      path(); ctx.strokeStyle = rgba(L.mid, 0.45 * lift); ctx.lineWidth = R * 0.1 * L.width; ctx.stroke();
      path(); ctx.strokeStyle = rgba(L.bright, 0.4 * lift); ctx.lineWidth = R * 0.035 * L.width; ctx.stroke();
    }
  }
  ctx.globalCompositeOperation = 'source-over';
  if (style.chromo) {
    const [color, alpha] = style.chromo;
    const chromo = ctx.createRadialGradient(0, 0, R * 0.96, 0, 0, R * 1.14);
    chromo.addColorStop(0, rgba(color, 0));
    chromo.addColorStop(0.3, rgba(color, alpha));
    chromo.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = chromo;
    ctx.beginPath();
    ctx.arc(0, 0, R * 1.14, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.save();
  ctx.rotate(time * 0.035);
  ctx.drawImage(face, -R, -R, R * 2, R * 2);
  ctx.rotate(-time * 0.085 - 1.3);
  ctx.globalAlpha = 0.28;
  ctx.drawImage(face, -R, -R, R * 2, R * 2);
  ctx.restore();
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, Math.PI * 2);
  ctx.clip();
  ctx.globalCompositeOperation = 'lighter';
  const core = ctx.createRadialGradient(-R * 0.12, -R * 0.14, 0, 0, 0, R);
  core.addColorStop(0, rgba('#fff4cc', style.innerLight * (0.85 + 0.15 * Math.sin(time * 1.3))));
  core.addColorStop(1, rgba('#ff8a2e', 0));
  ctx.fillStyle = core;
  ctx.fillRect(-R, -R, R * 2, R * 2);
  const rim = ctx.createRadialGradient(0, 0, R * 0.78, 0, 0, R);
  rim.addColorStop(0, rgba(style.rim[0], 0));
  rim.addColorStop(1, rgba(style.rim[0], style.rim[1]));
  ctx.fillStyle = rim;
  ctx.fillRect(-R, -R, R * 2, R * 2);
  ctx.restore();
  ctx.restore();
}

// ————————————————————————————————— Plasma (animated) —————————————————————————————————

const P = 112;
let plasmaCanvas: HTMLCanvasElement | null = null;
const PLASMA_RAMP: Stops = [[0, 120, 26, 8], [0.3, 226, 76, 14], [0.58, 255, 150, 30], [0.82, 255, 214, 90], [1, 255, 248, 200]];

function drawPlasma(ctx: CanvasRenderingContext2D, R: number, seed: number, time: number): void {
  if (!plasmaCanvas) plasmaCanvas = Object.assign(document.createElement('canvas'), { width: P, height: P });
  const pc = plasmaCanvas.getContext('2d')!;
  const img = pc.createImageData(P, P);
  const t = time * 0.16;
  for (let py = 0; py < P; py++) {
    for (let px = 0; px < P; px++) {
      const x = ((px + 0.5) / P) * 2 - 1;
      const y = ((py + 0.5) / P) * 2 - 1;
      const rr = Math.hypot(x, y);
      if (rr >= 1) continue;
      const z = Math.sqrt(1 - rr * rr);
      // A flow field warps a flow field: the gas appears to churn and fold in on itself.
      const qx = fbm(x * 1.9 + t, y * 1.9, z * 1.9, seed, 3);
      const qy = fbm(x * 1.9, y * 1.9 + t * 0.8, z * 1.9 + 4, seed + 7, 3);
      const f = fbm(x * 2.8 + qx * 2.6 + 1.7, y * 2.8 + qy * 2.6 + 9.2, z * 2.8 + t * 0.6, seed + 13, 3);
      let temp = 0.12 + 1.05 * Math.pow(f, 1.4);
      temp *= 0.5 + 0.5 * Math.pow(z, 0.5);
      const [r, g, b] = ramp(PLASMA_RAMP, temp);
      const i = (py * P + px) * 4;
      img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b;
      img.data[i + 3] = 255 * smooth(1, 0.97, rr);
    }
  }
  pc.putImageData(img, 0, 0);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const [reach, strength, inner, outer] of [[6, 0.18, '#ff7a24', '#a82410'], [2.6, 0.36, '#ffb347', '#ff6a1c'], [1.6, 0.4, '#ffe9a8', '#ffa03a']] as const) {
    const halo = ctx.createRadialGradient(0, 0, R * 0.8, 0, 0, R * reach);
    halo.addColorStop(0, rgba(inner, strength));
    halo.addColorStop(0.4, rgba(outer, strength * 0.3));
    halo.addColorStop(1, rgba(outer, 0));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(0, 0, R * reach, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(plasmaCanvas, -R, -R, R * 2, R * 2);
  // A thin bright edge, as if the gas were lit from behind.
  const rim = ctx.createRadialGradient(0, 0, R * 0.86, 0, 0, R * 1.04);
  rim.addColorStop(0, rgba('#ffb45a', 0));
  rim.addColorStop(0.8, rgba('#ffcf7a', 0.35));
  rim.addColorStop(1, rgba('#ffb45a', 0));
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = rim;
  ctx.beginPath();
  ctx.arc(0, 0, R * 1.04, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ————————————————————————————————— Chart sun (flat) —————————————————————————————————

function drawChart(ctx: CanvasRenderingContext2D, R: number, time: number): void {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const halo = ctx.createRadialGradient(0, 0, R * 0.9, 0, 0, R * 3.4);
  halo.addColorStop(0, rgba('#ffc860', 0.34));
  halo.addColorStop(0.45, rgba('#ff9a3a', 0.08));
  halo.addColorStop(1, rgba('#ff9a3a', 0));
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(0, 0, R * 3.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  // Chart marks: a ring of ticks and a dashed orbit, turning slowly, in the plate's bone colour.
  ctx.strokeStyle = rgba('#e8e4d8', 0.55);
  ctx.lineWidth = Math.max(1, R * 0.04);
  ctx.lineCap = 'round';
  for (let i = 0; i < 24; i++) {
    const a = time * 0.05 + (i / 24) * Math.PI * 2;
    const long = i % 3 === 0;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * R * 1.28, Math.sin(a) * R * 1.28);
    ctx.lineTo(Math.cos(a) * R * (long ? 1.62 : 1.45), Math.sin(a) * R * (long ? 1.62 : 1.45));
    ctx.stroke();
  }
  ctx.setLineDash([R * 0.12, R * 0.22]);
  ctx.lineDashOffset = -time * R * 0.1;
  ctx.strokeStyle = rgba('#e8e4d8', 0.3);
  ctx.beginPath();
  ctx.arc(0, 0, R * 1.9, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  // The disc: a flat glow, hot in the middle, with a few faint cell marks.
  const disc = ctx.createRadialGradient(-R * 0.15, -R * 0.15, 0, 0, 0, R);
  disc.addColorStop(0, '#fff3c8');
  disc.addColorStop(0.55, '#ffc65a');
  disc.addColorStop(1, '#ff9430');
  ctx.fillStyle = disc;
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = rgba('#d4661a', 0.22);
  ctx.lineWidth = R * 0.05;
  for (let i = 0; i < 5; i++) {
    const a = time * 0.04 * (i % 2 ? 1 : -1) + i * 1.3;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * R * 0.2, Math.sin(a) * R * 0.2, R * (0.35 + i * 0.14), a, a + 1.1);
    ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = rgba('#fff0cf', 0.9);
  ctx.lineWidth = Math.max(1, R * 0.05);
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

// ————————————————————————————————— The gallery —————————————————————————————————

export interface Variant {
  id: string;
  name: string;
  note: string;
  draw(ctx: CanvasRenderingContext2D, R: number, time: number): void;
}

const SEED = 777;
export const VARIANTS: Variant[] = [
  { id: 'aktuell', name: STYLES.aktuell.name, note: STYLES.aktuell.note, draw: (c, R, t) => drawStar(c, 'aktuell', R, SEED, t) },
  { id: 'foto', name: STYLES.foto.name, note: STYLES.foto.note, draw: (c, R, t) => drawStar(c, 'foto', R, SEED, t) },
  { id: 'filament', name: STYLES.filament.name, note: STYLES.filament.note, draw: (c, R, t) => drawStar(c, 'filament', R, SEED, t) },
  { id: 'plasma', name: 'Plasma', note: 'Fließendes, sich faltendes Gas statt fester Textur. Animiert pro Pixel, also etwas teurer.', draw: (c, R, t) => drawPlasma(c, R, SEED, t) },
  { id: 'karte', name: 'Karte', note: 'Bewusst gezeichnet statt nachgebaut: flach, mit den Skalenstrichen der Sternkarte. Passt zu den Linien im Spiel.', draw: (c, R, t) => drawChart(c, R, t) },
  { id: 'riese', name: STYLES.riese.name, note: STYLES.riese.note, draw: (c, R, t) => drawStar(c, 'riese', R, SEED, t) },
];
