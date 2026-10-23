import { fmt, fmtInt, getLang, t, tn } from '../i18n';
import type { StatsBetting, StatsDay, StatsGame } from '../net';
import { buildHeatmap, METRICS, SOURCES, StatsBoard, type Metric, type Source, type StatsOverview } from '../statsBoard';
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
function heatmapView(): { el: HTMLElement; show(days: readonly StatsDay[], metric: Metric): void } {
  const today = utcToday();
  const first = buildHeatmap([], 'rounds', today);
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
  const show = (days: readonly StatsDay[], metric: Metric): void => {
    const shown = buildHeatmap(days, metric, today);
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

const rate = (part: number, of: number): string => (of > 0 ? `${fmt((100 * part) / of, 0)}%` : '–');

/** The tips and bets as a title and a row of figures. */
function bettingView(b: StatsBetting): HTMLElement[] {
  const figure = (value: string, label: string): HTMLElement => h('div.st__figure', null, h('strong', null, value), h('span', null, label));
  const net = b.paid - b.staked;
  return [
    h('h3.st__title', null, t('stats.betting')),
    h(
      'div.st__figures',
      null,
      figure(rate(b.roundRight, b.roundTips), t('stats.betting.round', { n: fmtInt(b.roundTips) })),
      figure(rate(b.shotRight, b.shotTips), t('stats.betting.shot', { n: fmtInt(b.shotTips) })),
      figure(rate(b.won, b.bets), t('stats.betting.paid', { n: fmtInt(b.bets) })),
      figure(b.bets ? fmtInt(Math.round(b.staked / b.bets)) : '–', t('stats.betting.stake', { n: fmtInt(b.biggestStake) })),
      figure(b.biggestWin ? `+${fmtInt(b.biggestWin)}` : '–', t('stats.betting.win')),
      figure(rate(b.underdogs, b.roundRight + b.shotRight), t('stats.betting.underdog')),
      figure(rate(b.stands, b.roundTips + b.shotTips), t('stats.betting.stands')),
      figure(`${net > 0 ? '+' : ''}${fmtInt(net)}`, t('stats.betting.net')),
    ),
  ];
}

/**
 * How the games on the relay go: a year of days as a heatmap that can be read as rounds, players or points
 * per day, and the latest games below it, each with a button to watch it again.
 */
export function statsScreen(app: App): Screen {
  const board = new StatsBoard();
  let metric: Metric = 'rounds';
  let source: Source = 'online';
  let overview: StatsOverview | null = null;
  let view: ReturnType<typeof heatmapView> | null = null;
  let failed = false;

  const status = h('p.lb__status', { role: 'status' }, t('stats.loading'));
  const heat = h('div.st__heat', null);
  const games = h('ol.st__rows', null);
  const head = h('div.st__head', null, h('span', null, t('stats.col.when')), h('span', null, t('stats.col.mode')), h('span', null, t('stats.col.players')), h('span.st__num', null, t('stats.col.rounds')), h('span.st__num', null, t('stats.col.points')), h('span', null));
  const betting = h('div.st__betting', null);
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
    // A reply that comes after the player has left this page must not pull them into a replay.
    board.replay(game.id).then((replay) => (!root.isConnected ? undefined : replay ? app.watchReplay(replay) : failedToLoad()), () => root.isConnected && failedToLoad());
  };

  const paint = (): void => {
    status.textContent = failed ? t('stats.failed') : !overview ? t('stats.loading') : !overview.enabled ? t('stats.off') : '';
    const shown = !!overview?.enabled;
    heat.hidden = !shown;
    table.hidden = !shown;
    betting.hidden = !shown || !overview?.betting;
    if (!overview || !shown) return;
    hideTip();
    // The heatmap is made once; a switch of what it shows only changes the squares.
    if (!view) {
      view = heatmapView();
      heat.replaceChildren(view.el);
      // On a narrow screen the heatmap scrolls: it opens on today, the right-hand end.
      const frame = view.el.querySelector('.hm__frame');
      if (frame) frame.scrollLeft = frame.scrollWidth;
    }
    if (overview.betting) betting.replaceChildren(...bettingView(overview.betting));
    const local = source === 'local';
    view.show(local ? overview.localDays : overview.days, metric);
    const shownGames = overview.games.filter((game) => game.local === local).slice(0, 5);
    head.hidden = shownGames.length === 0;
    games.replaceChildren(...(shownGames.length === 0 ? [h('li.st__none', null, t('stats.none'))] : shownGames.map((game) => gameRow(game, watch))));
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
      h('div.items.items--row', { 'data-section': 'source' }),
      h('div.items.items--row', { 'data-section': 'metric' }),
      status,
      heat,
      table,
      betting,
      h('div.items.items--row', { 'data-items': '' }),
    ),
  );
  paint();

  return {
    build: () => root,
    items: [
      {
        kind: 'segmented',
        section: 'source',
        label: t('stats.source'),
        options: SOURCES.map((s) => ({ value: s, label: t(`stats.source.${s}`) })),
        get: () => source,
        set: (v) => {
          source = v as Source;
          paint();
        },
      },
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
