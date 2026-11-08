import { COLORS, TEAMS } from '../sim/config';

/**
 * The one place that says what colour a ship, a seat or a team has. Everything that draws or tints a player
 * asks here and never reads `COLORS.players` or `TEAMS` itself (`tests/layering.test.ts` checks it), so a
 * different palette can replace these two without touching the rest.
 */

/** The colour of a seat (0-based); a seat past the sixth starts over. */
export function seatColor(seat: number): string {
  return COLORS.players[seat % COLORS.players.length];
}

/** The colour of a team (0-based), or one of its other shades: each member of a team has a shade of its own. */
export function teamColor(team: number, shade = 0): string {
  const family = TEAMS[team];
  return family[shade % family.length];
}
