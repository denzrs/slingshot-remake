import { MAX_PLAYERS } from './config';
import { createMatch, type ClassicMatch, type HorizonMatch, type MatchOptions } from './game';
import type { ReplayScript } from './game/replay';
import { defaultRoomRules } from './lobbyPrefs';
import type { Avatar } from './avatars';
import type { NetworkCpuLevel, NetworkGameMode, RoomMode, RoomRules } from './net';
import type { Seat, Settings } from './settings';

export type NetMatch = ClassicMatch | HorizonMatch;

/** What an online game is made of: the room's rules and who sits where, and the seed its worlds grow from. */
export interface NetGame {
  gameMode: NetworkGameMode;
  mode: RoomMode;
  rules?: RoomRules;
  seed: number;
  players: { cpu: NetworkCpuLevel | null; team: 0 | 1 | null; name?: string; avatar?: Avatar }[];
}

/**
 * The match of an online game, built the same way for the people playing it and for whoever flies it again later,
 * so both get the same match from the same game. The room's rules decide, not whatever this person has set up
 * for offline games: from this device only the display settings (lines, particles, menu and game sounds, language) carry over.
 * A `script` makes it a replay.
 */
export function netMatch(game: NetGame, base: Settings, extra: Pick<MatchOptions, 'oracle' | 'script'> = {}): NetMatch | null {
  // A CPU seat plays the level the host gave it; the host's simulation runs it for everybody.
  const seats: Seat[] = Array.from({ length: MAX_PLAYERS }, (_, i) => (i < game.players.length ? (game.players[i].cpu ?? 'human') : 'off'));
  const settings: Settings = {
    ...base,
    ...defaultRoomRules(),
    ...game.rules,
    seats,
    seatTeams: [...base.seatTeams],
    teamMode: game.mode === 'team' ? 2 : 0,
  };
  const names = game.players.map((p) => p.name);
  const match = createMatch(game.gameMode, settings, {
    seats,
    // A replay does not know the names: the seats are called what they are called without one.
    names: names.every((name) => name !== undefined) ? (names as string[]) : undefined,
    avatars: game.players.every((p) => p.avatar !== undefined) ? game.players.map((p) => p.avatar!) : undefined,
    teams: game.mode === 'team' ? game.players.map((p) => p.team ?? 0) : undefined,
    simultaneous: game.gameMode === 'horizon' || settings.simultaneousShots,
    seed: game.seed,
    ...extra,
  });
  return match.mode === 'classic' || match.mode === 'solar' || match.mode === 'horizon' ? (match as NetMatch) : null;
}

export type { ReplayScript };
