import { DEFAULT_SERVER } from './multiplayer';
import { NetworkClient, type ServerMessage, type StatsDay, type StatsGame, type StatsReplay } from './net';

/** What the relay keeps about the games played on it. */
export interface StatsOverview {
  /** False when the relay keeps no statistics. */
  enabled: boolean;
  /** Online games, by day. */
  days: StatsDay[];
  /** Games played on one device, by day. */
  localDays: StatsDay[];
  games: StatsGame[];
}

/** What the stats page needs from a connection — the WebSocket client, or a stand-in in tests. */
export type StatsConnection = Pick<NetworkClient, 'connect' | 'onMessage' | 'send' | 'close'>;

const REPLY_TIMEOUT_MS = 10_000;

/** The stats page's numbers, over the same relay as the games: one short-lived connection per look. */
export class StatsBoard {
  constructor(private readonly connection: () => StatsConnection = () => new NetworkClient(DEFAULT_SERVER)) {}

  async overview(): Promise<StatsOverview> {
    const reply = await this.ask({ type: 'stats_overview' }, (message) => (message.type === 'stats_overview' ? message : null));
    return { enabled: reply.enabled, days: reply.days, localDays: reply.localDays ?? [], games: reply.games };
  }

  /** A game to fly again, or null when the relay does not have the whole of it. */
  async replay(id: string): Promise<StatsReplay | null> {
    const reply = await this.ask({ type: 'stats_replay', id }, (message) => (message.type === 'stats_replay' && message.id === id ? message : null));
    return reply.replay;
  }

  private async ask<T>(request: Parameters<NetworkClient['send']>[0], pick: (message: ServerMessage) => T | null): Promise<T> {
    const connection = this.connection();
    try {
      await connection.connect();
      return await new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('The statistics did not answer')), REPLY_TIMEOUT_MS);
        const done = (settle: () => void): void => {
          clearTimeout(timer);
          settle();
        };
        connection.onMessage((message) => {
          const answer = pick(message);
          if (answer !== null) done(() => resolve(answer));
          else if (message.type === 'error' || message.type === 'closed') done(() => reject(new Error(message.message)));
        });
        try {
          connection.send(request);
        } catch (error) {
          done(() => reject(error));
        }
      });
    } finally {
      connection.close();
    }
  }
}

/** Which games the page shows: those played on the relay, or those played on one device. */
export type Source = 'online' | 'local';

export const SOURCES: readonly Source[] = ['online', 'local'];

/** What a heatmap colours a day by. */
export type Metric = 'rounds' | 'players' | 'points';

export const METRICS: readonly Metric[] = ['rounds', 'players', 'points'];

/** One square of the heatmap. */
export interface Cell {
  day: string;
  value: number;
  /** 0 = nothing happened, 1…4 = from a little to the busiest days. */
  level: 0 | 1 | 2 | 3 | 4;
}

export interface Heatmap {
  /** Weeks, oldest first, each from Sunday to Saturday; days after today are null. */
  weeks: (Cell | null)[][];
  /** The week a month's label goes over, and which month (0–11). */
  months: { week: number; month: number }[];
  /** The sum of the metric over the whole span. */
  total: number;
}

/** How many weeks the heatmap spans: a year, as on GitHub. */
export const WEEKS = 53;

const DAY_MS = 86_400_000;

const toIso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const fromIso = (day: string): number => Date.parse(`${day}T00:00:00Z`);

/** The squares of the last year up to `today` (a UTC date, "2026-10-23"), coloured by `metric`. */
export function buildHeatmap(days: readonly StatsDay[], metric: Metric, today: string): Heatmap {
  const byDay = new Map(days.map((d) => [d.day, d[metric]]));
  const end = fromIso(today);
  // The Sunday the first week begins on.
  const first = end - new Date(end).getUTCDay() * DAY_MS - (WEEKS - 1) * 7 * DAY_MS;
  let max = 0;
  let total = 0;
  for (let ms = first; ms <= end; ms += DAY_MS) {
    const value = byDay.get(toIso(ms)) ?? 0;
    max = Math.max(max, value);
    total += value;
  }
  const weeks: Heatmap['weeks'] = [];
  const months: Heatmap['months'] = [];
  let lastMonth = -1;
  for (let w = 0; w < WEEKS; w++) {
    const week: (Cell | null)[] = [];
    for (let d = 0; d < 7; d++) {
      const ms = first + (w * 7 + d) * DAY_MS;
      if (ms > end) {
        week.push(null);
        continue;
      }
      const day = toIso(ms);
      const value = byDay.get(day) ?? 0;
      const level = value <= 0 ? 0 : (Math.min(4, Math.ceil((4 * value) / max)) as Cell['level']);
      week.push({ day, value, level });
    }
    // A month is labelled over the first week that begins in it.
    const month = new Date(first + w * 7 * DAY_MS).getUTCMonth();
    if (month !== lastMonth) {
      months.push({ week: w, month });
      lastMonth = month;
    }
    weeks.push(week);
  }
  return { weeks, months, total };
}
