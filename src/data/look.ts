import type { Key } from '../platform/i18n';

/**
 * Which graphics the field is drawn with. `classic` is the original engraved plate; `luminous` draws light instead of
 * ink; `forged` puts renders of the ships, planets and more under the luminous light; `holo` projects the field in thin
 * lines and hexagons. It is a device preference: it changes pixels only, never the game, and only the field: the menus,
 * the HUD and the tutorial stay as they are.
 *
 * How a look draws lives in `render/looks/`; this list is the one place that names them for the data layer. A look also
 * needs a name in the settings, `settings.look<Name>`, in both languages (`lookLabelKey`, checked by the type).
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

/** The text of a look's name in the settings: `settings.lookClassic` for `classic`. Every look must have one, which the type checks. */
export const lookLabelKey = (look: Look): Key => `settings.look${look[0].toUpperCase()}${look.slice(1)}` as `settings.look${Capitalize<Look>}`;
