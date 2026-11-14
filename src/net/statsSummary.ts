import type { StatsDay, StatsFact } from './net';
import type { Metric } from './statsBoard';

const DAY_MS = 86_400_000;
const toIso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const fromIso = (day: string): number => Date.parse(`${day}T00:00:00Z`);

/** How many days the summary looks back over, today included: the heatmap's year. */
export const SPAN_DAYS = 365;

/** One month of the summary's chart. */
export interface MonthTotal {
  /** 0–11. */
  month: number;
  year: number;
  value: number;
}

/** The figures over the cards of the statistics page: what a year of days adds up to. */
export interface StatsSummary {
  rounds: number;
  points: number;
  /** Days with at least one round. */
  activeDays: number;
  /** The longest run of days in a row with a round. */
  longestStreak: number;
  /** The busiest day by rounds, or null in a year without any. */
  bestDay: { day: string; rounds: number } | null;
  /** Rounds in the last seven days (today included), and in the seven before them. */
  week: number;
  weekBefore: number;
  /** People a day, over the days anybody played. */
  playersPerDay: number;
  /** Today's rounds and people. */
  today: { rounds: number; players: number };
}

/** The days of the last year up to `today` (a UTC date), by date. */
function inSpan(days: readonly StatsDay[], today: string): Map<string, StatsDay> {
  const end = fromIso(today);
  const start = end - (SPAN_DAYS - 1) * DAY_MS;
  const byDay = new Map<string, StatsDay>();
  for (const d of days) {
    const ms = fromIso(d.day);
    if (ms >= start && ms <= end) byDay.set(d.day, d);
  }
  return byDay;
}

export function summarize(days: readonly StatsDay[], today: string): StatsSummary {
  const byDay = inSpan(days, today);
  const end = fromIso(today);
  let rounds = 0;
  let points = 0;
  let activeDays = 0;
  let players = 0;
  let streak = 0;
  let longestStreak = 0;
  let bestDay: StatsSummary['bestDay'] = null;
  let week = 0;
  let weekBefore = 0;
  for (let i = SPAN_DAYS - 1; i >= 0; i--) {
    const day = toIso(end - i * DAY_MS);
    const d = byDay.get(day);
    const r = d?.rounds ?? 0;
    rounds += r;
    points += d?.points ?? 0;
    if (i < 7) week += r;
    else if (i < 14) weekBefore += r;
    if (r > 0) {
      activeDays++;
      players += d?.players ?? 0;
      streak++;
      longestStreak = Math.max(longestStreak, streak);
      if (!bestDay || r > bestDay.rounds) bestDay = { day, rounds: r };
    } else streak = 0;
  }
  const now = byDay.get(today);
  return {
    rounds,
    points,
    activeDays,
    longestStreak,
    bestDay,
    week,
    weekBefore,
    playersPerDay: activeDays ? players / activeDays : 0,
    today: { rounds: now?.rounds ?? 0, players: now?.players ?? 0 },
  };
}

/** The metric summed by calendar month over the last twelve months, the oldest first and the current one last. */
export function monthTotals(days: readonly StatsDay[], metric: Metric, today: string): MonthTotal[] {
  const now = new Date(fromIso(today));
  const months: MonthTotal[] = [];
  for (let back = 11; back >= 0; back--) {
    const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    months.push({ month: at.getUTCMonth(), year: at.getUTCFullYear(), value: 0 });
  }
  const first = Date.UTC(months[0].year, months[0].month, 1);
  for (const d of days) {
    const ms = fromIso(d.day);
    if (ms < first || ms > fromIso(today)) continue;
    const at = new Date(ms);
    const slot = months.find((m) => m.month === at.getUTCMonth() && m.year === at.getUTCFullYear());
    if (slot) slot.value += d[metric];
  }
  return months;
}

/** The metric over the last year by day of the week, as an average per such day: Monday first. */
export function weekdayAverages(days: readonly StatsDay[], metric: Metric, today: string): number[] {
  const byDay = inSpan(days, today);
  const end = fromIso(today);
  const sums = [0, 0, 0, 0, 0, 0, 0];
  const counts = [0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < SPAN_DAYS; i++) {
    const ms = end - i * DAY_MS;
    // getUTCDay counts from Sunday; the page's week starts on Monday.
    const slot = (new Date(ms).getUTCDay() + 6) % 7;
    sums[slot] += byDay.get(toIso(ms))?.[metric] ?? 0;
    counts[slot]++;
  }
  return sums.map((sum, i) => (counts[i] ? sum / counts[i] : 0));
}

/** The values of one fact by its id, or null when the relay did not send it. */
export function factValues(facts: readonly StatsFact[], id: string): number[] | null {
  return facts.find((fact) => fact.id === id)?.values ?? null;
}

/** Which share of the rounds each game mode has: what the relay says of Event Horizon and the Solar System, Classic the rest. */
export function modeShares(facts: readonly StatsFact[]): { classic: number; horizon: number; solar: number } | null {
  const horizon = factValues(facts, 'horizonShare')?.[0];
  const solar = factValues(facts, 'solarShare')?.[0];
  // Neither said means too few rounds to tell (a share of 0 % is left out too, but not both at once on a relay that has games).
  if (horizon === undefined && solar === undefined) return null;
  const h = horizon ?? 0;
  const s = solar ?? 0;
  return { classic: Math.max(0, 100 - h - s), horizon: h, solar: s };
}
