import type { Key } from '../platform/i18n';

/**
 * Which graphics the field is drawn with. `classic` is the original engraved plate; `forged` draws light instead of ink and
 * puts renders of the ships, planets and more under it; `holo` projects the field in thin lines and hexagons. It is a device preference: it changes pixels only, never the game, and only the field: the menus,
 * the HUD and the tutorial stay as they are.
 *
 * How a look draws lives in `render/looks/`; this list is the one place that names them for the data layer. A look also
 * needs a name in the settings, `settings.look<Name>`, in both languages (`lookLabelKey`, checked by the type).
 */
export const LOOKS = ['classic', 'forged', 'holo'] as const;
export type Look = (typeof LOOKS)[number];

let current: Look = 'classic';

export const getLook = (): Look => current;

export function setLook(look: Look): void {
  current = look;
}

/**
 * How much of its whole-frame light a look with a post pass lays over the finished field (Forged: `high` bloom and
 * vignette; `low` only the vignette; `off` none), for a device that cannot afford all of it. A ceiling: the look may still
 * step down further on its own when frames lag.
 */
export const POST_LEVELS = ['off', 'low', 'high'] as const;
export type PostLevel = (typeof POST_LEVELS)[number];

let post: PostLevel = 'high';

export const getPostLevel = (): PostLevel => post;

export function setPostLevel(level: PostLevel): void {
  post = level;
}

export const isPostLevel = (value: unknown): value is PostLevel => (POST_LEVELS as readonly unknown[]).includes(value);

export const isLook = (value: unknown): value is Look => (LOOKS as readonly unknown[]).includes(value);

/** The look a stored value names, if it names one: `luminous` (taken out) and `refined` (its old name) carry over to `forged`, which is built on it. */
export const lookFrom = (value: unknown): Look | undefined => (value === 'refined' || value === 'luminous' ? 'forged' : isLook(value) ? value : undefined);

/** The text of a look's name in the settings: `settings.lookClassic` for `classic`. Every look must have one, which the type checks. */
export const lookLabelKey = (look: Look): Key => `settings.look${look[0].toUpperCase()}${look.slice(1)}` as `settings.look${Capitalize<Look>}`;
