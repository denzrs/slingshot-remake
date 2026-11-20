/**
 * The tournament this browser is in: the secret that brings a new connection back to its person there, and the relay it
 * runs on. It names nobody, and it is of no use once the tournament is over (a day at most), so it is forgotten then.
 */
export interface TournamentToken {
  token: string;
  server: string;
  /** When it was given, in milliseconds since the epoch. */
  at: number;
}

const KEY = 'slingshot.tournament.v1';
/** Where the token is kept: the browser's, or only this tab's (see `keepTournamentTokenInTab`). */
let store = (): Storage => localStorage;

/** This tab is somebody else for a while (the dev build's view through a pretend player): its token stays in the tab. */
export function keepTournamentTokenInTab(): void {
  store = () => sessionStorage;
}
/** A tournament lives a day on the relay. */
const LIFETIME_MS = 24 * 60 * 60 * 1000;

export function loadTournamentToken(now = Date.now()): TournamentToken | null {
  try {
    const raw = store().getItem(KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as Partial<TournamentToken>;
    if (typeof saved.token !== 'string' || !saved.token || typeof saved.server !== 'string' || typeof saved.at !== 'number') return null;
    if (now - saved.at > LIFETIME_MS) {
      clearTournamentToken();
      return null;
    }
    return { token: saved.token, server: saved.server, at: saved.at };
  } catch {
    return null;
  }
}

export function saveTournamentToken(token: TournamentToken): void {
  try {
    store().setItem(KEY, JSON.stringify(token));
  } catch {
    // Not fatal: a dropped connection then cannot find its way back.
  }
}

export function clearTournamentToken(): void {
  try {
    store().removeItem(KEY);
  } catch {
    // Nothing to do.
  }
}
