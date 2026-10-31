import { COLORS } from '../../sim/config';
import { drawNebula } from '../nebula';
import { rgba } from '../color';
import { strokePolyline } from '../polyline';
import { drawPowerUpSymbol, POWER_UP_COLORS } from '../powerup-art';
import { CLASSIC_PORTAL, paintPortal } from '../wormhole';
import {
  aimAlpha,
  aimGeometry,
  drawEngravedArrow as engravedArrow,
  drawEngravedBlackHoleGhost,
  drawEngravedPiercer,
  drawEngravedPlasmaShot,
  drawEngravedRay,
  drawEngravedRepelRing,
  drawEngravedShotClock,
  drawEngravedSpotlightPath,
  drawEngravedSplitterRing,
  drawEngravedTarget as engravedTarget,
  drawEngravedTeleportGhost,
  drawEngravedTrail,
  drawGlowingLiveTrail,
  ENGRAVED_EFFECTS,
  engraved,
  shotClockEnd,
} from './classic';
import {
  drawLuminousPickup,
  drawLuminousSelection,
  drawLuminousShot,
  drawLuminousShield,
  drawLuminousPortalGlow,
  drawLuminousNebulaGlow,
  drawLuminousDefenseGlow,
  drawLuminousHoleGlow,
  drawLuminousShip,
} from './luminous-art';
import { renderLuminousPlanet } from './luminous-planet';
import { LOCATE_PING, type EffectStyle, type LookPainter, type Styles } from './painter';

/**
 * The luminous look: the engraved plan in light. The drawing lives in `luminous-art.ts`; this file says which element is
 * drawn how, and is the one place to look when something in this look should change. Forged builds on it.
 */

/** What the luminous look changes in the engraved elements: light over the hole, the doorways and the defense's rims, missiles that add up. */
export const luminousStyles: Styles = {
  hole: { glow: drawLuminousHoleGlow },
  portal: {
    paint: (ctx, rx, ry, radius, color, time, alpha, phase) => {
      paintPortal(ctx, rx, ry, radius, color, time, alpha, phase);
      ctx.globalAlpha = alpha;
      drawLuminousPortalGlow(ctx, rx, ry, color, time + phase);
    },
    threadAlpha: CLASSIC_PORTAL.threadAlpha,
    threadDash: CLASSIC_PORTAL.threadDash,
  },
  defense: { glow: drawLuminousDefenseGlow },
  interception: { additive: true },
};

/** Shockwaves, beams and streaks of light that add up. */
const luminousEffects: EffectStyle = {
  ...ENGRAVED_EFFECTS,
  ring: (ctx, r, radius, width, t) => {
    ctx.beginPath();
    ctx.arc(r.x, r.y, Math.max(0, radius), 0, Math.PI * 2);
    // A wave of light: a wide soft band under the ring, and a bright thin core over it.
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = rgba(r.color, 0.16 * (1 - t));
    ctx.lineWidth = width * 4;
    ctx.stroke();
    ctx.strokeStyle = rgba(r.color, 0.8 * (1 - t));
    ctx.lineWidth = width;
    ctx.stroke();
    ctx.strokeStyle = rgba(COLORS.bone, 0.5 * (1 - t));
    ctx.lineWidth = Math.max(0.6, width * 0.35);
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  },
  beam: (ctx, b, t) => {
    ctx.beginPath();
    ctx.moveTo(b.x1, b.y1);
    ctx.lineTo(b.x2, b.y2);
    // A streak of light: a wide soft pass under the line and a white-hot one over it.
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.strokeStyle = rgba(b.color, 0.16 * (1 - t));
    ctx.lineWidth = (3 * (1 - t) + 0.5) * 4;
    ctx.stroke();
    ctx.strokeStyle = rgba(b.color, 0.7 * (1 - t));
    ctx.lineWidth = 3 * (1 - t) + 0.5;
    ctx.stroke();
    ctx.strokeStyle = rgba(COLORS.bone, 0.6 * (1 - t));
    ctx.lineWidth = Math.max(0.6, (3 * (1 - t) + 0.5) * 0.35);
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  },
  streak: (speed, size) => ({ length: Math.min(speed * 0.035, 9) + size * 0.5, width: Math.max(0.8, size * 0.7) }),
};

/** The elements the luminous look draws itself. */
export const luminousParts: Partial<LookPainter> = {
  note: 'Light instead of ink: glows, waves, comet tails.',
  planet: renderLuminousPlanet,
  planetsTurnToSun: true,
  effects: luminousEffects,
  trail: (ctx, points, wormholes, color, rank, fade) => {
    if (rank === 0) {
      // A soft glow under the line itself.
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = rgba(color, 0.1 * fade);
      ctx.lineWidth = 6;
      strokePolyline(ctx, points, wormholes);
      ctx.restore();
    }
    drawEngravedTrail(ctx, points, wormholes, color, rank, fade);
  },
  liveTrail: (ctx, points, wormholes, color, plasma, time) => {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = rgba(color, plasma ? 0.05 : 0.12);
    ctx.lineWidth = 7;
    strokePolyline(ctx, points, wormholes);
    ctx.restore();
    drawGlowingLiveTrail(ctx, points, wormholes, color, plasma, time);
  },
  shot: (ctx, x, y, color, trail) => drawLuminousShot(ctx, x, y, color, trail),
  plasmaShot: (ctx, x, y, time) => drawEngravedPlasmaShot(ctx, x, y, time, true),
  piercer: (ctx, x, y, heading, color) => drawEngravedPiercer(ctx, x, y, heading, color, 9),
  splitterRing: (ctx, x, y, time) => drawEngravedSplitterRing(ctx, x, y, time, true),
  spotlightPath: (ctx, part, color) => drawEngravedSpotlightPath(ctx, part, color, true),
  pickup: (ctx, kind, color, time, pulse) => drawLuminousPickup(ctx, kind, color, time, pulse),
  previewPath: (ctx, pts, last, span, color) => {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.6;
    ctx.setLineDash([3, 5]);
    for (let i = 0; i < last; i++) {
      ctx.globalAlpha = 0.9 * Math.max(0, 1 - i / span);
      ctx.beginPath();
      ctx.moveTo(pts[i * 2], pts[i * 2 + 1]);
      ctx.lineTo(pts[i * 2 + 2], pts[i * 2 + 3]);
      ctx.stroke();
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.setLineDash([]);
      ctx.lineWidth = 6;
      ctx.globalAlpha *= 0.2;
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  },
  aimRay: (ctx, x0, y0, x1, y1, locked, time) => drawEngravedRay(ctx, x0, y0, x1, y1, locked, time, true),
  teleportGhost: (ctx, x, y, color, pulse) => {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const bloom = ctx.createRadialGradient(x, y, 6, x, y, 34);
    bloom.addColorStop(0, rgba(color, 0.4 + 0.15 * pulse));
    bloom.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = bloom;
    ctx.fillRect(x - 34, y - 34, 68, 68);
    ctx.restore();
    drawEngravedTeleportGhost(ctx, x, y, color, pulse);
  },
  blackHoleGhost: (ctx, x, y, r, pulse) => {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = 7;
    ctx.globalAlpha *= 0.18;
    ctx.beginPath();
    ctx.arc(x, y, r + 4 + 2.5 * pulse, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    drawEngravedBlackHoleGhost(ctx, x, y, r, pulse);
  },
  repelRing: (ctx, x, y, radius) => {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = 7;
    ctx.globalAlpha *= 0.2;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    drawEngravedRepelRing(ctx, x, y, radius);
  },
  ship: drawLuminousShip,
  selection: drawLuminousSelection,
  shotClock: (ctx, x, y, color, clock) => {
    drawEngravedShotClock(ctx, x, y, color, clock);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.2;
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.arc(x, y, 30, -Math.PI / 2, shotClockEnd(clock));
    ctx.stroke();
    ctx.restore();
  },
  locatePing: (ctx, x, y, color, age) => {
    const fade = Math.min(1, (LOCATE_PING.DURATION - age) / 0.5);
    ctx.save();
    ctx.translate(x, y);
    ctx.lineWidth = 2;
    ctx.globalCompositeOperation = 'lighter';
    for (let k = 0; k < LOCATE_PING.RINGS; k++) {
      const t = (age / LOCATE_PING.PERIOD + k / LOCATE_PING.RINGS) % 1;
      const radius = LOCATE_PING.RADIUS * (1 - t) + 14;
      ctx.globalAlpha = fade * t * 0.85;
      // The ring closes in, so its light trails outside it: a soft band that fades with the distance.
      const band = ctx.createRadialGradient(0, 0, radius, 0, 0, radius + 22);
      band.addColorStop(0, rgba(color, 0.4));
      band.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = band;
      ctx.beginPath();
      ctx.arc(0, 0, radius + 22, 0, Math.PI * 2);
      ctx.arc(0, 0, radius, 0, Math.PI * 2, true);
      ctx.fill('evenodd');
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = rgba(COLORS.bone, 0.6);
      ctx.lineWidth = 0.8;
      ctx.stroke();
      ctx.lineWidth = 2;
    }
    ctx.restore();
  },
  pull: (ctx, x, y, color, time, strength, reach) => {
    ctx.save();
    ctx.lineWidth = 1.4;
    for (let k = 0; k < 3; k++) {
      const phase = (time * 0.6 + k / 3) % 1;
      ctx.strokeStyle = rgba(color, (0.12 + 0.28 * strength) * phase);
      const radius = 18 + (reach - 18) * (1 - phase);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineWidth = 6;
      ctx.globalAlpha = 0.3;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  },
  aimVector: (ctx, x, y, angle, power, color, style, time) => {
    const { d, start, ex, ey } = aimGeometry(x, y, angle, power);
    const alpha = aimAlpha(style);
    ctx.strokeStyle = rgba(color, alpha);
    ctx.lineWidth = style === 'full' ? 1.3 : 1;
    ctx.setLineDash(style === 'ghost' ? [] : [4, 4]);
    ctx.lineDashOffset = -time * 12;
    ctx.beginPath();
    ctx.moveTo(x + d.x * start, y + d.y * start);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.setLineDash([]);
    ctx.lineWidth = 6;
    ctx.strokeStyle = rgba(color, alpha * 0.2);
    ctx.stroke();
    ctx.restore();
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
    ctx.fillStyle = rgba(color, style === 'full' ? 1 : alpha);
    ctx.beginPath();
    ctx.moveTo(ex + d.x * 7, ey + d.y * 7);
    ctx.lineTo(ex - d.y * 4, ey + d.x * 4);
    ctx.lineTo(ex + d.y * 4, ey - d.x * 4);
    ctx.closePath();
    ctx.fill();
  },
  lockedRing: (ctx, x, y) => {
    ctx.beginPath();
    ctx.arc(x, y, 21, 0, Math.PI * 2);
    ctx.stroke();
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.25;
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.restore();
  },
  target: (ctx, x, y, color, time) => {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const halo = ctx.createRadialGradient(x, y, 4, x, y, 34);
    halo.addColorStop(0, rgba(color, 0.4));
    halo.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = halo;
    ctx.fillRect(x - 34, y - 34, 68, 68);
    ctx.restore();
    engravedTarget(ctx, x, y, color, time);
  },
  heldSymbol: (ctx, kind, color, x, y) => {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1.8;
    ctx.lineCap = 'round';
    ctx.globalCompositeOperation = 'lighter';
    for (const [width, alpha] of [[5, 0.15], [3, 0.3], [1.6, 1]] as const) {
      ctx.globalAlpha = alpha;
      ctx.lineWidth = width;
      drawPowerUpSymbol(ctx, kind, x, y - 30, 5);
    }
    ctx.restore();
  },
  shield: (ctx, x, y, pulse) => {
    ctx.save();
    ctx.translate(x, y);
    drawLuminousShield(ctx, POWER_UP_COLORS.shield, pulse);
    ctx.restore();
  },
  offscreenArrow: (ctx, color, danger, angle) => {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, 22);
    halo.addColorStop(0, rgba(danger ? COLORS.bone : color, 0.35));
    halo.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = halo;
    ctx.fillRect(-22, -22, 44, 44);
    ctx.restore();
    engravedArrow(ctx, color, danger, angle);
  },
  nebula: (ctx, n, color, time) => {
    drawNebula(ctx, n, color, time);
    drawLuminousNebulaGlow(ctx, n, color, time);
  },
};

export const luminous = engraved('luminous', luminousStyles, luminousParts);
