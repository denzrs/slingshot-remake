import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GALLERY } from '../../src/sim/config';
import { createMatch } from '../../src/game';
import { ClassicMatch } from '../../src/game/classic';
import { Crowd } from '../../src/game/crowd';
import { BetBook, PICK_DRAW } from '../../src/game/bets';
import { DEFAULT_SETTINGS, type Seat } from '../../src/data/settings';

describe('the stands\' book', () => {
  it('reports its bets as the stands\'', () => {
    const book = new BetBook(true);
    book.reset(0);
    book.openRound([0, 1], true);
    expect(book.place(4, PICK_DRAW, 40, [0, 1], 2)).toBe(true);
    book.resolve([], 1, 3);
    expect(book.judged).toEqual([{ kind: 'round', right: true, stake: 40, payout: 200, underdog: false, stands: true }]);
  });

  it('takes bettors who were not there at the start, whatever their place number', () => {
    const book = new BetBook(true);
    book.reset(0);
    book.openRound([0, 1], false);
    expect(book.place(7, 1, 50, [0, 1], 2)).toBe(true);
    book.resolve([1], 1, 2);
    expect(book.scores[7]).toEqual({ bets: 1, won: 1, net: 50 });
    expect(book.scores.every(Boolean)).toBe(true);
  });
});

describe('the crowd', () => {
  it('gives newcomers the bankroll, keeps those who left, and starts everybody over with a new match', () => {
    const crowd = new Crowd();
    crowd.sync([{ id: 0, name: 'Ada' }, { id: 1, name: 'Bob' }]);
    crowd.seat(0)!.balance = 20;
    crowd.sync([{ id: 1, name: 'Bob' }, { id: 2, name: 'Cy' }]);
    expect(crowd.seats.map((s) => [s.name, s.present, s.balance])).toEqual([['Ada', false, 20], ['Bob', true, 500], ['Cy', true, 500]]);
    expect(crowd.watching).toBe(true);
    crowd.seat(1)!.balance = 3;
    crowd.relief();
    expect(crowd.seat(1)!.balance).toBe(GALLERY.RELIEF);
    expect(crowd.seat(0)!.balance).toBe(20);
    crowd.reset();
    expect(crowd.seats.map((s) => [s.name, s.balance])).toEqual([['Bob', 500], ['Cy', 500]]);
    const copy = new Crowd();
    copy.restore(JSON.parse(JSON.stringify(crowd.snapshot())));
    expect(copy.seats).toEqual(crowd.seats);
  });
});

const seats: Seat[] = ['human', 'human', 'off', 'off', 'off', 'off'];
function table(): ClassicMatch {
  return createMatch('classic', { ...DEFAULT_SETTINGS, rounds: 1, maxPlanets: 0, seats }, { seats, seed: 11, deterministicCpu: true, online: true }) as ClassicMatch;
}

describe('the stands in a match', () => {
  it('asks the stands\' questions with nobody out, keeps their bets apart from the ghosts\', and pays into bankrolls, not scores', () => {
    const match = table();
    match.crowdChanged([{ id: 0, name: 'Ada' }, { id: 1, name: 'Bob' }]);
    // Nobody is shot down, yet the stands already have the round to bet on.
    expect(match.bets.question).toBeNull();
    expect(match.stands.question).toMatchObject({ choices: [0, 1] });
    expect(match.canBet(0, true)).toBe(true);
    expect(match.canBet(0)).toBe(false);

    // A share of the bankroll, as for the shot-down: nothing is taken until the bet is lost.
    expect(match.stakeChoices(0, true).map((s) => s.amount)).toEqual([120, 250, 500]);
    expect(match.placeBet(0, 1, 250, true)).toBe(true);
    expect(match.placeBet(1, 0, 120, true)).toBe(true);
    expect(match.crowd.seat(0)!.balance).toBe(500);
    expect(match.stands.placed.size).toBe(2);
    expect(match.bets.placed.size).toBe(0);
    expect(match.placeBet(1, 0, 120, true)).toBe(false); // once
    // A stand that is not there cannot bet; nor can a ship be backed that is not in the round.
    expect(match.placeBet(9, 1, 120, true)).toBe(false);
    expect(match.placeBet(0, 5, 120, true)).toBe(false);

    match.world.planets = [];
    Object.assign(match.world.ships[0], { x: 100, y: 400 });
    Object.assign(match.world.ships[1], { x: 500, y: 400 });
    match.setPlayerAim(0, 0, 55);
    match.commitPlayer(0);
    for (let t = 0; t < 120 && match.phase !== 'roundOver'; t += 1 / 30) match.update(1 / 30);
    expect(match.phase).toBe('roundOver');
    expect(match.stands.result!.winners).toEqual([0]);
    // Ada backed Bob, who was shot: −250. Bob backed Ada, who won with two in: +120.
    expect(match.crowd.seat(0)!.balance).toBe(250);
    expect(match.crowd.seat(1)!.balance).toBe(620);
    expect(match.bets.result).toBeFalsy();
    expect(match.players[1].score).toBe(0);
  });

  it('gives a spectator\'s screen the stands\' bets, bankroll and place as its own', () => {
    const match = table();
    match.spectatorId = 4;
    expect(match.ghost).toBe(false); // not in the stands' roster yet
    match.crowdChanged([{ id: 4, name: 'Dee' }]);
    expect(match.spectating).toBe(true);
    expect(match.ghost).toBe(true);
    expect(match.betBook).toBe(match.stands);
    expect(match.bettor).toBe(4);
    expect(match.purse(4)).toBe(500);
    expect(match.tipster(4)!.name).toBe('Dee');
    expect(match.localCanAim).toBe(false);
    match.stands.pending = { id: match.stands.question!.id, pick: 0 };
    expect(match.placeBet(4, 0, 120)).toBe(true);
    expect(match.stands.pending).toBeNull();
    expect(match.stands.placed.get(4)).toMatchObject({ pick: 0, stake: 120 });
  });

  it('gives back what a skipped round took from the stands', () => {
    const match = table();
    match.crowdChanged([{ id: 0, name: 'Ada' }]);
    match.placeBet(0, 1, 250, true);
    match.stands.fallen((pick) => pick === 1, match.clock).forEach((bet) => { match.crowd.seat(0)!.balance += bet.delta; });
    expect(match.crowd.seat(0)!.balance).toBe(250);
    match.requestSkipRound(0);
    match.voteSkipRound(1, true);
    expect(match.crowd.seat(0)!.balance).toBe(500);
  });
});

describe('the relay contract', () => {
  it('agrees on how many people the stands take', () => {
    const contract = JSON.parse(readFileSync(fileURLToPath(new URL('../../server/protocol-contract.json', import.meta.url)), 'utf8')) as { spectators: { max: number } };
    expect(GALLERY.MAX_SPECTATORS).toBe(contract.spectators.max);
  });
});
