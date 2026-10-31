import type { CpuLevel } from '../sim/ai';
import { AIM, DEBRIS, MAX_PLAYERS, type Debris } from '../sim/config';
import { detectLang, isLang, type Lang } from '../platform/i18n';
import { lookFrom, type Look } from './look';
import { DEFAULT_ROOM_RULES, rulesOf, roomRulesFrom, type RoomRules } from './roomRules';

/** Who flies a seat: a person at the keyboard, a CPU of some strength, or nobody. */
export type Seat = 'human' | CpuLevel | 'off';

/**
 * One bag of settings, two homes in the UI: the rules of a game (seats, teams, rounds, planets, bounce,
 * flight time, …) are set on the setup screen right before it starts; the settings screen only keeps
 * what concerns this device (look, sound, language, and menu display).
 */
export interface Settings extends RoomRules {
  /** Always MAX_PLAYERS long; seats that aren't 'off' take part, keeping their number and colour. */
  seats: Seat[];
  /** The field's graphics: the original classic plate, or luminous (glowing ships, moving planets), forged (rendered ships and planets) or holo (a projection in lines). */
  look: Look;
  contours: boolean;
  particles: boolean;
  /** The card with the angle and power steps aside when the aim line would run over it. */
  aimCardDodge: boolean;
  /** How far the sparks of explosions and wreckage coast before they come to rest. */
  debris: Debris;
  /** The title screen and menus show a CPU match playing behind them; off leaves the plate empty. */
  menuBackground: boolean;
  /** Show the rotating statistics banner in the title menu and multiplayer lobby. */
  statsTicker: boolean;
  /** Menus change pages without sliding, fading or flaring: moving through them is instant. */
  lessMenuMotion: boolean;
  /** Touch screens: the side of the screen the angle wheel sits on, the power bar on the other. */
  wheelSide: 'left' | 'right';
  menuSounds: boolean;
  gameSounds: boolean;
  language: Lang;
  /** 0 = free for all, otherwise the number of teams (2 or 3). */
  teamMode: number;
  /** Team per seat (0-based), MAX_PLAYERS long; only read in team mode. */
  seatTeams: number[];
}

export const DEFAULT_SETTINGS: Settings = {
  ...rulesOf(DEFAULT_ROOM_RULES),
  seats: ['human', 'human', 'off', 'off', 'off', 'off'],
  look: 'classic',
  contours: true,
  particles: true,
  aimCardDodge: true,
  debris: 'medium',
  menuBackground: true,
  statsTicker: true,
  lessMenuMotion: false,
  wheelSide: 'right',
  menuSounds: true,
  gameSounds: true,
  language: 'de',
  teamMode: 0,
  seatTeams: [0, 1, 0, 1, 0, 1],
};

export const SETTINGS_KEY = 'slingshot.settings.v1';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const { sound: legacySoundValue, ...parsed } = JSON.parse(raw) as Partial<Settings> & { sound?: unknown };
      const s: Settings = { ...DEFAULT_SETTINGS, ...parsed, seats: [...DEFAULT_SETTINGS.seats], seatTeams: [...DEFAULT_SETTINGS.seatTeams] };
      const legacySound = typeof legacySoundValue === 'boolean' ? legacySoundValue : undefined;
      s.menuSounds = typeof parsed.menuSounds === 'boolean' ? parsed.menuSounds : legacySound ?? DEFAULT_SETTINGS.menuSounds;
      s.gameSounds = typeof parsed.gameSounds === 'boolean' ? parsed.gameSounds : legacySound ?? DEFAULT_SETTINGS.gameSounds;
      if (Array.isArray(parsed.seats)) parsed.seats.slice(0, MAX_PLAYERS).forEach((seat, i) => (s.seats[i] = seat));
      if (Array.isArray(parsed.seatTeams)) parsed.seatTeams.slice(0, MAX_PLAYERS).forEach((team, i) => (s.seatTeams[i] = team));
      if (![0, 2, 3].includes(s.teamMode)) s.teamMode = 0;
      for (const key of ['contours', 'particles', 'aimCardDodge', 'menuBackground', 'statsTicker', 'lessMenuMotion', 'menuSounds', 'gameSounds'] as const) {
        if (typeof s[key] !== 'boolean') s[key] = DEFAULT_SETTINGS[key];
      }
      s.look = lookFrom(s.look) ?? DEFAULT_SETTINGS.look;
      if (s.wheelSide !== 'left') s.wheelSide = 'right';
      if (!Object.hasOwn(DEBRIS, s.debris)) s.debris = DEFAULT_SETTINGS.debris;
      // The rules of the game: only what the game still offers, anything else back to the standard ones.
      Object.assign(s, roomRulesFrom(parsed));
      s.language = isLang(parsed.language) ? parsed.language : detectLang();
      if (activeSeats(s).length < 2) s.seats = [...DEFAULT_SETTINGS.seats];
      return s;
    }
  } catch {
    // Storage blocked or corrupt — fall back to defaults.
  }
  return { ...DEFAULT_SETTINGS, seats: [...DEFAULT_SETTINGS.seats], seatTeams: [...DEFAULT_SETTINGS.seatTeams], powerUpKinds: [...DEFAULT_SETTINGS.powerUpKinds], language: detectLang() };
}

/** The power a ship starts a round with — or shoots with when it is fixed — never above the cap. */
export const startPower = (s: Pick<Settings, 'fixedPower' | 'fixedPowerLevel' | 'maxPower'>): number => Math.min(s.fixedPower ? s.fixedPowerLevel : AIM.DEFAULT_POWER, s.maxPower);

/** The copy a match plays by, so changing the setup later never alters a game in progress. */
export function cloneSettings(s: Settings): Settings {
  return { ...s, seats: [...s.seats], seatTeams: [...s.seatTeams], powerUpKinds: [...s.powerUpKinds] };
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // Not fatal: settings just won't survive a reload.
  }
}

/** Seat numbers (0-based) that take part. */
export function activeSeats(s: Settings): number[] {
  return s.seats.flatMap((seat, i) => (seat === 'off' ? [] : [i]));
}

/** A match needs at least this many ships. */
export const MIN_SEATS = 2;

/** The seat a new ship would take: the first free one, or null when all six are taken. */
export function freeSeat(s: Settings): number | null {
  const i = s.seats.indexOf('off');
  return i < 0 ? null : i;
}

/** How many ships each team has among the seats that take part; empty in free for all. */
export function teamCounts(s: Settings): number[] {
  if (!s.teamMode) return [];
  const counts: number[] = Array.from({ length: s.teamMode }, () => 0);
  for (const i of activeSeats(s)) counts[s.seatTeams[i] % s.teamMode]++;
  return counts;
}

/** Seats a human or CPU in the requested slot (or the first free one), on the smallest team. */
export function addSeat(s: Settings, flier: Exclude<Seat, 'off'>, slot?: number): number | null {
  const i = slot ?? freeSeat(s);
  if (i === null || !Number.isInteger(i) || i < 0 || i >= MAX_PLAYERS || s.seats[i] !== 'off') return null;
  if (s.teamMode) {
    const counts = teamCounts(s);
    s.seatTeams[i] = counts.indexOf(Math.min(...counts));
  }
  s.seats[i] = flier;
  return i;
}

/** Takes a ship out of the match; false when that would leave fewer than the two a match needs. */
export function removeSeat(s: Settings, i: number): boolean {
  if (s.seats[i] === 'off' || activeSeats(s).length <= MIN_SEATS) return false;
  s.seats[i] = 'off';
  return true;
}

/** Deals the ships out to the teams one after the other, so the teams are as even as they can be. */
export function balanceTeams(s: Settings): void {
  if (!s.teamMode) return;
  activeSeats(s).forEach((seat, k) => (s.seatTeams[seat] = k % s.teamMode));
}

/**
 * Team per active seat, or null when the match is free for all. Teams only make sense with at
 * least three ships spread over at least two teams; anything else falls back to free for all.
 */
export function seatTeamsFor(s: Settings, seats: number[]): number[] | null {
  if (!s.teamMode || seats.length < 3) return null;
  const teams = seats.map((i) => s.seatTeams[i] % s.teamMode);
  return new Set(teams).size >= 2 ? teams : null;
}
