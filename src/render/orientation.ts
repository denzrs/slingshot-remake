/**
 * Held upright on a phone the field is turned a quarter round (its left side at the bottom of the screen), so
 * that it is as big as the screen allows. Everything drawn in field coordinates turns with it, which is what
 * is wanted — except text and symbols, which have to stay upright: these helpers draw those.
 */

let turned = false;

/** Whether the field is turned in the view being drawn. Set once per frame by the renderer. */
export const setTurned = (value: boolean): void => {
  turned = value;
};

export const isTurned = (): boolean => turned;

/** An offset in field units as it appears on the screen: the field's x runs up the screen and its y to the right. */
export function screenOffset(dx: number, dy: number): [number, number] {
  return turned ? [dy, -dx] : [dx, dy];
}

/** Turns the drawing frame back to upright, after it was moved to the spot a symbol is to be drawn at. */
export function uprightFrame(ctx: CanvasRenderingContext2D): void {
  if (turned) ctx.rotate(Math.PI / 2);
}

/** Text at a field point, upright on the screen, `ox`, `oy` (screen directions, field units) away from it. */
export function fillTextUpright(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, ox = 0, oy = 0): void {
  if (!turned) return ctx.fillText(text, x + ox, y + oy);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.PI / 2);
  ctx.fillText(text, ox, oy);
  ctx.restore();
}

export function strokeTextUpright(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, ox = 0, oy = 0): void {
  if (!turned) return ctx.strokeText(text, x + ox, y + oy);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.PI / 2);
  ctx.strokeText(text, ox, oy);
  ctx.restore();
}
