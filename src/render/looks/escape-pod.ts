import { COLORS, FANS, FONTS } from '../../sim/config';
import { uprightFrame } from '../orientation';
import { rgba } from '../color';
import { holoPolygon } from './holo-art';
import type { PodFlight } from './painter';
import { cachedSprite, stamp, type SpriteSpec } from './sprite-cache';

const TAU = Math.PI * 2;

/**
 * The escape pod a shot-down player flies in, Einfach's and Holo's, and the cheer of its fans. A pod is drawn centred
 * on itself at about half a ship's size, turned the way it flies (`PodFlight`).
 */

/**
 * How big Einfach's and Holo's pods are drawn, against the frame the renderer hands them: smaller than Forged's
 * render, so a flat pod is not taken for a ship.
 */
const SIZE = { shuttle: 0.55, arrow: 0.6 } as const;

/** The beacon's light, 0 → 1: a short flash every second and a bit. */
export function flash(time: number, phase: number): number {
  const t = (time * 0.8 + phase) % 1;
  return t < 0.12 ? 1 - t / 0.12 : 0;
}

/** The beacon as a lamp at (x, y): lit in `light` while it flashes, a dim bulb once the bet is lost. */
function beaconAt(ctx: CanvasRenderingContext2D, x: number, y: number, time: number, phase: number, beacon: boolean, light: string = COLORS.sodium): void {
  const on = beacon ? flash(time, phase) : 0;
  ctx.fillStyle = beacon ? rgba(light, 0.35 + 0.65 * on) : rgba(COLORS.boneDim, 0.5);
  ctx.beginPath();
  ctx.arc(x, y, 1.4, 0, Math.PI * 2);
  ctx.fill();
  if (on <= 0) return;
  ctx.strokeStyle = rgba(light, 0.5 * on);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(x, y, 3 + 4 * (1 - on), 0, Math.PI * 2);
  ctx.stroke();
}

/** The shuttle's body (wings, engines, hull, cockpit), the same every frame: drawn once per colour and light into a sprite. */
function shuttleBody(ctx: CanvasRenderingContext2D, color: string, beacon: boolean): void {
  ctx.fillStyle = color;
  ctx.strokeStyle = COLORS.plate;
  ctx.lineWidth = 1.1;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(1, side * 2.2);
    ctx.lineTo(-3.5, side * 7.6);
    ctx.lineTo(-6.2, side * 7.6);
    ctx.lineTo(-5, side * 2.2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.fillStyle = rgba(COLORS.bone, beacon ? 0.75 : 0.35);
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.roundRect(-8.2, side * 1.3 - 0.8, 1.8, 1.6, 0.5);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.moveTo(7.5, 0);
  ctx.quadraticCurveTo(6.5, -2.6, 3, -2.6);
  ctx.lineTo(-6, -2.6);
  ctx.lineTo(-7, -1.6);
  ctx.lineTo(-7, 1.6);
  ctx.lineTo(-6, 2.6);
  ctx.lineTo(3, 2.6);
  ctx.quadraticCurveTo(6.5, 2.6, 7.5, 0);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = rgba(COLORS.plate, 0.55);
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(-6.5, 0);
  ctx.lineTo(-3.4, 0);
  ctx.stroke();
  ctx.fillStyle = COLORS.plate;
  ctx.beginPath();
  ctx.ellipse(3.6, 0, 2, 1.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = rgba(COLORS.bone, beacon ? 0.9 : 0.35);
  ctx.beginPath();
  ctx.ellipse(3.9, 0, 1.2, 0.9, 0, 0, Math.PI * 2);
  ctx.fill();
}

/** The shuttle body's sprite: `half` units each way of the shuttle's middle, `px` pixels to a unit (sharp up close). */
const SPRITE: SpriteSpec = { half: 9, px: 8 };
const bodies = new Map<string, HTMLCanvasElement | null>();

/**
 * Einfach, mini shuttle: a little lifeboat with stubby wings, a cockpit up front and two engines behind; the beacon on
 * its back, behind the cockpit. Nose ahead, its engines burn like a ship's: a small flame while it drifts, longer the
 * harder they push. The body is a sprite; only the flames and the beacon are drawn each frame.
 */
export function drawEngravedShuttlePod(ctx: CanvasRenderingContext2D, color: string, time: number, flight: PodFlight): void {
  const { phase, beacon } = flight;
  ctx.rotate(flight.heading);
  ctx.scale(SIZE.shuttle, SIZE.shuttle);
  if (beacon) {
    const burn = 0.25 + 0.75 * flight.thrust;
    for (const side of [-1, 1]) {
      const flicker = 0.6 + 0.4 * Math.sin(time * 31 + phase * 5 + side) * Math.sin(time * 17 + phase * 3);
      ctx.fillStyle = rgba(COLORS.sodium, (0.35 + 0.3 * burn) * flicker);
      ctx.beginPath();
      ctx.moveTo(-8, side * 1.3 - 0.9);
      ctx.lineTo(-9 - (1.5 + 6 * burn) * flicker, side * 1.3);
      ctx.lineTo(-8, side * 1.3 + 0.9);
      ctx.fill();
    }
  }
  const sprite = cachedSprite(bodies, `${color}:${beacon}`, SPRITE, (c) => shuttleBody(c, color, beacon));
  if (sprite) stamp(ctx, sprite, SPRITE);
  else shuttleBody(ctx, color, beacon);
  beaconAt(ctx, -1.2, 0, time, phase, beacon);
}

/** The chevron's outline, as the current path. */
function chevron(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(6.5, 0);
  ctx.lineTo(-4, -5.4);
  ctx.lineTo(-1.4, 0);
  ctx.lineTo(-4, 5.4);
  ctx.closePath();
}

/** The arrow's sprite frame (its glow reaches past the chevron), and the sprites by colour. */
const ARROW: SpriteSpec = { half: 8.5, px: 6 };
const arrows = new Map<string, HTMLCanvasElement | null>();

/** The arrow as it stays: the chevron, a wide faint line under the narrow bright one, and the inner lines. */
function arrowBody(ctx: CanvasRenderingContext2D, color: string): void {
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineJoin = 'round';
  chevron(ctx);
  ctx.strokeStyle = rgba(color, 0.22);
  ctx.lineWidth = 3.4;
  ctx.stroke();
  ctx.strokeStyle = rgba(color, 0.95);
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.strokeStyle = rgba(color, 0.45);
  ctx.beginPath();
  ctx.moveTo(3.4, 0);
  ctx.lineTo(-1.6, -2.6);
  ctx.moveTo(3.4, 0);
  ctx.lineTo(-1.6, 2.6);
  ctx.stroke();
}

/**
 * Holo, arrow signal: a chevron of light pointing the way it flies, its afterglow trailing behind it in fading dots,
 * longer the faster it goes. Lit the holo way, a wide faint line under the narrow bright one (no `shadowBlur`).
 */
export function drawHoloArrowPod(ctx: CanvasRenderingContext2D, color: string, time: number, flight: PodFlight): void {
  const { phase, beacon } = flight;
  ctx.rotate(flight.heading);
  ctx.scale(SIZE.arrow, SIZE.arrow);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  // A pod whose bet is lost has gone dark, as in the other looks.
  if (!beacon) ctx.globalAlpha = 0.4;
  const sprite = cachedSprite(arrows, color, ARROW, (c) => arrowBody(c, color));
  if (sprite) stamp(ctx, sprite, ARROW);
  else arrowBody(ctx, color);
  // The afterglow, running backwards, drawn out the faster it flies.
  const run = (time * 6 + phase * 3) % 3;
  const stretch = 0.8 + 0.7 * flight.thrust;
  for (let k = 0; k < 4; k++) {
    const x = -5.5 - (k * 3 + run) * stretch;
    ctx.fillStyle = rgba(color, Math.max(0, 0.7 - (k * 3 + run) / 14));
    ctx.beginPath();
    ctx.arc(x, 0, 0.9, 0, Math.PI * 2);
    ctx.fill();
  }
  // The beacon at the tip, with a faint halo of its own while it flashes.
  const on = beacon ? flash(time, phase) : 0;
  if (on > 0) {
    ctx.fillStyle = rgba(color, 0.25 * on);
    ctx.beginPath();
    ctx.arc(6.5, 0, 3 + 2 * on, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = beacon ? rgba(color, 0.5 + 0.5 * on) : rgba(COLORS.boneDim, 0.4);
  ctx.beginPath();
  ctx.arc(6.5, 0, 1.1 + on, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * The streak a pod leaves while it is flung off its wreck, in every look: a line of light in the player's colour that
 * thins and fades towards its tail, with a bright core near the pod. Drawn in a few strokes, not one a segment.
 */
export function drawPodLaunch(ctx: CanvasRenderingContext2D, path: readonly { x: number; y: number; fade: number }[], color: string): void {
  if (path.length < 2) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // In a few bands from the tail to the head, each one stroke: thinner and fainter towards the tail.
  const bands = 3;
  for (let band = 0; band < bands; band++) {
    const from = Math.floor((band * (path.length - 1)) / bands);
    const to = Math.floor(((band + 1) * (path.length - 1)) / bands);
    if (to <= from) continue;
    const fade = Math.max(0, path[to].fade);
    if (fade <= 0) continue;
    ctx.beginPath();
    ctx.moveTo(path[from].x, path[from].y);
    for (let i = from + 1; i <= to; i++) ctx.lineTo(path[i].x, path[i].y);
    ctx.strokeStyle = rgba(color, 0.5 * fade);
    ctx.lineWidth = 1 + 4 * fade;
    ctx.stroke();
    // The bright core only where it is bright: next to the pod.
    if (band < bands - 1) continue;
    ctx.strokeStyle = rgba(COLORS.bone, 0.6 * fade * fade);
    ctx.lineWidth = 1.2 * fade;
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * A fan's call over their pod, in every look: a small badge with the call, outlined in the player's colour while the
 * shot is aimed; then filled (right, with a tick) or dimmed (wrong, with a cross), fading out.
 */
export function drawPodCall(ctx: CanvasRenderingContext2D, x: number, y: number, label: string, state: 'open' | 'right' | 'wrong', fade: number, color: string): void {
  ctx.save();
  ctx.translate(x, y);
  uprightFrame(ctx);
  if (state !== 'open') ctx.globalAlpha = Math.max(0, Math.min(1, (1 - fade) / 0.3));
  const text = `${state === 'right' ? '✓ ' : state === 'wrong' ? '✗ ' : ''}${label}`;
  ctx.font = `700 11px ${FONTS.body}`;
  const w = ctx.measureText(text).width + 12;
  const h = 16;
  const top = -CALL_RISE - h;
  ctx.beginPath();
  ctx.roundRect(-w / 2, top, w, h, h / 2);
  ctx.fillStyle = state === 'right' ? COLORS.sodium : rgba(COLORS.plate, 0.85);
  ctx.fill();
  ctx.strokeStyle = state === 'open' ? color : state === 'right' ? COLORS.sodium : rgba(COLORS.boneDim, 0.6);
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.fillStyle = state === 'right' ? COLORS.plate : state === 'wrong' ? COLORS.boneDim : COLORS.bone;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 0, top + h / 2 + 0.5);
  ctx.restore();
}

/** How far over its pod a call's badge sits (field units). */
const CALL_RISE = 14;

/**
 * A pod's cheer, `t` running 0 → 1: rings going out from it and a spray of sparks, wider and brighter the more fans
 * (`fans`) cheer with it — and more epic the more calls the fan got right this match (`epic`, 0 → `FANS.EPIC_MAX`):
 * more sparks flying farther, half of them in the fan's colour (1), rays bursting out (2), a third ring in their colour
 * (3), a crown of light spinning round it (4), and a second wave of sparks after the first (5). `sides` draws the rings
 * as polygons (Holo's hexagons) instead of circles. Each part is one path, so a big cheer costs a few strokes more.
 */
export function cheerBurst(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, t: number, fans: number, epic: number, sides = 0): void {
  const e = Math.max(0, Math.min(FANS.EPIC_MAX, epic));
  const grow = 1 + 0.22 * e;
  const strength = Math.min(1, 0.45 + 0.15 * fans + 0.1 * e);
  const fade = 1 - t;
  const ring = (r: number, turn: number) => {
    if (sides) {
      ctx.save();
      ctx.translate(x, y);
      holoPolygon(ctx, r, sides, turn);
      ctx.restore();
    } else {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
    }
  };
  ctx.save();
  ctx.lineWidth = 1.5 + 0.25 * e;
  // The rings: two going out, a third between them in the fan's colour once they have three right.
  const lags = e >= 3 ? [0, 0.12, 0.25] : [0, 0.25];
  for (const lag of lags) {
    if (t <= lag) continue;
    const r = 8 + (16 + 6 * fans) * grow * ((t - lag) / (1 - lag));
    ctx.strokeStyle = lag === 0.12 ? rgba(color, 0.9 * fade * strength) : rgba(COLORS.sodium, 0.8 * fade * strength);
    ring(r, t * e * 0.5 + lag * 4);
    ctx.stroke();
  }
  // Rays bursting out, from two right.
  if (e >= 2) {
    const rays = 2 * e + 2;
    const inner = 10 + 10 * t * grow;
    const outer = inner + (6 + 3 * e) * fade;
    ctx.strokeStyle = rgba(COLORS.bone, 0.7 * fade);
    ctx.lineWidth = 1 + 0.2 * e;
    ctx.beginPath();
    for (let i = 0; i < rays; i++) {
      const a = (i / rays) * TAU + t * 0.8;
      ctx.moveTo(x + Math.cos(a) * inner, y + Math.sin(a) * inner);
      ctx.lineTo(x + Math.cos(a) * outer, y + Math.sin(a) * outer);
    }
    ctx.stroke();
  }
  // The sparks: one path in the fan's colour, one in sodium from the first right call on.
  const sparks = 5 + 2 * fans + 3 * e;
  const spray = (wave: number, alpha: number) => {
    if (wave <= 0) return;
    const d = 6 + (14 + 5 * fans) * grow * wave;
    const size = (1.4 + 0.15 * e) * (1 - wave) + 0.4;
    for (const [tint, odd] of e >= 1 ? ([[color, 0], [COLORS.sodium, 1]] as const) : ([[color, -1]] as const)) {
      ctx.fillStyle = rgba(tint, alpha);
      ctx.beginPath();
      for (let i = 0; i < sparks; i++) {
        if (odd >= 0 && i % 2 !== odd) continue;
        const a = (i / sparks) * TAU + x * 0.01 + wave * e * 0.3;
        const px = x + Math.cos(a) * d;
        const py = y + Math.sin(a) * d;
        ctx.moveTo(px + size, py);
        ctx.arc(px, py, size, 0, TAU);
      }
      ctx.fill();
    }
  };
  spray(t, fade * strength);
  // A second wave after the first, at five right.
  if (e >= 5) spray((t - 0.3) / 0.7, Math.max(0, 1 - (t - 0.3) / 0.7) * 0.8);
  // A crown of light spinning round the pod, from four right.
  if (e >= 4) {
    const r = 12 + 4 * Math.sin(t * Math.PI);
    ctx.strokeStyle = rgba(COLORS.sodium, 0.85 * fade);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    const points = 5;
    for (let i = 0; i <= points * 2; i++) {
      const a = (i / (points * 2)) * TAU + t * 3;
      const rr = i % 2 ? r * 0.55 : r;
      const px = x + Math.cos(a) * rr;
      const py = y + Math.sin(a) * rr;
      if (i) ctx.lineTo(px, py);
      else ctx.moveTo(px, py);
    }
    ctx.stroke();
  }
  ctx.restore();
}

/** Einfach's cheer: the burst as it is, on the plate. */
export function drawEngravedPodCheer(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, t: number, fans: number, epic = 0): void {
  cheerBurst(ctx, x, y, color, t, fans, epic);
}

/** Holo's cheer: the burst added to the plate as light (no `shadowBlur`, as everywhere in Holo), its rings hexagons. */
export function drawHoloPodCheer(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, t: number, fans: number, epic = 0): void {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  cheerBurst(ctx, x, y, color, t, fans, epic, 6);
  ctx.restore();
}
