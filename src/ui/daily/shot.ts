import type { ShotReplay } from '../../game';
import { fmtInt, t } from '../../platform/i18n';
import type { ShotOfDay } from '../../net/net';
import { COLORS } from '../../sim/config';
import { h, type Screen } from '../menu/menu';
import { menuPage } from '../menu/menu-page';
import type { App } from '../screens';
import { matchShotTrail } from '../screens/match-moments';
import { formatDay } from './dayFormat';

const pointsOf = (shot: ShotOfDay): string => `+${fmtInt(shot.points)}`;

/** The shot of the day, small: its path as on the end-of-match card, who fired it and what it paid. */
export function shotOfDayPreview(shot: ShotOfDay): Element[] {
  const end = { x: shot.trail[shot.trail.length - 2], y: shot.trail[shot.trail.length - 1] };
  const label = `${t('daily.shot.title')} · ${shot.name}`;
  return [
    h('h3.ranking-label', null, t('daily.shot.title')),
    matchShotTrail({ trail: shot.trail, at: end }, COLORS.sodium, label),
    h('div.daily-shot__caption', null,
      h('span.daily-shot__who', null, shot.name),
      h('span.daily-shot__points', null, pointsOf(shot)),
      h('span.daily-shot__where', null, t('daily.sector', { n: shot.sector + 1 })),
    ),
  ];
}

/** The shot has flown: who fired it and what it paid, to watch it again or go back to the challenge. */
export function shotReplayScreen(app: App, match: ShotReplay): Screen {
  const { shot, challenge } = match;
  return {
    build: () => menuPage({
      title: t('daily.shot.title'), eyebrow: formatDay(challenge.dateKey), className: 'menu-page--daily-result',
      body: [
        h('p.daily__score', null, h('span.daily__num', null, pointsOf(shot)), h('span.daily__unit', null, t('daily.result.points'))),
        h('p.daily__meta', null, `${shot.name}  ·  ${t('daily.sector', { n: shot.sector + 1 })}`),
      ],
    }),
    items: [
      { kind: 'action', label: t('daily.shot.back'), run: () => app.leaveReplay() },
      { kind: 'action', label: t('replay.again'), primary: true, run: () => app.watchAgain() },
    ],
    focus: 1,
    // Leaving puts the challenge's page back: Esc is spent, the menu must not pop that page too.
    onEscape: () => { app.leaveReplay(); return true; },
  };
}
