import { COLORS, TEAMS } from '../../sim/config';
import { ChallengeMatch, teamName, type Match } from '../../game';
import { fmtInt, t, tn } from '../../platform/i18n';
import { h, type MenuItem, type Screen } from '../menu/menu';
import { menuPage } from '../menu/menu-page';
import { modeName } from '../menu/mode-name';
import type { App } from './app';
import { scoreChart } from './game-over';
import { settingsScreen } from './settings';
import { prepareModeScreen } from './setup';

const skipAnswerItems = (app: App, section?: string): MenuItem[] => [
  { kind: 'action', ...(section ? { section } : {}), label: t('skip.yes'), primary: true, run: () => (app.answerSkip(true), app.resume()) },
  { kind: 'action', ...(section ? { section } : {}), label: t('skip.no'), run: () => (app.answerSkip(false), app.resume()) },
];

/** What a touch screen shows when the host has called a vote to skip the round: the answer, without hunting for a key. */
export function skipVoteScreen(app: App): Screen {
  return {
    build: () => menuPage({ title: t('skip.banner'), eyebrow: t('pause.title'), body: [] }),
    items: skipAnswerItems(app),
    onEscape: () => app.resume(),
  };
}

export function pauseScreen(app: App, match: Match | null): Screen {
  if (app.replaying) {
    const items: MenuItem[] = [
      { kind: 'action', section: 'actions', label: t('replay.back'), run: () => app.leaveReplay() },
      { kind: 'action', section: 'actions', label: t('common.settings'), run: () => app.menu.push(() => settingsScreen(app)) },
      { kind: 'action', section: 'actions', label: t('replay.again'), run: () => app.watchAgain() },
      { kind: 'action', section: 'actions', label: t('pause.resume'), primary: true, run: () => app.resume() },
    ];
    return {
      build: () => menuPage({
        title: t('replay.title'), eyebrow: t('pause.title'), className: 'menu-page--pause', body: [],
        footer: h('nav.items.items--row.pause-actions.menu-page__actions', { 'data-section': 'actions', 'aria-label': t('pause.title') }),
      }),
      items,
      focus: items.length - 1,
      onEscape: () => app.resume(),
    };
  }
  // Online the host can stop the game for everybody; offline, opening the menu already does.
  const hostPause = app.online && !!match?.canAdvance;
  const daily = app.mode === 'challenge';
  const mode = app.mode === 'classic' || app.mode === 'solar' || app.mode === 'horizon' ? app.mode : null;
  // The way on is the last button, at the right edge, where the eye ends up.
  const items: MenuItem[] = [
    // Online, the room decides: no restarts from the pause menu. The daily challenge has no setup, only a retry.
    ...(mode && !app.online ? [{ kind: 'action', section: 'actions', label: t('pause.newGame'), run: () => app.menu.push(prepareModeScreen(app, mode)) } satisfies MenuItem] : []),
    ...(daily ? [{ kind: 'action', section: 'actions', label: t('daily.retry'), run: () => app.rematch() } satisfies MenuItem] : []),
    ...(app.skipOffer === 'skip' || app.skipOffer === 'call'
      ? [{ kind: 'action', section: 'actions', label: t(app.skipOffer === 'skip' ? 'skip.action' : 'skip.call'), run: () => app.skipRound() } satisfies MenuItem]
      : []),
    ...(app.skipOffer === 'answer' ? skipAnswerItems(app, 'actions') : []),
    { kind: 'action', section: 'actions', label: t('common.settings'), run: () => app.menu.push(() => settingsScreen(app)) },
    app.online
      ? { kind: 'action', section: 'actions', label: t('multiplayer.leave'), run: () => app.leaveOnlineRoom() }
      : { kind: 'action', section: 'actions', label: t('common.mainMenu'), run: () => app.toTitle() },
    ...(hostPause && !match!.pause ? [{ kind: 'action', section: 'actions', label: t('pause.pause'), run: () => (match!.pauseGame(), app.resume()) } satisfies MenuItem] : []),
    hostPause && match!.pause?.resumeIn === null
      ? { kind: 'action', section: 'actions', label: t('pause.resumeGame'), primary: true, run: () => (match!.resumeGame(), app.resume()) }
      : { kind: 'action', section: 'actions', label: t('pause.resume'), primary: true, run: () => app.resume() },
  ];
  return {
    build: () => menuPage({
      title: t('pause.title'), eyebrow: app.mode === 'challenge' ? t('mode.daily') : `${modeName(app.mode === 'horizon' || app.mode === 'solar' ? app.mode : 'classic')}${app.mayhem ? ` · ${t('mode.mayhem')}` : ''}`,
      className: 'menu-page--pause',
      body: match ? [h('div.pause-standing', null, ...pauseStanding(match, app.online))] : [],
      footer: h('nav.items.items--row.pause-actions.menu-page__actions', { 'data-section': 'actions', 'aria-label': t('pause.title') }),
    }),
    items,
    focus: items.length - 1,
    onEscape: () => app.resume(),
  };
}

/** The pause menu's middle: where the match stands right now. */
function pauseStanding(match: Match, online: boolean): Node[] {
  const row = (place: number, name: string, color: string, score: number | string) => {
    const label = h('span.ranking__name', null, name);
    label.style.color = color;
    return h('li', null, h('span.ranking__place', null, `${place}.`), label, h('span.ranking__score', null, String(score)));
  };
  if (match instanceof ChallengeMatch) {
    return [
      h('p.ranking-label', null, t('pause.standings')),
      h('p.pause-standing__round', null, t('daily.sector', { n: match.spec.index + 1 })),
      h('p.pause-standing__score', null, fmtInt(match.total)),
      h('p.pause-standing__meta', null, tn('daily.shots', match.shotsLeft)),
    ];
  }
  const nodes: Node[] = [h('p.ranking-label', null, t('pause.standings'))];
  nodes.push(h('p.pause-standing__round', null, match.totalRounds ? `${t('hud.round')} ${match.round} / ${match.totalRounds}` : `${t('hud.round')} ${match.round}`));
  if (match.teamMode) {
    nodes.push(h('ol.ranking', null, ...match.teamRanking().map((r, i) => row(i + 1, t('team.name', { team: teamName(r.team) }), TEAMS[r.team][0], r.score))));
    nodes.push(h('p.ranking-label', null, t('over.players')));
    nodes.push(h('ol.ranking.ranking--small', null, ...match.ranking().map((p, i) => row(i + 1, p.name, p.color, p.score))));
  } else {
    nodes.push(h('ol.ranking', null, ...match.ranking().map((p, i) => row(i + 1, p.name, p.color, p.score))));
  }
  if (online && match.oracleEnabled && match.canSeeOracle) {
    const oracle = match.betOracle;
    const ranking = oracle.ranking().slice(0, 3);
    nodes.push(h('p.ranking-label', null, t('pause.oracleTitle')));
    if (ranking.length) {
      nodes.push(h('ol.ranking.ranking--small.pause-oracle-ranking', null, ...ranking.map(({ player, score }, i) => {
        const person = match.tipster(player);
        return row(i + 1, person?.name ?? '?', person?.color ?? COLORS.bone, `${fmtInt(score.points)} · ${score.right}/${score.total}`);
      })));
    } else {
      nodes.push(h('p.pause-standing__meta', null, t('pause.oracleEmpty')));
    }
    if (match.bettingOn) {
      const settled = oracle.roundResult?.round === match.round ? oracle.roundResult.tips : null;
      const staked = settled
        ? settled.reduce((sum, tip) => sum + (tip.stake ?? 0), 0)
        : oracle.pot;
      const returned = settled?.reduce((sum, tip) => sum + (tip.payout ?? 0), 0) ?? 0;
      const bets = settled ? settled.filter((tip) => !!tip.stake).length : oracle.stakes.size;
      const betSummary = settled
        ? t('pause.oracleBetsSettled', { stake: fmtInt(staked), returned: fmtInt(returned) })
        : tn('pause.oracleBets', bets, { pot: fmtInt(staked) });
      nodes.push(h('p.pause-standing__meta.pause-oracle-bets', null, betSummary));
    }
  }
  const chart = scoreChart(match);
  if (chart) nodes.push(h('p.ranking-label', null, t('scorecard.history')), chart);
  return nodes;
}
