import { cloneSettings, type Seat, type Settings } from '../../data/settings';
import { roomRulesFrom } from '../../data/roomRules';
import type { StatsFavorite } from '../../net/net';
import { StatsBoard } from '../../net/statsBoard';
import { GAME_MODES, isGameMode, type GameMode } from '../../sim/modes';
import type { CpuLevel } from '../../sim/ai';
import { MAX_PLAYERS } from '../../sim/config';
import { t } from '../../platform/i18n';
import { loadMenuStats } from '../stats/facts';
import { statsAvailable } from '../stats/stats';
import { presetChangeCount, presetRules, presetsForMode } from './match-presets';

/** A quick game is short and the same every time: three rounds, you against two CPUs. */
export const QUICK_ROUNDS = 3;
export const QUICK_CPUS = 2;
/** How long the button waits for the relay's favourites before it plays without them. */
const FAVORITES_WAIT_MS = 2500;

export interface QuickGame {
  mode: GameMode;
  settings: Settings;
}

/** The card's hint: a random match, and how it is played. */
export const quickHint = (): string => t('mode.quick.hint', { rounds: QUICK_ROUNDS, cpus: QUICK_CPUS });

/** The built-in presets of every mode, as favourites nobody has counted yet. */
const builtInChoices = (): StatsFavorite[] =>
  GAME_MODES.flatMap((gameMode) => presetsForMode(gameMode).map((preset) => ({ gameMode, rules: presetRules(preset, gameMode), games: 0 })));

/** How many rules a favourite changes from its mode's standard. */
const changesOf = (favorite: StatsFavorite): number =>
  presetChangeCount(roomRulesFrom(favorite.rules), presetRules('standard', favorite.gameMode), favorite.gameMode);

/**
 * What a quick game picks from: the relay's favourites and every mode's built-in presets, each set once (a favourite that
 * plays as a preset is that preset), the fewest changes from the standard first.
 */
export function quickChoices(favorites: readonly StatsFavorite[]): StatsFavorite[] {
  const choices: StatsFavorite[] = [];
  for (const favorite of [...builtInChoices(), ...favorites.filter((favorite) => isGameMode(favorite.gameMode))]) {
    const same = (other: StatsFavorite) => other.gameMode === favorite.gameMode
      && presetChangeCount(roomRulesFrom(favorite.rules), roomRulesFrom(other.rules), favorite.gameMode) === 0;
    if (!choices.some(same)) choices.push(favorite);
  }
  return choices.map((choice) => ({ choice, changes: changesOf(choice) })).sort((a, b) => a.changes - b.changes).map(({ choice }) => choice);
}

/** How likely a choice is dealt: half as likely for every rule it changes, however often it was played. */
export const quickWeight = (favorite: StatsFavorite): number => 2 ** -changesOf(favorite);

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

/** One of the choices at random by its weight (all alike if none is given), and a different one from the last when there is more than one. */
export function shuffleFavorite<T>(choices: readonly T[], last: T | undefined, random: () => number = Math.random, weight: (choice: T) => number = () => 1): T {
  const pool = choices.length > 1 ? choices.filter((choice) => choice !== last) : choices;
  const weights = pool.map(weight);
  let roll = random() * weights.reduce((sum, w) => sum + w, 0);
  for (let i = 0; i < pool.length; i++) {
    roll -= weights[i];
    if (roll < 0) return pool[i];
  }
  return pool[pool.length - 1];
}

let lastPick: string | undefined;

/** The relay's favourites, which come with the menu's facts; a build without a relay, or one that does not answer in time, has none. */
async function favorites(): Promise<StatsFavorite[]> {
  if (!statsAvailable()) return [];
  const asked = loadMenuStats(new StatsBoard()).then((menu) => menu.favorites, () => []);
  const late = new Promise<StatsFavorite[]>((resolve) => setTimeout(() => resolve([]), FAVORITES_WAIT_MS));
  return Promise.race([asked, late]);
}

/** Asks for the favourites ahead of the first quick game, so pressing it does not wait for the relay. */
export function prepareQuickGame(): void {
  void favorites();
}

/** A quick game from the rule sets played most and the built-in presets, shuffled, the fewer changes the likelier. */
export async function pickQuickGame(base: Settings): Promise<QuickGame> {
  const choices = quickChoices(await favorites());
  const keys = choices.map((choice) => `${choice.gameMode} ${JSON.stringify(choice.rules)}`);
  const key = shuffleFavorite(keys, lastPick, Math.random, (k) => quickWeight(choices[keys.indexOf(k)]));
  lastPick = key;
  return quickGame(base, choices[keys.indexOf(key)]);
}
