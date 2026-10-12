import { describe, expect, it } from 'vitest';
import { createMatch } from '../src/game';
import { ClassicMatch } from '../src/game/classic';
import { Oracle, oracleMultiplier, TIP_HIT, TIP_MISS, TIP_NOBODY } from '../src/game/oracle';
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
    expect(Object.keys(snapshot)).toEqual(['question', 'result', 'scores', 'tips']);

    const mirror = new Oracle();
    mirror.restore(snapshot);
    expect(mirror.question).toEqual(oracle.question);
    expect([...mirror.picks]).toEqual([[1, TIP_HIT], [3, TIP_MISS]]);

    // A change of mind is shared, and the tips are gone with the verdict.
    oracle.bet(1, TIP_MISS);
    mirror.restore(JSON.parse(JSON.stringify(oracle.snapshot())));
    expect(mirror.picks.get(1)).toBe(TIP_MISS);
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


// ————————————————————————————— In a match —————————————————————————————

const seatsFor = (n: number, cpu: Seat | null = null): Seat[] => Array.from({ length: 6 }, (_, i) => (i >= n ? 'off' : i === n - 1 && cpu ? cpu : 'human'));

/** A match of humans on an empty field: nothing bends a shot, so a shot flies exactly where it is aimed. */
function table(n: number, options: { salvo?: boolean; teams?: number[]; cpu?: Seat } = {}): ClassicMatch {
  const seats = seatsFor(n, options.cpu ?? null);
  const match = createMatch(
    'classic',
    { ...DEFAULT_SETTINGS, rounds: 1, maxPlanets: 0, seats, simultaneousShots: !!options.salvo, teamMode: options.teams ? 2 : 0 },
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
