import type { Planet } from '../../sim/physics';
import { createRng, range } from '../../sim/rng';
import { clamp01, LIGHT, smoothstep } from '../planet-common';

/**
 * What happens on a planet's surface in the forged look, drawn over its sphere like the lightning of a gas giant: meteors
 * striking a lava world (a streak, a flash, a ring of dust, melt cooling, a crater that fades), its volcanoes and an icy
 * moon's geysers, a desert's dust storms, an ocean's hurricanes, the glints of carbon and crystal, a machine world's trains
 * of light, heat haze over molten rock, and the scars shots leave. It all follows from the seed
 * and the time, so every screen shows the same at the same moment, and what lies on the surface turns away with it.
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

// ------------------------------------------------------------------- plumes ----

/** Where a world's vents stand on its map, how often one goes off (s between beats), and what it throws up. */
export interface Vents {
  spots: { u: number; v: number }[];
  every: number;
  offset: number;
  /** Ash and fire (a lava world's volcano), or a jet of ice (a cryovolcano's geyser). */
  kind: 'ash' | 'ice';
}

/** How long a plume stands (s), by kind. */
const PLUME_LIFE = { ash: 7, ice: 4.5 };

/**
 * A lava world's volcanoes, anywhere off its poles, or an icy moon's geysers along the fissures round its south pole (the
 * lower part of the map, where `render_planets.py` draws its stripes).
 */
export function rollVents(p: Planet, kind: Vents['kind']): Vents {
  const rng = createRng(p.seed ^ 0x2c1b3c6d);
  const spots = Array.from({ length: kind === 'ash' ? 5 : 7 }, () => ({ u: rng(), v: kind === 'ash' ? range(rng, 0.25, 0.75) : range(rng, 0.8, 0.93) }));
  return { spots, every: kind === 'ash' ? range(rng, 9, 15) : range(rng, 3.5, 6), offset: rng(), kind };
}

/**
 * The plumes standing now: a column off the vent along the surface's normal, so one near the middle of the disc is seen from
 * above as a spreading cloud and one near the limb stands up off it, and one just round the back shows only above the limb.
 */
export function drawPlumes(ctx: CanvasRenderingContext2D, x: number, y: number, p: Planet, s: Surface, vents: Vents, time: number): void {
  const R = p.radius;
  const life = PLUME_LIFE[vents.kind];
  const now = time / vents.every + vents.offset;
  const last = Math.floor(now);
  for (let beat = last - Math.ceil(life / vents.every); beat <= last; beat++) {
    if (hash(p.seed, beat, 10) < 0.25) continue;
    const at = (beat + 0.6 * hash(p.seed, beat, 11) - vents.offset) * vents.every;
    const age = time - at;
    if (age < 0 || age > life) continue;
    const spot = vents.spots[Math.floor(hash(p.seed, beat, 12) * vents.spots.length)];
    const n = onDisc(s, spot.u, spot.v, time);
    if (n.nz < -0.35) continue;
    drawPlume(ctx, x, y, R, n, age / life, vents.kind, hash(p.seed, beat, 13));
  }
}

function drawPlume(ctx: CanvasRenderingContext2D, x: number, y: number, R: number, n: Seen, k: number, kind: Vents['kind'], seed: number): void {
  const ash = kind === 'ash';
  const lit = clamp01(lightOn(n));
  // It rises fast and spreads, then thins away.
  const rise = 1 - (1 - Math.min(1, k * 2.2)) ** 2;
  const fade = 1 - smoothstep(0.55, 1, k);
  const height = R * (ash ? 0.45 : 0.6) * rise;
  const puffs = ash ? 9 : 12;
  ctx.save();
  for (let i = 0; i < puffs; i++) {
    const t = (i + 0.5) / puffs;
    const h = height * t;
    // Off to the side a little as it rises: the wind, and the plume's own churn.
    const drift = (Math.sin(seed * 40 + i * 1.7) * 0.3 + (ash ? 0.25 : 0.05)) * h * 0.5;
    const px = x + n.dx * (R + h) - n.dy * drift;
    const py = y + n.dy * (R + h) + n.dx * drift;
    // What is round the back shows only where it stands clear of the limb.
    if (n.nz < 0 && Math.hypot(px - x, py - y) < R) continue;
    const r = R * (ash ? 0.05 + 0.1 * t : 0.04 + 0.08 * t) * (0.6 + 0.4 * rise);
    const a = fade * (ash ? 0.55 : 0.65) * (1 - t * 0.6);
    const g = ctx.createRadialGradient(px, py, 0, px, py, r);
    if (ash) {
      const shade = 40 + 60 * lit;
      g.addColorStop(0, `rgba(${shade + 10},${shade},${shade - 6},${a})`);
      g.addColorStop(1, `rgba(${shade},${shade - 6},${shade - 10},0)`);
    } else {
      const shade = 150 + 105 * lit;
      g.addColorStop(0, `rgba(${shade},${Math.min(255, shade + 8)},255,${a})`);
      g.addColorStop(1, `rgba(${shade},${shade},255,0)`);
    }
    ctx.fillStyle = g;
    ctx.fillRect(px - r, py - r, r * 2, r * 2);
  }
  // At the vent, fire under the ash: it lights the plume's foot from below.
  if (ash && n.nz > 0) {
    const vx = x + n.dx * R;
    const vy = y + n.dy * R;
    const r = R * 0.12;
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(vx, vy, 0, vx, vy, r);
    const heat = (1 - smoothstep(0.1, 0.9, k)) * 0.8;
    g.addColorStop(0, `rgba(255,190,90,${heat})`);
    g.addColorStop(0.4, `rgba(240,90,20,${heat * 0.5})`);
    g.addColorStop(1, 'rgba(200,40,10,0)');
    ctx.fillStyle = g;
    ctx.fillRect(vx - r, vy - r, r * 2, r * 2);
  }
  ctx.restore();
}

// --------------------------------------------------------------- dust storms ----

/** A desert world's dust storms: how often a beat comes round (s), and where in it the first is. */
export interface Dust {
  every: number;
  offset: number;
}

const DUST_LIFE = 16;

export function rollDust(p: Planet): Dust {
  const rng = createRng(p.seed ^ 0x68e31da4);
  return { every: range(rng, 20, 30), offset: rng() };
}

/** A storm front of dust sweeping round a desert world: a wall of tan cloud along a latitude, rolling east as it grows and settles. */
export function drawDust(ctx: CanvasRenderingContext2D, x: number, y: number, p: Planet, s: Surface, d: Dust, time: number): void {
  const R = p.radius;
  const now = time / d.every + d.offset;
  const last = Math.floor(now);
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, R * 0.995, 0, Math.PI * 2);
  ctx.clip();
  for (let beat = last - Math.ceil(DUST_LIFE / d.every); beat <= last; beat++) {
    if (hash(p.seed, beat, 20) < 0.2) continue;
    const at = (beat + 0.5 * hash(p.seed, beat, 21) - d.offset) * d.every;
    const age = time - at;
    if (age < 0 || age > DUST_LIFE) continue;
    const k = age / DUST_LIFE;
    const strength = smoothstep(0, 0.2, k) * (1 - smoothstep(0.6, 1, k));
    const v0 = 0.3 + 0.4 * hash(p.seed, beat, 22);
    const u0 = hash(p.seed, beat, 23) + k * 0.12;
    const span = 0.1 + 0.15 * smoothstep(0, 0.5, k);
    const puffs = 16;
    for (let i = 0; i < puffs; i++) {
      const t = i / (puffs - 1);
      const wobble = Math.sin(t * 9 + beat) * 0.03;
      const n = onDisc(s, u0 + (t - 0.5) * span, v0 + wobble + (hash(p.seed, beat * 31 + i, 24) - 0.5) * 0.05, time);
      if (n.nz <= 0) continue;
      const lit = 0.25 + 0.75 * clamp01(lightOn(n));
      const r = R * (0.12 + 0.08 * hash(p.seed, beat * 17 + i, 25)) * (0.6 + 0.4 * strength);
      const px = x + n.dx * R;
      const py = y + n.dy * R;
      const a = 0.4 * strength * smoothstep(0, 0.3, n.nz) * (1 - Math.abs(t - 0.5));
      const g = ctx.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, `rgba(${Math.round(225 * lit)},${Math.round(178 * lit)},${Math.round(120 * lit)},${a})`);
      g.addColorStop(1, `rgba(${Math.round(225 * lit)},${Math.round(178 * lit)},${Math.round(120 * lit)},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(px - r, py - r, r * 2, r * 2);
    }
  }
  ctx.restore();
}

// ---------------------------------------------------------------- hurricanes ----

/** An ocean world's great storms: where each sits on the map, how big it is (radii) and which way it winds. */
export type Storms = { u: number; v: number; size: number; turn: number }[];

/** One or two, off the equator; they wind the other way in the other hemisphere. */
export function rollStorms(p: Planet): Storms {
  const rng = createRng(p.seed ^ 0x1b873593);
  return Array.from({ length: rng() < 0.5 ? 1 : 2 }, () => {
    const north = rng() < 0.5;
    return { u: rng(), v: north ? range(rng, 0.28, 0.4) : range(rng, 0.6, 0.72), size: range(rng, 0.14, 0.22), turn: north ? 1 : -1 };
  });
}

/** Each storm: arms of white cloud winding in to a clear eye, lying on the surface (squashed towards the limb) and turning slowly. */
export function drawStorms(ctx: CanvasRenderingContext2D, x: number, y: number, p: Planet, s: Surface, storms: Storms, time: number): void {
  const R = p.radius;
  for (const st of storms) {
    // They wander west a little faster than the ground turns.
    const n = onDisc(s, st.u - time * 0.002, st.v, time);
    if (n.nz <= 0.05) continue;
    const lit = 0.15 + 0.85 * clamp01(lightOn(n));
    const size = st.size * R;
    const turn = Math.atan2(n.dy, n.dx);
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, R * 0.995, 0, Math.PI * 2);
    ctx.clip();
    ctx.translate(x + n.dx * R, y + n.dy * R);
    ctx.rotate(turn);
    ctx.scale(Math.max(0.15, n.nz), 1);
    ctx.rotate(time * 0.25 * st.turn);
    const a = 0.55 * lit * smoothstep(0.05, 0.35, n.nz);
    ctx.lineCap = 'round';
    const shade = Math.round(255 * (0.3 + 0.7 * lit));
    for (let arm = 0; arm < 3; arm++) {
      ctx.beginPath();
      for (let k = 0; k <= 24; k++) {
        const t = k / 24;
        const r = size * (0.18 + 0.82 * t);
        const a0 = (arm / 3) * Math.PI * 2 + st.turn * t * 3.2;
        if (k === 0) ctx.moveTo(Math.cos(a0) * r, Math.sin(a0) * r);
        else ctx.lineTo(Math.cos(a0) * r, Math.sin(a0) * r);
      }
      ctx.strokeStyle = `rgba(${shade},${shade},${shade},${a})`;
      ctx.lineWidth = size * 0.22;
      ctx.stroke();
    }
    // The bank round the eye.
    ctx.strokeStyle = `rgba(${shade},${shade},${shade},${a})`;
    ctx.lineWidth = size * 0.16;
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.22, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

// -------------------------------------------------------------------- glints ----

/** Points of a surface that flash as they turn to mirror the sun: diamonds in carbon, a crystal's facets. */
export interface Glints {
  spots: { u: number; v: number; tilt: [number, number, number]; phase: number }[];
  /** How sharp a flash is (higher: shorter), how big (radii) and its colour. */
  power: number;
  size: number;
  colour: [number, number, number];
}

export function rollGlints(p: Planet, crystal: boolean, colour: [number, number, number]): Glints {
  const rng = createRng(p.seed ^ 0x7f4a7c15);
  const spots = Array.from({ length: crystal ? 26 : 44 }, () => ({
    u: rng(),
    v: range(rng, 0.08, 0.92),
    tilt: [range(rng, -0.5, 0.5), range(rng, -0.5, 0.5), range(rng, -0.5, 0.5)] as [number, number, number],
    phase: rng() * Math.PI * 2,
  }));
  return crystal ? { spots, power: 60, size: 0.16, colour } : { spots, power: 140, size: 0.08, colour };
}

/** Each glint whose facet mirrors the light towards the eye just now: a four-pointed star and a small halo. */
export function drawGlints(ctx: CanvasRenderingContext2D, x: number, y: number, p: Planet, s: Surface, g: Glints, time: number): void {
  const R = p.radius;
  // The direction halfway between the light and the eye: a facet facing it sends the sun to us.
  const hl = Math.hypot(LIGHT[0], LIGHT[1], LIGHT[2] + 1);
  const hx = LIGHT[0] / hl;
  const hy = LIGHT[1] / hl;
  const hz = (LIGHT[2] + 1) / hl;
  const [cr, cg, cb] = g.colour;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  for (const spot of g.spots) {
    const n = onDisc(s, spot.u, spot.v, time);
    if (n.nz <= 0.05) continue;
    const fx = n.dx + spot.tilt[0];
    const fy = n.dy + spot.tilt[1];
    const fz = n.nz + spot.tilt[2];
    const fl = Math.hypot(fx, fy, fz) || 1;
    const facing = Math.max(0, (fx * hx + fy * hy + fz * hz) / fl);
    // A slow shimmer on top, so a glint that holds still a while still lives.
    const f = facing ** g.power * (0.75 + 0.25 * Math.sin(time * 5 + spot.phase)) * smoothstep(0.05, 0.3, n.nz);
    if (f < 0.02) continue;
    const px = x + n.dx * R;
    const py = y + n.dy * R;
    const len = R * g.size * (0.4 + 0.6 * f);
    ctx.strokeStyle = `rgba(${cr},${cg},${cb},${0.9 * f})`;
    ctx.lineWidth = Math.max(0.35, R * 0.012);
    ctx.beginPath();
    ctx.moveTo(px - len, py);
    ctx.lineTo(px + len, py);
    ctx.moveTo(px, py - len);
    ctx.lineTo(px, py + len);
    ctx.stroke();
    const r = len * 0.6;
    const halo = ctx.createRadialGradient(px, py, 0, px, py, r);
    halo.addColorStop(0, `rgba(255,255,255,${0.8 * f})`);
    halo.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
    ctx.fillStyle = halo;
    ctx.fillRect(px - r, py - r, r * 2, r * 2);
  }
  ctx.restore();
}

// ------------------------------------------------------------ running lights ----

/**
 * A machine world's trains of light: lanes round its latitudes, where the trains run east or west, and lanes along its
 * meridians, where they run from pole to pole. Each lane is where it lies (a latitude, or a longitude in turns), and each
 * train where it starts and how fast it runs (turns, or pole to pole, per second).
 */
export type Lanes = { across: boolean; at: number; trains: { from: number; speed: number }[] }[];

export function rollLanes(p: Planet): Lanes {
  const rng = createRng(p.seed ^ 0x3c6ef372);
  const train = (fast: number, slow: number) => ({ from: rng(), speed: (rng() < 0.5 ? -1 : 1) * range(rng, fast, slow) });
  const across = Array.from({ length: 6 }, (_, i) => ({ across: true, at: 0.2 + (i + range(rng, 0.2, 0.8)) * (0.6 / 6), trains: Array.from({ length: 3 }, () => train(0.03, 0.07)) }));
  const along = Array.from({ length: 6 }, (_, i) => ({ across: false, at: (i + range(rng, 0.2, 0.8)) / 6, trains: Array.from({ length: 2 }, () => train(0.05, 0.1)) }));
  return [...across, ...along];
}

/** Where on the map a train's point is, `back` behind its head: round a latitude it wraps; along a meridian it runs between the poles' rings of plating. */
function laneAt(lane: Lanes[number], head: number, back: number): { u: number; v: number } {
  if (lane.across) return { u: head - back, v: lane.at };
  const k = head - back;
  return { u: lane.at, v: 0.08 + 0.84 * (k - Math.floor(k)) };
}

/** Each train: a bright head and a trail behind it, amber, strongest on the night side where the plating is dark. */
export function drawLanes(ctx: CanvasRenderingContext2D, x: number, y: number, p: Planet, s: Surface, lanes: Lanes, time: number): void {
  const R = p.radius;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  for (const lane of lanes) {
    for (const train of lane.trains) {
      const head = train.from + time * train.speed;
      // A train along a meridian fades in and out at the poles, where it wraps round to start again.
      const k = head - Math.floor(head);
      const ends = lane.across ? 1 : smoothstep(0, 0.08, k) * smoothstep(1, 0.92, k);
      let prev: Seen | null = null;
      for (let step = 0; step <= 6; step++) {
        const back = Math.sign(train.speed) * step * (lane.across ? 0.012 : 0.02);
        // Along a meridian the trail stops at the pole it came from, instead of wrapping round to the other.
        if (!lane.across && (k - back < 0 || k - back > 1)) break;
        const at = laneAt(lane, head, back);
        const n = onDisc(s, at.u, at.v, time);
        if (prev && n.nz > 0.02 && prev.nz > 0.02) {
          const night = 0.3 + 0.7 * smoothstep(0.1, -0.3, lightOn(n));
          const a = Math.min(1, (1 - step / 7) * night * ends * smoothstep(0.02, 0.25, n.nz));
          ctx.strokeStyle = `rgba(255,${Math.round(170 + 50 * (1 - step / 6))},90,${a})`;
          ctx.lineWidth = Math.max(0.5, R * (step === 1 ? 0.04 : 0.025));
          ctx.beginPath();
          ctx.moveTo(x + prev.dx * R, y + prev.dy * R);
          ctx.lineTo(x + n.dx * R, y + n.dy * R);
          ctx.stroke();
        }
        prev = n;
      }
    }
  }
  ctx.restore();
}

// ------------------------------------------------------------------ shimmer ----

/** Heat haze over a molten world's limb: thin rings of warm light just off the disc, wavering. */
export function drawShimmer(ctx: CanvasRenderingContext2D, x: number, y: number, R: number, seed: number, time: number): void {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const steps = 72;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    for (let k = 0; k <= steps; k++) {
      const a = (k / steps) * Math.PI * 2;
      const r = R * (1.012 + 0.014 * i + 0.007 * Math.sin(a * (6 + i * 3) + time * (2.2 + i) + seed + i) * Math.sin(a * 3 - time * 1.3 + i));
      if (k === 0) ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      else ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    ctx.strokeStyle = `rgba(255,${140 - i * 25},60,${0.11 - i * 0.03})`;
    ctx.lineWidth = Math.max(0.5, R * 0.018);
    ctx.stroke();
  }
  ctx.restore();
}

// --------------------------------------------------------------------- scars ----

/**
 * Where a shot struck a planet, kept on its surface as it turns: a burn that glows a moment, then a dark scorch that heals
 * over in `life` seconds. `at` is the struck point as it lay on the disc when it struck (x, y in radii).
 */
export function drawScar(ctx: CanvasRenderingContext2D, x: number, y: number, R: number, s: Surface, at: { x: number; y: number }, age: number, life: number, time: number): void {
  const spot = onMap(s, at.x, at.y, time - age);
  const n = onDisc(s, spot.u, spot.v, time);
  if (n.nz <= 0.02) return;
  const size = R * 0.13;
  const heal = 1 - smoothstep(life * 0.4, life, age);
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, R * 0.995, 0, Math.PI * 2);
  ctx.clip();
  ctx.translate(x + n.dx * R, y + n.dy * R);
  ctx.rotate(Math.atan2(n.dy, n.dx));
  ctx.scale(Math.max(0.12, n.nz), 1);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, size);
  g.addColorStop(0, `rgba(10,8,8,${0.6 * heal})`);
  g.addColorStop(0.6, `rgba(20,14,12,${0.35 * heal})`);
  g.addColorStop(1, 'rgba(20,14,12,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, size, 0, Math.PI * 2);
  ctx.fill();
  const ember = 1 - smoothstep(0, 4, age);
  if (ember > 0) {
    ctx.globalCompositeOperation = 'lighter';
    const e = ctx.createRadialGradient(0, 0, 0, 0, 0, size * 0.6);
    e.addColorStop(0, `rgba(255,${Math.round(140 + 100 * ember)},60,${0.8 * ember})`);
    e.addColorStop(1, 'rgba(220,60,10,0)');
    ctx.fillStyle = e;
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
