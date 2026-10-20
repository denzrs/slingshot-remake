import type { PowerUpKind } from '../powerups';
import { rgba } from './color';

/**
 * Each power-up has a colour and a symbol of its own, so it reads at a glance on the field and in the HUD.
 * Gold is the splitter: the one that changes a shot in flight.
 */
export const POWER_UP_COLORS: Record<PowerUpKind, string> = {
  preview: '#3ff0ff',
  teleport: '#ff4fd8',
  splitter: '#ffd21f',
  repulse: '#ff7a1a',
  shield: '#4dffb0',
  blackhole: '#b99cff',
  planetkiller: '#ff5c5c',
  nebula: '#9be7ff',
  piercing: '#dfe7f5',
  wormhole: '#4db8ff',
};

/**
 * The colours of a wormhole's two portals, one pair per wormhole on the field: the entry set first, the exit
 * set second. The first pair is blue and orange; later pairs differ in both colours, so a wormhole can be told
 * from the others (and a number on each portal says so too, for those who cannot tell the colours apart).
 */
export const PORTAL_PAIRS = [
  { entry: '#4db8ff', exit: '#ff9d3a' },
  { entry: '#5cf08a', exit: '#ff5cd0' },
  { entry: '#ffe14d', exit: '#a98bff' },
  { entry: '#f2f6ff', exit: '#ff3d5a' },
] as const;

/** The portal colours of the wormhole at this place in `world.wormholes` (the palette starts over after the last pair). */
export const portalPair = (index: number): (typeof PORTAL_PAIRS)[number] => PORTAL_PAIRS[index % PORTAL_PAIRS.length];

/** The first pair: the one on the power-up's symbol. */
export const PORTAL_COLORS = PORTAL_PAIRS[0];

/** Draws a power-up's symbol centred on (x, y), about `r` in size, in the current stroke and fill style. */
export function drawPowerUpSymbol(ctx: CanvasRenderingContext2D, kind: PowerUpKind, x: number, y: number, r: number): void {
  ctx.beginPath();
  if (kind === 'preview') {
    // An eye: the path of a shot, watched.
    ctx.moveTo(x - r, y);
    ctx.quadraticCurveTo(x, y - r * 0.95, x + r, y);
    ctx.quadraticCurveTo(x, y + r * 0.95, x - r, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, r * 0.34, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === 'repulse') {
    // A planet with its pull reversed: a small disc, and rays pushing outward.
    ctx.arc(x, y, r * 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    for (const angle of [0.25, 0.75, 1.25, 1.75]) {
      const dx = Math.cos(angle * Math.PI);
      const dy = Math.sin(angle * Math.PI);
      ctx.moveTo(x + dx * r * 0.55, y + dy * r * 0.55);
      ctx.lineTo(x + dx * r, y + dy * r);
    }
    ctx.stroke();
  } else if (kind === 'shield') {
    // A shield that turns shots away: flat top, sides curving to a point, a faint plate behind and a chevron on it.
    const shield = (): void => {
      ctx.moveTo(x - r * 0.8, y - r * 0.8);
      ctx.lineTo(x + r * 0.8, y - r * 0.8);
      ctx.quadraticCurveTo(x + r * 0.85, y + r * 0.3, x, y + r);
      ctx.quadraticCurveTo(x - r * 0.85, y + r * 0.3, x - r * 0.8, y - r * 0.8);
    };
    const alpha = ctx.globalAlpha;
    shield();
    ctx.globalAlpha = alpha * 0.28;
    ctx.fill();
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    shield();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - r * 0.42, y + r * 0.12);
    ctx.lineTo(x, y - r * 0.32);
    ctx.lineTo(x + r * 0.42, y + r * 0.12);
    ctx.stroke();
  } else if (kind === 'teleport') {
    // A portal: a ring with a bright core.
    ctx.arc(x, y, r * 0.8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, r * 0.3, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === 'blackhole') {
    // A black hole: a solid core and three arms of matter winding in, each one closer and fainter than the last.
    const alpha = ctx.globalAlpha;
    ctx.arc(x, y, r * 0.26, 0, Math.PI * 2);
    ctx.fill();
    for (const [radius, from, fade] of [[0.52, 0.1, 1], [0.76, 0.85, 0.8], [1, 1.6, 0.6]] as const) {
      ctx.globalAlpha = alpha * fade;
      ctx.beginPath();
      ctx.arc(x, y, r * radius, Math.PI * from, Math.PI * (from + 1.25));
      ctx.stroke();
    }
    ctx.globalAlpha = alpha;
  } else if (kind === 'planetkiller') {
    // A planet broken in two: the halves drawn apart along a jagged crack, with debris in the gap.
    const rock = r * 0.85;
    const crack: Array<[number, number]> = [
      [0.25, -0.8],
      [-0.05, -0.3],
      [0.2, 0.05],
      [-0.1, 0.4],
      [-0.25, 0.8],
    ];
    const top = Math.atan2(-0.8, 0.25);
    const bottom = Math.atan2(0.8, -0.25);
    for (const side of [-1, 1]) {
      const dx = side * r * 0.14;
      ctx.beginPath();
      if (side < 0) ctx.arc(x + dx, y, rock, bottom, top + Math.PI * 2);
      else ctx.arc(x + dx, y, rock, top, bottom);
      const points = side < 0 ? crack : [...crack].reverse();
      for (const [px, py] of points) ctx.lineTo(x + dx + px * r, y + py * r);
      ctx.closePath();
      ctx.stroke();
    }
    ctx.beginPath();
    for (const [px, py] of [[0.02, -0.55], [-0.04, 0.08], [0.03, 0.62]]) {
      ctx.moveTo(x + px * r + r * 0.09, y + py * r);
      ctx.arc(x + px * r, y + py * r, r * 0.09, 0, Math.PI * 2);
    }
    ctx.fill();
  } else if (kind === 'nebula') {
    // A cloud: one scalloped outline, filled faintly, with points of light inside it.
    const alpha = ctx.globalAlpha;
    const cloud = (): void => {
      ctx.moveTo(x - r * 0.72, y + r * 0.5);
      ctx.bezierCurveTo(x - r * 1.08, y + r * 0.5, x - r * 1.08, y - r * 0.12, x - r * 0.62, y - r * 0.1);
      ctx.bezierCurveTo(x - r * 0.68, y - r * 0.68, x + r * 0.16, y - r * 0.82, x + r * 0.3, y - r * 0.34);
      ctx.bezierCurveTo(x + r * 0.58, y - r * 0.62, x + r * 1.08, y - r * 0.3, x + r * 0.86, y + r * 0.12);
      ctx.bezierCurveTo(x + r * 1.12, y + r * 0.26, x + r * 1.02, y + r * 0.5, x + r * 0.74, y + r * 0.5);
      ctx.closePath();
    };
    cloud();
    ctx.globalAlpha = alpha * 0.25;
    ctx.fill();
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    cloud();
    ctx.stroke();
    ctx.beginPath();
    for (const [px, py] of [[-0.12, -0.18], [0.4, 0.05], [-0.42, 0.22], [0.1, 0.28]]) {
      ctx.moveTo(x + px * r + r * 0.07, y + py * r);
      ctx.arc(x + px * r, y + py * r, r * 0.07, 0, Math.PI * 2);
    }
    ctx.fill();
  } else if (kind === 'wormhole') {
    // Two portals, the blue one and the orange one, tilted to face each other: the doorway pair.
    ctx.save();
    for (const [dx, dy, color] of [[-0.58, 0.24, PORTAL_COLORS.entry], [0.58, -0.24, PORTAL_COLORS.exit]] as const) {
      ctx.beginPath();
      ctx.ellipse(x + dx * r, y + dy * r, r * 0.3, r * 0.7, -0.4, 0, Math.PI * 2);
      ctx.fillStyle = rgba(color, 0.3);
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.stroke();
    }
    ctx.restore();
  } else if (kind === 'piercing') {
    // A round through armor plate: the plate broken where it went, splinters flying, the head out the far side.
    ctx.beginPath();
    ctx.moveTo(x, y - r * 0.95);
    ctx.lineTo(x, y - r * 0.34);
    ctx.moveTo(x, y + r * 0.34);
    ctx.lineTo(x, y + r * 0.95);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - r, y);
    ctx.lineTo(x + r * 0.45, y);
    ctx.moveTo(x + r * 0.3, y - r * 0.5);
    ctx.lineTo(x + r * 0.55, y - r * 0.75);
    ctx.moveTo(x + r * 0.3, y + r * 0.5);
    ctx.lineTo(x + r * 0.55, y + r * 0.75);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + r * 0.35, y - r * 0.28);
    ctx.lineTo(x + r * 1.02, y);
    ctx.lineTo(x + r * 0.35, y + r * 0.28);
    ctx.closePath();
    ctx.fill();
  } else if (kind === 'splitter') {
    ctx.moveTo(x, y + r);
    ctx.lineTo(x, y);
    ctx.moveTo(x, y);
    ctx.lineTo(x - r * 0.85, y - r);
    ctx.moveTo(x, y);
    ctx.lineTo(x, y - r);
    ctx.moveTo(x, y);
    ctx.lineTo(x + r * 0.85, y - r);
    ctx.stroke();
  }
}
