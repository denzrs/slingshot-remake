import { describe, expect, it } from 'vitest';
import { createMatch } from '../src/game';
import { ClassicMatch } from '../src/game/classic';
import { Oracle, oracleAwards, oracleMultiplier, stakeOptions, TIP_HIDDEN, TIP_HIT, TIP_MISS, TIP_NOBODY } from '../src/game/oracle';
import { DEFAULT_SETTINGS, type Seat } from '../src/settings';

describe('oracle scoring', () => {
  it('pays 100 for a right shot tip, more for a streak, and a wrong tip ends the streak', () => {
    const oracle = new Oracle();
    oracle.reset(3);
    const tip = (pick: number, hit: boolean) => {
      oracle.open('shot', 2, []);
      expect(oracle.bet(1, pick)).toBe(true);
      oracle.resolve(hit ? [0] : [], hit, 1);
      return oracle.result!.tips[0];
    };
    expect(tip(TIP_HIT, true)).toMatchObject({ right: true, points: 100 });
    expect(tip(TIP_MISS, false)).toMatchObject({ right: true, points: 150 });
    expect(tip(TIP_HIT, false)).toMatchObject({ right: false, points: 0 });
    expect(oracle.scores[1]).toMatchObject({ points: 250, right: 2, total: 3, streak: 0, roundPoints: 250, roundRight: 2, roundTotal: 3 });
    expect(tip(TIP_MISS, false)).toMatchObject({ right: true, points: 100 });
  });

  it('caps the streak multiplier', () => {
    expect(oracleMultiplier(1)).toBe(1);
    expect(oracleMultiplier(3)).toBe(2);
    expect(oracleMultiplier(50)).toBe(3);
  });

  it('only takes picks that answer the open question', () => {
    const oracle = new Oracle();
    oracle.reset(4);
    expect(oracle.bet(1, TIP_HIT)).toBe(false);

    oracle.open('shot', 2, []);
    expect(oracle.accepts(TIP_HIT)).toBe(true);
    expect(oracle.accepts(TIP_MISS)).toBe(true);
    expect(oracle.accepts(3)).toBe(false);
    expect(oracle.accepts(TIP_NOBODY)).toBe(false);
    expect(oracle.accepts(0.5)).toBe(false);

    oracle.open('salvo', -1, [0, 2, 3]);
    expect(oracle.accepts(2)).toBe(true);
    expect(oracle.accepts(TIP_NOBODY)).toBe(true);
    expect(oracle.accepts(1)).toBe(false);
    expect(oracle.accepts(5)).toBe(false);
  });

  it('judges a salvo by who was destroyed, with "nobody" a possible answer', () => {
    const oracle = new Oracle();
    oracle.reset(4);
    oracle.open('salvo', -1, [0, 2, 3]);
    oracle.bet(1, 2);
    oracle.bet(3, TIP_NOBODY);
    oracle.resolve([2], false, 4);
    expect(oracle.result!.victims).toEqual([2]);
    expect(oracle.result!.tips).toEqual([
      { player: 1, pick: 2, right: true, points: 150 },
      { player: 3, pick: TIP_NOBODY, right: false, points: 0 },
    ]);

    oracle.open('salvo', -1, [0, 2, 3]);
    oracle.bet(3, TIP_NOBODY);
    oracle.resolve([], false, 9);
    expect(oracle.result!.tips[0]).toMatchObject({ right: true, points: 75 });
  });

  it('keeps the latest tip of a player, and takes none once locked', () => {
    const oracle = new Oracle();
    oracle.reset(3);
    oracle.open('shot', 0, []);
    oracle.bet(1, TIP_HIT);
    oracle.bet(1, TIP_MISS);
    oracle.lock();
    expect(oracle.bet(2, TIP_HIT)).toBe(false);
    oracle.resolve([], false, 1);
    expect(oracle.result!.tips).toEqual([{ player: 1, pick: TIP_MISS, right: true, points: 100 }]);
    expect(oracle.question).toBeNull();
  });

  it('does not count a question nobody tipped on, and ranks the tipsters', () => {
    const oracle = new Oracle();
    oracle.reset(3);
    oracle.open('shot', 0, []);
    oracle.resolve([], false, 1);
    expect(oracle.result!.tips).toEqual([]);
    expect(oracle.ranking()).toEqual([]);

    oracle.open('shot', 0, []);
    oracle.bet(1, TIP_MISS);
    oracle.bet(2, TIP_HIT);
    oracle.resolve([], false, 2);
    expect(oracle.ranking().map((r) => r.player)).toEqual([1, 2]);
    oracle.startRound();
    expect(oracle.roundRanking()).toEqual([]);
    expect(oracle.ranking().map((r) => r.player)).toEqual([1, 2]);
  });

  it('shares standings, verdicts and the open tips, so the eliminated see each other tip live', () => {
    const oracle = new Oracle();
    oracle.reset(4);
    oracle.open('shot', 2, []);
    oracle.bet(1, TIP_HIT);
    oracle.bet(3, TIP_MISS);
    const snapshot = JSON.parse(JSON.stringify(oracle.snapshot()));

    // Who tipped is shared, what they tipped stays face down …
    const mirror = new Oracle();
    mirror.restore(snapshot);
    expect(mirror.question).toEqual(oracle.question);
    expect([...mirror.picks]).toEqual([[1, TIP_HIDDEN], [3, TIP_HIDDEN]]);
    expect([...oracle.picks]).toEqual([[1, TIP_HIDDEN], [3, TIP_HIDDEN]]);

    // … until the shots are away. A change of mind before that shows no difference.
    oracle.bet(1, TIP_MISS);
    mirror.restore(JSON.parse(JSON.stringify(oracle.snapshot())));
    expect(mirror.picks.get(1)).toBe(TIP_HIDDEN);
    oracle.lock();
    mirror.restore(JSON.parse(JSON.stringify(oracle.snapshot())));
    expect([...mirror.picks]).toEqual([[1, TIP_MISS], [3, TIP_MISS]]);
    oracle.resolve([], false, 3);
    mirror.restore(JSON.parse(JSON.stringify(oracle.snapshot())));
    expect(mirror.picks.size).toBe(0);
    expect(mirror.result!.tips).toHaveLength(2);
  });

  it('copes with a host from before the live tips', () => {
    const oracle = new Oracle();
    oracle.reset(2);
    oracle.open('shot', 0, []);
    const { tips: _tips, ...old } = oracle.snapshot();
    const mirror = new Oracle();
    mirror.restore(old);
    expect(mirror.question).toEqual(oracle.question);
    expect(mirror.picks.size).toBe(0);
  });
});

describe('the reveal and the crowd', () => {
  it('pays a bonus for being right against the crowd, with at least three tipsters', () => {
    const oracle = new Oracle();
    oracle.reset(5);
    oracle.open('shot', 0, []);
    oracle.bet(1, TIP_MISS);
    oracle.bet(2, TIP_MISS);
    oracle.bet(3, TIP_HIT);
    oracle.resolve([4], true, 1);
    expect(oracle.result!.tips).toEqual([
      { player: 1, pick: TIP_MISS, right: false, points: 0 },
      { player: 2, pick: TIP_MISS, right: false, points: 0 },
      { player: 3, pick: TIP_HIT, right: true, points: 150, underdog: true },
    ]);
    expect(oracle.scores[3].stats.underdogs).toBe(1);
    expect(oracle.result!.crowd).toBe('wrong');

    // Two tipsters are not a crowd.
    oracle.open('shot', 0, []);
    oracle.bet(1, TIP_MISS);
    oracle.bet(3, TIP_HIT);
    oracle.resolve([4], true, 2);
    expect(oracle.result!.tips[1]).toEqual({ player: 3, pick: TIP_HIT, right: true, points: 150 });
    expect(oracle.result!.crowd).toBeUndefined();
  });

  it('notes when the whole crowd knew it', () => {
    const oracle = new Oracle();
    oracle.reset(4);
    oracle.open('shot', 0, []);
    for (const player of [1, 2, 3]) oracle.bet(player, TIP_HIT);
    oracle.resolve([1], true, 1);
    expect(oracle.result!.crowd).toBe('right');
    expect(oracle.result!.tips.some((tip) => tip.underdog)).toBe(false);
  });

  it('tells the living how the ghosts lean on a shot, not who tipped what', () => {
    const oracle = new Oracle();
    oracle.reset(4);
    oracle.open('shot', 0, []);
    expect(oracle.mood).toBeNull();
    oracle.bet(1, TIP_HIT);
    oracle.bet(2, TIP_MISS);
    oracle.bet(3, TIP_MISS);
    expect(oracle.mood).toEqual({ hit: 1, miss: 2 });
    oracle.bet(3, TIP_HIT);
    expect(oracle.mood).toEqual({ hit: 2, miss: 1 });

    const mirror = new Oracle();
    mirror.restore(JSON.parse(JSON.stringify(oracle.snapshot())));
    expect(mirror.mood).toEqual({ hit: 2, miss: 1 });
    oracle.resolve([], false, 1);
    expect(oracle.mood).toBeNull();

    // A salvo has no mood: the aims are secret.
    oracle.open('salvo', -1, [0, 2]);
    oracle.bet(1, 2);
    expect(oracle.mood).toBeNull();
  });
});

describe('the round question', () => {
  it('takes the ships still in, and "nobody" only where a draw is possible', () => {
    const oracle = new Oracle();
    oracle.reset(4);
    expect(oracle.betRound(1, 0, [0, 2])).toBe(false);
    oracle.openRound([0, 2, 3], false);
    expect(oracle.acceptsRound(2, [0, 2])).toBe(true);
    expect(oracle.acceptsRound(3, [0, 2])).toBe(false);
    expect(oracle.acceptsRound(1, [0, 1, 2])).toBe(false);
    expect(oracle.acceptsRound(TIP_NOBODY, [0, 2])).toBe(false);
    expect(oracle.acceptsRound(0.5, [0, 2])).toBe(false);

    const draw = new Oracle();
    draw.reset(4);
    draw.openRound([0, 2], true);
    expect(draw.acceptsRound(TIP_NOBODY, [0, 2])).toBe(true);
  });

  it('is asked once per round, however often it is opened', () => {
    const oracle = new Oracle();
    oracle.reset(4);
    oracle.openRound([0, 2, 3], false);
    const id = oracle.roundQuestion!.id;
    oracle.openRound([0, 2], false);
    expect(oracle.roundQuestion).toMatchObject({ id, choices: [0, 2, 3] });
    oracle.startRound();
    expect(oracle.roundQuestion).toBeNull();
  });

  it('pays more the more rivals the winner had to beat when the tip was made', () => {
    const oracle = new Oracle();
    oracle.reset(5);
    oracle.openRound([0, 2, 3, 4], false);
    oracle.betRound(1, 2, [0, 2, 3, 4]);
    // Changing your mind later is allowed, and pays by the odds of that moment.
    oracle.betRound(1, 3, [2, 3]);
    oracle.resolveRound([3], 1, 9);
    expect(oracle.roundResult).toMatchObject({ round: 1, winners: [3], tips: [{ player: 1, pick: 3, right: true, points: 100 }] });
    expect(oracle.roundQuestion).toBeNull();
    expect(oracle.scores[1]).toMatchObject({ points: 100, right: 1, total: 1, streak: 1 });

    oracle.openRound([0, 2, 3, 4], false);
    oracle.betRound(1, 4, [0, 2, 3, 4]);
    oracle.resolveRound([4], 2, 20);
    // Three rivals beaten, and the second right tip in a row.
    expect(oracle.roundResult!.tips[0]).toMatchObject({ right: true, points: 450 });
  });

  it('wins a whole team its tips, and judges a draw by "nobody"', () => {
    const oracle = new Oracle();
    oracle.reset(5);
    oracle.openRound([0, 1, 2, 3], false);
    oracle.betRound(4, 0, [0, 1, 2, 3]);
    oracle.resolveRound([0, 1], 1, 5);
    expect(oracle.roundResult!.tips[0]).toMatchObject({ right: true });

    oracle.openRound([2, 3], true);
    oracle.betRound(4, TIP_NOBODY, [2, 3]);
    oracle.betRound(1, 2, [2, 3]);
    oracle.resolveRound([], 2, 8);
    expect(oracle.roundResult!.tips).toMatchObject([{ player: 4, right: true, points: 300 }, { player: 1, right: false, points: 0 }]);
  });

  it('keeps the tips face down until the round is judged, and shows who tipped', () => {
    const oracle = new Oracle();
    oracle.reset(4);
    oracle.openRound([0, 2], false);
    oracle.betRound(1, 2, [0, 2]);
    oracle.betRound(3, 0, [0, 2]);
    const wire = JSON.parse(JSON.stringify(oracle.snapshot()));
    expect(wire.roundTips).toEqual([[1, TIP_HIDDEN], [3, TIP_HIDDEN]]);

    const mirror = new Oracle();
    mirror.restore(wire);
    expect(mirror.roundQuestion).toEqual(oracle.roundQuestion);
    expect([...mirror.roundTippers]).toEqual([1, 3]);
    oracle.resolveRound([2], 1, 4);
    mirror.restore(JSON.parse(JSON.stringify(oracle.snapshot())));
    expect(mirror.roundResult!.tips).toHaveLength(2);
    expect(mirror.roundTippers.size).toBe(0);
  });

  it('copes with a host from before the round question', () => {
    const oracle = new Oracle();
    oracle.reset(2);
    const { mood: _m, round: _r, roundResult: _rr, roundTips: _rt, ...old } = oracle.snapshot();
    const scores = old.scores.map(({ stats: _s, roundStats: _rs, wrongRun: _w, ...rest }) => rest);
    const mirror = new Oracle();
    mirror.restore({ ...old, scores } as never);
    expect(mirror.roundQuestion).toBeNull();
    expect(mirror.scores[0].stats).toEqual({ bestStreak: 0, worstRun: 0, hitTips: 0, missTips: 0, underdogs: 0 });
  });
});

describe('betting points on the round', () => {
  /** A round question with `n` tipsters, each on a pick and with a stake. */
  function bets(rows: { player: number; pick: number; stake: number }[]): Oracle {
    const oracle = new Oracle();
    oracle.reset(6);
    oracle.openRound([0, 1], false);
    for (const { player, pick, stake } of rows) {
      oracle.betRound(player, pick, [0, 1]);
      if (stake) expect(oracle.setStake(player, stake)).toBe(true);
    }
    return oracle;
  }

  it('lets a ghost stake half of what it may and all of it — a share of its score, in steps of ten', () => {
    expect(stakeOptions(1000)).toEqual([250, 500]);
    expect(stakeOptions(430)).toEqual([100, 210]);
    // Not worth it below the minimum, and a lone option when halving would fall short of it.
    expect(stakeOptions(30)).toEqual([]);
    expect(stakeOptions(50)).toEqual([20]);
    expect(stakeOptions(0)).toEqual([]);
    expect(stakeOptions(-5)).toEqual([]);
  });

  it('takes a stake once, on a tip, in whole steps', () => {
    const oracle = new Oracle();
    oracle.reset(4);
    oracle.openRound([0, 1], false);
    expect(oracle.setStake(2, 100)).toBe(false);
    oracle.betRound(2, 0, [0, 1]);
    expect(oracle.setStake(2, 15)).toBe(false);
    expect(oracle.setStake(2, 10)).toBe(false);
    expect(oracle.setStake(2, 100)).toBe(true);
    expect(oracle.setStake(2, 200)).toBe(false);
    expect(oracle.stakeOf(2)).toBe(100);
    // Changing the tip does not touch the stake.
    oracle.betRound(2, 1, [0, 1]);
    expect(oracle.stakeOf(2)).toBe(100);
    expect(oracle.pot).toBe(100);
  });

  it('shares the pot among the right tips in proportion to their stakes, and the wrong ones lose theirs', () => {
    const oracle = bets([
      { player: 2, pick: 0, stake: 100 },
      { player: 3, pick: 0, stake: 300 },
      { player: 4, pick: 1, stake: 200 },
    ]);
    oracle.resolveRound([0], 1, 5);
    const tips = oracle.roundResult!.tips;
    // Pot 600; 100 and 300 were right: 1:3.
    expect(tips.find((t) => t.player === 2)).toMatchObject({ stake: 100, payout: 150 });
    expect(tips.find((t) => t.player === 3)).toMatchObject({ stake: 300, payout: 450 });
    expect(tips.find((t) => t.player === 4)).toMatchObject({ stake: 200, payout: 0 });
    expect(oracle.pot).toBe(0);
  });

  it('gives every stake back when nobody was right, when everybody was, or when only one bet', () => {
    const nobody = bets([{ player: 2, pick: 1, stake: 100 }, { player: 3, pick: 1, stake: 200 }]);
    nobody.resolveRound([0], 1, 5);
    expect(nobody.roundResult!.tips.map((t) => t.payout)).toEqual([100, 200]);

    const everybody = bets([{ player: 2, pick: 0, stake: 100 }, { player: 3, pick: 0, stake: 200 }]);
    everybody.resolveRound([0], 1, 5);
    expect(everybody.roundResult!.tips.map((t) => t.payout)).toEqual([100, 200]);

    const alone = bets([{ player: 2, pick: 0, stake: 100 }, { player: 3, pick: 1, stake: 0 }]);
    alone.resolveRound([0], 1, 5);
    expect(alone.roundResult!.tips[0]).toMatchObject({ stake: 100, payout: 100 });
    expect(alone.roundResult!.tips[1].stake).toBeUndefined();
  });

  it('pays in steps of ten and leaves the rest in the pot', () => {
    const oracle = bets([
      { player: 2, pick: 0, stake: 20 },
      { player: 3, pick: 0, stake: 20 },
      { player: 4, pick: 0, stake: 20 },
      { player: 5, pick: 1, stake: 30 },
    ]);
    oracle.resolveRound([0], 1, 5);
    // Pot 90 over three right tips: 30 each.
    expect(oracle.roundResult!.tips.filter((t) => t.right).map((t) => t.payout)).toEqual([30, 30, 30]);
    const odd = bets([{ player: 2, pick: 0, stake: 20 }, { player: 3, pick: 0, stake: 30 }, { player: 4, pick: 1, stake: 20 }]);
    odd.resolveRound([0], 1, 5);
    // Pot 70 over 20:30 → 28 and 42 → 20 and 40.
    expect(odd.roundResult!.tips.filter((t) => t.right).map((t) => t.payout)).toEqual([20, 40]);
  });

  it('shares the stakes on the wire, without telling what was tipped', () => {
    const oracle = bets([{ player: 2, pick: 0, stake: 100 }]);
    const mirror = new Oracle();
    mirror.restore(JSON.parse(JSON.stringify(oracle.snapshot())));
    expect(mirror.stakeOf(2)).toBe(100);
    expect(mirror.pot).toBe(100);
    expect(mirror.canStake(2)).toBe(false);
    oracle.resolveRound([0], 1, 5);
    mirror.restore(JSON.parse(JSON.stringify(oracle.snapshot())));
    expect(mirror.pot).toBe(0);
    expect(mirror.roundResult!.tips[0].stake).toBe(100);
  });

  it('copes with a host from before the bets', () => {
    const oracle = new Oracle();
    oracle.reset(2);
    const { roundStakes: _s, ...old } = oracle.snapshot();
    const mirror = new Oracle();
    mirror.restore(old);
    expect(mirror.pot).toBe(0);
  });
});

describe('the oracle honours', () => {
  /** Tips `picks` (hit = true) on as many shots, with `hit` the outcome; each tipster gets their own run. */
  function play(oracle: Oracle, tips: Record<number, boolean[]>, outcomes: boolean[]): void {
    outcomes.forEach((hit, i) => {
      oracle.open('shot', 0, []);
      for (const [player, picks] of Object.entries(tips)) if (picks[i] !== undefined) oracle.bet(Number(player), picks[i] ? TIP_HIT : TIP_MISS);
      oracle.resolve(hit ? [1] : [], hit, i);
    });
  }

  it('names the prophet, the seer, the pessimist and the unlucky one — only when they are clear', () => {
    const oracle = new Oracle();
    oracle.reset(4);
    // Shots: hit, miss, miss, hit, miss. Dora says "miss" every time; Ben is right three times in a row; Cleo is wrong thrice.
    play(oracle, { 1: [true, false, false, true, false], 2: [false, true, true, false, true], 3: [false, false, false, false, false] }, [true, false, false, true, false]);
    const awards = oracleAwards(oracle.scores, 'match');
    expect(awards).toContainEqual({ kind: 'seer', player: 1, value: 5 });
    expect(awards).toContainEqual({ kind: 'pessimist', player: 3, value: 5 });
    expect(awards).toContainEqual({ kind: 'unlucky', player: 2, value: 5 });
    expect(awards.find((a) => a.kind === 'prophet')).toMatchObject({ player: 1 });
    expect(awards.some((a) => a.kind === 'optimist')).toBe(false);
  });

  it('gives nothing for a tie at the top or for too little', () => {
    const oracle = new Oracle();
    oracle.reset(3);
    play(oracle, { 1: [true], 2: [true] }, [true]);
    expect(oracleAwards(oracle.scores, 'match')).toEqual([]);
    expect(oracleAwards(oracle.scores, 'round')).toEqual([]);
  });

  it('keeps a round apart from the match', () => {
    const oracle = new Oracle();
    oracle.reset(3);
    play(oracle, { 1: [true, true, true] }, [true, true, true]);
    expect(oracleAwards(oracle.scores, 'round').find((a) => a.kind === 'seer')).toMatchObject({ player: 1, value: 3 });
    oracle.startRound();
    expect(oracleAwards(oracle.scores, 'round')).toEqual([]);
    expect(oracleAwards(oracle.scores, 'match').find((a) => a.kind === 'seer')).toMatchObject({ player: 1, value: 3 });
  });

  it('counts the lone wolves', () => {
    const oracle = new Oracle();
    oracle.reset(5);
    // Three tipsters, two say miss and the shot hits: the one who said hit is right against the crowd.
    play(oracle, { 1: [true], 2: [false], 3: [false] }, [true]);
    expect(oracleAwards(oracle.scores, 'round')).toContainEqual({ kind: 'wolf', player: 1, value: 1 });
  });
});

// ————————————————————————————— In a match —————————————————————————————

const seatsFor = (n: number, cpu: Seat | null = null): Seat[] => Array.from({ length: 6 }, (_, i) => (i >= n ? 'off' : i === n - 1 && cpu ? cpu : 'human'));

/** A match of humans on an empty field: nothing bends a shot, so a shot flies exactly where it is aimed. */
function table(n: number, options: { salvo?: boolean; teams?: number[]; cpu?: Seat; betting?: boolean } = {}): ClassicMatch {
  const seats = seatsFor(n, options.cpu ?? null);
  const match = createMatch(
    'classic',
    { ...DEFAULT_SETTINGS, rounds: 1, maxPlanets: 0, seats, simultaneousShots: !!options.salvo, teamMode: options.teams ? 2 : 0, betting: !!options.betting },
    { seats, seed: 11, deterministicCpu: true, oracle: true, simultaneous: !!options.salvo, teams: options.teams },
  ) as ClassicMatch;
  return match;
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

describe('the oracle in a match', () => {
  it('opens a "will it hit?" question for the next human shooter once somebody is out', () => {
    const match = table(3);
    match.viewer = 1;
    place(match, [[100, 400], [700, 400], [400, 100]]);
    expect(match.oracle.question).toBeNull();

    aimAt(match, 0, 1);
    match.commitPlayer(0);
    run(match, () => match.phase === 'aiming' && match.current === 2);

    expect(match.players[1].alive).toBe(false);
    expect(match.ghost).toBe(true);
    expect(match.oracle.question).toMatchObject({ kind: 'shot', shooter: 2, locked: false });
    expect(match.canBet(1)).toBe(true);
    expect(match.canBet(0)).toBe(false);
    expect(match.placeBet(0, TIP_HIT)).toBe(false);
    expect(match.placeBet(1, 4)).toBe(false);
    expect(match.placeBet(1, TIP_HIT)).toBe(true);
    expect(match.oracle.mine).toEqual({ id: match.oracle.question!.id, pick: TIP_HIT });
  });

  it('closes the question when the shot is fired and judges it when it lands', () => {
    const match = table(3);
    match.viewer = 1;
    place(match, [[100, 400], [700, 400], [400, 100]]);
    aimAt(match, 0, 1);
    match.commitPlayer(0);
    run(match, () => match.phase === 'aiming' && match.current === 2);
    match.placeBet(1, TIP_HIT);

    aimAt(match, 2, 0);
    match.commitPlayer(2);
    expect(match.oracle.question!.locked).toBe(true);
    expect(match.placeBet(1, TIP_MISS)).toBe(false);
    run(match, () => match.phase !== 'flying');

    expect(match.oracle.result).toMatchObject({ kind: 'shot', shooter: 2, victims: [0], hit: true });
    expect(match.oracle.result!.tips).toEqual([{ player: 1, pick: TIP_HIT, right: true, points: 100 }]);
    expect(match.oracle.scores[1]).toMatchObject({ points: 100, right: 1, total: 1, streak: 1 });
    expect(match.oracle.question).toBeNull();
  });

  it('counts a shot that misses as a miss', () => {
    const match = table(3);
    match.viewer = 1;
    place(match, [[100, 400], [700, 400], [400, 100]]);
    aimAt(match, 0, 1);
    match.commitPlayer(0);
    run(match, () => match.phase === 'aiming' && match.current === 2);
    match.placeBet(1, TIP_HIT);

    aimAway(match, 2, 90);
    match.commitPlayer(2);
    run(match, () => match.phase !== 'flying');

    expect(match.oracle.result).toMatchObject({ hit: false, victims: [] });
    expect(match.oracle.result!.tips).toEqual([{ player: 1, pick: TIP_HIT, right: false, points: 0 }]);
    // The next shooter gets a fresh question.
    expect(match.oracle.question).toMatchObject({ shooter: 0, locked: false });
    expect(match.oracle.question!.id).toBeGreaterThan(match.oracle.result!.id);
  });

  it('does not count shooting a teammate as a hit', () => {
    const match = table(4, { teams: [0, 0, 1, 1] });
    match.viewer = 1;
    place(match, [[100, 400], [500, 400], [900, 200], [900, 600]]);
    aimAt(match, 0, 1);
    match.commitPlayer(0);
    run(match, () => match.phase === 'aiming' && match.current === 2);
    expect(match.oracle.question).toMatchObject({ kind: 'shot', shooter: 2 });
    match.placeBet(1, TIP_MISS);

    aimAt(match, 2, 3);
    match.commitPlayer(2);
    run(match, () => match.phase !== 'flying');

    expect(match.players[3].alive).toBe(false);
    expect(match.oracle.result).toMatchObject({ hit: false, victims: [3] });
    expect(match.oracle.result!.tips[0]).toMatchObject({ right: true });
  });

  it('asks nothing while a CPU is on turn', () => {
    const match = table(3, { cpu: 'medium' });
    match.viewer = 1;
    place(match, [[100, 400], [700, 400], [400, 100]]);
    aimAt(match, 0, 1);
    match.commitPlayer(0);
    run(match, () => match.phase === 'aiming' && match.current === 2);
    expect(match.players[2].cpu).not.toBeNull();
    expect(match.oracle.question).toBeNull();
    expect(match.canBet(1)).toBe(false);
  });

  it('asks nothing offline or while everybody is alive', () => {
    const offline = createMatch('classic', { ...DEFAULT_SETTINGS, rounds: 1, seats: seatsFor(3) }, { seats: seatsFor(3) }) as ClassicMatch;
    offline.players[1].alive = false;
    expect(offline.canBet(1)).toBe(false);

    const online = table(3);
    expect(online.oracle.question).toBeNull();
  });

  it('asks "who gets hit?" for every salvo and judges it by the ships that fall', () => {
    const match = table(4, { salvo: true });
    match.viewer = 1;
    place(match, [[100, 400], [500, 400], [900, 200], [900, 600]]);
    const lockIn = (aims: Record<number, number | 'away'>) => {
      for (const [id, target] of Object.entries(aims)) {
        if (target === 'away') continue;
        aimAt(match, Number(id), target);
      }
      for (const p of match.alive) match.commitPlayer(p.id);
    };

    // Volley 1: A shoots B; the others fire off the field. Nobody is out yet, so nobody tips.
    expect(match.oracle.question).toBeNull();
    aimAt(match, 0, 1);
    aimAway(match, 1, 90);
    aimAway(match, 2, 0);
    aimAway(match, 3, 270);
    for (const p of match.alive) match.commitPlayer(p.id);
    run(match, () => match.phase === 'aiming' && match.players[1].alive === false);

    expect(match.oracle.question).toMatchObject({ kind: 'salvo', choices: [0, 2, 3], locked: false });
    expect(match.placeBet(1, 1)).toBe(false);
    expect(match.placeBet(1, 2)).toBe(true);

    // Volley 2: D shoots C.
    aimAway(match, 0, 270);
    aimAway(match, 2, 180);
    aimAt(match, 3, 2);
    lockIn({});
    run(match, () => match.phase === 'aiming' && match.players[2].alive === false);
    expect(match.oracle.result).toMatchObject({ kind: 'salvo', victims: [2] });
    expect(match.oracle.result!.tips).toEqual([{ player: 1, pick: 2, right: true, points: 150 }]);

    // Volley 3: nobody is hit, and the ghost said so.
    expect(match.oracle.question!.choices).toEqual([0, 3]);
    const judged = match.oracle.result!.id;
    match.placeBet(1, TIP_NOBODY);
    aimAway(match, 0, 270);
    aimAway(match, 3, 0);
    lockIn({});
    run(match, () => match.oracle.result!.id !== judged);
    expect(match.oracle.result!.tips).toEqual([{ player: 1, pick: TIP_NOBODY, right: true, points: 115 }]);
  });

  it('is mirrored by a copy that only knows the snapshot — without the open tips', () => {
    const match = table(3);
    match.viewer = 1;
    place(match, [[100, 400], [700, 400], [400, 100]]);
    aimAt(match, 0, 1);
    match.commitPlayer(0);
    run(match, () => match.phase === 'aiming' && match.current === 2);
    match.placeBet(1, TIP_HIT);

    const copy = table(3);
    copy.restoreSnapshot(JSON.parse(JSON.stringify(match.snapshot())));
    expect(copy.oracle.question).toEqual(match.oracle.question);
    expect(copy.oracle.scores).toEqual(match.oracle.scores);
    expect(copy.oracle.mine).toBeNull();
  });

  it('asks who wins the round once somebody is out and two or more ships are left, takes tips only while aiming, and judges it at the end', () => {
    const match = table(4);
    match.viewer = 1;
    place(match, [[700, 400], [500, 400], [900, 300], [900, 700]]);
    expect(match.oracle.roundQuestion).toBeNull();
    expect(match.canBetRound(1)).toBe(false);

    // A shoots B: three ships are left and the question is open.
    aimAt(match, 0, 1);
    match.commitPlayer(0);
    run(match, () => match.phase === 'aiming' && match.current === 2);
    expect(match.oracle.roundQuestion).toMatchObject({ kind: 'winner', choices: [0, 2, 3], draw: false });
    expect(match.roundChoices).toEqual([0, 2, 3]);
    expect(match.canBetRound(1)).toBe(true);
    expect(match.canBetRound(0)).toBe(false);
    expect(match.placeBet(0, 3, true)).toBe(false);
    expect(match.placeBet(1, 1, true)).toBe(false);
    expect(match.placeBet(1, TIP_NOBODY, true)).toBe(false);
    expect(match.placeBet(1, 3, true)).toBe(true);
    expect(match.oracle.roundMine).toEqual({ id: match.oracle.roundQuestion!.id, pick: 3 });
    // The shot tip and the round tip are two different things.
    expect(match.oracle.question).toMatchObject({ kind: 'shot', shooter: 2 });
    expect(match.oracle.mine).toBeNull();

    // Once the shots fly, the tips on the round stay as they are.
    aimAway(match, 2, 90);
    match.commitPlayer(2);
    expect(match.placeBet(1, 0, true)).toBe(false);
    run(match, () => match.phase === 'aiming' && match.current === 3);

    // D shoots C, who joins the ghosts and tips on A.
    aimAt(match, 3, 2);
    match.commitPlayer(3);
    run(match, () => match.phase === 'aiming' && match.current === 0);
    match.viewer = 2;
    expect(match.placeBet(2, 0, true)).toBe(true);
    expect(match.oracle.roundTippers.size).toBe(2);

    aimAt(match, 0, 3);
    match.commitPlayer(0);
    run(match, () => match.phase === 'roundOver');

    expect(match.oracle.roundQuestion).toBeNull();
    expect(match.oracle.roundResult).toMatchObject({ kind: 'winner', round: 1, winners: [0] });
    // B tipped D while three ships were in (200 if D had won) — wrong. C tipped A with two in: 100.
    expect(match.oracle.roundResult!.tips).toEqual([
      { player: 1, pick: 3, right: false, points: 0 },
      { player: 2, pick: 0, right: true, points: 100 },
    ]);
    expect(match.oracle.scores[2]).toMatchObject({ points: 100, roundPoints: 100 });
    expect(match.oracle.roundRanking().map((r) => r.player)).toEqual([2, 1]);
  });

  it('asks nothing about the round while it is a duel from the start, or offline', () => {
    const duel = table(2);
    duel.viewer = 1;
    place(duel, [[100, 400], [700, 400]]);
    aimAt(duel, 0, 1);
    duel.commitPlayer(0);
    run(duel, () => duel.phase === 'roundOver');
    expect(duel.oracle.roundQuestion).toBeNull();
    expect(duel.oracle.roundResult).toBeNull();

    const offline = createMatch('classic', { ...DEFAULT_SETTINGS, rounds: 1, seats: seatsFor(3) }, { seats: seatsFor(3) }) as ClassicMatch;
    offline.players[1].alive = false;
    expect(offline.canBetRound(1)).toBe(false);
  });

  it('lets a whole team win the question', () => {
    const match = table(4, { teams: [0, 0, 1, 1] });
    match.viewer = 3;
    match.players[3].alive = false;
    match.players[2].alive = false;
    match.oracle.openRound([0, 1, 2, 3], false);
    expect(match.placeBet(3, 1, true)).toBe(true);
    (match as unknown as { endRound(): void }).endRound();
    expect(match.oracle.roundResult).toMatchObject({ winners: [0, 1] });
    expect(match.oracle.roundResult!.tips).toEqual([{ player: 3, pick: 1, right: true, points: 100 }]);
  });

  it('allows a draw to be tipped when everybody aims at once, and calls it when nobody is left', () => {
    const match = table(3, { salvo: true });
    match.viewer = 2;
    place(match, [[100, 400], [900, 400], [500, 100]]);
    match.players[2].alive = false;
    match.oracle.openRound([0, 1], true);
    expect(match.placeBet(2, TIP_NOBODY, true)).toBe(true);
    match.players[0].alive = false;
    match.players[1].alive = false;
    (match as unknown as { endRound(): void }).endRound();
    expect(match.oracle.roundResult).toMatchObject({ winners: [] });
    expect(match.oracle.roundResult!.tips[0]).toMatchObject({ right: true, points: 200 });
  });

  it('keeps the ghosts\' mood on the open shot for the living, and the tips face down on the wire', () => {
    const match = table(3);
    match.viewer = 1;
    place(match, [[100, 400], [700, 400], [400, 100]]);
    aimAt(match, 0, 1);
    match.commitPlayer(0);
    run(match, () => match.phase === 'aiming' && match.current === 2);
    expect(match.oracle.mood).toBeNull();
    match.placeBet(1, TIP_MISS);
    expect(match.oracle.mood).toEqual({ hit: 0, miss: 1 });

    const copy = table(3);
    copy.viewer = 2;
    copy.restoreSnapshot(JSON.parse(JSON.stringify(match.snapshot())));
    expect(copy.oracle.mood).toEqual({ hit: 0, miss: 1 });
    expect(copy.oracle.picks.get(1)).toBe(TIP_HIDDEN);
    expect(copy.ghost).toBe(false);
  });

  it('takes a stake on the round out of the ghost\'s score and pays the winners out of the pot at the end of the round', () => {
    const match = table(4, { betting: true });
    match.viewer = 1;
    place(match, [[700, 400], [500, 400], [900, 300], [900, 700]]);
    aimAt(match, 0, 1);
    match.commitPlayer(0);
    run(match, () => match.phase === 'aiming' && match.current === 2);
    // B is out with 800 points of an earlier round; no tip, no bet.
    match.players[1].score = 800;
    expect(match.maxStake(1)).toBe(0);
    expect(match.placeBet(1, 3, true, 400)).toBe(true);
    expect(match.oracle.stakeOf(1)).toBe(400);
    expect(match.players[1].score).toBe(400);
    expect(match.oracle.pot).toBe(400);
    // Once: a second stake changes nothing — and neither does a larger one than the share allows.
    expect(match.placeBet(1, 3, true, 100)).toBe(true);
    expect(match.oracle.stakeOf(1)).toBe(400);
    expect(match.players[1].score).toBe(400);
    expect(match.maxStake(1)).toBe(0);
  });

  it('plays without bets unless the room allows them: the tip is taken, the stake is not', () => {
    const match = table(4);
    match.viewer = 1;
    place(match, [[700, 400], [500, 400], [900, 300], [900, 700]]);
    aimAt(match, 0, 1);
    match.commitPlayer(0);
    run(match, () => match.phase === 'aiming' && match.current === 2);
    match.players[1].score = 800;
    expect(match.maxStake(1)).toBe(0);
    expect(match.placeBet(1, 3, true, 400)).toBe(true);
    expect(match.oracle.roundMine).toMatchObject({ pick: 3 });
    expect(match.oracle.stakeOf(1)).toBe(0);
    expect(match.players[1].score).toBe(800);
  });

  it('refuses a stake above the share of the score, from a ghost without points, or from the living', () => {
    const match = table(4, { betting: true });
    match.viewer = 1;
    place(match, [[700, 400], [500, 400], [900, 300], [900, 700]]);
    aimAt(match, 0, 1);
    match.commitPlayer(0);
    run(match, () => match.phase === 'aiming' && match.current === 2);
    match.players[1].score = 100;
    expect(match.placeBet(1, 3, true, 60)).toBe(true);
    expect(match.oracle.stakeOf(1)).toBe(0);
    expect(match.players[1].score).toBe(100);
    expect(match.placeBet(1, 3, true, 50)).toBe(true);
    expect(match.oracle.stakeOf(1)).toBe(50);
    // The living cannot bet, with whatever points they have.
    match.players[3].score = 1000;
    expect(match.placeBet(3, 0, true, 200)).toBe(false);
    expect(match.oracle.stakeOf(3)).toBe(0);
    expect(match.players[3].score).toBe(1000);
  });

  it('counts the bets of the round into the scores when it ends: the pot to the right tips, the rest lost, and into the history', () => {
    const match = table(4, { betting: true });
    match.viewer = 1;
    place(match, [[700, 400], [500, 400], [900, 300], [900, 700]]);
    aimAt(match, 0, 1);
    match.commitPlayer(0);
    run(match, () => match.phase === 'aiming' && match.current === 2);
    aimAway(match, 2, 90);
    match.players[1].score = 400;
    match.placeBet(1, 3, true, 200);
    match.commitPlayer(2);
    run(match, () => match.phase === 'aiming' && match.current === 3);
    // C is out too, with points, and bets on A, who is going to win.
    aimAt(match, 3, 2);
    match.commitPlayer(3);
    run(match, () => match.phase === 'aiming' && match.current === 0);
    match.players[2].score += 500 - match.players[2].score;
    match.viewer = 2;
    match.placeBet(2, 0, true, 250);
    expect(match.players[2].score).toBe(250);
    const before = [...match.players].map((p) => p.score);
    aimAt(match, 0, 3);
    match.commitPlayer(0);
    run(match, () => match.phase === 'roundOver');

    // Pot 450: B (on D, wrong) loses 200, C (on A, right) gets the pot: 250 → 450.
    expect(match.oracle.roundResult!.tips).toMatchObject([
      { player: 1, pick: 3, right: false, stake: 200, payout: 0 },
      { player: 2, pick: 0, right: true, stake: 250, payout: 450 },
    ]);
    expect(match.players[1].score).toBe(before[1]);
    expect(match.players[2].score).toBe(before[2] + 450);
    expect(match.scoreHistory.at(-1)![2]).toBe(match.players[2].score);
    expect(match.oracle.pot).toBe(0);
  });

  it('gives the stakes back when a round is cut short', () => {
    const match = table(4, { betting: true });
    match.viewer = 1;
    place(match, [[700, 400], [500, 400], [900, 300], [900, 700]]);
    aimAt(match, 0, 1);
    match.commitPlayer(0);
    run(match, () => match.phase === 'aiming' && match.current === 2);
    match.players[1].score = 400;
    match.placeBet(1, 3, true, 200);
    expect(match.players[1].score).toBe(200);
    match.startRound();
    expect(match.players[1].score).toBe(400);
    expect(match.oracle.pot).toBe(0);
  });

  it('starts every match with clean standings and every round with clean round tallies', () => {
    const match = table(3);
    match.viewer = 1;
    place(match, [[100, 400], [700, 400], [400, 100]]);
    aimAt(match, 0, 1);
    match.commitPlayer(0);
    run(match, () => match.phase === 'aiming' && match.current === 2);
    match.placeBet(1, TIP_HIT);
    aimAt(match, 2, 0);
    match.commitPlayer(2);
    run(match, () => match.phase === 'roundOver');
    expect(match.oracle.scores[1].roundPoints).toBe(100);

    match.startRound();
    expect(match.oracle.scores[1]).toMatchObject({ points: 100, roundPoints: 0, roundTotal: 0 });
    match.newMatch();
    expect(match.oracle.scores[1]).toMatchObject({ points: 0, total: 0, streak: 0 });
    expect(match.oracle.result).toBeNull();
  });
});
