import { COLORS } from '../../sim/config';
import { rgba } from '../color';
import { glowLine } from './holo-art';
import type { PodFlight } from './painter';
import { cachedSprite, stamp, type SpriteSpec } from './sprite-cache';

/**
 * The spectators' UFOs, Einfach's and Holo's (Forged's is a render, `forged-pods.ts`): visitors come to watch, told
 * apart from the shot-down players' pods at a glance. Seen from the side, as a saucer is known; it is the same
 * from every side, so it does not turn to fly. Drawn centred on it, in its own units (about ±7), scaled down here.
 * There can be twenty at once: what stays the same is a sprite (`sprite-cache.ts`), only what moves is drawn live.
 */

/** The sprites' frames: big enough for the Holo glow round the outline, sharp up close. */
const SPRITE: SpriteSpec = { half: 9.5, px: 6 };
const sprites = new Map<string, HTMLCanvasElement | null>();

/** How big a UFO is drawn against the frame the renderer hands it: about a ship's size, to be made out from afar. */
const PROBE = 0.7;

const TAU = Math.PI * 2;

// ————————————————————————————— Einfach —————————————————————————————

/** Einfach's UFO lights along the near rim: how many, how far apart, and where. */
const RIM_LIGHTS = { COUNT: 5, GAP: 2.8, Y: 1.1 } as const;

/** Einfach's UFO as it stays: the dome, the saucer and its rim lights, all of them unlit. */
function engravedSaucer(ctx: CanvasRenderingContext2D, color: string, beacon: boolean): void {
  // The dome, behind the rim.
  ctx.beginPath();
  ctx.ellipse(0, -1.2, 3.4, 3.4, 0, Math.PI, 0);
  ctx.closePath();
  ctx.fillStyle = rgba(COLORS.bone, 0.55);
  ctx.fill();
  ctx.strokeStyle = COLORS.plate;
  ctx.lineWidth = 1.1;
  ctx.stroke();
  ctx.fillStyle = rgba(COLORS.bone, beacon ? 0.9 : 0.35);
  ctx.beginPath();
  ctx.ellipse(-1.2, -3, 0.9, 0.6, -0.5, 0, TAU);
  ctx.fill();
  // The saucer.
  ctx.beginPath();
  ctx.ellipse(0, 0, 7.4, 2.4, 0, 0, TAU);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = rgba(COLORS.plate, 0.55);
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.ellipse(0, -0.5, 7.2, 1.2, 0, 0, Math.PI);
  ctx.stroke();
  ctx.fillStyle = beacon ? rgba(COLORS.bone, 0.5) : rgba(COLORS.boneDim, 0.4);
  for (let i = 0; i < RIM_LIGHTS.COUNT; i++) {
    ctx.beginPath();
    ctx.arc((i - (RIM_LIGHTS.COUNT - 1) / 2) * RIM_LIGHTS.GAP, RIM_LIGHTS.Y, 0.55, 0, TAU);
    ctx.fill();
  }
}

/** Einfach, UFO: a saucer seen from the side in the spectator's colour, a glass dome on top, its lights running along the rim; it hovers. */
export function drawEngravedSaucer(ctx: CanvasRenderingContext2D, color: string, time: number, flight: PodFlight): void {
  ctx.scale(PROBE, PROBE);
  ctx.translate(0, Math.sin(time * 2 + flight.phase * 5) * 0.6);
  const sprite = cachedSprite(sprites, `e:${color}:${flight.beacon}`, SPRITE, (c) => engravedSaucer(c, color, flight.beacon));
  if (sprite) stamp(ctx, sprite, SPRITE);
  else engravedSaucer(ctx, color, flight.beacon);
  if (!flight.beacon) return;
  // The light running along the rim, the one lit now.
  const lit = Math.floor(time * 6 + flight.phase * 5) % RIM_LIGHTS.COUNT;
  ctx.fillStyle = COLORS.sodium;
  ctx.beginPath();
  ctx.arc((lit - (RIM_LIGHTS.COUNT - 1) / 2) * RIM_LIGHTS.GAP, RIM_LIGHTS.Y, 0.8, 0, TAU);
  ctx.fill();
}

// ————————————————————————————— Holo —————————————————————————————

/** The Holo UFO's silhouette, one outline: the dome rising out of the saucer's top, the saucer a lens below it. */
function saucerPath(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(-7.4, 0.4);
  // The top of the saucer up to the foot of the dome, the dome, then on to the far tip.
  ctx.quadraticCurveTo(-5.4, -1.2, -3.2, -1.5);
  ctx.bezierCurveTo(-3, -5.4, 3, -5.4, 3.2, -1.5);
  ctx.quadraticCurveTo(5.4, -1.2, 7.4, 0.4);
  // Its underside, back round.
  ctx.quadraticCurveTo(4.5, 2.6, 0, 2.7);
  ctx.quadraticCurveTo(-4.5, 2.6, -7.4, 0.4);
  ctx.closePath();
}

/** Holo's UFO lights underneath: three, this far apart, here; and how many places the scan bar is drawn at as it runs down. */
const UNDER_LIGHTS = { COUNT: 3, GAP: 3, Y: 1.9 } as const;
const SCAN_STEPS = 12;

/** Holo's UFO as it stays: the faint fill with its scanlines, the outline, the rim, the points of light, the lights underneath unlit. */
function holoSaucer(ctx: CanvasRenderingContext2D, color: string): void {
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineJoin = 'round';
  saucerPath(ctx);
  ctx.fillStyle = rgba(color, 0.14);
  ctx.fill();
  ctx.save();
  saucerPath(ctx);
  ctx.clip();
  ctx.strokeStyle = rgba(color, 0.3);
  ctx.lineWidth = 0.35;
  ctx.beginPath();
  for (let y = -5.4; y < 3; y += 1.2) {
    ctx.moveTo(-8, y);
    ctx.lineTo(8, y);
  }
  ctx.stroke();
  ctx.restore();
  saucerPath(ctx);
  glowLine(ctx, color, 0.8);
  ctx.globalCompositeOperation = 'lighter';
  // The rim, a thin line across.
  ctx.strokeStyle = rgba(color, 0.5);
  ctx.lineWidth = 0.45;
  ctx.beginPath();
  ctx.moveTo(-6.6, 0.4);
  ctx.quadraticCurveTo(0, 1.3, 6.6, 0.4);
  ctx.stroke();
  ctx.fillStyle = rgba(COLORS.bone, 0.9);
  for (const [x, y] of [[-7.4, 0.4], [7.4, 0.4], [0, -4.4]]) {
    ctx.beginPath();
    ctx.arc(x, y, 0.6, 0, TAU);
    ctx.fill();
  }
  ctx.fillStyle = rgba(color, 0.35);
  for (let i = 0; i < UNDER_LIGHTS.COUNT; i++) {
    ctx.beginPath();
    ctx.arc((i - 1) * UNDER_LIGHTS.GAP, UNDER_LIGHTS.Y, 0.5, 0, TAU);
    ctx.fill();
  }
}

/** The scan bar at step `step` of its run down the saucer, cut to its outline: the same in every colour. */
function holoScanBar(ctx: CanvasRenderingContext2D, step: number): void {
  saucerPath(ctx);
  ctx.clip();
  ctx.fillStyle = rgba(COLORS.bone, 0.4);
  ctx.fillRect(-8, (step / SCAN_STEPS) * 8.6 - 5.6, 16, 0.8);
}

/**
 * Holo, UFO: drawn as Holo draws a ship — one outline over a faint fill with scanlines and a bar of light running
 * through it, a thin line for the rim, points of light on its tips — and three lights blinking in turn underneath.
 */
export function drawHoloSaucer(ctx: CanvasRenderingContext2D, color: string, time: number, flight: PodFlight): void {
  ctx.scale(PROBE, PROBE);
  if (!flight.beacon) ctx.globalAlpha = 0.4;
  const body = cachedSprite(sprites, `h:${color}`, SPRITE, (c) => holoSaucer(c, color));
  if (!body) {
    holoSaucer(ctx, color);
    return;
  }
  stamp(ctx, body, SPRITE);
  ctx.globalCompositeOperation = 'lighter';
  const step = Math.floor(((time * 0.7 + flight.phase) % 1) * SCAN_STEPS);
  const bar = cachedSprite(sprites, `bar:${step}`, SPRITE, (c) => holoScanBar(c, step));
  if (bar) stamp(ctx, bar, SPRITE);
  if (!flight.beacon) return;
  // The light underneath lit now.
  const lit = Math.floor(time * 4 + flight.phase * 3) % UNDER_LIGHTS.COUNT;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc((lit - 1) * UNDER_LIGHTS.GAP, UNDER_LIGHTS.Y, 0.75, 0, TAU);
  ctx.fill();
}
