import { rgba } from '../color';
import type { BorderView, FrameInfo } from './painter';

/**
 * What the holo look puts behind and over the field as a whole, so the field is a projection and not the engraved plate
 * with a projection drawn on it: dark glass, corner brackets (and a wall, where shots bounce) and a faint hex lattice round
 * the plate (never in the field, where the lines of gravity must stay clear), baked into the backdrop, and over the
 * finished field a soft glow on the bright lines. Nothing moves and nothing blinks.
 */

/** The colour of the light the projector throws; the same as the lines of `holo-art.ts`. */
const GLOW = '#7fe8ff';
/** The glass the picture is projected on, as rgb for gradients. */
const GLASS = '0,10,18';

// ----------------------------------------------------------------- backdrop ----

/** A hex of this many CSS pixels from its middle to a corner makes the lattice. */
const CELL = 26;

/** Dark glass over the plate, painted once onto the backdrop (CSS pixels). */
export function paintHoloBackdrop(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.save();
  // The ink of the plate goes teal-black; the stars stay, as if they were behind the glass.
  const veil = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.hypot(w, h) * 0.6);
  veil.addColorStop(0, `rgba(${GLASS},0.45)`);
  veil.addColorStop(1, `rgba(${GLASS},0.7)`);
  ctx.fillStyle = veil;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

/** The lattice in the margin round the plate: the field itself stays clear, so the lines of gravity can be read. */
function paintLattice(ctx: CanvasRenderingContext2D, w: number, h: number, plate: { x: number; y: number; w: number; h: number }): void {
  ctx.save();
  const margin = new Path2D();
  margin.rect(0, 0, w, h);
  margin.rect(plate.x, plate.y, plate.w, plate.h);
  ctx.clip(margin, 'evenodd');

  const colW = Math.sqrt(3) * CELL;
  const rowH = CELL * 1.5;
  const lattice = new Path2D();
  for (let r = 0; r <= Math.ceil(h / rowH); r++) {
    for (let c = 0; c <= Math.ceil(w / colW); c++) {
      const x = c * colW + (r % 2 ? colW / 2 : 0);
      const y = r * rowH;
      for (let k = 0; k < 6; k++) {
        const a = Math.PI / 6 + (k * Math.PI) / 3;
        if (k) lattice.lineTo(x + Math.cos(a) * CELL, y + Math.sin(a) * CELL);
        else lattice.moveTo(x + Math.cos(a) * CELL, y + Math.sin(a) * CELL);
      }
      lattice.closePath();
    }
  }
  // Brightest next to the plate and fading out towards the edges of the screen; a wide faint pass under the line makes it glow.
  const cx = plate.x + plate.w / 2;
  const cy = plate.y + plate.h / 2;
  const fade = (alpha: number): CanvasGradient => {
    const g = ctx.createRadialGradient(cx, cy, Math.min(plate.w, plate.h) / 2, cx, cy, Math.hypot(w, h) / 2);
    g.addColorStop(0, rgba(GLOW, alpha));
    g.addColorStop(1, rgba(GLOW, 0));
    return g;
  };
  for (const [width, alpha] of [[3, 0.03], [1, 0.13]] as const) {
    ctx.strokeStyle = fade(alpha);
    ctx.lineWidth = width;
    ctx.stroke(lattice);
  }
  ctx.restore();
}

// ------------------------------------------------------------------- border ----

/** The frame: brackets in the corners, an outline only where shots bounce off the edge, and the lattice round it. */
export function paintHoloBorder(ctx: CanvasRenderingContext2D, view: BorderView, walls: boolean): void {
  const { scale, offsetX: ox, offsetY: oy, plate } = view;
  const W = plate.w * scale;
  const H = plate.h * scale;
  paintLattice(ctx, view.cssWidth, view.cssHeight, { x: ox, y: oy, w: W, h: H });
  ctx.save();
  // Only a wall is a line: where shots fly out there is no outline, so nothing looks like something they would bounce off.
  if (walls) {
    for (const [width, alpha] of [[4, 0.04], [1, 0.7]] as const) {
      ctx.strokeStyle = rgba(GLOW, alpha);
      ctx.lineWidth = width;
      ctx.strokeRect(ox, oy, W, H);
    }
  }

  const arm = 22;
  for (const [x, y, sx, sy] of [[ox, oy, 1, 1], [ox + W, oy, -1, 1], [ox, oy + H, 1, -1], [ox + W, oy + H, -1, -1]] as const) {
    ctx.beginPath();
    ctx.moveTo(x - sx * 5 + sx * arm, y - sy * 5);
    ctx.lineTo(x - sx * 5, y - sy * 5);
    ctx.lineTo(x - sx * 5, y - sy * 5 + sy * arm);
    for (const [width, alpha] of [[4, 0.05], [1.4, 0.8]] as const) {
      ctx.strokeStyle = rgba(GLOW, alpha);
      ctx.lineWidth = width;
      ctx.stroke();
    }
  }
  ctx.restore();
}

// -------------------------------------------------------------------- post ----

interface Level {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}
/** The glow's work canvases at ¼ and ⅛ of the screen, kept for each size that is drawn. */
const chains = new Map<string, Level[]>();

function chainFor(w: number, h: number): Level[] {
  const key = `${w}×${h}`;
  let chain = chains.get(key);
  if (!chain) {
    if (chains.size >= 4) chains.clear();
    chain = [4, 8].map((d) => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.ceil(w / d));
      canvas.height = Math.max(1, Math.ceil(h / d));
      return { canvas, ctx: canvas.getContext('2d')! };
    });
    chains.set(key, chain);
  }
  return chain;
}

function shrink(from: CanvasImageSource, to: Level): void {
  to.ctx.globalCompositeOperation = 'copy';
  to.ctx.drawImage(from, 0, 0, to.canvas.width, to.canvas.height);
  to.ctx.globalCompositeOperation = 'source-over';
}

/**
 * Over the finished field: a soft glow round the bright lines (the picture shrunk, its dull parts dropped, blurred by
 * shrinking and added back) and a light vignette. The flash and the supernova's white-out make the glow wider.
 */
export function holoPost(ctx: CanvasRenderingContext2D, f: FrameInfo): void {
  const main = ctx.canvas;
  const { plate } = f;
  const [c4, c8] = chainFor(main.width, main.height);
  shrink(main, c4);
  // Squared twice (to the fourth power): only the bright lines stay.
  c4.ctx.globalCompositeOperation = 'multiply';
  for (let i = 0; i < 2; i++) c4.ctx.drawImage(c4.canvas, 0, 0);
  c4.ctx.globalCompositeOperation = 'source-over';
  shrink(c4.canvas, c8);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = Math.min(1, 0.35 + 0.4 * f.flash + 0.3 * f.whiteout);
  ctx.drawImage(c8.canvas, 0, 0, main.width, main.height);

  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  const cx = plate.x + plate.w / 2;
  const cy = plate.y + plate.h / 2;
  const reach = Math.hypot(plate.w, plate.h) * 0.62;
  const vignette = ctx.createRadialGradient(cx, cy, reach * 0.5, cx, cy, reach);
  vignette.addColorStop(0, `rgba(${GLASS},0)`);
  vignette.addColorStop(1, `rgba(${GLASS},0.35)`);
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, main.width, main.height);
  ctx.restore();
}
