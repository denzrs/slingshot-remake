import type { StatsFact } from '../net';
import { StatsBoard } from '../statsBoard';
import { factLines, type FactPart } from '../statsFacts';
import { t } from '../i18n';
import { h } from './dom';
import { leaderboardAvailable } from './leaderboard';

/** How long the numbers fetched are kept before a menu asks again. */
const KEEP_MS = 10 * 60_000;
/** Where they are kept across page loads, so a reload does not go to the relay again. */
const STORE_KEY = 'slingshot.facts';
/** A short selection keeps one trip across the banner readable. */
const TICKER_FACTS = 10;

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

/** The findings of the relay, shared by menus that open one after the other. */
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

function factGroup(lines: FactPart[][]): HTMLElement {
  const group = h('span.stats-ticker__group', null);
  lines.forEach((parts, index) => {
    group.append(
      h('span.stats-ticker__fact', null, ...parts.map((part) => (part.number ? h('span.stats-ticker__number', null, part.text) : part.text))),
    );
    if (index < lines.length - 1) group.append(h('span.stats-ticker__divider', { 'aria-hidden': 'true' }));
  });
  return group;
}

/** A continuous, readable news band of relay statistics for a menu header. */
export function factTicker(enabled = true, board = new StatsBoard()): HTMLElement {
  const ticker = h('div.stats-ticker', { role: 'region', 'aria-label': t('stats.ticker.label'), 'aria-busy': 'true' });
  const label = h('span.stats-ticker__label', { 'aria-hidden': 'true' }, t('stats.ticker.label'));
  const viewport = h('span.stats-ticker__viewport', null, h('span.stats-ticker__loading', null, t('stats.loading')));
  const accessibleFacts = h('span.stats-ticker__a11y', null);
  ticker.append(label, viewport, accessibleFacts);

  if (!enabled || !leaderboardAvailable()) {
    ticker.hidden = true;
    ticker.removeAttribute('aria-busy');
    return ticker;
  }

  void load(board).then((facts) => {
    const lines = factLines(facts).slice(0, TICKER_FACTS);
    if (!lines.length) {
      ticker.hidden = true;
      ticker.removeAttribute('aria-busy');
      return;
    }

    const summary = lines.map((parts) => parts.map((part) => part.text).join('')).join(' ');
    const group = factGroup(lines);
    const track = h('span.stats-ticker__track', { 'aria-hidden': 'true' }, group, group.cloneNode(true));
    const characterCount = lines.reduce((total, parts) => total + parts.reduce((length, part) => length + part.text.length, 0), 0);
    const duration = Math.round(Math.max(48, Math.min(120, characterCount * 0.16)));
    track.style.setProperty('--stats-ticker-duration', `${duration}s`);
    viewport.replaceChildren(track);
    accessibleFacts.textContent = summary;
    ticker.removeAttribute('aria-busy');
  });
  return ticker;
}
