import type { StatsFact } from '../net';
import { StatsBoard } from '../statsBoard';
import { factTexts } from '../statsFacts';
import { h } from './dom';
import { leaderboardAvailable } from './leaderboard';

/** How long a fact stays, its fades included. */
export const FACT_MS = 10_000;
/** How long a fade takes: out at the end of a fact's time, in at the start of the next. */
export const FADE_MS = 900;
/** How long the numbers fetched are kept before a menu asks again. */
const KEEP_MS = 10 * 60_000;
/** Where they are kept across page loads, so a reload does not go to the relay again. */
const STORE_KEY = 'slingshot.facts';
/** How long a line waits to be put on the page before it gives up (screens are built a moment before they are shown). */
const MOUNT_TRIES = 20;

let kept: { at: number; facts: StatsFact[] } | null = recall();
let loading: Promise<StatsFact[]> | null = null;

function recall(): { at: number; facts: StatsFact[] } | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORE_KEY) ?? 'null');
    return saved && typeof saved.at === 'number' && Array.isArray(saved.facts) ? saved : null;
  } catch {
    return null;
  }
}

function remember(): void {
  try {
    if (kept?.facts.length) sessionStorage.setItem(STORE_KEY, JSON.stringify(kept));
  } catch {
    // Storage may be blocked; the numbers are then asked for again on the next load.
  }
}

/** The findings of the relay; none when it cannot be reached or keeps no statistics. Shared by menus that open one after the other. */
async function load(board: StatsBoard): Promise<StatsFact[]> {
  if (kept && Date.now() - kept.at < KEEP_MS) return kept.facts;
  loading ??= board
    .facts()
    .catch(() => [] as StatsFact[])
    .finally(() => (loading = null));
  const facts = await loading;
  kept = { at: Date.now(), facts };
  remember();
  return facts;
}

/**
 * A line of findings from the statistics for a menu. It stays empty while the numbers are on their way and when there are none; then
 * each fact fades in, is read for `FACT_MS` and fades out as the next one fades in. It stops by itself once its screen is gone.
 */
export function factTicker(board = new StatsBoard()): HTMLElement {
  const line = h('p.fact', { 'aria-hidden': 'true' });
  // No relay, no facts: the line takes no room. With one, its room is kept from the start so the menu does not jump later.
  if (!leaderboardAvailable()) {
    line.hidden = true;
    return line;
  }
  let seen = false;
  let tries = 0;
  const show = (texts: string[], next: number): void => {
    if (line.isConnected) seen = true;
    else if (seen || ++tries > MOUNT_TRIES) return;
    else return void setTimeout(() => show(texts, next), 100);
    line.textContent = texts[next % texts.length];
    line.classList.add('is-in');
    setTimeout(() => line.classList.remove('is-in'), FACT_MS - FADE_MS);
    setTimeout(() => show(texts, next + 1), FACT_MS);
  };
  void load(board).then((facts) => {
    const texts = factTexts(facts);
    if (texts.length) show(texts, 0);
  });
  return line;
}
