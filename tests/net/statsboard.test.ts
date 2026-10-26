import { describe, expect, it } from 'vitest';
import { buildHeatmap, WEEKS, StatsBoard, type StatsConnection } from '../../src/net/statsBoard';
import type { ServerMessage, StatsDay } from '../../src/net/net';

const day = (d: string, rounds: number, players = 1, points = 0): StatsDay => ({ day: d, rounds, players, points });

describe('stats heatmap', () => {
  const today = '2026-10-23'; // a Friday

  it('spans a year of weeks from Sunday to Saturday and ends on today', () => {
    const map = buildHeatmap([], 'rounds', today);
    expect(map.weeks).toHaveLength(WEEKS);
    expect(map.weeks.every((w) => w.length === 7)).toBe(true);
    const last = map.weeks[WEEKS - 1];
    expect(last[5]?.day).toBe(today);
    expect(last[6]).toBeNull();
    expect(map.weeks[0][0]?.day).toBe('2025-10-19');
  });

  it('colours a day by its share of the busiest day, and leaves quiet days at nothing', () => {
    const map = buildHeatmap([day('2026-10-21', 1), day('2026-10-22', 4), day('2026-10-23', 8)], 'rounds', today);
    const cells = map.weeks[WEEKS - 1].filter(Boolean);
    const level = (d: string) => cells.find((c) => c!.day === d)!.level;
    expect(level('2026-10-23')).toBe(4);
    expect(level('2026-10-22')).toBe(2);
    expect(level('2026-10-21')).toBe(1);
    expect(level('2026-10-20')).toBe(0);
    expect(map.total).toBe(13);
  });

  it('reads the metric it is asked for', () => {
    const days = [day('2026-10-22', 9, 2, 1500), day('2026-10-23', 3, 6, 100)];
    expect(buildHeatmap(days, 'players', today).total).toBe(8);
    expect(buildHeatmap(days, 'points', today).total).toBe(1600);
  });

  it('ignores days older than the span', () => {
    expect(buildHeatmap([day('2024-01-01', 99)], 'rounds', today).total).toBe(0);
  });

  it('labels each month once, over the first week that begins in it', () => {
    const { months } = buildHeatmap([], 'rounds', today);
    expect(months.map((m) => m.month)).toEqual([9, 10, 11, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(new Set(months.map((m) => m.week)).size).toBe(months.length);
  });
});

describe('stats board', () => {
  const connection = (reply: ServerMessage): StatsConnection => {
    let listener: (m: ServerMessage) => void = () => {};
    return {
      connect: async () => {},
      onMessage: (l) => (listener = l),
      send: () => listener(reply),
      close: () => {},
    };
  };

  it('asks the relay once and hands back what it says', async () => {
    const reply: ServerMessage = { type: 'stats_overview', enabled: true, days: [day('2026-10-23', 2)], localDays: [day('2026-10-22', 1)], games: [] };
    const overview = await new StatsBoard(() => connection(reply)).overview();
    expect(overview).toEqual({ enabled: true, days: [day('2026-10-23', 2)], localDays: [day('2026-10-22', 1)], games: [], betting: null });
  });

  it('asks for the facts, and has none when the relay keeps no statistics', async () => {
    const facts = [{ id: 'holeShots', values: [17.4] }];
    expect(await new StatsBoard(() => connection({ type: 'stats_facts', enabled: true, facts })).facts()).toEqual(facts);
    expect(await new StatsBoard(() => connection({ type: 'stats_facts', enabled: false, facts: [] })).facts()).toEqual([]);
  });

  it('turns a refusal into an error', async () => {
    const board = new StatsBoard(() => connection({ type: 'error', message: 'The statistics are unavailable' }));
    await expect(board.overview()).rejects.toThrow('unavailable');
  });
});
