import { COLORS, TEAMS } from '../sim/config';

/**
 * The one place that says what colour a ship, a seat or a team has. Everything that draws or tints a player
 * asks here and never reads `COLORS.players` or `TEAMS` itself (`tests/layering.test.ts` checks it), so a
 * different palette can replace these without touching the rest.
 */

/** The colours a player can be told apart by. */
interface Palette {
  /** One per seat. */
  players: readonly string[];
  /** One family per team: its colour, then a lighter and a darker shade for the other members. */
  teams: readonly (readonly string[])[];
  /** The colour of a target drone, and of whatever stands in for a ship that has none. */
  danger: string;
}

const STANDARD: Palette = { players: COLORS.players, teams: TEAMS, danger: COLORS.danger };

/**
 * For colour-blind players. Chosen and checked by `tests/data/palette.test.ts`: every pair stays apart for normal
 * sight and for each of the three kinds of colour blindness, mostly by lightness and the blue–yellow axis, which
 * all of them keep.
 */
const COLORBLIND: Palette = {
  players: ['#e1ac6e', '#9eb5f8', '#eef171', '#7370fa', '#93fef7', '#a86fa3'],
  teams: [
    ['#5496ed', '#81b6fe', '#3577cc'],
    ['#bdd144', '#def088', '#9eb110'],
    ['#cd7288', '#e498a8', '#ac546a'],
  ],
  danger: '#e54533',
};

export const PALETTES = { standard: STANDARD, colorblind: COLORBLIND } as const;
export type PaletteName = keyof typeof PALETTES;

let current: Palette = STANDARD;

/** Switches every colour of a player at once: ships read theirs from here each time they are drawn. */
export function setPalette(name: PaletteName): void {
  current = PALETTES[name];
}

/** The colour of a seat (0-based); a seat past the last starts over. */
export function seatColor(seat: number): string {
  return current.players[seat % current.players.length];
}

/** The colour of a team (0-based), or one of its other shades: each member of a team has a shade of its own. */
export function teamColor(team: number, shade = 0): string {
  const family = current.teams[team];
  return family[shade % family.length];
}

/** The colour of a target drone: no player has it. */
export function dangerColor(): string {
  return current.danger;
}
