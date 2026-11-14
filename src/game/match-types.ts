import { type Aim, type CpuDecision, type CpuLevel } from '../sim/ai';
import type { Avatar } from '../platform/avatars';
import { AIM, HORIZON, type BonusKind, type KillSource, type SuddenDeathKind } from '../sim/config';
import { dangerColor, seatColor, teamColor } from '../data/palette';
import { t } from '../platform/i18n';
import { type StyleKind, type World } from '../sim/physics';
import { type BonusRecord } from '../data/stats';
import { type Seat } from '../data/settings';
import { Volley } from '../sim/volley';
import { type Pickup, type PowerUpKind } from '../sim/powerups';
import { type ReplayScript } from './replay';
import { type PlacementAim } from './powerup-field';
import type { GameMode } from '../sim/modes';
import type { Experiment } from './experiments';

/** A game mode, or the daily challenge. */
export type Mode = GameMode | 'challenge';
export type Phase = 'aiming' | 'flying' | 'killcam' | 'collapse' | 'orbit' | 'roundOver' | 'gameOver';

export interface PlayerState {
  /** Index into `players` and `world.ships`. */
  id: number;
  /** Seat (0-based) — fixes name and colour for the whole match. */
  seat: number;
  name: string;
  /** The symbol the player picked for an online game; null offline. */
  avatar: Avatar | null;
  cpu: CpuLevel | null;
  /** Follows from the seat, the team and its shade, so a different palette shows at once. */
  readonly color: string;
  /** Which shade of the team colour this member has (team mode only). */
  shade: number;
  /** Team index in team mode, null in free for all. */
  team: number | null;
  /** Daily challenge: a stationary target drone rather than a ship that shoots. */
  target: boolean;
  score: number;
  angle: number;
  power: number;
  /** Shots fired this round. */
  shots: number;
  alive: boolean;
  /** Event Horizon: aim is locked in for the coming volley. */
  locked: boolean;
  /** The ship spent its shot on a teleport: it fires nothing this turn or volley. */
  passed: boolean;
  /** Power-up held (one at a time), null for none. */
  powerUp: PowerUpKind | null;
  /** The held preview or splitter is set to go off with the next shot. */
  armed: boolean;
  /** Online: the person left the game. The ship is gone for the rest of the match; the score stays. */
  left: boolean;
  /**
   * Online: the person's connection dropped and the seat is held for them. Until they are back the ship is off the
   * field (nothing can hit it) and the round goes on as if they were not there; `alive` says whether it is still in the round.
   */
  away: boolean;
}

export interface Trail {
  owner: number;
  /** The splitter fan the shot belonged to: its shots share one look. */
  fan?: number;
  /** Flat [x0, y0, x1, y1, …] polyline in field units. */
  points: number[];
  /** Volley the shot belonged to (Event Horizon), so old ones can be dropped. */
  volley: number;
  /** Match clock when the shot ended, for fading trails. */
  at: number;
}

export interface KillRecord {
  /** null = swallowed by the black hole. */
  killer: number | null;
  victim: number;
  /** Points the killer got (negative for a self-hit or friendly fire). */
  points: number;
  self: boolean;
  /** Shot down a teammate. */
  friendly: boolean;
  /** A planetary defense's stray missile did it, not a shot. */
  collateral?: boolean;
  /** No player did it (`killer` is null): what took the ship instead. */
  source?: KillSource;
  combo: StyleKind[];
  multiplier: number;
  shots: number;
  power: number;
  /** Match clock when it happened — the kill feed fades entries by age. */
  at: number;
}

/** Something on its way into a black hole, as the picture needs it. */
export interface Falling {
  /** Stays the same for as long as it falls. */
  key: string;
  x: number;
  y: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  radius: number;
  color: string;
  /** How far through its fall (0 → 1). */
  t: number;
  /** The ship it is, when it is one. */
  ship?: number;
}

/** Where a fall from one point to the middle of a hole has got to at `t` (0 → 1): it swings round first, the way the disk turns, then sinks. */
export function infallAt(fromX: number, fromY: number, toX: number, toY: number, t: number): { x: number; y: number } {
  const left = 1 - t ** 2.5;
  const turn = HORIZON.INFALL_TURN * t * t;
  const dx = (fromX - toX) * left;
  const dy = (fromY - toY) * left;
  return { x: toX + dx * Math.cos(turn) - dy * Math.sin(turn), y: toY + dx * Math.sin(turn) + dy * Math.cos(turn) };
}

export type RoundTitle = 'hit' | 'selfHit' | 'swallowed' | 'lastInOrbit' | 'noneLeft' | 'teamWin' | 'cleared' | 'outOfShots' | 'skipped' | 'forfeit' | 'supernova';

/** How long the people at the table have to answer a vote to skip the round, in seconds of match clock. */
export const SKIP_VOTE_TIME = 20;
/** Seconds of 3-2-1 between the host resuming a paused game and play going on. */
export const PAUSE_COUNTDOWN = 3;

/** An open vote to skip the round: who called it, who has answered how, and when it lapses. */
export interface SkipVote {
  by: number;
  yes: number[];
  no: number[];
  until: number;
}

export interface RoundSummary {
  title: RoundTitle;
  survivor: number | null;
  /** Winning team in team mode. */
  team: number | null;
  /** Bonus for the survivor — or for every member of the winning team. */
  bonus: number;
  lastKill: KillRecord | null;
}

/** Display name of a team, e.g. "Glut". */
export function teamName(team: number): string {
  return t(`team.${team as 0 | 1 | 2}`);
}

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

/** What the renderer should show: normally the live match, during a killcam the replay. */
export interface Scene {
  world: World;
  trails: Trail[];
  volley: Volley | null;
  camera: Camera | null;
  /** Power-ups on the field, and the armed preview's path while aiming. */
  pickups?: readonly Pickup[];
  /** The pass the round is in, so the renderer can tell which pickups are about to fade. */
  pass?: number;
  preview?: number[] | null;
  /** Where the aiming ship's teleport or black hole would go. */
  placement?: PlacementAim | null;
}

export type GameEvent =
  | { type: 'round' }
  | { type: 'turn'; player: number }
  | { type: 'lock'; player: number }
  | { type: 'volley' }
  | { type: 'fire'; player: number; x: number; y: number; angle: number; power: number }
  | { type: 'impact'; player: number; x: number; y: number; vx: number; vy: number }
  | { type: 'fizzle'; player: number; x: number; y: number; vx: number; vy: number; lost: boolean }
  | { type: 'clash'; x: number; y: number; players: [number, number]; velocities: [{ x: number; y: number }, { x: number; y: number }]; points: number }
  /** A planet or a ship starts to fall into the hole. */
  | { type: 'fall' }
  | { type: 'devour'; x: number; y: number; toX: number; toY: number; color: string; vx: number; vy: number }
  | { type: 'style'; player: number; kind: StyleKind; x: number; y: number }
  | { type: 'explode'; x: number; y: number; ship: number; vx: number; vy: number }
  | { type: 'pickup'; player: number; kind: PowerUpKind; x: number; y: number; dropped: PowerUpKind | null }
  | { type: 'pickupSpawn'; kind: PowerUpKind; x: number; y: number }
  | { type: 'pickupFade'; kind: PowerUpKind; x: number; y: number }
  | { type: 'teleport'; player: number; fromX: number; fromY: number; toX: number; toY: number }
  | { type: 'blackhole'; player: number; x: number; y: number }
  | { type: 'planetShatter'; x: number; y: number; radius: number; color: string }
  | { type: 'planetKiller'; player: number; x: number; y: number; radius: number }
  | { type: 'nebula'; player: number; x: number; y: number }
  | { type: 'wormhole'; player: number; x: number; y: number; toX: number; toY: number }
  | { type: 'defense'; player: number; x: number; y: number }
  /** A planet's gravity was turned round (`reversed`) or back. */
  | { type: 'antigravity'; player: number; x: number; y: number; radius: number; reversed: boolean }
  /** A planetary defense fired a missile at a shot: from its turret to where the shot is. */
  | { type: 'defenseFire'; player: number; x: number; y: number; toX: number; toY: number }
  /** A defense's missile lost its shot at (x, y). */
  | { type: 'defenseMiss'; player: number; x: number; y: number }
  /** An armor-piercing shot wrecked a planetary defense (`player` set it, `by` fired the shot). */
  | { type: 'defenseWrecked'; player: number; by: number; x: number; y: number }
  /** A planetary defense shot a flying shot down, and what that paid its owner. */
  | { type: 'shotdown'; player: number; x: number; y: number; vx: number; vy: number; points: number }
  | { type: 'split'; player: number; x: number; y: number }
  | { type: 'shield'; ship: number; x: number; y: number }
  /** Trick Shots Only: a shot was armed at (x, y) and can kill from now on. */
  | { type: 'armed'; player: number; x: number; y: number }
  /** Trick Shots Only: an unarmed shot flew through a ship and only warned it. */
  | { type: 'warning'; player: number; ship: number; x: number; y: number }
  /** Zeitzünder: a shot's fuse burnt down at (x, y). */
  | { type: 'blast'; player: number; x: number; y: number }
  /** Fusion: the shots of two players melted into one at (x, y). */
  | { type: 'fusion'; players: [number, number]; x: number; y: number }
  | { type: 'kill'; record: KillRecord }
  /** One shot took more than one ship in this volley: the chain number and what it paid. */
  | { type: 'multiKill'; player: number; kills: number; points: number; x: number; y: number }
  /** Extras paid to a player — for a kill (first blood, a bounty on the leader, revenge …) or at the end of the round (a comeback) — each with what it paid, shown at (x, y). */
  | { type: 'bonus'; player: number; bonuses: Bonus[]; x: number; y: number }
  | { type: 'collapse'; x: number; y: number }
  /** Sudden death has set in, as this round's kind of it. */
  | { type: 'suddenDeath'; kind: SuddenDeathKind }
  /** Sudden death: the red giant went supernova and took every ship with it. */
  | { type: 'supernova'; x: number; y: number; ships: { ship: number; x: number; y: number; angle: number }[]; planets: { x: number; y: number; radius: number; color: string }[] }
  | { type: 'killcam'; active: boolean; recording: boolean }
  | { type: 'freeFire' }
  | { type: 'roundEnd' }
  | { type: 'gameOver' };

/** Selected launch and simulated outcome for one normal CPU decision. */
export interface CpuDecisionReport extends CpuDecision {
  mode: Mode;
  round: number;
  player: number;
  shot: number;
}


/** An extra paid on top of the points, and what it paid. */
export type Bonus = Omit<BonusRecord, 'player'>;

/**
 * What a ship's card says before the shot: an extra a kill would pay, or the next step of the kill chain (which is not a logged kind).
 * A posthumous kill has no mark: the ship that would make it is gone, and its card is dimmed.
 */
export type MarkKind = Exclude<BonusKind, 'posthumous'> | 'chain';
export interface Mark {
  kind: MarkKind;
  points: number;
}

/**
 * What the marks are read from, for a guest to read them as the host does: the round's kills so far, who shot whom in it and the rounds
 * before, and the scores it began with. All of it is on the screen already (kill feed, scoreboard), so it is sent to everybody; what
 * stays private is only which marks each person is shown.
 */
export interface MarkState {
  chain: [number, number][];
  firstBlood: boolean;
  killedBy: [number, number][];
  before: [number, number][][];
  roundScores: number[];
}

export interface MatchOptions {
  /** Attract mode (title screen): rounds continue on their own, forever. */
  attract?: boolean;
  /** Override the seats from the settings (used by attract mode). */
  seats?: Seat[];
  /** Fixed player names by player index (online matches) — they survive a rematch. */
  names?: string[];
  /** The symbol each player picked, by player index (online matches). */
  avatars?: Avatar[];
  /** Fixed team per player index (online matches); `settings.teamMode` is the team count. */
  teams?: number[];
  /** Event Horizon online: every human aims at once instead of one after another at a shared keyboard. */
  simultaneous?: boolean;
  /** Online: eliminated players may tip on what the others' shots do. */
  oracle?: boolean;
  /** Reproducible multi-round worlds, independent of planner random consumption. */
  seed?: number;
  /** Fly a recorded match again: the seats do what the script says and nothing else (see `replay`). */
  script?: ReplayScript;
  /** Finish CPU generators without a wall-clock budget, for deterministic simulation. */
  deterministicCpu?: boolean;
  /** Receives normal CPU planner decisions; console logging can also enable this path. */
  onCpuDecision?: (report: CpuDecisionReport) => void;
  /** Dev build, offline: rule ideas being tried before they are rules (see `experiments`). Online, in attract mode and in a replay they are ignored. */
  experiments?: readonly Experiment[];
}

export interface CpuJob {
  planner: Generator<void, Aim> | null;
  target: Aim | null;
  settle: number;
  /** Power-ups: the planner found no hitting shot. Only known while the CPU holds a teleport or a plasma shot. */
  blind?: boolean;
  rescueTried?: boolean;
  /** A placement could not be laid at its spot: the CPU shoots instead, rather than swinging back to the spot every frame. */
  placeFailed?: boolean;
}

/** How many sides these ships are on: lone players in a free for all, whole teams in a team match. */
export function sidesOf(ships: PlayerState[]): number {
  return new Set(ships.map((p) => (p.team === null ? `p${p.id}` : `t${p.team}`))).size;
}

/** Whether the person of this seat is there to take part: not gone, and not dropped out for now. */
export function atTable(p: PlayerState): boolean {
  return !p.left && !p.away;
}

/** Shot down this round with a person behind the ship: who tips in the oracle. */
export function shotDown(p: PlayerState): boolean {
  return !p.alive && !p.cpu && atTable(p);
}

export function newPlayer(id: number, seat: number, kind: Exclude<Seat, 'off'>, team: number | null, target = false, fixedName?: string, avatar: Avatar | null = null): PlayerState {
  const cpu = kind === 'human' ? null : kind;
  return {
    id,
    seat,
    avatar,
    // A getter, so the name follows the UI language when it is switched mid-match.
    get name() {
      if (fixedName) return fixedName;
      if (target) return t('daily.target', { n: id });
      return cpu ? `CPU ${seat + 1}` : t('players.player', { n: seat + 1 });
    },
    cpu,
    shade: 0,
    get color() {
      if (target) return dangerColor();
      return this.team === null ? seatColor(seat) : teamColor(this.team, this.shade);
    },
    team,
    target,
    score: 0,
    angle: 0,
    power: AIM.DEFAULT_POWER,
    shots: 0,
    alive: true,
    locked: false,
    passed: false,
    powerUp: null,
    armed: false,
    left: false,
    away: false,
  };
}
