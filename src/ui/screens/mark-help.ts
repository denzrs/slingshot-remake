import { SCORING } from '../../sim/config';
import { t } from '../../platform/i18n';
import type { MarkKind, Match } from '../../game';
import { markName, visibleMarks } from '../../game/markLegend';
import { MARK_COLORS, markIcon } from '../../render/mark-art';
import { h } from '../menu/menu';

/** What a mark means, with the numbers of the rules in it. */
export function markText(kind: MarkKind): string {
  const points: Record<MarkKind, number> = {
    bounty: 0,
    shutdown: SCORING.SHUTDOWN_PER_KILL,
    comeback: SCORING.COMEBACK,
    revenge: SCORING.REVENGE,
    domination: SCORING.DOMINATION,
    avenger: SCORING.AVENGER,
    underdog: SCORING.UNDERDOG_MAX,
    firstBlood: SCORING.FIRST_BLOOD,
    opener: SCORING.OPENER,
    chain: SCORING.MULTI_KILL[2],
  };
  return t(`marks.${kind}.text`, {
    points: points[kind],
    max: points[kind],
    // Revenge doubles after the full run; domination is the run of rounds before the one that pays.
    rounds: kind === 'domination' ? SCORING.DOMINATION_ROUNDS - 1 : SCORING.DOMINATION_ROUNDS,
    second: SCORING.MULTI_KILL[2],
    fifth: SCORING.MULTI_KILL[5],
  });
}

/**
 * The pause menu's explanation of the symbols that are on the cards right now, beside the standings: what each means and on whose
 * card it stands. Null while no marks show. Built from the marks as they were when the game was paused.
 */
export function marksLegend(match: Match): HTMLElement | null {
  const marks = visibleMarks(match);
  if (!marks.length) return null;
  return h('aside.pause-marks', { 'aria-label': t('marks.title') },
    h('p.ranking-label', null, t('marks.title')),
    h('ul.mark-legend', null, ...marks.map(({ kind, on }) => {
      const where = on.map((card) => (card.own ? t('marks.yours') : `${card.name}${kind === 'comeback' ? '' : ` +${card.points}`}`)).join(' · ');
      return h('li.mark-legend__item', null,
        h('div.mark-legend__icon', null, markIcon(kind, 26)),
        h('div', null,
          h('h4', null, h('span', { style: `color: ${MARK_COLORS[kind]}` }, markName(kind)), h('span.mark-legend__where', null, where)),
          h('p', null, markText(kind)),
        ),
      );
    })),
  );
}
