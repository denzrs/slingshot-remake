import { dailyChallenge } from '../challenge';
import { fmtInt, t, type Key } from '../i18n';
import { Leaderboard, BoardRejected, type DailyBoard } from '../leaderboard';
import { loadLobbyPrefs, saveLobbyPrefs } from '../lobbyPrefs';
import { DEFAULT_SERVER } from '../multiplayer';
import type { DailyEntry } from '../net';
import { h, type MenuItem, type Screen } from './menu';
import type { App } from './screens';

/**
 * Whether the daily leaderboard can be reached at all. It lives on the multiplayer relay, so a
 * build without one (a self-hosted copy, a local dev run) has no board to post to and says nothing
 * about it rather than offering a button that cannot work.
 */
export const leaderboardAvailable = (): boolean => Boolean(import.meta.env.VITE_MULTIPLAYER_SERVER);

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
export function leaderboardScreen(app: App, day: string, caption: string, score: number | null): Screen {
  const boards = new Leaderboard();
  const prefs = loadLobbyPrefs(DEFAULT_SERVER);
  const challenge = dailyChallenge(day);
  let name = prefs.name;
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

  const status = h('p.lb__status', { role: 'status' }, '');
  const rows = h('ol.lb__rows', null);

  const paint = (): void => {
    nameField.value = name;
    const empty = !!board && board.entries.length === 0;
    status.textContent = busy ? t('daily.board.loading') : message ?? (empty ? t('daily.board.empty') : '');
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
    const wanted = name.trim();
    if (!wanted) {
      message = t('multiplayer.nameRequired');
      refused = true;
      paint();
      nameField.focus();
      return;
    }
    name = wanted;
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
  };
  nameField.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') void submit();
  });

  // The board is there before the player decides anything about it.
  void (async (): Promise<void> => {
    const mine = ++pending;
    try {
      const seen = await boards.top(day);
      if (mine !== pending) return;
      board = seen;
    } catch {
      if (mine !== pending) return;
      message = t('daily.board.failed');
    }
    busy = false;
    paint();
  })();

  const goesUp = score !== null;
  const root = h(
    'section.screen.screen--panel',
    { role: 'dialog', 'aria-modal': 'true', 'aria-label': t('daily.board.eyebrow') },
    h(
      'div.panel.panel--daily',
      null,
      h('p.eyebrow', null, t('daily.board.eyebrow')),
      h('h2.daily__title', null, `#${challenge.number} · ${t(`daily.theme.${challenge.theme}` as Key)}`),
      h('p.daily__date', null, caption),
      h(
        'div.lb',
        null,
        // With nothing to post there is no name to give and nothing to press but Back.
        ...(goesUp
          ? [h('label.lobby__field', null, h('span', null, t('daily.board.name')), nameField), h('p.note.lb__hint', null, t('daily.board.hint'))]
          : []),
        h('div.items.items--row', { 'data-items': '' }),
        status,
        rows,
      ),
    ),
  );
  paint();

  return {
    build: () => {
      // The screen opens on the name: it is the one thing to fill in before a run can go up.
      if (goesUp) queueMicrotask(() => nameField.focus());
      return root;
    },
    items: [
      ...(goesUp ? [{ kind: 'action', label: t('daily.board.submit'), primary: true, run: () => void submit() } satisfies MenuItem] : []),
      { kind: 'action', label: t('common.back'), primary: !goesUp, run: () => app.menu.back() },
    ] satisfies MenuItem[],
  };
}
