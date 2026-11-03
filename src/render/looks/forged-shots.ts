import { COLORS } from '../../sim/config';
import { isWormholeJump, type Planet, type Wormhole } from '../../sim/physics';
import { rgba } from '../color';
import { strokePolyline } from '../polyline';
import { drawSun } from '../sun';
import { lightParts } from './forged-parts';

/**
 * What flies in the forged look, and the sun it flies past. A shot is a white-hot core in a halo, with a glint across it
 * and a tapering tail of heat that sheds embers; its track cools towards where it began and is run along by pulses of
 * light; a plasma shot crackles. The sun gets rays of light over the plasma and corona it already has.
 */

/** A seeded [0, 1) for one slot, the same every frame. */
const slot = (n: number): number => {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
};

/** The tail is this many points long at most. */
const TAIL = 26;

/** A shot in flight: a hot core, a glint, and a tail that tapers, cools towards its end and sheds embers. */
export function drawForgedShot(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, trail: readonly number[], time: number): void {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const tail = Math.min(TAIL, trail.length / 2 - 1);
  // Three passes over the tail, wide and faint to thin and white-hot, each a little shorter than the one under it.
  for (const [width, alpha, white, reach] of [[4.6, 0.08, 0, 1], [2.2, 0.3, 0, 0.85], [0.9, 0.65, 1, 0.6]] as const) {
    const from = Math.floor(tail * reach);
    for (let k = 0; k < from; k++) {
      const i = trail.length - 2 - k * 2;
      const f = 1 - k / from;
      ctx.strokeStyle = white ? rgba(COLORS.bone, alpha * f * f * f) : rgba(color, alpha * f * f);
      ctx.lineWidth = width * f;
      ctx.beginPath();
      ctx.moveTo(trail[i - 2], trail[i - 1]);
      ctx.lineTo(trail[i], trail[i + 1]);
      ctx.stroke();
    }
  }
  // Embers: specks that come off the tail, drift away from the line as they age and go out.
  for (let j = 0; j < 7; j++) {
    const age = (time * 1.3 + j / 7) % 1;
    const k = Math.min(tail - 1, Math.floor(age * tail));
    const i = trail.length - 2 - k * 2;
    if (i < 2) continue;
    const side = (slot(j + 1) - 0.5) * 2;
    ctx.fillStyle = rgba(j % 3 === 0 ? COLORS.bone : color, 0.8 * (1 - age));
    ctx.beginPath();
    ctx.arc(trail[i] + side * age * 6, trail[i + 1] + (slot(j + 9) - 0.5) * age * 8, 0.9 * (1 - age * 0.6), 0, Math.PI * 2);
    ctx.fill();
  }
  // The head: a halo that breathes, a core, and a glint of light across it.
  const pulse = 0.9 + 0.1 * Math.sin(time * 18 + x * 0.1);
  const halo = ctx.createRadialGradient(x, y, 0, x, y, 12 * pulse);
  halo.addColorStop(0, rgba(COLORS.bone, 0.95));
  halo.addColorStop(0.2, rgba(color, 0.7));
  halo.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = halo;
  ctx.fillRect(x - 13, y - 13, 26, 26);
  const turn = time * 0.7;
  for (let a = 0; a < 2; a++) {
    const dx = Math.cos(turn + (a * Math.PI) / 2) * 10 * pulse;
    const dy = Math.sin(turn + (a * Math.PI) / 2) * 10 * pulse;
    const glint = ctx.createLinearGradient(x - dx, y - dy, x + dx, y + dy);
    glint.addColorStop(0, rgba(COLORS.bone, 0));
    glint.addColorStop(0.5, rgba(COLORS.bone, 0.5));
    glint.addColorStop(1, rgba(COLORS.bone, 0));
    ctx.strokeStyle = glint;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - dx, y - dy);
    ctx.lineTo(x + dx, y + dy);
    ctx.stroke();
  }
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(x, y, 1.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** The recent stretch of a track is drawn segment by segment, so it can brighten towards the shot. */
const RECENT = 70;

/**
 * The track of a shot in flight: the old part a single faint line, the last stretch brightening towards the shot and
 * thickening, and pulses of light running along it towards the shot. A plasma shot keeps the ribbon it already has.
 */
export function drawForgedLiveTrail(ctx: CanvasRenderingContext2D, pts: number[], wormholes: readonly Wormhole[], color: string, plasma: boolean, time: number): void {
  if (plasma) {
    lightParts.liveTrail!(ctx, pts, wormholes, color, plasma, time);
    return;
  }
  const n = pts.length / 2;
  if (n < 2) return;
  const split = Math.max(1, n - RECENT);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // The old track: a wide soft glow under a thin line, both faint.
  const old = pts.slice(0, split * 2 + 2);
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = rgba(color, 0.05);
  ctx.lineWidth = 3.5;
  strokePolyline(ctx, old, wormholes);
  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = rgba(color, 0.4);
  ctx.lineWidth = 1;
  strokePolyline(ctx, old, wormholes);
  // The recent track: hotter and thicker the nearer the shot.
  ctx.globalCompositeOperation = 'lighter';
  for (let k = split; k < n; k++) {
    if (wormholes.length && isWormholeJump(pts, k * 2, wormholes)) continue;
    const f = (k - split + 1) / (n - split);
    ctx.strokeStyle = rgba(color, 0.08 + 0.2 * f);
    ctx.lineWidth = 2 + 2.2 * f;
    ctx.beginPath();
    ctx.moveTo(pts[k * 2 - 2], pts[k * 2 - 1]);
    ctx.lineTo(pts[k * 2], pts[k * 2 + 1]);
    ctx.stroke();
    ctx.strokeStyle = rgba(f > 0.6 ? COLORS.bone : color, 0.3 + 0.6 * f);
    ctx.lineWidth = 0.9 + 0.7 * f;
    ctx.stroke();
  }
  // Pulses: three bright beads that run from the muzzle's end of the glowing stretch to the shot, and start again.
  const span = Math.min(n - 1, RECENT * 2);
  for (let p = 0; p < 3; p++) {
    const at = n - 1 - span + ((time * 38 + (p * span) / 3) % span);
    const k = Math.min(n - 1, Math.max(1, Math.floor(at)));
    if (wormholes.length && isWormholeJump(pts, k * 2, wormholes)) continue;
    const f = (k - (n - 1 - span)) / span;
    const bead = ctx.createRadialGradient(pts[k * 2], pts[k * 2 + 1], 0, pts[k * 2], pts[k * 2 + 1], 3);
    bead.addColorStop(0, rgba(COLORS.bone, 0.75 * f));
    bead.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = bead;
    ctx.fillRect(pts[k * 2] - 3, pts[k * 2 + 1] - 3, 6, 6);
  }
  ctx.restore();
}

/** A plasma shot: a halo, a lumpy body that wobbles, a white core and arcs of lightning that jump about it. */
export function drawForgedPlasmaShot(ctx: CanvasRenderingContext2D, x: number, y: number, time: number): void {
  lightParts.plasmaShot!(ctx, x, y, time);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const heat = ctx.createRadialGradient(x, y, 4, x, y, 26);
  heat.addColorStop(0, 'rgba(34,228,255,0.3)');
  heat.addColorStop(1, 'rgba(34,228,255,0)');
  ctx.fillStyle = heat;
  ctx.fillRect(x - 26, y - 26, 52, 52);
  // The arcs change about twenty times a second: lightning does not glide.
  const beat = Math.floor(time * 20);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let arc = 0; arc < 3; arc++) {
    let a = slot(beat * 7 + arc * 3.1) * Math.PI * 2;
    let r = 4;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    for (let s = 1; s <= 5; s++) {
      a += (slot(beat * 11 + arc * 5 + s) - 0.5) * 1.3;
      r += 2.2 + slot(beat + arc + s * 1.7) * 2.2;
      ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    ctx.strokeStyle = 'rgba(34,228,255,0.35)';
    ctx.lineWidth = 3.2;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(224,255,255,0.9)';
    ctx.lineWidth = 0.9;
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * The sun with light thrown off it: rays that turn slowly against each other and a wide warm wash over the field round it. `flare` (the storm) makes it all stronger.
 */
export function drawForgedSun(ctx: CanvasRenderingContext2D, sun: Planet, time: number, alpha: number, flare: number): void {
  drawSun(ctx, sun, time, alpha, flare);
  const R = sun.radius;
  const giant = sun.giant ?? 0;
  const warm = giant > 0.3 ? '255,90,60' : '255,196,110';
  ctx.save();
  ctx.translate(sun.x, sun.y);
  ctx.globalCompositeOperation = 'lighter';
  const strength = alpha * (1 + flare * 0.9);
  // The wash: light the sun throws over the whole neighbourhood.
  const wash = ctx.createRadialGradient(0, 0, R, 0, 0, R * 15);
  wash.addColorStop(0, `rgba(${warm},${0.045 * strength})`);
  wash.addColorStop(1, `rgba(${warm},0)`);
  ctx.fillStyle = wash;
  ctx.fillRect(-R * 15, -R * 15, R * 30, R * 30);
  // The rays: tapering wedges of light out of the middle, in two layers that turn against each other.
  for (const [count, spin, reach, base] of [[11, 0.018, 9, 0.028], [7, -0.027, 6.5, 0.02]] as const) {
    ctx.save();
    ctx.rotate(time * spin + count);
    for (let k = 0; k < count; k++) {
      const a = (k / count) * Math.PI * 2 + (slot(k + count) - 0.5) * 0.35;
      const width = 0.05 + slot(k * 3 + count) * 0.07;
      const length = R * reach * (0.65 + 0.35 * slot(k * 5 + count + 3)) * (1 + flare * 0.5);
      const breathe = 0.7 + 0.3 * Math.sin(time * (0.6 + slot(k + 20)) + k);
      const ray = ctx.createRadialGradient(0, 0, R * 0.9, 0, 0, length);
      ray.addColorStop(0, `rgba(${warm},${base * breathe * strength})`);
      ray.addColorStop(1, `rgba(${warm},0)`);
      ctx.fillStyle = ray;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, length, a - width, a + width);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
  ctx.restore();
}
