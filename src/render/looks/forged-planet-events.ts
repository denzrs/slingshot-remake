import type { Planet } from '../../sim/physics';
import { createRng, range } from '../../sim/rng';
import { clamp01, LIGHT, smoothstep } from '../planet-common';

/**
 * Meteors striking a lava world now and then, drawn over its sphere like the lightning of a gas giant: a streak, a flash, a
 * ring of dust, impact melt cooling, and a crater that fades. It follows from the seed and the time, so every screen shows
 * the same strike at the same moment, and it sits on the surface: a crater turns away with the planet as it turns.
 */

/** How the planet's surface lies, as the shader turns it: the seed's spin and tilt, and how fast it turns (turns per second). */
export interface Surface {
  spin: number;
  tilt: number;
  rate: number;
}

/** A point of the unit sphere as seen on the disc: across, down and towards the eye. */
interface Seen {
  dx: number;
  dy: number;
  nz: number;
}

/** A place of the surface (map longitude in turns, map latitude 0 → 1) as it lies on the disc at `time`. The inverse of the shader's `mapAt`. */
function onDisc(s: Surface, u: number, v: number, time: number): Seen {
  const lon = (u - time * s.rate - 0.5) * Math.PI * 2;
  const lat = (v - 0.5) * Math.PI;
  const ty = Math.sin(lat);
  const tx = Math.cos(lat) * Math.sin(lon);
  const tzz = Math.cos(lat) * Math.cos(lon);
  const cs = Math.cos(s.spin);
  const sn = Math.sin(s.spin);
  const ct = Math.cos(s.tilt);
  const st = Math.sin(s.tilt);
  const tz = tx * sn + tzz * cs;
  return { dx: tx * cs - tzz * sn, dy: ty * ct - tz * st, nz: ty * st + tz * ct };
}

/** The place of the surface under a point of the disc (dx, dy) at `time`: the shader's `mapAt`, turned with the surface. */
function onMap(s: Surface, dx: number, dy: number, time: number): { u: number; v: number } {
  const nz = Math.sqrt(Math.max(0, 1 - dx * dx - dy * dy));
  const ct = Math.cos(s.tilt);
  const st = Math.sin(s.tilt);
  const cs = Math.cos(s.spin);
  const sn = Math.sin(s.spin);
  const ty = dy * ct + nz * st;
  const tz = -dy * st + nz * ct;
  const tx = dx * cs + tz * sn;
  const tzz = -dx * sn + tz * cs;
  return { u: Math.atan2(tx, tzz) / (Math.PI * 2) + 0.5 + time * s.rate, v: 0.5 + Math.asin(Math.max(-1, Math.min(1, ty))) / Math.PI };
}

/** How the sun lights a point of the sphere (−1 → 1). */
const lightOn = (n: Seen): number => n.dx * LIGHT[0] + n.dy * LIGHT[1] + n.nz * LIGHT[2];

/** A number 0 → 1 that a planet, a beat and a key always give the same. */
function hash(seed: number, beat: number, key: number): number {
  const h = Math.sin((seed * 0.000123 + beat * 7.31 + key * 1.97) * 127.1) * 43758.5453;
  return h - Math.floor(h);
}

// ------------------------------------------------------------------ meteors ----

/** How long the streak falls before it strikes, the flash, the melt cooling and the crater fading (s). */
const STREAK = 0.35;
const FLASH = 0.45;
const COOL = 5.6;
const CRATER = 28;

/** A planet's meteor strikes: how often (s between beats) and where in its beat the first one falls. */
export interface Meteors {
  every: number;
  offset: number;
}

/** How often a lava world is struck (only lava worlds are: the caller bakes meteors for no other). */
export function rollMeteors(p: Planet): Meteors {
  const rng = createRng(p.seed ^ 0x5bd1e995);
  return { every: range(rng, 11, 19), offset: rng() };
}

/**
 * The strikes on a planet of radius R at (x, y): every one still showing, the oldest first, each where it struck on the
 * surface. Only some beats bring a strike, so they do not come like clockwork.
 */
export function drawMeteors(ctx: CanvasRenderingContext2D, x: number, y: number, p: Planet, s: Surface, m: Meteors, time: number): void {
  const R = p.radius;
  const now = time / m.every + m.offset;
  const last = Math.floor(now);
  // A strike falls up to 0.85 of the way into its beat and shows until its crater is gone.
  const back = Math.ceil(CRATER / m.every + 0.85);
  for (let beat = last - back; beat <= last + 1; beat++) {
    if (hash(p.seed, beat, 0) < 0.3) continue;
    // Somewhere in the beat, so two strikes are never the same distance apart.
    const at = (beat + 0.15 + 0.7 * hash(p.seed, beat, 1) - m.offset) * m.every;
    const age = time - at;
    if (age < -STREAK || age > CRATER) continue;
    // Where it falls, chosen on the face turned to us when it falls, and kept on the surface after.
    const a = hash(p.seed, beat, 2) * Math.PI * 2;
    const d = 0.75 * Math.sqrt(hash(p.seed, beat, 3));
    const spot = onMap(s, Math.cos(a) * d, Math.sin(a) * d, at);
    const n = onDisc(s, spot.u, spot.v, time);
    const size = R * (0.07 + 0.08 * hash(p.seed, beat, 4));
    const from = hash(p.seed, beat, 5) * Math.PI * 2;
    if (age < 0) drawStreak(ctx, x, y, R, n, from, 1 + age / STREAK);
    else drawStrike(ctx, x, y, R, n, size, age);
  }
}

/** The meteor coming in, `k` (0 → 1) of the way down to the point `n` on the sphere, from the side `from`. */
function drawStreak(ctx: CanvasRenderingContext2D, x: number, y: number, R: number, n: Seen, from: number, k: number): void {
  if (n.nz <= 0) return;
  const tx = x + n.dx * R;
  const ty = y + n.dy * R;
  const reach = R * 0.9 * (1 - k);
  const hx = tx + Math.cos(from) * reach;
  const hy = ty + Math.sin(from) * reach;
  const tail = R * 0.45;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const line = ctx.createLinearGradient(hx, hy, hx + Math.cos(from) * tail, hy + Math.sin(from) * tail);
  line.addColorStop(0, 'rgba(255,240,210,0.9)');
  line.addColorStop(1, 'rgba(255,170,90,0)');
  ctx.strokeStyle = line;
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(0.6, R * 0.025);
  ctx.beginPath();
  ctx.moveTo(hx, hy);
  ctx.lineTo(hx + Math.cos(from) * tail, hy + Math.sin(from) * tail);
  ctx.stroke();
  ctx.restore();
}

/** What a strike leaves at `age` seconds: the flash, a ring of dust running out, melt glowing and cooling, the crater. */
function drawStrike(ctx: CanvasRenderingContext2D, x: number, y: number, R: number, n: Seen, size: number, age: number): void {
  if (n.nz <= 0.02) return;
  const cx = x + n.dx * R;
  const cy = y + n.dy * R;
  // Seen on a slant the crater is squashed towards the middle of the disc: its long axis runs along the limb.
  const turn = Math.atan2(n.dy, n.dx);
  const squash = Math.max(0.12, n.nz);
  const lit = clamp01(lightOn(n));
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, R * 0.995, 0, Math.PI * 2);
  ctx.clip();
  ctx.translate(cx, cy);
  ctx.rotate(turn);
  ctx.scale(squash, 1);

  // The crater: a dark bowl, its rim catching the light on the side away from the sun (the bowl's far wall faces it).
  const fade = smoothstep(0, 0.6, age) * (1 - smoothstep(CRATER * 0.6, CRATER, age));
  if (fade > 0) {
    const bowl = ctx.createRadialGradient(0, 0, 0, 0, 0, size);
    bowl.addColorStop(0, `rgba(8,6,6,${0.55 * fade})`);
    bowl.addColorStop(0.75, `rgba(14,10,10,${0.4 * fade})`);
    bowl.addColorStop(1, 'rgba(14,10,10,0)');
    ctx.fillStyle = bowl;
    ctx.beginPath();
    ctx.arc(0, 0, size, 0, Math.PI * 2);
    ctx.fill();
    // The light's direction in the crater's own frame, so the bright rim lands on the right side.
    const lx = LIGHT[0] * Math.cos(turn) + LIGHT[1] * Math.sin(turn);
    const ly = -LIGHT[0] * Math.sin(turn) + LIGHT[1] * Math.cos(turn);
    const facing = Math.atan2(-ly, -lx / squash);
    ctx.strokeStyle = `rgba(255,236,210,${0.45 * fade * (0.15 + 0.85 * lit)})`;
    ctx.lineWidth = Math.max(0.5, size * 0.18);
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.92, facing - 1.2, facing + 1.2);
    ctx.stroke();
  }

  ctx.globalCompositeOperation = 'lighter';
  // Melt: white-hot at first, cooling through orange to a dull red, and never quite going out while the crater shows.
  const cool = age / COOL;
  const melt = Math.max(1 - smoothstep(0, 1, cool), 0.25 * fade);
  if (melt > 0) {
    const r = size * 0.8;
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    const hot = 1 - clamp01(cool);
    g.addColorStop(0, `rgba(255,${Math.round(120 + 120 * hot)},${Math.round(40 + 160 * hot * hot)},${0.9 * melt})`);
    g.addColorStop(0.6, `rgba(230,70,20,${0.45 * melt})`);
    g.addColorStop(1, 'rgba(200,40,10,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // The dust thrown out: a ring running out over the surface and thinning.
  const wave = age / 1.1;
  if (wave < 1) {
    ctx.strokeStyle = `rgba(255,220,180,${0.35 * (1 - wave)})`;
    ctx.lineWidth = Math.max(0.5, size * 0.25 * (1 - wave));
    ctx.beginPath();
    ctx.arc(0, 0, size * (1 + 3.2 * Math.sqrt(wave)), 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();

  // The flash lights the planet round it, not squashed: it is light, not ground.
  if (age < FLASH) {
    const f = Math.sin((1 - age / FLASH) * Math.PI * 0.5) ** 2;
    const r = R * 0.55;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, R * 0.97, 0, Math.PI * 2);
    ctx.clip();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `rgba(255,250,235,${0.95 * f})`);
    g.addColorStop(0.15, `rgba(255,214,150,${0.5 * f})`);
    g.addColorStop(1, 'rgba(255,170,90,0)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    ctx.restore();
  }
}
