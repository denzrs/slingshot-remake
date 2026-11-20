import type { MultiplayerSession } from '../../net/multiplayer';
import type { TournamentMatch, TournamentView } from '../../net/net';
import type { Emblem } from '../../platform/emblems';
import type { RoomColor } from '../../data/roomLook';

/** A team as the ticker names it: kept with the line, so a team removed later still reads as it did then. */
export interface TickerTeam {
  name: string;
  emblem: Emblem;
  color: RoomColor;
}

/** What happened in a tournament, as the arena's ticker tells it; the words are put to it when it is drawn. `stage` counts from the final (0). */
export type TickerEvent =
  | { kind: 'founded'; team: TickerTeam }
  | { kind: 'joined'; person: string; team: TickerTeam }
  | { kind: 'begun'; teams: number }
  | { kind: 'started'; stage: number; depth: number; teams: [TickerTeam, TickerTeam] }
  /** A round of a match was played: the points in the order of `teams`, and the team that just went ahead, if one did. */
  | { kind: 'round'; stage: number; depth: number; teams: [TickerTeam, TickerTeam]; round: number; score: [number, number]; lead: TickerTeam | null }
  /** A match was decided: `score` winner first; none when it was skipped, and the winner went through without playing. */
  | { kind: 'won'; stage: number; depth: number; winner: TickerTeam; loser: TickerTeam | null; score: [number, number] | null }
  | { kind: 'withdrawn'; team: TickerTeam }
  | { kind: 'champion'; team: TickerTeam };

export type TickerLine = TickerEvent & { at: number };

const teamOf = (view: TournamentView, team: number): TickerTeam => {
  const { name, emblem, color } = view.teams[team];
  return { name, emblem, color };
};

/** Which side of a score is ahead: 0, 1, or null when level. */
const leader = (score: [number, number] | null | undefined): 0 | 1 | null =>
  !score || score[0] === score[1] ? null : score[0] > score[1] ? 0 : 1;

/** What a match's change from `before` to `after` is news of. */
function matchEvents(view: TournamentView, stage: number, before: TournamentMatch | undefined, after: TournamentMatch): TickerEvent[] {
  const depth = view.bracket!.levels.length;
  const [a, b] = after.teams;
  if (a === null || b === null || after.bye) return [];
  const teams: [TickerTeam, TickerTeam] = [teamOf(view, a), teamOf(view, b)];
  const events: TickerEvent[] = [];
  if (after.state === 'playing' && before?.state !== 'playing') events.push({ kind: 'started', stage, depth, teams });
  const round = after.live?.round ?? 0;
  const score = after.live?.score;
  if (after.state === 'playing' && score && round > (before?.state === 'playing' ? before.live?.round ?? 0 : 0)) {
    const ahead = leader(score);
    const wasAhead = before?.state === 'playing' ? leader(before.live?.score) : null;
    events.push({ kind: 'round', stage, depth, teams, round, score, lead: ahead !== null && ahead !== wasAhead ? teams[ahead] : null });
  }
  if (after.state === 'done' && before?.state !== 'done' && after.winner !== null) {
    const side = after.teams.indexOf(after.winner) as 0 | 1;
    const score = after.score ? [after.score[side], after.score[1 - side]] as [number, number] : null;
    events.push({ kind: 'won', stage, depth, winner: teams[side], loser: teams[1 - side], score });
  }
  return events;
}

/**
 * What changed between two views of the same tournament, oldest first: teams founded and joined, the start, matches kicked off,
 * their rounds, results, withdrawals and the champion. Nothing for a first view, or one of another tournament.
 */
export function tickerEvents(before: TournamentView | null, after: TournamentView): TickerEvent[] {
  if (!before || before.code !== after.code) return [];
  const events: TickerEvent[] = [];
  const known = new Set(before.teams.map((team) => team.name));
  after.teams.forEach((team, id) => { if (!known.has(team.name)) events.push({ kind: 'founded', team: teamOf(after, id) }); });
  after.people.forEach((person, id) => {
    const was = before.people[id];
    if (person.team === null || person.gone || (was && was.team === person.team) || !after.teams[person.team]) return;
    // Who founds a team is in it at once: the founding says it.
    if (!known.has(after.teams[person.team].name) && after.teams[person.team].members[0] === id) return;
    events.push({ kind: 'joined', person: person.name, team: teamOf(after, person.team) });
  });
  if (before.phase === 'registration' && after.phase !== 'registration') events.push({ kind: 'begun', teams: after.teams.filter((team) => !team.withdrawn).length });
  after.teams.forEach((team, id) => {
    const was = before.teams.find((other) => other.name === team.name);
    if (team.withdrawn && was && !was.withdrawn) events.push({ kind: 'withdrawn', team: teamOf(after, id) });
  });
  const levels = after.bracket?.levels ?? [];
  levels.forEach((matches, level) => matches.forEach((match, index) => {
    events.push(...matchEvents(after, levels.length - 1 - level, before.bracket?.levels[level]?.[index], match));
  }));
  const champion = after.bracket?.champion;
  if (champion != null && before.bracket?.champion == null) events.push({ kind: 'champion', team: teamOf(after, champion) });
  return events;
}

/** The ticker keeps this many lines, newest first. */
const KEEP = 80;

/** The ticker of the tournament you are in: what happened since this page knew of it, whichever page was open meanwhile. */
let log: { code: string; last: TournamentView; lines: TickerLine[] } | null = null;

/** Starts keeping the ticker: every view of the tournament the relay sends is held against the one before. */
export function keepTournamentTicker(session: MultiplayerSession, now: () => number = Date.now): void {
  session.subscribe(() => {
    const view = session.tournament;
    if (!view) return;
    if (!log || log.code !== view.code) {
      log = { code: view.code, last: view, lines: [] };
      return;
    }
    const at = now();
    const fresh = tickerEvents(log.last, view).map((event) => ({ ...event, at }));
    log.last = view;
    if (fresh.length) log.lines = [...fresh.reverse(), ...log.lines].slice(0, KEEP);
  });
}

/** The ticker's lines for a tournament, newest first. */
export function tickerLines(code: string): readonly TickerLine[] {
  return log?.code === code ? log.lines : [];
}
