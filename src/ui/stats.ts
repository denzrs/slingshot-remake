import { fmtInt, getLang, t, tn } from '../i18n';
import type { StatsGame } from '../net';
import { buildHeatmap, METRICS, StatsBoard, type Metric, type StatsOverview } from '../statsBoard';
import { h, type MenuItem, type Screen } from './menu';
import { leaderboardAvailable } from './leaderboard';
import type { App } from './screens';

/** The statistics live on the multiplayer relay, like the daily board: a build without one has none to show. */
export const statsAvailable = leaderboardAvailable;

const utcToday = (): string => new Date().toISOString().slice(0, 10);

/** "Oct 23" / "23. Okt." for a UTC date. */
function shortDay(day: string): string {
  return new Intl.DateTimeFormat(getLang(), { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`));
}

const monthName = (month: number): string => new Intl.DateTimeFormat(getLang(), { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, month, 1)));

/** The weekday names down the side, Sunday first: only every other row is named, as on GitHub. */
const weekdayName = (index: number): string => new Intl.DateTimeFormat(getLang(), { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 0, 4 + index)));

const metricLabel = (metric: Metric): string => t(`stats.metric.${metric}`);

/** Takes the tooltip off the page, and hands it back to be reused. */
function hideTip(): HTMLElement | null {
  const tip = document.querySelector<HTMLElement>('.hm__tip');
  tip?.remove();
  return tip;
}

/**
 * The heatmap: built once, with a square for every day of the year, and then only told what to show. Switching what it
 * shows is a few hundred attribute changes, where building it again was a few hundred elements and a repaint of the page.
 */
function heatmapView(overview: StatsOverview): { el: HTMLElement; show(metric: Metric): void } {
  const today = utcToday();
  const first = buildHeatmap(overview.days, 'rounds', today);
  const grid = h('div.hm__grid', { role: 'img' });
  const squares: (HTMLElement | null)[][] = [];
  for (const week of first.weeks) {
    const column = h('div.hm__week', null);
    const row: (HTMLElement | null)[] = [];
    for (const cell of week) {
      const square = h('span.hm__cell', cell ? {} : { 'data-empty': '' });
      row.push(cell ? square : null);
      column.append(square);
    }
    squares.push(row);
    grid.append(column);
  }
  const months = h('div.hm__months', null);
  for (const { week, month } of first.months) {
    const label = h('span', null, monthName(month));
    label.style.gridColumn = String(week + 1);
    months.append(label);
  }
  const days = h('div.hm__days', { 'aria-hidden': 'true' }, ...[0, 1, 2, 3, 4, 5, 6].map((i) => h('span', null, i % 2 === 1 ? weekdayName(i) : '')));
  const legend = h(
    'div.hm__legend',
    null,
    h('span', null, t('stats.less')),
    ...[0, 1, 2, 3, 4].map((level) => h('span.hm__cell', { 'data-level': String(level) })),
    h('span', null, t('stats.more')),
  );
  // A tooltip of our own, at once: the browser's title text waits a second. It sits on the page itself, not in the panel, whose
  // scrolling and animation would clip it or move it.
  const cellAt = (event: Event): HTMLElement | null => (event.target instanceof Element ? event.target.closest<HTMLElement>('.hm__cell[data-tip]') : null);
  grid.addEventListener('mouseover', (event) => {
    const cell = cellAt(event);
    if (!cell) return;
    const tip = hideTip() ?? h('div.hm__tip', { role: 'tooltip' });
    tip.textContent = cell.dataset.tip ?? '';
    const box = cell.getBoundingClientRect();
    tip.style.left = `${box.left + box.width / 2}px`;
    tip.style.top = `${box.top}px`;
    document.body.append(tip);
  });
  grid.addEventListener('mouseleave', hideTip);
  const total = h('p.hm__total', null, '');
  const show = (metric: Metric): void => {
    const shown = buildHeatmap(overview.days, metric, today);
    shown.weeks.forEach((week, w) =>
      week.forEach((cell, d) => {
        const square = squares[w][d];
        if (!square || !cell) return;
        square.dataset.level = String(cell.level);
        square.dataset.tip = `${shortDay(cell.day)} · ${metricLabel(metric)}: ${fmtInt(cell.value)}`;
      }),
    );
    total.textContent = t('stats.total', { n: fmtInt(shown.total), what: metricLabel(metric) });
    grid.setAttribute('aria-label', `${metricLabel(metric)}: ${fmtInt(shown.total)}`);
  };
  return { el: h('div.hm', null, total, h('div.hm__frame', null, days, h('div.hm__body', null, months, grid)), legend), show };
}

function gameRow(game: StatsGame, watch: (game: StatsGame, button: HTMLButtonElement) => void): HTMLElement {
  const players = [game.humans ? tn('stats.players', game.humans) : '', game.cpus ? `${game.cpus} ${tn('lineup.cpu', game.cpus)}` : ''].filter(Boolean).join(' · ');
  const when = new Date(game.at * 1000);
  const time = new Intl.DateTimeFormat(getLang(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(when);
  // A game can be flown again when the relay has the whole of it (its host logged what it takes); the button says why not.
  const rewatch = h('button.lobby__button.st__rewatch', { type: 'button', title: game.replay ? t('stats.rewatch') : t('stats.rewatch.soon') }, t('stats.rewatch')) as HTMLButtonElement;
  if (game.replay) rewatch.addEventListener('click', () => watch(game, rewatch));
  else rewatch.setAttribute('disabled', '');
  return h(
    'li.st__row',
    null,
    h('span.st__when', null, time),
    h('span.st__mode', null, `${t(`mode.${game.gameMode}`)}${game.mode === 'team' ? ` · ${t('stats.team')}` : ''}${game.local ? ` · ${t('stats.local')}` : ''}`),
    h('span.st__players', null, players),
    h('span.st__num', null, tn('stats.rounds', game.rounds)),
    h('span.st__num', null, fmtInt(game.points)),
    rewatch,
  );
}

/**
 * How the games on the relay go: a year of days as a heatmap that can be read as rounds, players or points
 * per day, and the latest games below it, each with a button to watch it again.
 */
export function statsScreen(app: App): Screen {
  const board = new StatsBoard();
  let metric: Metric = 'rounds';
  let overview: StatsOverview | null = null;
  let view: ReturnType<typeof heatmapView> | null = null;
  let failed = false;

  const status = h('p.lb__status', { role: 'status' }, t('stats.loading'));
  const heat = h('div.st__heat', null);
  const games = h('ol.st__rows', null);
  const head = h('div.st__head', null, h('span', null, t('stats.col.when')), h('span', null, t('stats.col.mode')), h('span', null, t('stats.col.players')), h('span.st__num', null, t('stats.col.rounds')), h('span.st__num', null, t('stats.col.points')), h('span', null));
  const table = h('div.st__table', null, h('h3.st__title', null, t('stats.games')), head, games);

  /** Fetches a game and flies it: the button says so while it waits, and the page says if it could not. */
  const watch = (game: StatsGame, button: HTMLButtonElement): void => {
    button.disabled = true;
    const label = button.textContent;
    button.textContent = t('replay.loading');
    const failedToLoad = (): void => {
      button.disabled = false;
      button.textContent = label;
      status.textContent = t('replay.failed');
    };
    board.replay(game.id).then((replay) => (replay ? app.watchReplay(replay) : failedToLoad()), failedToLoad);
  };

  const paint = (): void => {
    status.textContent = failed ? t('stats.failed') : !overview ? t('stats.loading') : !overview.enabled ? t('stats.off') : '';
    const shown = !!overview?.enabled;
    heat.hidden = !shown;
    table.hidden = !shown;
    if (!overview || !shown) return;
    hideTip();
    // The page is made once; a switch of what the heatmap shows only changes the squares.
    if (!view) {
      view = heatmapView(overview);
      heat.replaceChildren(view.el);
      // On a narrow screen the heatmap scrolls: it opens on today, the right-hand end.
      const frame = view.el.querySelector('.hm__frame');
      if (frame) frame.scrollLeft = frame.scrollWidth;
      games.replaceChildren(...overview.games.map((game) => gameRow(game, watch)));
      head.hidden = overview.games.length === 0;
      if (overview.games.length === 0) games.replaceChildren(h('li.st__none', null, t('stats.none')));
    }
    view.show(metric);
  };

  void board.overview().then(
    (seen) => {
      overview = seen;
      paint();
    },
    () => {
      failed = true;
      paint();
    },
  );

  const root = h(
    'section.screen.screen--panel',
    { role: 'dialog', 'aria-modal': 'true', 'aria-label': t('stats.title') },
    h(
      'div.panel.panel--stats',
      null,
      h('p.eyebrow', null, t('stats.eyebrow')),
      h('h2.daily__title', null, t('stats.title')),
      h('div.items.items--row', { 'data-section': 'metric' }),
      status,
      heat,
      table,
      h('div.items.items--row', { 'data-items': '' }),
    ),
  );
  paint();

  return {
    build: () => root,
    items: [
      {
        kind: 'segmented',
        section: 'metric',
        label: t('stats.metric'),
        options: METRICS.map((m) => ({ value: m, label: metricLabel(m) })),
        get: () => metric,
        set: (v) => {
          metric = v as Metric;
          paint();
        },
      },
      { kind: 'action', label: t('common.back'), primary: true, run: () => app.menu.back() },
    ] satisfies MenuItem[],
  };
}
