import { describe, expect, it } from 'vitest';
import { createMatch } from '../../src/game';
import type { ClassicMatch } from '../../src/game/classic';
import { DEFAULT_SETTINGS, type Seat } from '../../src/data/settings';
import { SCORING } from '../../src/sim/config';

/** An online Classic match of `humans` people, on the first turn of its first round. */
function table(humans: number, extra: Partial<typeof DEFAULT_SETTINGS> = {}): ClassicMatch {
  const seats: Seat[] = Array.from({ length: 6 }, (_, i) => (i < humans ? 'human' : 'off'));
  return createMatch('classic', { ...DEFAULT_SETTINGS, rounds: 3, seats, ...extra }, { seats, oracle: true }) as ClassicMatch;
}

describe('a player leaving an online game', () => {
  it('takes the ship off the field and leaves the others aiming', () => {
    const m = table(3);
    expect(m.current).toBe(0);
    m.removePlayer(1);
    expect(m.players[1]).toMatchObject({ left: true, alive: false });
    expect(m.world.ships[1].alive).toBe(false);
    expect(m.phase).toBe('aiming');
    expect(m.current).toBe(0);
  });

  it('hands the turn on when it was theirs', () => {
    const m = table(4);
    m.removePlayer(0);
    expect(m.phase).toBe('aiming');
    expect(m.current).toBe(1);
  });

  it('ends a round left with one ship in it as a walkover, the survivor paid as ever', () => {
    const m = table(3);
    m.players[1].score = 30;
    m.removePlayer(1);
    m.removePlayer(2);
    expect(m.phase).toBe('roundOver');
    expect(m.summary).toMatchObject({ title: 'forfeit', survivor: 0 });
    expect(m.players[0].score).toBe(SCORING.SURVIVOR);
    // What they had scored stays theirs.
    expect(m.players[1].score).toBe(30);
  });

  it('keeps them out of every round after, and of a rematch', () => {
    const m = table(3);
    m.removePlayer(1);
    for (let round = 2; round <= 3; round++) {
      (m as unknown as { startRound(): void }).startRound();
      expect(m.round).toBe(round);
      expect(m.players[1].alive).toBe(false);
      expect(m.world.ships[1].alive).toBe(false);
      expect(m.current).not.toBe(1);
    }
    m.newMatch();
    expect(m.players[1]).toMatchObject({ left: true, alive: false });
    expect(m.players.filter((p) => p.alive)).toHaveLength(2);
  });

  it('takes away their vote and their tips', () => {
    const m = table(4);
    expect(m.skipVotesNeeded).toBe(3);
    m.removePlayer(3);
    expect(m.skipVotesNeeded).toBe(2);
    m.requestSkipRound(0);
    expect(m.canAnswerSkip(3)).toBe(false);
    m.voteSkipRound(3, true);
    expect(m.skipVote?.yes).toEqual([0]);
    m.voteSkipRound(1, true);
    expect(m.summary?.title).toBe('skipped');

    // Nobody shot down, nobody to ask: the oracle stays shut for a seat that is empty.
    const n = table(3);
    n.removePlayer(2);
    expect(n.canBet(2)).toBe(false);
    expect(n.oracle.question).toBeNull();
  });

  it('does not hold up a volley that waits for everybody', () => {
    const seats: Seat[] = ['human', 'human', 'human', 'off', 'off', 'off'];
    const m = createMatch('classic', { ...DEFAULT_SETTINGS, simultaneousShots: true, seats }, { seats, oracle: true, simultaneous: true }) as ClassicMatch;
    m.update(1);
    m.commitPlayer(0);
    m.commitPlayer(1);
    expect(m.phase).toBe('aiming');
    m.removePlayer(2);
    m.update(1 / 60);
    expect(m.phase).toBe('flying');
  });
});

describe('a player whose connection dropped', () => {
  const afterVolley = (m: ClassicMatch) => (m as unknown as { afterVolley(): void }).afterVolley();
  const startRound = (m: ClassicMatch) => (m as unknown as { startRound(): void }).startRound();

  it('is off the field, where nothing can hit the ship, and the turn passes them by', () => {
    const m = table(3);
    m.setAway(1, true);
    expect(m.players[1]).toMatchObject({ away: true, alive: true, left: false });
    expect(m.world.ships[1].alive).toBe(false);
    expect(m.alive.map((p) => p.id)).toEqual([0, 2]);
    // Anna on turn: the next turn goes to Cleo, not to Ben.
    afterVolley(m);
    expect(m.current).toBe(2);
    afterVolley(m);
    expect(m.current).toBe(0);
  });

  it('comes back in the same round where the ship was, and plays on', () => {
    const m = table(3);
    const spot = { ...m.world.ships[0] };
    m.setAway(0, true);
    expect(m.current).toBe(1);
    m.setAway(0, false);
    expect(m.world.ships[0]).toEqual(spot);
    expect(m.alive.map((p) => p.id)).toEqual([0, 1, 2]);
    afterVolley(m);
    afterVolley(m);
    expect(m.current).toBe(0);
  });

  it('is left as they were by a round that ends without them', () => {
    const m = table(3);
    m.setAway(1, true);
    // Anna shoots Cleo down: the round is hers, as if Ben had not been there.
    m.players[2].alive = false;
    m.world.ships[2].alive = false;
    m.lastKill = { killer: 0, victim: 2, self: false, friendly: false, points: 0, combo: [], multiplier: 1, at: 0 } as unknown as ClassicMatch['lastKill'];
    expect(m.decided).toBe(true);
    afterVolley(m);
    expect(m.phase).toBe('roundOver');
    expect(m.summary).toMatchObject({ survivor: 0 });
    expect(m.players[0].score).toBe(SCORING.SURVIVOR);
    expect(m.players[1].score).toBe(0);
    expect(m.players[1].alive).toBe(true);
    // Still away when the next round starts: still off the field.
    startRound(m);
    expect(m.world.ships[1].alive).toBe(false);
    expect(m.alive.map((p) => p.id)).toEqual([0, 2]);
  });

  it('is waited for when nobody is left to play against, before anybody was shot down', () => {
    const duel = table(2);
    duel.setAway(1, true);
    expect(duel.decided).toBe(false);
    afterVolley(duel);
    expect(duel.phase).toBe('aiming');
    expect(duel.current).toBe(0);
    duel.setAway(1, false);
    afterVolley(duel);
    expect(duel.current).toBe(1);
  });

  it('is not waited for in a volley, and may still aim it once back', () => {
    const seats: Seat[] = ['human', 'human', 'human', 'off', 'off', 'off'];
    const m = createMatch('classic', { ...DEFAULT_SETTINGS, simultaneousShots: true, seats }, { seats, oracle: true, simultaneous: true }) as ClassicMatch;
    m.setAway(2, true);
    expect(m.canAim(2)).toBe(false);
    m.setAway(2, false);
    expect(m.canAim(2)).toBe(true);
    m.setAway(2, true);
    m.update(1);
    m.commitPlayer(0);
    m.commitPlayer(1);
    m.update(1 / 60);
    expect(m.phase).toBe('flying');
    expect(m.players[2].shots).toBe(0);
  });

  it('has no vote while away, and is still away in a rematch', () => {
    const m = table(4);
    m.setAway(3, true);
    expect(m.skipVotesNeeded).toBe(2);
    m.newMatch();
    expect(m.players[3].away).toBe(true);
    expect(m.world.ships[3].alive).toBe(false);
    m.setAway(3, false);
    expect(m.skipVotesNeeded).toBe(3);
    expect(m.world.ships[3].alive).toBe(true);
  });
});
