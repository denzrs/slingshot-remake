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
/** A short selection keeps one round of the banner brief. */
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

/** How long one fact stays before the next one fades in. */
const FACT_MS = 8_000;

function factLine(parts: FactPart[]): HTMLElement {
  return h('span.stats-ticker__fact', { 'aria-hidden': 'true' }, ...parts.map((part) => (part.number ? h('span.stats-ticker__number', null, part.text) : part.text)));
}

/** A quiet banner of relay statistics for a menu header: one fact at a time, fading into the next. */
export function factTicker(enabled = true, board = new StatsBoard()): HTMLElement {
  const ticker = h('div.stats-ticker', { role: 'region', 'aria-label': t('stats.ticker.label'), 'aria-busy': 'true' });
  const label = h('span.stats-ticker__label', { 'aria-hidden': 'true' }, t('stats.ticker.label'));
  const viewport = h('span.stats-ticker__viewport', null, h('span.stats-ticker__loading', null, t('stats.loading')));
  const dots = h('span.stats-ticker__dots', { 'aria-hidden': 'true' });
  const accessibleFacts = h('span.stats-ticker__a11y', null);
  ticker.append(label, viewport, dots, accessibleFacts);

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

    const items = lines.map(factLine);
    const marks = lines.map(() => h('span.stats-ticker__dot', null));
    let current = 0;
    const show = (index: number): void => {
      current = index;
      items.forEach((item, i) => item.classList.toggle('is-active', i === index));
      marks.forEach((mark, i) => mark.classList.toggle('is-active', i === index));
    };
    show(0);
    viewport.replaceChildren(...items);
    dots.replaceChildren(...marks);
    accessibleFacts.textContent = lines.map((parts) => parts.map((part) => part.text).join('')).join(' ');
    ticker.removeAttribute('aria-busy');
    if (lines.length < 2) return;

    let held = false;
    const hold = (value: boolean) => () => void (held = value);
    ticker.addEventListener('pointerenter', hold(true));
    ticker.addEventListener('pointerleave', hold(false));
    ticker.addEventListener('focusin', hold(true));
    ticker.addEventListener('focusout', hold(false));
    const timer = setInterval(() => {
      // The menu page this lives on is gone once it has left the document.
      if (!ticker.isConnected) return clearInterval(timer);
      if (held || document.hidden) return;
      show((current + 1) % items.length);
    }, FACT_MS);
  });
  return ticker;
}
