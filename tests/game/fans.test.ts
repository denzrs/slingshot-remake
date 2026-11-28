import { describe, expect, it } from 'vitest';
import { createMatch } from '../../src/game';
import { ClassicMatch } from '../../src/game/classic';
import { FanClub } from '../../src/game/fans';
import { BetBook, lossOf, oddsOf } from '../../src/game/bets';
import { DEFAULT_SETTINGS, type Seat } from '../../src/data/settings';
import { BETS, FANS } from '../../src/sim/config';
import { roundReport } from '../../src/game/roundReport';

describe('the fan club', () => {
  it('lets a fan switch ships and cheer, but not faster than the gap, and keeps the count across a snapshot', () => {
    const club = new FanClub();
    expect(club.cheer(1, 0)).toBe(false);
    club.follow(1, 2);
    expect(club.cheer(1, 10)).toBe(true);
    expect(club.cheer(1, 10 + FANS.CHEER_GAP / 2)).toBe(false);
    expect(club.cheer(1, 10 + FANS.CHEER_GAP)).toBe(true);
    club.follow(1, 3);
    expect(club.of(1)).toMatchObject({ pick: 3, cheers: 2 });

    const copy = new FanClub();
    copy.restore(JSON.parse(JSON.stringify(club.snapshot())));
    expect(copy.of(1)).toMatchObject({ pick: 3, cheers: 2 });
    club.reset();
    expect(club.of(1)).toBeUndefined();
  });
});

const seats: Seat[] = ['human', 'human', 'human', 'human', 'off', 'off'];

/** Four ships on an empty field, online or not, with or without bets. */
function table(options: { online?: boolean; betting?: boolean } = {}): ClassicMatch {
  return createMatch(
    'classic',
    { ...DEFAULT_SETTINGS, rounds: 2, maxPlanets: 0, seats, betting: options.betting ?? false },
    { seats, seed: 11, deterministicCpu: true, online: options.online ?? true },
  ) as ClassicMatch;
}

function run(match: ClassicMatch, done: () => boolean, seconds = 120): void {
  for (let t = 0; t < seconds && !done(); t += 1 / 30) match.update(1 / 30);
  expect(done()).toBe(true);
}

/** A shoots B, so B is out while C aims, with three ships still in. */
function bShotDown(options: { online?: boolean; betting?: boolean } = {}): ClassicMatch {
  const match = table(options);
  match.viewer = 1;
  [[700, 400], [500, 400], [900, 300], [900, 700]].forEach(([x, y], i) => Object.assign(match.world.ships[i], { x, y }));
  const [a, b] = [match.world.ships[0], match.world.ships[1]];
  match.setPlayerAim(0, (Math.atan2(-(b.y - a.y), b.x - a.x) * 180) / Math.PI, Math.hypot(b.x - a.x, b.y - a.y) / 8);
  match.commitPlayer(0);
  run(match, () => match.phase === 'aiming' && match.current === 2);
  return match;
}

describe('fans in a match', () => {
  it('online, the shot-down root for a ship still in and cheer it on, with or without bets in the room', () => {
    const match = bShotDown();
    expect(match.bettingOn).toBe(false);
    expect(match.inPod).toBe(true);
    expect(match.fanChoices).toEqual([0, 2, 3]);
    expect(match.follow(1, 1)).toBe(false);
    expect(match.follow(2, 0)).toBe(false);
    expect(match.cheerOn(1)).toBe(false);
    expect(match.follow(1, 2)).toBe(true);
    expect(match.fansOf(2)).toBe(1);
    expect(match.cheerOn(1)).toBe(true);
    expect(match.cheerOn(1)).toBe(false);
    expect(match.fans.of(1)).toMatchObject({ pick: 2, cheers: 1 });
  });

  it('is done rooting for the round once the side it rooted for is out: its pod went up with the ship', () => {
    const match = bShotDown();
    match.follow(1, 2);
    match.players[2].alive = false;
    expect(match.podLost(1)).toBe(true);
    expect(match.cheerOn(1)).toBe(false);
    expect(match.follow(1, 3)).toBe(false);
  });

  it('has no fans offline', () => {
    const match = bShotDown({ online: false });
    expect(match.fansOn).toBe(false);
    expect(match.inPod).toBe(false);
    expect(match.follow(1, 2)).toBe(false);
  });

  it('makes a bettor a fan of the ship bet on, and keeps them there', () => {
    const match = bShotDown({ betting: true });
    match.players[1].score = 1000;
    expect(match.follow(1, 3)).toBe(true);
    run(match, () => match.phaseTime >= 0.1);
    expect(match.placeBet(1, 2, 250)).toBe(true);
    expect(match.fans.of(1)?.pick).toBe(2);
    expect(match.follow(1, 3)).toBe(false);
  });

  it('sends the fans along in the snapshot, and starts every round without any', () => {
    const match = bShotDown();
    match.follow(1, 3);
    match.cheerOn(1);
    const guest = table();
    (guest as unknown as { restoreSnapshot(s: unknown): void }).restoreSnapshot(JSON.parse(JSON.stringify(match.snapshot())));
    expect(guest.fans.of(1)).toMatchObject({ pick: 3, cheers: 1 });
    match.startRound();
    expect(match.fans.all.size).toBe(0);
  });
});

/** Aims one ship at another so that the shot arrives after about a second. */
function aimAt(match: ClassicMatch, from: number, to: number): void {
  const a = match.world.ships[from];
  const b = match.world.ships[to];
  match.setPlayerAim(from, (Math.atan2(-(b.y - a.y), b.x - a.x) * 180) / Math.PI, Math.hypot(b.x - a.x, b.y - a.y) / 8);
}

/** C fires at D and destroys it; whatever was called on C's shot comes out. */
function cShootsD(match: ClassicMatch): void {
  aimAt(match, 2, 3);
  match.commitPlayer(2);
  run(match, () => match.phase === 'flying');
  run(match, () => match.phase !== 'flying');
}

describe('calls on the next shot', () => {
  it('may be made only while the ship rooted for aims that shot, and changed until it flies', () => {
    const match = bShotDown();
    match.follow(1, 3);
    expect(match.canCall(1)).toBe(false);
    expect(match.callShot(1, 'hit')).toBe(false);
    match.follow(1, 2);
    expect(match.canCall(1)).toBe(true);
    expect(match.callShot(1, 'miss')).toBe(true);
    expect(match.callShot(1, 'hit')).toBe(true);
    expect(match.fans.of(1)?.call).toMatchObject({ kind: 'hit', state: 'open' });
  });

  it('hold the aiming open long enough to call, with bets off too', () => {
    const match = bShotDown();
    const window = () => (match as unknown as { betWindowDone: boolean }).betWindowDone;
    match.phaseTime = 0.7;
    expect(window()).toBe(true);
    match.follow(1, 2);
    expect(window()).toBe(false);
    match.phaseTime = BETS.MIN_BET_TIME;
    expect(window()).toBe(true);
  });

  it('may be made on the shot of a CPU as of a person, and in a salvo on any ship in it', () => {
    const cpu = bShotDown();
    cpu.players[2].cpu = 'medium';
    cpu.follow(1, 2);
    expect(cpu.canCall(1)).toBe(true);

    const salvo = bShotDown();
    Object.defineProperty(salvo, 'salvo', { get: () => true });
    salvo.follow(1, 3);
    expect(salvo.current).not.toBe(3);
    expect(salvo.canCall(1)).toBe(true);
  });

  it('come out when the shot has flown: a right "hits" adds to the odds of the bet on that ship', () => {
    const match = bShotDown({ betting: true });
    match.players[1].score = 1000;
    run(match, () => match.phaseTime >= 0.1);
    expect(match.placeBet(1, 2, 250)).toBe(true);
    const before = match.bets.placed.get(1)!.multiplier;
    expect(match.callShot(1, 'hit')).toBe(true);
    cShootsD(match);
    expect(match.players[3].alive).toBe(false);
    expect(match.fans.of(1)?.call).toMatchObject({ kind: 'hit', state: 'right' });
    expect(oddsOf(match.bets.placed.get(1)!)).toBe(before + FANS.CALL_HIT);
  });

  it('take a little off the odds when wrong; without a bet a right call pays a few points and a wrong one nothing', () => {
    const betting = bShotDown({ betting: true });
    betting.players[1].score = 1000;
    run(betting, () => betting.phaseTime >= 0.1);
    betting.placeBet(1, 2, 250);
    const before = betting.bets.placed.get(1)!.multiplier;
    betting.callShot(1, 'miss');
    cShootsD(betting);
    expect(betting.fans.of(1)?.call?.state).toBe('wrong');
    expect(oddsOf(betting.bets.placed.get(1)!)).toBe(before + FANS.CALL_WRONG);

    const fun = bShotDown();
    fun.follow(1, 2);
    fun.callShot(1, 'hit');
    const funScore = fun.players[1].score;
    cShootsD(fun);
    expect(fun.fans.of(1)?.call?.state).toBe('right');
    expect(fun.bets.placed.size).toBe(0);
    expect(fun.players[1].score).toBe(funScore + FANS.CALL_POINTS.hit);

    const wrong = bShotDown();
    wrong.follow(1, 2);
    wrong.callShot(1, 'miss');
    const score = wrong.players[1].score;
    cShootsD(wrong);
    expect(wrong.fans.of(1)?.call?.state).toBe('wrong');
    expect(wrong.players[1].score).toBe(score);
  });

  it('go to the statistics as tips on a shot, right or wrong, staking nothing, with or without bets', () => {
    const right = bShotDown();
    right.follow(1, 2);
    right.callShot(1, 'hit');
    cShootsD(right);
    expect(right.bets.judged).toEqual([{ kind: 'shot', right: true, stake: 0, payout: 0, underdog: false, stands: false }]);
    expect(roundReport(right as never).tips).toEqual(right.bets.judged);

    const wrong = bShotDown({ betting: true });
    wrong.players[1].score = 1000;
    run(wrong, () => wrong.phaseTime >= 0.1);
    wrong.placeBet(1, 2, 250);
    wrong.callShot(1, 'miss');
    cShootsD(wrong);
    expect(wrong.bets.judged.filter((tip) => tip.kind === 'shot')).toEqual([{ kind: 'shot', right: false, stake: 0, payout: 0, underdog: false, stands: false }]);
  });

  it('make the cheers more epic: every right call counts for the match, up to the most, and goes along in the snapshot', () => {
    const match = bShotDown();
    expect(match.cheerLevel(1)).toBe(0);
    match.follow(1, 2);
    match.callShot(1, 'hit');
    cShootsD(match);
    expect(match.callsRight[1]).toBe(1);
    expect(match.cheerLevel(1)).toBe(1);
    match.callsRight[1] = 9;
    expect(match.cheerLevel(1)).toBe(FANS.EPIC_MAX);
    const guest = table();
    (guest as unknown as { restoreSnapshot(s: unknown): void }).restoreSnapshot(JSON.parse(JSON.stringify(match.snapshot())));
    expect(guest.callsRight[1]).toBe(9);
    // A new round keeps the count.
    match.startRound();
    expect(match.callsRight[1]).toBe(9);
  });

  it('take back the calls got right in a round skipped by vote, as its points', () => {
    const match = bShotDown();
    match.follow(1, 2);
    match.callShot(1, 'hit');
    cShootsD(match);
    expect(match.callsRight[1]).toBe(1);
    (match as unknown as { skipRound(): void }).skipRound();
    expect(match.callsRight[1]).toBe(0);
  });

  it('go along in the snapshot', () => {
    const match = bShotDown();
    match.follow(1, 2);
    match.callShot(1, 'hitBy');
    const guest = table();
    (guest as unknown as { restoreSnapshot(s: unknown): void }).restoreSnapshot(JSON.parse(JSON.stringify(match.snapshot())));
    expect(guest.fans.of(1)?.call).toMatchObject({ kind: 'hitBy', state: 'open' });
  });
});

describe('what the calls do to a bet', () => {
  it('never take the odds below the floor, and an insured bet loses only part of its stake', () => {
    const book = new BetBook();
    book.reset(4);
    book.openRound([0, 2, 3], false);
    expect(book.place(1, 2, 300, [0, 2, 3], 3)).toBe(true);
    for (let i = 0; i < 20; i++) book.adjust(1, FANS.CALL_WRONG, false);
    expect(oddsOf(book.placed.get(1)!)).toBe(FANS.MIN_ODDS);
    book.adjust(1, 0, true);
    expect(lossOf(book.placed.get(1)!)).toBe(Math.ceil((300 * FANS.INSURED) / BETS.STAKE_STEP) * BETS.STAKE_STEP);
    const [lost] = book.fallen((pick) => pick === 2, 5);
    expect(lost.delta).toBe(-150);
  });
});

describe('the stands as fans', () => {
  it('root for a ship and cheer it on from their own club, apart from the shot-down players (their places are not seats)', () => {
    const match = bShotDown();
    match.crowdChanged([{ id: 1, name: 'Zoe' }, { id: 7, name: 'Ari' }]);
    expect(match.follow(1, 3, true)).toBe(true);
    expect(match.standsFans.of(1)?.pick).toBe(3);
    // Place 1 in the stands is not seat 1 at the table: the shot-down Ben has rooted for nobody.
    expect(match.fans.of(1)).toBeUndefined();
    expect(match.follow(2, 3, true)).toBe(false);
    expect(match.follow(7, 1, true)).toBe(false);
    expect(match.cheerOn(1, true)).toBe(true);
    expect(match.cheerOn(1, true)).toBe(false);
    expect(match.standsFans.of(1)?.cheers).toBe(1);
    match.follow(1, 2, false);
    expect(match.fansOf(2)).toBe(1);
    expect(match.fansOf(3)).toBe(1);
  });

  it('make a bettor in the stands a fan of the ship bet on, and go along in the snapshot', () => {
    const match = table({ betting: true });
    match.crowdChanged([{ id: 4, name: 'Zoe' }]);
    run(match, () => match.phase === 'aiming' && match.phaseTime > 0.1);
    expect(match.placeBet(4, 2, 100, true)).toBe(true);
    expect(match.standsFans.of(4)?.pick).toBe(2);
    expect(match.follow(4, 3, true)).toBe(false);
    const guest = table({ betting: true });
    (guest as unknown as { restoreSnapshot(s: unknown): void }).restoreSnapshot(JSON.parse(JSON.stringify(match.snapshot())));
    expect(guest.standsFans.of(4)?.pick).toBe(2);
  });

  it('make no calls: a screen in the stands is never offered one', () => {
    const match = bShotDown();
    match.crowdChanged([{ id: 1, name: 'Zoe' }]);
    match.follow(1, 2, false);
    match.spectatorId = 1;
    expect(match.rooting).toBe(true);
    expect(match.canCall(1)).toBe(false);
  });
});
