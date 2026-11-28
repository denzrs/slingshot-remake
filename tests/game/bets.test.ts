import { describe, expect, it } from 'vitest';
import { createMatch } from '../../src/game';
import { ClassicMatch } from '../../src/game/classic';
import { betMultiplier, BetBook, PICK_DRAW, stakeOptions } from '../../src/game/bets';
import { DEFAULT_SETTINGS, type Seat } from '../../src/data/settings';

describe('the stakes and what a bet pays', () => {
  it('offers a quarter, half or all of the points, in steps of ten, at least ten', () => {
    expect(stakeOptions(1800)).toEqual([{ share: 0.25, amount: 450 }, { share: 0.5, amount: 900 }, { share: 1, amount: 1800 }]);
    expect(stakeOptions(1234)).toEqual([{ share: 0.25, amount: 300 }, { share: 0.5, amount: 610 }, { share: 1, amount: 1230 }]);
    expect(stakeOptions(30)).toEqual([{ share: 0.5, amount: 10 }, { share: 1, amount: 30 }]);
    expect(stakeOptions(10)).toEqual([{ share: 1, amount: 10 }]);
    expect(stakeOptions(9)).toEqual([]);
    expect(stakeOptions(-300)).toEqual([]);
  });

  it('pays as many times the stake as there are sides in when the bet is placed, a draw five times, never less than twice', () => {
    expect(betMultiplier(2, 3)).toBe(3);
    expect(betMultiplier(2, 2)).toBe(2);
    expect(betMultiplier(2, 1)).toBe(2);
    expect(betMultiplier(PICK_DRAW, 4)).toBe(5);
  });
});

describe('a bet on the round', () => {
  const open = () => {
    const book = new BetBook();
    book.reset(5);
    book.openRound([0, 2, 3], false);
    return book;
  };

  it('is taken once, on a ship still in, with a whole stake', () => {
    const book = open();
    expect(book.place(1, 4, 100, [0, 2, 3], 3)).toBe(false);
    expect(book.place(1, PICK_DRAW, 100, [0, 2, 3], 3)).toBe(false);
    expect(book.place(1, 2, 5, [0, 2, 3], 3)).toBe(false);
    expect(book.place(1, 2, 15, [0, 2, 3], 3)).toBe(false);
    expect(book.place(1, 2, 2.5, [0, 2, 3], 3)).toBe(false);
    expect(book.place(1, 2, 0, [0, 2, 3], 3)).toBe(false);
    expect(book.place(1, 2, 900, [0, 2, 3], 3)).toBe(true);
    expect(book.placed.get(1)).toEqual({ player: 1, pick: 2, stake: 900, multiplier: 3 });
    expect(book.canBet(1)).toBe(false);
    expect(book.place(1, 3, 100, [0, 2, 3], 3)).toBe(false);
  });

  it('is lost the moment its side is out, and the rest are settled at the end of the round', () => {
    const book = open();
    book.place(1, 2, 900, [0, 2, 3], 3);
    book.place(4, 0, 100, [0, 2, 3], 3);
    const lost = book.fallen((pick) => pick === 2, 7);
    expect(lost).toMatchObject([{ player: 1, pick: 2, won: false, delta: -900, at: 7 }]);
    expect(book.placed.has(1)).toBe(false);
    expect(book.betOf(1)).toMatchObject({ won: false });
    expect(book.canBet(1)).toBe(false);

    const done = book.resolve([0], 1, 9);
    expect(done).toMatchObject([{ player: 4, pick: 0, won: true, delta: 200 }]);
    expect(book.result).toMatchObject({ round: 1, winners: [0] });
    expect(book.result!.bets.map((bet) => [bet.player, bet.delta])).toEqual([[1, -900], [4, 200]]);
    expect(book.scores[1]).toEqual({ bets: 1, won: 0, net: -900 });
    expect(book.scores[4]).toEqual({ bets: 1, won: 1, net: 200 });
    expect(book.ranking().map((r) => r.player)).toEqual([4, 1]);
    expect(book.judged).toEqual([
      { kind: 'round', right: false, stake: 900, payout: 0, underdog: false, stands: false },
      { kind: 'round', right: true, stake: 100, payout: 300, underdog: false, stands: false },
    ]);
  });

  it('on a draw wins only when nobody is left', () => {
    const book = new BetBook();
    book.reset(3);
    book.openRound([0, 1], true);
    expect(book.place(2, PICK_DRAW, 100, [0, 1], 2)).toBe(true);
    // A bet on a draw does not fall with a ship.
    expect(book.fallen(() => true, 1)).toEqual([]);
    expect(book.resolve([], 1, 2)).toMatchObject([{ won: true, delta: 400 }]);
  });

  it('travels to the guests with the settled ones, and a skipped round takes the standings back', () => {
    const book = open();
    book.place(1, 2, 900, [0, 2, 3], 3);
    book.place(4, 0, 100, [0, 2, 3], 3);
    book.fallen((pick) => pick === 2, 7);
    const copy = new BetBook();
    copy.restore(JSON.parse(JSON.stringify(book.snapshot())));
    expect([...copy.placed.values()]).toEqual([{ player: 4, pick: 0, stake: 100, multiplier: 3 }]);
    expect(copy.settled).toEqual(book.settled);
    expect(copy.roundDelta(1)).toBe(-900);

    book.rollbackRound();
    expect(book.scores[1]).toEqual({ bets: 0, won: 0, net: 0 });
  });
});

// ————————————————————————————— In a match —————————————————————————————

const seatsFor = (n: number, cpu: Seat | null = null): Seat[] => Array.from({ length: 6 }, (_, i) => (i >= n ? 'off' : i === n - 1 && cpu ? cpu : 'human'));

/** A match of humans on an empty field: nothing bends a shot, so a shot flies exactly where it is aimed. */
function table(n: number, options: { salvo?: boolean; teams?: number[]; betting?: boolean } = {}): ClassicMatch {
  const seats = seatsFor(n);
  return createMatch(
    'classic',
    { ...DEFAULT_SETTINGS, rounds: 1, maxPlanets: 0, seats, simultaneousShots: !!options.salvo, teamMode: options.teams ? 2 : 0, betting: options.betting ?? true },
    { seats, seed: 11, deterministicCpu: true, online: true, simultaneous: !!options.salvo, teams: options.teams },
  ) as ClassicMatch;
}

function place(match: ClassicMatch, spots: [number, number][]): void {
  spots.forEach(([x, y], i) => Object.assign(match.world.ships[i], { x, y }));
}

/** Aims one ship at another so that the shot arrives after about a second. */
function aimAt(match: ClassicMatch, from: number, to: number): void {
  const a = match.world.ships[from];
  const b = match.world.ships[to];
  match.setPlayerAim(from, (Math.atan2(-(b.y - a.y), b.x - a.x) * 180) / Math.PI, Math.hypot(b.x - a.x, b.y - a.y) / 8);
}

/** Aims a ship in a direction (degrees, 0 = right, 90 = up) with a slow shot that just leaves the field. */
function aimAway(match: ClassicMatch, from: number, angle: number): void {
  match.setPlayerAim(from, angle, 30);
}

function run(match: ClassicMatch, done: () => boolean, seconds = 120): void {
  for (let t = 0; t < seconds && !done(); t += 1 / 30) match.update(1 / 30);
  expect(done()).toBe(true);
}

/** Four ships; A shoots B, so B is out while C aims, with three ships still in. */
function bShotDown(options: { betting?: boolean } = {}): ClassicMatch {
  const match = table(4, options);
  match.viewer = 1;
  place(match, [[700, 400], [500, 400], [900, 300], [900, 700]]);
  aimAt(match, 0, 1);
  match.commitPlayer(0);
  run(match, () => match.phase === 'aiming' && match.current === 2);
  return match;
}

describe('bets in a match', () => {
  it('opens once somebody is out, and takes no bets when the room has switched „Wetten“ off', () => {
    const on = bShotDown();
    expect(on.ghost).toBe(true);
    expect(on.bets.question).toMatchObject({ choices: [0, 2, 3], draw: false });

    const off = bShotDown({ betting: false });
    expect(off.bettingOn).toBe(false);
    expect(off.ghost).toBe(false);
    expect(off.bets.question).toBeNull();
    off.players[1].score = 1000;
    expect(off.canBet(1)).toBe(false);
    expect(off.stakeChoices(1)).toEqual([]);
    expect(off.placeBet(1, 3, 500)).toBe(false);
  });

  it('asks nothing offline', () => {
    const offline = createMatch('classic', { ...DEFAULT_SETTINGS, rounds: 1, seats: seatsFor(3) }, { seats: seatsFor(3) }) as ClassicMatch;
    offline.players[1].alive = false;
    expect(offline.canBet(1)).toBe(false);
  });

  it('takes a bet of a share of the ghost\'s points once, on a ship still in, while aiming — and takes nothing yet', () => {
    const match = bShotDown();
    match.players[1].score = 1800;
    expect(match.stakeChoices(1).map((s) => s.amount)).toEqual([450, 900, 1800]);
    expect(match.stakeChoices(0)).toEqual([]);
    // Not more than the ghost has, not on the ghost itself, not from the living.
    expect(match.placeBet(1, 3, 1900)).toBe(false);
    expect(match.placeBet(1, 1, 900)).toBe(false);
    match.players[3].score = 1000;
    expect(match.placeBet(3, 0, 500)).toBe(false);
    expect(match.placeBet(1, 3, 900)).toBe(true);
    expect(match.bets.placed.get(1)).toEqual({ player: 1, pick: 3, stake: 900, multiplier: 3 });
    expect(match.players[1].score).toBe(1800);
    expect(match.placeBet(1, 0, 450)).toBe(false);
    expect(match.stakeChoices(1)).toEqual([]);

    // Once the shots fly, no more bets.
    aimAway(match, 2, 90);
    match.commitPlayer(2);
    run(match, () => match.phase === 'flying');
    match.players[2].alive = false;
    expect(match.canBet(2)).toBe(false);
  });

  it('settles a bet the moment its ship is shot out, with the places it cost, and the rest when the round ends', () => {
    const match = bShotDown();
    match.players[1].score = 1800;
    match.placeBet(1, 3, 900);
    aimAway(match, 2, 90);
    match.commitPlayer(2);
    run(match, () => match.phase === 'aiming' && match.current === 3);

    // D shoots C, who is out too and puts all of 400 on A with two ships in: twice the stake.
    aimAt(match, 3, 2);
    match.commitPlayer(3);
    run(match, () => match.phase === 'aiming' && match.current === 0);
    match.viewer = 2;
    match.players[2].score = 400;
    expect(match.placeBet(2, 0, 400)).toBe(true);
    expect(match.bets.placed.get(2)!.multiplier).toBe(2);

    // A shoots D: B's bet is lost when the flight is over, C's is won at the end of the round.
    aimAt(match, 0, 3);
    match.commitPlayer(0);
    run(match, () => match.phase === 'roundOver');
    expect(match.players[1].score).toBe(900);
    expect(match.players[2].score).toBe(800);
    const bets = match.bets.result!.bets;
    expect(bets.map((bet) => [bet.player, bet.won, bet.delta])).toEqual([[1, false, -900], [2, true, 400]]);
    // B fell behind with the 900: the bet says from which place to which.
    expect(bets[0].places![1]).toBeGreaterThanOrEqual(bets[0].places![0]);
    expect(bets[0].places![1]).toBe(match.placeOf(1));
    expect(match.bets.result).toMatchObject({ winners: [0] });
    expect(match.scoreHistory.at(-1)).toEqual(match.players.map((p) => p.score));
  });

  it('loses a bet on a ship at once, before the round is over', () => {
    const match = bShotDown();
    match.players[1].score = 1000;
    match.placeBet(1, 3, 250);
    aimAt(match, 2, 3);
    match.commitPlayer(2);
    run(match, () => match.phase === 'flying');
    run(match, () => match.phase === 'aiming');
    expect(match.players[3].alive).toBe(false);
    expect(match.players[1].score).toBe(750);
    expect(match.bets.settled).toMatchObject([{ player: 1, pick: 3, won: false, delta: -250 }]);
  });

  it('lets a whole team win, whichever of its ships was named', () => {
    const match = table(4, { teams: [0, 0, 1, 1] });
    match.viewer = 3;
    match.players[3].alive = false;
    match.players[2].alive = false;
    match.players[3].score = 400;
    match.bets.openRound([0, 1, 2, 3], false);
    expect(match.placeBet(3, 1, 100)).toBe(true);
    (match as unknown as { endRound(): void }).endRound();
    expect(match.bets.result).toMatchObject({ winners: [0, 1] });
    expect(match.bets.result!.bets).toMatchObject([{ player: 3, won: true, delta: 100 }]);
    expect(match.players[3].score).toBe(500);
  });

  it('takes a bet on a draw when everybody aims at once, which pays five times', () => {
    const match = table(3, { salvo: true });
    match.viewer = 2;
    place(match, [[100, 400], [900, 400], [500, 100]]);
    match.players[2].alive = false;
    match.players[2].score = 100;
    match.bets.openRound([0, 1], true);
    expect(match.placeBet(2, PICK_DRAW, 100)).toBe(true);
    match.players[0].alive = false;
    match.players[1].alive = false;
    (match as unknown as { endRound(): void }).endRound();
    expect(match.bets.result).toMatchObject({ winners: [], bets: [{ won: true, delta: 400 }] });
    expect(match.players[2].score).toBe(500);
  });

  it('voids a bet that was never settled when a round is cut short', () => {
    const match = bShotDown();
    match.players[1].score = 400;
    match.placeBet(1, 3, 200);
    match.startRound();
    expect(match.players[1].score).toBe(400);
    expect(match.bets.placed.size).toBe(0);
  });

  it('is mirrored by a copy that only knows the snapshot', () => {
    const match = bShotDown();
    match.players[1].score = 400;
    match.placeBet(1, 0, 200);
    const copy = table(4);
    copy.viewer = 2;
    copy.restoreSnapshot(JSON.parse(JSON.stringify(match.snapshot())));
    expect(copy.bets.question).toEqual(match.bets.question);
    expect(copy.bets.placed.get(1)).toEqual({ player: 1, pick: 0, stake: 200, multiplier: 3 });
    expect(copy.ghost).toBe(false);
  });

  it('holds a salvo back for at least 3 s when all players lock in early, so the shot-down can bet', () => {
    const match = table(4, { salvo: true });
    match.viewer = 1;
    place(match, [[100, 400], [500, 400], [900, 200], [900, 600]]);
    aimAt(match, 0, 1);
    aimAway(match, 1, 90);
    aimAway(match, 2, 0);
    aimAway(match, 3, 270);
    for (const p of match.alive) match.commitPlayer(p.id);
    run(match, () => match.phase === 'aiming' && match.players[1].alive === false);
    expect(match.bets.question).not.toBeNull();
    for (const p of match.alive) aimAway(match, p.id, 90);
    for (const p of match.alive) match.commitPlayer(p.id);
    match.update(1);
    expect(match.phase).toBe('aiming');
    run(match, () => match.phase === 'flying', 5);
  });
});
