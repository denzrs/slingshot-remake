import { AIM, GRACE, TRAIL_FADE } from './config';
import type { NetworkGameMode, RoomMode, RoomRules } from './net';
import { DEFAULT_SETTINGS, type Settings } from './settings';

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

/** The rules out of a set of settings. */
export const rulesOf = (s: Settings): RoomRules => ({
  rounds: s.rounds,
  maxPlanets: s.maxPlanets,
  invisiblePlanets: s.invisiblePlanets,
  bounce: s.bounce,
  fixedPower: s.fixedPower,
  fixedPowerLevel: s.fixedPowerLevel,
  maxPower: s.maxPower,
  shotTime: s.shotTime,
  styleBonuses: s.styleBonuses,
  neighborGrace: s.neighborGrace,
  simultaneousShots: s.simultaneousShots,
  hiddenAim: s.hiddenAim,
  fadingTrails: s.fadingTrails,
});

/**
 * The rules a new room starts with: the standard ones. Online play keeps its own state — whatever
 * a player has set up for offline games stays out of it, and the other way round.
 */
export const defaultRoomRules = (): RoomRules => rulesOf(DEFAULT_SETTINGS);

export function loadLobbyPrefs(defaultServer: string): LobbyPrefs {
  const fresh: LobbyPrefs = { server: defaultServer, name: 'Player', autoConnect: false, gameMode: 'classic', matchType: 'ffa', capacity: 4, rules: defaultRoomRules() };
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
      rules: {
        ...fresh.rules,
        ...saved.rules,
        maxPower: AIM.CAP_OPTIONS.includes(saved.rules?.maxPower as number) ? saved.rules!.maxPower : fresh.rules.maxPower,
        fixedPowerLevel: AIM.FIXED_OPTIONS.includes(saved.rules?.fixedPowerLevel as number) ? saved.rules!.fixedPowerLevel : fresh.rules.fixedPowerLevel,
        fadingTrails: TRAIL_FADE.OPTIONS.includes(saved.rules?.fadingTrails as number) ? saved.rules!.fadingTrails : fresh.rules.fadingTrails,
        // It used to be a plain on/off switch, "on" meaning two shots.
        neighborGrace: (saved.rules?.neighborGrace as unknown) === true ? 2 : GRACE.OPTIONS.includes(saved.rules?.neighborGrace as number) ? saved.rules!.neighborGrace : fresh.rules.neighborGrace,
      },
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
