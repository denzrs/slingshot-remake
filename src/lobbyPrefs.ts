import { AIM, GRACE, MAYHEM, TRAIL_FADE } from './config';
import { POWER_UP, POWER_UP_KINDS } from './powerups';
import type { NetworkGameMode, RoomRules } from './net';
import { avatarFrom, DEFAULT_AVATAR, type Avatar } from './avatars';
import { DEFAULT_ROOM_LOOK, roomLookFrom, type RoomLook } from './roomLook';
import { DEFAULT_SETTINGS, isKillcamMode, type Settings } from './settings';

/** What the multiplayer lobby remembers between visits, so it needn't be filled in again. */
interface LobbyPrefs {
  server: string;
  name: string;
  /** Connect on opening the lobby: set once a connection worked. */
  autoConnect: boolean;
  gameMode: NetworkGameMode;
  capacity: number;
  /** The name, listing, symbol and colour the next room starts with. */
  look: RoomLook;
  /** The symbol the player shows in online games. */
  avatar: Avatar;
  rules: RoomRules;
}

const KEY = 'slingshot.lobby.v1';

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
  killcam: s.killcam,
  hiddenAim: s.hiddenAim,
  fadingTrails: s.fadingTrails,
  mayhem: s.mayhem,
  betting: s.betting,
  chatPlayersOnly: s.chatPlayersOnly,
  powerUps: s.powerUps,
  powerUpKinds: [...s.powerUpKinds],
  powerUpAmount: s.powerUpAmount,
});

/**
 * The rules a new room starts with: the standard ones. Online play keeps its own state — whatever
 * a player has set up for offline games stays out of it, and the other way round.
 */
export const defaultRoomRules = (): RoomRules => rulesOf(DEFAULT_SETTINGS);

/** A saved list of power-up kinds: only known kinds, in the usual order, and never none. */
function powerUpKindsFrom(value: unknown): RoomRules['powerUpKinds'] | null {
  if (!Array.isArray(value)) return null;
  const kinds = POWER_UP_KINDS.filter((kind) => value.includes(kind));
  return kinds.length ? kinds : null;
}

/** Saved rules made safe to play: what is missing or no longer offered falls back to the standard rules. */
export function roomRulesFrom(saved: Partial<RoomRules> | undefined): RoomRules {
  const fresh = defaultRoomRules();
  return {
    ...fresh,
    ...saved,
    killcam: isKillcamMode(saved?.killcam) ? saved.killcam : fresh.killcam,
    betting: saved?.betting === true,
    chatPlayersOnly: saved?.chatPlayersOnly === true,
    powerUps: saved?.powerUps === true,
    powerUpKinds: powerUpKindsFrom(saved?.powerUpKinds) ?? fresh.powerUpKinds,
    powerUpAmount: POWER_UP.AMOUNTS.includes(saved?.powerUpAmount as number) ? saved!.powerUpAmount! : fresh.powerUpAmount,
    maxPower: AIM.CAP_OPTIONS.includes(saved?.maxPower as number) ? saved!.maxPower! : fresh.maxPower,
    fixedPowerLevel: AIM.FIXED_OPTIONS.includes(saved?.fixedPowerLevel as number) ? saved!.fixedPowerLevel! : fresh.fixedPowerLevel,
    fadingTrails: TRAIL_FADE.OPTIONS.includes(saved?.fadingTrails as number) ? saved!.fadingTrails! : fresh.fadingTrails,
    mayhem: MAYHEM.LEVELS.includes(saved?.mayhem as number) ? saved!.mayhem! : fresh.mayhem,
    // It used to be a plain on/off switch, "on" meaning two shots.
    neighborGrace: (saved?.neighborGrace as unknown) === true ? 2 : GRACE.OPTIONS.includes(saved?.neighborGrace as number) ? saved!.neighborGrace! : fresh.neighborGrace,
  };
}

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
      gameMode: saved.gameMode === 'horizon' || saved.gameMode === 'solar' ? saved.gameMode : 'classic',
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
