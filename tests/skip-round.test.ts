import { describe, expect, it } from 'vitest';
import { createMatch } from '../src/game';
import type { ClassicMatch } from '../src/game/classic';
import type { ReplayScript } from '../src/game/replay';
import { roundReport, turnReport } from '../src/roundReport';
import { DEFAULT_SETTINGS, type Seat } from '../src/settings';

/** A Classic match on its first round with `humans` people, a CPU after them, and 40 points already on the first ship. */
function scored(online: boolean, humans = 2): ClassicMatch {
  const seats: Seat[] = Array.from({ length: 6 }, (_, i) => (i < humans ? 'human' : i < 3 ? 'easy' : 'off'));
  const m = createMatch('classic', { ...DEFAULT_SETTINGS, rounds: 2, seats }, { seats, oracle: online }) as ClassicMatch;
  m.players[0].score = 40;
  return m;
}

describe('skipping a round', () => {
  it('is up to the player alone offline: the round ends and nobody keeps what they scored in it', () => {
    const m = scored(false, 1);
    m.players[0].score = 120;
    m.requestSkipRound(0);
    expect(m.phase).toBe('roundOver');
    expect(m.summary?.title).toBe('skipped');
    expect(m.players.map((p) => p.score)).toEqual([0, 0, 0]);
    m.update(1);
    m.advance();
    expect(m.round).toBe(2);
    expect(m.phase).toBe('aiming');
  });

  it('keeps what was won in the rounds before', () => {
    const m = scored(false, 1);
    m.scoreHistory = [[0, 0, 0], [30, 10, 0]];
    m.players[0].score = 90;
    m.requestSkipRound(0);
    expect(m.players.map((p) => p.score)).toEqual([30, 10, 0]);
  });

  it('online is a vote only the host may call, and the host votes yes by calling', () => {
    const m = scored(true, 3);
    m.requestSkipRound(1);
    expect(m.skipVote).toBeNull();
    m.requestSkipRound(0);
    expect(m.skipVote?.yes).toEqual([0]);
    expect(m.skipVotesNeeded).toBe(2);
    expect(m.phase).toBe('aiming');
    m.voteSkipRound(1, true);
    expect(m.phase).toBe('roundOver');
    expect(m.summary?.title).toBe('skipped');
    expect(m.players[0].score).toBe(0);
    expect(m.skipVote).toBeNull();
  });

  it('counts each person once, and CPUs have no vote', () => {
    const m = scored(true, 3);
    m.requestSkipRound(0);
    m.voteSkipRound(0, true);
    m.voteSkipRound(3, true);
    expect(m.skipVote?.yes).toEqual([0]);
  });

  it('is dropped when too many say no', () => {
    const m = scored(true, 3);
    m.requestSkipRound(0);
    m.voteSkipRound(1, false);
    expect(m.skipVote).not.toBeNull();
    m.voteSkipRound(2, false);
    expect(m.skipVote).toBeNull();
    expect(m.phase).toBe('aiming');
    expect(m.players[0].score).toBe(40);
  });

  it('lapses when nobody answers in time', () => {
    const m = scored(true, 3);
    m.requestSkipRound(0);
    m.update(25);
    expect(m.skipVote).toBeNull();
    expect(m.phase).not.toBe('roundOver');
  });

  it('ends the last round into the final screen', () => {
    const m = scored(false, 1);
    m.round = 2;
    m.requestSkipRound(0);
    m.update(1);
    m.advance();
    expect(m.phase).toBe('gameOver');
  });

  it('works through a snapshot, so guests see the vote', () => {
    const m = scored(true, 3);
    m.requestSkipRound(0);
    const copy = scored(true, 3);
    copy.restoreSnapshot(JSON.parse(JSON.stringify(m.snapshot())));
    expect(copy.skipVote?.yes).toEqual([0]);
  });

  it('is not possible on the title screen', () => {
    const seats: Seat[] = ['easy', 'easy', 'off', 'off', 'off', 'off'];
    const m = createMatch('classic', { ...DEFAULT_SETTINGS, seats }, { seats, attract: true });
    m.requestSkipRound(0);
    expect(m.phase).toBe('aiming');
  });
});

describe('a skipped round in the statistics and in a replay', () => {
  const seats: Seat[] = ['hard', 'medium', 'medium', 'off', 'off', 'off'];
  const settings = { ...DEFAULT_SETTINGS, rounds: 3, seats };
  const DT = 1 / 30;

  function play(match: ClassicMatch, until: () => boolean): void {
    for (let i = 0; i < 200_000 && !until(); i++) {
      match.update(DT);
      if (match.phase === 'roundOver' && match.phaseTime > 1 && !match.replaying) match.advance();
    }
  }

  it('is reported as skipped, with only the turns that were flown, and replays as skipped', () => {
    const original = createMatch('classic', settings, { seats, seed: 5, deterministicCpu: true }) as ClassicMatch;
    const turns: ReturnType<typeof turnReport>[] = [];
    const rounds: ReturnType<typeof roundReport>[] = [];
    original.onTurnEnd(() => turns.push(turnReport(original)));
    original.on((e) => e.type === 'roundEnd' && rounds.push(roundReport(original)));
    // Skip round 1 with a shot in the air, after one turn has been flown.
    play(original, () => original.phase === 'flying' && original.shotLog.turn === 2);
    expect(original.phase).toBe('flying');
    original.requestSkipRound(0);
    play(original, () => original.phase === 'gameOver');
    expect(rounds[0]).toMatchObject({ round: 1, title: 'skipped', turns: 1, survivor: null });
    expect(rounds[0].players.map((p) => p.score)).toEqual([0, 0, 0]);
    expect(turns.filter((t) => t.round === 1)).toHaveLength(1);
    expect(rounds[1].title).not.toBe('skipped');

    const script: ReplayScript = {
      skipped: [1],
      turns: turns.map((t) => ({ round: t.round, turn: t.turn, placements: t.placements, shots: t.shots.filter((s) => !s.fork).map((s) => ({ player: s.player, angle: s.angle, power: s.power, rider: s.rider, splitAt: s.splitAt })) })),
    };
    const again = createMatch('classic', settings, { seats, seed: 5, deterministicCpu: true, script }) as ClassicMatch;
    play(again, () => again.replayState !== 'playing' || again.phase === 'gameOver');
    expect(again.replayState).not.toBe('drifted');
    expect(again.phase).toBe('gameOver');
    expect(again.players.map((p) => p.score)).toEqual(original.players.map((p) => p.score));
  });
});
