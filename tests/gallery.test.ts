import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GALLERY } from '../src/config';
import { Gallery, galleryStakes, PICK_DRAW } from '../src/game/gallery';

const stands = (names: string[] = ['Ada', 'Bob', 'Cy']): Gallery => {
  const gallery = new Gallery();
  gallery.sync(names.map((name, id) => ({ id, name })));
  return gallery;
};
const open = (gallery: Gallery, draw = false) => gallery.openBook(1, [0, 1, 2], draw, [0, 1, 2]);
const balances = (gallery: Gallery) => gallery.seats.map((seat) => seat.balance);

describe('the stands\' book', () => {
  it('gives everyone the bankroll and takes the stake out of it at once', () => {
    const gallery = stands();
    open(gallery);
    expect(balances(gallery)).toEqual([GALLERY.BANKROLL, GALLERY.BANKROLL, GALLERY.BANKROLL]);
    expect(gallery.bet(0, 1, 100)).toBe(true);
    expect(gallery.seats[0].balance).toBe(400);
    expect(gallery.betOf(0)).toEqual({ pick: 1, stake: 100 });
  });

  it('makes the odds from the bets: the pot over what is on a side, none for a side nobody backed', () => {
    const gallery = stands();
    open(gallery);
    expect(gallery.odds(0)).toBeNull();
    gallery.bet(0, 0, 100);
    gallery.bet(1, 1, 50);
    gallery.bet(2, 1, 50);
    expect(gallery.pot).toBe(200);
    expect(gallery.odds(0)).toBeCloseTo(2);
    expect(gallery.odds(1)).toBeCloseTo(2);
    expect(gallery.odds(2)).toBeNull();
    expect(gallery.share(1)).toBeCloseTo(0.5);
    expect(gallery.pool(1)).toEqual({ stake: 100, bettors: 2 });
  });

  it('lets a new bet replace the old one, and refuses what is not on offer', () => {
    const gallery = stands();
    open(gallery);
    gallery.bet(0, 0, 250);
    expect(gallery.bet(0, 1, 100)).toBe(true);
    expect(gallery.betOf(0)).toEqual({ pick: 1, stake: 100 });
    expect(gallery.seats[0].balance).toBe(400);
    expect(gallery.bet(0, 3, 25)).toBe(false); // no such ship
    expect(gallery.bet(0, PICK_DRAW, 25)).toBe(false); // no draw in this round
    expect(gallery.bet(0, 1, 30)).toBe(false); // not a stake on offer
    expect(gallery.bet(0, 1, 9999)).toBe(false); // more than they have
    expect(gallery.bet(9, 1, 25)).toBe(false); // not in the stands
    open(gallery, true);
    expect(gallery.bet(0, PICK_DRAW, 25)).toBe(true);
  });

  it('shares the pot among the winners by stake and loses the rest', () => {
    const gallery = stands();
    open(gallery);
    gallery.bet(0, 0, 100);
    gallery.bet(1, 0, 50);
    gallery.bet(2, 1, 250);
    gallery.close();
    expect(gallery.bet(0, 0, 25)).toBe(false);
    gallery.resolve([0]);
    // Pot 400 split 2:1 → 267 and 133 (the odd point goes to the bigger remainder, none is lost).
    const payouts = gallery.result!.payouts;
    expect(payouts.map((p) => p.payout)).toEqual([267, 133, 0]);
    expect(payouts.reduce((sum, p) => sum + p.payout, 0)).toBe(400);
    expect(balances(gallery)).toEqual([400 + 267, 450 + 133, 250]);
    expect(gallery.seats.map((seat) => [seat.right, seat.bets, seat.streak])).toEqual([[1, 1, 1], [1, 1, 1], [0, 1, 0]]);
    expect(gallery.book).toBeNull();
    expect(gallery.pot).toBe(0);
  });

  it('gives every stake back when nobody backed the winner, or nobody backed anything else', () => {
    const gallery = stands();
    open(gallery);
    gallery.bet(0, 1, 100);
    gallery.bet(1, 2, 50);
    gallery.resolve([0]);
    expect(balances(gallery)).toEqual([500, 500, 500]);
    expect(gallery.seats.every((seat) => seat.right === 0 && seat.streak === 0)).toBe(true);
    expect(gallery.seats.slice(0, 2).map((seat) => seat.bets)).toEqual([1, 1]);

    open(gallery);
    gallery.bet(0, 1, 100);
    gallery.bet(1, 1, 50);
    gallery.resolve([1]);
    expect(balances(gallery)).toEqual([500, 500, 500]);
  });

  it('pays a team\'s backers together, and a draw to whoever bet on one', () => {
    const gallery = stands();
    gallery.openBook(1, [0, 1, 2], false, [0, 0, 1]);
    gallery.bet(0, 0, 100);
    gallery.bet(1, 1, 100);
    gallery.bet(2, 2, 100);
    // Ships 0 and 1 are a team: backing either is backing the team, so they share odds.
    expect(gallery.odds(0)).toBeCloseTo(gallery.odds(1)!);
    expect(gallery.odds(0)).toBeCloseTo(1.5);
    gallery.resolve([0, 1]);
    expect(gallery.result!.payouts.map((p) => p.payout)).toEqual([150, 150, 0]);

    open(gallery, true);
    gallery.bet(0, PICK_DRAW, 100);
    gallery.bet(1, 2, 100);
    gallery.resolve([]);
    expect(gallery.result!.payouts.map((p) => p.payout)).toEqual([200, 0]);
  });

  it('refunds a bet the round never settled, and tops the nearly broke up for the next one', () => {
    const gallery = stands(['Ada']);
    open(gallery);
    gallery.bet(0, 0, 250);
    open(gallery);
    expect(gallery.seats[0].balance).toBe(500);
    gallery.seats[0].balance = 3;
    open(gallery);
    expect(gallery.seats[0].balance).toBe(GALLERY.RELIEF);
    expect(galleryStakes(3)).toEqual([3]);
    expect(galleryStakes(30)).toEqual([25]);
    expect(galleryStakes(0)).toEqual([]);
  });

  it('keeps those who left on the board, welcomes latecomers, and starts everybody over with a new match', () => {
    const gallery = stands();
    open(gallery);
    gallery.bet(0, 0, 100);
    gallery.resolve([0]);
    gallery.sync([{ id: 1, name: 'Bob' }, { id: 3, name: 'Dee' }]);
    expect(gallery.seats.map((seat) => [seat.name, seat.present])).toEqual([['Ada', false], ['Bob', true], ['Cy', false], ['Dee', true]]);
    expect(gallery.bet(0, 1, 25)).toBe(false);
    expect(gallery.seats[3].balance).toBe(GALLERY.BANKROLL);
    gallery.reset();
    expect(gallery.seats.map((seat) => [seat.name, seat.balance])).toEqual([['Bob', 500], ['Dee', 500]]);
  });

  it('survives the trip through a snapshot', () => {
    const gallery = stands();
    open(gallery, true);
    gallery.bet(0, 1, 100);
    const copy = new Gallery();
    copy.restore(JSON.parse(JSON.stringify(gallery.snapshot())));
    expect(copy.snapshot()).toEqual(gallery.snapshot());
    expect(copy.odds(1)).toBeCloseTo(1);
    copy.restore(undefined);
    expect(copy.seats).toEqual([]);
  });
});

describe('the relay contract', () => {
  it('agrees on how many people the stands take', () => {
    const contract = JSON.parse(readFileSync(fileURLToPath(new URL('../server/protocol-contract.json', import.meta.url)), 'utf8')) as { spectators: { max: number } };
    expect(GALLERY.MAX_SPECTATORS).toBe(contract.spectators.max);
  });
});
