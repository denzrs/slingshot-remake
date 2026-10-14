/**
 * The symbols a player shows in an online game. Players pick their own, unlike a room's symbol, and the
 * symbol is drawn in the player's colour. The relay refuses anything else (see
 * `server/protocol-contract.json`, which both sides are checked against).
 */

export const AVATARS = ['rocket', 'satellite', 'alien', 'robot', 'astronaut', 'crosshair', 'bolt', 'gem'] as const;
export type Avatar = (typeof AVATARS)[number];

export const DEFAULT_AVATAR: Avatar = 'rocket';

/**
 * Each symbol's outline on a 24 × 24 grid, as SVG path data (one string per shape). Cut-outs are holes:
 * draw with the even-odd fill rule.
 */
export const AVATAR_PATHS: Record<Avatar, string[]> = {
  rocket: [
    'M12 2c2.6 2.6 3.6 6 3.6 9.6V16h-7.2v-4.4C8.4 8 9.4 4.6 12 2Z',
    'M8.4 12.6 5 16.6V19.4l3.4-1.6Z',
    'M15.6 12.6 19 16.6V19.4l-3.4-1.6Z',
    'M10 16h4l-2 5.4Z',
    'M12 9.6a1.4 1.4 0 1 0 0.01 0Z',
  ],
  satellite: [
    'M9.5 9.5h5v5h-5Z',
    'M2.5 7.5h5.5v5H2.5Z',
    'M16 7.5h5.5v5H16Z',
    'M8 9.5h1.5v5H8Z',
    'M14.5 9.5H16v5h-1.5Z',
    'M11.3 5.5h1.4v4h-1.4Z',
    'M9 2.5h6c0 1.7-1.3 3-3 3s-3-1.3-3-3Z',
  ],
  alien: [
    'M12 2.6c4.5 0 7.6 3.9 7.6 8.6 0 4.8-3.3 8.8-7.6 8.8s-7.6-4-7.6-8.8c0-4.7 3.1-8.6 7.6-8.6Z',
    'M6.6 10.4a2 2.6 0 1 0 4 0a2 2.6 0 1 0 -4 0Z',
    'M13.4 10.4a2 2.6 0 1 0 4 0a2 2.6 0 1 0 -4 0Z',
  ],
  robot: [
    'M6 7.4h12a2.2 2.2 0 0 1 2.2 2.2v8.8a2.2 2.2 0 0 1-2.2 2.2H6a2.2 2.2 0 0 1-2.2-2.2V9.6A2.2 2.2 0 0 1 6 7.4Z',
    'M7.6 11h3v3h-3Z',
    'M13.4 11h3v3h-3Z',
    'M9 16.6h6v1H9Z',
    'M11.2 3.6h1.6v3.8h-1.6Z',
    'M10.8 2.2a1.2 1.2 0 1 0 2.4 0a1.2 1.2 0 1 0 -2.4 0Z',
  ],
  astronaut: [
    'M2.4 12a9.6 9.6 0 1 0 19.2 0a9.6 9.6 0 1 0 -19.2 0Z',
    'M6.6 10.4h10.8a1.2 1.2 0 0 1 1.2 1.2v1.6a4.4 4.4 0 0 1-4.4 4.4h-4.4a4.4 4.4 0 0 1-4.4-4.4v-1.6a1.2 1.2 0 0 1 1.2-1.2Z',
  ],
  crosshair: [
    'M4 12a8 8 0 1 0 16 0a8 8 0 1 0 -16 0Z',
    'M6.4 12a5.6 5.6 0 1 0 11.2 0a5.6 5.6 0 1 0 -11.2 0Z',
    'M10.2 12a1.8 1.8 0 1 0 3.6 0a1.8 1.8 0 1 0 -3.6 0Z',
    'M11 1.2h2v2.6h-2Z',
    'M11 20.2h2v2.6h-2Z',
    'M1.2 11h2.6v2H1.2Z',
    'M20.2 11h2.6v2h-2.6Z',
  ],
  bolt: ['M13.6 1.8 4.8 13.4h5.6L9 22.2l9.4-12.2h-5.6Z'],
  gem: ['M7.2 3.6h9.6l4.6 5.8L12 21.4 2.6 9.4Z'],
};

/** A symbol from storage: anything that is not a known choice is the default. */
export function avatarFrom(value: unknown): Avatar {
  return (AVATARS as readonly unknown[]).includes(value) ? (value as Avatar) : DEFAULT_AVATAR;
}
