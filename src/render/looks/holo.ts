import { COLORS, PHYSICS } from '../../sim/config';
import { rgba } from '../color';
import { blend } from '../nebula';
import { strokePolyline } from '../polyline';
import { POWER_UP_COLORS, drawPowerUpSymbol } from '../powerup-art';
import { slot, smooth, stormFlight } from '../storm';
import { NEBULA_REACH } from '../sun';
import { aimAlpha, aimGeometry, ENGRAVED_EFFECTS, engraved, shotClockEnd } from './classic';
import { LOCATE_PING, type EffectStyle, type LookPainter, type Styles } from './painter';
import {
  holoPolygon,
  drawHoloShip,
  renderHoloPlanet,
  drawHoloSun,
  drawHoloBlackHole,
  drawHoloPickup,
  drawHoloSelection,
  drawHoloShot,
  holoTrailNodes,
  drawHoloPlasma,
  drawHoloShield,
  drawHoloPortal,
  drawHoloNebula,
  drawHoloDefense,
  drawHoloMissile,
  holoBrackets,
  drawHoloTarget,
  drawHoloNeutron,
  drawHoloNova,
  drawHoloPlasmaTrail,
} from './holo-art';

/**
 * The holo look: the engraved plan as a projection. Every element is drawn by `holo-art.ts`; this file says which element
 * is drawn how, and is the one place to look when something in this look should change.
 */

// ---------------------------------------------------------------- the painter ----

/** The disk's tilt is the engraved hole's: `body` draws in that frame. */
const holoStyles: Styles = {
  hole: {
    body: (ctx, R, time) => {
      drawHoloBlackHole(ctx, R, time);
      return true;
    },
  },
  portal: {
    paint: (ctx, rx, ry, _radius, color, time, _alpha, phase) => drawHoloPortal(ctx, rx, ry, color, time + phase),
    threadAlpha: 0.45,
    threadDash: [4, 6],
  },
  defense: { body: drawHoloDefense },
  interception: {
    trailWidth: () => 0.9,
    missile: drawHoloMissile,
    brackets: (ctx, x, y, size, turn) => {
      ctx.lineWidth = 1.3;
      holoBrackets(ctx, x, y, size, turn);
    },
  },
};

/** Shockwaves as hexagons, beams dashed, sparks as thin streaks, the supernova as a plot. */
const holoEffects: EffectStyle = {
  ...ENGRAVED_EFFECTS,
  nova: drawHoloNova,
  ring: (ctx, r, radius, width, t) => {
    // A shock ring drawn as a hexagon, dashed once it has gone a way out.
    ctx.save();
    ctx.translate(r.x, r.y);
    ctx.globalCompositeOperation = 'lighter';
    holoPolygon(ctx, Math.max(0, radius), 6, t * 0.6);
    ctx.setLineDash(t > 0.35 ? [5, 5] : []);
    ctx.strokeStyle = rgba(r.color, 0.85 * (1 - t));
    ctx.lineWidth = Math.max(0.7, width * 0.55);
    ctx.stroke();
    ctx.restore();
  },
  beam: (ctx, b, t) => {
    ctx.beginPath();
    ctx.moveTo(b.x1, b.y1);
    ctx.lineTo(b.x2, b.y2);
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = rgba(b.color, 0.9 * (1 - t));
    ctx.lineWidth = 1.1;
    ctx.stroke();
    ctx.setLineDash([]);
  },
  streak: (speed) => ({ length: Math.min(speed * 0.03, 8) + 1.2, width: 0.9 }),
};

const holoParts: Partial<LookPainter> = {
  note: 'A projection of thin lines and hexagons.',
  planet: renderHoloPlanet,
  effects: holoEffects,
  trail: (ctx, points, wormholes, color, rank, fade) => {
    ctx.strokeStyle = rgba(color, (rank === 0 ? 0.75 : rank === 1 ? 0.38 : 0.2) * fade);
    ctx.lineWidth = rank === 0 ? 1 : 0.8;
    ctx.setLineDash(rank === 0 ? [] : [1.5, 4]);
    strokePolyline(ctx, points, wormholes);
    if (rank === 0) holoTrailNodes(ctx, points, color, 0.7 * fade);
  },
  liveTrail: (ctx, points, wormholes, color, plasma) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = plasma ? 0.8 : 1.2;
    if (plasma) ctx.globalAlpha = 0.45;
    strokePolyline(ctx, points, wormholes);
    ctx.globalAlpha = 1;
    if (!plasma) holoTrailNodes(ctx, points, color, 0.7);
    if (plasma) drawHoloPlasmaTrail(ctx, points, wormholes);
  },
  shot: (ctx, x, y, color, _trail, time) => drawHoloShot(ctx, x, y, color, time),
  plasmaShot: (ctx, x, y, time) => drawHoloPlasma(ctx, x, y, POWER_UP_COLORS.plasma, time),
  piercer: (ctx, x, y, heading, color) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(heading);
    ctx.beginPath();
    ctx.moveTo(13, 0);
    ctx.lineTo(-6, -4);
    ctx.lineTo(-3, 0);
    ctx.lineTo(-6, 4);
    ctx.closePath();
    ctx.lineJoin = 'round';
    // Only the outline, a thin bright line.
    ctx.lineWidth = 1.3;
    ctx.strokeStyle = rgba(COLORS.bone, 0.95);
    ctx.stroke();
    ctx.fillStyle = rgba(color, 0.3);
    ctx.fill();
    ctx.restore();
  },
  splitterRing: (ctx, x, y, time) => {
    ctx.save();
    ctx.strokeStyle = POWER_UP_COLORS.splitter;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.55 + 0.45 * Math.sin(time * 8);
    ctx.translate(x, y);
    holoPolygon(ctx, 12, 6, time * 1.5);
    ctx.stroke();
    ctx.restore();
  },
  spotlightPath: (ctx, part, color) => {
    ctx.strokeStyle = rgba(color, 0.22);
    ctx.lineWidth = 4;
    strokePolyline(ctx, part);
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = rgba(COLORS.bone, 0.95);
    ctx.lineWidth = 1.3;
    strokePolyline(ctx, part);
  },
  spotlightMark: (ctx, x, y, color, pulse) => {
    ctx.strokeStyle = rgba(color, 1 - pulse);
    ctx.lineWidth = 1.3;
    ctx.save();
    ctx.translate(x, y);
    holoPolygon(ctx, 8 + pulse * 18, 6, pulse);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = rgba(COLORS.bone, 0.95);
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  },
  pickup: drawHoloPickup,
  previewPath: (ctx, pts, last, span, color) => {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.1;
    ctx.setLineDash([3, 5]);
    for (let i = 0; i < last; i++) {
      ctx.globalAlpha = 0.9 * Math.max(0, 1 - i / span);
      ctx.beginPath();
      ctx.moveTo(pts[i * 2], pts[i * 2 + 1]);
      ctx.lineTo(pts[i * 2 + 2], pts[i * 2 + 3]);
      ctx.stroke();
      if (i % 3 === 0) {
        ctx.fillStyle = color;
        ctx.fillRect(pts[i * 2] - 1, pts[i * 2 + 1] - 1, 2, 2);
      }
    }
    ctx.restore();
  },
  aimRay: (ctx, x0, y0, x1, y1, locked, time) => {
    ctx.setLineDash(locked ? [10, 7] : [3, 9]);
    ctx.lineDashOffset = -time * (locked ? 70 : 20);
    ctx.globalAlpha = locked ? 0.9 : 0.35;
    ctx.lineWidth = locked ? 1.2 : 0.8;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.setLineDash([]);
  },
  lockBrackets: (ctx, x, y, r, time) => {
    ctx.lineWidth = 1.5;
    holoBrackets(ctx, x, y, r, time * 0.4);
  },
  teleportGhost: (ctx, x, y, color, pulse, time) => {
    // A turning hexagon round a small one, with the crosshair between them.
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(time * 0.6);
    holoPolygon(ctx, 17 + 2.5 * pulse, 6);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = rgba(color, 0.3);
    holoPolygon(ctx, 9, 6);
    ctx.fill();
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.restore();
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - 5, y);
    ctx.lineTo(x + 5, y);
    ctx.moveTo(x, y - 5);
    ctx.lineTo(x, y + 5);
    ctx.stroke();
  },
  blackHoleGhost: (ctx, x, y, r, pulse, time) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(time * 0.4);
    holoPolygon(ctx, r + 4 + 2.5 * pulse, 6);
    ctx.stroke();
    ctx.setLineDash([3, 5]);
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 2.4, r * 0.5, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  },
  nebulaReach: (ctx, x, y, radius) => {
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.save();
    ctx.translate(x, y);
    holoPolygon(ctx, radius, 12);
    ctx.stroke();
    ctx.restore();
  },
  repelRing: (ctx, x, y, radius, phase) => {
    // Hexagons spreading from the planet, dashed.
    ctx.save();
    ctx.translate(x, y);
    ctx.setLineDash([5, 4]);
    holoPolygon(ctx, radius, 6, phase);
    ctx.lineWidth = 1.1;
    ctx.stroke();
    ctx.restore();
  },
  ship: drawHoloShip,
  selection: drawHoloSelection,
  shotClock: (ctx, x, y, color, clock) => {
    const end = shotClockEnd(clock);
    ctx.strokeStyle = clock < 4 ? COLORS.danger : rgba(color, 0.9);
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.arc(x, y, 30, -Math.PI / 2, end);
    ctx.stroke();
    // The end of the arc is marked by a small square in the arc's own colour.
    ctx.fillStyle = ctx.strokeStyle;
    ctx.fillRect(x + Math.cos(end) * 30 - 2, y + Math.sin(end) * 30 - 2, 4, 4);
  },
  locatePing: (ctx, x, y, color, age) => {
    const fade = Math.min(1, (LOCATE_PING.DURATION - age) / 0.5);
    ctx.save();
    ctx.translate(x, y);
    ctx.globalCompositeOperation = 'lighter';
    for (let k = 0; k < LOCATE_PING.RINGS; k++) {
      const t = (age / LOCATE_PING.PERIOD + k / LOCATE_PING.RINGS) % 1;
      const radius = LOCATE_PING.RADIUS * (1 - t) + 14;
      ctx.globalAlpha = fade * t * 0.85;
      ctx.strokeStyle = color;
      // Hexagons instead of circles, dashed as they close in, turning a little.
      holoPolygon(ctx, radius, 6, age * 0.6 + k);
      ctx.setLineDash(t > 0.3 ? [5, 4] : []);
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  },
  pull: (ctx, x, y, color, time, strength, reach) => {
    ctx.save();
    ctx.lineWidth = 1.4;
    for (let k = 0; k < 3; k++) {
      const phase = (time * 0.6 + k / 3) % 1;
      ctx.strokeStyle = rgba(color, (0.12 + 0.28 * strength) * phase);
      ctx.save();
      ctx.translate(x, y);
      holoPolygon(ctx, 18 + (reach - 18) * (1 - phase), 6, phase * 2);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  },
  aimVector: (ctx, x, y, angle, power, color, style, time) => {
    const { d, start, len, ex, ey } = aimGeometry(x, y, angle, power);
    const alpha = aimAlpha(style);
    ctx.strokeStyle = rgba(color, alpha);
    ctx.lineWidth = style === 'full' ? 1.3 : 1;
    ctx.setLineDash(style === 'ghost' ? [] : [4, 4]);
    ctx.lineDashOffset = -time * 12;
    ctx.beginPath();
    ctx.moveTo(x + d.x * start, y + d.y * start);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
    // Measuring ticks along the line, and an outlined arrowhead.
    const px = -d.y;
    const py = d.x;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    for (let s = start + 10; s < len - 6; s += 14) {
      ctx.moveTo(x + d.x * s + px * 2.5, y + d.y * s + py * 2.5);
      ctx.lineTo(x + d.x * s - px * 2.5, y + d.y * s - py * 2.5);
    }
    ctx.stroke();
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(ex + d.x * 7, ey + d.y * 7);
    ctx.lineTo(ex + px * 4, ey + py * 4);
    ctx.lineTo(ex - px * 4, ey - py * 4);
    ctx.closePath();
    ctx.stroke();
  },
  lockedRing: (ctx, x, y) => {
    ctx.save();
    ctx.translate(x, y);
    holoPolygon(ctx, 21, 6);
    ctx.stroke();
    ctx.restore();
  },
  sparedRing: (ctx, x, y, time) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-time * 0.5);
    ctx.setLineDash([2, 4]);
    ctx.strokeStyle = rgba(COLORS.bone, 0.7);
    ctx.lineWidth = 1.4;
    holoPolygon(ctx, 19, 6);
    ctx.stroke();
    ctx.restore();
  },
  target: (ctx, x, y, color, time) => {
    ctx.save();
    ctx.translate(x, y);
    drawHoloTarget(ctx, color, time, PHYSICS.SHIP_RADIUS);
    ctx.restore();
  },
  heldSymbol: (ctx, kind, color, x, y) => {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1.8;
    ctx.lineCap = 'round';
    ctx.lineWidth = 1.1;
    drawPowerUpSymbol(ctx, kind, x, y - 30, 5);
    ctx.translate(x, y - 30);
    ctx.globalAlpha = 0.5;
    holoPolygon(ctx, 9, 6);
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.restore();
  },
  shield: (ctx, x, y, pulse, time) => {
    ctx.save();
    ctx.translate(x, y);
    drawHoloShield(ctx, POWER_UP_COLORS.shield, pulse, time);
    ctx.restore();
  },
  offscreenArrow: (ctx, color, danger, angle) => {
    ctx.save();
    ctx.rotate(angle);
    ctx.scale(1.5, 1.5);
    ctx.beginPath();
    ctx.moveTo(8, 0);
    ctx.lineTo(-5, -6);
    ctx.lineTo(-5, 6);
    ctx.closePath();
    ctx.fillStyle = rgba(danger ? COLORS.bone : color, 0.25);
    ctx.fill();
    ctx.strokeStyle = rgba(danger ? COLORS.bone : color, 0.95);
    ctx.lineWidth = 0.9;
    ctx.stroke();
    ctx.restore();
  },
  sun: drawHoloSun,
  neutronStar: (ctx, star, time, age, alpha) => drawHoloNeutron(ctx, star, time, age, alpha, NEBULA_REACH),
  nebula: (ctx, n, color, time) => drawHoloNebula(ctx, n, blend(color, COLORS.line, 0.3), time),
  stormBurst: (ctx, sun, age) => {
    if (age < 0 || age > 2.2) return;
    ctx.save();
    ctx.translate(sun.x, sun.y);
    ctx.globalCompositeOperation = 'lighter';
    // Hexagons running out from the sun instead of soft rings.
    ctx.setLineDash([8, 6]);
    ctx.lineWidth = 1.3;
    for (const [delay, speed] of [[0, 560], [0.2, 430]] as const) {
      const t = age - delay;
      if (t <= 0) continue;
      const fade = Math.max(0, 1 - t / 1.6) ** 2;
      if (fade <= 0) continue;
      holoPolygon(ctx, sun.radius * 1.2 + t * speed * (1 - 0.35 * Math.min(1, t / 1.6)), 6, t * 0.5);
      ctx.strokeStyle = rgba('#ffb066', 0.9 * fade);
      ctx.stroke();
    }
    ctx.restore();
  },
  stormSparks: (ctx, x, y, time, seed) => {
    const beat = Math.floor(time * 24);
    // The same arcs as the engraved storm's, as one thin line.
    ctx.save();
    ctx.translate(x, y);
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let arc = 0; arc < 2; arc++) {
      const phase = beat * 7 + arc * 19;
      const angle = slot(seed, phase) * Math.PI * 2;
      const length = 6 + slot(seed, phase + 1) * 6;
      ctx.beginPath();
      for (let i = 0; i <= 4; i++) {
        const along = 2 + (length * i) / 4;
        const across = i === 0 || i === 4 ? 0 : (slot(seed, phase + i * 3) - 0.5) * 5;
        const px = Math.cos(angle) * along - Math.sin(angle) * across;
        const py = Math.sin(angle) * along + Math.cos(angle) * across;
        if (i) ctx.lineTo(px, py);
        else ctx.moveTo(px, py);
      }
      ctx.strokeStyle = rgba('#e7fbff', 0.95);
      ctx.lineWidth = 0.9;
      ctx.stroke();
    }
    ctx.restore();
  },
  stormCloud: (ctx, cloud, sun, age, time, dissolve) => {
    const flight = stormFlight(cloud, sun, age);
    if (!flight) return;
    const { p, x, y, r } = flight;
    const base = ctx.globalAlpha;
    // A measured cloud, thrown out along a dashed line from the sun.
    ctx.save();
    if (p < 1) {
      ctx.globalAlpha = base * 0.5 * (1 - p);
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = '#ffb066';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(sun.x, sun.y);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.globalAlpha = base * smooth(0, 0.3, p) * (1 - dissolve);
    drawHoloNebula(ctx, { x, y, radius: r, seed: cloud.seed }, '#ff8a3a', time);
    ctx.restore();
  },
};

export const holo = engraved('holo', holoStyles, holoParts);
