import { fmt, fmtInt, getLang, t, tn } from '../../platform/i18n';
import { hintText } from '../../platform/input-device';
import type { StatsBetting, StatsDay, StatsFact, StatsGame } from '../../net/net';
import { buildHeatmap, METRICS, StatsBoard, type Metric, type Source, type StatsOverview } from '../../net/statsBoard';
import { factsByGroup, type FactPart } from '../../net/statsFacts';
import { factValues, modeShares, monthTotals, summarize, weekdayAverages } from '../../net/statsSummary';
import { h, type MenuItem, type Screen } from '../menu/menu';
import { menuPage } from '../menu/menu-page';
import { modeArt } from '../menu/mode-icons';
import { leaderboardAvailable } from '../daily/leaderboard';
import { enablePagerNavigation, pagePagerHeader, positionModeCarousel, type ModeTransition } from '../screens/mode-pager';
import type { App } from '../screens';
import { loadFacts } from './facts';

/** The statistics live on the multiplayer relay, like the daily board: a build without one has none to show. */
export const statsAvailable = leaderboardAvailable;

const utcToday = (): string => new Date().toISOString().slice(0, 10);

/** "Oct 23" / "23. Okt." for a UTC date. */
function shortDay(day: string): string {
  return new Intl.DateTimeFormat(getLang(), { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`));
}

const monthName = (month: number): string => new Intl.DateTimeFormat(getLang(), { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, month, 1)));

/** A weekday's short name, Monday = 0. 2026-01-05 was a Monday. */
const weekdayName = (index: number): string => new Intl.DateTimeFormat(getLang(), { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 0, 5 + index)));

const metricLabel = (metric: Metric): string => t(`stats.metric.${metric}`);

/** "12 Runden", "1 Punkt": a count of the metric, its figure formatted. */
const metricCount = (metric: Metric, value: number): string => tn(`stats.${metric}`, value, { n: fmtInt(Math.round(value)) });

/** A large figure kept short: 1.234.567 as "1,2 Mio.". */
const compact = (n: number): string => (n < 100_000 ? fmtInt(n) : new Intl.NumberFormat(getLang(), { notation: 'compact', maximumFractionDigits: 1 }).format(n));

/** "20 %" in German, "20%" in English, as the facts write them. */
const percent = (n: number): string => (getLang() === 'de' ? `${fmt(n, 0)}\u00a0%` : `${fmt(n, 0)}%`);

/** "2 hours ago" / "vor 2 Stunden" for a unix time. */
function ago(seconds: number): string {
  const diff = seconds - Date.now() / 1000;
  const format = new Intl.RelativeTimeFormat(getLang(), { numeric: 'auto' });
  const abs = Math.abs(diff);
  if (abs < 3600) return format.format(Math.round(diff / 60), 'minute');
  if (abs < 86_400) return format.format(Math.round(diff / 3600), 'hour');
  if (abs < 7 * 86_400) return format.format(Math.round(diff / 86_400), 'day');
  return new Intl.DateTimeFormat(getLang(), { day: 'numeric', month: 'short' }).format(new Date(seconds * 1000));
}

/** Takes the tooltip off the page, and hands it back to be reused. */
function hideTip(): HTMLElement | null {
  const tip = document.querySelector<HTMLElement>('.hm__tip');
  tip?.remove();
  return tip;
}

/** Shows our own tooltip over whatever element under the pointer carries `data-tip`: at once, where the browser's title waits a second. */
function withTips(root: HTMLElement): HTMLElement {
  root.addEventListener('mouseover', (event) => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-tip]') : null;
    if (!target) return;
    const tip = hideTip() ?? h('div.hm__tip', { role: 'tooltip' });
    tip.textContent = target.dataset.tip ?? '';
    const box = target.getBoundingClientRect();
    tip.style.left = `${box.left + box.width / 2}px`;
    tip.style.top = `${box.top}px`;
    // It sits on the page itself, not in the scrolling body, which would clip it.
    document.body.append(tip);
  });
  root.addEventListener('mouseout', (event) => {
    if (!(event.relatedTarget instanceof Element) || !event.relatedTarget.closest('[data-tip]')) hideTip();
  });
  return root;
}

/**
 * The heatmap: built once, with a square for every day of the year, and then only told what to show. Switching what it
 * shows is a few hundred attribute changes, where building it again was a few hundred elements and a repaint of the page.
 */
function heatmapView(): { el: HTMLElement; show(days: readonly StatsDay[], metric: Metric): number } {
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
  // Sunday first, as the columns run; only every other row is named.
  const days = h('div.hm__days', { 'aria-hidden': 'true' }, ...[6, 0, 1, 2, 3, 4, 5].map((d, i) => h('span', null, i % 2 === 1 ? weekdayName(d) : '')));
  const legend = h(
    'div.hm__legend',
    { 'aria-hidden': 'true' },
    h('span', null, t('stats.less')),
    ...[0, 1, 2, 3, 4].map((level) => h('span.hm__cell', { 'data-level': String(level) })),
    h('span', null, t('stats.more')),
  );
  const show = (shownDays: readonly StatsDay[], metric: Metric): number => {
    const shown = buildHeatmap(shownDays, metric, today);
    shown.weeks.forEach((week, w) =>
      week.forEach((cell, d) => {
        const square = squares[w][d];
        if (!square || !cell) return;
        square.dataset.level = String(cell.level);
        square.dataset.tip = `${shortDay(cell.day)} · ${metricCount(metric, cell.value)}`;
      }),
    );
    grid.setAttribute('aria-label', t('stats.heat.total', { n: metricCount(metric, shown.total) }));
    return shown.total;
  };
  return { el: h('div.hm', null, h('div.hm__frame', null, days, h('div.hm__body', null, months, grid)), legend), show };
}

/** A card of the overview: a heading, maybe a line beside it, and what it shows. */
function card(kind: string, title: string, tool?: HTMLElement): { el: HTMLElement; meta: HTMLElement; body: HTMLElement } {
  const meta = h('span.st-card__meta', null);
  const body = h('div.st-card__body', null);
  const heading = h('div.st-card__heading', null, h('h3.st-card__title', null, title), meta);
  const el = h(`section.st-card.st-card--${kind}`, null, h('header.st-card__head', null, heading, ...(tool ? [tool] : [])), body);
  return { el, meta, body };
}

/** One figure of the strip on top: what it is, the figure, and a line under it. */
function kpi(label: string, value: string, note: string, trend?: 'up' | 'down'): HTMLElement {
  return h(
    'li.st-kpi',
    trend ? { 'data-trend': trend } : null,
    h('span.st-kpi__label', null, label),
    h('strong.st-kpi__value', null, value),
    h('span.st-kpi__note', null, note),
  );
}

function kpis(days: readonly StatsDay[]): HTMLElement[] {
  const s = summarize(days, utcToday());
  const change = s.weekBefore > 0 ? Math.round((100 * (s.week - s.weekBefore)) / s.weekBefore) : null;
  const trend = change === null || change === 0 ? undefined : change > 0 ? 'up' : 'down';
  return [
    kpi(t('stats.kpi.rounds'), compact(s.rounds), t('stats.kpi.rounds.note')),
    kpi(
      t('stats.kpi.week'),
      fmtInt(s.week),
      change === null ? t('stats.kpi.week.new') : t('stats.kpi.week.note', { n: `${change > 0 ? '+' : change < 0 ? '−' : '±'}${fmtInt(Math.abs(change))}` }),
      trend,
    ),
    kpi(t('stats.kpi.today'), fmtInt(s.today.rounds), tn('stats.players', s.today.players, { n: fmtInt(s.today.players) })),
    kpi(t('stats.kpi.best'), s.bestDay ? fmtInt(s.bestDay.rounds) : '–', s.bestDay ? t('stats.kpi.best.note', { day: shortDay(s.bestDay.day) }) : t('stats.kpi.none')),
    kpi(t('stats.kpi.active'), fmtInt(s.activeDays), t('stats.kpi.active.note', { n: fmtInt(s.longestStreak) })),
    kpi(t('stats.kpi.points'), compact(s.points), t('stats.kpi.points.note', { n: fmt(s.playersPerDay, 1) })),
  ];
}

/** The last twelve months as columns, the current one picked out. */
function monthChart(days: readonly StatsDay[], metric: Metric): HTMLElement {
  const months = monthTotals(days, metric, utcToday());
  const max = Math.max(1, ...months.map((m) => m.value));
  return h(
    'ol.st-months',
    { 'aria-label': t('stats.trend.months') },
    ...months.map((m, i) => {
      const bar = h('span.st-months__bar', null);
      bar.style.setProperty('--share', String(m.value / max));
      return h(
        `li.st-months__item${i === months.length - 1 ? '.is-current' : ''}`,
        { 'data-tip': `${monthName(m.month)} ${m.year} · ${metricCount(metric, m.value)}`, 'aria-label': `${monthName(m.month)} ${m.year}: ${metricCount(metric, m.value)}` },
        h('span.st-months__track', null, bar),
        h('span.st-months__label', { 'aria-hidden': 'true' }, monthName(m.month).slice(0, 3).replace('.', '')),
      );
    }),
  );
}

/** The average day of each weekday, as bars from Monday to Sunday. */
function weekdayChart(days: readonly StatsDay[], metric: Metric): HTMLElement {
  const averages = weekdayAverages(days, metric, utcToday());
  const max = Math.max(1e-9, ...averages);
  const best = averages.indexOf(Math.max(...averages));
  return h(
    'ol.st-weekdays',
    { 'aria-label': t('stats.trend.weekdays') },
    ...averages.map((avg, i) => {
      const bar = h('span.st-weekdays__bar', null);
      bar.style.setProperty('--share', String(avg / max));
      return h(
        `li.st-weekdays__item${i === best && avg > 0 ? '.is-best' : ''}`,
        null,
        h('span.st-weekdays__day', null, weekdayName(i).replace('.', '')),
        h('span.st-weekdays__track', null, bar),
        h('span.st-weekdays__value', null, avg >= 10 ? fmtInt(Math.round(avg)) : fmt(avg, 1)),
      );
    }),
  );
}

/** A share as a labelled bar. */
function shareRow(label: string, value: number, icon?: SVGElement): HTMLElement {
  const bar = h('span.st-share__bar', null);
  bar.style.setProperty('--share', String(Math.min(100, Math.max(0, value)) / 100));
  return h(
    'li.st-share',
    null,
    ...(icon ? [h('span.st-share__icon', { 'aria-hidden': 'true' }, icon)] : []),
    h('span.st-share__label', null, label),
    h('span.st-share__value', null, percent(value)),
    h('span.st-share__track', null, bar),
  );
}

/** How the rounds are played: the modes' shares, then teams, anomalies, the loop and the weekend. */
function modesView(facts: readonly StatsFact[]): HTMLElement[] {
  const modes = modeShares(facts);
  const rows: HTMLElement[] = [];
  if (modes) {
    for (const mode of ['classic', 'horizon', 'solar'] as const) rows.push(shareRow(t(`mode.${mode}`).replace('­', ''), modes[mode], modeArt(mode)));
  }
  const extras: HTMLElement[] = [];
  for (const [id, key] of [['teamShare', 'stats.share.team'], ['anomalyShare', 'stats.share.anomaly'], ['loopShare', 'stats.share.loop'], ['weekend', 'stats.share.weekend']] as const) {
    const value = factValues(facts, id)?.[0];
    if (value !== undefined) extras.push(shareRow(t(key), value));
  }
  return [
    ...(rows.length ? [h('ul.st-shares.st-shares--modes', null, ...rows)] : []),
    ...(extras.length ? [h('ul.st-shares', null, ...extras)] : []),
  ];
}

/** The records the relay names among its facts, each as a line with its figure. */
function recordsView(facts: readonly StatsFact[]): HTMLElement[] {
  const record = (label: string, id: string, value: (v: number[]) => string): HTMLElement[] => {
    const values = factValues(facts, id);
    return values ? [h('li.st-record', null, h('span.st-record__label', null, label), h('strong.st-record__value', null, value(values)))] : [];
  };
  return [
    ...record(t('award.bestHit'), 'bestHit', ([v]) => `+${fmtInt(v)}`),
    ...record(t('award.longestShot'), 'longestShot', ([v]) => `${fmtInt(v)} px`),
    ...record(t('stats.record.sniper'), 'sniper', ([v]) => `${fmtInt(v)} px`),
    ...record(t('award.fastestKill'), 'fastestKill', ([v]) => `${fmt(v, 1)} s`),
    ...record(t('award.closeCall'), 'closeCall', ([v]) => `${fmt(v, 1)} px`),
    ...record(t('stats.record.megaKills'), 'bigKills', ([v]) => fmtInt(v)),
    ...record(t('stats.record.betWin'), 'betWin', ([v]) => `+${fmtInt(v)}`),
  ];
}

function gameRow(game: StatsGame, watch: (game: StatsGame, button: HTMLButtonElement) => void): HTMLElement {
  const players = [game.humans ? tn('stats.players', game.humans) : '', game.cpus ? `${game.cpus} ${tn('lineup.cpu', game.cpus)}` : ''].filter(Boolean).join(' · ');
  // A game can be flown again when the relay has the whole of it (its host logged what it takes); the button says why not.
  const why = game.replay ? t('stats.rewatch.hint') : game.local ? t('stats.rewatch.local') : t('stats.rewatch.none');
  const rewatch = h('button.st-game__watch', { type: 'button', title: why, 'aria-label': `${t('stats.rewatch')}: ${t(`mode.${game.gameMode}`)}, ${ago(game.at)}` }, t('stats.rewatch')) as HTMLButtonElement;
  if (game.replay) rewatch.addEventListener('click', () => watch(game, rewatch));
  else rewatch.disabled = true;
  const time = new Intl.DateTimeFormat(getLang(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(game.at * 1000));
  return h(
    'li.st-game',
    null,
    h('span.st-game__art', { 'aria-hidden': 'true' }, modeArt(game.gameMode)),
    h(
      'span.st-game__main',
      null,
      h('span.st-game__mode', null, t(`mode.${game.gameMode}`), ...(game.mode === 'team' ? [h('span.st-game__tag', null, t('stats.team'))] : [])),
      h('span.st-game__meta', null, h('time', { datetime: new Date(game.at * 1000).toISOString(), title: time }, ago(game.at)), ` · ${players}`),
    ),
    h('span.st-game__score', null, h('strong', null, fmtInt(game.points)), h('span', null, tn('stats.rounds', game.rounds))),
    rewatch,
  );
}

/** The tips and bets as a row of figures, each with what it counts under it. */
function bettingView(b: StatsBetting): HTMLElement {
  const rate = (part: number, of: number): string => (of > 0 ? percent((100 * part) / of) : '–');
  const figure = (value: string, label: string, note = ''): HTMLElement =>
    h('li.st-figure', null, h('strong.st-figure__value', null, value), h('span.st-figure__label', null, label), ...(note ? [h('span.st-figure__note', null, note)] : []));
  const net = b.paid - b.staked;
  return h(
    'ol.st-figures',
    null,
    figure(rate(b.roundRight, b.roundTips), t('stats.betting.round'), t('stats.betting.tips', { n: fmtInt(b.roundTips) })),
    figure(rate(b.shotRight, b.shotTips), t('stats.betting.shot'), t('stats.betting.tips', { n: fmtInt(b.shotTips) })),
    figure(rate(b.stands, b.roundTips + b.shotTips), t('stats.betting.stands')),
    figure(rate(b.won, b.bets), t('stats.betting.paid'), t('stats.betting.bets', { n: fmtInt(b.bets) })),
    figure(b.bets ? fmtInt(Math.round(b.staked / b.bets)) : '–', t('stats.betting.stake'), t('stats.betting.stakeMax', { n: fmtInt(b.biggestStake) })),
    figure(b.biggestWin ? `+${fmtInt(b.biggestWin)}` : '–', t('stats.betting.win')),
    figure(`${net > 0 ? '+' : net < 0 ? '−' : ''}${fmtInt(Math.abs(net))}`, t('stats.betting.net'), t('stats.betting.netNote')),
  );
}

/**
 * A fact as a card: its first figure large on top (a name, such as the power-up most placed, is no headline: its count is),
 * and the sentence below with its numbers set apart as in the ticker.
 */
function factItem(parts: FactPart[]): HTMLElement {
  const lead = parts.find((part) => part.number && !part.name);
  const text = h('p.st-fact__text', null, ...parts.map((part) => (part.number ? h('span.stats-ticker__number', null, part.text) : part.text)));
  return h('li.st-fact', null, ...(lead ? [h('strong.st-fact__lead', { 'aria-hidden': 'true' }, lead.text)] : []), text);
}

/** What the two pages share while the player switches between them: what the relay said, and what is picked. */
interface StatsState {
  board: StatsBoard;
  overview: StatsOverview | null;
  overviewFailed: boolean;
  facts: StatsFact[] | null;
  factsFailed: boolean;
  source: Source;
  metric: Metric;
  /** The page on display repaints itself when an answer comes in. */
  repaint: () => void;
}

function newState(): StatsState {
  const state: StatsState = { board: new StatsBoard(), overview: null, overviewFailed: false, facts: null, factsFailed: false, source: 'online', metric: 'rounds', repaint: () => {} };
  state.board.overview().then(
    (seen) => {
      state.overview = seen;
      state.repaint();
    },
    () => {
      state.overviewFailed = true;
      state.repaint();
    },
  );
  loadFacts(state.board).then(
    (seen) => {
      state.facts = seen;
      state.repaint();
    },
    () => {
      state.factsFailed = true;
      state.facts = [];
      state.repaint();
    },
  );
  return state;
}

/** The pages in the header, left to right: the games on the relay, the games on one device, and the facts. */
const PAGES = ['online', 'local', 'facts'] as const;
type Page = (typeof PAGES)[number];

/** The overview: figures, the year as a heatmap and as months and weekdays, the latest games, how the rounds are played, records and bets. */
function overviewBody(app: App, state: StatsState, status: HTMLElement): { body: HTMLElement; paint: () => void } {
  const strip = h('ol.st-kpis', null);
  const heat = card('heat', t('stats.heat.title'), h('div.items.st-metric', { 'data-section': 'metric' }));
  const trend = card('trend', t('stats.trend.title'));
  const games = card('games', t('stats.games'));
  const modes = card('modes', t('stats.modes.title'));
  const records = card('records', t('stats.records.title'));
  const betting = card('betting', t('stats.betting'));
  modes.meta.textContent = t('stats.modes.note');
  records.meta.textContent = t('stats.records.note');
  betting.meta.textContent = t('stats.betting.note');
  const map = heatmapView();
  heat.body.append(map.el);
  const gameList = h('ol.st-games', null);
  games.body.append(gameList);
  const grid = withTips(h('div.st', null, strip, heat.el, trend.el, games.el, modes.el, records.el, betting.el));

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
    state.board.replay(game.id).then((replay) => (!grid.isConnected ? undefined : replay ? app.watchReplay(replay) : failedToLoad()), () => grid.isConnected && failedToLoad());
  };

  let opened = false;
  const paint = (): void => {
    const o = state.overview;
    status.textContent = state.overviewFailed ? t('stats.failed') : !o ? t('stats.loading') : !o.enabled ? t('stats.off') : '';
    grid.hidden = !o?.enabled;
    if (!o?.enabled) return;
    hideTip();
    const local = state.source === 'local';
    const days = local ? o.localDays : o.days;
    strip.replaceChildren(...kpis(days));
    const total = map.show(days, state.metric);
    heat.meta.textContent = t('stats.heat.total', { n: metricCount(state.metric, total) });
    trend.meta.textContent = metricLabel(state.metric);
    trend.body.replaceChildren(h('h4.st-card__sub', null, t('stats.trend.months')), monthChart(days, state.metric), h('h4.st-card__sub', null, t('stats.trend.weekdays')), weekdayChart(days, state.metric));
    const shown = o.games.filter((game) => game.local === local).slice(0, 8);
    games.meta.textContent = t(local ? 'stats.source.local' : 'stats.source.online');
    gameList.replaceChildren(...(shown.length ? shown.map((game) => gameRow(game, watch)) : [h('li.st-none', null, t('stats.none'))]));
    // Each page counts its own games. A relay that keeps the facts only for all games together has them shown on both, as
    // before, from the menu's facts (which the menu has usually asked for already).
    const split = local ? o.localFacts : o.facts;
    const facts = split ?? state.facts ?? [];
    records.meta.textContent = split ? `${t(local ? 'stats.source.local' : 'stats.source.online')} · ${t('stats.records.note')}` : t('stats.records.note');
    const modeRows = modesView(facts);
    modes.body.replaceChildren(...modeRows);
    modes.el.hidden = !modeRows.length;
    const recordRows = recordsView(facts);
    records.body.replaceChildren(h('ul.st-records', null, ...recordRows));
    records.el.hidden = !recordRows.length;
    // Tips and bets come only from online games: the stands are on the relay.
    betting.el.hidden = local || !o.betting;
    if (!local && o.betting) betting.body.replaceChildren(bettingView(o.betting));
    grid.classList.toggle('st--sidecards', !modes.el.hidden || !records.el.hidden);
    // On a narrow screen the heatmap scrolls: it opens on today, the right-hand end.
    if (!opened) {
      opened = true;
      requestAnimationFrame(() => {
        const frame = map.el.querySelector('.hm__frame');
        if (frame) frame.scrollLeft = frame.scrollWidth;
      });
    }
  };
  return { body: grid, paint };
}

/** Every fact the statistics make, under a heading for what it is about. */
function factsBody(state: StatsState, status: HTMLElement): { body: HTMLElement; paint: () => void } {
  const body = h('div.st-factsPage', null);
  const paint = (): void => {
    const groups = state.facts ? factsByGroup(state.facts) : [];
    status.textContent = state.facts ? (groups.length ? '' : state.factsFailed ? t('stats.failed') : t('stats.facts.none')) : t('stats.loading');
    body.replaceChildren(
      ...groups.map(({ group, lines }) =>
        h(
          'section.st-group',
          null,
          h('h3.setup__title.st-group__title', null, t(`stats.group.${group}`), h('span.st-group__count', null, fmtInt(lines.length))),
          h('ol.st-facts', null, ...lines.map(factItem)),
        ),
      ),
    );
  };
  return { body, paint };
}

/** One page of the statistics; the header lists all of them, and the one shown is picked out. */
function statsPage(app: App, state: StatsState, view: Page, transition?: ModeTransition): Screen {
  const pageLabel = (which: Page): string => t(`stats.page.${which}`);
  let dispose = (): void => {};
  const changePage = (next: Page, direction: ModeTransition): void => {
    if (next === view) return;
    app.menu.replace(() => statsPage(app, state, next, direction));
  };
  // Q and E (or the arrows) step through the pages in the header, wrapping round at the ends.
  const step = (direction: ModeTransition): void => {
    const at = PAGES.indexOf(view);
    changePage(PAGES[(at + (direction === 'next' ? 1 : PAGES.length - 1)) % PAGES.length], direction);
  };
  const overview = view !== 'facts';

  return {
    build: () => {
      // The page itself says which games it shows: the online ones or those played on one device.
      if (overview) state.source = view === 'local' ? 'local' : 'online';
      const status = h('p.lb__status.st-status', { role: 'status' }, '');
      const content = overview ? overviewBody(app, state, status) : factsBody(state, status);
      const page = menuPage({
        title: `${t('stats.title')} · ${pageLabel(view)}`,
        eyebrow: t('stats.title'),
        headerTitle: pagePagerHeader(pageLabel(view), t('stats.switchPage'), transition),
        className: `menu-page--stats menu-page--mode-pager${transition ? ` menu-page--mode-enter-${transition}` : ''}`,
        body: [status, content.body],
        footer: h('div.items.items--row.menu-page__actions', { 'data-section': 'actions' }),
        keys: hintText('over.keys'),
      });
      state.repaint = () => {
        if (page.isConnected) content.paint();
      };
      content.paint();
      const stopCarousel = positionModeCarousel(page);
      const stopNavigation = enablePagerNavigation(page, step, '.hm__frame');
      dispose = () => {
        stopNavigation();
        stopCarousel();
        hideTip();
      };
      return page;
    },
    dispose: () => dispose(),
    items: [
      // As on the title's mode pager: the shown page comes first and the others follow it, the next one near and the last one far, so every page is in sight.
      ...PAGES.map((_, distance): MenuItem => {
        const which = PAGES[(PAGES.indexOf(view) + distance) % PAGES.length];
        return {
          kind: 'action',
          section: 'mode-pager',
          label: pageLabel(which),
          className: `mode-pager__item mode-pager__item--${distance === 0 ? 'active' : distance === 1 ? 'near' : 'far'}`,
          selected: () => which === view,
          run: () => changePage(which, distance === PAGES.length - 1 ? 'previous' : 'next'),
        };
      }),
      ...(overview
        ? ([
            {
              kind: 'segmented',
              section: 'metric',
              label: t('stats.metric'),
              options: METRICS.map((m) => ({ value: m, label: metricLabel(m) })),
              get: () => state.metric,
              set: (v) => {
                state.metric = v as Metric;
                state.repaint();
              },
            },
          ] satisfies MenuItem[])
        : []),
      { kind: 'action', section: 'actions', label: t('common.back'), primary: true, run: () => app.menu.back() },
    ],
  };
}

/** The statistics page, open to everyone: what it shows is anonymous, and the relay hands it to any client that asks. */
export const statsScreen = (app: App): Screen => statsPage(app, newState(), 'online');
