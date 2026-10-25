import { describe, expect, it } from 'vitest';
import { createMatch } from '../../src/game';
import { reportLocalGame, trackLocalGame } from '../../src/net/localStats';
import type { LocalGameReport } from '../../src/net/net';
import { cloneSettings, DEFAULT_SETTINGS, type Seat } from '../../src/data/settings';

const seats: Seat[] = ['medium', 'hard', 'easy', 'off', 'off', 'off'];
const settings = { ...cloneSettings(DEFAULT_SETTINGS), rounds: 3, seats, powerUps: true };

function play(): { reports: LocalGameReport[]; match: ReturnType<typeof createMatch> } {
  const match = createMatch('classic', settings, { seats, seed: 4, deterministicCpu: true });
  const reports: LocalGameReport[] = [];
  trackLocalGame(match, settings, (report) => reports.push(report));
  for (let i = 0; i < 100_000 && match.phase !== 'gameOver'; i++) {
    match.update(1 / 30);
    if (match.phase === 'roundOver' && match.phaseTime > 1) match.advance();
  }
  return { reports, match };
}

describe('telling the relay of a game played here', () => {
  it('sends the rounds of a game played to its end, once, with who sat where and the rules', () => {
    const { reports, match } = play();
    expect(match.phase).toBe('gameOver');
    expect(reports).toHaveLength(1);
    const [report] = reports;
    expect(report.gameMode).toBe('classic');
    expect(report.mode).toBe('ffa');
    expect(report.seats).toEqual([
      { cpu: 'medium', team: null },
      { cpu: 'hard', team: null },
      { cpu: 'easy', team: null },
    ]);
    expect(report.rules.rounds).toBe(3);
    expect(report.rules.powerUps).toBe(true);
    expect(report.rounds.map((r) => r.round)).toEqual([1, 2, 3]);
    expect(report.rounds.every((r) => r.players.length === 3)).toBe(true);
    // No shots and no aims: nothing to fly it again with, and nothing about who the players are.
    expect(JSON.stringify(report)).not.toMatch(/angle|splitAt|placements|name/);
  });

  it('says nothing of a game that was left halfway, and starts over on a rematch', () => {
    const match = createMatch('classic', settings, { seats, seed: 9, deterministicCpu: true });
    const reports: LocalGameReport[] = [];
    trackLocalGame(match, settings, (report) => reports.push(report));
    for (let i = 0; i < 100_000 && match.round < 2; i++) {
      match.update(1 / 30);
      if (match.phase === 'roundOver' && match.phaseTime > 1) match.advance();
    }
    expect(reports).toHaveLength(0);
    match.newMatch();
    for (let i = 0; i < 100_000 && match.phase !== 'gameOver'; i++) {
      match.update(1 / 30);
      if (match.phase === 'roundOver' && match.phaseTime > 1) match.advance();
    }
    expect(reports).toHaveLength(1);
    expect(reports[0].rounds.map((r) => r.round)).toEqual([1, 2, 3]);
  });

  it('gives the report to the connection and closes it, and loses it quietly when the relay is not there', async () => {
    const { reports } = play();
    const sent: unknown[] = [];
    let closed = 0;
    await reportLocalGame(reports[0], { connect: async () => {}, send: (message) => void sent.push(message), close: () => void closed++ });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: 'local_game', gameMode: 'classic' });
    expect(closed).toBe(1);
    await expect(reportLocalGame(reports[0], { connect: async () => Promise.reject(new Error('down')), send: () => {}, close: () => void closed++ })).resolves.toBeUndefined();
    expect(closed).toBe(2);
  });
});
