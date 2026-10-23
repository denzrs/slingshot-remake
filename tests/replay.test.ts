import { describe, expect, it } from 'vitest';
import { createMatch, type Match, type VersusMode } from '../src/game';
import { type ReplayScript } from '../src/game/replay';
import { turnReport } from '../src/roundReport';
import { cloneSettings, DEFAULT_SETTINGS, type Seat, type Settings } from '../src/settings';

const DT = 1 / 30;

/** What a turn left behind, as the stats report it: the numbers a replay has to match to the last digit. */
interface Trace {
  round: number;
  turn: number;
  scores: number[];
  alive: boolean[];
  shots: { player: number; resolution: string | null; hits: number; points: number }[];
}

/** Plays a match to its end, noting every turn. `done` says when to stop. */
function run(match: Match, done: () => boolean): { traces: Trace[]; steps: number } {
  const traces: Trace[] = [];
  match.onTurnEnd(() => {
    const report = turnReport(match);
    traces.push({
      round: report.round,
      turn: report.turn,
      scores: match.players.map((p) => p.score),
      alive: report.players.map((p) => p.alive),
      shots: report.shots.map((s) => ({ player: s.player, resolution: s.resolution, hits: s.hits, points: s.points })),
    });
  });
  let steps = 0;
  while (!done() && steps < 200_000) {
    match.update(DT);
    steps++;
    // Rounds are over for a game when somebody presses continue; the CPUs' match does it on its own.
    if (match.phase === 'roundOver' && match.phaseTime > 1 && !match.replaying) match.advance();
  }
  return { traces, steps };
}

/** The recording of a match, as the host's reports hold it: turn by turn, shots exactly as aimed and placements. */
function recordingOf(match: Match, reports: ReturnType<typeof turnReport>[]): ReplayScript {
  void match;
  return {
    turns: reports.map((report) => ({
      round: report.round,
      turn: report.turn,
      placements: report.placements,
      shots: report.shots
        .filter((s) => !s.fork)
        .map((s) => ({ player: s.player, angle: s.angle, power: s.power, rider: s.rider, splitAt: s.splitAt })),
    })),
  };
}

const settingsOf = (patch: Partial<Settings>, seats: Seat[]): Settings => ({ ...cloneSettings(DEFAULT_SETTINGS), rounds: 3, seats, ...patch });

interface Case {
  name: string;
  mode: VersusMode;
  patch: Partial<Settings>;
  seats: Seat[];
  seed: number;
}

const cases: Case[] = [
  { name: 'classic, one shot after another', mode: 'classic', patch: {}, seats: ['medium', 'hard', 'medium', 'off', 'off', 'off'], seed: 5 },
  { name: 'classic with power-ups', mode: 'classic', patch: { powerUps: true, powerUpAmount: 8, maxPlanets: 6 }, seats: ['hard', 'hard', 'medium', 'medium', 'off', 'off'], seed: 12 },
  { name: 'classic, everybody at once', mode: 'classic', patch: { powerUps: true, simultaneousShots: true, powerUpAmount: 8 }, seats: ['hard', 'medium', 'medium', 'off', 'off', 'off'], seed: 21 },
  { name: 'classic teams', mode: 'classic', patch: { powerUps: true, teamMode: 2 }, seats: ['hard', 'medium', 'medium', 'hard', 'off', 'off'], seed: 8 },
  { name: 'event horizon', mode: 'horizon', patch: { powerUps: true, powerUpAmount: 8 }, seats: ['hard', 'medium', 'medium', 'off', 'off', 'off'], seed: 3 },
  { name: 'mayhem', mode: 'classic', patch: { mayhem: 2, powerUps: true }, seats: ['hard', 'medium', 'medium', 'off', 'off', 'off'], seed: 17 },
];

/** What the recordings of the cases together held, to see that the test goes through every kind of thing a replay has to do. */
const seen = { placements: new Set<string>(), splits: 0, riders: new Set<string>() };

describe('a recorded match flown again', () => {
  it.each(cases.flatMap((c) => Array.from({ length: Number(process.env.REPLAY_SEEDS ?? 4) }, (_, i) => i * 1000).map((offset) => ({ ...c, seed: c.seed + offset, name: `${c.name} (seed ${c.seed + offset})` }))))('comes out the same: $name', ({ mode, patch, seats, seed }) => {
    const settings = settingsOf(patch, seats);
    const options = { seats, seed, deterministicCpu: true, simultaneous: mode === 'horizon' || settings.simultaneousShots, teams: settings.teamMode ? seats.map((_, i) => i % 2) : undefined };

    // Play it, and keep what the host would have reported.
    const original = createMatch(mode, settings, options);
    const reports: ReturnType<typeof turnReport>[] = [];
    original.onTurnEnd(() => reports.push(turnReport(original)));
    const first = run(original, () => original.phase === 'gameOver');
    expect(original.phase).toBe('gameOver');
    expect(first.traces.length).toBeGreaterThan(3);

    // Fly it again from the seed, the rules and the recording alone.
    const script = recordingOf(original, JSON.parse(JSON.stringify(reports)));
    for (const turn of script.turns) {
      for (const placement of turn.placements) seen.placements.add(placement.kind);
      for (const shot of turn.shots) {
        if (shot.splitAt !== null) seen.splits++;
        if (shot.rider) seen.riders.add(shot.rider);
      }
    }
    const again = createMatch(mode, settings, { ...options, script });
    const second = run(again, () => again.replayState !== 'playing' || again.phase === 'gameOver');

    expect(again.replayState).not.toBe('drifted');
    expect(second.traces).toEqual(first.traces);
    expect(again.players.map((p) => p.score)).toEqual(original.players.map((p) => p.score));
  });
});

describe('what the recordings held', () => {
  it('went through placements, splits and riders', () => {
    console.log('COVERAGE', JSON.stringify({ placements: [...seen.placements].sort(), splits: seen.splits, riders: [...seen.riders].sort() }));
    expect(seen.splits).toBeGreaterThan(0);
  });
});
