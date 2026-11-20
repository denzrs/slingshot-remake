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
/** A tournament match's teams' own colours, as families like `Palette.teams`; null outside one. */
let ownTeams: readonly (readonly string[])[] | null = null;

/** Switches every colour of a player at once: ships read theirs from here each time they are drawn. */
export function setPalette(name: PaletteName): void {
  current = PALETTES[name];
}

/** `hex` moved toward white (amount > 0) or black (amount < 0), by that share. */
function shadeOf(hex: string, amount: number): string {
  const target = amount > 0 ? 255 : 0;
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `#${channels.map((c) => Math.round(c + (target - c) * Math.abs(amount)).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * A tournament match draws its teams in the colours they picked, each member in a shade of the team's: the colour, a lighter
 * and a darker one. Null goes back to the game's. Teams that picked the same colour keep the game's, so they stay apart.
 */
export function setTeamColors(colors: readonly string[] | null): void {
  ownTeams = colors && new Set(colors).size === colors.length ? colors.map((c) => [c, shadeOf(c, 0.3), shadeOf(c, -0.25)]) : null;
}

/** The colour of a seat (0-based); a seat past the last starts over. */
export function seatColor(seat: number): string {
  return current.players[seat % current.players.length];
}

/** The colour of a team (0-based), or one of its other shades: each member of a team has a shade of its own. */
export function teamColor(team: number, shade = 0): string {
  // The colour-blind palette is chosen to keep teams apart; a tournament's own colours do not replace it.
  const own = current === STANDARD ? ownTeams?.[team] : undefined;
  const family = own ?? current.teams[team];
  return family[shade % family.length];
}

/** The colour of a target drone: no player has it. */
export function dangerColor(): string {
  return current.danger;
}
