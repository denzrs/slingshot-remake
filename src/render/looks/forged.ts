import { COLORS } from '../../sim/config';
import type { Planet } from '../../sim/physics';
import { createRng, range } from '../../sim/rng';
import { hexToRgb, rgba } from '../color';
import coinUrl from './forged/coin.webp';
import holeUrl from './forged/hole.webp';
import shipUrl from './forged/ship.webp';
import shipMaskUrl from './forged/ship-mask.webp';
import texGasUrl from './forged/tex-gas.webp';
import texIceUrl from './forged/tex-ice.webp';
import texRockUrl from './forged/tex-rock.webp';
import turretBarrelUrl from './forged/turret-barrel.webp';
import turretBarrelMaskUrl from './forged/turret-barrel-mask.webp';
import turretBaseUrl from './forged/turret-base.webp';
import turretMaskUrl from './forged/turret-mask.webp';
import { drawEngineFlame } from '../ship';
import { clamp01, LIGHT, mix, smoothstep, type PlanetSprite } from '../planet-common';
import { renderLuminousPlanet } from './luminous-planet';
import { engraved } from './classic';
import { luminousParts, luminousStyles } from './luminous';
import { drawLuminousHoleGlow, drawLuminousPickup, drawLuminousShip } from './luminous-art';
import type { Styles } from './painter';

/**
 * The forged look: what Blender rendered, with the light of the luminous look drawn over it. The images are made by
 * `scripts/forged/render_assets.py` and packed into `./forged/` (see `scripts/forged/pack.py`). They load on first use;
 * until one is there the luminous drawing stands in, so a frame is never empty.
 */

const URLS = {
  coin: coinUrl,
  hole: holeUrl,
  ship: shipUrl,
  shipMask: shipMaskUrl,
  turretBase: turretBaseUrl,
  turretMask: turretMaskUrl,
  turretBarrel: turretBarrelUrl,
  turretBarrelMask: turretBarrelMaskUrl,
  gas: texGasUrl,
  ice: texIceUrl,
  rock: texRockUrl,
};
type Name = keyof typeof URLS;

const images = new Map<Name, HTMLImageElement>();

/** The image of `name`, once it has loaded; null before (the first call starts the load). */
function image(name: Name): HTMLImageElement | null {
  let img = images.get(name);
  if (!img) {
    img = new Image();
    img.src = URLS[name];
    images.set(name, img);
  }
  return img.complete && img.naturalWidth > 0 ? img : null;
}

/** The ship's image covers this many field units across, with the origin of the ship this far in from its centre. */
const SHIP_SPAN = 32;
const SHIP_CENTRE = -1.5;

const tinted = new Map<string, HTMLCanvasElement>();

/** A render's picture with its paint in `color`: the near-white paint (where `maskName` is white) multiplied, so the lighting of the render stays. */
function painted(name: Name, maskName: Name, color: string): HTMLCanvasElement | null {
  const key = `${name}:${color}`;
  const known = tinted.get(key);
  if (known) return known;
  const ship = image(name);
  const mask = image(maskName);
  if (!ship || !mask) return null;
  const layer = document.createElement('canvas');
  layer.width = mask.naturalWidth;
  layer.height = mask.naturalHeight;
  const lctx = layer.getContext('2d')!;
  lctx.drawImage(mask, 0, 0);
  lctx.globalCompositeOperation = 'source-in';
  lctx.fillStyle = color;
  lctx.fillRect(0, 0, layer.width, layer.height);
  const canvas = document.createElement('canvas');
  canvas.width = ship.naturalWidth;
  canvas.height = ship.naturalHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(ship, 0, 0);
  ctx.globalCompositeOperation = 'multiply';
  ctx.drawImage(layer, 0, 0);
  if (tinted.size > 48) tinted.clear();
  tinted.set(key, canvas);
  return canvas;
}

/** A ship: the rendered hull in its player's colour over the engine flame and a halo, wing lights blinking. In the ship's frame, nose along +x. */
export function drawForgedShip(ctx: CanvasRenderingContext2D, color: string, time: number, thrust: number, phase: number): void {
  const hull = painted('ship', 'shipMask', color);
  if (!hull) {
    drawLuminousShip(ctx, color, time, thrust, phase);
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
  ctx.drawImage(hull, SHIP_CENTRE - SHIP_SPAN / 2, -SHIP_SPAN / 2, SHIP_SPAN, SHIP_SPAN);
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

// ---------------------------------------------------------------- planets ----

/** A glow past the limb, as a share of the radius. */
const GLOW = 0.22;
const ATMOSPHERE: Record<string, [number, number, number]> = { gas: [255, 214, 160], ice: [191, 230, 255], rocky: [255, 176, 122] };
const NIGHT: [number, number, number] = [16, 30, 60];

interface Texture {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}
const textures = new Map<Name, Texture>();

function texture(name: Name): Texture | null {
  const known = textures.get(name);
  if (known) return known;
  const img = image(name);
  if (!img) return null;
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const c = canvas.getContext('2d')!;
  c.drawImage(img, 0, 0);
  const made = { data: c.getImageData(0, 0, canvas.width, canvas.height).data, width: canvas.width, height: canvas.height };
  textures.set(name, made);
  return made;
}

/** The map's colour at a longitude `u` (0 → 1, wrapping) and a latitude row `v` (0 north → 1 south), smoothly between four texels. */
function sample(t: Texture, u: number, v: number, out: [number, number, number]): void {
  const x = (((u * t.width - 0.5) % t.width) + t.width) % t.width;
  const y = Math.min(t.height - 1.001, Math.max(0, v * t.height - 0.5));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = (x0 + 1) % t.width;
  const fx = x - x0;
  const fy = y - y0;
  for (let k = 0; k < 3; k++) {
    const a = mix(t.data[(y0 * t.width + x0) * 4 + k], t.data[(y0 * t.width + x1) * 4 + k], fx);
    const b = mix(t.data[((y0 + 1) * t.width + x0) * 4 + k], t.data[((y0 + 1) * t.width + x1) * 4 + k], fx);
    out[k] = mix(a, b, fy);
  }
}

/** Paints the planet: the style's map wrapped round a sphere turned by the planet's seed, lit from the upper left, with a rim of atmosphere. Null until the map is there. */
function bake(p: Planet, ps: number): HTMLCanvasElement | null {
  const map = texture(p.style === 'gas' ? 'gas' : p.style === 'ice' ? 'ice' : 'rock');
  if (!map) return null;
  const R = p.radius * ps;
  const reach = R * (1 + GLOW);
  const size = Math.ceil(reach * 2 + 4);
  const half = size / 2;
  const rng = createRng(p.seed);
  const spin = rng() * Math.PI * 2;
  const tilt = range(rng, -0.35, 0.35);
  const [tr, tg, tb] = hexToRgb(p.tint);
  const mean = (tr + tg + tb) / 3 || 1;
  // The map's own colours, nudged towards the planet's tint so two planets of a style are not twins.
  const gain = [mix(1, tr / mean, 0.45), mix(1, tg / mean, 0.45), mix(1, tb / mean, 0.45)];
  const rim = ATMOSPHERE[p.style] ?? ATMOSPHERE.rocky;
  const specular = p.style === 'ice' ? 0.35 : 0;

  const sphere = document.createElement('canvas');
  sphere.width = sphere.height = size;
  const sctx = sphere.getContext('2d')!;
  const img = sctx.createImageData(size, size);
  const cs = Math.cos(spin);
  const sn = Math.sin(spin);
  const ct = Math.cos(tilt);
  const st = Math.sin(tilt);
  const half3 = [LIGHT[0], LIGHT[1], LIGHT[2] + 1];
  const hl = Math.hypot(half3[0], half3[1], half3[2]);
  const colour: [number, number, number] = [0, 0, 0];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5 - half) / R;
      const dy = (y + 0.5 - half) / R;
      const rr = dx * dx + dy * dy;
      const dist = Math.sqrt(rr);
      const coverage = smoothstep(1 + 1 / R, 1 - 1 / R, dist);
      if (coverage <= 0) continue;
      const nz = Math.sqrt(Math.max(0, 1 - rr));
      // The point on the sphere, turned about the vertical by the seed and tipped by the tilt, as longitude and latitude.
      const ty = dy * ct + nz * st;
      const tz = -dy * st + nz * ct;
      const tx = dx * cs + tz * sn;
      const tzz = -dx * sn + tz * cs;
      sample(map, Math.atan2(tx, tzz) / (Math.PI * 2) + 0.5, 0.5 + Math.asin(Math.max(-1, Math.min(1, ty))) / Math.PI, colour);
      const lam = dx * LIGHT[0] + dy * LIGHT[1] + nz * LIGHT[2];
      const lit = clamp01(0.06 + 0.98 * Math.max(0, lam) ** 0.85);
      const spec = specular ? specular * Math.max(0, (dx * half3[0] + dy * half3[1] + nz * half3[2]) / hl) ** 36 : 0;
      const fresnel = (1 - nz) ** 2.6 * (0.3 + 0.7 * smoothstep(-0.25, 0.6, lam));
      const i = (y * size + x) * 4;
      for (let k = 0; k < 3; k++) {
        const albedo = Math.min(255, colour[k] * gain[k]);
        img.data[i + k] = Math.min(255, mix(NIGHT[k], albedo, lit) + spec * 255 + rim[k] * fresnel * 0.55);
      }
      img.data[i + 3] = 255 * coverage;
    }
  }
  sctx.putImageData(img, 0, 0);

  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const c = canvas.getContext('2d')!;
  const glow = c.createRadialGradient(half, half, R * 0.9, half, half, reach);
  glow.addColorStop(0, rgba(`#${rim.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`, 0.2));
  glow.addColorStop(1, rgba(`#${rim.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`, 0));
  c.fillStyle = glow;
  c.beginPath();
  c.arc(half, half, reach, 0, Math.PI * 2);
  c.fill();
  c.drawImage(sphere, 0, 0);
  return canvas;
}

/** A planet's sprite in the forged look: baked on first draw once its map has loaded, the luminous planet until then. */
export function renderForgedPlanet(p: Planet, ps: number): PlanetSprite {
  const fallback = renderLuminousPlanet(p, ps);
  let baked: HTMLCanvasElement | null = null;
  return {
    size: fallback.size,
    draw(ctx, x, y, scale, time) {
      baked ??= bake(p, ps);
      if (!baked) {
        fallback.draw(ctx, x, y, scale, time);
        return;
      }
      ctx.drawImage(baked, x - baked.width / scale / 2, y - baked.height / scale / 2, baked.width / scale, baked.height / scale);
    },
  };
}

/** The forged look is the luminous one with the rendered images put in. */
export const forgedStyles: Styles = {
  ...luminousStyles,
  hole: { body: drawForgedHole, glow: drawLuminousHoleGlow },
  defense: { ...luminousStyles.defense, turret: drawForgedTurret },
};

export const forged = engraved('forged', forgedStyles, {
  ...luminousParts,
  planet: renderForgedPlanet,
  ship: drawForgedShip,
  pickup: (ctx, kind, color, time, pulse) => drawLuminousPickup(ctx, kind, color, time, pulse, forgedCoin(), COIN_SPAN),
});
