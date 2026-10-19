import type { PowerUpKind } from '../powerups';

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
};

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
    // A shield: flat top, sides curving to a point.
    ctx.moveTo(x - r * 0.8, y - r * 0.8);
    ctx.lineTo(x + r * 0.8, y - r * 0.8);
    ctx.quadraticCurveTo(x + r * 0.85, y + r * 0.3, x, y + r);
    ctx.quadraticCurveTo(x - r * 0.85, y + r * 0.3, x - r * 0.8, y - r * 0.8);
    ctx.stroke();
  } else if (kind === 'teleport') {
    // A portal: a ring with a bright core.
    ctx.arc(x, y, r * 0.8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, r * 0.3, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === 'blackhole') {
    // A black hole: a dark core inside a bright accretion ring.
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, r * 0.45, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === 'planetkiller') {
    // A planet split open: a disc with a jagged crack through it.
    ctx.arc(x, y, r * 0.85, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - r * 0.2, y - r * 0.9);
    ctx.lineTo(x + r * 0.15, y - r * 0.2);
    ctx.lineTo(x - r * 0.35, y + r * 0.15);
    ctx.lineTo(x + r * 0.25, y + r * 0.9);
    ctx.stroke();
  } else if (kind === 'nebula') {
    // A cloud: overlapping arcs, heavier on one side.
    ctx.arc(x - r * 0.45, y + r * 0.15, r * 0.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x + r * 0.15, y - r * 0.1, r * 0.65, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x + r * 0.6, y + r * 0.3, r * 0.4, 0, Math.PI * 2);
    ctx.stroke();
  } else if (kind === 'piercing') {
    // A missile through broken armor: a shaft with an arrowhead, and a wall split by the gap it made.
    ctx.beginPath();
    ctx.moveTo(x - r * 0.95, y);
    ctx.lineTo(x + r * 0.1, y);
    ctx.moveTo(x - r * 0.05, y - r * 0.5);
    ctx.lineTo(x - r * 0.05, y - r * 0.95);
    ctx.moveTo(x - r * 0.05, y + r * 0.5);
    ctx.lineTo(x - r * 0.05, y + r * 0.95);
    ctx.moveTo(x + r * 0.3, y - r * 0.55);
    ctx.lineTo(x + r * 0.3, y - r * 0.95);
    ctx.moveTo(x + r * 0.3, y + r * 0.55);
    ctx.lineTo(x + r * 0.3, y + r * 0.95);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + r * 0.2, y - r * 0.5);
    ctx.lineTo(x + r, y);
    ctx.lineTo(x + r * 0.2, y + r * 0.5);
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
