import { COLORS, FANS } from '../../sim/config';
import { rgba } from '../color';
import { drawEngravedShuttlePod, flash } from './escape-pod';
import { LIGHT } from '../planet-common';
import { painted } from './forged-assets';
import { drawCastShadow } from './forged-planet';
import { forgedFrame } from './forged-sky';
import type { PodFlight } from './painter';

/**
 * Forged's escape pod: a mini shuttle of the ship's make (Einfach's pod in the round: a rounded fuselage, two short
 * swept wings, the ship's canopy and nozzles), rendered in Blender (`scripts/forged/render_pods.py`, 'mini') at a slant
 * from above and painted in the player's colour, like the UFO. As it turns to fly, the render shows it from the
 * heading it is on (one frame of a sheet of them), so it turns in the round; its two nozzles fire behind it, harder the
 * harder it pushes, with a soft halo round it and the beacon on its back a light that glows into the dark.
 */

const TAU = Math.PI * 2;

/** The UFO's render, drawn this wide in the pod's own frame (the renderer scales the frame up a little more). */
const SPAN = 24;
/** The UFO's render frames 2 world units; a world unit is this much of the frame. */
const UNIT = SPAN / 2;

/**
 * The mini ship's sheet, as `render_pods.py` makes it: how many headings and frames to a row, the world units a frame
 * spans and the angle it is seen at (degrees above the horizon); how big a world unit is drawn in the pod's frame
 * (a little over half a ship); its nozzles' mouths and its beacon on the model, in world units (x ahead, y to the left,
 * z up); the halo's reach and the beacon's glow, in the pod's frame.
 */
const MINI = {
  FRAMES: 32, COLUMNS: 8, VIEW: 3.0, ELEVATION: 60, UNIT: 5.5,
  NOZZLES: [[-0.86, 0.11, 0.04], [-0.86, -0.11, 0.04]] as const,
  BULB: [-0.3, 0, 0.27] as const,
  HALO: 13, GLOW: 4.5,
} as const;
const SEEN = Math.sin((MINI.ELEVATION * Math.PI) / 180);
const RISE = Math.cos((MINI.ELEVATION * Math.PI) / 180);

/** Where a point on the model at `turn` (the frame's heading) lands in the pod's frame, as the camera sees it. */
function onScreen(p: readonly [number, number, number], turn: number): [number, number] {
  const c = Math.cos(turn);
  const s = Math.sin(turn);
  // Turned clockwise on the screen (y down), as the render turns it.
  const x = p[0] * c + p[1] * s;
  const y = -p[0] * s + p[1] * c;
  return [x * MINI.UNIT, -(y * SEEN + p[2] * RISE) * MINI.UNIT];
}

/**
 * How a pod or UFO throws its shadow on a planet it flies over, as a moon does: how high over the ground it flies
 * (field units) and how wide its shadow is against its drawn size (the shuttle's wings are thin, a saucer is flat).
 */
const SHADOW = { HEIGHT: 16, POD: 0.55, UFO: 0.5 } as const;

/**
 * The shadow of the pod or UFO drawn in this frame on every planet under it, as a moon's falls: from where the light
 * comes (the sun a planet turns to, otherwise the field's light, upright on the screen). `size` is how wide it is
 * drawn, in its own frame. Drawn before it, on the planets, which are drawn before all of them.
 */
/** The field's transform turned back, worked out once a frame for every pod and UFO in it. */
const fieldInverse = new WeakMap<object, DOMMatrix>();

function shadowOnPlanets(ctx: CanvasRenderingContext2D, size: number): void {
  const frame = forgedFrame();
  if (!frame || !frame.planets.length) return;
  const m = ctx.getTransform();
  const field = frame.field;
  let toField = fieldInverse.get(frame);
  if (!toField) fieldInverse.set(frame, (toField = field.inverse()));
  // Where it is in field units, without a point object for each.
  const ax = toField.a * m.e + toField.c * m.f + toField.e;
  const ay = toField.b * m.e + toField.d * m.f + toField.f;
  const at = { x: ax, y: ay };
  // Its size in field units: its frame against the field's.
  const radius = (size / 2) * (Math.hypot(m.a, m.b) / Math.hypot(field.a, field.b));
  const flat = Math.hypot(LIGHT[0], LIGHT[1]);
  const sun = frame.suns[0];
  for (const p of frame.planets) {
    const dx = at.x - p.x;
    const dy = at.y - p.y;
    const reach = p.radius + SHADOW.HEIGHT * 1.6 + radius;
    if (dx * dx + dy * dy > reach * reach) continue;
    let lx: number;
    let ly: number;
    if (sun) {
      // A planet in a Solar System turns its lit side to its sun.
      const a = Math.atan2(sun.y - p.y, sun.x - p.x);
      lx = Math.cos(a) * flat;
      ly = Math.sin(a) * flat;
    } else {
      // The field's light is upright on the screen, however the field is turned.
      lx = toField.a * LIGHT[0] + toField.c * LIGHT[1];
      ly = toField.b * LIGHT[0] + toField.d * LIGHT[1];
      const l = Math.hypot(lx, ly) || 1;
      lx = (lx / l) * flat;
      ly = (ly / l) * flat;
    }
    const z = Math.sqrt(Math.max(0, p.radius * p.radius - dx * dx - dy * dy)) + SHADOW.HEIGHT;
    ctx.save();
    ctx.setTransform(field);
    drawCastShadow(ctx, p.x, p.y, p.radius, { x: dx, y: dy, z }, radius, [lx, ly, LIGHT[2]]);
    ctx.restore();
  }
}

export function drawForgedPod(ctx: CanvasRenderingContext2D, color: string, time: number, flight: PodFlight): void {
  const sheet = painted('podMini', 'podMiniMask', color);
  // Until the render has loaded, Einfach's shuttle stands in.
  if (!sheet) return drawEngravedShuttlePod(ctx, color, time, flight);
  shadowOnPlanets(ctx, 2 * MINI.UNIT * SHADOW.POD);
  const { phase, beacon } = flight;
  // The frame whose nose points where it flies on the screen: seen at a slant, a heading across the screen is squeezed,
  // so the model's own heading is opened out again before the nearest frame is taken.
  const step = (Math.PI * 2) / MINI.FRAMES;
  const model = Math.atan2(Math.sin(flight.heading) / SEEN, Math.cos(flight.heading));
  const k = ((Math.round(model / step) % MINI.FRAMES) + MINI.FRAMES) % MINI.FRAMES;
  const turn = k * step;
  // The frame is up to half a step off the heading: turned that last bit flat on the screen, it turns smoothly instead
  // of in steps, and the next frame takes over where the two meet.
  const shown = Math.atan2(Math.sin(turn) * SEEN, Math.cos(turn));
  ctx.rotate(Math.atan2(Math.sin(flight.heading - shown), Math.cos(flight.heading - shown)));
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = beacon ? 0.2 : 0.06;
  ctx.drawImage(underglow(color), -MINI.HALO, -MINI.HALO, MINI.HALO * 2, MINI.HALO * 2);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  // Its jets blow out behind it, as long as the camera sees that way: in front of the hull when its tail is towards us.
  const [bx, by] = onScreen([-1, 0, 0], turn);
  const out = Math.atan2(by, bx);
  const reach = Math.hypot(bx, by) / MINI.UNIT;
  const jets = () => {
    if (flight.thrust < 0.04) return;
    for (const [i, nozzle] of MINI.NOZZLES.entries()) {
      const [x, y] = onScreen(nozzle, turn);
      booster(ctx, x, y, out, flight.thrust, time, phase + i, reach);
    }
  };
  if (by < 0) jets();
  // A pod whose bet is lost has gone dark.
  if (!beacon) ctx.globalAlpha = 0.55;
  const px = sheet.width / MINI.COLUMNS;
  const side = MINI.VIEW * MINI.UNIT;
  ctx.drawImage(sheet, (k % MINI.COLUMNS) * px, Math.floor(k / MINI.COLUMNS) * px, px, px, -side / 2, -side / 2, side, side);
  ctx.globalAlpha = 1;
  if (by >= 0) jets();
  const on = beacon ? flash(time, phase) : 0;
  if (on > 0) {
    const [x, y] = onScreen(MINI.BULB, turn);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = on;
    ctx.drawImage(bulbGlow(), x - MINI.GLOW, y - MINI.GLOW, MINI.GLOW * 2, MINI.GLOW * 2);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
}

/** A jet's flame, drawn once: a white-hot core in a sodium plume, a unit long and wide, blowing out along +x from 0. */
let jetSprite: HTMLCanvasElement | null = null;
const JET = { PX: 64, HALF: 0.5 } as const;
function jetFlame(): HTMLCanvasElement {
  if (jetSprite) return jetSprite;
  jetSprite = Object.assign(document.createElement('canvas'), { width: JET.PX, height: JET.PX / 2 });
  const g = jetSprite.getContext('2d')!;
  g.setTransform(JET.PX, 0, 0, JET.PX / 2, 0, JET.PX / 4);
  g.globalCompositeOperation = 'lighter';
  for (const { reach, half, from, alpha } of [
    { reach: 1, half: 0.5, from: COLORS.sodium, alpha: 0.7 },
    { reach: 0.5, half: 0.25, from: COLORS.bone, alpha: 0.95 },
  ]) {
    const jet = g.createLinearGradient(0, 0, reach, 0);
    jet.addColorStop(0, rgba(from, alpha));
    jet.addColorStop(1, rgba(from, 0));
    g.fillStyle = jet;
    g.beginPath();
    g.moveTo(0, -half);
    g.quadraticCurveTo(reach * 0.5, -half * 0.7, reach, 0);
    g.quadraticCurveTo(reach * 0.5, half * 0.7, 0, half);
    g.closePath();
    g.fill();
  }
  return jetSprite;
}

/** One jet at (x, y), blowing out along `out`: `push` (0 → 1) long and bright, `reach` of that as seen, flickering. */
function booster(ctx: CanvasRenderingContext2D, x: number, y: number, out: number, push: number, time: number, phase: number, reach = 1): void {
  const flicker = 0.75 + 0.25 * Math.sin(time * 37 + phase * 3) * Math.sin(time * 23 + phase);
  const len = (1.5 + 6 * push) * flicker * reach;
  const wide = 1.6 + 0.8 * push;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(out);
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.5 + 0.5 * push;
  ctx.drawImage(jetFlame(), 0, -wide / 2, len, wide);
  ctx.restore();
}

/**
 * The spectators' UFO: how big it is drawn, how it hovers (field units, a second's turns) and rocks (radians), the
 * angle it was rendered at (degrees above the horizon), and its rim lights as `render_pods.py` placed them (how many,
 * how far out and how high in world units), how fast the light runs round them (lights a second), how many
 * lights its afterglow trails and how early (in lights) the next one starts to come up.
 */
const UFO = { SIZE: 0.7, HOVER: 1.2, HOVER_SPEED: 2, ROCK: 0.06, VIEW: 25, LIGHTS: 8, RIM: 0.5, RIM_HEIGHT: 0.05, RUN: 6, TRAIL: 2.5, RISE: 0.3 } as const;

/** A rim light's glow, in the UFO's frame: always a little on, and this much bigger and brighter where the light runs. */
const BULB_GLOW = { IDLE: 0.3, RADIUS: 1.1, LIT_RADIUS: 3.4, FAR: 0.45 } as const;

/** The haze of light under the saucer, in its colour: where it is, how wide and flat, how bright, how fast it breathes. */
const UNDERGLOW = { Y: 2.4, RX: 10, RY: 3.2, ALPHA: 0.32, PULSE: 0.3, SPEED: 1.6 } as const;

/** One soft point of light, drawn once and stamped on every rim light: a warm-white core going out in sodium. */
let bulbSprite: HTMLCanvasElement | null = null;
function bulbGlow(): HTMLCanvasElement {
  if (bulbSprite) return bulbSprite;
  const px = 32;
  bulbSprite = document.createElement('canvas');
  bulbSprite.width = bulbSprite.height = px;
  const g = bulbSprite.getContext('2d')!;
  const glow = g.createRadialGradient(px / 2, px / 2, 0, px / 2, px / 2, px / 2);
  glow.addColorStop(0, rgba(COLORS.bone, 1));
  glow.addColorStop(0.22, rgba(COLORS.bone, 0.85));
  glow.addColorStop(0.45, rgba(COLORS.sodium, 0.35));
  glow.addColorStop(1, rgba(COLORS.sodium, 0));
  g.fillStyle = glow;
  g.fillRect(0, 0, px, px);
  return bulbSprite;
}

/** The haze under a saucer, one per colour, drawn once: a flat ellipse of the colour fading out. */
const underglows = new Map<string, HTMLCanvasElement>();
function underglow(color: string): HTMLCanvasElement {
  let sprite = underglows.get(color);
  if (sprite) return sprite;
  const px = 64;
  sprite = document.createElement('canvas');
  sprite.width = sprite.height = px;
  const g = sprite.getContext('2d')!;
  const glow = g.createRadialGradient(px / 2, px / 2, 0, px / 2, px / 2, px / 2);
  glow.addColorStop(0, rgba(color, 1));
  glow.addColorStop(0.5, rgba(color, 0.35));
  glow.addColorStop(1, rgba(color, 0));
  g.fillStyle = glow;
  g.fillRect(0, 0, px, px);
  underglows.set(color, sprite);
  return sprite;
}

/** The rim lights the camera sees, where it saw them (in the UFO's frame) and how much of them shines through. */
type RimBulb = { k: number; x: number; y: number; shine: number };
let bulbs: RimBulb[] | null = null;
function rimBulbs(): RimBulb[] {
  if (bulbs) return bulbs;
  const e = (UFO.VIEW * Math.PI) / 180;
  bulbs = [];
  for (let k = 0; k < UFO.LIGHTS; k++) {
    const a = (k / UFO.LIGHTS) * Math.PI * 2;
    const far = Math.sin(a);
    // The near half below the middle, the far half above it; the light right behind the dome cannot be seen, the
    // others on the far side shine through less.
    if (far > 0.9) continue;
    bulbs.push({ k, x: Math.cos(a) * UFO.RIM * UNIT, y: -(far * Math.sin(e) * UFO.RIM + UFO.RIM_HEIGHT * Math.cos(e)) * UNIT, shine: far > 0.1 ? BULB_GLOW.FAR : 1 });
  }
  return bulbs;
}

/**
 * The painted saucer with every rim light softly on, one per colour (the paint itself is cached by `painted`), at
 * `UFO_PX` pixels across: about what a UFO is drawn at, as the render's full size costs more to shrink every frame.
 */
const UFO_PX = 96;
const litUfos = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();
function litUfo(body: HTMLCanvasElement): HTMLCanvasElement {
  let lit = litUfos.get(body);
  if (lit) return lit;
  lit = Object.assign(document.createElement('canvas'), { width: UFO_PX, height: UFO_PX });
  const g = lit.getContext('2d')!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(body, 0, 0, UFO_PX, UFO_PX);
  const px = UFO_PX / SPAN;
  g.setTransform(px, 0, 0, px, UFO_PX / 2, UFO_PX / 2);
  g.globalCompositeOperation = 'lighter';
  for (const bulb of rimBulbs()) {
    g.globalAlpha = BULB_GLOW.IDLE * bulb.shine;
    g.drawImage(bulbGlow(), bulb.x - BULB_GLOW.RADIUS, bulb.y - BULB_GLOW.RADIUS, BULB_GLOW.RADIUS * 2, BULB_GLOW.RADIUS * 2);
  }
  litUfos.set(body, lit);
  return lit;
}

/**
 * Forged, a spectator's UFO: the saucer rendered in Blender at an angle (`render_pods.py`, 'ufo'), painted in the
 * spectator's colour, hovering and rocking a little over a faint haze of its colour. Its eight rim lights glow softly,
 * and a light runs round them with a short afterglow behind; on the far side it dims, and the one behind the dome is
 * hidden. It does not turn to fly: a saucer is the same from every side.
 */
export function drawForgedUfo(ctx: CanvasRenderingContext2D, color: string, time: number, flight: PodFlight): void {
  const body = painted('podUfo', 'podUfoMask', color);
  if (!body) return drawEngravedShuttlePod(ctx, color, time, flight);
  shadowOnPlanets(ctx, SPAN * UFO.SIZE * SHADOW.UFO);
  const { phase, beacon } = flight;
  ctx.scale(UFO.SIZE, UFO.SIZE);
  ctx.translate(0, Math.sin(time * UFO.HOVER_SPEED + phase * 5) * UFO.HOVER);
  ctx.rotate(Math.sin(time * UFO.HOVER_SPEED * 0.7 + phase * 3) * UFO.ROCK);
  if (!beacon) {
    ctx.globalAlpha = 0.55;
    ctx.drawImage(body, -SPAN / 2, -SPAN / 2, SPAN, SPAN);
    ctx.globalAlpha = 1;
    return;
  }
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = UNDERGLOW.ALPHA * (1 - UNDERGLOW.PULSE + UNDERGLOW.PULSE * Math.sin(time * UNDERGLOW.SPEED + phase * 4));
  ctx.drawImage(underglow(color), -UNDERGLOW.RX, UNDERGLOW.Y - UNDERGLOW.RY, UNDERGLOW.RX * 2, UNDERGLOW.RY * 2);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  // The saucer with its rim lights glowing softly, drawn once; only the running light and its afterglow are added.
  ctx.drawImage(litUfo(body), -SPAN / 2, -SPAN / 2, SPAN, SPAN);
  ctx.globalCompositeOperation = 'lighter';
  const sprite = bulbGlow();
  const head = (time * UFO.RUN + phase * UFO.LIGHTS) % UFO.LIGHTS;
  for (const bulb of rimBulbs()) {
    // How long ago the running light passed this one (in lights): it flares as the light comes, then fades behind it.
    // The bulbs are numbered round the way the light runs, left to right across the front.
    const behind = (head - bulb.k + UFO.LIGHTS) % UFO.LIGHTS;
    const lit = Math.max(0, 1 - behind / UFO.TRAIL, (behind - (UFO.LIGHTS - UFO.RISE)) / UFO.RISE);
    if (lit <= 0) continue;
    const r = BULB_GLOW.RADIUS + (BULB_GLOW.LIT_RADIUS - BULB_GLOW.RADIUS) * lit;
    ctx.globalAlpha = (1 - BULB_GLOW.IDLE) * lit * bulb.shine;
    ctx.drawImage(sprite, bulb.x - r, bulb.y - r, r * 2, r * 2);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

/** A soft ring of light, drawn once per colour: dark in the middle, bright towards its rim, fading out past it. */
const ringGlows = new Map<string, HTMLCanvasElement>();
function ringGlow(color: string): HTMLCanvasElement {
  let sprite = ringGlows.get(color);
  if (sprite) return sprite;
  const px = 96;
  sprite = Object.assign(document.createElement('canvas'), { width: px, height: px });
  const g = sprite.getContext('2d')!;
  const ring = g.createRadialGradient(px / 2, px / 2, 0, px / 2, px / 2, px / 2);
  ring.addColorStop(0, rgba(color, 0));
  ring.addColorStop(0.62, rgba(color, 0.05));
  ring.addColorStop(0.8, rgba(color, 0.9));
  ring.addColorStop(0.86, rgba(COLORS.bone, 0.9));
  ring.addColorStop(1, rgba(color, 0));
  g.fillStyle = ring;
  g.fillRect(0, 0, px, px);
  if (ringGlows.size > 32) ringGlows.clear();
  ringGlows.set(color, sprite);
  return sprite;
}

/**
 * Forged's cheer, a firework of light added to the field — not the flat rings and dots of Einfach, but a shock of
 * light and streaking sparks that arc down as they fly, cooling from white to sodium. More epic with every call the
 * fan got right this match (`epic` 0 → `FANS.EPIC_MAX`): more and longer streaks, half in the fan's colour (1); a flare
 * laid across the pod, a lens's glint (2); a second shock in the fan's colour and embers drifting down after (3); six
 * lights wheeling round the pod (4); and the streaks bursting into glints where they end, a firework's second stage (5).
 * Every glow is a stamped sprite and every family of streaks one path: no gradient made per frame.
 */
export function drawForgedPodCheer(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, t: number, fans: number, epic = 0): void {
  const e = Math.max(0, Math.min(FANS.EPIC_MAX, epic));
  const fade = 1 - t;
  const grow = 1 + 0.2 * e + 0.15 * fans;
  const glow = bulbGlow();
  const stampAt = (px: number, py: number, r: number, alpha: number, sprite: HTMLCanvasElement = glow) => {
    if (alpha <= 0.01) return;
    ctx.globalAlpha = Math.min(1, alpha);
    ctx.drawImage(sprite, px - r, py - r, r * 2, r * 2);
  };
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  // The flash at the heart and the shock of light going out from it.
  stampAt(x, y, (8 + 3 * e) * (0.7 + 0.6 * t), fade * fade * (0.6 + 0.08 * e));
  const shock = (4 + 18 * grow) * Math.sqrt(t);
  stampAt(x, y, shock, fade * 0.8, ringGlow(COLORS.sodium));
  if (e >= 3 && t > 0.12) {
    const late = (t - 0.12) / 0.88;
    stampAt(x, y, (4 + 24 * grow) * Math.sqrt(late), (1 - late) * 0.9, ringGlow(color));
  }
  // The flare across the pod: a long thin streak of light, and a glint standing up through it.
  if (e >= 2) {
    const flare = fade * (0.35 + 0.08 * e);
    const long = 22 + 8 * e;
    ctx.globalAlpha = Math.min(1, flare);
    ctx.drawImage(glow, x - long, y - 1.6, long * 2, 3.2);
    ctx.drawImage(glow, x - 1.2, y - long * 0.45, 2.4, long * 0.9);
  }
  // The streaks: thrown out on arcs that fall as they go, a white-hot head and a tail; one path per colour.
  const streaks = 6 + 2 * fans + 3 * e;
  const reach = (26 + 6 * fans) * grow;
  const fall = 14 + 3 * e;
  const sparkAt = (i: number, s: number): [number, number] => {
    const a = (i / streaks) * TAU + x * 0.013 + (i % 3) * 0.2;
    const speed = 0.75 + 0.25 * ((i * 7) % 5) / 4;
    const d = 4 + reach * speed * (1 - (1 - s) * (1 - s));
    return [x + Math.cos(a) * d, y + Math.sin(a) * d + fall * s * s];
  };
  ctx.lineCap = 'round';
  ctx.lineWidth = 1.1 + 0.15 * e;
  const tints = e >= 1 ? [COLORS.sodium, color] : [COLORS.sodium];
  tints.forEach((tint, k) => {
    ctx.strokeStyle = tint;
    ctx.globalAlpha = fade * 0.9;
    ctx.beginPath();
    for (let i = k; i < streaks; i += tints.length) {
      const [hx, hy] = sparkAt(i, t);
      const [tx, ty] = sparkAt(i, Math.max(0, t - 0.12 - 0.02 * e));
      ctx.moveTo(tx, ty);
      ctx.lineTo(hx, hy);
    }
    ctx.stroke();
  });
  // Every third head glows white while it is hot; at five every third bursts again where it ends.
  for (let i = 0; i < streaks; i += 3) {
    const [hx, hy] = sparkAt(i, t);
    stampAt(hx, hy, 2.4 + 0.3 * e, fade * fade);
    if (e >= 5 && t > 0.55) {
      // A glint where it bursts: a cross of light, opening and going out.
      const pop = (t - 0.55) / 0.45;
      const arm = 3 + 7 * pop;
      ctx.globalAlpha = (1 - pop) * 0.95;
      ctx.drawImage(glow, hx - arm, hy - 0.9, arm * 2, 1.8);
      ctx.drawImage(glow, hx - 0.9, hy - arm, 1.8, arm * 2);
    }
  }
  // Embers drifting down after the burst, from three right.
  if (e >= 3 && t > 0.3) {
    const late = (t - 0.3) / 0.7;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU + 0.4;
      const ex = x + Math.cos(a) * reach * 0.6 + Math.sin(late * 6 + i) * 2;
      const ey = y + Math.sin(a) * reach * 0.4 + late * (14 + 2 * i);
      stampAt(ex, ey, 1.8, (1 - late) * 0.8);
    }
  }
  // Six lights wheeling round the pod, from four right.
  if (e >= 4) {
    const r = 9 + 7 * Math.sin(Math.min(1, t * 1.4) * Math.PI * 0.5);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + t * 5;
      stampAt(x + Math.cos(a) * r, y + Math.sin(a) * r * 0.85, 4 + 0.5 * e, Math.min(1, fade * 1.6));
    }
  }
  ctx.restore();
}
