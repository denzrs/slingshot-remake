import type { CpuLevel } from './ai';
import { MAX_PLAYERS } from './config';
import { detectLang, isLang, type Lang } from './i18n';

/** Who flies a seat: a person at the keyboard, a CPU of some strength, or nobody. */
export type Seat = 'human' | CpuLevel | 'off';

/**
 * One bag of settings, two homes in the UI: the rules of a game (seats, teams, rounds, planets, bounce,
 * flight time, …) are set on the setup screen right before it starts; the settings screen only keeps
 * what concerns this device (contours, particles, sound, language).
 */
export interface Settings {
  /** Always MAX_PLAYERS long; seats that aren't 'off' take part, keeping their number and colour. */
  seats: Seat[];
  /** 0 = endless match. */
  rounds: number;
  maxPlanets: number;
  invisiblePlanets: boolean;
  bounce: boolean;
  fixedPower: boolean;
  /** Seconds before a shot fizzles out. */
  shotTime: number;
  /** Classic only: swing-bys, grazes and the like multiply a hit's points, as they always do in Event Horizon. */
  styleBonuses: boolean;
  /** With four or more ships, each one's first shots of a round pass through its nearest enemy. */
  neighborGrace: boolean;
  /** Classic only: everybody aims, then all shots fly at once — as in Event Horizon — instead of one shot per turn. */
  simultaneousShots: boolean;
  /** Other players' aim arrows, angles and ship headings stay hidden: you only see your own aim. */
  hiddenAim: boolean;
  contours: boolean;
  particles: boolean;
  sound: boolean;
  language: Lang;
  /** 0 = free for all, otherwise the number of teams (2 or 3). */
  teamMode: number;
  /** Team per seat (0-based), MAX_PLAYERS long; only read in team mode. */
  seatTeams: number[];
}

export const DEFAULT_SETTINGS: Settings = {
  seats: ['human', 'human', 'off', 'off', 'off', 'off'],
  rounds: 5,
  maxPlanets: 4,
  invisiblePlanets: false,
  bounce: false,
  fixedPower: false,
  shotTime: 20,
  styleBonuses: false,
  neighborGrace: false,
  simultaneousShots: false,
  hiddenAim: false,
  contours: true,
  particles: true,
  sound: true,
  language: 'de',
  teamMode: 0,
  seatTeams: [0, 1, 0, 1, 0, 1],
};

const KEY = 'slingshot.settings.v1';

/** Settings from before multiplayer stored a single opponent instead of seats. */
interface LegacySettings {
  opponent?: 'human' | 'cpu';
  cpuLevel?: CpuLevel;
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Settings> & LegacySettings;
      const s: Settings = { ...DEFAULT_SETTINGS, ...parsed, seats: [...DEFAULT_SETTINGS.seats], seatTeams: [...DEFAULT_SETTINGS.seatTeams] };
      if (Array.isArray(parsed.seats)) parsed.seats.slice(0, MAX_PLAYERS).forEach((seat, i) => (s.seats[i] = seat));
      if (Array.isArray(parsed.seatTeams)) parsed.seatTeams.slice(0, MAX_PLAYERS).forEach((team, i) => (s.seatTeams[i] = team));
      if (![0, 2, 3].includes(s.teamMode)) s.teamMode = 0;
      else if (parsed.opponent === 'cpu') s.seats[1] = parsed.cpuLevel ?? 'medium';
      s.language = isLang(parsed.language) ? parsed.language : detectLang();
      delete (s as Settings & LegacySettings).opponent;
      delete (s as Settings & LegacySettings).cpuLevel;
      if (activeSeats(s).length < 2) s.seats = [...DEFAULT_SETTINGS.seats];
      return s;
    }
  } catch {
    // Storage blocked or corrupt — fall back to defaults.
  }
  return { ...DEFAULT_SETTINGS, seats: [...DEFAULT_SETTINGS.seats], seatTeams: [...DEFAULT_SETTINGS.seatTeams], language: detectLang() };
}

/** The copy a match plays by, so changing the setup later never alters a game in progress. */
export function cloneSettings(s: Settings): Settings {
  return { ...s, seats: [...s.seats], seatTeams: [...s.seatTeams] };
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Not fatal: settings just won't survive a reload.
  }
}

/** Seat numbers (0-based) that take part. */
export function activeSeats(s: Settings): number[] {
  return s.seats.flatMap((seat, i) => (seat === 'off' ? [] : [i]));
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
