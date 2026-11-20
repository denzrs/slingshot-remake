import { describe, expect, it } from 'vitest';
import type { TournamentMatch, TournamentView } from '../../src/net/net';
import { tickerEvents } from '../../src/ui/tournament/ticker';

const team = (name: string, members: number[] = []) => ({
  name, slot: 0, closed: false, members, withdrawn: false, present: true, emblem: 'star', color: '#ff5a6e',
}) as unknown as TournamentView['teams'][number];

const match = (over: Partial<TournamentMatch> = {}): TournamentMatch => ({
  teams: [0, 1], state: 'ready', winner: null, bye: false, score: null, room: false, watching: 0, live: null, simulated: false, waited: null, skippable: false, ...over,
});

const person = (name: string, teamId: number | null) => ({ name, avatar: 'pilot', connected: true, team: teamId, organizer: false, gone: false }) as unknown as TournamentView['people'][number];

function view(over: Partial<TournamentView> = {}): TournamentView {
  return {
    code: 'ABCDEF', phase: 'running', expiresIn: 3600,
    settings: { teamSize: 1, maxTeams: 16, stages: [] },
    people: [person('Ada', 0), person('Bo', 1)],
    teams: [team('Rot', [0]), team('Blau', [1])],
    bracket: { levels: [[match()]], champion: null },
    you: { id: 0, token: 't', organizer: true, team: 0 },
    ...over,
  };
}

describe('the arena ticker', () => {
  it('says nothing of a first view or another tournament', () => {
    expect(tickerEvents(null, view())).toEqual([]);
    expect(tickerEvents(view({ code: 'OTHER' }), view({ bracket: { levels: [[match({ state: 'playing' })]], champion: null } }))).toEqual([]);
  });

  it('tells a team founded, without its founder joining it too, and somebody joining', () => {
    const before = view({ phase: 'registration', bracket: null, teams: [team('Rot', [0])], people: [person('Ada', 0), person('Bo', null), person('Cy', null)] });
    const after = view({ phase: 'registration', bracket: null, teams: [team('Rot', [0, 2]), team('Blau', [1])], people: [person('Ada', 0), person('Bo', 1), person('Cy', 0)] });
    const events = tickerEvents(before, after);
    expect(events.map((e) => e.kind)).toEqual(['founded', 'joined']);
    expect(events[1]).toMatchObject({ person: 'Cy', team: { name: 'Rot' } });
  });

  it('follows a match from kick-off through its rounds to the result', () => {
    const ready = view({ phase: 'registration', bracket: null });
    const playing = view({ bracket: { levels: [[match({ state: 'playing', room: true, live: { round: 0, score: null } })]], champion: null } });
    expect(tickerEvents(ready, playing).map((e) => e.kind)).toEqual(['begun', 'started']);

    const round1 = view({ bracket: { levels: [[match({ state: 'playing', live: { round: 1, score: [120, 300] } })]], champion: null } });
    expect(tickerEvents(playing, round1)).toEqual([
      expect.objectContaining({ kind: 'round', round: 1, score: [120, 300], lead: expect.objectContaining({ name: 'Blau' }), stage: 0 }),
    ]);
    // Still ahead: no new lead.
    const round2 = view({ bracket: { levels: [[match({ state: 'playing', live: { round: 2, score: [200, 310] } })]], champion: null } });
    expect(tickerEvents(round1, round2)).toEqual([expect.objectContaining({ kind: 'round', round: 2, lead: null })]);
    // The same round again is no news.
    expect(tickerEvents(round2, round2)).toEqual([]);

    const over = view({ phase: 'finished', bracket: { levels: [[match({ state: 'done', winner: 1, score: [200, 310] })]], champion: 1 } });
    expect(tickerEvents(round2, over)).toEqual([
      expect.objectContaining({ kind: 'won', winner: expect.objectContaining({ name: 'Blau' }), loser: expect.objectContaining({ name: 'Rot' }), score: [310, 200] }),
      expect.objectContaining({ kind: 'champion', team: expect.objectContaining({ name: 'Blau' }) }),
    ]);
  });

  it('tells a skipped match as a walkover and a team taken out', () => {
    const before = view();
    const after = view({ teams: [team('Rot', [0]), { ...team('Blau', [1]), withdrawn: true }], bracket: { levels: [[match({ state: 'done', winner: 0 })]], champion: 0 } });
    const events = tickerEvents(before, after);
    expect(events.map((e) => e.kind)).toEqual(['withdrawn', 'won', 'champion']);
    expect(events[1]).toMatchObject({ score: null });
  });
});
