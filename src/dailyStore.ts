import { shiftDate } from './challenge';

/** What the browser remembers about the daily challenge: your best run per day, and how often you flew it. */
export interface DayRecord {
  best: number;
  attempts: number;
}

export interface RunOutcome {
  record: DayRecord;
  /** This run beat an earlier run of the same day (the first run of a day never counts). */
  newBest: boolean;
  /** Consecutive days flown, ending today. */
  streak: number;
}

const KEY = 'slingshot.daily.v1';
/** Only the most recent days are kept — enough for any streak anyone will realistically hold. */
const KEEP_DAYS = 120;

type Store = Record<string, DayRecord>;

function read(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const store: Store = {};
    for (const [day, rec] of Object.entries(parsed)) {
      const r = rec as Partial<DayRecord> | null;
      if (/^\d{4}-\d{2}-\d{2}$/.test(day) && r && Number.isFinite(r.best) && Number.isFinite(r.attempts)) {
        store[day] = { best: r.best!, attempts: r.attempts! };
      }
    }
    return store;
  } catch {
    // Storage blocked or corrupt — start over.
    return {};
  }
}

function write(store: Store): void {
  const days = Object.keys(store).sort().slice(-KEEP_DAYS);
  try {
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(days.map((d) => [d, store[d]]))));
  } catch {
    // Not fatal: the run just won't be remembered.
  }
}

export function loadDay(day: string): DayRecord | null {
  return read()[day] ?? null;
}

/** Days in a row flown up to `day`. A streak is still alive on a day you haven't flown yet. */
export function streakAt(day: string, store: Store = read()): number {
  let cursor = store[day] ? day : shiftDate(day, -1);
  let streak = 0;
  while (store[cursor]) {
    streak++;
    cursor = shiftDate(cursor, -1);
  }
  return streak;
}

export function loadStreak(day: string): number {
  return streakAt(day);
}

export function recordRun(day: string, total: number): RunOutcome {
  const store = read();
  const prev = store[day];
  const record: DayRecord = { best: prev ? Math.max(prev.best, total) : total, attempts: (prev?.attempts ?? 0) + 1 };
  store[day] = record;
  write(store);
  return { record, newBest: !!prev && total > prev.best, streak: streakAt(day, store) };
}
