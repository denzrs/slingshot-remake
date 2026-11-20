/**
 * The emblems a tournament team shows, drawn in the team's colour. A set of their own, apart from the players' symbols
 * (`avatars.ts`) and the rooms', so a team never looks like one of its players. The relay refuses anything else (see
 * `server/protocol-contract.json`, which both sides are checked against).
 */

export const EMBLEMS = [
  'shield', 'crown', 'flame', 'chevron', 'trident', 'tower', 'flag', 'mountain',
  'wave', 'anchor', 'sword', 'wing', 'hexagon', 'claw', 'spade', 'arrow',
] as const;
export type Emblem = (typeof EMBLEMS)[number];

export const DEFAULT_EMBLEM: Emblem = 'shield';

/** Three wavy bands, each 2.8 thick, at the heights given. */
const band = (y: number) => `M2 ${y}Q7 ${y - 3} 12 ${y}T22 ${y}V${y + 2.8}Q17 ${y + 5.8} 12 ${y + 2.8}T2 ${y + 2.8}Z`;

/**
 * Each emblem's outline on a 24 × 24 grid, as SVG path data (one string per shape). Cut-outs are holes: draw with the
 * even-odd fill rule.
 */
export const EMBLEM_PATHS: Record<Emblem, string[]> = {
  shield: [
    'M12 2.2 20 5v6.4c0 5-3.4 8.8-8 10.4-4.6-1.6-8-5.4-8-10.4V5Z',
    'M12 6.4 16.4 8v3.4c0 2.8-1.8 5-4.4 6.2Z',
  ],
  crown: ['M3 7.4l4.6 4.2L12 4.4l4.4 7.2L21 7.4l-1.8 10.2H4.8Z', 'M4.8 18.8h14.4v2.2H4.8Z'],
  flame: [
    'M12 2c1 3.4 5.8 5.8 5.8 11.2A5.8 5.8 0 0 1 6.2 13.2c0-2.6 1.2-4.4 2.6-5.6 0 2 .8 3.2 2 3.8C10.4 8 11 4.8 12 2Z',
    'M12 12c1.4 1.4 2.4 2.6 2.4 4a2.4 2.4 0 0 1-4.8 0c0-1.4 1-2.6 2.4-4Z',
  ],
  chevron: ['M3 9.6 12 3l9 6.6v4L12 7l-9 6.6Z', 'M3 17.6 12 11l9 6.6v4L12 15l-9 6.6Z'],
  trident: [
    'M4 3h1.6v5c0 2.4 2 4 6.4 4s6.4-1.6 6.4-4V3H20v5c0 3.6-3 6-8 6s-8-2.4-8-6Z',
    'M11 1.6h2V12h-2Z',
    'M11 14h2v8.4h-2Z',
  ],
  tower: [
    'M5 3h2.6v2.4h2.2V3h4.4v2.4h2.2V3H19v5.4l-2 1.6V21H7V10L5 8.4Z',
    'M10.2 21v-4a1.8 1.8 0 0 1 3.6 0v4Z',
  ],
  flag: [
    'M4.4 2.4h1.8v19.2H4.4Z',
    'M7.4 3.6c2.6-1.2 5 1.4 7.6 1.4 1.6 0 3-.5 4.6-1.2v9c-1.6.7-3 1.2-4.6 1.2-2.6 0-5-2.6-7.6-1.4Z',
  ],
  mountain: ['M1.6 20.4 9 7.4l3.4 5.6 2.6-4 7.4 11.4Z', 'M16 4.6a1.8 1.8 0 1 0 3.6 0a1.8 1.8 0 1 0 -3.6 0Z'],
  wave: [band(5), band(11), band(17)],
  anchor: [
    'M9.4 4.6a2.6 2.6 0 1 0 5.2 0a2.6 2.6 0 1 0 -5.2 0Z',
    'M10.8 4.6a1.2 1.2 0 1 0 2.4 0a1.2 1.2 0 1 0 -2.4 0Z',
    'M11.1 7.2h1.8v12.4h-1.8Z',
    'M7.6 9.4h3.5V11H7.6Z',
    'M12.9 9.4h3.5V11h-3.5Z',
    'M3.4 13.2l2.8-1.4.4 2.8-1.1-.3c.8 2.4 2.8 4 5.6 4.4v1.9C7.3 20.1 4.6 17.6 4 14.3Z',
    'M20.6 13.2l-2.8-1.4-.4 2.8 1.1-.3c-.8 2.4-2.8 4-5.6 4.4v1.9c3.8-.5 6.5-3 7.1-6.3Z',
  ],
  sword: [
    'M12 1.6l1.6 2.4V15h-3.2V4Z',
    'M6.6 15.6h10.8v1.8H6.6Z',
    'M11.1 17.4h1.8v3h-1.8Z',
    'M10.4 20.4h3.2v2h-3.2Z',
  ],
  wing: ['M21 4.4C14 4.4 7 7.4 3.4 13.6c1.6-.4 3-.4 4.4 0-1.6.8-2.8 2-3.6 3.4 1.8-.4 3.4-.4 5 .2-1.2.8-2 1.8-2.6 3 4-.2 8.6-1.8 11.4-5 2.2-2.6 3-6.4 3-10.8Z'],
  hexagon: ['M12 2l8.7 5v10L12 22l-8.7-5V7Z', 'M12 6.6l4.7 2.7v5.4L12 17.4l-4.7-2.7V9.3Z'],
  claw: [
    'M4.6 3.4c2.8 3.6 4.6 9 4.8 15.4l-1.8.8C7.4 13.6 6.2 8.2 4.6 3.4Z',
    'M9.4 2.6c2.8 3.6 4.6 9 4.8 15.4l-1.8.8C12.2 12.8 11 7.4 9.4 2.6Z',
    'M14.2 3.4c2.8 3.6 4.6 9 4.8 15.4l-1.8.8C17 13.6 15.8 8.2 14.2 3.4Z',
  ],
  spade: ['M12 2.4c3 3.4 8 6.4 8 10.6a4 4 0 0 1-6.6 3.1c.2 1.8.9 3.4 2.2 4.9H8.4c1.3-1.5 2-3.1 2.2-4.9A4 4 0 0 1 4 13c0-4.2 5-7.2 8-10.6Z'],
  arrow: ['M12 2l7.4 8.2h-4.6V22H9.2V10.2H4.6Z'],
};

/** An emblem from the relay: anything that is not a known choice is the default. */
export function emblemFrom(value: unknown): Emblem {
  return (EMBLEMS as readonly unknown[]).includes(value) ? (value as Emblem) : DEFAULT_EMBLEM;
}
