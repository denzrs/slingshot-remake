import { describe, expect, it } from 'vitest';
import type { StatsDay } from '../../src/net/net';
import { factValues, modeShares, monthTotals, summarize, weekdayAverages } from '../../src/net/statsSummary';

const day = (d: string, rounds: number, players = 1, points = 0): StatsDay => ({ day: d, rounds, players, points });

describe('stats summary', () => {
  const today = '2026-10-23'; // a Friday

  it('adds up the year, its busiest day and its longest run of days played', () => {
    const s = summarize([day('2026-10-20', 2, 3, 100), day('2026-10-21', 5, 1, 50), day('2026-10-22', 1, 2, 10), day('2026-09-01', 4, 4, 0), day('2024-01-01', 99)], today);
    expect(s.rounds).toBe(12);
    expect(s.points).toBe(160);
    expect(s.activeDays).toBe(4);
    expect(s.longestStreak).toBe(3);
    expect(s.bestDay).toEqual({ day: '2026-10-21', rounds: 5 });
    expect(s.playersPerDay).toBe(10 / 4);
    expect(s.today).toEqual({ rounds: 0, players: 0 });
  });

  it('compares the last seven days with the seven before them', () => {
    const s = summarize([day('2026-10-23', 3), day('2026-10-17', 4), day('2026-10-16', 6), day('2026-10-09', 100)], today);
    expect(s.week).toBe(7);
    expect(s.weekBefore).toBe(6);
    expect(s.today.rounds).toBe(3);
  });

  it('has no busiest day in a year without rounds', () => {
    const s = summarize([], today);
    expect(s.bestDay).toBeNull();
    expect(s.playersPerDay).toBe(0);
  });

  it('sums the last twelve calendar months, ending with the current one', () => {
    const months = monthTotals([day('2026-10-01', 2), day('2026-10-23', 3), day('2025-11-30', 7), day('2025-10-31', 50)], 'rounds', today);
    expect(months).toHaveLength(12);
    expect(months[0]).toEqual({ month: 10, year: 2025, value: 7 });
    expect(months[11]).toEqual({ month: 9, year: 2026, value: 5 });
  });

  it('averages each weekday from Monday on', () => {
    const averages = weekdayAverages([day('2026-10-19', 52), day('2026-10-18', 104)], 'rounds', today);
    // 52 Mondays and 52 Sundays in the year.
    expect(averages[0]).toBe(1);
    expect(averages[6]).toBe(2);
    expect(averages[3]).toBe(0);
  });
});

describe('stats facts on the overview', () => {
  it('reads one fact by its id', () => {
    expect(factValues([{ id: 'bestHit', values: [800] }], 'bestHit')).toEqual([800]);
    expect(factValues([], 'bestHit')).toBeNull();
  });

  it('gives Classic what the other modes leave', () => {
    expect(modeShares([{ id: 'horizonShare', values: [30] }, { id: 'solarShare', values: [20] }])).toEqual({ classic: 50, horizon: 30, solar: 20 });
    expect(modeShares([{ id: 'solarShare', values: [10] }])).toEqual({ classic: 90, horizon: 0, solar: 10 });
    expect(modeShares([])).toBeNull();
  });
});
