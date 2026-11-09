import coinUrl from './forged/coin.webp';
import cracksUrl from './forged/tex-cracks.webp';
import holeUrl from './forged/hole.webp';
import whiteUrl from './forged/white.webp';
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
import texLavaRiversUrl from './forged/tex-lava-rivers.webp';
import texLavaMagmaUrl from './forged/tex-lava-magma.webp';
import texLavaAshUrl from './forged/tex-lava-ash.webp';
import texLavaLockedUrl from './forged/tex-lava-locked.webp';
import texIceLockedUrl from './forged/tex-ice-locked.webp';
import texIceCryoUrl from './forged/tex-ice-cryo.webp';
import texOceanDeepUrl from './forged/tex-ocean-deep.webp';
import texOceanReefUrl from './forged/tex-ocean-reef.webp';
import texRockJungleUrl from './forged/tex-rock-jungle.webp';
import texRockTundraUrl from './forged/tex-rock-tundra.webp';
import texRockSavannaUrl from './forged/tex-rock-savanna.webp';
import texRockAutumnUrl from './forged/tex-rock-autumn.webp';
import texIronCoreUrl from './forged/tex-iron-core.webp';
import texIronRustUrl from './forged/tex-iron-rust.webp';
import texEyeballUrl from './forged/tex-eyeball.webp';
import texHyceanTealUrl from './forged/tex-hycean-teal.webp';
import texHyceanDeepUrl from './forged/tex-hycean-deep.webp';
import texFungalCapsUrl from './forged/tex-fungal-caps.webp';
import texFungalMyceliumUrl from './forged/tex-fungal-mycelium.webp';
import texVolcanicIoUrl from './forged/tex-volcanic-io.webp';
import texVolcanicRedUrl from './forged/tex-volcanic-red.webp';
import texDesertDunesUrl from './forged/tex-desert-dunes.webp';
import texDesertSaltUrl from './forged/tex-desert-salt.webp';
import texAcidLakesUrl from './forged/tex-acid-lakes.webp';
import texAcidSulfurUrl from './forged/tex-acid-sulfur.webp';
import texCarbonGraphiteUrl from './forged/tex-carbon-graphite.webp';
import texCarbonTarUrl from './forged/tex-carbon-tar.webp';
import texCrystalAmethystUrl from './forged/tex-crystal-amethyst.webp';
import texCrystalQuartzUrl from './forged/tex-crystal-quartz.webp';
import texLivingMossUrl from './forged/tex-living-moss.webp';
import texLivingCoralUrl from './forged/tex-living-coral.webp';
import texMachinePanelsUrl from './forged/tex-machine-panels.webp';
import texMachineHiveUrl from './forged/tex-machine-hive.webp';
import droneUrl from './forged/drone.webp';
import droneMaskUrl from './forged/drone-mask.webp';
import turretBarrelUrl from './forged/turret-barrel.webp';
import turretBarrelMaskUrl from './forged/turret-barrel-mask.webp';
import turretBaseUrl from './forged/turret-base.webp';
import turretMaskUrl from './forged/turret-mask.webp';

/** The Blender renders of the forged look (`scripts/forged/` makes them), loaded on first use. */

const URLS = {
  coin: coinUrl,
  cracks: cracksUrl,
  hole: holeUrl,
  white: whiteUrl,
  ship: shipUrl,
  shipMask: shipMaskUrl,
  drone: droneUrl,
  droneMask: droneMaskUrl,
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
  lavaRivers: texLavaRiversUrl,
  lavaMagma: texLavaMagmaUrl,
  lavaAsh: texLavaAshUrl,
  lavaLocked: texLavaLockedUrl,
  iceLocked: texIceLockedUrl,
  iceCryo: texIceCryoUrl,
  oceanDeep: texOceanDeepUrl,
  oceanReef: texOceanReefUrl,
  desertDunes: texDesertDunesUrl,
  desertSalt: texDesertSaltUrl,
  acidLakes: texAcidLakesUrl,
  acidSulfur: texAcidSulfurUrl,
  carbonGraphite: texCarbonGraphiteUrl,
  carbonTar: texCarbonTarUrl,
  crystalAmethyst: texCrystalAmethystUrl,
  crystalQuartz: texCrystalQuartzUrl,
  livingMoss: texLivingMossUrl,
  livingCoral: texLivingCoralUrl,
  machinePanels: texMachinePanelsUrl,
  machineHive: texMachineHiveUrl,
  rockJungle: texRockJungleUrl,
  rockTundra: texRockTundraUrl,
  rockSavanna: texRockSavannaUrl,
  rockAutumn: texRockAutumnUrl,
  ironCore: texIronCoreUrl,
  ironRust: texIronRustUrl,
  eyeball: texEyeballUrl,
  hyceanTeal: texHyceanTealUrl,
  hyceanDeep: texHyceanDeepUrl,
  fungalCaps: texFungalCapsUrl,
  fungalMycelium: texFungalMyceliumUrl,
  volcanicIo: texVolcanicIoUrl,
  volcanicRed: texVolcanicRedUrl,
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
