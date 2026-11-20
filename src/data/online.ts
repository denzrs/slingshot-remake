/**
 * Whether this browser may talk to the relay at all: online games, tournaments, the daily leaderboard, the statistics, the
 * menu's facts and the report of a local game. The player decides it in the introduction and can change it in the settings;
 * until they have, nothing is sent. The game itself needs none of it: it is an installed web app and runs offline.
 */
export const ONLINE_KEY = 'slingshot.online.v1';

type Choice = 'on' | 'off';

/** Set for one visit only and never saved: `?nointro` (automated runs, agents), which never see the introduction to choose in. */
let visitAllows = false;
const listeners = new Set<(on: boolean) => void>();

function saved(): Choice | null {
  try {
    const value = localStorage.getItem(ONLINE_KEY);
    return value === 'on' || value === 'off' ? value : null;
  } catch {
    return null;
  }
}

/** Whether the player has decided either way. */
export function onlineDecided(): boolean {
  return saved() !== null;
}

/** Whether the relay may be reached now. Undecided is off. */
export function onlineAllowed(): boolean {
  const choice = saved();
  return choice ? choice === 'on' : visitAllows;
}

/** The player's choice, kept for later visits. */
export function setOnline(on: boolean): void {
  const before = onlineAllowed();
  try {
    localStorage.setItem(ONLINE_KEY, on ? 'on' : 'off');
  } catch {
    // Storage blocked: the choice still holds for this visit.
    visitAllows = on;
  }
  if (!on) visitAllows = false;
  if (before !== onlineAllowed()) listeners.forEach((listener) => listener(on));
}

/**
 * Settles the question for a player who was here before it was asked: they played with the relay all along and are not
 * asked again. Only an undecided browser that already has the introduction or settings behind it counts.
 */
export function keepOnlineForReturningPlayer(returning: boolean): void {
  if (returning && !onlineDecided()) setOnline(true);
}

/** A visit that skips the introduction by its address is online, unless the player chose offline before. Nothing is saved. */
export function allowOnlineForVisit(): void {
  visitAllows = true;
}

/** Calls back whenever the answer of `onlineAllowed` changes; returns the unsubscribe. */
export function onOnlineChange(listener: (on: boolean) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
