import { t, type Key } from '../../platform/i18n';
import type { TournamentMatch, TournamentView } from '../../net/net';
import { h } from '../menu/menu';
import { teamBadge, cupSvg } from './bracket';
import { stageName } from './setup';
import { tickerLines, type TickerLine, type TickerTeam } from './ticker';
import './arena.css';

/** What the arena can ask the page to do. */
export interface ArenaContext {
  view: TournamentView;
  /** Ticker lines newer than this came in since the arena was last drawn: they slide in. */
  seenUntil: number;
  enter(): void;
  watch(level: number, index: number): void;
}

interface Placed {
  level: number;
  index: number;
  match: TournamentMatch;
  /** Counted from the final (0). */
  stage: number;
  depth: number;
}

const EYE = '<path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/>';

function eyeIcon(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'ta-eye');
  svg.innerHTML = EYE;
  return svg;
}

/** Every match of the bracket with where it stands in it. */
function placed(view: TournamentView): Placed[] {
  const levels = view.bracket?.levels ?? [];
  return levels.flatMap((matches, level) => matches.map((match, index) => ({ level, index, match, stage: levels.length - 1 - level, depth: levels.length })));
}

/** Minutes and seconds, as a clock shows them. */
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

/** A team's name in its colour, with its emblem: how the arena names a team. */
function chip(team: { name: string; emblem: TickerTeam['emblem']; color: string }, mine = false): HTMLElement {
  const el = h(`span.ta-chip${mine ? '.is-mine' : ''}`, null, teamBadge(team), h('span.ta-chip__name', null, team.name));
  el.style.setProperty('--team', team.color);
  return el;
}

/** A sentence of the language file with nodes put in for its `{name}` places. */
function fill(template: string, parts: Record<string, Node | string>): (Node | string)[] {
  return template.split(/(\{\w+\})/).filter(Boolean).map((piece) => {
    const name = /^\{(\w+)\}$/.exec(piece)?.[1];
    return name && name in parts ? parts[name] : piece;
  });
}

const scoreText = (score: [number, number]) => h('span.ta-score', null, `${score[0]}:${score[1]}`);

/** Nothing to show yet, said as the room list says it: the radar, a title, and what will come. */
const empty = (title: string, hint: string, extra = '') => h(`div.lobby__empty${extra}`, null,
  h('span.lobby__empty-radar', { 'aria-hidden': 'true' }), h('strong', null, title), h('span', null, hint));

/** A section's head, as the room list's: its title with a count, and the line after it. */
const head = (title: string, count: number | null, extra = '') => h(`div.lobby__head.ta-head${extra}`, null,
  h('h3.setup__title', null, title, ...(count !== null ? [h('span.online-rooms__count', null, String(count))] : [])));

// ————————————————————————————— Live —————————————————————————————

/** Length of the pulsing live dot and round pip, `t-blink` in the stylesheet. */
const BLINK_MS = 1600;

/** The rounds as pips: played ones lit, the one under way pulsing, the rest dim; endless matches only count. */
function progress(round: number, total: number): HTMLElement {
  const label = total > 0 ? t('tournament.arena.round', { n: Math.min(round + 1, total), total }) : t('tournament.arena.roundEndless', { n: round + 1 });
  const pips = total > 0 && total <= 20
    ? h('span.ta-pips', { 'aria-hidden': 'true' }, ...Array.from({ length: total }, (_, i) =>
      h(`span.ta-pip${i < round ? '.is-played' : i === round ? '.is-now' : ''}`, null)))
    : null;
  return h('div.ta-progress', null, h('span.ta-progress__label', null, label), ...(pips ? [pips] : []));
}

/** A match being played: both teams, the points so far as a tug of war between their colours, its rounds, and a way in. */
function liveCard(ctx: ArenaContext, at: Placed): HTMLElement {
  const { view } = ctx;
  const { match } = at;
  const [a, b] = match.teams.map((team) => view.teams[team!]);
  const mine = view.you.team !== null && match.teams.includes(view.you.team);
  const score = match.live?.score ?? null;
  const round = match.live?.round ?? 0;
  const total = Number(view.settings.stages[at.stage]?.rules.rounds ?? 0);
  const ahead = score && score[0] !== score[1] ? (score[0] > score[1] ? 0 : 1) : null;
  // The share of the bar each side holds; points below nothing count as nothing.
  const [pa, pb] = score ? score.map((s) => Math.max(0, s)) : [0, 0];
  const share = pa + pb > 0 ? pa / (pa + pb) : 0.5;
  const side = (team: typeof a, i: 0 | 1) => h(`div.ta-side.ta-side--${i ? 'b' : 'a'}${ahead === i ? '.is-ahead' : ''}${view.you.team === match.teams[i] ? '.is-mine' : ''}`, null,
    teamBadge(team), h('span.ta-side__name', { title: team.name }, team.name),
    h('span.ta-side__score', null, score ? String(score[i]) : '–'));
  // A match the dev relay plays out itself has no game to go to.
  const go = match.simulated
    ? h('span.tb-flag', { 'data-key': 'go', title: t('tournament.arena.simulatedHint') }, t('tournament.arena.simulated'))
    : h(`button.tb-pill.${mine ? 'tb-pill--ready' : 'tb-pill--watch'}`, { type: 'button', 'data-key': `go:${mine ? 'mine' : 'watch'}:${at.level}:${at.index}` }, t(mine ? 'tournament.arena.backIn' : 'tournament.watch'));
  if (!match.simulated) go.addEventListener('click', () => (mine ? ctx.enter() : ctx.watch(at.level, at.index)));
  const card = h(`article.ta-live${mine ? '.is-mine' : ''}${at.stage === 0 ? '.is-final' : ''}`, { 'data-key': `live:${at.level}:${at.index}`, 'aria-label': `${stageName(at.stage, at.depth)}: ${a.name} – ${b.name}` },
    h('header.ta-live__head', null,
      h('span.tb-flag.tb-flag--live', null, t('tournament.live')),
      h('span.ta-live__stage', null, stageName(at.stage, at.depth)),
      ...(mine ? [h('span.ta-live__mine', null, t('tournament.arena.yours'))] : []),
      h('span.ta-live__watching', { title: t('tournament.watching', { n: match.watching }) }, eyeIcon(), String(match.watching))),
    h('div.ta-live__board', null, side(a, 0), h('span.ta-live__vs', { 'aria-hidden': 'true' }, 'vs'), side(b, 1)),
    h('div.ta-tug', { 'aria-hidden': 'true', style: `--share: ${(share * 100).toFixed(1)}%` }, h('span.ta-tug__a', null), h('span.ta-tug__b', null)),
    h('footer.ta-live__foot', null, progress(round, total), go),
  );
  card.style.setProperty('--a', a.color);
  card.style.setProperty('--b', b.color);
  return card;
}

// ————————————————————————————— Lists —————————————————————————————

/** A match as one line: its level, the pairing, and what is to say of it at the right. */
function matchLine(ctx: ArenaContext, at: Placed, end: (Node | string)[], winner: number | null = null): HTMLElement {
  const { view } = ctx;
  const name = (side: 0 | 1) => {
    const team = at.match.teams[side];
    if (team === null) return h('span.ta-chip.is-unknown', null, '?');
    const el = chip(view.teams[team], view.you.team === team);
    if (winner !== null) el.classList.add(team === winner ? 'is-winner' : 'is-loser');
    return el;
  };
  const mine = view.you.team !== null && at.match.teams.includes(view.you.team);
  return h(`li.ta-line${mine ? '.is-mine' : ''}`, { 'data-key': `line:${at.level}:${at.index}:${winner ?? ''}` },
    h('span.ta-line__stage', null, stageName(at.stage, at.depth)),
    h('span.ta-line__pair', null, name(0), h('span.ta-line__vs', null, 'vs'), name(1)),
    h('span.ta-line__end', null, ...end));
}

/** When this page first saw a match: the relay says how long it had waited then, and does not repeat it while nothing else changes. */
const seenAt = new WeakMap<TournamentMatch, number>();

/** How long a ready match has waited, counted on from when it was told. */
function waitedNow(match: TournamentMatch): number {
  const since = seenAt.get(match) ?? Date.now();
  seenAt.set(match, since);
  return (match.waited ?? 0) + Math.floor((Date.now() - since) / 1000);
}

function upNext(ctx: ArenaContext, ready: Placed[]): HTMLElement {
  return h('ul.ta-lines', null, ...ready.map((at) => {
    const end: (Node | string)[] = [];
    if (at.match.waited != null) end.push(h('span.ta-line__note.is-waiting', null, t('tournament.arena.waited', { t: clock(waitedNow(at.match)) })));
    if (at.match.room) {
      const watch = h('button.tb-pill.tb-pill--watch', { type: 'button', 'data-key': `watch:${at.level}:${at.index}` }, t('tournament.watch'));
      watch.addEventListener('click', () => ctx.watch(at.level, at.index));
      end.push(watch);
    }
    return matchLine(ctx, at, end);
  }));
}

function results(ctx: ArenaContext, done: Placed[]): HTMLElement {
  return h('ul.ta-lines', null, ...done.map((at) => {
    const { match } = at;
    const side = match.teams.indexOf(match.winner);
    const end = match.score
      ? [h('span.ta-score', null, `${match.score[0]}:${match.score[1]}`)]
      : [h('span.ta-line__note', null, t('tournament.arena.walkover'))];
    if (at.stage === 0 && side >= 0) end.unshift(h('span.ta-line__crown', { 'aria-hidden': 'true' }, cupSvg()));
    return matchLine(ctx, at, end, match.winner);
  }));
}

// ————————————————————————————— Ticker —————————————————————————————

const TICKER_KIND: Record<TickerLine['kind'], string> = {
  founded: 'info', joined: 'info', begun: 'big', started: 'live', round: 'round', won: 'result', withdrawn: 'warn', champion: 'big',
};

/** A ticker line in words, with the teams as chips. */
function tickerText(line: TickerLine): (Node | string)[] {
  const stage = 'stage' in line ? stageName(line.stage, line.depth) : '';
  const say = (key: Key, parts: Record<string, Node | string>) => fill(t(key), { stage, ...parts });
  switch (line.kind) {
    case 'founded': return say('tournament.ticker.founded', { a: chip(line.team) });
    case 'joined': return say('tournament.ticker.joined', { person: h('strong', null, line.person), a: chip(line.team) });
    case 'begun': return say('tournament.ticker.begun', { n: String(line.teams) });
    case 'started': return say('tournament.ticker.started', { a: chip(line.teams[0]), b: chip(line.teams[1]) });
    case 'round': return [
      ...say('tournament.ticker.round', { round: String(line.round), a: chip(line.teams[0]), score: scoreText(line.score), b: chip(line.teams[1]) }),
      ...(line.lead ? [h('span.ta-ticker__lead', null, ...fill(t('tournament.ticker.lead'), { a: chip(line.lead) }))] : []),
    ];
    case 'won': return line.score && line.loser
      ? say('tournament.ticker.won', { a: chip(line.winner), b: chip(line.loser), score: scoreText(line.score) })
      : say('tournament.ticker.walkover', { a: chip(line.winner) });
    case 'withdrawn': return say('tournament.ticker.withdrawn', { a: chip(line.team) });
    case 'champion': return say('tournament.ticker.champion', { a: chip(line.team) });
  }
}

function ticker(ctx: ArenaContext): HTMLElement {
  const lines = tickerLines(ctx.view.code);
  const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return h('aside.ta-ticker', { 'aria-label': t('tournament.arena.ticker') },
    head(t('tournament.arena.ticker'), lines.length || null),
    lines.length
      ? h('ol.ta-ticker__lines', { 'aria-live': 'polite' }, ...lines.map((line, i) => h(`li.ta-ticker__line.ta-ticker__line--${TICKER_KIND[line.kind]}${line.at > ctx.seenUntil ? '.is-new' : ''}`, { 'data-key': `tick:${line.at}:${line.kind}:${lines.slice(0, i).filter((l) => l.at === line.at && l.kind === line.kind).length}` },
        h('time.ta-ticker__time', { datetime: new Date(line.at).toISOString() }, time(line.at)),
        h('span.ta-ticker__text', null, ...tickerText(line)))))
      : empty(t('tournament.arena.tickerEmpty'), t('tournament.arena.tickerEmptyHint'), '.ta-empty--ticker'),
  );
}

// ————————————————————————————— The page —————————————————————————————

const section = (title: string, count: number | null, body: HTMLElement, extra = '') => h(`section.ta-section${extra}`, null, head(title, count), body);

/**
 * The tournament as it is played: the matches under way with how they stand, those waiting to start, the results so far, and a
 * ticker of everything that happened, for whoever waits for their next match or is out and stays to watch.
 */
export function arenaView(ctx: ArenaContext): HTMLElement {
  const { view } = ctx;
  // The arena is rebuilt on every update, which would restart each pulse from its start; a delay that follows the clock keeps them in phase.
  document.documentElement.style.setProperty('--blink-delay', `${-(performance.now() % BLINK_MS)}ms`);
  const all = placed(view);
  const own = (at: Placed) => (view.you.team !== null && at.match.teams.includes(view.you.team) ? 1 : 0);
  // Yours first, then the later levels: the final is what everybody wants to see.
  const live = all.filter((at) => at.match.state === 'playing').sort((x, y) => own(y) - own(x) || x.stage - y.stage || x.index - y.index);
  const ready = all.filter((at) => at.match.state === 'ready' && !at.match.bye).sort((x, y) => own(y) - own(x) || x.stage - y.stage);
  const done = all.filter((at) => at.match.state === 'done' && !at.match.bye).sort((x, y) => x.stage - y.stage || x.index - y.index);

  const main = h('div.ta-main', null);
  const champion = view.bracket?.champion;
  if (champion != null) {
    const team = view.teams[champion];
    const banner = h('div.ta-champion', null,
      h('span.ta-champion__cup', { 'aria-hidden': 'true' }, cupSvg()),
      h('div.ta-champion__text', null, h('span.t-label', null, t('tournament.championSub')), h('strong.ta-champion__name', null, team.name)),
      teamBadge(team));
    banner.style.setProperty('--team', team.color);
    main.append(banner);
  }
  if (view.phase !== 'finished') {
    const nothing = view.phase === 'registration'
      ? empty(t('tournament.arena.notStarted'), t('tournament.arena.notStartedHint'))
      : empty(t('tournament.arena.quiet'), t(ready.length ? 'tournament.arena.quietReady' : 'tournament.arena.quietHint'), '.is-searching');
    main.append(section(t('tournament.arena.liveHead'), live.length,
      live.length ? h('div.ta-live-grid', null, ...live.map((at) => liveCard(ctx, at))) : nothing, '.ta-section--live'));
  }
  if (ready.length) main.append(section(t('tournament.arena.next'), ready.length, upNext(ctx, ready)));
  if (done.length) main.append(section(t('tournament.arena.results'), done.length, results(ctx, done)));
  return h('div.ta', null, main, ticker(ctx));
}
