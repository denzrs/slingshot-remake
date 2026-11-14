import { describe, expect, it } from 'vitest';
import { KillLedger } from '../../src/game/kill-ledger';
import { newPlayer, type PlayerState } from '../../src/game/match-types';
import { SCORING } from '../../src/sim/config';

function ledger(scores: number[], options: { teams?: (number | null)[]; open?: boolean } = {}) {
  const players: PlayerState[] = scores.map((score, id) => ({ ...newPlayer(id, id, 'human', options.teams?.[id] ?? null), score }));
  const friendsOf = (id: number) => players.filter((p) => p.id !== id && p.team !== null && p.team === players[id].team).map((p) => p.id);
  const l = new KillLedger({ players: () => players, payFactor: () => 1, friendsOf, marksOpen: () => options.open ?? true });
  l.newMatch();
  l.startRound();
  l.scoresAtStart(players.map((p) => p.score));
  l.launched(players.map((p) => p.score));
  return { l, players };
}

describe('the kill ledger', () => {
  it('pays first blood once, to the first enemy taken in a round', () => {
    const { l } = ledger([0, 0, 0]);
    expect(l.killBonuses(0, 1, false).map((b) => b.kind)).toContain('firstBlood');
    l.noteKill(0, 1);
    expect(l.killBonuses(0, 2, false).map((b) => b.kind)).not.toContain('firstBlood');
    l.startRound();
    expect(l.killBonuses(0, 2, false).map((b) => b.kind)).toContain('firstBlood');
  });

  it('pays a bounty on whoever leads by the score the volley went up with', () => {
    const { l } = ledger([2000, 500, 0]);
    expect(l.killBonuses(1, 0, false).map((b) => b.kind)).toContain('bounty');
    expect(l.killBonuses(0, 1, false).map((b) => b.kind)).not.toContain('bounty');
  });

  it('pays revenge on the one who shot you down last round, and domination to the one who did it before', () => {
    const { l } = ledger([0, 0]);
    l.noteKill(1, 0);
    l.startRound();
    expect(l.killBonuses(0, 1, false).map((b) => b.kind)).toContain('revenge');
    expect(l.killBonuses(1, 0, false).map((b) => b.kind)).not.toContain('revenge');
    // A skipped round is as if it was never played.
    l.rollbackRound();
    expect(l.killBonuses(0, 1, false).map((b) => b.kind)).not.toContain('revenge');
  });

  it('counts the chain of a round, and starts it over with the round', () => {
    const { l } = ledger([0, 0, 0]);
    expect(l.extendChain(0, 1).kills).toBe(1);
    const second = l.extendChain(0, 1);
    expect(second.kills).toBe(2);
    expect(second.points).toBe(SCORING.MULTI_KILL[2]);
    expect(l.extendChain(0, 0.5).points).toBe(Math.round(SCORING.MULTI_KILL[Math.min(3, SCORING.MULTI_KILL.length - 1)] * 0.5));
    l.startRound();
    expect(l.extendChain(0, 1).kills).toBe(1);
  });

  it('marks the cards the way it pays, and shows none when the cards are closed', () => {
    const { l } = ledger([2000, 500, 0]);
    const marks = l.marksFor(1);
    expect(marks[0].map((m) => m.kind)).toContain('bounty');
    // The first kill of a round starts no chain, so there is no link to mark on the shooter's own card yet.
    expect(marks[1].map((m) => m.kind)).toEqual(['firstBlood', 'opener']);
    expect(marks[2].map((m) => m.kind)).toContain('comeback');
    expect(ledger([2000, 500, 0], { open: false }).l.marksFor(1).flat()).toEqual([]);
  });

  it('does not mark a teammate, and round-trips through its state', () => {
    const { l } = ledger([0, 0, 0], { teams: [0, 0, 1] });
    expect(l.marksFor(0)[1]).toEqual([]);
    l.noteKill(2, 0);
    l.extendChain(2, 1);
    const copy = ledger([0, 0, 0], { teams: [0, 0, 1] }).l;
    copy.restore(JSON.parse(JSON.stringify(l.state())));
    expect(copy.state()).toEqual(l.state());
  });
});
