import { isGameMode, type GameMode } from './modes';
import { avatarFrom, DEFAULT_AVATAR, type Avatar } from './avatars';
import { DEFAULT_ROOM_LOOK, roomLookFrom, type RoomLook } from './roomLook';
import { defaultRoomRules, roomRulesFrom, type RoomRules } from './roomRules';

/** What the multiplayer lobby remembers between visits, so it needn't be filled in again. */
export interface LobbyPrefs {
  server: string;
  name: string;
  /** Connect on opening the lobby: set once a connection worked. */
  autoConnect: boolean;
  gameMode: GameMode;
  capacity: number;
  /** The name, listing, symbol and colour the next room starts with. */
  look: RoomLook;
  /** The symbol the player shows in online games. */
  avatar: Avatar;
  rules: RoomRules;
}

const KEY = 'slingshot.lobby.v1';

export function loadLobbyPrefs(defaultServer: string): LobbyPrefs {
  const fresh: LobbyPrefs = { server: defaultServer, name: 'Player', autoConnect: false, gameMode: 'classic', capacity: 4, look: { ...DEFAULT_ROOM_LOOK }, avatar: DEFAULT_AVATAR, rules: defaultRoomRules() };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh;
    const saved = JSON.parse(raw) as Partial<LobbyPrefs>;
    return {
      server: typeof saved.server === 'string' && saved.server && saved.server !== 'ws://localhost:8080' ? saved.server : fresh.server,
      name: typeof saved.name === 'string' && saved.name ? saved.name : fresh.name,
      autoConnect: saved.autoConnect === true,
      gameMode: isGameMode(saved.gameMode) ? saved.gameMode : 'classic',
      capacity: Number.isInteger(saved.capacity) && saved.capacity! >= 2 && saved.capacity! <= 6 ? saved.capacity! : fresh.capacity,
      look: roomLookFrom(saved.look),
      avatar: avatarFrom(saved.avatar),
      rules: roomRulesFrom(saved.rules),
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
