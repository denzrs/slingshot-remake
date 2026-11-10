import { cloneSettings, type Seat, type Settings } from '../../data/settings';
import { roomRulesFrom } from '../../data/roomRules';
import type { StatsFavorite } from '../../net/net';
import { StatsBoard } from '../../net/statsBoard';
import { GAME_MODES, isGameMode, type GameMode } from '../../sim/modes';
import type { CpuLevel } from '../../sim/ai';
import { MAX_PLAYERS } from '../../sim/config';
import { statsAvailable } from '../stats/stats';
import { presetRules } from './match-presets';

/** A quick game is short and the same every time: three rounds, you against two CPUs. */
export const QUICK_ROUNDS = 3;
const QUICK_CPUS = 2;
/** How long the button waits for the relay's favourites before it plays without them. */
const FAVORITES_WAIT_MS = 2500;

export interface QuickGame {
  mode: GameMode;
  settings: Settings;
}

/** The favourites a quick game picks from: the relay's, or with none, the standard rules of every mode. */
export function quickChoices(favorites: readonly StatsFavorite[]): StatsFavorite[] {
  const known = favorites.filter((favorite) => isGameMode(favorite.gameMode));
  return known.length ? [...known] : GAME_MODES.map((gameMode) => ({ gameMode, rules: presetRules('standard', gameMode), games: 0 }));
}

/**
 * The game a favourite plays as a quick game, on a copy of the player's settings: its rules made safe to play, three rounds,
 * the player against two CPUs of the level they last set up (medium if none).
 */
export function quickGame(base: Settings, favorite: StatsFavorite): QuickGame {
  const level = (base.seats.find((seat) => seat !== 'human' && seat !== 'off') ?? 'medium') as CpuLevel;
  const seats: Seat[] = Array.from({ length: MAX_PLAYERS }, (_, i) => (i === 0 ? 'human' : i <= QUICK_CPUS ? level : 'off'));
  return {
    mode: favorite.gameMode,
    settings: { ...cloneSettings(base), ...roomRulesFrom(favorite.rules), rounds: QUICK_ROUNDS, seats, teamMode: 0 },
  };
}

/** One of the choices at random, and a different one from the last when there is more than one. */
export function shuffleFavorite<T>(choices: readonly T[], last: T | undefined, random: () => number = Math.random): T {
  const pool = choices.length > 1 ? choices.filter((choice) => choice !== last) : choices;
  return pool[Math.floor(random() * pool.length)];
}

let asked: Promise<StatsFavorite[]> | null = null;
let lastPick: string | undefined;

/** The relay's favourites, asked for once a session; a build without a relay, or one that does not answer in time, has none. */
async function favorites(): Promise<StatsFavorite[]> {
  if (!statsAvailable()) return [];
  asked ??= new StatsBoard().overview().then((overview) => overview.favorites, () => {
    asked = null;
    return [];
  });
  const late = new Promise<StatsFavorite[]>((resolve) => setTimeout(() => resolve([]), FAVORITES_WAIT_MS));
  return Promise.race([asked, late]);
}

/** Asks for the favourites ahead of the first quick game, so pressing it does not wait for the relay. */
export function prepareQuickGame(): void {
  void favorites();
}

/** A quick game from one of the five rule sets played most, shuffled. */
export async function pickQuickGame(base: Settings): Promise<QuickGame> {
  const choices = quickChoices(await favorites());
  const keys = choices.map((choice) => `${choice.gameMode} ${JSON.stringify(choice.rules)}`);
  const key = shuffleFavorite(keys, lastPick);
  lastPick = key;
  return quickGame(base, choices[keys.indexOf(key)]);
}
