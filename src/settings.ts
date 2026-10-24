import type { CpuLevel } from './ai';
import { AIM, DEBRIS, GRACE, MAX_PLAYERS, MAYHEM, TRAIL_FADE, type Debris } from './config';
import { POWER_UP, POWER_UP_KINDS, type PowerUpKind } from './powerups';
import { detectLang, isLang, type Lang } from './i18n';
import { isLook, type Look } from './render/look';

/** Who flies a seat: a person at the keyboard, a CPU of some strength, or nobody. */
export type Seat = 'human' | CpuLevel | 'off';

export const KILLCAM_MODES = ['auto', 'off', 'every', 'round'] as const;
export type KillcamMode = (typeof KILLCAM_MODES)[number];
export type KillcamPlayback = Exclude<KillcamMode, 'auto'>;
export const isKillcamMode = (value: unknown): value is KillcamMode => KILLCAM_MODES.some((mode) => mode === value);

/**
 * One bag of settings, two homes in the UI: the rules of a game (seats, teams, rounds, planets, bounce,
 * flight time, …) are set on the setup screen right before it starts; the settings screen only keeps
 * what concerns this device (look, sound, language, and menu display).
 */
export interface Settings {
  /** Always MAX_PLAYERS long; seats that aren't 'off' take part, keeping their number and colour. */
  seats: Seat[];
  /** 0 = endless match. */
  rounds: number;
  maxPlanets: number;
  invisiblePlanets: boolean;
  bounce: boolean;
  /** Every shot has the same power, `fixedPowerLevel`: only the angle can be aimed. Mutually exclusive with a cap in the menus. */
  fixedPower: boolean;
  fixedPowerLevel: number;
  /** Shots can't be fired harder than this: a low cap favours trick shots over power shots. */
  maxPower: number;
  /** Seconds before a shot fizzles out. */
  shotTime: number;
  /** Classic only: swing-bys, grazes and the like multiply a hit's points, as they always do in Event Horizon. */
  styleBonuses: boolean;
  /** With four or more ships, each one's first this many shots of a round (0 = off) pass through its nearest enemy. */
  neighborGrace: number;
  /** Classic only: everybody aims, then all shots fly at once — as in Event Horizon — instead of one shot per turn. */
  simultaneousShots: boolean;
  /** Automatic: replays after kills in salvos, off for sequential shots. */
  killcam: KillcamMode;
  /** Pickups float on the field, and a shot that flies past one takes it (preview, teleport or splitter). */
  powerUps: boolean;
  /** Power-ups: the kinds that may turn up (never empty), and how many pickups lie on the field at once. */
  powerUpKinds: PowerUpKind[];
  powerUpAmount: number;
  /** Mayhem: every round has twists of its own, laid over these rules. 0 = off, otherwise the chaos strength (1 mild, 2 wild, 3 insane). */
  mayhem: number;
  /** Other players' aim arrows, angles and ship headings stay hidden: you only see your own aim. */
  hiddenAim: boolean;
  /** Seconds a finished shot's flight path stays on the board before it has faded away; 0 = it stays. */
  fadingTrails: number;
  /** The original classic plate, or the refined look (glowing ships, moving planets). */
  look: Look;
  contours: boolean;
  particles: boolean;
  /** How far the sparks of explosions and wreckage coast before they come to rest. */
  debris: Debris;
  /** The title screen and menus show a CPU match playing behind them; off leaves the plate empty. */
  menuBackground: boolean;
  /** Show the scrolling statistics ticker in the title menu and multiplayer lobby. */
  statsTicker: boolean;
  /** Menus change pages without sliding, fading or flaring: moving through them is instant. */
  lessMenuMotion: boolean;
  /** Touch screens: the side of the screen the aiming stick sits on. */
  stickSide: 'left' | 'right';
  menuSounds: boolean;
  gameSounds: boolean;
  /** Online: eliminated players may bet points of the match on who wins the round (a rule of the room). */
  betting: boolean;
  /** Online: only the people who play may write in the room's chat; spectators read along (a rule of the room). */
  chatPlayersOnly: boolean;
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
  fixedPowerLevel: AIM.FIXED_POWER,
  maxPower: AIM.MAX_POWER,
  shotTime: 20,
  styleBonuses: false,
  neighborGrace: 0,
  simultaneousShots: false,
  killcam: 'auto',
  powerUps: false,
  powerUpKinds: [...POWER_UP_KINDS],
  powerUpAmount: POWER_UP.DEFAULT_AMOUNT,
  mayhem: 0,
  hiddenAim: false,
  fadingTrails: 0,
  betting: false,
  chatPlayersOnly: false,
  look: 'classic',
  contours: true,
  particles: true,
  debris: 'medium',
  menuBackground: true,
  statsTicker: true,
  lessMenuMotion: false,
  stickSide: 'left',
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
      for (const key of ['contours', 'particles', 'menuBackground', 'statsTicker', 'lessMenuMotion', 'menuSounds', 'gameSounds'] as const) {
        if (typeof s[key] !== 'boolean') s[key] = DEFAULT_SETTINGS[key];
      }
      if (!isKillcamMode(s.killcam)) s.killcam = DEFAULT_SETTINGS.killcam;
      if (!isLook(s.look)) s.look = DEFAULT_SETTINGS.look;
      if (s.stickSide !== 'right') s.stickSide = 'left';
      if (!Object.hasOwn(DEBRIS, s.debris)) s.debris = DEFAULT_SETTINGS.debris;
      // Power-up choices: only known kinds, in their usual order, and never none at all.
      const kinds = POWER_UP_KINDS.filter((kind) => Array.isArray(parsed.powerUpKinds) && parsed.powerUpKinds.includes(kind));
      s.powerUpKinds = kinds.length ? kinds : [...POWER_UP_KINDS];
      if (!POWER_UP.AMOUNTS.includes(s.powerUpAmount)) s.powerUpAmount = POWER_UP.DEFAULT_AMOUNT;
      if (!TRAIL_FADE.OPTIONS.includes(s.fadingTrails)) s.fadingTrails = 0;
      if (!MAYHEM.LEVELS.includes(s.mayhem)) s.mayhem = 0;
      if (!AIM.CAP_OPTIONS.includes(s.maxPower)) s.maxPower = AIM.MAX_POWER;
      if (!AIM.FIXED_OPTIONS.includes(s.fixedPowerLevel)) s.fixedPowerLevel = AIM.FIXED_POWER;
      // It used to be a plain on/off switch, "on" meaning two shots.
      if ((s.neighborGrace as unknown) === true) s.neighborGrace = 2;
      if (!GRACE.OPTIONS.includes(s.neighborGrace)) s.neighborGrace = 0;
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
