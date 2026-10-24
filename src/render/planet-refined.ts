import { COLORS } from '../config';
import type { Planet } from '../physics';
import { createRng, range } from '../rng';
import { hexToRgb } from './color';
import { fbm } from './noise';
import { clamp01, mix, smoothstep, type PlanetSprite } from './planet-common';

type Rgb = [number, number, number];

/** A glow past the limb, as a share of the radius. */
const GLOW = 0.22;

const lift = (c: Rgb, to: Rgb, t: number): Rgb => [mix(c[0], to[0], t), mix(c[1], to[1], t), mix(c[2], to[2], t)];
const css = (c: Rgb, a = 1): string => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;

/** How wide the surface strip is next to the planet's radius: it has to be wider than the disc to slide behind it. */
const STRIP = 3.6;
/**
 * A planet in the menus' manner: a plain sphere lit from the upper left (a bright spot sliding into the deep
 * blue of the plate), a thin rim in its own tint and a soft glow round it. On top of that its surface
 * moves — gas giants as bands that run in turn against each other, other planets as mottling drifting slowly
 * round — so the field is never quite still. The sphere and its finish are painted once; only the strip slides.
 */
export function renderRefinedPlanet(p: Planet, ps: number): PlanetSprite {
  const R = p.radius * ps;
  const reach = R * (1 + GLOW);
  const size = Math.ceil(reach * 2 + 4);
  const half = size / 2;
  const rng = createRng(p.seed);
  // The engraved tints are muted paper tones; on a sphere they want a little more colour.
  const raw = hexToRgb(p.tint);
  const gray = (raw[0] + raw[1] + raw[2]) / 3;
  const tint = raw.map((v) => Math.min(255, Math.max(0, gray + (v - gray) * 1.45))) as Rgb;
  const plate = hexToRgb(COLORS.plate);
  const bone = hexToRgb(COLORS.bone);
  const light = lift(tint, bone, 0.4);
  const mid = lift(tint, plate, 0.3);
  const dark = lift(tint, plate, 0.9);

  // Back: the glow and the sphere itself.
  const back = document.createElement('canvas');
  back.width = back.height = size;
  const b = back.getContext('2d')!;
  const glow = b.createRadialGradient(half, half, R * 0.9, half, half, reach);
  glow.addColorStop(0, css(tint, 0.22));
  glow.addColorStop(1, css(tint, 0));
  b.fillStyle = glow;
  b.beginPath();
  b.arc(half, half, reach, 0, Math.PI * 2);
  b.fill();
  const body = b.createRadialGradient(half - R * 0.38, half - R * 0.45, R * 0.05, half, half, R * 1.12);
  body.addColorStop(0, css(light));
  body.addColorStop(0.5, css(mid));
  body.addColorStop(1, css(dark));
  b.fillStyle = body;
  b.beginPath();
  b.arc(half, half, R, 0, Math.PI * 2);
  b.fill();

  // Front: the limb sinks into shadow, and the thin rim.
  const front = document.createElement('canvas');
  front.width = front.height = size;
  const f = front.getContext('2d')!;
  const limb = f.createRadialGradient(half - R * 0.25, half - R * 0.3, R * 0.5, half, half, R);
  limb.addColorStop(0, css(plate, 0));
  limb.addColorStop(1, css(plate, 0.45));
  f.fillStyle = limb;
  f.beginPath();
  f.arc(half, half, R, 0, Math.PI * 2);
  f.fill();
  f.strokeStyle = css(lift(tint, bone, 0.3), 0.5);
  f.lineWidth = Math.max(1, 0.9 * ps);
  f.beginPath();
  f.arc(half, half, R - 0.5 * ps, 0, Math.PI * 2);
  f.stroke();

  // The surface strip: seamless sideways, drawn as light and dark veils over the sphere.
  const gas = p.style === 'gas';
  const W = Math.round(R * STRIP);
  const H = Math.ceil(R * 2);
  const strip = document.createElement('canvas');
  strip.width = W;
  strip.height = H;
  const sctx = strip.getContext('2d')!;
  const img = sctx.createImageData(W, H);
  const veil = lift(tint, bone, 0.62);
  const shade = lift(tint, plate, 0.7);
  const bandFreq = range(rng, 7, 12);
  const seed = p.seed;
  const strength = p.style === 'ice' ? 0.2 : 0.3;
  for (let y = 0; y < H; y++) {
    const lat = (y / H) * 2 - 1;
    const edge = smoothstep(1, 0.7, Math.abs(lat));
    for (let x = 0; x < W; x++) {
      const a = (x / W) * Math.PI * 2;
      const cx = Math.cos(a);
      const cz = Math.sin(a);
      let v: number;
      if (gas) {
        const turb = fbm(cx * 1.5, lat * 1.2, cz * 1.5, seed, 3);
        v = 0.5 + 0.5 * Math.sin(lat * bandFreq + turb * 3.6);
        v = clamp01(v * 0.8 + (turb - 0.5) * 0.8 + 0.1);
      } else {
        v = smoothstep(0.25, 0.8, fbm(cx * 1.9, lat * 1.9, cz * 1.9, seed, 4));
      }
      // Above the middle a light veil, below it a dark one; the middle stays clear.
      const up = clamp01((v - 0.5) * 2);
      const down = clamp01((0.5 - v) * 2);
      const c = up > down ? veil : shade;
      const o = (y * W + x) * 4;
      img.data[o] = c[0];
      img.data[o + 1] = c[1];
      img.data[o + 2] = c[2];
      img.data[o + 3] = 255 * Math.max(up, down) * (up > down ? strength * 0.55 : strength * 1.6) * edge;
    }
  }
  sctx.putImageData(img, 0, 0);

  // Gas giants run in bands, each its own speed and direction; the rest turn as one. Neighbouring bands overlap and
  // fade into each other (the windows of two neighbours always add up to one), so no hard seam shows where they part.
  const rows = gas ? 11 : 1;
  const rowH = H / rows;
  const layers = Array.from({ length: rows }, (_, i) => {
    if (rows === 1) return { canvas: strip, y0: 0 };
    const mid = (i + 0.5) * rowH;
    const y0 = Math.max(0, Math.round(mid - rowH));
    const y1 = Math.min(H, Math.round(mid + rowH));
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = y1 - y0;
    const lctx = canvas.getContext('2d')!;
    lctx.drawImage(strip, 0, y0, W, y1 - y0, 0, 0, W, y1 - y0);
    const window = (yy: number): number => {
      if ((i === 0 && yy < mid) || (i === rows - 1 && yy > mid)) return 1;
      return Math.cos(clamp01(Math.abs(yy - mid) / rowH) * Math.PI * 0.5) ** 2;
    };
    const mask = lctx.createLinearGradient(0, 0, 0, canvas.height);
    for (let k = 0; k <= 16; k++) mask.addColorStop(k / 16, `rgba(0,0,0,${window(y0 + (k / 16) * canvas.height)})`);
    lctx.globalCompositeOperation = 'destination-in';
    lctx.fillStyle = mask;
    lctx.fillRect(0, 0, W, canvas.height);
    return { canvas, y0 };
  });
  const speeds = Array.from({ length: rows }, (_, i) => (gas ? (i % 2 ? -1 : 1) * range(rng, 0.006, 0.014) : 0.005));
  const phase = rng();

  return {
    size,
    draw(ctx, x, y, scale, time) {
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(1 / scale, 1 / scale);
      ctx.drawImage(back, -half, -half);
      ctx.beginPath();
      ctx.arc(0, 0, R, 0, Math.PI * 2);
      ctx.clip();
      for (let i = 0; i < rows; i++) {
        const { canvas, y0 } = layers[i];
        const shift = ((((time * speeds[i] + phase) % 1) + 1) % 1) * W;
        const x0 = -R - shift;
        ctx.drawImage(canvas, x0, -R + y0);
        ctx.drawImage(canvas, x0 + W, -R + y0);
      }
      ctx.restore();
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(1 / scale, 1 / scale);
      ctx.drawImage(front, -half, -half);
      ctx.restore();
    },
  };
}
