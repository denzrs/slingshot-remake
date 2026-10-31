import { COLORS, SUDDEN_DEATH } from '../../sim/config';
import { isWormholeJump, type Planet, type Wormhole } from '../../sim/physics';
import type { PowerUpKind } from '../../sim/powerups';
import { createRng } from '../../sim/rng';
import { rgba } from '../color';
import type { PlanetSprite } from '../planet-common';
import { drawPowerUpSymbol, POWER_UP_COLORS } from '../powerup-art';
import { SHIP_HULL } from '../ship';
import type { DefenseFrame } from '../defense';
import { easeOut, NOVA_LIFE, type Nova } from '../effects';

/**
 * The holo look: the field as a projection. Thin bright lines over a faint fill, scanlines, dashed rings, hexagons
 * and tick marks; nothing is shaded. Lines are stacked wide-and-faint under narrow-and-bright (cheaper than
 * `shadowBlur`) and added to the plate with 'lighter'. Everything here draws in field units, round the origin of
 * the caller's frame unless it says otherwise.
 */

/** The colour of what belongs to nobody: grid, shock rings, planets without a hue of their own. */
const HOLO_COLOR = '#7fe8ff';

const TAU = Math.PI * 2;

const hullPath = (ctx: CanvasRenderingContext2D): void => {
  ctx.beginPath();
  SHIP_HULL.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
};

/** A regular polygon as the current path, `sides` corners on `radius`, turned by `rotation`. */
export function holoPolygon(ctx: CanvasRenderingContext2D, radius: number, sides: number, rotation = 0): void {
  ctx.beginPath();
  for (let i = 0; i <= sides; i++) {
    const a = rotation + (i / sides) * TAU;
    if (i) ctx.lineTo(Math.cos(a) * radius, Math.sin(a) * radius);
    else ctx.moveTo(Math.cos(a) * radius, Math.sin(a) * radius);
  }
}

/** Strokes the current path as a glowing line: a wide faint pass, a narrower one, then the line itself. */
export function glowLine(ctx: CanvasRenderingContext2D, color: string, width: number, alpha = 1): void {
  // Plainly over the plate, not added: three added passes of a bright colour (a sodium sun) would clip to white.
  const blend = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = 'source-over';
  for (const [scale, a] of [[4.5, 0.08], [2.4, 0.18]] as const) {
    ctx.strokeStyle = rgba(color, a * alpha);
    ctx.lineWidth = width * scale;
    ctx.stroke();
  }
  ctx.strokeStyle = rgba(color, 0.95 * alpha);
  ctx.lineWidth = width;
  ctx.stroke();
  ctx.globalCompositeOperation = blend;
}

/** A ship: its outline in its own colour over a scanned fill, a few afterimages behind, a dashed flame. Nose along +x. */
export function drawHoloShip(ctx: CanvasRenderingContext2D, color: string, time: number, thrust: number, phase: number): void {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineJoin = 'round';
  for (let g = 3; g >= 1; g--) {
    ctx.save();
    ctx.translate(-g * 3.2, 0);
    hullPath(ctx);
    ctx.strokeStyle = rgba(color, 0.13 / g);
    ctx.lineWidth = 0.5;
    ctx.stroke();
    ctx.restore();
  }
  hullPath(ctx);
  ctx.fillStyle = rgba(color, 0.14);
  ctx.fill();
  ctx.save();
  hullPath(ctx);
  ctx.clip();
  ctx.strokeStyle = rgba(color, 0.3);
  ctx.lineWidth = 0.35;
  ctx.beginPath();
  for (let y = -12; y < 13; y += 1.6) {
    ctx.moveTo(-12, y);
    ctx.lineTo(16, y);
  }
  ctx.stroke();
  ctx.fillStyle = rgba(COLORS.bone, 0.4);
  ctx.fillRect(-12, ((time * 0.7 + phase) % 1) * 24 - 12, 28, 1.1);
  ctx.restore();
  hullPath(ctx);
  glowLine(ctx, color, 0.9);
  ctx.strokeStyle = rgba(color, 0.5);
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(15, 0);
  ctx.lineTo(-9, 0);
  ctx.moveTo(-2, -5);
  ctx.lineTo(-2, 5);
  ctx.stroke();
  ctx.fillStyle = rgba(COLORS.bone, 0.9);
  for (const [x, y] of SHIP_HULL) {
    ctx.beginPath();
    ctx.arc(x, y, 0.7, 0, TAU);
    ctx.fill();
  }
  const flick = 0.75 + 0.25 * Math.sin(time * 31 + phase) * Math.sin(time * 17 + phase * 2);
  ctx.strokeStyle = rgba(color, 0.9);
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 1.5]);
  ctx.beginPath();
  ctx.moveTo(-11, 0);
  ctx.lineTo(-11 - (6 + 16 * thrust) * flick, 0);
  ctx.stroke();
  ctx.restore();
}

/** What hue a planet is projected in. */
function planetColor(p: Planet): string {
  if (p.style === 'gas') return HOLO_COLOR;
  if (p.style === 'ice') return '#b8e4ff';
  return '#ffb066';
}

/**
 * A planet as a wireframe globe: parallels, meridians that turn, a sweeping scanline, a dotted ring round it. It sits on
 * a plate-coloured disc, so neither the gravity contours nor the stars run through it. Drawn live, in field units.
 */
export function renderHoloPlanet(p: Planet, ps: number): PlanetSprite {
  const R = p.radius;
  const color = planetColor(p);
  const phase = (p.seed % 97) / 97 * 6;
  return {
    size: Math.ceil(R * 2 * ps + 4),
    draw(ctx, x, y, _ps, time) {
      const t = time + phase;
      ctx.save();
      ctx.translate(x, y);
      ctx.fillStyle = rgba(COLORS.plate, 0.92);
      ctx.beginPath();
      ctx.arc(0, 0, R, 0, TAU);
      ctx.fill();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = rgba(color, 0.07);
      ctx.fill();
      ctx.save();
      ctx.clip();
      ctx.strokeStyle = rgba(color, 0.5);
      ctx.lineWidth = p.style === 'gas' ? 1 : 0.7;
      ctx.beginPath();
      for (const lat of [-0.75, -0.45, -0.15, 0.15, 0.45, 0.75]) {
        const rx = R * Math.sqrt(1 - lat * lat);
        ctx.moveTo(rx, lat * R);
        ctx.ellipse(0, lat * R, rx, rx * 0.2, 0, 0, TAU);
      }
      ctx.stroke();
      ctx.strokeStyle = rgba(color, 0.35);
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = t * 0.35 + (k * Math.PI) / 6;
        ctx.moveTo(Math.abs(Math.cos(a)) * R, 0);
        ctx.ellipse(0, 0, Math.abs(Math.cos(a)) * R, R, 0, 0, TAU);
      }
      ctx.stroke();
      ctx.fillStyle = rgba(color, 0.35);
      ctx.fillRect(-R, -R + ((t * 0.5) % 1) * R * 2, R * 2, 1.2);
      ctx.restore();
      ctx.beginPath();
      ctx.arc(0, 0, R, 0, TAU);
      glowLine(ctx, color, 1.1);
      ctx.strokeStyle = rgba(color, 0.35);
      ctx.lineWidth = 0.7;
      ctx.setLineDash([1.5, 3.5]);
      ctx.lineDashOffset = -t * 2;
      ctx.beginPath();
      ctx.arc(0, 0, R + 4, 0, TAU);
      ctx.stroke();
      ctx.restore();
    },
  };
}

/** The sun as a projected star: a scanned disc, a ring of ticks, dashed orbits turning against each other and a crosshair. */
export function drawHoloSun(ctx: CanvasRenderingContext2D, sun: Planet, time: number, alpha: number, flare: number): void {
  const R = sun.radius;
  const giant = sun.giant ?? 0;
  const color = giant > 0.5 ? COLORS.danger : COLORS.sodium;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(sun.x, sun.y);
  ctx.fillStyle = rgba(COLORS.plate, 0.92);
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, TAU);
  ctx.fill();
  // Warmer towards the middle, so the disc reads as a hot body and not as a grey plate.
  const heat = ctx.createRadialGradient(0, 0, 0, 0, 0, R);
  heat.addColorStop(0, rgba(color, 0.42 + 0.3 * flare));
  heat.addColorStop(1, rgba(color, 0.1 + 0.2 * flare));
  ctx.fillStyle = heat;
  ctx.fill();
  ctx.globalCompositeOperation = 'lighter';
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = rgba(color, 0.28);
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  for (let y = -R; y < R; y += 3) {
    ctx.moveTo(-R, y);
    ctx.lineTo(R, y);
  }
  ctx.stroke();
  ctx.restore();
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, TAU);
  glowLine(ctx, color, 1.4 + 1.5 * flare);
  const ticks = 72;
  ctx.beginPath();
  for (let i = 0; i < ticks; i++) {
    const a = (i / ticks) * TAU + time * 0.15;
    const len = i % 6 === 0 ? 0.26 : 0.1;
    ctx.moveTo(Math.cos(a) * R * 1.12, Math.sin(a) * R * 1.12);
    ctx.lineTo(Math.cos(a) * R * (1.12 + len), Math.sin(a) * R * (1.12 + len));
  }
  ctx.strokeStyle = rgba(color, 0.7);
  ctx.lineWidth = 0.8;
  ctx.stroke();
  ctx.strokeStyle = rgba(color, 0.4);
  ctx.lineWidth = 0.8;
  for (const [mult, on, off, speed] of [[1.7, 6, 10, 9], [2.2, 3, 9, -6], [2.8, 2, 14, 4]] as const) {
    ctx.setLineDash([on, off]);
    ctx.lineDashOffset = -time * speed;
    ctx.beginPath();
    ctx.arc(0, 0, R * mult, 0, TAU);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.strokeStyle = rgba(color, 0.45);
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    ctx.moveTo(dx * R * 1.5, dy * R * 1.5);
    ctx.lineTo(dx * R * 3.4, dy * R * 3.4);
  }
  ctx.stroke();
  if (flare > 0.02) {
    // The storm breaking out: a ring leaves the disc.
    ctx.strokeStyle = rgba(COLORS.bone, 0.6 * flare);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(0, 0, R * (1.3 + 2.2 * (1 - flare)), 0, TAU);
    ctx.stroke();
  }
  ctx.restore();
}

/** One half of the hole's disk as thin elliptical rings with dashes streaming round, crossed by spokes. In the disk's frame. */
function holoDisk(ctx: CanvasRenderingContext2D, R: number, time: number, from: number, to: number): void {
  const rings = 6;
  for (let i = 0; i < rings; i++) {
    const k = i / (rings - 1);
    const rx = R * (1.5 + k * 2.1);
    ctx.strokeStyle = rgba(k < 0.3 ? COLORS.bone : '#b99cff', 0.9 - k * 0.55);
    ctx.lineWidth = 0.8;
    ctx.setLineDash([R * (0.35 + k * 0.5), R * (0.25 + k * 0.4)]);
    ctx.lineDashOffset = -time * (40 / (0.6 + k)) * (R / 16);
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, rx * 0.2, 0, from, to);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.strokeStyle = rgba('#b99cff', 0.3);
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  for (let s = 0; s < 14; s++) {
    const a = from + ((s + 0.5) / 14) * (to - from);
    ctx.moveTo(Math.cos(a) * R * 1.5, Math.sin(a) * R * 1.5 * 0.2);
    ctx.lineTo(Math.cos(a) * R * 3.6, Math.sin(a) * R * 3.6 * 0.2);
  }
  ctx.stroke();
}

/** The hole as a projection: a black horizon in a bright ring, the disk as dashed rings and spokes, the lensed arc over it. Centred, with the disk's tilt applied. */
export function drawHoloBlackHole(ctx: CanvasRenderingContext2D, R: number, time: number): void {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  holoDisk(ctx, R, time, Math.PI, TAU);
  ctx.strokeStyle = rgba('#b99cff', 0.6);
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.ellipse(0, -R * 0.08, R * 1.55, R * 1.42, 0, Math.PI * 1.08, Math.PI * 1.92);
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, TAU);
  ctx.fill();
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.beginPath();
  ctx.arc(0, 0, R * 1.06, 0, TAU);
  glowLine(ctx, COLORS.bone, Math.max(0.8, R * 0.05));
  holoDisk(ctx, R, time, 0, Math.PI);
  ctx.restore();
}

/** A power-up lying on the field: a turning hexagon, a dashed ring round it, the symbol as a thin lit line over a scanned disc. */
export function drawHoloPickup(ctx: CanvasRenderingContext2D, kind: PowerUpKind, color: string, time: number): void {
  ctx.save();
  ctx.fillStyle = rgba(COLORS.plate, 0.7);
  ctx.beginPath();
  ctx.arc(0, 0, 14, 0, TAU);
  ctx.fill();
  ctx.globalCompositeOperation = 'lighter';
  ctx.save();
  ctx.rotate(time * 0.4);
  holoPolygon(ctx, 17, 6);
  glowLine(ctx, color, 1);
  ctx.restore();
  ctx.setLineDash([2, 4]);
  ctx.lineDashOffset = -time * 8;
  ctx.strokeStyle = rgba(color, 0.5);
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.arc(0, 0, 22, 0, TAU);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, 13, 0, TAU);
  ctx.clip();
  ctx.fillStyle = rgba(color, 0.08);
  ctx.fillRect(-14, -14, 28, 28);
  ctx.fillStyle = rgba(color, 0.35);
  ctx.fillRect(-14, -14 + ((time * 0.6) % 1) * 28, 28, 1);
  ctx.restore();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.fillStyle = color;
  for (const [width, alpha] of [[3.6, 0.16], [1.4, 1]] as const) {
    ctx.strokeStyle = rgba(color, alpha);
    ctx.lineWidth = width;
    drawPowerUpSymbol(ctx, kind, 0, 0, 8);
  }
  ctx.restore();
}

/** The ship whose turn it is: a dashed ring turning slowly, tick marks, and four corner brackets that stay put. */
export function drawHoloSelection(ctx: CanvasRenderingContext2D, color: string, time: number): void {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.save();
  ctx.rotate(time * 0.5);
  ctx.setLineDash([4, 5]);
  ctx.strokeStyle = rgba(color, 0.75);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(0, 0, 25, 0, TAU);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
  ctx.strokeStyle = rgba(color, 0.5);
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * TAU;
    const len = i % 6 === 0 ? 4 : 2;
    ctx.moveTo(Math.cos(a) * 29, Math.sin(a) * 29);
    ctx.lineTo(Math.cos(a) * (29 + len), Math.sin(a) * (29 + len));
  }
  ctx.stroke();
  ctx.strokeStyle = rgba(color, 0.95);
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    ctx.moveTo(dx * 38, dy * 38 - dy * 8);
    ctx.lineTo(dx * 38, dy * 38);
    ctx.lineTo(dx * 38 - dx * 8, dy * 38);
  }
  ctx.stroke();
  ctx.restore();
}

/** A shot in flight: a diamond with four ticks and a small ring, turning a little. */
export function drawHoloShot(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, time: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.globalCompositeOperation = 'lighter';
  ctx.rotate(time * 1.2);
  holoPolygon(ctx, 4.2, 4);
  ctx.fillStyle = rgba(color, 0.35);
  ctx.fill();
  glowLine(ctx, color, 1.1);
  ctx.strokeStyle = rgba(COLORS.bone, 0.9);
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2 + Math.PI / 4;
    ctx.moveTo(Math.cos(a) * 6.5, Math.sin(a) * 6.5);
    ctx.lineTo(Math.cos(a) * 9.5, Math.sin(a) * 9.5);
  }
  ctx.stroke();
  ctx.restore();
}

/** Small squares along a finished flight, one every `step` points: the line reads as a measured track. */
export function holoTrailNodes(ctx: CanvasRenderingContext2D, pts: readonly number[], color: string, alpha: number, step = 8): void {
  ctx.fillStyle = rgba(color, alpha);
  for (let k = 0; k < pts.length; k += step * 2) ctx.fillRect(pts[k] - 0.9, pts[k + 1] - 0.9, 1.8, 1.8);
}

/** The plasma shot: a pulsing hexagon round a bright dot. */
export function drawHoloPlasma(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, time: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.globalCompositeOperation = 'lighter';
  ctx.rotate(-time * 2);
  holoPolygon(ctx, 6 + 1.2 * Math.sin(time * 14), 6);
  ctx.fillStyle = rgba(color, 0.25);
  ctx.fill();
  glowLine(ctx, color, 1.2);
  ctx.fillStyle = rgba('#e6ffff', 0.95);
  ctx.beginPath();
  ctx.arc(0, 0, 1.8, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/** The shield round a ship: a hexagon-and-dot dome, turning slowly. */
export function drawHoloShield(ctx: CanvasRenderingContext2D, color: string, pulse: number, time: number): void {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.rotate(time * 0.3);
  holoPolygon(ctx, 21, 6);
  ctx.fillStyle = rgba(color, 0.05 + 0.04 * pulse);
  ctx.fill();
  glowLine(ctx, color, 1, 0.6 + 0.3 * pulse);
  ctx.fillStyle = rgba(color, 0.7);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * TAU;
    ctx.fillRect(Math.cos(a) * 21 - 1, Math.sin(a) * 21 - 1, 2, 2);
  }
  ctx.restore();
}

/** A portal as a doorway of lines: the oval's outline, rings turning inside it over a scanned mouth, ticks round the rim. In the portal's frame. */
export function drawHoloPortal(ctx: CanvasRenderingContext2D, rx: number, ry: number, color: string, time: number): void {
  ctx.save();
  ctx.fillStyle = rgba(COLORS.plate, 0.9);
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, TAU);
  ctx.fill();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = rgba(color, 0.08);
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = rgba(color, 0.3);
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  for (let y = -ry; y < ry; y += 2.6) {
    ctx.moveTo(-rx, y);
    ctx.lineTo(rx, y);
  }
  ctx.stroke();
  ctx.fillStyle = rgba(color, 0.35);
  ctx.fillRect(-rx, -ry + ((time * 0.5) % 1) * ry * 2, rx * 2, 1.2);
  ctx.restore();
  ctx.setLineDash([3, 4]);
  ctx.lineWidth = 0.9;
  for (let k = 0; k < 3; k++) {
    const scale = 0.78 - k * 0.2;
    ctx.strokeStyle = rgba(color, 0.7 - k * 0.15);
    ctx.lineDashOffset = -time * (10 + k * 6) * (k % 2 ? -1 : 1);
    ctx.beginPath();
    ctx.ellipse(0, 0, rx * scale, ry * scale, 0, 0, TAU);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, TAU);
  glowLine(ctx, color, 1.2);
  ctx.strokeStyle = rgba(color, 0.7);
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * TAU;
    const len = i % 4 === 0 ? 0.16 : 0.07;
    ctx.moveTo(Math.cos(a) * rx * 1.08, Math.sin(a) * ry * 1.08);
    ctx.lineTo(Math.cos(a) * rx * (1.08 + len), Math.sin(a) * ry * (1.08 + len));
  }
  ctx.stroke();
  ctx.restore();
}

/** A nebula as a measured cloud: a wavering dashed outline and a hexagonal lattice of dots that thins out towards the edge and flickers. */
export function drawHoloNebula(ctx: CanvasRenderingContext2D, n: { x: number; y: number; radius: number; seed: number }, color: string, time: number): void {
  const rng = createRng(n.seed);
  const p1 = rng() * TAU;
  const p2 = rng() * TAU;
  const edge = (a: number): number => 1 + 0.08 * Math.sin(3 * a + p1 + time * 0.2) + 0.05 * Math.sin(5 * a + p2 - time * 0.15);
  ctx.save();
  ctx.translate(n.x, n.y);
  ctx.globalCompositeOperation = 'lighter';
  const step = 10;
  for (let row = -Math.ceil(n.radius / (step * 0.866)); row <= Math.ceil(n.radius / (step * 0.866)); row++) {
    const y = row * step * 0.866;
    for (let col = -Math.ceil(n.radius / step); col <= Math.ceil(n.radius / step); col++) {
      const x = col * step + (row % 2 ? step / 2 : 0);
      const d = Math.hypot(x, y);
      const limit = n.radius * edge(Math.atan2(y, x));
      if (d > limit) continue;
      const depth = 1 - d / limit;
      const flicker = 0.5 + 0.5 * Math.sin(time * 1.3 + x * 0.21 + y * 0.17 + p1);
      ctx.fillStyle = rgba(color, (0.1 + 0.5 * depth) * (0.4 + 0.6 * flicker));
      ctx.fillRect(x - 0.9, y - 0.9, 1.8, 1.8);
    }
  }
  ctx.setLineDash([6, 5]);
  ctx.lineDashOffset = -time * 6;
  ctx.strokeStyle = rgba(color, 0.55);
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i <= 72; i++) {
    const a = (i / 72) * TAU;
    const r = n.radius * edge(a);
    if (i) ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    else ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * A planetary defense as a plot of its area: the three zones as thin rings (the inner one solid with ticks, the others dashed), a
 * hexagonal turret and a barrel, a beam sweeping the inner zone while no missile is out. Drawn at the turret.
 */
export function drawHoloDefense(ctx: CanvasRenderingContext2D, d: DefenseFrame): void {
  const { color, radius, inner, middle, open, out, aim, alert, chasing, kick, time } = d;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.rotate(out);
  for (const [r, alpha] of [[radius, 0.025], [middle, 0.04], [inner, 0.07]] as const) {
    ctx.fillStyle = rgba(color, alpha);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fill();
  }
  const flare = alert ? 0.6 + 0.4 * Math.sin(time * 14) : 0;
  ctx.setLineDash([2, 6]);
  ctx.lineDashOffset = -time * 5;
  ctx.strokeStyle = rgba(color, 0.4 + 0.4 * flare);
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, TAU);
  ctx.stroke();
  ctx.setLineDash([7, 6]);
  ctx.lineDashOffset = time * 7;
  ctx.strokeStyle = rgba(color, 0.55 + 0.4 * flare);
  ctx.beginPath();
  ctx.arc(0, 0, middle, 0, TAU);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(0, 0, inner, Math.PI + open, Math.PI * 3 - open);
  glowLine(ctx, color, 1.1, 0.8 + 0.2 * flare);
  ctx.strokeStyle = rgba(color, 0.55);
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  const span = Math.PI * 2 - open * 2;
  for (let i = 0; i <= 18; i++) {
    const a = Math.PI + open + (i / 18) * span;
    const len = i % 3 === 0 ? 5 : 2.5;
    ctx.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
    ctx.lineTo(Math.cos(a) * (inner - len), Math.sin(a) * (inner - len));
  }
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  if (!chasing) {
    for (let k = 0; k < 4; k++) {
      const a = out + Math.sin(time * 0.9 - k * 0.09);
      ctx.strokeStyle = rgba(color, 0.45 * (1 - k / 4));
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * 7, Math.sin(a) * 7);
      ctx.lineTo(Math.cos(a) * inner * 0.97, Math.sin(a) * inner * 0.97);
      ctx.stroke();
    }
  }
  const hx = Math.cos(out) * 5.5;
  const hy = Math.sin(out) * 5.5;
  ctx.save();
  ctx.translate(hx, hy);
  ctx.fillStyle = rgba(COLORS.plate, 0.9);
  holoPolygon(ctx, 5, 6, out);
  ctx.fill();
  glowLine(ctx, color, 1.1);
  ctx.restore();
  ctx.strokeStyle = rgba(chasing ? COLORS.bone : color, 0.95);
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.moveTo(hx, hy);
  ctx.lineTo(hx + Math.cos(aim) * (13 - kick * 2.5), hy + Math.sin(aim) * (13 - kick * 2.5));
  ctx.stroke();
  ctx.restore();
}

/** A missile: its outline as a thin dart, with a dashed track behind it. In the missile's frame, flying towards +x. */
export function drawHoloMissile(ctx: CanvasRenderingContext2D, color: string, time: number): void {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.beginPath();
  ctx.moveTo(7, 0);
  ctx.lineTo(-4, -2.8);
  ctx.lineTo(-2, 0);
  ctx.lineTo(-4, 2.8);
  ctx.closePath();
  ctx.fillStyle = rgba(color, 0.3);
  ctx.fill();
  ctx.strokeStyle = rgba(COLORS.bone, 0.95);
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.strokeStyle = rgba(color, 0.9);
  ctx.setLineDash([2, 1.5]);
  ctx.beginPath();
  ctx.moveTo(-5, 0);
  ctx.lineTo(-8 - 4 * Math.abs(Math.sin(time * 40)), 0);
  ctx.stroke();
  ctx.restore();
}

/** Square brackets round a target, `size` out from it, turned by `turn`: four corners, each a short L. */
export function holoBrackets(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, turn: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(turn);
  ctx.beginPath();
  for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    ctx.moveTo(dx * size, dy * size - dy * size * 0.45);
    ctx.lineTo(dx * size, dy * size);
    ctx.lineTo(dx * size - dx * size * 0.45, dy * size);
  }
  ctx.stroke();
  ctx.restore();
}

/** The daily challenge's target: a hexagon in the size of the hit box, a turning dashed ring, a small diamond and a crosshair. */
export function drawHoloTarget(ctx: CanvasRenderingContext2D, color: string, time: number, hitRadius: number): void {
  const pulse = 0.5 + 0.5 * Math.sin(time * 2.4);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  holoPolygon(ctx, hitRadius, 6);
  ctx.strokeStyle = rgba(color, 0.55 + 0.3 * pulse);
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.save();
  ctx.rotate(time * 0.5);
  ctx.setLineDash([6, 6]);
  ctx.strokeStyle = rgba(color, 0.5);
  ctx.beginPath();
  ctx.arc(0, 0, 21, 0, TAU);
  ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = rgba(color, 0.7);
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    ctx.moveTo(dx * 8, dy * 8);
    ctx.lineTo(dx * 28, dy * 28);
  }
  ctx.stroke();
  holoPolygon(ctx, 7, 4, Math.PI / 4);
  ctx.fillStyle = rgba(color, 0.4);
  ctx.fill();
  glowLine(ctx, color, 1);
  ctx.restore();
}

/** The neutron star the supernova leaves, as a plot: hexagons pulsing round a small core, two dashed beams sweeping, and the shell of the nebula as a ring of dots growing out. */
export function drawHoloNeutron(ctx: CanvasRenderingContext2D, star: Planet, time: number, age: number, alpha: number, reach: number): void {
  const R = star.radius;
  const grown = 1 - Math.pow(1 - Math.min(1, age / 3.5), 3);
  const shell = reach * (0.15 + 0.85 * grown) * 0.8;
  ctx.save();
  ctx.translate(star.x, star.y);
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = alpha;
  ctx.fillStyle = rgba('#8ec8ff', 0.7 * Math.min(1, age / 0.8));
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * TAU + time * 0.05;
    ctx.fillRect(Math.cos(a) * shell - 0.9, Math.sin(a) * shell - 0.9, 1.8, 1.8);
  }
  ctx.setLineDash([6, 8]);
  ctx.strokeStyle = rgba('#8ec8ff', 0.4 * Math.min(1, age / 0.8));
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.arc(0, 0, shell, 0, TAU);
  ctx.stroke();
  const turn = time * 2.6 + (star.seed % 7);
  ctx.setLineDash([5, 4]);
  ctx.strokeStyle = rgba('#e8f4ff', 0.8 * Math.min(1, age / 1.2));
  ctx.lineWidth = 1;
  for (const side of [0, Math.PI]) {
    ctx.beginPath();
    ctx.moveTo(Math.cos(turn + side) * R * 2, Math.sin(turn + side) * R * 2);
    ctx.lineTo(Math.cos(turn + side) * 200, Math.sin(turn + side) * 200);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  const throb = 0.9 + 0.1 * Math.sin(time * 5.2);
  for (let k = 0; k < 3; k++) {
    holoPolygon(ctx, R * (1.4 + k * 1.2) * throb, 6, time * 0.3 * (k % 2 ? -1 : 1));
    ctx.strokeStyle = rgba('#cfe6ff', 0.8 - k * 0.22);
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(0, 0, R * 0.55, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/** The supernova as a plot: doomed ships as heating outlines, hexagons for the core and the two shockwaves. */
export function drawHoloNova(ctx: CanvasRenderingContext2D, nova: Nova): void {
  const { x, y, age } = nova;
  const fade = Math.max(0, 1 - age / NOVA_LIFE);
  for (const d of nova.doomed) {
    if (d.done) continue;
    const heat = Math.min(1, age / Math.max(0.01, d.at));
    ctx.save();
    ctx.translate(d.x, d.y);
    ctx.globalCompositeOperation = 'lighter';
    holoPolygon(ctx, 16 + 14 * heat, 6, age * 2);
    ctx.strokeStyle = rgba(COLORS.danger, 0.8 * heat);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.rotate((-d.angle * Math.PI) / 180);
    ctx.beginPath();
    SHIP_HULL.forEach(([hx, hy], k) => (k ? ctx.lineTo(hx, hy) : ctx.moveTo(hx, hy)));
    ctx.closePath();
    ctx.fillStyle = rgba(d.color, 0.2 + 0.5 * heat);
    ctx.fill();
    ctx.strokeStyle = rgba('#fff4cc', 0.5 + 0.5 * heat);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }
  if (fade <= 0) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.globalCompositeOperation = 'lighter';
  const core = 40 + 340 * easeOut(Math.min(1, age / 0.7));
  for (let k = 0; k < 3; k++) {
    holoPolygon(ctx, core * (1 - k * 0.25), 6, age + k * 0.3);
    ctx.strokeStyle = rgba('#fff0c0', (0.9 - k * 0.25) * fade);
    ctx.lineWidth = 1.3;
    ctx.stroke();
  }
  ctx.setLineDash([9, 6]);
  for (const [speed, color] of [[1, '#ffffff'], [0.62, COLORS.danger]] as const) {
    const front = SUDDEN_DEATH.NOVA_SPEED * speed * age;
    if (front < 4) continue;
    holoPolygon(ctx, front, 18, age * 0.2);
    ctx.strokeStyle = rgba(color, 0.9 * fade);
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  ctx.restore();
}

/** A plasma shot's track: dashed, with a node every few points, instead of the ribbon. */
export function drawHoloPlasmaTrail(ctx: CanvasRenderingContext2D, pts: number[], wormholes: readonly Wormhole[]): void {
  const n = pts.length / 2;
  if (n < 2) return;
  const from = Math.max(1, n - 48);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = rgba(POWER_UP_COLORS.plasma, 0.85);
  ctx.lineWidth = 1.2;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  for (let k = from; k < n; k++) {
    if (wormholes.length && isWormholeJump(pts, k * 2, wormholes)) ctx.moveTo(pts[k * 2], pts[k * 2 + 1]);
    else if (k === from) ctx.moveTo(pts[k * 2 - 2], pts[k * 2 - 1]);
    else ctx.lineTo(pts[k * 2], pts[k * 2 + 1]);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  holoTrailNodes(ctx, pts.slice(from * 2), POWER_UP_COLORS.plasma, 0.8, 3);
  ctx.restore();
}
