import { COLORS, TEAMS } from '../../config';
import { teamName, type Match } from '../../game';
import { oracleAwards } from '../../game/oracle';
import { fmtInt, t, tn } from '../../i18n';
import { roundTitle } from '../../mayhem';
import { awardLabel, awardValue, awardWho } from '../../scorecard';
import { awards, type Award } from '../../stats';
import { h, type MenuItem, type Screen } from '../menu';
import { menuPage } from '../menu-page';
import type { App } from './app';
import { enablePagerNavigation, pagePagerHeader, positionModeCarousel, type ModeTransition } from './mode-pager';

type ResultPage = 'result' | 'stats';

export function gameOverScreen(app: App, match: Match, view: ResultPage = 'result', transition?: ModeTransition): Screen {
  const winner = match.winner();
  const headline = !winner ? t('over.draw') : match.teamMode ? t('over.teamWins', { team: winner.name }) : t('over.wins', { name: winner.name });
  const records = awards(match.matchStats);
  const featured = records.find((award) => award.kind === 'bestHit' && award.trail && award.trail.length >= 4)
    ?? records.find((award) => award.trail && award.trail.length >= 4)
    ?? records[0];
  const entry = (place: number, name: string, color: string, score: number | string, player?: number) => {
    const label = h('span.ranking__name', null, name);
    label.style.color = color;
    const row = h('li', null, h('span.ranking__place', null, `${place}.`), label, h('span.ranking__score', null, typeof score === 'number' ? fmtInt(score) : score));
    row.style.setProperty('--player', color);
    if (player !== undefined && match.viewer === player) label.append(h('span.result-standing__you', null, t('over.you')));
    return row;
  };
  const playerRanking = () => h('ol.ranking', null, ...match.ranking().map((p, i) => entry(i + 1, p.name, p.color, p.score, p.id)));
  const teamRanking = () => h('ol.ranking', null, ...match.teamRanking().map((r, i) => entry(i + 1, t('team.name', { team: teamName(r.team) }), TEAMS[r.team][0], r.score)));
  const section = (title: string, ...content: Node[]) => h('section.report-section', null, h('h3.ranking-label', null, title), ...content);
  let page: HTMLElement;
  let disposeCarousel = (): void => {};
  const other: ResultPage = view === 'result' ? 'stats' : 'result';
  const pageLabel = (which: ResultPage) => t(which === 'result' ? 'over.result' : 'over.stats');
  const changePage = (next: ResultPage, direction: ModeTransition): void => {
    if (next === view) return;
    // A page shortcut keeps the footer action the player was about to use in focus.
    const actions = [...page.querySelectorAll('.menu-page__actions > button')];
    const action = actions.findIndex((button) => button === document.activeElement);
    app.menu.replace(() => gameOverScreen(app, match, next, direction), action < 0 ? 0 : action + 2);
  };
  return {
    build: () => {
      const lists: Element[] = [];
      // Team totals are on Result; keep the individual breakdown here for team matches.
      if (match.teamMode) lists.push(section(t('over.players'), playerRanking()));
      const chart = scoreChart(match);
      if (chart) lists.push(section(t('scorecard.history'), chart));
      // Mayhem: what every round was about and who took it.
      if (match.mayhemHistory.length) lists.push(section(t('mayhem.recap'), h('ul.highlights', null, ...roundRecap(match))));
      // The match's records, e.g. the longest shot of all rounds.
      const highlights = records.map((award) => {
        const who = awardWho(match, award);
        const name = h('span.highlights__who', null, who.name);
        name.style.color = who.color;
        const row = h('li.match-highlight', null, h('span.highlights__label', null, awardLabel(award.kind)), name, h('span.highlights__value', null, awardValue(award)));
        if (award.trail && award.trail.length >= 4) row.append(matchShotTrail(award, who.color, `${awardLabel(award.kind)} · ${who.name}`));
        return row;
      });
      // The stands play the same game: whoever read the rounds best.
      const seers = match.stands.ranking();
      if (seers.length) {
        const rows = seers.slice(0, 10).map(({ player, score }, i) => entry(i + 1, match.crowd.seat(player)?.name ?? '?', COLORS.bone, `${fmtInt(score.points)}  ·  ${score.right}/${score.total}`));
        lists.push(section(t('stands.standings'), h('ol.ranking.ranking--small', null, ...rows)));
      }
      // The eliminated players' side standings.
      const tipsters = match.oracle.ranking();
      if (tipsters.length) {
        const rows = tipsters.map(({ player, score }, i) => entry(i + 1, match.players[player].name, match.players[player].color, `${fmtInt(score.points)}  ·  ${score.right}/${score.total}`));
        lists.push(section(t('oracle.match'), h('ol.ranking.ranking--small', null, ...rows)));
        // Their honours: the prophet, the seer, the lone wolf …
        const honours = oracleAwards(match.oracle.scores, 'match').flatMap((award) => {
          const who = match.players[award.player];
          if (!who) return [];
          const name = h('span.highlights__who', null, who.name);
          name.style.color = who.color;
          return [h('li', null, h('span.highlights__label', null, t(`oracle.award.${award.kind}`)), name, h('span.highlights__value', null, t(`oracle.awardValue.${award.kind}`, { n: award.value })))];
        });
        if (honours.length) lists.push(section(t('oracle.awards'), h('ul.highlights', null, ...honours)));
      }
      const standings = h(`section.result-standing${winner ? '.result-standing--decided' : ''}`, null,
        h('h3.result-standing__winner', null, headline),
        h('p.ranking-label', null, t(match.teamMode ? 'over.teams' : 'over.standings')),
        match.teamMode ? teamRanking() : playerRanking(),
      );
      page = menuPage({
        title: `${pageLabel(view)} · ${headline}`, eyebrow: t('over.label'), intro: tn('over.after', match.round),
        headerTitle: pagePagerHeader(pageLabel(view), t('over.switchPage'), transition),
        className: `menu-page--results menu-page--mode-pager${transition ? ` menu-page--mode-enter-${transition}` : ''}`,
        body: view === 'result'
          ? [h(`div.result-overview${featured ? '' : '.result-overview--quiet'}`, null, standings,
              ...(featured ? [matchSpotlight(match, featured)] : []))]
          : [h('div.match-report', null,
              ...(highlights.length ? [section(t('scorecard.match'), h('ul.highlights.match-records', null, ...highlights))] : []),
              ...(lists.length ? [h('div.match-report__details', null, ...lists)] : []),
              ...(!highlights.length && !lists.length ? [h('p.note', null, t('over.noStats'))] : []),
            )],
        footer: h('div.items.items--row.menu-page__actions', { 'data-section': 'actions' }),
        keys: t('over.keys'),
      });
      if (winner) page.style.setProperty('--winner', winner.color);
      const stopCarousel = positionModeCarousel(page);
      const stopNavigation = enablePagerNavigation(page, (direction) => changePage(other, direction));
      disposeCarousel = () => { stopNavigation(); stopCarousel(); };
      return page;
    },
    dispose: () => disposeCarousel(),
    update: () => {
      page.querySelectorAll('.mode-pager button').forEach((button) => {
        if (button.classList.contains('is-selected')) button.setAttribute('aria-current', 'page');
        else button.removeAttribute('aria-current');
      });
    },
    items: [
      ...[view, other].map((which, i): MenuItem => ({
        kind: 'action', section: 'mode-pager', label: pageLabel(which),
        className: `mode-pager__item mode-pager__item--${i === 0 ? 'active' : 'near'}`,
        selected: () => which === view,
        run: () => changePage(which, which === 'stats' ? 'next' : 'previous'),
      })),
      ...(match.replaying
      ? [
          { kind: 'action', section: 'actions', label: t('replay.back'), run: () => app.leaveReplay() },
          { kind: 'action', section: 'actions', label: t('replay.again'), primary: true, run: () => app.watchAgain() },
        ] satisfies MenuItem[]
      : [
          app.online
            ? { kind: 'action', section: 'actions', label: t('multiplayer.leave'), run: () => app.leaveOnlineRoom() }
            : { kind: 'action', section: 'actions', label: t('common.mainMenu'), run: () => app.toTitle() },
          match.canAdvance
            ? { kind: 'action', section: 'actions', label: t('over.rematch'), primary: true, run: () => app.rematch() }
            : { kind: 'action', section: 'actions', label: t('over.rematch'), hint: t('over.hostRematch'), disabled: true, run: () => {} },
        ] satisfies MenuItem[]),
    ],
    focus: 3,
    onEscape: () => (match.replaying ? app.leaveReplay() : app.online ? app.leaveOnlineRoom() : app.toTitle()),
  };
}

/** One real match record gets the space of a mode illustration on the result page. */
function matchSpotlight(match: Match, award: Award): HTMLElement {
  const who = awardWho(match, award);
  const name = h('span.result-spotlight__who', null, who.name);
  name.style.color = who.color;
  const hasTrail = !!award.trail && award.trail.length >= 4;
  const card = h('section.result-spotlight', null,
    h('h3.ranking-label', null, t('over.spotlight')),
    ...(hasTrail ? [matchShotTrail(award, who.color, `${awardLabel(award.kind)} · ${who.name}`, true)] : []),
    h('div.result-spotlight__caption', null,
      h('div', null, h('p.result-spotlight__label', null, awardLabel(award.kind)), name),
      h('p.result-spotlight__value', null, awardValue(award)),
    ),
  );
  card.style.setProperty('--record', who.color);
  if (!hasTrail) card.classList.add('result-spotlight--number');
  return card;
}

/** The match record's saved path, drawn across as a small, replay-like trajectory highlight. */
function matchShotTrail(award: Award, color: string, label: string, featured = false): SVGSVGElement {
  const points = award.trail!;
  const size = featured ? 640 : 320;
  const height = featured ? 270 : 100;
  const pad = featured ? 30 : 12;
  const xs = points.filter((_, i) => i % 2 === 0);
  const ys = points.filter((_, i) => i % 2 === 1);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const scale = Math.min((size - pad * 2) / spanX, (height - pad * 2) / spanY);
  const project = (x: number, y: number): [number, number] => [
    (size - spanX * scale) / 2 + (x - minX) * scale,
    (height + spanY * scale) / 2 - (y - minY) * scale,
  ];
  const point = (i: number) => project(points[i], points[i + 1]);
  const pathData = Array.from({ length: points.length / 2 }, (_, i) => {
    const [x, y] = point(i * 2);
    return `${i ? 'L' : 'M'}${x},${y}`;
  }).join(' ');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'match-highlight__trail');
  svg.setAttribute('viewBox', `0 0 ${size} ${height}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', label);
  const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
  title.textContent = label;
  svg.append(title);
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('class', 'match-highlight__path');
  path.setAttribute('d', pathData);
  path.setAttribute('pathLength', '1');
  path.setAttribute('stroke', color);
  svg.append(path);
  if (award.at) {
    const [x, y] = project(award.at.x, award.at.y);
    const mark = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    mark.setAttribute('class', 'match-highlight__event');
    mark.setAttribute('cx', String(x));
    mark.setAttribute('cy', String(y));
    mark.setAttribute('r', featured ? '12' : '6');
    mark.setAttribute('stroke', color);
    svg.append(mark);
  }
  const [startX, startY] = point(0);
  if (featured) {
    const [nextX, nextY] = point(2);
    const ship = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    const angle = Math.atan2(nextY - startY, nextX - startX) * 180 / Math.PI;
    ship.setAttribute('d', 'M 8 0 L -6 -5 L -3 0 L -6 5 Z');
    ship.setAttribute('transform', `translate(${startX} ${startY}) rotate(${angle})`);
    ship.setAttribute('fill', color);
    svg.append(ship);
  }
  const start = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  start.setAttribute('class', 'match-highlight__start');
  start.setAttribute('cx', String(startX));
  start.setAttribute('cy', String(startY));
  start.setAttribute('r', '2');
  if (!featured) svg.append(start);
  const [endX, endY] = point(points.length - 2);
  const end = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  end.setAttribute('class', 'match-highlight__end');
  end.setAttribute('cx', String(endX));
  end.setAttribute('cy', String(endY));
  end.setAttribute('r', '3');
  end.setAttribute('fill', color);
  svg.append(end);
  return svg;
}

/** One line per round of a Mayhem match: its twists, and whoever scored most in it. */
function roundRecap(match: Match): Element[] {
  return match.mayhemHistory.map((round, i) => {
    const before = match.scoreHistory[i] ?? [];
    const after = match.scoreHistory[i + 1] ?? [];
    let best = -1;
    let gain = 0;
    match.players.forEach((_p, id) => {
      const delta = (after[id] ?? 0) - (before[id] ?? 0);
      if (delta > gain) {
        best = id;
        gain = delta;
      }
    });
    const winner = best >= 0 ? match.players[best] : null;
    const who = h('span.highlights__who', null, winner?.name ?? '');
    if (winner) who.style.color = winner.color;
    return h('li', null, h('span.highlights__label', null, `${i + 1}. ${roundTitle(round)}`), who, h('span.highlights__value', null, winner ? `+${fmtInt(gain)}` : ''));
  });
}

/** Everybody's score after every round as lines, so you can see who caught up when. Needs at least two rounds. */
export function scoreChart(match: Match): SVGElement | null {
  const history = match.scoreHistory;
  if (history.length < 3) return null;
  const W = 340;
  const H = 96;
  const pad = 8;
  const scores = history.flat();
  const lo = Math.min(0, ...scores);
  const hi = Math.max(0, ...scores);
  const x = (round: number) => pad + (round / (history.length - 1)) * (W - 2 * pad);
  const y = (score: number) => H - pad - ((score - lo) / (hi - lo || 1)) * (H - 2 * pad);
  const el = (tag: string, attrs: Record<string, string>): SVGElement => {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
    return node as SVGElement;
  };
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'score-chart', role: 'img', 'aria-label': t('scorecard.history') });
  svg.append(el('line', { x1: String(pad), x2: String(W - pad), y1: String(y(0)), y2: String(y(0)), class: 'score-chart__zero' }));
  // Leaders last, so their lines are on top.
  for (const p of [...match.players].sort((a, b) => a.score - b.score)) {
    const points = history.map((row, round) => `${x(round).toFixed(1)},${y(row[p.id] ?? 0).toFixed(1)}`);
    svg.append(
      el('polyline', { points: points.join(' '), fill: 'none', stroke: p.color, 'stroke-width': '2', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }),
      el('circle', { cx: String(x(history.length - 1)), cy: String(y(history[history.length - 1][p.id] ?? 0)), r: '3', fill: p.color }),
    );
  }
  return svg;
}
