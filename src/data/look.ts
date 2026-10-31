/**
 * Which graphics the field is drawn with. `classic` is the original engraved plate; `luminous` draws light instead of
 * ink — glowing ships with an engine plume, planets with a moving surface; `forged` draws the ships, planets, black holes and power-ups from
 * renders and puts the luminous light over them; `holo` projects the field in thin lines, scanlines and a grid. It is a device preference: it changes pixels only, never the game, and only the field: the menus, the HUD and the tutorial stay as they are.
 */
export const LOOKS = ['classic', 'luminous', 'forged', 'holo'] as const;
export type Look = (typeof LOOKS)[number];

let current: Look = 'classic';

export const getLook = (): Look => current;

export function setLook(look: Look): void {
  current = look;
}

export const isLook = (value: unknown): value is Look => (LOOKS as readonly unknown[]).includes(value);

/** The look a stored value names, if it names one: `refined`, the old name of `luminous`, carries over. */
export const lookFrom = (value: unknown): Look | undefined => (value === 'refined' ? 'luminous' : isLook(value) ? value : undefined);
