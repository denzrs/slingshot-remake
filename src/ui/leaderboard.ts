import { dailyChallenge, dateKey, shiftDate } from '../challenge';
import { fmtInt, t } from '../i18n';
import { Leaderboard, BoardRejected, oldestBoardDay, type DailyBoard } from '../leaderboard';
import { loadLobbyPrefs, saveLobbyPrefs } from '../lobbyPrefs';
import { DEFAULT_SERVER } from '../multiplayer';
import type { DailyEntry } from '../net';
import { h, type MenuItem, type Screen } from './menu';
import { formatDay } from './dayFormat';
import type { App } from './screens';
import { menuPage } from './menu-page';

/**
 * Whether the daily leaderboard can be reached at all. It lives on the multiplayer relay, so a
 * build without one (a self-hosted copy, a local dev run) has no board to post to and says nothing
 * about it rather than offering a button that cannot work.
 */
export const leaderboardAvailable = (): boolean => Boolean(import.meta.env.VITE_MULTIPLAYER_SERVER);

/** Keep the selected day pinned left as later days peek in to its right. */
function positionDayPager(root: HTMLElement, transition?: 'next' | 'previous'): () => void {
  const viewport = root.querySelector<HTMLElement>('.daily-board-pager__viewport');
  const track = root.querySelector<HTMLElement>('.daily-board-pager');
  if (!viewport || !track) return () => {};

  let frame = 0;
  let settleFrame = 0;
  const targetOffset = (): number => {
    const active = track.querySelector<HTMLElement>('.is-selected');
    if (!active) return 0;
    const configuredAnchor = Number.parseFloat(getComputedStyle(viewport).getPropertyValue('--mode-anchor'));
    const anchorPercent = Number.isFinite(configuredAnchor) ? configuredAnchor : 50;
    const anchor = viewport.clientWidth * anchorPercent / 100;
    const activePoint = active.offsetWidth * anchorPercent / 100;
    return anchor - active.offsetLeft - activePoint;
  };
  const position = (): void => {
    if (!track.isConnected) return;
    const target = targetOffset();
    if (!track.classList.contains('is-positioned')) {
      const entranceOffset = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : transition === 'next' ? 72 : transition === 'previous' ? -72 : 0;
      track.style.transform = `translate3d(${target + entranceOffset}px, 0, 0)`;
      if (!settleFrame) {
        settleFrame = requestAnimationFrame(() => {
          settleFrame = 0;
          if (!track.isConnected) return;
          track.classList.add('is-positioned');
          track.style.transform = `translate3d(${targetOffset()}px, 0, 0)`;
        });
      }
      return;
    }
    track.style.transform = `translate3d(${target}px, 0, 0)`;
  };
  const schedulePosition = (): void => {
    if (frame) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      frame = 0;
      position();
    });
  };
  const observer = new ResizeObserver(schedulePosition);
  observer.observe(viewport);
  observer.observe(track);
  schedulePosition();

  return () => {
    observer.disconnect();
    if (frame) cancelAnimationFrame(frame);
    if (settleFrame) cancelAnimationFrame(settleFrame);
  };
}

/** One row of the board: place, name, total. */
function boardRow(entry: DailyEntry, yours: boolean): HTMLElement {
  return h(
    'li',
    { class: yours ? 'lb__row is-you' : 'lb__row' },
    h('span.lb__rank', null, `#${entry.rank}`),
    h('span.lb__name', null, entry.name),
    h('span.lb__score', null, fmtInt(entry.score)),
  );
}

/**
 * A day's leaderboard. Reached with a run in hand from the result card, it offers to put that run
 * up under a name; reached with `score` null — from the daily challenge itself — it just shows the
 * board, so the day's standing can be looked at before or without flying it.
 */
export function leaderboardScreen(
  app: App,
  day: string,
  caption: string,
  score: number | null,
  initialDay = day,
  transition?: 'next' | 'previous',
  initialName?: string,
  submitOnOpen = false,
): Screen {
  const boards = new Leaderboard();
  const prefs = loadLobbyPrefs(DEFAULT_SERVER);
  /** The day on show: the one the screen opened on, until the player pages through the others. */
  let shown = initialDay;
  let name = initialName ?? prefs.name;
  let board: DailyBoard | null = null;
  let message: string | null = null;
  let busy = true;
  /** The last thing that happened was the relay saying no: shown as a thing to fix, not a result. */
  let refused = false;
  /** The newest board request: an answer that is no longer the newest is dropped, so a slow look
   * at the board can never overwrite a run posted in the meantime. */
  let pending = 0;

  const nameField = document.createElement('input');
  nameField.type = 'text';
  nameField.maxLength = 24;
  nameField.setAttribute('autocomplete', 'nickname');
  nameField.value = name;
  nameField.addEventListener('input', () => {
    name = nameField.value;
  });

  const status = h('div.lb__status', { role: 'status' }, '');
  const rows = h('ol.lb__rows', null);
  let statusFlashTimer: ReturnType<typeof setTimeout> | undefined;
  let rowsFlashTimer: ReturnType<typeof setTimeout> | undefined;
  const radar = () => h('span.lobby__empty-radar', { 'aria-hidden': 'true' });
  const flashNotFound = (): void => {
    status.classList.remove('is-not-found', 'is-error');
    void status.offsetWidth;
    status.classList.add('is-not-found');
    clearTimeout(statusFlashTimer);
    statusFlashTimer = setTimeout(() => status.classList.remove('is-not-found'), 1000);
  };
  const flashFound = (): void => {
    rows.classList.remove('is-found');
    void rows.offsetWidth;
    rows.classList.add('is-found');
    clearTimeout(rowsFlashTimer);
    rowsFlashTimer = setTimeout(() => rows.classList.remove('is-found'), 1000);
  };
  const title = h('h2.mode-pager__semantic-title', { 'aria-live': 'polite', 'aria-atomic': 'true' });
  const kind = h('p.note.lb__kind', null);
  const date = h('p.daily__date', null);
  const pager = h('nav.items.items--row.mode-pager.daily-board-pager', {
    'data-section': 'pager', 'data-transition': transition ?? '', 'aria-label': t('daily.board.eyebrow'),
  });
  const pagerViewport = h('div.mode-pager__viewport.daily-board-pager__viewport', null, pager);
  const carousel = h('div.mode-carousel.daily-board-carousel', null,
    title,
    pagerViewport,
    date,
    h('div.mode-pager__keys.daily-board-pager__keys', { 'aria-hidden': 'true' },
      h('span', null, '‹ (Q)'), h('span', null, '(E) ›'),
    ),
  );
  let stopPager = (): void => {};
  const dayLabel = (key: string): string => {
    const challenge = dailyChallenge(key);
    return t(`daily.theme.${challenge.theme}`);
  };
  const canView = (key: string): boolean => key >= oldestBoardDay(dateKey()) && key <= dateKey();
  const goTo = (key: string): void => {
    if (!canView(key) || key === shown) return;
    const direction = key > shown ? 'next' : 'previous';
    const focusIndex = direction === 'next'
      ? canView(shiftDate(key, 1)) ? 1 : 0
      : 0;
    // Replace only this board page so Back still returns to the screen that opened it.
    app.menu.replace(
      () => leaderboardScreen(app, day, caption, score, key, direction, name),
      focusIndex,
    );
  };
  const pagerItems = [0, 1, 2].map((offset): MenuItem => {
    const key = shiftDate(shown, offset);
    const position = offset === 0 ? 'current' : offset === 1 ? 'next' : 'far';
    return {
      kind: 'action', section: 'pager', label: dayLabel(key),
      className: `mode-pager__item mode-pager__item--${position === 'current' ? 'active' : position === 'next' ? 'near' : 'far'} daily-board-pager__item--${position}`,
      selected: () => key === shown,
      hidden: () => !canView(key),
      run: () => goTo(key),
    };
  });
  const paintHead = (): void => {
    const challenge = dailyChallenge(shown);
    title.textContent = dayLabel(shown);
    kind.textContent = challenge.theme === 'precision' ? '' : t(`daily.theme.${challenge.theme}.text`);
    date.textContent = shown === day ? caption : formatDay(shown);
    app.menu.refresh();
  };

  const paint = (): void => {
    paintHead();
    nameField.value = name;
    const empty = !!board && board.entries.length === 0;
    const emptyText = t(shown === dateKey() ? 'daily.board.empty' : 'daily.board.emptyDay');
    const statusText = busy ? t('daily.board.loading') : message ?? (empty ? emptyText : '');
    const showEmpty = !busy && !message && empty;
    status.classList.toggle('lobby__empty', busy || showEmpty);
    status.classList.toggle('is-searching', busy);
    if (busy || !showEmpty) {
      status.classList.remove('is-not-found', 'is-error');
      clearTimeout(statusFlashTimer);
    }
    if (busy) {
      status.replaceChildren(radar(), h('strong', null, statusText));
    } else if (showEmpty) {
      status.replaceChildren(
        radar(),
        h('strong', null, emptyText),
      );
    } else {
      status.textContent = statusText;
    }
    // A refused run is the player's to fix; that is not the same colour as a posted one.
    status.classList.toggle('is-refused', refused);
    const mine = board?.you ?? null;
    rows.replaceChildren(
      ...(board?.entries ?? []).map((entry) =>
        boardRow(entry, !!mine && mine.rank === entry.rank && mine.name === entry.name && mine.score === entry.score),
      ),
    );
    rows.hidden = !board || board.entries.length === 0;
  };

  const submit = async (): Promise<void> => {
    if (score === null) return;
    if (shown !== day) {
      const direction = day > shown ? 'next' : 'previous';
      app.menu.replace(
        () => leaderboardScreen(app, day, caption, score, day, direction, name, true),
        direction === 'next' && canView(shiftDate(day, 1)) ? 1 : 0,
      );
      return;
    }
    const wanted = name.trim();
    if (!wanted) {
      message = t('multiplayer.nameRequired');
      refused = true;
      paint();
      nameField.focus();
      return;
    }
    name = wanted;
    shown = day;
    prefs.name = wanted;
    saveLobbyPrefs(prefs);
    const mine = ++pending;
    busy = true;
    message = null;
    refused = false;
    paint();
    try {
      const posted = await boards.submit(day, name, score);
      if (mine !== pending) return;
      board = posted;
      message = t('daily.board.posted', { rank: posted.you?.rank ?? 0 });
    } catch (error) {
      if (mine !== pending) return;
      // The relay's own words for a refused run — a name it will not carry, say — so it can be
      // typed again; the field keeps what was written and keeps the cursor.
      const rejected = error instanceof BoardRejected;
      message = rejected ? error.message : t('daily.board.failed');
      refused = rejected;
      busy = false;
      paint();
      if (rejected) nameField.focus();
      return;
    }
    busy = false;
    paint();
    flashFound();
  };
  nameField.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') void submit();
  });

  const load = async (): Promise<void> => {
    const mine = ++pending;
    const wanted = shown;
    board = null;
    message = null;
    refused = false;
    busy = true;
    paint();
    try {
      const seen = await boards.top(wanted);
      if (mine !== pending) return;
      board = seen;
    } catch {
      if (mine !== pending) return;
      message = t('daily.board.failed');
    }
    busy = false;
    paint();
    if (!message && board) {
      if (board.entries.length) flashFound();
      else flashNotFound();
    }
  };

  // The board is there before the player decides anything about it.
  void load();

  const goesUp = score !== null;
  const root = menuPage({
    title: shown === day ? caption : formatDay(shown),
    eyebrow: t('daily.board.eyebrow'), headerTitle: carousel,
    className: `menu-page--leaderboard menu-page--mode-pager${transition ? ` menu-page--mode-enter-${transition}` : ''}`,
    body: [h('div.lb', null,
      kind,
      // With nothing to post there is no name to give and nothing to press but Back.
      ...(goesUp ? [h('label.lobby__field', null, h('span', null, t('daily.board.name')), nameField), h('p.note.lb__hint', null, t('daily.board.hint'))] : []),
      status, rows,
    )],
  });
  let swipeStart: { x: number; y: number } | null = null;
  root.addEventListener('touchstart', (event: TouchEvent) => {
    if (event.touches.length !== 1) { swipeStart = null; return; }
    const target = event.target;
    if (target instanceof Element && target.closest('input, select, textarea, [contenteditable="true"]')) {
      swipeStart = null;
      return;
    }
    swipeStart = { x: event.touches[0].clientX, y: event.touches[0].clientY };
  }, { passive: true });
  root.addEventListener('touchend', (event: TouchEvent) => {
    if (!swipeStart || event.changedTouches.length !== 1) { swipeStart = null; return; }
    const dx = event.changedTouches[0].clientX - swipeStart.x;
    const dy = event.changedTouches[0].clientY - swipeStart.y;
    swipeStart = null;
    if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 1.3) return;
    event.preventDefault();
    goTo(shiftDate(shown, dx < 0 ? 1 : -1));
  }, { passive: false });
  const handlePagerKey = (event: KeyboardEvent): void => {
    if (!root.isConnected) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target;
    if (!(target instanceof Element) || target.closest('input, select, textarea, [contenteditable="true"]')) return;
    const key = event.key.toLowerCase();
    const shortcut = key === 'q' || key === 'e';
    if (!shortcut && (!target.closest('.daily-board-pager') || (key !== 'arrowleft' && key !== 'arrowright'))) return;
    event.preventDefault();
    event.stopPropagation();
    goTo(shiftDate(shown, key === 'arrowright' || key === 'e' ? 1 : -1));
  };
  // Capture page-level shortcuts even when focus is on another menu row. Text inputs remain untouched.
  document.addEventListener('keydown', handlePagerKey, true);
  paint();

  return {
    build: () => {
      // The screen opens on the name: it is the one thing to fill in before a run can go up.
      if (submitOnOpen) queueMicrotask(() => void submit());
      else if (goesUp && !transition) queueMicrotask(() => nameField.focus());
      stopPager = positionDayPager(root, transition);
      return root;
    },
    items: [
      ...pagerItems,
      { kind: 'action', label: t('common.back'), primary: !goesUp, run: () => app.menu.back() },
      ...(goesUp ? [{ kind: 'action', label: t('daily.board.submit'), primary: true, run: () => void submit() } satisfies MenuItem] : []),
    ] satisfies MenuItem[],
    focus: transition === 'next' && canView(shiftDate(shown, 1)) ? 1 : 0,
    update: () => {
      pager.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
        if (button.classList.contains('is-selected')) button.setAttribute('aria-current', 'page');
        else button.removeAttribute('aria-current');
      });
    },
    dispose: () => {
      document.removeEventListener('keydown', handlePagerKey, true);
      stopPager();
      pending++;
      clearTimeout(statusFlashTimer);
      clearTimeout(rowsFlashTimer);
    },
  };
}
