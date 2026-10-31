import { COLORS } from '../../sim/config';
import type { PowerUpKind } from '../../sim/powerups';
import { createRng } from '../../sim/rng';
import { rgba } from '../color';
import { drawPowerUpSymbol } from '../powerup-art';
import { drawEngineFlame, hullPath } from '../ship';

/**
 * Field pieces of the luminous look that have no classic counterpart to branch inside: they draw light (additive
 * halos, stacked strokes) where the classic look draws a plate and a line. Each draws round the origin, in the
 * caller's frame.
 */

/** A power-up lying on the field: a glowing ring with a pulsing halo, a dot circling it and the symbol lit from within. */
export function drawLuminousPickup(ctx: CanvasRenderingContext2D, kind: PowerUpKind, color: string, time: number, pulse: number, coin: CanvasImageSource | null = null, coinSpan = 0): void {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const halo = ctx.createRadialGradient(0, 0, 4, 0, 0, 34);
  halo.addColorStop(0, rgba(color, 0.32 + 0.14 * pulse));
  halo.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = halo;
  ctx.fillRect(-34, -34, 68, 68);
  if (coin) {
    // A rendered coin instead of the dark plate under the ring.
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(coin, -coinSpan / 2, -coinSpan / 2, coinSpan, coinSpan);
    ctx.globalCompositeOperation = 'lighter';
  } else {
    ctx.fillStyle = rgba(COLORS.plate, 0.55);
    ctx.beginPath();
    ctx.arc(0, 0, 15, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const [width, alpha] of [[7, 0.1], [4, 0.2], [2, 0.95]] as const) {
    ctx.strokeStyle = rgba(color, alpha);
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.arc(0, 0, 15, 0, Math.PI * 2);
    ctx.stroke();
  }
  const a = time * 1.4;
  ctx.fillStyle = rgba(COLORS.bone, 0.9);
  ctx.beginPath();
  ctx.arc(Math.cos(a) * 15, Math.sin(a) * 15, 1.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.fillStyle = color;
  for (const [width, alpha] of [[5, 0.14], [3, 0.3], [1.8, 1]] as const) {
    ctx.strokeStyle = rgba(width === 1.8 ? COLORS.bone : color, alpha);
    ctx.lineWidth = width;
    drawPowerUpSymbol(ctx, kind, 0, 0, 8);
  }
  ctx.restore();
}

/** The ship whose turn it is: a ring of dots circling it, each swelling in turn as a wave runs round the ring. */
export function drawLuminousSelection(ctx: CanvasRenderingContext2D, color: string, time: number): void {
  const dots = 12;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = rgba(color, 0.22);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(0, 0, 25, 0, Math.PI * 2);
  ctx.stroke();
  for (let i = 0; i < dots; i++) {
    const angle = (i / dots) * Math.PI * 2 + time * 0.8;
    const swell = 0.5 + 0.5 * Math.sin(time * 2.6 - i * 0.7);
    const x = Math.cos(angle) * (25 + 1.2 * swell);
    const y = Math.sin(angle) * (25 + 1.2 * swell);
    const glow = ctx.createRadialGradient(x, y, 0, x, y, 5);
    glow.addColorStop(0, rgba(color, 0.55 * (0.4 + swell)));
    glow.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(x - 5, y - 5, 10, 10);
    ctx.fillStyle = rgba(COLORS.bone, 0.7 + 0.3 * swell);
    ctx.beginPath();
    ctx.arc(x, y, 0.7 + 0.8 * swell, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** A shot in flight: a bright core in a wide halo, and a short comet tail of the points it has just flown through. */
export function drawLuminousShot(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, trail: readonly number[]): void {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  const tail = Math.min(12, trail.length / 2 - 1);
  for (let k = 0; k < tail; k++) {
    const i = trail.length - 2 - k * 2;
    const f = 1 - k / tail;
    ctx.strokeStyle = rgba(color, 0.55 * f * f);
    ctx.lineWidth = 3.2 * f;
    ctx.beginPath();
    ctx.moveTo(trail[i - 2], trail[i - 1]);
    ctx.lineTo(trail[i], trail[i + 1]);
    ctx.stroke();
  }
  const halo = ctx.createRadialGradient(x, y, 0, x, y, 15);
  halo.addColorStop(0, rgba(COLORS.bone, 0.95));
  halo.addColorStop(0.25, rgba(color, 0.65));
  halo.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = halo;
  ctx.fillRect(x - 15, y - 15, 30, 30);
  ctx.restore();
}

/** The shield round a ship: a ring in light with a faint glow inside it. */
export function drawLuminousShield(ctx: CanvasRenderingContext2D, color: string, pulse: number): void {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const glow = ctx.createRadialGradient(0, 0, 10, 0, 0, 27);
  glow.addColorStop(0, rgba(color, 0.02));
  glow.addColorStop(0.75, rgba(color, 0.14 + 0.06 * pulse));
  glow.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(-27, -27, 54, 54);
  for (const [width, alpha] of [[5, 0.1], [3, 0.2], [1.4, 0.8]] as const) {
    ctx.strokeStyle = rgba(color, alpha * (0.8 + 0.2 * pulse));
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.arc(0, 0, 21, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

/** A portal's bloom: a pulsing halo squeezed to the doorway's oval and a double rim in light. In the portal's frame. */
export function drawLuminousPortalGlow(ctx: CanvasRenderingContext2D, rx: number, ry: number, color: string, time: number): void {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.scale(rx / ry, 1);
  const pulse = 0.75 + 0.25 * Math.sin(time * 2.6);
  const halo = ctx.createRadialGradient(0, 0, ry * 0.8, 0, 0, ry * 2.1);
  halo.addColorStop(0, rgba(color, 0.32 * pulse));
  halo.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(0, 0, ry * 2.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const [width, alpha] of [[8, 0.07], [4.5, 0.14]] as const) {
    ctx.strokeStyle = rgba(color, alpha * pulse);
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

/** A nebula lit from inside: a soft tinted glow over the haze and motes that drift and twinkle in it. */
export function drawLuminousNebulaGlow(ctx: CanvasRenderingContext2D, n: { x: number; y: number; radius: number; seed: number }, color: string, time: number): void {
  const rng = createRng(n.seed);
  ctx.save();
  ctx.translate(n.x, n.y);
  ctx.globalCompositeOperation = 'lighter';
  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, n.radius);
  glow.addColorStop(0, rgba(color, 0.1));
  glow.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, 0, n.radius, 0, Math.PI * 2);
  ctx.fill();
  for (let i = 0; i < 26; i++) {
    const a = rng() * Math.PI * 2 + time * (0.03 + 0.05 * rng());
    const d = Math.sqrt(rng()) * n.radius * 0.85;
    const twinkle = 0.5 + 0.5 * Math.sin(time * (1 + 2 * rng()) + i * 3);
    ctx.fillStyle = rgba(COLORS.bone, 0.5 * twinkle);
    ctx.beginPath();
    ctx.arc(Math.cos(a) * d, Math.sin(a) * d, 0.7 + 0.8 * twinkle, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** A planetary defense's bloom, in the defense's frame (turret at the origin, outside of the planet towards +x): the zones' rims in light. */
export function drawLuminousDefenseGlow(ctx: CanvasRenderingContext2D, color: string, radius: number, inner: number, middle: number, open: number, time: number): void {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const breathe = 0.7 + 0.3 * Math.sin(time * 2.4);
  for (const [width, alpha] of [[7, 0.06], [3.5, 0.12]] as const) {
    ctx.strokeStyle = rgba(color, alpha * breathe);
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.arc(0, 0, inner, Math.PI + open, Math.PI * 3 - open);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, middle, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.stroke();
  }
  const bloom = ctx.createRadialGradient(0, 0, 0, 0, 0, 16);
  bloom.addColorStop(0, rgba(color, 0.5));
  bloom.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = bloom;
  ctx.fillRect(-16, -16, 32, 32);
  ctx.restore();
}

/** The photon ring's bloom, and matter spiralling in over the disk's plane, in light. Drawn in the disk's frame. */
export function drawLuminousHoleGlow(ctx: CanvasRenderingContext2D, R: number, time: number): void {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const [width, alpha] of [[R * 0.3, 0.07], [R * 0.18, 0.14], [R * 0.08, 0.3]] as const) {
    ctx.strokeStyle = rgba(COLORS.bone, alpha);
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.arc(0, 0, R * 1.12, 0, Math.PI * 2);
    ctx.stroke();
  }
  const motes = 18;
  for (let i = 0; i < motes; i++) {
    const age = (time * 0.22 + i / motes) % 1;
    const angle = i * 2.4 + age * 5;
    const reach = R * (4.2 - 3 * age);
    ctx.fillStyle = rgba(COLORS.sodium, 0.7 * Math.sin(age * Math.PI));
    ctx.beginPath();
    ctx.arc(Math.cos(angle) * reach, Math.sin(angle) * reach * 0.2, Math.max(0.8, R * 0.05), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * A ship, luminous, in its own frame (centred, nose along +x): the classic hull in its solid colour, glowing the way
 * the player arrows of the menus do — a soft halo that breathes, a bloom hugging the silhouette and blinking wing lights — with an engine
 * plume behind it: a flame in three layers, always idling and roaring while the ship aims, and embers that fly off
 * the end and die. `thrust` is 0 (idle) to 1 (aiming); `phase` keeps the ships from flickering in step.
 */
export function drawLuminousShip(ctx: CanvasRenderingContext2D, color: string, time: number, thrust: number, phase: number): void {
  const breathe = 0.85 + 0.15 * Math.sin(time * 2.2 + phase);

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  // The glow: a wide soft halo, and the silhouette's own bloom (stacked wide strokes, which cost far less than shadowBlur).
  const halo = ctx.createRadialGradient(0, 0, 3, 0, 0, 30);
  halo.addColorStop(0, rgba(color, 0.3 * breathe));
  halo.addColorStop(0.5, rgba(color, 0.1 * breathe));
  halo.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = halo;
  ctx.fillRect(-30, -30, 60, 60);
  hullPath(ctx);
  ctx.lineJoin = 'round';
  for (const [width, alpha] of [[11, 0.05], [6.5, 0.09], [3.4, 0.15]] as const) {
    ctx.strokeStyle = rgba(color, alpha * breathe);
    ctx.lineWidth = width;
    ctx.stroke();
  }

  drawEngineFlame(ctx, color, time, thrust, phase);
  ctx.restore();

  // The hull: the colour brightening to the nose, a dark edge, a lit spine and a canopy with some depth.
  hullPath(ctx);
  const body = ctx.createLinearGradient(15, 0, -11, 0);
  body.addColorStop(0, rgba(COLORS.bone, 0.95));
  body.addColorStop(0.35, color);
  body.addColorStop(1, rgba(color, 0.78));
  ctx.fillStyle = body;
  ctx.fill();
  ctx.strokeStyle = rgba(COLORS.plate, 0.85);
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.strokeStyle = rgba(COLORS.bone, 0.5);
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(14, 0);
  ctx.lineTo(-9, 0);
  ctx.stroke();
  const canopy = ctx.createLinearGradient(0, -2, 0, 2);
  canopy.addColorStop(0, COLORS.plateLift);
  canopy.addColorStop(1, COLORS.plate);
  ctx.fillStyle = canopy;
  ctx.beginPath();
  ctx.ellipse(4, 0, 3.4, 1.9, 0, 0, Math.PI * 2);
  ctx.fill();

  // Wing lights, blinking in turn.
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const side of [-1, 1]) {
    const on = 0.5 + 0.5 * Math.sin(time * 4 + phase + (side > 0 ? 0 : Math.PI));
    const light = ctx.createRadialGradient(-10.5, side * 10.5, 0, -10.5, side * 10.5, 4.5);
    light.addColorStop(0, rgba(COLORS.bone, 0.95 * on));
    light.addColorStop(0.35, rgba(color, 0.7 * on));
    light.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = light;
    ctx.fillRect(-15.5, side * 10.5 - 5, 10, 10);
  }
  ctx.restore();
}
