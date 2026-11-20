import type { StatsFact } from '../../net/net';
import { StatsBoard, type StatsMenu } from '../../net/statsBoard';
import { factLines, type FactPart } from '../../net/statsFacts';
import { t } from '../../platform/i18n';
import { h } from '../dom';
import { leaderboardAvailable } from '../daily/leaderboard';
import { onlineAllowed } from '../../data/online';
import { tipLines } from './tips';

/** How long the numbers fetched are kept before a menu asks again. */
const KEEP_MS = 10 * 60_000;
/** Where they are kept across page loads, so a reload does not go to the relay again. */
const STORE_KEY = 'slingshot.facts';
let kept: ({ at: number } & StatsMenu) | null = recall();
let loading: Promise<StatsMenu> | null = null;

function recall(): ({ at: number } & StatsMenu) | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORE_KEY) ?? 'null');
    return saved && typeof saved.at === 'number' && Array.isArray(saved.facts) && Array.isArray(saved.favorites) ? saved : null;
  } catch {
    return null;
  }
}

function remember(): void {
  try {
    if (kept?.facts.length || kept?.favorites.length) sessionStorage.setItem(STORE_KEY, JSON.stringify(kept));
  } catch {
    // Storage may be blocked; the numbers are then asked for again on the next load.
  }
}

/**
 * The findings and favourites of the relay, shared by menus that open one after the other, the statistics page and the quick game.
 * Rejects when the relay cannot be reached, and keeps nothing then: the next one to ask tries again.
 */
export async function loadMenuStats(board: StatsBoard): Promise<StatsMenu> {
  if (kept && Date.now() - kept.at < KEEP_MS) return kept;
  loading ??= board
    .menu()
    .then((menu) => {
      kept = { at: Date.now(), ...menu };
      remember();
      return menu;
    })
    .finally(() => (loading = null));
  return loading;
}

/** The findings alone (see `loadMenuStats`). */
export const loadFacts = (board: StatsBoard): Promise<StatsFact[]> => loadMenuStats(board).then((menu) => menu.facts);

/** How long the old line takes to fade out before the new one fades in (the same in the stylesheet). */
const LINE_FADE_MS = 260;
/** How long one line stays before the next one fades in. */
const LINE_MS = 8_000;
/** With the relay's numbers on, the banner alternates between this many of them and this many tips. */
const MIXED_FACTS = 6;
const MIXED_TIPS = 5;
/** Without them it is tips alone. */
const TIPS_ONLY = 8;

type LineKind = 'fact' | 'tip';
interface Line {
  kind: LineKind;
  parts: FactPart[];
}

function lineElement(line: Line): HTMLElement {
  return h('span.stats-ticker__fact', { 'aria-hidden': 'true', 'data-kind': line.kind }, ...line.parts.map((part) => (part.number ? h('span.stats-ticker__number', null, part.text) : part.text)));
}

/** One after the other: a number of the relay, a tip, a number, a tip; whichever runs out first leaves the rest of the other. */
function interleave(facts: FactPart[][], tips: FactPart[][]): Line[] {
  const lines: Line[] = [];
  for (let i = 0; i < Math.max(facts.length, tips.length); i++) {
    if (facts[i]) lines.push({ kind: 'fact', parts: facts[i] });
    if (tips[i]) lines.push({ kind: 'tip', parts: tips[i] });
  }
  return lines;
}

/**
 * The banner of a menu header, one line at a time, fading into the next.
 * With the statistics on (and a relay to ask) it alternates between numbers of the game and tips for it, in two colours;
 * with them off it is still there, as tips alone.
 */
export function menuTicker(showStats = true, board = new StatsBoard()): HTMLElement {
  const wantsFacts = showStats && leaderboardAvailable() && onlineAllowed();
  const ticker = h('div.stats-ticker', { role: 'region', 'aria-label': t(wantsFacts ? 'stats.ticker.label' : 'tips.label'), 'aria-busy': 'true', 'data-kind': wantsFacts ? 'fact' : 'tip' });
  // The label is as wide as the longer of its two words in every state, so the line next to it never shifts when the kind changes.
  const labelText = h('span.stats-ticker__label-text', null, t(wantsFacts ? 'stats.ticker.label' : 'tips.label'));
  const label = h('span.stats-ticker__label', { 'aria-hidden': 'true' }, labelText, h('span.stats-ticker__label-size', null, t('stats.ticker.label')), h('span.stats-ticker__label-size', null, t('tips.label')));
  const viewport = h('span.stats-ticker__viewport', null, ...(wantsFacts ? [h('span.stats-ticker__loading', null, t('stats.loading'))] : []));
  const dots = h('span.stats-ticker__dots', { 'aria-hidden': 'true' });
  const accessibleFacts = h('span.stats-ticker__a11y', null);
  const toggle = h('button.stats-ticker__toggle', { type: 'button', 'aria-expanded': 'false', 'aria-label': t('stats.ticker.expand') });
  toggle.addEventListener('click', () => {
    const expanded = ticker.classList.toggle('is-expanded');
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.setAttribute('aria-label', t(expanded ? 'stats.ticker.collapse' : 'stats.ticker.expand'));
  });
  ticker.append(label, viewport, dots, accessibleFacts, toggle);

  const run = (lines: Line[]): void => {
    const items = lines.map(lineElement);
    const marks = lines.map(() => h('span.stats-ticker__dot', null));
    let current = 0;
    let swap = 0;
    const show = (index: number, fade = true): void => {
      current = index;
      const kind = lines[index].kind;
      const relabel = (): void => {
        ticker.dataset.kind = kind;
        labelText.textContent = t(kind === 'fact' ? 'stats.ticker.label' : 'tips.label');
      };
      // The old line is gone when the label and colours change, and the new line fades in after them.
      clearTimeout(swap);
      const still = !fade || matchMedia('(prefers-reduced-motion: reduce)').matches || ticker.closest('.menu-motion-less');
      if (still || ticker.dataset.kind === kind) relabel();
      else swap = window.setTimeout(relabel, LINE_FADE_MS);
      items.forEach((item, i) => item.classList.toggle('is-active', i === index));
      marks.forEach((mark, i) => mark.classList.toggle('is-active', i === index));
    };
    show(0, false);
    viewport.replaceChildren(...items);
    accessibleFacts.textContent = lines.map((line) => line.parts.map((part) => part.text).join('')).join(' ');
    ticker.removeAttribute('aria-busy');
    if (lines.length < 2) return dots.replaceChildren(...marks);

    // Back and forth by hand; the rotation waits while the pointer or the focus is on the banner.
    const step = (by: number): void => show((current + by + items.length) % items.length);
    const arrow = (direction: 'previous' | 'next', glyph: string): HTMLElement => {
      const button = h(`button.stats-ticker__step.stats-ticker__step--${direction}`, { type: 'button', 'aria-label': t(direction === 'next' ? 'stats.ticker.next' : 'stats.ticker.previous') }, glyph);
      button.addEventListener('click', () => step(direction === 'next' ? 1 : -1));
      return button;
    };
    dots.replaceChildren(arrow('previous', '‹'), h('span.stats-ticker__marks', { 'aria-hidden': 'true' }, ...marks), arrow('next', '›'));
    // The dots were for show; with buttons among them the group is read as the controls it holds.
    dots.removeAttribute('aria-hidden');

    let held = false;
    const hold = (value: boolean) => () => void (held = value);
    ticker.addEventListener('pointerenter', hold(true));
    ticker.addEventListener('pointerleave', hold(false));
    ticker.addEventListener('focusin', hold(true));
    ticker.addEventListener('focusout', hold(false));
    const timer = setInterval(() => {
      // The menu page this lives on is gone once it has left the document.
      if (!ticker.isConnected) return clearInterval(timer);
      if (held || ticker.classList.contains('is-expanded') || document.hidden) return;
      step(1);
    }, LINE_MS);
  };
  const tipsOnly = (): void => {
    ticker.setAttribute('aria-label', t('tips.label'));
    run(tipLines(TIPS_ONLY).map((parts) => ({ kind: 'tip', parts })));
  };

  if (!wantsFacts) {
    tipsOnly();
    return ticker;
  }
  loadFacts(board).then((facts) => {
    const numbers = factLines(facts).slice(0, MIXED_FACTS);
    if (!numbers.length) return tipsOnly();
    run(interleave(numbers, tipLines(MIXED_TIPS)));
  }, tipsOnly);
  return ticker;
}
