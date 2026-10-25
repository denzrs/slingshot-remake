import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GALLERY } from '../../src/sim/config';
import { createMatch } from '../../src/game';
import { ClassicMatch } from '../../src/game/classic';
import { Crowd } from '../../src/game/crowd';
import { Oracle, TIP_NOBODY } from '../../src/game/oracle';
import { DEFAULT_SETTINGS, type Seat } from '../../src/data/settings';

const sideOf = (pick: number) => pick;

describe('the stands\' oracle', () => {
  it('works the odds out from what is staked: the pot over each pick, none for a pick nobody backed', () => {
    const o = new Oracle(true);
    o.reset(0);
    o.openRound([0, 1, 2], false);
    expect(o.oddsFor(0, sideOf)).toBeNull();
    for (const [who, pick, stake] of [[0, 0, 100], [1, 1, 50], [2, 1, 50]] as const) {
      expect(o.betRound(who, pick, [0, 1, 2])).toBe(true);
      expect(o.setStake(who, stake)).toBe(true);
    }
    expect(o.pot).toBe(200);
    expect(o.oddsFor(0, sideOf)).toBeCloseTo(2);
    expect(o.oddsFor(1, sideOf)).toBeCloseTo(2);
    expect(o.oddsFor(2, sideOf)).toBeNull();
    // Teammates win and lose together, so they share one side's odds.
    expect(o.oddsFor(0, (pick) => (pick === 2 ? 1 : pick))).toBeCloseTo(2);
    expect(o.oddsFor(1, (pick) => (pick === 2 ? 1 : pick))).toBeCloseTo(2);
  });

  it('shows the pools to everybody through its snapshot, while the shot-down\'s book stays closed', () => {
    const stands = new Oracle(true);
    const ghosts = new Oracle();
    for (const o of [stands, ghosts]) {
      o.reset(0);
      o.openRound([0, 1], true);
      o.betRound(3, 0, [0, 1]);
      o.setStake(3, 60);
      o.betRound(4, TIP_NOBODY, [0, 1]);
      o.setStake(4, 40);
    }
    const copy = new Oracle(true);
    copy.restore(JSON.parse(JSON.stringify(stands.snapshot())));
    expect(copy.pot).toBe(100);
    expect(copy.oddsFor(0, sideOf)).toBeCloseTo(100 / 60);
    expect(copy.oddsFor(TIP_NOBODY, sideOf)).toBeCloseTo(100 / 40);
    // Who tipped what is still face down: only the sums are common knowledge.
    expect(stands.snapshot().roundTips!.every(([, pick]) => pick < 0 && pick !== TIP_NOBODY || pick === -2)).toBe(true);
    expect(ghosts.snapshot().pools).toBeUndefined();
  });

  it('takes bettors who were not there at the start, whatever their place number', () => {
    const o = new Oracle(true);
    o.reset(0);
    o.open('shot', 0, []);
    expect(o.bet(7, 1)).toBe(true);
    o.resolve([], true, 1);
    expect(o.scores[7]).toMatchObject({ right: 1, total: 1 });
    expect(o.scores.every(Boolean)).toBe(true);
    expect(o.ranking().map((r) => r.player)).toEqual([7]);
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
  return createMatch('classic', { ...DEFAULT_SETTINGS, rounds: 1, maxPlanets: 0, seats }, { seats, seed: 11, deterministicCpu: true, oracle: true }) as ClassicMatch;
}

describe('the stands in a match', () => {
  it('asks the stands\' questions with nobody out, keeps their pot apart from the ghosts\', and pays into bankrolls, not scores', () => {
    const match = table();
    match.crowdChanged([{ id: 0, name: 'Ada' }, { id: 1, name: 'Bob' }]);
    // Nobody is shot down, yet the stands already have the round to bet on.
    expect(match.oracle.roundQuestion).toBeNull();
    expect(match.stands.roundQuestion).toMatchObject({ choices: [0, 1] });
    expect(match.canBetRound(0, true)).toBe(true);
    expect(match.canBetRound(0)).toBe(false);

    // The stake comes out of the bankroll, a share of it as for the shot-down; it needs no room rule.
    expect(match.maxStake(0, true)).toBe(0); // a tip first, then a stake on it
    expect(match.placeBet(0, 1, true, 250, true)).toBe(true);
    expect(match.placeBet(1, 0, true, 120, true)).toBe(true);
    expect(match.crowd.seat(0)!.balance).toBe(250);
    expect(match.stands.pot).toBe(370);
    expect(match.oracle.pot).toBe(0);
    expect(match.placeBet(1, 0, true, 9999, true)).toBe(true); // a second stake is not taken
    expect(match.stands.stakeOf(1)).toBe(120);
    // A stand that is not there cannot bet; nor can a ship be backed that is not in the round.
    expect(match.placeBet(9, 1, true, 120, true)).toBe(false);
    expect(match.placeBet(0, 5, true, 0, true)).toBe(false);

    match.world.planets = [];
    Object.assign(match.world.ships[0], { x: 100, y: 400 });
    Object.assign(match.world.ships[1], { x: 500, y: 400 });
    match.setPlayerAim(0, 0, 55);
    match.commitPlayer(0);
    for (let t = 0; t < 120 && match.phase !== 'roundOver'; t += 1 / 30) match.update(1 / 30);
    expect(match.phase).toBe('roundOver');
    const winners = match.stands.roundResult!.winners;
    // The pot goes to whoever backed the winner; the players' scores see none of it.
    const paid = match.stands.roundResult!.tips.map((tip) => [tip.player, tip.payout ?? 0]);
    expect(paid.reduce((sum, [, p]) => sum + p, 0)).toBe(370);
    for (const [id, payout] of paid) expect(match.crowd.seat(id)!.balance).toBe((id === 0 ? 250 : 380) + payout);
    expect(winners.length).toBe(1);
    expect(match.oracle.roundResult).toBeFalsy();
    expect(match.players[1].score).toBe(0);
  });

  it('gives a spectator\'s screen the stands\' oracle, bankroll and place as its own', () => {
    const match = table();
    match.spectatorId = 4;
    expect(match.ghost).toBe(false); // not in the stands' roster yet
    match.crowdChanged([{ id: 4, name: 'Dee' }]);
    expect(match.spectating).toBe(true);
    expect(match.ghost).toBe(true);
    expect(match.betOracle).toBe(match.stands);
    expect(match.bettor).toBe(4);
    expect(match.purse(4)).toBe(500);
    expect(match.bettingOn).toBe(true);
    expect(match.tipster(4)!.name).toBe('Dee');
    expect(match.localCanAim).toBe(false);
    // On its own screen a bet is remembered at once, like a ghost's.
    expect(match.placeBet(4, 0, true, 120)).toBe(true);
    expect(match.stands.roundMine).toMatchObject({ pick: 0 });
    expect(match.purse(4)).toBe(380);
  });
});

describe('the relay contract', () => {
  it('agrees on how many people the stands take', () => {
    const contract = JSON.parse(readFileSync(fileURLToPath(new URL('../../server/protocol-contract.json', import.meta.url)), 'utf8')) as { spectators: { max: number } };
    expect(GALLERY.MAX_SPECTATORS).toBe(contract.spectators.max);
  });
});
