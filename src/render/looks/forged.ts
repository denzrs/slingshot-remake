import { COLORS } from '../../sim/config';
import { rgba } from '../color';
import { drawEngineFlame } from '../ship';
import { LIGHT } from '../planet-common';
import { engraved } from './classic';
import { drawBlast, drawShrapnel, warmBlasts } from './forged-blast';
import { image, painted } from './forged-assets';
import { renderForgedPlanet } from './forged-planet';
import { drawForgedNebula, drawForgedStormCloud, paintForgedPortal } from './forged-gas';
import { drawForgedLiveTrail, drawForgedPlasmaShot, drawForgedShot, drawForgedSun } from './forged-shots';
import { forgedBegin, forgedFrame, forgedPost, forgedSky, paintNebula } from './forged-sky';
import { lightParts, lightStyles } from './forged-parts';
import { drawLightHoleGlow, drawLightPickup, drawLightShip } from './forged-light';
import type { Styles } from './painter';

/**
 * The forged look: what Blender rendered, with light drawn over it (`forged-parts.ts`, `forged-light.ts`) and a good deal more: the
 * planets turn their clouds and show their dusk, the ships are lit by the field's own light, blasts are fireballs,
 * shrapnel tumbles, the sky has depth and the whole picture blooms. The images are
 * made by `scripts/forged/render_assets.py` and packed into `./forged/` (see `scripts/forged/pack.py`); `forged-*.ts` say
 * what is drawn over them. The images load on first use; until one is there the drawing in light stands in, so a frame is
 * never empty.
 */

/** The ship's image covers this many field units across, with the origin of the ship this far in from its centre. */
const SHIP_SPAN = 32;
const SHIP_CENTRE = -1.5;

/** The lit hull is painted on a canvas this many pixels across (the ship's image covers `SHIP_SPAN` units of it). */
const LIT = 128;
/** Each colour's lit hull, and the light it was painted in: painted again only when that light changes, not every frame. */
const lit = new Map<string, { canvas: HTMLCanvasElement; light: string }>();
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
  let known = lit.get(color);
  if (known?.light === key) return known.canvas;
  if (!known) {
    if (lit.size > 16) lit.clear();
    known = { canvas: Object.assign(document.createElement('canvas'), { width: LIT, height: LIT }), light: key };
    lit.set(color, known);
  }
  known.light = key;
  const c = known.canvas.getContext('2d')!;
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
  return known.canvas;
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

/** The black hole's image, horizon at the middle, covers this many horizon radii across. */
const HOLE_SPAN = 8.2;

/** The rendered disk and horizon of a black hole of `radius`, centred, in the disk's own tilt (the caller has applied it). False while the image is not there yet. */
export function drawForgedHole(ctx: CanvasRenderingContext2D, radius: number): boolean {
  const img = image('hole');
  if (!img) return false;
  const span = radius * HOLE_SPAN;
  ctx.drawImage(img, -span / 2, -span / 2, span, span);
  return true;
}

/** The power-up coin, drawn over the plate under its ring: the rendered metal, about as wide as the ring. */
export function forgedCoin(): HTMLImageElement | null {
  return image('coin');
}
/** The coin's image is this many times the coin across, a little wider for its bevel. */
export const COIN_SPAN = 34.5;

/**
 * Light over the rendered hole, in the disk's own frame: the glow, a halo that breathes, hot spots racing round the
 * disk (brighter on the side that comes towards us), the far side of the disk bent over the top and a faint echo of it below.
 */
export function drawForgedHoleGlow(ctx: CanvasRenderingContext2D, R: number, time: number): void {
  drawLightHoleGlow(ctx, R, time);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const breathe = 0.85 + 0.15 * Math.sin(time * 1.7);
  const halo = ctx.createRadialGradient(0, 0, R * 1.1, 0, 0, R * 6);
  halo.addColorStop(0, rgba(COLORS.sodium, 0.16 * breathe));
  halo.addColorStop(1, rgba(COLORS.sodium, 0));
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(0, 0, R * 6, 0, Math.PI * 2);
  ctx.fill();

  // The far side of the disk, lensed over the top, and its fainter echo under the horizon.
  ctx.lineCap = 'round';
  for (const [ry, from, to, alpha] of [[1.42, 1.08, 1.92, 0.3], [1.3, 0.12, 0.88, 0.1]] as const) {
    ctx.strokeStyle = rgba(COLORS.sodium, alpha * breathe);
    ctx.lineWidth = R * 0.13;
    ctx.beginPath();
    ctx.ellipse(0, from < 1 ? R * 0.08 : -R * 0.08, R * 1.55, R * ry, 0, Math.PI * from, Math.PI * to);
    ctx.stroke();
    ctx.strokeStyle = rgba(COLORS.bone, alpha * 0.8);
    ctx.lineWidth = Math.max(0.8, R * 0.025);
    ctx.stroke();
  }

  // Hot spots on three orbits, the inner ones quicker, each with a short tail.
  for (let i = 0; i < 3; i++) {
    const rx = R * (1.9 + 0.75 * i);
    const ry = rx * 0.2;
    const speed = 1.5 / (0.6 + i * 0.5);
    for (let k = 0; k < 7; k++) {
      const a = time * speed + i * 2.1 - k * 0.07;
      const x = Math.cos(a) * rx;
      const y = Math.sin(a) * ry;
      // Behind the horizon the spot is hidden.
      if (y < 0 && Math.abs(x) < R * 1.1) continue;
      const toward = 0.55 + 0.45 * -Math.cos(a);
      const r = R * (0.34 - k * 0.035);
      const spot = ctx.createRadialGradient(x, y, 0, x, y, r);
      spot.addColorStop(0, rgba(i === 0 ? COLORS.bone : COLORS.sodium, 0.7 * toward * (1 - k / 7)));
      spot.addColorStop(1, rgba(COLORS.sodium, 0));
      ctx.fillStyle = spot;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }
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
  note: 'Blender renders with light over them: turning clouds and rings, fireballs and tumbling shrapnel, comet shots, a sun with rays, a deep sky, bloom.',
  planet: renderForgedPlanet,
  sun: drawForgedSun,
  nebula: drawForgedNebula,
  stormCloud: drawForgedStormCloud,
  shot: drawForgedShot,
  liveTrail: drawForgedLiveTrail,
  plasmaShot: drawForgedPlasmaShot,
  ship: drawForgedShip,
  pickup: (ctx, kind, color, time, pulse) => drawLightPickup(ctx, kind, color, time, pulse, forgedCoin(), COIN_SPAN),
  effects: { ...lightParts.effects!, blast: drawBlast, spark: drawShrapnel },
  begin: (frame) => {
    forgedBegin(frame);
    warmBlasts();
  },
  backdropArt: paintNebula,
  sky: forgedSky,
  post: forgedPost,
});
