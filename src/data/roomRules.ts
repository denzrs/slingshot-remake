import { AIM, GRACE, MAYHEM, TRAIL_FADE } from '../sim/config';
import { POWER_UP, POWER_UP_KINDS, type PowerUpKind } from '../sim/powerups';

export const KILLCAM_MODES = ['auto', 'off', 'every', 'round'] as const;
export type KillcamMode = (typeof KILLCAM_MODES)[number];
export type KillcamPlayback = Exclude<KillcamMode, 'auto'>;
export const isKillcamMode = (value: unknown): value is KillcamMode => KILLCAM_MODES.some((mode) => mode === value);

/**
 * The rules of a game: what a room is set up with, and the match part of the local settings. They are sent over the
 * wire, kept in the browser (settings, presets, the lobby) and shown on the rules page — one list for all of them.
 */
export interface RoomRules {
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
  /** Other players' aim arrows, angles and ship headings stay hidden: you only see your own aim. */
  hiddenAim: boolean;
  /** Seconds a finished shot's flight path stays on the board before it has faded away; 0 = it stays. */
  fadingTrails: number;
  /** Mayhem: every round has twists of its own, laid over these rules. 0 = off, otherwise the chaos strength (1 mild, 2 wild, 3 insane). */
  mayhem: number;
  /** Online: eliminated players may bet points of the match on who wins the round (a rule of the room). */
  betting: boolean;
  /** Online: only the people who play may write in the room's chat; spectators read along (a rule of the room). */
  chatPlayersOnly: boolean;
  /** Pickups float on the field, and a shot that flies past one takes it (preview, teleport or splitter). */
  powerUps: boolean;
  /** Power-ups: the kinds that may turn up (never empty), and how many pickups lie on the field at once. */
  powerUpKinds: PowerUpKind[];
  powerUpAmount: number;
}

/** Every rule, in the order they are kept in. Naming one that `RoomRules` lacks, or missing one it has, does not compile. */
const RULE_NAMES = {
  rounds: true,
  maxPlanets: true,
  invisiblePlanets: true,
  bounce: true,
  fixedPower: true,
  fixedPowerLevel: true,
  maxPower: true,
  shotTime: true,
  styleBonuses: true,
  neighborGrace: true,
  simultaneousShots: true,
  killcam: true,
  hiddenAim: true,
  fadingTrails: true,
  mayhem: true,
  betting: true,
  chatPlayersOnly: true,
  powerUps: true,
  powerUpKinds: true,
  powerUpAmount: true,
} satisfies Record<keyof RoomRules, true>;

export const RULE_KEYS = Object.keys(RULE_NAMES) as (keyof RoomRules)[];

/** The standard rules: what a game starts with until somebody changes them. */
export const DEFAULT_ROOM_RULES: Readonly<RoomRules> = {
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
  hiddenAim: false,
  fadingTrails: 0,
  mayhem: 0,
  betting: false,
  chatPlayersOnly: false,
  powerUps: false,
  powerUpKinds: [...POWER_UP_KINDS],
  powerUpAmount: POWER_UP.DEFAULT_AMOUNT,
};

/** The rules out of anything that has them, such as a set of settings: a copy that shares nothing with it. */
export function rulesOf(source: RoomRules): RoomRules {
  const rules: Record<string, unknown> = {};
  for (const key of RULE_KEYS) rules[key] = Array.isArray(source[key]) ? [...(source[key] as unknown[])] : source[key];
  return rules as unknown as RoomRules;
}

/**
 * The rules a new room starts with: the standard ones. Online play keeps its own state — whatever
 * a player has set up for offline games stays out of it, and the other way round.
 */
export const defaultRoomRules = (): RoomRules => rulesOf(DEFAULT_ROOM_RULES);

/** A saved list of power-up kinds: only known kinds, in the usual order, and never none. */
function powerUpKindsFrom(value: unknown): PowerUpKind[] | null {
  if (!Array.isArray(value)) return null;
  const kinds = POWER_UP_KINDS.filter((kind) => value.includes(kind));
  return kinds.length ? kinds : null;
}

/** Saved rules made safe to play: what is missing or no longer offered falls back to the standard rules. */
export function roomRulesFrom(saved: Partial<RoomRules> | undefined): RoomRules {
  const fresh = defaultRoomRules();
  const known: Partial<RoomRules> = {};
  for (const key of RULE_KEYS) if (saved && saved[key] !== undefined) (known as Record<string, unknown>)[key] = saved[key];
  return {
    ...fresh,
    ...known,
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
