import type { NetworkGameMode, RoomMode, RoomRules } from './net';
import type { Settings } from './settings';

/** What the multiplayer lobby remembers between visits, so it needn't be filled in again. */
export interface LobbyPrefs {
  server: string;
  name: string;
  /** Connect on opening the lobby: set once a connection worked. */
  autoConnect: boolean;
  gameMode: NetworkGameMode;
  matchType: RoomMode;
  capacity: number;
  rules: RoomRules;
}

const KEY = 'slingshot.lobby.v1';
/** Where the player name used to live on its own. */
const LEGACY_NAME_KEY = 'slingshot.player-name';

/** The rules a new room starts with: whatever the player last set up for offline games. */
export const rulesOf = (s: Settings): RoomRules => ({
  rounds: s.rounds,
  maxPlanets: s.maxPlanets,
  invisiblePlanets: s.invisiblePlanets,
  bounce: s.bounce,
  fixedPower: s.fixedPower,
  shotTime: s.shotTime,
  styleBonuses: s.styleBonuses,
});

export function loadLobbyPrefs(defaultServer: string, settings: Settings): LobbyPrefs {
  const fresh: LobbyPrefs = { server: defaultServer, name: 'Player', autoConnect: false, gameMode: 'classic', matchType: 'ffa', capacity: 4, rules: rulesOf(settings) };
  try {
    fresh.name = localStorage.getItem(LEGACY_NAME_KEY) || fresh.name;
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh;
    const saved = JSON.parse(raw) as Partial<LobbyPrefs>;
    return {
      server: typeof saved.server === 'string' && saved.server ? saved.server : fresh.server,
      name: typeof saved.name === 'string' && saved.name ? saved.name : fresh.name,
      autoConnect: saved.autoConnect === true,
      gameMode: saved.gameMode === 'horizon' ? 'horizon' : 'classic',
      matchType: saved.matchType === 'team' ? 'team' : 'ffa',
      capacity: Number.isInteger(saved.capacity) && saved.capacity! >= 2 && saved.capacity! <= 6 ? saved.capacity! : fresh.capacity,
      rules: { ...fresh.rules, ...saved.rules },
    };
  } catch {
    // Storage blocked or corrupt — start from scratch.
    return fresh;
  }
}

export function saveLobbyPrefs(prefs: LobbyPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Not fatal: the lobby just starts empty next time.
  }
}
