import { rgba } from '../color';
import { drawNebula } from '../nebula';
import { drawStormCloud, slot, smooth, stormFlight } from '../storm';
import { paintPortal } from '../wormhole';
import { drawLightPortalGlow } from './forged-light';
import { lightParts } from './forged-parts';

/**
 * The forged look's gas and gateways: the nebula and the sun's storm clouds get light that moves inside them, and a
 * portal gets a spiral of light drawn into it. Each builds on what the light draws (`forged-parts.ts`) and adds over it.
 */

/** A seeded [0, 1) for one slot of a cloud, the same on every screen. */
const at = (seed: number, k: number): number => slot(seed, k);

/** A nebula: the haze, lit again from inside by a second pass of the same gas and by soft flashes of its own colour. */
export function drawForgedNebula(ctx: CanvasRenderingContext2D, n: { x: number; y: number; radius: number; seed: number }, color: string, time: number): void {
  lightParts.nebula!(ctx, n, color, time);
  const base = ctx.globalAlpha;
  // The same haze once more, added up as light, turned the other way.
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = base * 0.3;
  drawNebula(ctx, { ...n, radius: n.radius * 0.92 }, color, -time * 1.3 + 17);
  ctx.restore();
  // Flashes: every few seconds a patch deep in the gas lights up and dies away.
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let k = 0; k < 2; k++) {
    const cycle = time / (3.1 + k * 1.7) + at(n.seed, 30 + k);
    const beat = Math.floor(cycle);
    const phase = cycle - beat;
    if (phase > 0.25) continue;
    const flash = Math.sin((phase / 0.25) * Math.PI);
    const angle = at(n.seed, beat * 3 + k) * Math.PI * 2;
    const dist = n.radius * 0.55 * Math.sqrt(at(n.seed, beat * 5 + k + 7));
    const x = n.x + Math.cos(angle) * dist;
    const y = n.y + Math.sin(angle) * dist;
    const r = n.radius * (0.3 + 0.2 * at(n.seed, beat + 11));
    const glow = ctx.createRadialGradient(x, y, 0, x, y, r);
    glow.addColorStop(0, rgba(color, 0.32 * flash * base));
    glow.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  ctx.restore();
}

/** One cloud of the sun's storm: the plasma already drawn, with a burning heart. */
export function drawForgedStormCloud(ctx: CanvasRenderingContext2D, cloud: { x: number; y: number; radius: number; seed: number }, sun: { x: number; y: number }, age: number, time: number, dissolve: number): void {
  drawStormCloud(ctx, cloud, sun, age, time, dissolve);
  const flight = stormFlight(cloud, sun, age);
  if (!flight) return;
  const { x, y, r, p } = flight;
  const fade = ctx.globalAlpha * smooth(0, 0.3, p) * (1 - dissolve);
  if (fade <= 0.01) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const heart = ctx.createRadialGradient(x, y, 0, x, y, r * 0.8);
  heart.addColorStop(0, `rgba(255,170,70,${0.3 * fade * (0.8 + 0.2 * Math.sin(time * 3 + cloud.seed))})`);
  heart.addColorStop(1, 'rgba(255,90,20,0)');
  ctx.fillStyle = heart;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
  ctx.restore();
}

/** A portal's mouth, in its own frame (`rx`, `ry` its half-axes): the doorway with three arms of light spiralling into the middle. */
export function paintForgedPortal(ctx: CanvasRenderingContext2D, rx: number, ry: number, radius: number, color: string, time: number, alpha: number, phase: number): void {
  paintPortal(ctx, rx, ry, radius, color, time, alpha, phase);
  ctx.globalAlpha = alpha;
  drawLightPortalGlow(ctx, rx, ry, color, time + phase);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  const SEGMENTS = 22;
  for (let arm = 0; arm < 3; arm++) {
    const turn = (arm / 3) * Math.PI * 2 + (time + phase) * 1.7;
    for (let k = 0; k < SEGMENTS; k++) {
      const s0 = k / SEGMENTS;
      const s1 = (k + 1) / SEGMENTS;
      const point = (s: number): [number, number] => {
        const a = turn + s * 4.4;
        const f = 0.95 - s * 0.86;
        return [Math.cos(a) * rx * f, Math.sin(a) * ry * f];
      };
      const [x0, y0] = point(s0);
      const [x1, y1] = point(s1);
      // Brighter and thicker towards the middle.
      ctx.strokeStyle = rgba(color, 0.12 + 0.55 * s1 * s1);
      ctx.lineWidth = 0.8 + 1.8 * s1;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
  }
  const heart = ctx.createRadialGradient(0, 0, 0, 0, 0, ry * 0.5);
  heart.addColorStop(0, 'rgba(255,255,255,0.5)');
  heart.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = heart;
  ctx.scale(rx / ry, 1);
  ctx.beginPath();
  ctx.arc(0, 0, ry * 0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
