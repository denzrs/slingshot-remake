import { COLORS } from '../config';
import type { Planet } from '../physics';
import { createRng, range } from '../rng';
import { rgba } from './color';

const YELLOW = '#ffe03d';
const AMBER = '#ff9a1f';
const SPOT = '#7a2a0c';

interface Spot {
  angle: number;
  dist: number;
  size: number;
}

/** A sun's sunspots: the same for the same seed. */
const spotsOf = (seed: number): Spot[] => {
  const rng = createRng(seed);
  return Array.from({ length: 4 + Math.floor(rng() * 3) }, () => ({ angle: rng() * Math.PI * 2, dist: Math.sqrt(rng()) * 0.7, size: range(rng, 0.06, 0.15) }));
};
const spotCache = new Map<number, Spot[]>();

/**
 * The sun of the Solar System mode, in the black hole's line-art style: the same wide halo, a flat disc with the
 * bone ring just outside it, a few thick arcs of flare and concentric dashed rings streaming round it, the inner
 * ones faster. Round rings where the hole's disk is tilted: the sun is seen head-on.
 */
export function drawSun(ctx: CanvasRenderingContext2D, sun: Planet, time: number, alpha = 1): void {
  const R = sun.radius;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(sun.x, sun.y);

  // A strong glow: a tight bright one under a wide one.
  ctx.globalCompositeOperation = 'lighter';
  for (const [reach, strength] of [[7, 0.3], [3, 0.55]] as const) {
    const halo = ctx.createRadialGradient(0, 0, R * 0.8, 0, 0, R * reach);
    halo.addColorStop(0, rgba(YELLOW, strength));
    halo.addColorStop(0.4, rgba(AMBER, strength * 0.3));
    halo.addColorStop(1, rgba(AMBER, 0));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(0, 0, R * reach, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';

  // Streaming rings (inner = faster), as the hole's accretion disk.
  const rings = 4;
  for (let i = 0; i < rings; i++) {
    const t = i / (rings - 1);
    const r = R * (1.55 + t * 1.5);
    const color = t < 0.25 ? COLORS.bone : t < 0.6 ? COLORS.sodium : COLORS.players[0];
    ctx.strokeStyle = rgba(color, 0.6 - t * 0.4);
    ctx.lineWidth = Math.max(0.8, R * (0.14 - t * 0.08));
    ctx.setLineDash([R * (0.6 + t), R * (0.3 + t * 0.5)]);
    ctx.lineDashOffset = -time * (60 / (0.6 + t)) * (R / 34);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;

  // Thick arcs of flare close above the surface, drifting slowly round.
  ctx.lineCap = 'round';
  ctx.strokeStyle = rgba(COLORS.sodium, 0.55);
  ctx.lineWidth = R * 0.26;
  for (let i = 0; i < 3; i++) {
    const a = time * 0.12 + (i * Math.PI * 2) / 3;
    ctx.beginPath();
    ctx.arc(0, 0, R * (1.32 + 0.05 * Math.sin(time * 0.8 + i * 2)), a, a + 0.9);
    ctx.stroke();
  }

  // The disc: bright yellow, with convection cells churning in it and a few dark sunspots.
  ctx.fillStyle = YELLOW;
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.clip();
  const pitch = R * 0.3;
  const rng = createRng(sun.seed ^ 0x51ed);
  for (let row = -Math.ceil(R / pitch) - 1; row <= Math.ceil(R / pitch) + 1; row++) {
    for (let col = -Math.ceil(R / pitch) - 1; col <= Math.ceil(R / pitch) + 1; col++) {
      const x = (col + (row % 2 ? 0.5 : 0) + range(rng, -0.3, 0.3)) * pitch;
      const y = row * pitch * 0.87 + range(rng, -0.25, 0.25) * pitch;
      const phase = rng() * Math.PI * 2;
      // Each cell wells up and sinks back: bright when it rises.
      const rise = 0.5 + 0.5 * Math.sin(time * 0.9 + phase);
      const cell = pitch * (0.5 + 0.06 * rise);
      ctx.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
        ctx.lineTo(x + Math.cos(a) * cell, y + Math.sin(a) * cell);
      }
      ctx.closePath();
      ctx.fillStyle = rgba('#fff7b0', 0.25 + 0.4 * rise);
      ctx.fill();
      ctx.strokeStyle = rgba(AMBER, 0.4);
      ctx.lineWidth = Math.max(0.6, R * 0.03);
      ctx.stroke();
    }
  }
  let spots = spotCache.get(sun.seed);
  if (!spots) spotCache.set(sun.seed, (spots = spotsOf(sun.seed)));
  for (const spot of spots) {
    // The sun turns slowly, so the spots drift across; near the rim they are squeezed.
    const a = spot.angle + time * 0.05;
    const x = Math.cos(a) * spot.dist * R;
    const y = Math.sin(a) * spot.dist * R * 0.6;
    const r = spot.size * R;
    ctx.fillStyle = rgba(AMBER, 0.55);
    ctx.beginPath();
    ctx.ellipse(x, y, r * 1.7, r * 1.7 * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = rgba(SPOT, 0.9);
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  ctx.strokeStyle = rgba(COLORS.bone, 0.95);
  ctx.lineWidth = Math.max(1, R * 0.07);
  ctx.beginPath();
  ctx.arc(0, 0, R * 1.07, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}
