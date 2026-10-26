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
  const afterVolley = (m: ClassicMatch) => (m as unknown as { afterVolley(): void }).afterVolley();

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

  it('ends the round as a walkover whenever their going settled it, mid-flight too', () => {
    const m = table(3);
    m.players[2].alive = false;
    m.world.ships[2].alive = false;
    (m as unknown as { setPhase(p: string): void }).setPhase('flying');
    m.removePlayer(1);
    expect(m.phase).toBe('flying');
    afterVolley(m);
    expect(m.summary).toMatchObject({ title: 'forfeit', survivor: 0 });
    // A round settled by a shot keeps its own title, whoever left earlier.
    const n = table(4);
    n.removePlayer(3);
    n.players[2].alive = false;
    n.players[1].alive = false;
    afterVolley(n);
    expect(n.summary?.title).not.toBe('forfeit');
  });

  it('carries a vote that has enough yes once fewer are at the table', () => {
    const m = table(4);
    m.requestSkipRound(0);
    m.voteSkipRound(1, true);
    expect(m.summary).toBeNull();
    m.removePlayer(3);
    expect(m.summary?.title).toBe('skipped');
    // A leaver's yes no longer counts.
    const n = table(4);
    n.requestSkipRound(0);
    n.voteSkipRound(3, true);
    n.removePlayer(3);
    expect(n.skipVote?.yes).toEqual([0]);
  });

  it('cannot win the match after leaving it', () => {
    const m = table(3);
    m.players[1].score = 900;
    m.players[0].score = 200;
    m.removePlayer(1);
    expect(m.leader).toBe(0);
    expect(m.ranking().map((p) => p.id)).toEqual([0, 2, 1]);
    expect(m.winner()?.name).toBe(m.players[0].name);
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

  it('leaves the ship targetable until the volley starts and passes the turn by', () => {
    const m = table(3);
    m.setAway(1, true);
    expect(m.players[1]).toMatchObject({ away: true, alive: true, left: false });
    expect(m.world.ships[1].alive).toBe(true);
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
    const m = table(4);
    m.setAway(1, true);
    // Anna shoots Cleo and Dan down: the round is hers, as if Ben had not been there.
    for (const id of [2, 3]) {
      m.players[id].alive = false;
      m.world.ships[id].alive = false;
    }
    m.removePlayer(1);
    expect(m.phase).toBe('roundOver');
    expect(m.summary).toMatchObject({ survivor: 0 });
    expect(m.players[0].score).toBe(SCORING.SURVIVOR);
    expect(m.players[1].score).toBe(0);
    // Still away when the next round starts: still off the field.
    const n = table(3);
    n.setAway(1, true);
    startRound(n);
    expect(n.players[1].alive).toBe(true);
    expect(n.world.ships[1].alive).toBe(false);
    expect(n.alive.map((p) => p.id)).toEqual([0, 2]);
  });

  it('is waited for when nobody else is left to play against, even after a kill', () => {
    const m = table(3);
    m.players[2].alive = false;
    m.world.ships[2].alive = false;
    m.lastKill = { killer: 0, victim: 2, self: false, friendly: false, points: 0, combo: [], multiplier: 1, at: 0 } as unknown as ClassicMatch['lastKill'];
    // Ben's connection drops for a moment: that is no round lost.
    m.setAway(1, true);
    expect(m.decided).toBe(false);
    expect(m.waitingForAway).toBe(true);
    afterVolley(m);
    expect(m.phase).toBe('aiming');
    m.setAway(1, false);
    expect(m.waitingForAway).toBe(false);
    afterVolley(m);
    expect(m.current).toBe(1);
  });

  it('ends the round without a winner when everybody present is shot down', () => {
    const m = table(3);
    m.setAway(1, true);
    m.players[0].alive = false;
    m.world.ships[0].alive = false;
    m.players[2].alive = false;
    m.world.ships[2].alive = false;
    expect(m.decided).toBe(true);
    afterVolley(m);
    expect(m.phase).toBe('roundOver');
    expect(m.summary).toMatchObject({ survivor: null, bonus: 0 });
    expect(m.players[1].score).toBe(0);
  });

  it('stays hittable during aiming and flight, then parks for the next aiming phase', () => {
    const m = table(3);
    m.setAway(1, true);
    expect(m.world.ships[1].alive).toBe(true);
    m.commitPlayer(0);
    expect(m.phase).toBe('flying');
    expect(m.world.ships[1].alive).toBe(true);
    afterVolley(m);
    expect(m.world.ships[1].alive).toBe(false);
  });

  it('is nobody\'s neighbour while the ship is off the field', () => {
    const seats: Seat[] = ['human', 'human', 'human', 'human', 'off', 'off'];
    const m = createMatch('classic', { ...DEFAULT_SETTINGS, rounds: 1, seats, neighborGrace: 2 }, { seats, oracle: true }) as ClassicMatch;
    m.world.planets = [];
    [[100, 400], [300, 400], [700, 400], [1100, 400]].forEach(([x, y], i) => Object.assign(m.world.ships[i], { x, y }));
    expect(m.sparedFor(0)).toEqual([1]);
    m.setAway(1, true);
    expect(m.sparedFor(0)).toEqual([2]);
  });

  it('does not award the round to away teammates when the only present teammate is eliminated', () => {
    const m = table(4, { teamMode: 2 } as Partial<typeof DEFAULT_SETTINGS>);
    expect(m.teamMode).toBe(2);
    const away = m.players.filter((p) => p.id !== 0);
    // The host is shot down, and everybody else is away: the turn has nobody on the field to go to.
    m.players[0].alive = false;
    m.world.ships[0].alive = false;
    for (const p of away) m.setAway(p.id, true);
    afterVolley(m);
    expect(m.phase).toBe('roundOver');
    expect(m.summary).toMatchObject({ survivor: null, team: null, bonus: 0 });
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

  it.each(['classic', 'horizon'] as const)('gets a turn back in a %s volley aimed in turns, once back before it flies', (mode) => {
    const seats: Seat[] = ['human', 'human', 'human', 'off', 'off', 'off'];
    const m = createMatch(mode, { ...DEFAULT_SETTINGS, simultaneousShots: true, seats }, { seats, oracle: true }) as ClassicMatch;
    // Whoever is on turn drops out: the turn moves on at once.
    const first = m.current;
    m.setAway(first, true);
    expect(m.current).not.toBe(first);
    expect(m.current).toBeGreaterThanOrEqual(0);
    // The others lock in; back before the volley flies, the one who dropped out aims last.
    while (m.current >= 0) m.commit();
    m.setAway(first, false);
    expect(m.current).toBe(first);
    expect(m.canAim(first)).toBe(true);
    m.commit();
    for (let i = 0; i < 5 && m.phase === 'aiming'; i++) m.update(1);
    expect(m.phase).toBe('flying');
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
