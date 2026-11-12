import { rgba } from '../color';
import { sunKind, towardsGiant } from '../sun-kinds';
import { drawStormBurst } from '../storm';
import { image } from './forged-assets';
import { onScreen } from './forged-gl';

/**
 * Forged's prominences: arches of gas standing on the sun's limb. Each one rises out of the edge, hangs there breathing
 * while knots of plasma drain down both legs, then lifts away and fades; the next one rises somewhere else. The arch is
 * drawn behind the ball, so its legs go down behind the edge, and a bright knot over the edge marks where it stands.
 */
const TAU = Math.PI * 2;
/** How many arches a sun has, each on its own beat, and how many more a red giant grows. */
const ARCHES = 3;
const GIANT_ARCHES = 2;
/** How long an arch lives (s); the rest of its beat it is gone. */
export const ARCH_LIFE = 9;
const slot = (seed: number, k: number): number => {
  const h = Math.sin((seed + k * .618) * 127.1) * 43758.5453;
  return h - Math.floor(h);
};
const smooth = (t: number): number => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

/** When (s into its life) an arch starts to lift away from the sun. */
export const ARCH_LEAVES = 5;

/**
 * An arch `age` seconds into its life: how far it has risen (1 when it hangs, more as it lifts away), how bright it is,
 * and how far it has gone in leaving (0 until it lifts away, 1 when it is gone).
 */
export function archAt(age: number): { lift: number; glow: number; away: number } {
  if (age <= 0 || age >= ARCH_LIFE) return { lift: 0, glow: 0, away: 0 };
  const rise = 1 - (1 - Math.min(1, age / 1.6)) ** 3;
  const away = smooth((age - ARCH_LEAVES) / (ARCH_LIFE - ARCH_LEAVES));
  const breath = .04 * Math.sin(age * 1.7) * (1 - away);
  return { lift: rise * (1 + breath) + .3 * away, glow: Math.min(1, age / .4) * (1 - away), away };
}

/** Where arch `i` of a sun stands at `time`: its footpoints' angles on the limb, its height and lean, and its life. */
export function archOf(seed: number, i: number, time: number, flare: number, giant = 0) {
  const period = 14 + slot(seed, i + 80) * 8;
  // The giant's extra arches stand between the others and are on the off-beat.
  const place = (i % ARCHES + (i >= ARCHES ? .5 : 0)) / ARCHES;
  const cycle = time / period + slot(seed, i + 90) + place;
  const n = Math.floor(cycle);
  const age = (cycle - n) * period;
  const { lift, glow, away } = archAt(age);
  // Each new arch stands somewhere else, with a shape of its own.
  const shape = seed + n * 7.31;
  const at = slot(seed, 100) * TAU + place * TAU + (slot(shape, i + 105) - .5) * 1.4 + time * .01;
  // Towards a red giant they stand taller, wider and thicker and sway harder, and more of them come up.
  const half = (.3 + slot(shape, i + 110) * .25) * (1 + .55 * giant);
  const present = i < ARCHES ? 1 : smooth(giant * GIANT_ARCHES - (i - ARCHES));
  return {
    from: at - half,
    to: at + half,
    height: (.22 + slot(shape, i + 120) * .26) * Math.max(lift, flare * .9) * (1 + flare * .5) * (1 + .6 * giant),
    // It leans one way and sways slowly in the field.
    lean: (slot(shape, i + 130) - .5) * .7 + (.18 + .2 * giant) * Math.sin(time * (.6 + .4 * giant) + i * 2.1),
    width: (.8 + slot(shape, i + 140) * .45) * (1 + .35 * giant),
    glow: Math.min(1, glow + flare * .8) * present,
    present,
    age,
    away,
  };
}

type Arch = ReturnType<typeof archOf>;
const polar = (a: number, r: number): [number, number] => [Math.cos(a) * r, Math.sin(a) * r];

/** The arch's curve, in radii: its feet just inside the limb, nudged by `shift` (rad) and raised by `rise`. */
function curve(arch: Arch, shift = 0, rise = 1): number[] {
  const span = arch.to - arch.from;
  const mid = (arch.from + arch.to) / 2 + arch.lean * span * .5;
  const top = 1 + arch.height * 1.33 * rise;
  return [
    ...polar(arch.from + shift, .97),
    ...polar(mid - span * .36 + shift, top),
    ...polar(mid + span * .36 - shift, top),
    ...polar(arch.to - shift, .97),
  ];
}

function stroke(ctx: CanvasRenderingContext2D, p: readonly number[], R: number): void {
  ctx.beginPath();
  ctx.moveTo(p[0] * R, p[1] * R);
  ctx.bezierCurveTo(p[2] * R, p[3] * R, p[4] * R, p[5] * R, p[6] * R, p[7] * R);
  ctx.stroke();
}

/** The point `t` along the arch's curve, and the unit normal there. */
function along(p: readonly number[], t: number): [number, number, number, number] {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  const dx = 3 * u * u * (p[2] - p[0]) + 6 * u * t * (p[4] - p[2]) + 3 * t * t * (p[6] - p[4]);
  const dy = 3 * u * u * (p[3] - p[1]) + 6 * u * t * (p[5] - p[3]) + 3 * t * t * (p[7] - p[5]);
  const l = Math.hypot(dx, dy) || 1;
  return [a * p[0] + b * p[2] + c * p[4] + d * p[6], a * p[1] + b * p[3] + c * p[5] + d * p[7], -dy / l, dx / l];
}

/** How far a body puff's glow reaches, against its core. */
const HALO = 2.2;
const puffs = new Map<string, HTMLCanvasElement>();

/** A soft round glow of `color`, drawn once and stamped many times; with `core`, a wide glow round a core of that colour. */
function puff(color: string, core?: string): HTMLCanvasElement {
  const key = `${color}|${core ?? ''}`;
  let sprite = puffs.get(key);
  if (!sprite) {
    sprite = document.createElement('canvas');
    sprite.width = sprite.height = 64;
    const g = sprite.getContext('2d')!;
    g.globalCompositeOperation = 'lighter';
    const blob = (c: string, r: number, strength: number) => {
      const glow = g.createRadialGradient(32, 32, 0, 32, 32, r);
      glow.addColorStop(0, rgba(c, strength));
      glow.addColorStop(.25, rgba(c, .55 * strength));
      glow.addColorStop(.6, rgba(c, .12 * strength));
      glow.addColorStop(1, rgba(c, 0));
      g.fillStyle = glow;
      g.fillRect(0, 0, 64, 64);
    };
    if (core) {
      blob(color, 32, .48);
      blob(core, 32 / HALO, 1);
    } else blob(color, 32, 1);
    puffs.set(key, sprite);
  }
  return sprite;
}

function stamp(ctx: CanvasRenderingContext2D, sprite: HTMLCanvasElement, x: number, y: number, r: number, alpha: number): void {
  ctx.globalAlpha = alpha;
  ctx.drawImage(sprite, x - r, y - r, r * 2, r * 2);
}

/** How many puffs make up an arch's body, and how many knots drain down its legs. */
const BODY = 24;
const KNOTS = 14;

/** The arches, behind the ball: a body of soft puffs that swell and thin, knots draining down the legs, two faint threads. */
export function drawForgedProminences(ctx: CanvasRenderingContext2D, seed: number, R: number, time: number, flare: number, giant: number): boolean {
  if (!onScreen(ctx, 0, 0, R * 2.6)) return true;
  const kind = towardsGiant(sunKind({ seed }), giant);
  const [body, mid, thread] = kind.loops;
  const glow = puff(body, mid);
  const knot = puff(thread);
  const base = ctx.globalAlpha;
  ctx.save();
  ctx.lineCap = 'round';
  for (let i = 0; i < ARCHES + GIANT_ARCHES; i++) {
    const arch = archOf(seed, i, time, flare, giant);
    if (arch.glow < .02 || arch.height < .02) continue;
    const g = arch.glow;
    const w = arch.width;
    const main = curve(arch);
    const own = seed + i * 31;
    // The body: overlapping puffs along the arch, each swelling on its own beat, so it is never an even tube.
    // As the arch leaves, its puffs drift apart and outwards and grow thin.
    for (let k = 0; k <= BODY; k++) {
      const [x, y, nx, ny] = along(main, k / BODY);
      const off = .03 * Math.sin(time * .9 + k * 1.7 + i) + arch.away * (slot(own, k + 320) - .5) * .35;
      const out = 1 + arch.away * .18 * slot(own, k + 330);
      const r = R * w * (.1 + .08 * slot(own, k + 300)) * (.75 + .25 * Math.sin(time * 1.3 + k * 2.3)) * (1 + .5 * arch.away);
      const px = (x + nx * off) * out * R, py = (y + ny * off) * out * R;
      stamp(ctx, glow, px, py, r * HALO, base * .42 * g);
    }
    // Knots of plasma draining from the top down both legs, each a little off the field line.
    const pace = .15 + .05 * kind.churn;
    for (let k = 0; k < KNOTS; k++) {
      const phase = (k / KNOTS + time * pace + slot(own, k + 340) * .3) % 1;
      const [x, y, nx, ny] = along(main, k % 2 ? .5 - .5 * phase : .5 + .5 * phase);
      const off = (slot(own, k + 360) - .5) * .09 * w + .02 * Math.sin(time * 2 + k);
      const r = R * w * (.04 + .05 * slot(own, k + 380));
      stamp(ctx, knot, (x + nx * off) * R, (y + ny * off) * R, r, base * g * (.2 + .3 * slot(own, k + 400)) * Math.min(1, phase * 5));
    }
    // Two faint threads that cross: the field lines the gas is strung on.
    ctx.globalAlpha = base;
    ctx.strokeStyle = rgba(thread, .16 * g);
    ctx.lineWidth = R * w * .012;
    stroke(ctx, curve(arch, .05, .82), R);
    stroke(ctx, curve(arch, -.04, 1.12), R);
  }
  ctx.restore();
  return true;
}

/** Over the finished ball: a hot knot where each leg goes down behind the limb, and the plasma a leaving arch breaks into. */
export function drawForgedProminencesFront(ctx: CanvasRenderingContext2D, seed: number, R: number, time: number, flare: number, giant: number): void {
  if (!onScreen(ctx, 0, 0, R * 2.6)) return;
  const [body, mid, thread] = towardsGiant(sunKind({ seed }), giant).loops;
  const cloud = puff(body, mid);
  const hot = puff(thread);
  const warm = puff(mid);
  const base = ctx.globalAlpha;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < ARCHES + GIANT_ARCHES; i++) {
    const arch = archOf(seed, i, time, flare, giant);
    if (arch.present > .02) drawMotes(ctx, seed, i, R, time, arch.age, giant, cloud, hot, base * arch.present);
    if (arch.glow < .02 || arch.height < .02) continue;
    const r = R * .1 * arch.width * Math.min(1, arch.height * 3);
    for (const a of [arch.from, arch.to]) {
      const [x, y] = polar(a, R * .98);
      stamp(ctx, warm, x, y, r * 1.6, base * .3 * arch.glow);
      stamp(ctx, hot, x, y, r * .6, base * .5 * arch.glow);
    }
  }
  ctx.restore();
}

/** How many motes of plasma an arch breaks into as it leaves, over how long (s) they come off, and how long the longest lasts. */
const MOTES = 48;
/** How many more a red giant's arch breaks into. */
const GIANT_MOTES = 40;
const SHEDDING = 3.4;
const MOTE_LIFE = 4.2;

/**
 * Where mote `k` of arch `i` is, `age` seconds into the arch's life: null before it comes off and after it has thinned
 * away. Its heat is 1 as it leaves the arch and cools to 0; it grows as it spreads out.
 */
export function moteOf(seed: number, i: number, k: number, time: number, age: number, giant = 0): { x: number; y: number; heat: number; fade: number; size: number } | null {
  const own = seed + i * 31;
  const tau = age - ARCH_LEAVES - SHEDDING * slot(own, k + 500);
  const life = MOTE_LIFE * (.6 + .4 * slot(own, k + 510));
  if (tau <= 0 || tau >= life) return null;
  // It comes off the arch as the arch was then and drifts out from the sun, fanned to either side.
  const [x, y, nx, ny] = along(curve(archOf(seed, i, time - tau, 0, giant)), .05 + .9 * slot(own, k + 520));
  const r = Math.hypot(x, y) || 1;
  // A red giant's plasma is thrown wider and further, and churns more on its way.
  const side = (slot(own, k + 530) - .5) * 1.2 * (1 + .5 * giant);
  let dx = x / r + nx * side, dy = y / r + ny * side;
  const l = Math.hypot(dx, dy) || 1;
  // The field it is caught in bends its way slowly, and it wanders to and fro across it.
  const bend = (slot(own, k + 560) - .5) * .3 * tau;
  const c = Math.cos(bend), sn = Math.sin(bend);
  [dx, dy] = [(dx * c - dy * sn) / l, (dx * sn + dy * c) / l];
  const v0 = (.1 + .3 * slot(own, k + 540) ** 1.3) * (1 + 1.2 * giant);
  const went = v0 * (1 - Math.exp(-tau * .9)) / .9 + .03 * tau;
  const wander = .035 * (1 + giant) * Math.sin(tau * 1.6 + slot(own, k + 570) * TAU) * Math.min(1, tau);
  const spent = tau / life;
  return {
    x: x + dx * went - dy * wander,
    y: y + dy * went + dx * wander,
    heat: 1 - spent,
    fade: Math.min(1, tau * 2.5) * (1 - spent) ** 1.2,
    size: (.018 + .03 * slot(own, k + 550) ** 2) * (1 + 1.4 * spent) * (1 + .5 * giant),
  };
}

/** The plasma a leaving arch breaks into: soft glowing motes that drift off, shimmer, cool and thin away. */
function drawMotes(ctx: CanvasRenderingContext2D, seed: number, i: number, R: number, time: number, age: number, giant: number, cloud: HTMLCanvasElement, hot: HTMLCanvasElement, base: number): void {
  if (age <= ARCH_LEAVES || age >= ARCH_LEAVES + SHEDDING + MOTE_LIFE) return;
  // A red giant's extra motes come in one by one as it swells.
  const count = MOTES + GIANT_MOTES * giant;
  for (let k = 0; k < Math.ceil(count); k++) {
    const mote = moteOf(seed, i, k, time, age, giant);
    if (!mote) continue;
    mote.fade *= Math.min(1, count - k);
    const r = R * mote.size;
    const x = mote.x * R, y = mote.y * R;
    const shimmer = .7 + .3 * Math.sin(time * 5.3 + k * 2.3);
    stamp(ctx, cloud, x, y, r * HALO * 1.4, base * .3 * mote.fade);
    stamp(ctx, hot, x, y, r * .7, base * .75 * mote.fade * mote.heat * shimmer);
  }
}

/** The storm's expanding volume of hot gas: two cached texture stamps in place of the engraved shock rings. */
export function drawForgedStormBurst(ctx: CanvasRenderingContext2D, sun: { x: number; y: number; radius: number }, age: number): void {
  if (age <= 0 || age >= 1.8) return;
  const front = image('sunFront');
  if (!front) {
    drawStormBurst(ctx, sun, age);
    return;
  }
  ctx.save();
  ctx.translate(sun.x, sun.y);
  ctx.globalCompositeOperation = 'lighter';
  const base = ctx.globalAlpha;
  for (const [delay, speed, turn, strength] of [[0, 560, .13, .82], [.2, 430, -.27, .48]] as const) {
    const t = age - delay;
    if (t <= 0 || t >= 1.6) continue;
    const r = (sun.radius * 1.2 + t * speed * (1 - .35 * t / 1.6)) / .81;
    if (!onScreen(ctx, 0, 0, r)) continue;
    ctx.save();
    ctx.rotate(turn + t * .06);
    ctx.globalAlpha = base * strength * (1 - t / 1.6) ** 2;
    ctx.drawImage(front, -r, -r, r * 2, r * 2);
    ctx.restore();
  }
  ctx.restore();
}

/** Begin loading the storm's texture before the first storm. */
export function warmSunEruptions(): void {
  image('sunFront');
}
