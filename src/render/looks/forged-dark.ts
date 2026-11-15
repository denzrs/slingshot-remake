import { COLORS } from '../../sim/config';
import { rgba } from '../color';
import { fbm } from '../noise';
import { fog, tile } from './dark-fog';
import type { DarkMasks } from './painter';

const NW = 200;
const NH = 125;

/** A cloud map: `tint` where the noise is thick. */
function cloudMap(key: string, seed: number, tint: [number, number, number], scale: number): HTMLCanvasElement {
  return tile(key, NW, NH, (c) => {
    const img = c.createImageData(NW, NH);
    for (let y = 0; y < NH; y++) {
      for (let x = 0; x < NW; x++) {
        const v = fbm(x / scale, y / scale, 0, seed, 5);
        const a = Math.min(1, Math.max(0, (v - 0.4) / 0.35));
        const i = (y * NW + x) * 4;
        img.data[i] = tint[0];
        img.data[i + 1] = tint[1];
        img.data[i + 2] = tint[2];
        img.data[i + 3] = a * a * 255;
      }
    }
    c.putImageData(img, 0, 0);
  });
}

/** A map of wisps, white, for light that flows along the edge. */
function wispMap(): HTMLCanvasElement {
  return tile('forged-dark-wisps', 256, 160, (c, w, h) => {
    const img = c.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        // stretched along x, so the light reads as strands; sampled round a cylinder, so the map wraps along x without a seam
        const a0 = (x / w) * Math.PI * 2;
        const R = w / (Math.PI * 2) / 26;
        const v = fbm(Math.cos(a0) * R, y / 9, Math.sin(a0) * R, 53, 4);
        const a = Math.min(1, Math.max(0, (v - 0.45) / 0.3));
        const i = (y * w + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = a * a * 255;
      }
    }
    c.putImageData(img, 0, 0);
  });
}

/**
 * Forged: the matter is a smoke that drinks the light, slow cold veins turning in it. No line marks its edge: where a
 * shot has torn it open, the edge glows softly in the colour of the player who sees it, and strands of brighter light
 * drift through that glow, two layers against each other, so the edge seems to boil gently.
 */
export function drawForgedDark(ctx: CanvasRenderingContext2D, masks: DarkMasks, time: number): void {
  const veins = cloudMap('forged-dark-veins', 7, [58, 52, 96], 22);
  const deep = cloudMap('forged-dark-deep', 31, [20, 14, 34], 40);
  const wisps = wispMap();
  fog(ctx, masks, { scale: 0.34, fps: 4, rimFps: 15, blur: 0.5 }, time, (c, w, h) => {
    c.fillStyle = '#020106';
    c.fillRect(0, 0, w, h);
    c.globalAlpha = 0.6;
    c.drawImage(deep, -40 + Math.cos(time * 0.05) * 30, -30 + Math.sin(time * 0.04) * 20, w + 80, h + 60);
    c.globalAlpha = 0.28;
    c.drawImage(veins, -60 + Math.sin(time * 0.11) * 40, -38 + Math.cos(time * 0.09) * 25, w + 120, h + 76);
    c.globalAlpha = 1;
  }, (c, w, h) => {
    c.fillStyle = masks.color;
    c.globalAlpha = 0.62 + 0.08 * Math.sin(time * 1.3);
    c.fillRect(0, 0, w, h);
    // strands of the player's light flowing through the glow, one layer each way, and a few hot white ones
    const tinted = tintedWisps(wisps, masks.color);
    c.globalCompositeOperation = 'lighter';
    const span = w * 0.6;
    for (const [map, speed, alpha, flip] of [[tinted, 18, 0.8, 1], [tinted, -11, 0.55, -1], [wisps, 26, 0.18, 1]] as const) {
      const off = ((time * speed) % span + span) % span;
      c.globalAlpha = alpha;
      c.save();
      c.scale(1, flip);
      for (let x = -span + off; x < w; x += span) c.drawImage(map, x, flip > 0 ? 0 : -h, span, h);
      c.restore();
    }
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
  });
}

/** The wisps in a player's colour, kept per colour. */
function tintedWisps(wisps: HTMLCanvasElement, color: string): HTMLCanvasElement {
  return tile(`forged-dark-wisps-${color}`, wisps.width, wisps.height, (c, w, h) => {
    c.drawImage(wisps, 0, 0);
    c.globalCompositeOperation = 'source-in';
    c.fillStyle = color;
    c.fillRect(0, 0, w, h);
  });
}

/** Forged: found. Red rings closing in on the ship, their light trailing outside them, as the locating ping does. */
export function drawForgedDarkAlert(ctx: CanvasRenderingContext2D, x: number, y: number, age: number): void {
  const fade = Math.min(1, (3 - age) / 0.6);
  if (fade <= 0) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.globalCompositeOperation = 'lighter';
  for (let k = 0; k < 3; k++) {
    const t = (age * 0.9 + k / 3) % 1;
    const r = 16 + (1 - t) * 40;
    const band = ctx.createRadialGradient(0, 0, r, 0, 0, r + 14);
    band.addColorStop(0, rgba(COLORS.danger, 0.3 * t * fade));
    band.addColorStop(1, rgba(COLORS.danger, 0));
    ctx.fillStyle = band;
    ctx.beginPath();
    ctx.arc(0, 0, r + 14, 0, Math.PI * 2);
    ctx.arc(0, 0, r, 0, Math.PI * 2, true);
    ctx.fill();
    ctx.strokeStyle = rgba(COLORS.danger, 0.85 * t * fade);
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}
