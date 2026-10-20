import { AIM, GRACE, MAYHEM, TRAIL_FADE } from './config';
import { POWER_UP, POWER_UP_KINDS } from './powerups';
import type { NetworkGameMode, RoomMode, RoomRules } from './net';
import { avatarFrom, DEFAULT_AVATAR, type Avatar } from './avatars';
import { DEFAULT_ROOM_LOOK, roomLookFrom, type RoomLook } from './roomLook';
import { DEFAULT_SETTINGS, type Settings } from './settings';

/** What the multiplayer lobby remembers between visits, so it needn't be filled in again. */
interface LobbyPrefs {
  server: string;
  name: string;
  /** Connect on opening the lobby: set once a connection worked. */
  autoConnect: boolean;
  gameMode: NetworkGameMode;
  matchType: RoomMode;
  capacity: number;
  /** The name, listing, symbol and colour the next room starts with. */
  look: RoomLook;
  /** The symbol the player shows in online games. */
  avatar: Avatar;
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
  mayhem: s.mayhem,
  betting: s.betting,
  powerUps: s.powerUps,
  powerUpKinds: [...s.powerUpKinds],
  powerUpAmount: s.powerUpAmount,
});

/**
 * The rules a new room starts with: the standard ones. Online play keeps its own state — whatever
 * a player has set up for offline games stays out of it, and the other way round.
 */
export const defaultRoomRules = (): RoomRules => rulesOf(DEFAULT_SETTINGS);

/**
 * The rules of a Mayhem game: the rounds and the chaos strength are the only things to choose, the rest is
 * the plain rules, which the round's twists then change.
 */
export const mayhemRules = (level: number, rounds: number): RoomRules => ({ ...defaultRoomRules(), rounds, mayhem: level });

/** A saved list of power-up kinds: only known kinds, in the usual order, and never none. */
function powerUpKindsFrom(value: unknown): RoomRules['powerUpKinds'] | null {
  if (!Array.isArray(value)) return null;
  const kinds = POWER_UP_KINDS.filter((kind) => value.includes(kind));
  return kinds.length ? kinds : null;
}

export function loadLobbyPrefs(defaultServer: string): LobbyPrefs {
  const fresh: LobbyPrefs = { server: defaultServer, name: 'Player', autoConnect: false, gameMode: 'classic', matchType: 'ffa', capacity: 4, look: { ...DEFAULT_ROOM_LOOK }, avatar: DEFAULT_AVATAR, rules: defaultRoomRules() };
  try {
    fresh.name = localStorage.getItem(LEGACY_NAME_KEY) || fresh.name;
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh;
    const saved = JSON.parse(raw) as Partial<LobbyPrefs>;
    return {
      server: typeof saved.server === 'string' && saved.server && saved.server !== 'ws://localhost:8080' ? saved.server : fresh.server,
      name: typeof saved.name === 'string' && saved.name ? saved.name : fresh.name,
      autoConnect: saved.autoConnect === true,
      gameMode: saved.gameMode === 'horizon' ? 'horizon' : 'classic',
      matchType: saved.matchType === 'team' ? 'team' : 'ffa',
      capacity: Number.isInteger(saved.capacity) && saved.capacity! >= 2 && saved.capacity! <= 6 ? saved.capacity! : fresh.capacity,
      look: roomLookFrom(saved.look),
      avatar: avatarFrom(saved.avatar),
      rules: {
        ...fresh.rules,
        ...saved.rules,
        betting: saved.rules?.betting === true,
        powerUps: saved.rules?.powerUps === true,
        powerUpKinds: powerUpKindsFrom(saved.rules?.powerUpKinds) ?? fresh.rules.powerUpKinds,
        powerUpAmount: POWER_UP.AMOUNTS.includes(saved.rules?.powerUpAmount as number) ? saved.rules!.powerUpAmount : fresh.rules.powerUpAmount,
        maxPower: AIM.CAP_OPTIONS.includes(saved.rules?.maxPower as number) ? saved.rules!.maxPower : fresh.rules.maxPower,
        fixedPowerLevel: AIM.FIXED_OPTIONS.includes(saved.rules?.fixedPowerLevel as number) ? saved.rules!.fixedPowerLevel : fresh.rules.fixedPowerLevel,
        fadingTrails: TRAIL_FADE.OPTIONS.includes(saved.rules?.fadingTrails as number) ? saved.rules!.fadingTrails : fresh.rules.fadingTrails,
        mayhem: MAYHEM.LEVELS.includes(saved.rules?.mayhem as number) ? saved.rules!.mayhem : fresh.rules.mayhem,
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
