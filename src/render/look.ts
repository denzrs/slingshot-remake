/**
 * Which graphics the field is drawn with. `classic` is the original engraved plate, `refined` the v2 look — glowing
 * ships with an engine plume, planets with a moving surface. It is a device preference: it changes pixels only, never the game.
 */
export const LOOKS = ['refined', 'classic'] as const;
export type Look = (typeof LOOKS)[number];

let current: Look = 'classic';

export const getLook = (): Look => current;

export const isRefined = (): boolean => current === 'refined';

export function setLook(look: Look): void {
  current = look;
}

export const isLook = (value: unknown): value is Look => (LOOKS as readonly unknown[]).includes(value);
