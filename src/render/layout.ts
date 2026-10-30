import { FIELD } from '../sim/config';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where everything goes on a phone held upright. */
export interface PortraitLayout {
  /** Whether the field is turned a quarter round to fill the height. */
  rotated: boolean;
  /** CSS pixels per field unit, and the top-left of the field as it appears on the screen. */
  scale: number;
  offsetX: number;
  offsetY: number;
  /** The room for the HUD: from under the menu button down to the button bar, the whole width. */
  stage: Box;
}

/** Sizes in CSS pixels, before the touch scale `ui`. */
const PAD = 12;
const GAP = 12;
const BUTTON = 46;
const MARGIN = 4;
/** What the HUD needs above the field: the round label and a scoreboard row — and the least it gets on a small phone. */
const HUD_MIN = 124;
const HUD_SQUEEZED = 100;
/** A line under the field for the hint. */
const HINT = 24;
/** Below this height-to-width ratio (a square-ish window) the field is not small enough to need a layout of its own. */
const TALL = 1.3;
/** The turned field has to be this much bigger than the straight one to be worth the turn. */
const WORTH_TURNING = 1.1;

/** The size of the field as it appears on the screen, in field units: turned, its height runs across. */
export const plateUnits = (rotated: boolean): { w: number; h: number } => (rotated ? { w: FIELD.height, h: FIELD.width } : { w: FIELD.width, h: FIELD.height });

/**
 * Held upright the straight field is as wide as the screen and a third as tall. So the field is turned a quarter
 * round whenever that gives it more room: the HUD goes on top, a bar of buttons at the bottom, and the field fills
 * what is between. On a short phone the straight field is the bigger one and stays. Null for a square-ish window:
 * the usual centred field.
 */
export function portraitLayout(width: number, height: number, safe: { top: number; bottom: number }, ui: number): PortraitLayout | null {
  if (height < width * TALL) return null;
  const top = Math.max(safe.top, PAD);
  const bar = Math.max(safe.bottom, PAD) + BUTTON * ui + GAP;
  const stage = { x: 0, y: top, w: width, h: height - bar - top };
  const room = (hud: number): number => stage.h - hud - HINT - GAP;

  const straight = (width - MARGIN * 2) / FIELD.width;
  const turn = (hud: number): number => Math.min((width - MARGIN * 2) / FIELD.height, room(hud) / FIELD.width);
  // The HUD gives up some room before the field would have to.
  const hud = turn(HUD_MIN) >= straight * WORTH_TURNING ? HUD_MIN : turn(HUD_SQUEEZED) >= straight * WORTH_TURNING ? HUD_SQUEEZED : 0;
  const rotated = hud > 0;
  const scale = rotated ? turn(hud) : straight;
  const plate = plateUnits(rotated);
  const above = rotated ? hud : HUD_MIN;
  const slack = Math.max(0, stage.h - above - HINT - plate.h * scale);
  return {
    rotated,
    scale,
    offsetX: (width - plate.w * scale) / 2,
    offsetY: top + above + slack / 2,
    stage,
  };
}

/**
 * The canvas transform (`setTransform`'s a–f) that draws field coordinates: straight, or turned a quarter round so that
 * the field's x runs up the screen and its y to the right. A camera (the killcam) puts its point in the middle of the plate.
 */
export function fieldTransform(
  view: { dpr: number; scale: number; offsetX: number; offsetY: number; rotated?: boolean },
  camera?: { x: number; y: number; zoom: number },
): [number, number, number, number, number, number] {
  const { dpr, scale, offsetX, offsetY } = view;
  const P = dpr * scale * (camera?.zoom ?? 1);
  const [a, b, c, d] = view.rotated ? [0, -1, 1, 0] : [1, 0, 0, 1];
  let e = dpr * offsetX;
  let f = dpr * (offsetY + (view.rotated ? FIELD.width * scale : 0));
  if (camera) {
    const plate = plateUnits(!!view.rotated);
    e = dpr * (offsetX + (plate.w * scale) / 2) - (a * camera.x + c * camera.y) * P;
    f = dpr * (offsetY + (plate.h * scale) / 2) - (b * camera.x + d * camera.y) * P;
  }
  return [a * P, b * P, c * P, d * P, e, f];
}

// ————————————————————————————— The page —————————————————————————————

let probe: HTMLElement | null = null;

/** The notch and the home bar: how far the screen's safe area is inset at the top and the bottom, in CSS pixels. */
export function safeArea(): { top: number; bottom: number } {
  if (!probe) {
    probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) 0 env(safe-area-inset-bottom)';
  }
  if (!probe.isConnected) document.body.append(probe);
  const style = getComputedStyle(probe);
  return { top: parseFloat(style.paddingTop) || 0, bottom: parseFloat(style.paddingBottom) || 0 };
}

/** The stylesheet's enlargement of the touch controls (`--ui`). */
export const touchScale = (): number => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui')) || 1;

/** Tells the stylesheet whether the upright layout is on: the button bar across the foot of the screen. */
export function applyUpright(layout: PortraitLayout | null): void {
  document.documentElement.classList.toggle('upright', !!layout);
}

/** Whether the ray from `from` along `dir` crosses the rectangle within `length`. */
export function rayHitsRect(from: { x: number; y: number }, dir: { x: number; y: number }, length: number, x: number, y: number, w: number, h: number): boolean {
  let near = 0;
  let far = length;
  for (const [origin, d, lo, size] of [[from.x, dir.x, x, w], [from.y, dir.y, y, h]] as const) {
    if (Math.abs(d) < 1e-9) {
      if (origin < lo || origin > lo + size) return false;
      continue;
    }
    const a = (lo - origin) / d;
    const b = (lo + size - origin) / d;
    near = Math.max(near, Math.min(a, b));
    far = Math.min(far, Math.max(a, b));
    if (near > far) return false;
  }
  return true;
}
