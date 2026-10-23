/**
 * What the host tells the relay as the game goes — each turn, and each round that ends — for the relay's statistics. Only numbers and the
 * seat they belong to: no names, nothing that says who is who. The relay takes it at face value, like
 * the daily board does, and keeps it for a week.
 */
import type { RoundTitle } from './game/match';
import type { ReplayPlacement } from './game/replay';
import type { ShotRecord } from './shotLog';
import type { Best, StatBook } from './stats';

/** One seat's round. Indexed like the players of the match. */
export interface SeatReport {
  score: number;
  /** Shots fired this round. */
  shots: number;
  kills: number;
  swingbys: number;
  grazes: number;
  ownGoals: number;
  pickups: number;
  saves: number;
  alive: boolean;
}

/** A round's record and the seat that set it; the shot behind it stays at home. */
export interface RecordReport {
  player: number;
  value: number;
}

export interface RoundReport {
  /** 1 for the first round of the match. */
  round: number;
  title: RoundTitle;
  /** The last ship standing, if there was exactly one. */
  survivor: number | null;
  /** The winning team in a team game. */
  team: number | null;
  /** Seconds of match clock the round took. */
  seconds: number;
  planets: number;
  /** How many turns (volleys) the round took: the relay checks the turn reports it kept against it. */
  turns: number;
  players: SeatReport[];
  records: {
    longestShot?: RecordReport;
    fastestKill?: RecordReport;
    bestHit?: RecordReport;
    closeCall?: RecordReport;
    sniper?: RecordReport;
  };
}

/** One turn: the shots just flown, and where the scores stand after them. */
export interface TurnReport {
  round: number;
  /** 1 for the first turn of the round. */
  turn: number;
  players: { score: number; alive: boolean }[];
  /** The line of each shot: its aim exactly as aimed. */
  shots: ShotRecord[];
  /** The power-ups laid on the field before the turn's shots, in the order they were made. */
  placements: ReplayPlacement[];
}

export interface TurnSource {
  round: number;
  players: readonly { score: number; alive: boolean }[];
  shotLog: { turn: number; ofTurn(): ShotRecord[]; placementsOfTurn(): ReplayPlacement[] };
}

export function turnReport(match: TurnSource): TurnReport {
  return {
    round: match.round,
    turn: match.shotLog.turn,
    players: match.players.map((p) => ({ score: Math.round(p.score), alive: p.alive })),
    // The aim goes as it was aimed, to the last decimal: a replay has to fly the same flight.
    shots: match.shotLog.ofTurn().map((s) => ({ ...s, points: Math.round(s.points) })),
    placements: match.shotLog.placementsOfTurn(),
  };
}

/** The slice of a match a report is read from. */
export interface ReportSource {
  round: number;
  roundSeconds: number;
  roundStats: StatBook;
  summary: { title: RoundTitle; survivor: number | null; team: number | null } | null;
  players: readonly { score: number; shots: number; alive: boolean }[];
  world: { planets: readonly unknown[] };
  shotLog: { turn: number };
}

const RECORDS = ['longestShot', 'fastestKill', 'bestHit', 'closeCall', 'sniper'] as const;

const round1 = (n: number): number => Math.round(n * 10) / 10;

const record = (best: Best | null): RecordReport | undefined => (best && Number.isFinite(best.value) ? { player: best.player, value: round1(best.value) } : undefined);

export function roundReport(match: ReportSource): RoundReport {
  const book = match.roundStats;
  const records: RoundReport['records'] = {};
  for (const kind of RECORDS) {
    const found = record(book[kind]);
    if (found) records[kind] = found;
  }
  return {
    round: match.round,
    title: match.summary?.title ?? 'noneLeft',
    survivor: match.summary?.survivor ?? null,
    team: match.summary?.team ?? null,
    seconds: round1(match.roundSeconds),
    planets: match.world.planets.length,
    turns: match.shotLog.turn,
    players: match.players.map((p, i) => ({
      score: Math.round(p.score),
      shots: p.shots,
      kills: book.kills[i] ?? 0,
      swingbys: book.swingbys[i] ?? 0,
      grazes: book.grazes[i] ?? 0,
      ownGoals: book.ownGoals[i] ?? 0,
      pickups: book.pickups?.[i] ?? 0,
      saves: book.saves?.[i] ?? 0,
      alive: p.alive,
    })),
    records,
  };
}
