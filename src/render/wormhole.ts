import { rgba } from './color';

const RINGS = 6;
const SPOKES = 10;
/** How far past the rim the spokes reach, as a share of the radius, fading out. */
const REACH = 1.1;

/** Draws both mouths of a wormhole as a grid tube seen end-on: rings and spokes warped inwards, narrowing into a dark throat. */
export function drawWormhole(ctx: CanvasRenderingContext2D, ax: number, ay: number, bx: number, by: number, radius: number, color: string, time: number): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.2;
  for (const [x, y, dir] of [[ax, ay, 1], [bx, by, -1]] as const) {
    // The rings crowd towards the centre, and slide inwards over time as if the tube pulled the grid in.
    const ringRadius = (k: number): number => radius * Math.pow(1 - (k + (time * 0.5) % 1) / (RINGS + 1), 1.8);
    const throat = ringRadius(RINGS);
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(4, 8, 16, 0.85)';
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    // Spokes run from the rim down into the throat, turning slowly.
    ctx.globalAlpha = 0.45;
    ctx.beginPath();
    for (let s = 0; s < SPOKES; s++) {
      const a = dir * time * 0.4 + (s / SPOKES) * Math.PI * 2;
      ctx.moveTo(x + Math.cos(a) * radius, y + Math.sin(a) * radius);
      ctx.lineTo(x + Math.cos(a) * throat, y + Math.sin(a) * throat);
    }
    ctx.stroke();
    // Rings: bright at the rim, fading into the depth.
    for (let k = 0; k < RINGS; k++) {
      ctx.globalAlpha = 0.85 * (1 - (k + (time * 0.5) % 1) / (RINGS + 1));
      ctx.beginPath();
      ctx.arc(x, y, ringRadius(k), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();
    // Outside the rim the spokes carry on and fade away.
    ctx.globalAlpha = 1;
    for (let s = 0; s < SPOKES; s++) {
      const a = dir * time * 0.4 + (s / SPOKES) * Math.PI * 2;
      const [cx, cy] = [Math.cos(a), Math.sin(a)];
      const far = radius * (1 + REACH);
      const fade = ctx.createLinearGradient(x + cx * radius, y + cy * radius, x + cx * far, y + cy * far);
      fade.addColorStop(0, rgba(color, 0.45));
      fade.addColorStop(1, rgba(color, 0));
      ctx.strokeStyle = fade;
      ctx.beginPath();
      ctx.moveTo(x + cx * radius, y + cy * radius);
      ctx.lineTo(x + cx * far, y + cy * far);
      ctx.stroke();
    }
    ctx.strokeStyle = color;
  }
  ctx.restore();
}
