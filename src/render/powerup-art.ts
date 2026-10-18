import type { PowerUpKind } from '../powerups';

/**
 * Each power-up has a colour and a symbol of its own, so it reads at a glance on the field and in the HUD.
 * Gold is the splitter: the one that changes a shot in flight.
 */
export const POWER_UP_COLORS: Record<PowerUpKind, string> = {
  preview: '#3ff0ff',
  teleport: '#ff4fd8',
  splitter: '#ffd21f',
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
  } else if (kind === 'teleport') {
    // A portal: a ring with a bright core.
    ctx.arc(x, y, r * 0.8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, r * 0.3, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // A fork: one shot splitting into three.
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
