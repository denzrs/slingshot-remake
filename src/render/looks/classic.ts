import { AIM, COLORS, HORIZON, PHYSICS, SUDDEN_DEATH } from '../../sim/config';
import { aimDirection, isWormholeJump, type Wormhole } from '../../sim/physics';
import type { PowerUpKind } from '../../sim/powerups';
import { drawBlackHole } from '../blackhole';
import { rgba } from '../color';
import { drawDefense, drawInterception } from '../defense';
import { easeOut, NOVA_LIFE, type Nova } from '../effects';
import { drawNebula } from '../nebula';
import { strokePolyline } from '../polyline';
import { drawPowerUpSymbol, POWER_UP_COLORS } from '../powerup-art';
import { renderPlanet } from '../planets';
import { SHIP_HULL } from '../ship';
import { drawNeutronStar, drawSun } from '../sun';
import { drawStormBurst, drawStormCloud, drawStormSparks } from '../storm';
import { CLASSIC_PORTAL, drawPortal, drawWormhole } from '../wormhole';
import type { Look } from '../../data/look';
import { LOCATE_PING, type AimStyle, type EffectStyle, type LookPainter, type Styles } from './painter';

/**
 * The engraved plan: every element drawn the way the game always drew it. Every other look is this painter with some
 * styles and some elements replaced: `engraved(id, styles, parts)` builds one.
 */
export function engraved(id: Look, styles: Styles = {}, parts: Partial<LookPainter> = {}): LookPainter {
  const portal = styles.portal ?? CLASSIC_PORTAL;
  return {
    id,
    note: '',
    planetsTurnToSun: false,
    planet: renderPlanet,
    sun: drawSun,
    neutronStar: drawNeutronStar,
    blackHole: (ctx, hole, time) => drawBlackHole(ctx, hole, time, styles.hole),
    wormhole: (ctx, ax, ay, bx, by, radius, time, wormholeId, eaten) => drawWormhole(ctx, ax, ay, bx, by, radius, time, wormholeId, eaten, portal),
    portal: (ctx, x, y, facing, radius, color, time, alpha, phase, size) => drawPortal(ctx, x, y, facing, radius, color, time, alpha, phase, size, portal),
    nebula: drawNebula,
    stormCloud: drawStormCloud,
    stormBurst: drawStormBurst,
    stormSparks: drawStormSparks,
    defense: (ctx, d, planet, color, time, alpha, view, labels, hideRock) => drawDefense(ctx, d, planet, color, time, alpha, view, labels, hideRock, styles.defense),
    interception: (ctx, color, view, time, rocks) => drawInterception(ctx, color, view, time, rocks, styles.interception),
    ship: drawEngravedShip,
    selection: drawEngravedSelection,
    shotClock: drawEngravedShotClock,
    locatePing: drawEngravedPing,
    pull: drawEngravedPull,
    aimVector: drawEngravedAim,
    lockedRing: drawEngravedLockedRing,
    sparedRing: drawEngravedSparedRing,
    target: drawEngravedTarget,
    heldSymbol: drawEngravedHeldSymbol,
    shield: drawEngravedShield,
    offscreenArrow: drawEngravedArrow,
    trail: drawEngravedTrail,
    liveTrail: (ctx, points, wormholes, color, plasma, time) => drawEngravedLiveTrail(ctx, points, wormholes, color, plasma, time),
    shot: drawEngravedShot,
    plasmaShot: (ctx, x, y, time) => drawEngravedPlasmaShot(ctx, x, y, time),
    piercer: (ctx, x, y, heading, color) => drawEngravedPiercer(ctx, x, y, heading, color, 6),
    splitterRing: (ctx, x, y, time) => drawEngravedSplitterRing(ctx, x, y, time),
    spotlightPath: (ctx, part, color) => drawEngravedSpotlightPath(ctx, part, color),
    spotlightMark: (ctx, x, y, color, pulse) => drawEngravedSpotlightMark(ctx, x, y, color, pulse),
    pickup: drawEngravedPickup,
    previewPath: drawEngravedPreview,
    aimRay: (ctx, x0, y0, x1, y1, locked, time) => drawEngravedRay(ctx, x0, y0, x1, y1, locked, time),
    lockBrackets: drawEngravedBrackets,
    teleportGhost: drawEngravedTeleportGhost,
    blackHoleGhost: drawEngravedBlackHoleGhost,
    nebulaReach: drawEngravedNebulaReach,
    repelRing: drawEngravedRepelRing,
    effects: ENGRAVED_EFFECTS,
    ...parts,
  };
}


// ------------------------------------------------------------ the engraved elements ----

/** A ship: the hull in its solid colour with a dark edge and a canopy; while aiming, a small flame behind. Nose along +x. */
function drawEngravedShip(ctx: CanvasRenderingContext2D, color: string, time: number, thrust: number): void {
  if (thrust > 0) {
    const flicker = 0.6 + 0.4 * Math.sin(time * 31) * Math.sin(time * 17);
    ctx.fillStyle = rgba(COLORS.sodium, 0.55 * flicker);
    ctx.beginPath();
    ctx.moveTo(-10, -2.5);
    ctx.lineTo(-16 - 4 * flicker, 0);
    ctx.lineTo(-10, 2.5);
    ctx.fill();
  }
  ctx.beginPath();
  SHIP_HULL.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = COLORS.plate;
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.fillStyle = COLORS.plate;
  ctx.beginPath();
  ctx.ellipse(4, 0, 3.2, 1.8, 0, 0, Math.PI * 2);
  ctx.fill();
}

/** The ship whose turn it is: a dashed ring turning slowly. */
function drawEngravedSelection(ctx: CanvasRenderingContext2D, color: string, time: number): void {
  ctx.rotate(time * 0.8);
  ctx.setLineDash([3, 5]);
  ctx.strokeStyle = rgba(color, 0.7);
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(0, 0, 25, 0, Math.PI * 2);
  ctx.stroke();
}

/** The angle at which the shot clock's arc ends, `clock` seconds before the shot is taken for the player. */
export const shotClockEnd = (clock: number): number => -Math.PI / 2 + (Math.PI * 2 * clock) / HORIZON.SHOT_CLOCK;

/** The shot clock: an arc around the ship that runs down, red in the last seconds. */
export function drawEngravedShotClock(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, clock: number): void {
  ctx.strokeStyle = clock < 4 ? COLORS.danger : rgba(color, 0.9);
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.arc(x, y, 30, -Math.PI / 2, shotClockEnd(clock));
  ctx.stroke();
}

/** Sonar rings sweeping in towards the ship so the eye finds it when a round begins; they fade out over the ping's last half second. */
function drawEngravedPing(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, age: number): void {
  const fade = Math.min(1, (LOCATE_PING.DURATION - age) / 0.5);
  ctx.save();
  ctx.translate(x, y);
  ctx.lineWidth = 2;
  for (let k = 0; k < LOCATE_PING.RINGS; k++) {
    const t = (age / LOCATE_PING.PERIOD + k / LOCATE_PING.RINGS) % 1;
    const radius = LOCATE_PING.RADIUS * (1 - t) + 14;
    ctx.globalAlpha = fade * t * 0.85;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

/** Sudden death: rings closing in on the ship. */
function drawEngravedPull(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, time: number, strength: number, reach: number): void {
  ctx.save();
  ctx.lineWidth = 1.4;
  for (let k = 0; k < 3; k++) {
    const phase = (time * 0.6 + k / 3) % 1;
    ctx.strokeStyle = rgba(color, (0.12 + 0.28 * strength) * phase);
    ctx.beginPath();
    ctx.arc(x, y, 18 + (reach - 18) * (1 - phase), 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

/** Where an aim's line runs: its direction, where it starts and ends, and how far. */
export function aimGeometry(x: number, y: number, angle: number, power: number): { d: { x: number; y: number }; start: number; len: number; ex: number; ey: number } {
  const d = aimDirection(angle);
  const start = PHYSICS.MUZZLE + 8;
  const len = start + 18 + (power / AIM.MAX_POWER) * 110;
  return { d, start, len, ex: x + d.x * len, ey: y + d.y * len };
}

/** How strong an aim is drawn: its own full, another's locked in fainter, a CPU's in between. */
export const aimAlpha = (style: AimStyle): number => (style === 'full' ? 0.9 : style === 'ghost' ? 0.4 : 0.45);

/** The aim: a dashed line running out from the muzzle, ending in a filled arrowhead. */
function drawEngravedAim(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, power: number, color: string, style: AimStyle, time: number): void {
  const { d, start, ex, ey } = aimGeometry(x, y, angle, power);
  const alpha = aimAlpha(style);
  ctx.strokeStyle = rgba(color, alpha);
  ctx.lineWidth = style === 'full' ? 1.3 : 1;
  ctx.setLineDash(style === 'ghost' ? [] : [4, 4]);
  ctx.lineDashOffset = -time * 12;
  ctx.beginPath();
  ctx.moveTo(x + d.x * start, y + d.y * start);
  ctx.lineTo(ex, ey);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;
  ctx.fillStyle = rgba(color, style === 'full' ? 1 : alpha);
  ctx.beginPath();
  ctx.moveTo(ex + d.x * 7, ey + d.y * 7);
  ctx.lineTo(ex - d.y * 4, ey + d.x * 4);
  ctx.lineTo(ex + d.y * 4, ey - d.x * 4);
  ctx.closePath();
  ctx.fill();
}

function drawEngravedLockedRing(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.beginPath();
  ctx.arc(x, y, 21, 0, Math.PI * 2);
  ctx.stroke();
}

function drawEngravedSparedRing(ctx: CanvasRenderingContext2D, x: number, y: number, time: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-time * 0.5);
  ctx.setLineDash([2, 4]);
  ctx.strokeStyle = rgba(COLORS.bone, 0.7);
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(0, 0, 19, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/** The target of a daily challenge: a diamond inside a ring the size of the hit box, with a slowly turning dashed ring. */
export function drawEngravedTarget(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, time: number): void {
  const pulse = 0.5 + 0.5 * Math.sin(time * 2.4 + x * 0.01);
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = rgba(color, 0.5 + 0.3 * pulse);
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(0, 0, PHYSICS.SHIP_RADIUS, 0, Math.PI * 2);
  ctx.stroke();
  ctx.rotate(time * 0.5);
  ctx.setLineDash([7, 8]);
  ctx.strokeStyle = rgba(color, 0.45);
  ctx.beginPath();
  ctx.arc(0, 0, 21, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
  ctx.setLineDash([]);

  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.moveTo(0, -7);
  ctx.lineTo(7, 0);
  ctx.lineTo(0, 7);
  ctx.lineTo(-7, 0);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = COLORS.plate;
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.restore();
}

function drawEngravedHeldSymbol(ctx: CanvasRenderingContext2D, kind: PowerUpKind, color: string, x: number, y: number): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.8;
  ctx.lineCap = 'round';
  drawPowerUpSymbol(ctx, kind, x, y - 30, 5);
  ctx.restore();
}

function drawEngravedShield(ctx: CanvasRenderingContext2D, x: number, y: number, pulse: number): void {
  ctx.save();
  ctx.strokeStyle = POWER_UP_COLORS.shield;
  ctx.fillStyle = POWER_UP_COLORS.shield;
  ctx.lineWidth = 1.6;
  ctx.globalAlpha = 0.5 + 0.2 * pulse;
  ctx.beginPath();
  ctx.arc(x, y, 21, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 0.07 + 0.05 * pulse;
  ctx.fill();
  ctx.restore();
}

/** The chevron: a filled triangle, the colour turning white in the last stretch. */
export function drawEngravedArrow(ctx: CanvasRenderingContext2D, color: string, danger: boolean, angle: number): void {
  ctx.save();
  ctx.rotate(angle);
  ctx.scale(1.5, 1.5);
  ctx.beginPath();
  ctx.moveTo(8, 0);
  ctx.lineTo(-5, -6);
  ctx.lineTo(-5, 6);
  ctx.closePath();
  ctx.fillStyle = rgba(danger ? COLORS.bone : color, 0.9);
  ctx.fill();
  ctx.restore();
}

/** A finished trail: the owner's colour, fainter and dotted the further back the flight is. */
export function drawEngravedTrail(ctx: CanvasRenderingContext2D, points: number[], wormholes: readonly Wormhole[], color: string, rank: number, fade: number): void {
  ctx.strokeStyle = rgba(color, (rank === 0 ? 0.75 : rank === 1 ? 0.38 : 0.2) * fade);
  ctx.lineWidth = rank === 0 ? 1.6 : 1;
  ctx.setLineDash(rank === 0 ? [] : [1.5, 4]);
  strokePolyline(ctx, points, wormholes);
}

/** The track of a shot in flight; a plasma shot's is faint with a ribbon over it (`additive` adds the ribbon up as light). */
export function drawEngravedLiveTrail(ctx: CanvasRenderingContext2D, points: number[], wormholes: readonly Wormhole[], color: string, plasma: boolean, time: number, additive = false): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = plasma ? 1 : 2;
  if (plasma) ctx.globalAlpha = 0.45;
  strokePolyline(ctx, points, wormholes);
  ctx.globalAlpha = 1;
  if (plasma) drawEngravedPlasmaTrail(ctx, points, wormholes, time, additive);
}

/** Plasma shot: a tapering cyan ribbon that swells toward the blob, with sparks that drift off the trail and die. */
function drawEngravedPlasmaTrail(ctx: CanvasRenderingContext2D, pts: number[], wormholes: readonly Wormhole[], time: number, additive: boolean): void {
  const n = pts.length / 2;
  if (n < 2) return;
  const from = Math.max(1, n - 48);
  ctx.save();
  ctx.lineCap = 'round';
  if (additive) ctx.globalCompositeOperation = 'lighter';
  for (let pass = 0; pass < 2; pass++) {
    for (let k = from; k < n; k++) {
      if (wormholes.length && isWormholeJump(pts, k * 2, wormholes)) continue;
      const f = (k - from + 1) / (n - from);
      ctx.strokeStyle = pass === 0 ? rgba(POWER_UP_COLORS.plasma, 0.22 * f) : rgba('#e6ffff', 0.8 * f * f);
      ctx.lineWidth = (pass === 0 ? 9 : 2.4) * f;
      ctx.beginPath();
      ctx.moveTo(pts[k * 2 - 2], pts[k * 2 - 1]);
      ctx.lineTo(pts[k * 2], pts[k * 2 + 1]);
      ctx.stroke();
    }
  }
  // Sparks: every few points a speck sits off the line, drifting sideways as it ages and shrinking away.
  for (let k = from; k < n; k += 3) {
    const age = (n - k) / 48;
    const side = Math.sin(k * 12.9898) > 0 ? 1 : -1;
    const dx = pts[k * 2] - pts[k * 2 - 2];
    const dy = pts[k * 2 + 1] - pts[k * 2 - 1];
    const len = Math.hypot(dx, dy) || 1;
    const off = side * (2 + age * 9 + 1.5 * Math.sin(time * 6 + k));
    ctx.fillStyle = rgba(POWER_UP_COLORS.plasma, 0.7 * (1 - age));
    ctx.beginPath();
    ctx.arc(pts[k * 2] - (dy / len) * off, pts[k * 2 + 1] + (dx / len) * off, 1.8 * (1 - age) + 0.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** The plasma ribbon in light, for a look that adds up what it draws. */
export const drawGlowingLiveTrail = (ctx: CanvasRenderingContext2D, points: number[], wormholes: readonly Wormhole[], color: string, plasma: boolean, time: number): void =>
  drawEngravedLiveTrail(ctx, points, wormholes, color, plasma, time, true);

/** A shot in flight: a soft glow with a white core. */
function drawEngravedShot(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  const glow = ctx.createRadialGradient(x, y, 0, x, y, 9);
  glow.addColorStop(0, rgba(COLORS.bone, 0.95));
  glow.addColorStop(0.3, rgba(color, 0.6));
  glow.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(x - 9, y - 9, 18, 18);
}

/** A plasma shot is a pulsing cyan blob: a wide soft halo, a wobbling body and a bright core (`additive` adds the halo up as light). */
export function drawEngravedPlasmaShot(ctx: CanvasRenderingContext2D, x: number, y: number, time: number, additive = false): void {
  ctx.save();
  if (additive) ctx.globalCompositeOperation = 'lighter';
  const pulse = 1 + 0.12 * Math.sin(time * 14);
  const halo = ctx.createRadialGradient(x, y, 0, x, y, 15 * pulse);
  halo.addColorStop(0, rgba(POWER_UP_COLORS.plasma, 0.55));
  halo.addColorStop(1, rgba(POWER_UP_COLORS.plasma, 0));
  ctx.fillStyle = halo;
  ctx.fillRect(x - 16, y - 16, 32, 32);
  ctx.fillStyle = rgba(POWER_UP_COLORS.plasma, 0.9);
  ctx.beginPath();
  for (let i = 0; i <= 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const rr = 5.5 * pulse + 1.2 * Math.sin(a * 3 + time * 10);
    if (i === 0) ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    else ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = rgba('#e6ffff', 0.95);
  ctx.beginPath();
  ctx.arc(x, y, 2.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** An armor-piercing round is an arrowhead pointing where it flies, glowing like the plain shot; `glow` is the width of its outline. */
export function drawEngravedPiercer(ctx: CanvasRenderingContext2D, x: number, y: number, heading: number, color: string, glow: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(heading);
  ctx.beginPath();
  ctx.moveTo(13, 0);
  ctx.lineTo(-6, -4);
  ctx.lineTo(-3, 0);
  ctx.lineTo(-6, 4);
  ctx.closePath();
  // A wide, faint outline in the owner's colour is the glow: shadowBlur costs far more on a phone.
  ctx.lineJoin = 'round';
  ctx.lineWidth = glow;
  ctx.strokeStyle = rgba(color, 0.35);
  ctx.stroke();
  ctx.fillStyle = rgba(COLORS.bone, 0.98);
  ctx.fill();
  ctx.restore();
}

/** A shot that can still be split carries a gold ring, blinking. */
export function drawEngravedSplitterRing(ctx: CanvasRenderingContext2D, x: number, y: number, time: number, glow = false): void {
  ctx.save();
  ctx.strokeStyle = POWER_UP_COLORS.splitter;
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = 0.55 + 0.45 * Math.sin(time * 8);
  ctx.beginPath();
  ctx.arc(x, y, 12, 0, Math.PI * 2);
  if (glow) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = 5;
    ctx.globalAlpha *= 0.3;
    ctx.stroke();
    ctx.lineWidth = 1.5;
    ctx.globalAlpha /= 0.3;
  }
  ctx.stroke();
  ctx.restore();
}

/** Round over: the path of the spotlit shot, a wide faint stroke with a bright line down it. */
export function drawEngravedSpotlightPath(ctx: CanvasRenderingContext2D, part: number[], color: string, additive = false): void {
  ctx.strokeStyle = rgba(color, 0.22);
  ctx.lineWidth = 8;
  if (additive) ctx.globalCompositeOperation = 'lighter';
  strokePolyline(ctx, part);
  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = rgba(COLORS.bone, 0.95);
  ctx.lineWidth = 2.4;
  strokePolyline(ctx, part);
}

/** Where the spotlit shot counted: a ring spreading out and a dot. */
function drawEngravedSpotlightMark(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, pulse: number): void {
  ctx.strokeStyle = rgba(color, 1 - pulse);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, 8 + pulse * 18, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = rgba(COLORS.bone, 0.95);
  ctx.beginPath();
  ctx.arc(x, y, 3, 0, Math.PI * 2);
  ctx.fill();
}

/** A power-up on the field: a plate with a glowing ring and its symbol. */
function drawEngravedPickup(ctx: CanvasRenderingContext2D, kind: PowerUpKind, color: string, _time: number, pulse: number): void {
  ctx.shadowColor = color;
  ctx.shadowBlur = 14 + 8 * pulse;
  ctx.fillStyle = COLORS.plate;
  ctx.beginPath();
  ctx.arc(0, 0, 15, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(0, 0, 15, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  drawPowerUpSymbol(ctx, kind, 0, 0, 8);
}

/** The path of an armed preview: dashed, fading with its place in the preview window. */
function drawEngravedPreview(ctx: CanvasRenderingContext2D, pts: number[], last: number, span: number, color: string): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  ctx.setLineDash([3, 5]);
  for (let i = 0; i < last; i++) {
    ctx.globalAlpha = 0.9 * Math.max(0, 1 - i / span);
    ctx.beginPath();
    ctx.moveTo(pts[i * 2], pts[i * 2 + 1]);
    ctx.lineTo(pts[i * 2 + 2], pts[i * 2 + 3]);
    ctx.stroke();
  }
  ctx.restore();
}

/** The ray of a planet killer or an antigravity: dashed and running, firm once it has locked on to a planet. */
export function drawEngravedRay(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, locked: boolean, time: number, glow = false): void {
  ctx.setLineDash(locked ? [10, 7] : [3, 9]);
  ctx.lineDashOffset = -time * (locked ? 70 : 20);
  ctx.globalAlpha = locked ? 0.9 : 0.35;
  ctx.lineWidth = locked ? 2 : 1;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  if (glow) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.setLineDash([]);
    ctx.lineWidth = 7;
    ctx.globalAlpha *= 0.2;
    ctx.stroke();
    ctx.restore();
  }
  ctx.setLineDash([]);
}

function drawEngravedBrackets(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, time: number): void {
  ctx.lineWidth = 2.5;
  for (let k = 0; k < 4; k++) {
    const a = time * 0.8 + (k * Math.PI) / 2;
    ctx.beginPath();
    ctx.arc(x, y, r, a - 0.32, a + 0.32);
    ctx.stroke();
  }
}

/** The door: a ring with a solid core and a crosshair. */
export function drawEngravedTeleportGhost(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, pulse: number): void {
  ctx.beginPath();
  ctx.arc(x, y, 17 + 2.5 * pulse, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = COLORS.plate;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x - 4, y);
  ctx.lineTo(x + 4, y);
  ctx.moveTo(x, y - 4);
  ctx.lineTo(x, y + 4);
  ctx.stroke();
}

export function drawEngravedBlackHoleGhost(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, pulse: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r + 4 + 2.5 * pulse, 0, Math.PI * 2);
  ctx.stroke();
}

/** The reach of the cloud as a plain ring: it must not wobble while the aim moves. */
function drawEngravedNebulaReach(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number): void {
  ctx.setLineDash([6, 5]);
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.stroke();
}

export function drawEngravedRepelRing(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number): void {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.stroke();
}

// ------------------------------------------------------------------ effects ----

/** The supernova: doomed ships glowing hotter as the wave comes for them, a blinding ball that swells and burns out, and two shockwaves. */
function drawEngravedNova(ctx: CanvasRenderingContext2D, nova: Nova): void {
  const { x, y, age } = nova;
  const fade = Math.max(0, 1 - age / NOVA_LIFE);
  // The doomed ships, glowing hotter as the wave comes for them.
  for (const d of nova.doomed) {
    if (d.done) continue;
    const heat = Math.min(1, age / Math.max(0.01, d.at));
    ctx.save();
    ctx.translate(d.x, d.y);
    const glow = ctx.createRadialGradient(0, 0, 2, 0, 0, 22 + 26 * heat);
    glow.addColorStop(0, rgba('#fff4cc', 0.7 * heat));
    glow.addColorStop(1, rgba(COLORS.danger, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(-50, -50, 100, 100);
    ctx.rotate((-d.angle * Math.PI) / 180);
    ctx.beginPath();
    SHIP_HULL.forEach(([hx, hy], k) => (k ? ctx.lineTo(hx, hy) : ctx.moveTo(hx, hy)));
    ctx.closePath();
    ctx.fillStyle = d.color;
    ctx.fill();
    ctx.fillStyle = rgba('#fff4cc', heat * 0.85);
    ctx.fill();
    ctx.restore();
  }
  if (fade <= 0) return;
  ctx.globalCompositeOperation = 'lighter';
  // The core: a blinding ball that swells fast and burns out.
  const core = 40 + 340 * easeOut(Math.min(1, age / 0.7));
  const ball = ctx.createRadialGradient(x, y, 0, x, y, core);
  ball.addColorStop(0, rgba('#ffffff', fade));
  ball.addColorStop(0.25, rgba('#fff0c0', 0.85 * fade));
  ball.addColorStop(0.6, rgba(COLORS.sodium, 0.45 * fade));
  ball.addColorStop(1, rgba(COLORS.danger, 0));
  ctx.fillStyle = ball;
  ctx.beginPath();
  ctx.arc(x, y, core, 0, Math.PI * 2);
  ctx.fill();
  // The shockwaves: a white-hot front, and a slower, wider one of red plasma behind it.
  for (const [speed, width, inner, edge, strength] of [[1, 70, COLORS.sodium, '#ffffff', 1], [0.62, 140, COLORS.danger, '#ff8a2e', 0.8]] as const) {
    const front = SUDDEN_DEATH.NOVA_SPEED * speed * age;
    if (front < 4) continue;
    const band = ctx.createRadialGradient(x, y, Math.max(0, front - width), x, y, front + 12);
    band.addColorStop(0, rgba(inner, 0));
    band.addColorStop(0.7, rgba(inner, 0.45 * fade * strength));
    band.addColorStop(0.93, rgba(edge, 0.95 * fade * strength));
    band.addColorStop(1, rgba(edge, 0));
    ctx.fillStyle = band;
    ctx.beginPath();
    ctx.arc(x, y, front + 12, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
}

export const ENGRAVED_EFFECTS: EffectStyle = {
  nova: drawEngravedNova,
  ring: (ctx, r, radius, width, t) => {
    ctx.beginPath();
    ctx.arc(r.x, r.y, Math.max(0, radius), 0, Math.PI * 2);
    ctx.strokeStyle = rgba(r.color, 0.8 * (1 - t));
    ctx.lineWidth = width;
    ctx.stroke();
  },
  beam: (ctx, b, t) => {
    ctx.beginPath();
    ctx.moveTo(b.x1, b.y1);
    ctx.lineTo(b.x2, b.y2);
    ctx.strokeStyle = rgba(b.color, 0.7 * (1 - t));
    ctx.lineWidth = 3 * (1 - t) + 0.5;
    ctx.stroke();
  },
};

export const classic = engraved('classic', {}, { note: 'The engraved plan, unchanged.', planetsTurnToSun: true });
