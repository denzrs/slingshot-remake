import { rgba } from '../color';
import { sunKind, towardsGiant } from '../sun-kinds';
import { drawStormBurst } from '../storm';
import { image } from './forged-assets';
import { onScreen, pixelsOf, shaderDetail } from './forged-gl';

/**
 * Forged's prominences: tall, narrow arches of gas standing on the sun's limb. Each one rises out of the edge, hangs there
 * breathing while knots of plasma drain down both legs, and dissolves where it stands into sparks that drift off; or it
 * erupts, carried outwards already as it rises and fraying into sparks all the way, in one motion; the next one rises
 * somewhere else. The arch is drawn behind the ball, so its legs go down behind the edge, and a bright knot over the
 * edge marks where it stands.
 *
 * All the soft light (the arches' puffs, the knots, the sparks' halos and trails) is painted on two small canvases of its
 * own, behind and in front of the ball, at a fraction of the screen's pixels and `LAYER_HZ` times a second, and laid over
 * the field in one stamp each: a hundred overlapping glows cost the screen two. Only the sparks' tiny hot heads are
 * stamped on the screen itself, every frame, so they stay sharp and move smoothly.
 */
const TAU = Math.PI * 2;
/** How many arches a sun has, each on its own beat, and how many more a red giant grows. */
const ARCHES = 3;
const GIANT_ARCHES = 2;
const slot = (seed: number, k: number): number => {
  const h = Math.sin((seed + k * .618) * 127.1) * 43758.5453;
  return h - Math.floor(h);
};
const smooth = (t: number): number => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

/**
 * How an arch lives, by its temper. An arch never stands and then blows up, nor comes up and pops: either it erupts,
 * one motion from the start, rising and already carried outwards as it rises, shedding sparks all the way and fraying
 * into them as it goes (`ERUPTS`); or it rises slowly, hangs, and dissolves where it stands, its gas thinning into
 * sparks that drift off (`DISSOLVES`).
 * `rise` (s) is how long it takes to stand, `leaves` (s into its life) when it starts to go, `life` when it is gone,
 * `shedding` over how long (s) its sparks come off, `flung` how fast (radii/s) it is carried out, `speed` how fast its
 * sparks fly against a calm arch's, and `sparkLife` how long (s) the longest of them lasts.
 */
export interface Temper {
  rise: number;
  leaves: number;
  life: number;
  shedding: number;
  flung: number;
  speed: number;
  sparkLife: number;
}
export const ERUPTS: Temper = { rise: 1, leaves: .3, life: 3, shedding: 1.9, flung: 1, speed: 1.1, sparkLife: 2.6 };
export const DISSOLVES: Temper = { rise: 1.6, leaves: 3.8, life: 8, shedding: 3.6, flung: 0, speed: .45, sparkLife: 3.6 };
/** How many arches in a hundred erupt. */
const ERUPTING = .2;
/** How quickly the field an arch is flung through slows it. */
const DRAG = 1.1;
/** How far (radii) an arch of `temper` has been flung `t` seconds after it started to go, and how fast it is going then. */
export const flungAt = (t: number, temper: Temper): { out: number; speed: number } =>
  t <= 0 ? { out: 0, speed: 0 } : { out: temper.flung * (1 - Math.exp(-t * DRAG)) / DRAG, speed: temper.flung * Math.exp(-t * DRAG) };

/**
 * An arch `age` seconds into its life: how far it has risen (1 when it stands, more as it is flung out or swells as it
 * thins), how bright it is, and how far it has gone (0 until it starts to go, 1 when it is gone).
 */
export function archAt(age: number, temper: Temper = DISSOLVES): { lift: number; glow: number; away: number } {
  if (age <= 0 || age >= temper.life) return { lift: 0, glow: 0, away: 0 };
  const rise = 1 - (1 - Math.min(1, age / temper.rise)) ** 3;
  const going = (age - temper.leaves) / (temper.life - temper.leaves);
  // Either way it frays evenly as it goes, never all at once.
  const away = smooth(going);
  const breath = .04 * Math.sin(age * 1.7) * (1 - away);
  return { lift: rise * (1 + breath) + (temper.flung > 0 ? .4 : .15) * away, glow: Math.min(1, age / .4) * (1 - away * away), away };
}

/** Where arch `i` of a sun stands at `time`: its footpoints' angles on the limb, its height and lean, and its life. */
export function archOf(seed: number, i: number, time: number, flare: number, giant = 0) {
  const period = 14 + slot(seed, i + 80) * 8;
  // The giant's extra arches stand between the others and are on the off-beat.
  const place = (i % ARCHES + (i >= ARCHES ? .5 : 0)) / ARCHES;
  const cycle = time / period + slot(seed, i + 90) + place;
  const n = Math.floor(cycle);
  const age = (cycle - n) * period;
  // Each new arch stands somewhere else, with a shape and a temper of its own.
  const shape = seed + n * 7.31;
  const temper = slot(shape, i + 150) < ERUPTING ? ERUPTS : DISSOLVES;
  const { lift, glow, away } = archAt(age, temper);
  const at = slot(seed, 100) * TAU + place * TAU + (slot(shape, i + 105) - .5) * 1.4 + time * .01;
  // Narrow at the foot and tall: a loop that reaches far out rather than a wide low bow. Towards a red giant they stand
  // taller, wider and thicker and sway harder, and more of them come up.
  const half = (.12 + slot(shape, i + 110) * .11) * (1 + .45 * giant);
  const present = i < ARCHES ? 1 : smooth(giant * GIANT_ARCHES - (i - ARCHES));
  return {
    from: at - half,
    to: at + half,
    height: (.5 + slot(shape, i + 120) * .45) * Math.max(lift, flare * .9) * (1 + flare * .4) * (1 + .55 * giant),
    // It leans one way (rad at its top) and sways slowly in the field.
    lean: (slot(shape, i + 130) - .5) * .3 + (.07 + .08 * giant) * Math.sin(time * (.6 + .4 * giant) + i * 2.1),
    width: (.7 + slot(shape, i + 140) * .35) * (1 + .35 * giant),
    glow: Math.min(1, glow + flare * .8) * present,
    // How far (radii) it has been flung out since it started to go, legs and all (an eruption only).
    out: age > temper.leaves && age < temper.life ? flungAt(age - temper.leaves, temper).out : 0,
    temper,
    present,
    age,
    away,
  };
}

type Arch = ReturnType<typeof archOf>;
const polar = (a: number, r: number): [number, number] => [Math.cos(a) * r, Math.sin(a) * r];

/** The way (rad) an arch leans out from the sun: the way an eruption carries it. */
const headingOf = (arch: Arch): number => (arch.from + arch.to) / 2 + arch.lean;

/** The arch's curve, in radii: its feet just inside the limb (an eruption carries them off it), nudged by `shift` (rad) and raised by `rise`. */
function curve(arch: Arch, shift = 0, rise = 1): number[] {
  const span = arch.to - arch.from;
  const mid = headingOf(arch);
  const top = 1 + arch.height * 1.33 * rise;
  const [ox, oy] = polar(mid, arch.out);
  const p = [
    ...polar(arch.from + shift, .97),
    ...polar(mid - span * .48 + shift, top),
    ...polar(mid + span * .48 - shift, top),
    ...polar(arch.to - shift, .97),
  ];
  for (let k = 0; k < 8; k += 2) {
    p[k] += ox;
    p[k + 1] += oy;
  }
  return p;
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
const BODY = 28;
const KNOTS = 14;

/** How often (per s) the soft light is painted again, and at what share of the screen's pixels, at most how many across. */
const LAYER_HZ = 24;
const LAYER_SCALE = .5;
const LAYER_LIMIT = 640;
/** How far the layers reach from the middle, in radii: past the tallest arch and most of the sparks' flight. */
export const layerReach = (giant: number): number => 5 + 1.5 * giant;

/** One of a sun's two layers of soft light: its canvas, when it was painted (s) and for which size of sun and canvas. */
interface Layer {
  canvas: HTMLCanvasElement;
  at: number;
  key: string;
}
const layers = new Map<string, Layer>();

/**
 * A sun's layer of soft light behind the ball (`front` false) or over it, painted again when it is older than a beat or the
 * sun has changed size. The two are painted on alternate beats, so no one frame pays for both.
 */
function layerOf(ctx: CanvasRenderingContext2D, seed: number, R: number, time: number, flare: number, giant: number, front: boolean): HTMLCanvasElement {
  const reach = R * layerReach(giant);
  // In steps of 32 pixels, so a sun that swells does not make a new canvas every frame.
  const want = pixelsOf(ctx, reach * 2) * LAYER_SCALE * shaderDetail();
  const size = Math.max(64, Math.min(LAYER_LIMIT, Math.ceil(want / 32) * 32));
  const key = `${size}|${R.toFixed(1)}|${giant.toFixed(2)}`;
  const id = `${seed}|${front}`;
  let layer = layers.get(id);
  if (!layer) {
    if (layers.size > 16) layers.clear();
    layer = { canvas: document.createElement('canvas'), at: -Infinity, key: '' };
    layers.set(id, layer);
  }
  // While the frame is short of time, the light is painted a little less often.
  const every = 1 / (shaderDetail() < 1 ? LAYER_HZ * .67 : LAYER_HZ);
  const stale = layer.key !== key || time < layer.at || time - layer.at >= every;
  if (!stale) return layer.canvas;
  if (layer.canvas.width !== size) layer.canvas.width = layer.canvas.height = size;
  // The front's beat runs half a beat after the back's.
  // (A clock that went back, or a gap of beats, starts the beat again from now.)
  const onBeat = layer.key === key && time >= layer.at && time - layer.at < every * 2;
  layer.at = onBeat ? layer.at + every : time - (front ? every / 2 : 0);
  layer.key = key;
  const k = size / (reach * 2);
  const g = layer.canvas.getContext('2d')!;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  g.clearRect(0, 0, size, size);
  g.setTransform(k, 0, 0, k, size / 2, size / 2);
  g.globalCompositeOperation = 'lighter';
  (front ? paintFront : paintBack)(g, seed, R, time, flare, giant);
  g.globalAlpha = 1;
  return layer.canvas;
}

/** Lays a layer over the field round the sun, at the alpha the sun is drawn with. */
function lay(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, R: number, giant: number): void {
  const reach = R * layerReach(giant);
  ctx.drawImage(canvas, -reach, -reach, reach * 2, reach * 2);
}

/** The arches, behind the ball: a body of soft puffs that swell and thin, knots draining down the legs, two faint threads. */
export function drawForgedProminences(ctx: CanvasRenderingContext2D, seed: number, R: number, time: number, flare: number, giant: number): boolean {
  if (!onScreen(ctx, 0, 0, R * layerReach(giant))) return true;
  lay(ctx, layerOf(ctx, seed, R, time, flare, giant, false), R, giant);
  return true;
}

function paintBack(ctx: CanvasRenderingContext2D, seed: number, R: number, time: number, flare: number, giant: number): void {
  const kind = towardsGiant(sunKind({ seed }), giant);
  const [body, mid, thread] = kind.loops;
  const glow = puff(body, mid);
  const knot = puff(thread);
  ctx.lineCap = 'round';
  for (let i = 0; i < ARCHES + GIANT_ARCHES; i++) {
    const arch = archOf(seed, i, time, flare, giant);
    if (arch.glow < .02 || arch.height < .02) continue;
    const g = arch.glow;
    const w = arch.width;
    const main = curve(arch);
    const own = seed + i * 31;
    // The body: overlapping puffs along the arch, each swelling on its own beat, so it is never an even tube; thinner
    // towards the top, where the gas is stretched. As the arch leaves, its puffs drift apart and outwards and grow thin.
    for (let k = 0; k <= BODY; k++) {
      const t = k / BODY;
      const [x, y, nx, ny] = along(main, t);
      const off = .025 * Math.sin(time * .9 + k * 1.7 + i) + arch.away * (slot(own, k + 320) - .5) * .5;
      const out = 1 + arch.away * .22 * slot(own, k + 330);
      const taper = 1 - .3 * Math.sin(Math.PI * t);
      const r = R * w * (.1 + .06 * slot(own, k + 300)) * taper * (.75 + .25 * Math.sin(time * 1.3 + k * 2.3)) * (1 + .5 * arch.away);
      const px = (x + nx * off) * out * R, py = (y + ny * off) * out * R;
      stamp(ctx, glow, px, py, r * HALO, .5 * g);
    }
    // Knots of plasma draining from the top down both legs, each a little off the field line.
    const pace = .15 + .05 * kind.churn;
    for (let k = 0; k < KNOTS; k++) {
      const phase = (k / KNOTS + time * pace + slot(own, k + 340) * .3) % 1;
      const [x, y, nx, ny] = along(main, k % 2 ? .5 - .5 * phase : .5 + .5 * phase);
      const off = (slot(own, k + 360) - .5) * .07 * w + .02 * Math.sin(time * 2 + k);
      const r = R * w * (.035 + .045 * slot(own, k + 380));
      stamp(ctx, knot, (x + nx * off) * R, (y + ny * off) * R, r, g * (.15 + .22 * slot(own, k + 400)) * Math.min(1, phase * 5));
    }
    // Two faint threads that cross: the field lines the gas is strung on.
    ctx.globalAlpha = 1;
    ctx.strokeStyle = rgba(thread, .16 * g);
    ctx.lineWidth = R * w * .012;
    stroke(ctx, curve(arch, .03, .86), R);
    stroke(ctx, curve(arch, -.025, 1.1), R);
  }
}

/** Over the finished ball: a hot knot where each leg goes down behind the limb, and the sparks a leaving arch bursts into. */
export function drawForgedProminencesFront(ctx: CanvasRenderingContext2D, seed: number, R: number, time: number, flare: number, giant: number): void {
  if (!onScreen(ctx, 0, 0, R * layerReach(giant))) return;
  const layer = layerOf(ctx, seed, R, time, flare, giant, true);
  const base = ctx.globalAlpha;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  lay(ctx, layer, R, giant);
  // The sparks' heads, sharp and moving every frame.
  const hot = puff(towardsGiant(sunKind({ seed }), giant).loops[2]);
  for (let i = 0; i < ARCHES + GIANT_ARCHES; i++) {
    const arch = archOf(seed, i, time, flare, giant);
    if (arch.present <= .02) continue;
    eachMote(seed, i, time, arch.age, giant, arch.temper, (mote, k) => {
      const x = mote.x * R, y = mote.y * R;
      const r = R * mote.size;
      const shimmer = .7 + .3 * Math.sin(time * 6.1 + k * 2.3);
      const a = base * arch.present * mote.fade;
      // White-hot as it leaves; once it has cooled and slowed, its glow on the layer is all there is of it.
      if (mote.heat > COOL) stamp(ctx, hot, x, y, r * (.7 + .6 * mote.heat), Math.min(1, a * (.3 + mote.heat) * shimmer));
    });
  }
  ctx.restore();
}

function paintFront(ctx: CanvasRenderingContext2D, seed: number, R: number, time: number, flare: number, giant: number): void {
  const [body, mid, thread] = towardsGiant(sunKind({ seed }), giant).loops;
  const cloud = puff(body, mid);
  const hot = puff(thread);
  const warm = puff(mid);
  for (let i = 0; i < ARCHES + GIANT_ARCHES; i++) {
    const arch = archOf(seed, i, time, flare, giant);
    if (arch.present > .02) {
      // Each spark's halo, and a trail of where it was a moment ago.
      eachMote(seed, i, time, arch.age, giant, arch.temper, (mote, _, spark, tau) => {
        const x = mote.x * R, y = mote.y * R;
        const r = R * mote.size;
        const a = arch.present * mote.fade;
        stamp(ctx, cloud, x, y, r * HALO * 1.8, .45 * a);
        if (mote.heat <= COOL) stamp(ctx, warm, x, y, r * 1.2, a * (.45 + mote.heat));
        for (const lag of TRAIL) {
          const then = sparkAt(spark, tau - lag, giant);
          if (!then) break;
          stamp(ctx, warm, then.x * R, then.y * R, r * (1.2 - lag * 3), a * (.3 + .7 * then.heat) * (.85 - lag * 4));
        }
      });
    }
    if (arch.glow < .02 || arch.height < .02) continue;
    // Where the legs stand on the limb, until the arch is torn off it.
    const standing = arch.glow * Math.max(0, 1 - arch.out * 5);
    if (standing < .02) continue;
    const r = R * .1 * arch.width * Math.min(1, arch.height * 2);
    for (const a of [arch.from, arch.to]) {
      const [x, y] = polar(a, R * .98);
      stamp(ctx, warm, x, y, r * 1.6, .3 * standing);
      stamp(ctx, hot, x, y, r * .6, .5 * standing);
    }
  }
}

/** How hot a spark still is when it has slowed enough to be painted with the soft light only. */
const COOL = .45;
/** How long ago (s) a spark's trail shows it. */
const TRAIL = [.05, .12] as const;

/** How many sparks an arch bursts into as it leaves, over how long (s) they come off, and how long the longest lasts. */
const MOTES = 72;
/** How many more a red giant's arch bursts into. */
const GIANT_MOTES = 36;


/** What a spark is given when it comes off its arch: where, with which normal, how the arch was moving, and its own dice. */
interface Spark {
  x: number;
  y: number;
  nx: number;
  ny: number;
  /** The way and speed (radii/s) the arch was flung with when it came off: it is carried on with it. */
  cx: number;
  cy: number;
  delay: number;
  life: number;
  side: number;
  bend: number;
  fast: boolean;
  speed: number;
  phase: number;
  size: number;
}
const bursts = new Map<string, Spark[]>();

/**
 * The sparks arch `i` frays into from `snap` (s), when it starts to go, worked out once for them all: where each comes off
 * the arch as the arch was when it left, and its dice. Every frame after that a spark's place is a few sums.
 */
function burstOf(seed: number, i: number, snap: number, giant: number, temper: Temper): Spark[] {
  const key = `${seed}|${i}|${Math.round(snap * 100)}|${temper.flung}`;
  let burst = bursts.get(key);
  if (burst) return burst;
  if (bursts.size > 24) bursts.clear();
  const own = seed + i * 31;
  burst = [];
  for (let k = 0; k < MOTES + GIANT_MOTES; k++) {
    // Most come off at once in the snap, the rest in the moment after.
    // They come off evenly while it goes, not in one burst.
    const delay = temper.shedding * slot(own, k + 500);
    const arch = archOf(seed, i, snap + delay, 0, giant);
    const [x, y, nx, ny] = along(curve(arch), .05 + .9 * slot(own, k + 520));
    const [cx, cy] = polar(headingOf(arch), flungAt(delay, temper).speed);
    // Only an eruption carries some of its sparks out faster.
    const fast = temper.flung > 0 && slot(own, k + 580) < .2;
    burst.push({
      x, y, nx, ny, cx, cy, delay, fast,
      life: temper.sparkLife * (.55 + .45 * slot(own, k + 510)),
      side: slot(own, k + 530) - .5,
      bend: (slot(own, k + 560) - .5) * .3,
      speed: (fast ? .7 + .5 * slot(own, k + 540) : .1 + .35 * slot(own, k + 540) ** 1.3) * temper.speed,
      phase: slot(own, k + 570) * TAU,
      size: fast ? .036 : .022 + .035 * slot(own, k + 550) ** 2,
    });
  }
  bursts.set(key, burst);
  return burst;
}

/**
 * Where spark `k` of arch `i` is, `age` seconds into the arch's life: null before it comes off and after it has thinned
 * away. It comes off in the snap or just after, carried on with the flung arch; its heat is 1 as it leaves the arch and
 * cools to 0; it grows as it spreads out. Most spread round the arch; about one in six is flung out faster.
 */
export function moteOf(seed: number, i: number, k: number, time: number, age: number, giant = 0, temper = archOf(seed, i, time, 0, giant).temper): Mote | null {
  if (age <= temper.leaves) return null;
  const spark = burstOf(seed, i, time - (age - temper.leaves), giant, temper)[k];
  return spark ? sparkAt(spark, age - temper.leaves - spark.delay, giant) : null;
}

type Mote = { x: number; y: number; heat: number; fade: number; size: number };

/** A spark `tau` seconds after it came off its arch. */
function sparkAt(spark: Spark, tau: number, giant: number): Mote | null {
  const life = spark.life;
  if (tau <= 0 || tau >= life) return null;
  // It flies out from the sun, fanned to either side; a red giant's plasma is thrown wider and further, and churns more on its way.
  const { x, y, nx, ny } = spark;
  const r = Math.hypot(x, y) || 1;
  const side = spark.side * 1.2 * (1 + .5 * giant);
  let dx = x / r + nx * side, dy = y / r + ny * side;
  const l = Math.hypot(dx, dy) || 1;
  // The field it is caught in bends its way slowly, and it wanders to and fro across it.
  const bend = spark.bend * tau;
  const c = Math.cos(bend), sn = Math.sin(bend);
  [dx, dy] = [(dx * c - dy * sn) / l, (dx * sn + dy * c) / l];
  const went = spark.speed * (1 + 1.1 * giant) * (1 - Math.exp(-tau * .9)) / .9 + .03 * tau;
  const wander = .035 * (1 + giant) * Math.sin(tau * 1.6 + spark.phase) * Math.min(1, tau);
  const spent = tau / life;
  // Carried on the way the arch was flung, slowing as the arch does.
  const carried = (1 - Math.exp(-tau * DRAG)) / DRAG;
  const px = x + dx * went - dy * wander + spark.cx * carried;
  const py = y + dy * went + dx * wander + spark.cy * carried;
  // It thins away before it leaves the layer its light is painted on.
  const edge = layerReach(giant);
  const rim = smooth((edge - Math.hypot(px, py)) / (edge * .2));
  return {
    x: px,
    y: py,
    heat: 1 - spent,
    fade: Math.min(1, tau * 4) * (1 - spent) ** 1.2 * rim,
    size: spark.size * (1 + 1.2 * spent) * (1 + .5 * giant),
  };
}

/** Calls `paint` for every spark of arch `i` that is in flight, with the spark and how long ago it came off. */
function eachMote(seed: number, i: number, time: number, age: number, giant: number, temper: Temper, paint: (mote: Mote, k: number, spark: Spark, tau: number) => void): void {
  if (age <= temper.leaves || age >= temper.leaves + temper.shedding + temper.sparkLife) return;
  const burst = burstOf(seed, i, time - (age - temper.leaves), giant, temper);
  // A red giant's extra sparks come in one by one as it swells.
  const count = MOTES + GIANT_MOTES * giant;
  for (let k = 0; k < Math.ceil(count); k++) {
    const tau = age - temper.leaves - burst[k].delay;
    const mote = sparkAt(burst[k], tau, giant);
    if (!mote || mote.fade < .01) continue;
    mote.fade *= Math.min(1, count - k);
    paint(mote, k, burst[k], tau);
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
  for (const [delay, speed, turn, strength] of [[0, 560, .13, .55], [.2, 430, -.27, .3]] as const) {
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
