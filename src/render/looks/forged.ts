import { drawForgedGate } from './forged-gate';
import { drawForgedWhiteCore, drawForgedWhiteJump, warmEruptions } from './forged-white';
import { COLORS, PHYSICS } from '../../sim/config';
import { rgba } from '../color';
import { drawFalling } from '../infall';
import { drawEngineFlame } from '../ship';
import { LIGHT } from '../planet-common';
import { drawEngravedTarget, engraved } from './classic';
import { drawBlast, drawShrapnel, warmBlasts } from './forged-blast';
import { image, painted } from './forged-assets';
import { renderForgedPlanet } from './forged-planet';
import { instabilityPulse } from './instability';
import { drawForgedNebula, drawForgedStormCloud, paintForgedPortal } from './forged-gas';
import { drawForgedLiveTrail, drawForgedPlasmaShot, drawForgedShot, drawForgedSun } from './forged-shots';
import { forgedBegin, forgedFrame, forgedPost, forgedSky, paintNebula } from './forged-sky';
import { lightParts, lightStyles } from './forged-parts';
import { drawLightPickup, drawLightShip } from './forged-light';
import { drawLensedHole } from './forged-hole';
import type { Styles } from './painter';

/**
 * The forged look: what Blender rendered, with light drawn over it (`forged-parts.ts`, `forged-light.ts`) and a good deal more: the
 * planets turn their clouds and show their dusk, the ships are lit by the field's own light, blasts are fireballs,
 * shrapnel tumbles and the sky has depth. The images are
 * made by `scripts/forged/render_assets.py` and packed into `./forged/` (see `scripts/forged/pack.py`); `forged-*.ts` say
 * what is drawn over them. The images load on first use; until one is there the drawing in light stands in, so a frame is
 * never empty.
 */

/** The ship's image covers this many field units across, with the origin of the ship this far in from its centre. */
const SHIP_SPAN = 32;
const SHIP_CENTRE = -1.5;

/** The lit hull is painted on a canvas this many pixels across (the ship's image covers `SHIP_SPAN` units of it). */
const LIT = 128;
/** The lit hulls by colour and light, the most recently drawn last: two ships of one colour in different light each keep theirs. */
const lit = new Map<string, HTMLCanvasElement>();
/** Past this many, the hull drawn longest ago gives up its canvas. */
const LIT_KEPT = 48;
/** Directions are kept to this many steps a turn, and a planet's strength to this many steps: finer than shows, coarse enough that a ship standing still keeps its hull. */
const TURN_STEPS = 256;
const STRENGTH_STEPS = 32;

/** A unit vector turned to the nearest of `TURN_STEPS` directions, and that step. */
function stepped([x, y]: [number, number]): { dir: [number, number]; step: number } {
  const step = Math.round((Math.atan2(y, x) / (Math.PI * 2)) * TURN_STEPS);
  const a = (step / TURN_STEPS) * Math.PI * 2;
  return { dir: [Math.cos(a), Math.sin(a)], step };
}

/** A direction on the screen, as one in the frame of whatever is being drawn (`m` its transform), as a unit vector. */
function inFrame(m: DOMMatrix, dx: number, dy: number): [number, number] {
  const lx = (dx * m.a + dy * m.b) / (Math.hypot(m.a, m.b) || 1);
  const ly = (dx * m.c + dy * m.d) / (Math.hypot(m.c, m.d) || 1);
  const l = Math.hypot(lx, ly) || 1;
  return [lx / l, ly / l];
}

/**
 * Which way the field's light comes from, in the frame of whatever is being drawn: from the nearest sun of a Solar
 * System, otherwise from the upper left as the planets are lit. A render has its light baked in, turning with the hull;
 * this is how the hull is lit again from where the light really is, however it is turned.
 */
function lightInFrame(ctx: CanvasRenderingContext2D): [number, number] {
  const m = ctx.getTransform();
  const frame = forgedFrame();
  let dx = LIGHT[0];
  let dy = LIGHT[1];
  const sun = frame?.suns[0];
  if (frame && sun) {
    const at = frame.field.transformPoint(new DOMPoint(sun.x, sun.y));
    dx = at.x - m.e;
    dy = at.y - m.f;
  }
  return inFrame(m, dx, dy);
}

/** The planets a ship is close to, with the way each lies in the ship's frame and how strongly it lights the hull (0 → 1): nearer and bigger, stronger. */
function nearPlanets(ctx: CanvasRenderingContext2D): { dir: [number, number]; tint: string; strength: number }[] {
  const frame = forgedFrame();
  if (!frame || !frame.planets.length) return [];
  const m = ctx.getTransform();
  const scale = Math.hypot(frame.field.a, frame.field.b);
  const out: { dir: [number, number]; tint: string; strength: number }[] = [];
  for (const p of frame.planets) {
    const at = frame.field.transformPoint(new DOMPoint(p.x, p.y));
    const dx = at.x - m.e;
    const dy = at.y - m.f;
    const gap = Math.hypot(dx, dy) - p.radius * scale;
    const reach = p.radius * scale * 2.4;
    const strength = Math.min(1, Math.max(0, 1 - gap / reach)) * 0.55;
    if (strength > 0.02) out.push({ dir: inFrame(m, dx, dy), tint: p.tint, strength });
  }
  return out;
}

/** The hull, lit again: shaded away from the light, glinting towards it, and rimmed in the player's colour by the engine at the back. */
function litHull(ctx: CanvasRenderingContext2D, hull: HTMLCanvasElement, color: string): HTMLCanvasElement {
  const light = stepped(lightInFrame(ctx));
  const planets = nearPlanets(ctx).map((planet) => {
    const { dir, step } = stepped(planet.dir);
    return { dir, step, tint: planet.tint, strength: Math.round(planet.strength * STRENGTH_STEPS) / STRENGTH_STEPS };
  });
  const key = `${light.step}|${planets.map((planet) => `${planet.step},${planet.tint},${planet.strength}`).join('|')}`;
  const id = `${color}|${key}`;
  const known = lit.get(id);
  if (known) {
    lit.delete(id);
    lit.set(id, known);
    return known;
  }
  let canvas: HTMLCanvasElement;
  if (lit.size >= LIT_KEPT) {
    const [oldest, reused] = lit.entries().next().value!;
    lit.delete(oldest);
    canvas = reused;
  } else {
    canvas = Object.assign(document.createElement('canvas'), { width: LIT, height: LIT });
  }
  lit.set(id, canvas);
  const c = canvas.getContext('2d')!;
  const [lx, ly] = light.dir;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, LIT, LIT);
  c.setTransform(LIT / SHIP_SPAN, 0, 0, LIT / SHIP_SPAN, LIT / 2, LIT / 2);
  c.drawImage(hull, SHIP_CENTRE - SHIP_SPAN / 2, -SHIP_SPAN / 2, SHIP_SPAN, SHIP_SPAN);
  c.globalCompositeOperation = 'source-atop';
  const shade = c.createLinearGradient(lx * 12, ly * 12, -lx * 12, -ly * 12);
  shade.addColorStop(0, 'rgba(255,248,235,0.2)');
  shade.addColorStop(0.45, 'rgba(255,255,255,0)');
  shade.addColorStop(1, 'rgba(4,8,20,0.5)');
  c.fillStyle = shade;
  c.fillRect(-SHIP_SPAN, -SHIP_SPAN, SHIP_SPAN * 2, SHIP_SPAN * 2);
  const glint = c.createRadialGradient(lx * 6, ly * 6, 0, lx * 6, ly * 6, 9);
  glint.addColorStop(0, 'rgba(255,255,255,0.32)');
  glint.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = glint;
  c.fillRect(-SHIP_SPAN, -SHIP_SPAN, SHIP_SPAN * 2, SHIP_SPAN * 2);
  const rim = c.createRadialGradient(-15, 0, 0, -15, 0, 15);
  rim.addColorStop(0, rgba(color, 0.4));
  rim.addColorStop(1, rgba(color, 0));
  c.fillStyle = rim;
  c.fillRect(-SHIP_SPAN, -SHIP_SPAN, SHIP_SPAN * 2, SHIP_SPAN * 2);
  // A planet close by throws its own colour on the side of the hull that faces it.
  for (const planet of planets) {
    const [px, py] = planet.dir;
    const glow = c.createLinearGradient(px * 13, py * 13, -px * 4, -py * 4);
    glow.addColorStop(0, rgba(planet.tint, planet.strength));
    glow.addColorStop(1, rgba(planet.tint, 0));
    c.fillStyle = glow;
    c.fillRect(-SHIP_SPAN, -SHIP_SPAN, SHIP_SPAN * 2, SHIP_SPAN * 2);
  }
  c.globalCompositeOperation = 'source-over';
  return canvas;
}

/** A ship: the rendered hull in its player's colour, lit from the field's light, over the engine flame and a halo, wing lights blinking. In the ship's frame, nose along +x. */
export function drawForgedShip(ctx: CanvasRenderingContext2D, color: string, time: number, thrust: number, phase: number): void {
  const hull = painted('ship', 'shipMask', color);
  if (!hull) {
    drawLightShip(ctx, color, time, thrust, phase);
    return;
  }
  const breathe = 0.85 + 0.15 * Math.sin(time * 2.2 + phase);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const halo = ctx.createRadialGradient(0, 0, 3, 0, 0, 30);
  halo.addColorStop(0, rgba(color, 0.22 * breathe));
  halo.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = halo;
  ctx.fillRect(-30, -30, 60, 60);
  drawEngineFlame(ctx, color, time, thrust, phase);
  ctx.restore();
  ctx.drawImage(litHull(ctx, hull, color), -SHIP_SPAN / 2, -SHIP_SPAN / 2, SHIP_SPAN, SHIP_SPAN);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const side of [-1, 1]) {
    const on = 0.5 + 0.5 * Math.sin(time * 4 + phase + (side > 0 ? 0 : Math.PI));
    const light = ctx.createRadialGradient(-10.5, side * 10.5, 0, -10.5, side * 10.5, 5);
    light.addColorStop(0, rgba(COLORS.bone, 0.95 * on));
    light.addColorStop(0.4, rgba(color, 0.7 * on));
    light.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = light;
    ctx.fillRect(-16, side * 10.5 - 5.5, 11, 11);
  }
  ctx.restore();
}

/** The drone's image covers this many field units across (12.5 a Blender unit); its pylons' lamps sit this far from the middle, in these directions (degrees, y up as in the picture). */
const DRONE_SPAN = 32.5;
const DRONE_LAMP = 14.5;
const DRONE_PYLONS = [90, 210, 330];

/** The drone is turned and lit on this canvas (`DRONE_PX` across) before it is drawn: the field's light does not turn with it. */
const DRONE_PX = 256;
let droneCanvas: HTMLCanvasElement | null = null;

/** The hull turned by `angle`, shaded away from the field's light and glinting towards it. The shared canvas is only good until the next call. */
function turnedDrone(ctx: CanvasRenderingContext2D, hull: HTMLCanvasElement, angle: number): HTMLCanvasElement {
  const [lx, ly] = lightInFrame(ctx);
  droneCanvas ??= Object.assign(document.createElement('canvas'), { width: DRONE_PX, height: DRONE_PX });
  const c = droneCanvas.getContext('2d')!;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalCompositeOperation = 'source-over';
  c.clearRect(0, 0, DRONE_PX, DRONE_PX);
  const k = DRONE_PX / DRONE_SPAN;
  c.setTransform(k, 0, 0, k, DRONE_PX / 2, DRONE_PX / 2);
  c.save();
  c.rotate(angle);
  c.drawImage(hull, -DRONE_SPAN / 2, -DRONE_SPAN / 2, DRONE_SPAN, DRONE_SPAN);
  c.restore();
  c.globalCompositeOperation = 'source-atop';
  const shade = c.createLinearGradient(lx * 13, ly * 13, -lx * 13, -ly * 13);
  shade.addColorStop(0, 'rgba(255,248,235,0.22)');
  shade.addColorStop(0.5, 'rgba(255,255,255,0)');
  shade.addColorStop(1, 'rgba(4,8,20,0.5)');
  c.fillStyle = shade;
  c.fillRect(-DRONE_SPAN, -DRONE_SPAN, DRONE_SPAN * 2, DRONE_SPAN * 2);
  const glint = c.createRadialGradient(lx * 6, ly * 6, 0, lx * 6, ly * 6, 9);
  glint.addColorStop(0, 'rgba(255,255,255,0.3)');
  glint.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = glint;
  c.fillRect(-DRONE_SPAN, -DRONE_SPAN, DRONE_SPAN * 2, DRONE_SPAN * 2);
  c.globalCompositeOperation = 'source-over';
  return droneCanvas;
}

/**
 * The target of a daily challenge: a rendered space drone, an armoured orb with a lens, three blade pylons and an orbit
 * ring, in the target's colour, hovering and turning slowly in the ring of its hit box. The field's light is put over the hull
 * in code, so it stays where it is as the drone turns; the lens breathes and the pylon lamps blink. Until the images have loaded, the engraved diamond stands in.
 */
export function drawForgedTarget(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, time: number): void {
  const hull = painted('drone', 'droneMask', color);
  const phase = x * 0.01;
  const pulse = 0.5 + 0.5 * Math.sin(time * 2.4 + phase);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const halo = ctx.createRadialGradient(x, y, 4, x, y, 34);
  halo.addColorStop(0, rgba(color, 0.3 + 0.1 * pulse));
  halo.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = halo;
  ctx.fillRect(x - 34, y - 34, 68, 68);
  ctx.restore();
  if (!hull) return drawEngravedTarget(ctx, x, y, color, time);

  // the hit box's ring, and a dashed one turning round the drone
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = rgba(color, 0.4 + 0.3 * pulse);
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(0, 0, PHYSICS.SHIP_RADIUS, 0, Math.PI * 2);
  ctx.stroke();
  ctx.rotate(time * 0.5);
  ctx.setLineDash([7, 8]);
  ctx.strokeStyle = rgba(color, 0.4);
  ctx.beginPath();
  ctx.arc(0, 0, 21, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.translate(x, y);
  // a slow hover, and a slow turn (every drone its own way and pace)
  ctx.translate(0, Math.sin(time * 1.6 + phase) * 0.7);
  const turn = ((Math.floor(x / 7) + Math.floor(y / 5)) % 2 ? 1 : -1) * (0.16 + 0.05 * ((Math.abs(x * 3 + y) % 7) / 7));
  const angle = time * turn + phase * 40;
  ctx.drawImage(turnedDrone(ctx, hull, angle), -DRONE_SPAN / 2, -DRONE_SPAN / 2, DRONE_SPAN, DRONE_SPAN);
  ctx.rotate(angle);
  ctx.globalCompositeOperation = 'lighter';
  // the lens in the orb's top: a lit eye that breathes
  const eye = ctx.createRadialGradient(0, 0, 0, 0, 0, 4.2);
  eye.addColorStop(0, rgba(COLORS.bone, 0.9 * (0.55 + 0.45 * pulse)));
  eye.addColorStop(0.35, rgba(color, 0.75 * (0.6 + 0.4 * pulse)));
  eye.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = eye;
  ctx.fillRect(-4.5, -4.5, 9, 9);
  // a lamp at the tip of every pylon, blinking in turn
  DRONE_PYLONS.forEach((deg, k) => {
    const a = (deg * Math.PI) / 180;
    const lx = Math.cos(a) * DRONE_LAMP;
    const ly = -Math.sin(a) * DRONE_LAMP;
    const on = 0.5 + 0.5 * Math.sin(time * 4 + phase + k * ((Math.PI * 2) / 3));
    const lamp = ctx.createRadialGradient(lx, ly, 0, lx, ly, 3.2);
    lamp.addColorStop(0, rgba(COLORS.bone, 0.9 * on));
    lamp.addColorStop(0.4, rgba(color, 0.6 * on));
    lamp.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = lamp;
    ctx.fillRect(lx - 3.2, ly - 3.2, 6.4, 6.4);
  });
  ctx.restore();
}

/** The turret's images cover this many field units across: the body with the surface point at its middle, the mount with its pivot there. */
const TURRET_SPAN = 32;
/** The mount turns this far out from the surface, and the barrels run this far from it. */
const HEAD = 5.5;
const BARREL = 12.5;

/**
 * A planetary defense's turret: the rendered hexagonal plinth in the owner's colour, and on it the mount with its twin
 * barrels, turned to `aim` (kicked back by `kick`, 0 to 1, after a launch), a sensor lit at its middle and a glow at the
 * muzzle. In the defense's frame, the turret at the origin and `out` the way from the planet's middle. False while the
 * images are not there yet.
 */
export function drawForgedTurret(ctx: CanvasRenderingContext2D, color: string, out: number, aim: number, kick: number, chasing: boolean, time: number): boolean {
  const body = painted('turretBase', 'turretMask', color);
  const mount = painted('turretBarrel', 'turretBarrelMask', color);
  if (!body || !mount) return false;
  const hx = Math.cos(out) * HEAD;
  const hy = Math.sin(out) * HEAD;
  const lit = chasing ? 1 : 0.55 + 0.25 * Math.sin(time * 3);
  ctx.save();
  ctx.rotate(out);
  ctx.drawImage(body, -TURRET_SPAN / 2, -TURRET_SPAN / 2, TURRET_SPAN, TURRET_SPAN);
  ctx.restore();
  ctx.save();
  ctx.translate(hx, hy);
  ctx.rotate(aim);
  ctx.drawImage(mount, -TURRET_SPAN / 2 - kick * 2.5, -TURRET_SPAN / 2, TURRET_SPAN, TURRET_SPAN);
  ctx.globalCompositeOperation = 'lighter';
  const muzzle = BARREL - kick * 2.5;
  const flare = ctx.createRadialGradient(muzzle, 0, 0, muzzle, 0, 6);
  flare.addColorStop(0, rgba(chasing ? COLORS.bone : color, 0.35 + 0.55 * kick + (chasing ? 0.2 : 0)));
  flare.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = flare;
  ctx.fillRect(muzzle - 6, -6, 12, 12);
  ctx.restore();
  ctx.save();
  ctx.translate(hx, hy);
  ctx.globalCompositeOperation = 'lighter';
  const eye = ctx.createRadialGradient(0, 0, 0, 0, 0, 4);
  eye.addColorStop(0, rgba(chasing ? COLORS.bone : color, 0.95 * lit));
  eye.addColorStop(0.35, rgba(color, 0.6 * lit));
  eye.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = eye;
  ctx.fillRect(-4, -4, 8, 8);
  ctx.restore();
  return true;
}

/** The black hole, traced as light bends round it and played as a loop (`forged-hole.ts`), in the disk's own tilt (the caller has applied it). False until the image has loaded. */
export const drawForgedHole = drawLensedHole;

/** The power-up coin, drawn over the plate under its ring: the rendered metal, about as wide as the ring. */
export function forgedCoin(): HTMLImageElement | null {
  return image('coin');
}
/** The coin's image is this many times the coin across, a little wider for its bevel. */
export const COIN_SPAN = 34.5;

/** A warm haze round the hole, breathing a little: the disk's light scattered round it. */
export function drawForgedHoleGlow(ctx: CanvasRenderingContext2D, R: number, time: number): void {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const breathe = 0.85 + 0.15 * Math.sin(time * 1.7);
  // Nothing inside the shadow: light added there would grey the black of the hole.
  const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 6.5);
  halo.addColorStop(0, rgba(COLORS.sodium, 0));
  halo.addColorStop(1 / 6.5, rgba(COLORS.sodium, 0));
  halo.addColorStop(1.25 / 6.5, rgba(COLORS.sodium, 0.3 * breathe));
  halo.addColorStop(2 / 6.5, rgba(COLORS.sodium, 0.14 * breathe));
  halo.addColorStop(1, rgba(COLORS.sodium, 0));
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(0, 0, R * 6.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** The forged look is the engraved plan in light with the rendered images put in. */
export const forgedStyles: Styles = {
  ...lightStyles,
  hole: { body: drawForgedHole, glow: drawForgedHoleGlow },
  portal: { ...lightStyles.portal!, paint: paintForgedPortal },
  defense: { ...lightStyles.defense, turret: drawForgedTurret },
};

export const forged = engraved('forged', forgedStyles, {
  ...lightParts,
  note: 'Blender renders with light over them: turning clouds and rings, fireballs and tumbling shrapnel, comet shots, a sun with rays, a deep sky.',
  // The halo and the disk's light already say where the hole is; a red dashed circle over them only muddies it.
  dangerRing: () => {},
  planet: renderForgedPlanet,
  planetInstability: (ctx, planet, time) => {
    const warning = instabilityPulse(planet, time);
    if (!warning) return;
    const { pulse, danger } = warning;
    const r = planet.radius;
    ctx.save(); ctx.translate(planet.x, planet.y);
    // Deep crimson pressure under the surface, breathing into a wide atmospheric bloom.
    const bloom = ctx.createRadialGradient(0, 0, r * .7, 0, 0, r * (1.4 + pulse * .12));
    bloom.addColorStop(0, rgba('#69091c', .07 + pulse * .12));
    bloom.addColorStop(.3, rgba('#ae1632', .12 + pulse * (.25 + danger * .15)));
    bloom.addColorStop(.65, rgba('#8b1029', pulse * .17));
    bloom.addColorStop(1, rgba('#59091c', 0));
    ctx.fillStyle = bloom; ctx.beginPath(); ctx.arc(0, 0, r * 1.55, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = 'lighter';
    ctx.shadowColor = '#b51b36'; ctx.shadowBlur = r * .2;
    ctx.strokeStyle = rgba('#b91e34', .1 + pulse * (.38 + danger * .2));
    ctx.lineWidth = 1 + pulse * 1.5;
    ctx.beginPath(); ctx.arc(0, 0, r * 1.015, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  },
  // Painted light can be cut into slices and bent round the hole.
  falling: drawFalling,
  sun: drawForgedSun,
  nebula: drawForgedNebula,
  stormCloud: drawForgedStormCloud,
  shot: drawForgedShot,
  loopGate: drawForgedGate,
  whiteCore: drawForgedWhiteCore,
  whiteJump: drawForgedWhiteJump,
  liveTrail: drawForgedLiveTrail,
  plasmaShot: drawForgedPlasmaShot,
  ship: drawForgedShip,
  target: drawForgedTarget,
  pickup: (ctx, kind, color, time, pulse) => drawLightPickup(ctx, kind, color, time, pulse, forgedCoin(), COIN_SPAN),
  effects: { ...lightParts.effects!, blast: drawBlast, spark: drawShrapnel },
  begin: (frame) => {
    forgedBegin(frame);
    warmBlasts();
    warmEruptions();
  },
  backdropArt: paintNebula,
  sky: forgedSky,
  post: forgedPost,
});
