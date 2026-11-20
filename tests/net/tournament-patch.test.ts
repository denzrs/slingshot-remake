import { describe, expect, it } from 'vitest';
import type { TournamentMatch, TournamentView } from '../../src/net/net';
import { applyTournamentPatch } from '../../src/net/tournament-patch';

const match = (over: Partial<TournamentMatch> = {}): TournamentMatch => ({
  teams: [0, 1], state: 'ready', winner: null, bye: false, score: null, room: false, watching: 0, live: null, simulated: false, waited: null, skippable: false, ...over,
});

const view = (): TournamentView => ({
  code: 'ABCDEF', phase: 'running', expiresIn: 3600,
  settings: { teamSize: 1, maxTeams: 4, stages: [] },
  people: [], teams: [],
  bracket: { levels: [[match(), match({ teams: [2, 3] })], [match({ teams: [null, null], state: 'waiting' })]], champion: null },
  you: { id: 0, token: 't', organizer: true, team: null },
});

describe('a tournament patch', () => {
  it('replaces the matches it names and nothing else, leaving the old view alone', () => {
    const before = view();
    const live = match({ state: 'playing', live: { round: 1, score: [100, 50] } });
    const after = applyTournamentPatch(before, { code: 'ABCDEF', expiresIn: 3590, bracket: { matches: [{ level: 0, index: 1, match: live }], champion: null } })!;
    expect(after.bracket!.levels[0][1]).toEqual(live);
    expect(after.bracket!.levels[0][0]).toBe(before.bracket!.levels[0][0]);
    expect(after.expiresIn).toBe(3590);
    expect(after.settings).toBe(before.settings);
    expect(before.bracket!.levels[0][1].state).toBe('ready');
  });

  it('takes a whole bracket when the relay sends one', () => {
    const bracket = { levels: [[match({ state: 'done' })]], champion: 0 };
    expect(applyTournamentPatch(view(), { code: 'ABCDEF', bracket })!.bracket).toBe(bracket);
  });

  it('takes changed fields, including your own', () => {
    const after = applyTournamentPatch(view(), { code: 'ABCDEF', phase: 'finished', you: { id: 0, token: 't', organizer: false, team: 1 } })!;
    expect(after.phase).toBe('finished');
    expect(after.you.team).toBe(1);
  });

  it('changes the entries of a list by place, and grows or shortens it', () => {
    const ada = { name: 'Ada', avatar: 'gem', connected: true, team: null, organizer: false, gone: false } as TournamentView['people'][number];
    const start = { ...view(), people: [ada, { ...ada, name: 'Bo' }] };
    const grown = applyTournamentPatch(start, { code: 'ABCDEF', people: { len: 3, at: [{ i: 1, v: { ...ada, name: 'Bea' } }, { i: 2, v: { ...ada, name: 'Cy' } }] } })!;
    expect(grown.people.map((p) => p.name)).toEqual(['Ada', 'Bea', 'Cy']);
    expect(grown.people[0]).toBe(start.people[0]);
    expect(applyTournamentPatch(grown, { code: 'ABCDEF', people: { len: 1, at: [] } })!.people.map((p) => p.name)).toEqual(['Ada']);
    // An entry past the end that leaves a gap means the view is out of step.
    expect(applyTournamentPatch(start, { code: 'ABCDEF', people: { len: 5, at: [{ i: 4, v: ada }] } })).toBeNull();
  });

  it('is turned down when it is not for the view it meets', () => {
    expect(applyTournamentPatch(null, { code: 'ABCDEF' })).toBeNull();
    expect(applyTournamentPatch(view(), { code: 'OTHER' })).toBeNull();
    expect(applyTournamentPatch(view(), { code: 'ABCDEF', bracket: { matches: [{ level: 5, index: 0, match: match() }], champion: null } })).toBeNull();
  });
});
