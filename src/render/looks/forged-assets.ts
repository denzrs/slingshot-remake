import coinUrl from './forged/coin.webp';
import holeUrl from './forged/hole.webp';
import shipUrl from './forged/ship.webp';
import shipMaskUrl from './forged/ship-mask.webp';
import texGasUrl from './forged/tex-gas.webp';
import texIceUrl from './forged/tex-ice.webp';
import texRockUrl from './forged/tex-rock.webp';
import texRockDesertUrl from './forged/tex-rock-desert.webp';
import texRockOceanUrl from './forged/tex-rock-ocean.webp';
import texRockMoonUrl from './forged/tex-rock-moon.webp';
import texRockAlienUrl from './forged/tex-rock-alien.webp';
import texGasNeptuneUrl from './forged/tex-gas-neptune.webp';
import texGasVioletUrl from './forged/tex-gas-violet.webp';
import texGasToxicUrl from './forged/tex-gas-toxic.webp';
import texGasCrimsonUrl from './forged/tex-gas-crimson.webp';
import texGasStormyUrl from './forged/tex-gas-stormy.webp';
import texIceGlacierUrl from './forged/tex-ice-glacier.webp';
import texIceMethaneUrl from './forged/tex-ice-methane.webp';
import texIceDustyUrl from './forged/tex-ice-dusty.webp';
import texIceRoseUrl from './forged/tex-ice-rose.webp';
import turretBarrelUrl from './forged/turret-barrel.webp';
import turretBarrelMaskUrl from './forged/turret-barrel-mask.webp';
import turretBaseUrl from './forged/turret-base.webp';
import turretMaskUrl from './forged/turret-mask.webp';

/** The Blender renders of the forged look (`scripts/forged/` makes them), loaded on first use. */

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
  rockDesert: texRockDesertUrl,
  rockOcean: texRockOceanUrl,
  rockMoon: texRockMoonUrl,
  rockAlien: texRockAlienUrl,
  gasNeptune: texGasNeptuneUrl,
  gasViolet: texGasVioletUrl,
  gasToxic: texGasToxicUrl,
  gasCrimson: texGasCrimsonUrl,
  gasStormy: texGasStormyUrl,
  iceGlacier: texIceGlacierUrl,
  iceMethane: texIceMethaneUrl,
  iceDusty: texIceDustyUrl,
  iceRose: texIceRoseUrl,
};
export type Name = keyof typeof URLS;

const images = new Map<Name, HTMLImageElement>();

/** The image of `name`, once it has loaded; null before (the first call starts the load). */
export function image(name: Name): HTMLImageElement | null {
  let img = images.get(name);
  if (!img) {
    img = new Image();
    img.src = URLS[name];
    images.set(name, img);
  }
  return img.complete && img.naturalWidth > 0 ? img : null;
}

const tinted = new Map<string, HTMLCanvasElement>();

/** A render's picture with its paint in `color`: the near-white paint (where `maskName` is white) multiplied, so the lighting of the render stays. */
export function painted(name: Name, maskName: Name, color: string): HTMLCanvasElement | null {
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
