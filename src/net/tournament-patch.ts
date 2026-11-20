import type { TournamentMatch, TournamentView } from './net';

/** What changed in a tournament since the relay last sent it: only the fields that did, and of the bracket only the matches that did. */
export type TournamentPatch = Partial<Pick<TournamentView, 'phase' | 'settings' | 'expiresIn' | 'you'>> & {
  code: string;
  people?: TournamentView['people'] | ListPatch<TournamentView['people'][number]>;
  teams?: TournamentView['teams'] | ListPatch<TournamentView['teams'][number]>;
  bracket?:
    | NonNullable<TournamentView['bracket']>
    /** Matches that changed, by their place; the bracket keeps its shape. */
    | { matches: { level: number; index: number; match: TournamentMatch }[]; champion: number | null };
};

/** A list with some entries changed: its new length, and the entries that differ or were added, by place. */
export interface ListPatch<T> {
  len: number;
  at: { i: number; v: T }[];
}

function patchList<T>(list: T[], patch: T[] | ListPatch<T> | undefined): T[] | null {
  if (patch === undefined) return list;
  if (Array.isArray(patch)) return patch;
  if (patch.len < list.length && patch.at.some(({ i }) => i >= patch.len)) return null;
  const next = list.slice(0, patch.len);
  for (const { i, v } of patch.at) {
    if (i >= patch.len || i > next.length) return null;
    next[i] = v;
  }
  return next.length === patch.len ? next : null;
}

/**
 * The tournament with a patch put on it; the view itself is not touched. None when the patch is not for this tournament, or
 * names a match the view does not have: the view is then out of step, and the relay sends the whole of it on the next change.
 */
export function applyTournamentPatch(view: TournamentView | null, patch: TournamentPatch): TournamentView | null {
  if (!view || view.code !== patch.code) return null;
  const { bracket, people, teams, code: _code, ...fields } = patch;
  const nextPeople = patchList(view.people, people);
  const nextTeams = patchList(view.teams, teams);
  if (!nextPeople || !nextTeams) return null;
  const next: TournamentView = { ...view, ...fields, people: nextPeople, teams: nextTeams };
  if (bracket === undefined) return next;
  if (!('matches' in bracket)) return { ...next, bracket };
  if (!view.bracket) return null;
  const levels = view.bracket.levels.map((level) => level.slice());
  for (const { level, index, match } of bracket.matches) {
    if (!levels[level] || index >= levels[level].length) return null;
    levels[level][index] = match;
  }
  return { ...next, bracket: { levels, champion: bracket.champion } };
}
