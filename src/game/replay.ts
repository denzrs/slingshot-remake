/**
 * What it takes to fly a finished match again, and no more: the seed and the room's rules (which build the
 * worlds, the pick-ups and the ships), and then per turn what the players did. The rest follows, because the
 * simulation is deterministic: the same world and the same aims fly the same flight, a flight leaves the same
 * pick-ups in the same hands, and the next turn starts from there.
 */
import type { PlacementKind } from './powerup-field';
import type { PowerUpKind } from '../sim/powerups';

/** The power-ups that ride on a single shot: they are armed (or not) when the shot is fired. */
export type Rider = Extract<PowerUpKind, 'preview' | 'piercing' | 'plasma'>;

export const RIDERS: readonly Rider[] = ['preview', 'piercing', 'plasma'];

/** One shot a player fired: exactly as aimed, so the flight comes out the same to the last decimal. */
export interface ReplayShot {
  player: number;
  angle: number;
  power: number;
  /** The armed power-up the shot carried, if any. */
  rider: Rider | null;
  /** The physics step of the flight at which its splitter went off, if it was split. */
  splitAt: number | null;
}

/**
 * A power-up laid on the field instead of a shot: where, and for the ones that pick a planet, which (its place
 * in `world.planets` when it was made). A teleport to a spot the game drew itself has no spot of its own:
 * drawing it again, from the same stream, gives the same one.
 */
export interface ReplayPlacement {
  player: number;
  kind: PlacementKind;
  x?: number;
  y?: number;
  /** A wormhole's second mouth. */
  x2?: number;
  y2?: number;
  /** The planet a planet killer, a antigravity or a defense went to; -1 for a planet killer that found its planet gone. */
  planet?: number;
}

/** What happened to a seat's person: dropped out (`away`), is back, or left the game for good. */
export type SeatChangeKind = 'away' | 'back' | 'left';

/**
 * Where in its turn it came: the game answers a change differently at each of them (who is on turn, which ships are on the field,
 * whether a round is settled), so a replay has to make it at the same one. `flight`: while the shots of the turn were in the air,
 * before the next turn was given out. `aiming`: while the turn was being aimed. `between`: any other time before the launch, such
 * as the pause between two rounds.
 */
export type SeatChangeWhen = 'flight' | 'aiming' | 'between';

/**
 * The person of a seat dropped out, came back or left: what the room told the host. A replay has no room, so it is part of the
 * recording. It belongs to a `turn` of a `round` even if that turn never went off: a drop can settle the round before it does.
 */
export interface SeatChange {
  round: number;
  turn: number;
  player: number;
  change: SeatChangeKind;
  when: SeatChangeWhen;
  /** For `flight`: the physics step of the flight it came at (as for a split), because the flight goes on differently from there. */
  at?: number;
}

/** One turn (one volley): the placements made before it, and the shots that went off. A turn nobody shot in is empty. */
export interface ReplayTurn {
  round: number;
  turn: number;
  placements: ReplayPlacement[];
  shots: ReplayShot[];
}

export interface ReplayScript {
  turns: ReplayTurn[];
  /** The rounds that were skipped by vote: they end after their last turn, and nobody scored in them. */
  skipped?: number[];
  /** The changes at the table, in the order they came. Absent when there were none, and from a client that did not record them. */
  seatChanges?: SeatChange[];
}

export const replayKey = (round: number, turn: number): string => `${round}:${turn}`;
