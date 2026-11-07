import { ANOMALY_COLORS, drawAnomalySymbol } from '../../render/anomaly-art';
import { MAYHEM } from '../../sim/config';
import { t } from '../../platform/i18n';
import type { Match } from '../../game';
import { twistName } from '../../game/mayhem';
import { h } from '../menu/menu';
import { groupTitle } from '../menu/rules';
import { attachTooltip } from '../menu/tooltip';
import type { Anomaly } from '../../sim/config';

/**
 * The pause menu's reminder of what bends the rules right now: the anomalies in play and, in Mayhem, the twists of this round.
 * Just their badges; what each does shows while the pointer or the focus is on it. Null when nothing bends them.
 */
export function rulesBadges(match: Match): HTMLElement | null {
  const anomalies = match.settings.anomalies ?? [];
  const round = match.mayhem;
  if (!anomalies.length && !round) return null;
  const blocks: HTMLElement[] = [];
  if (anomalies.length) {
    blocks.push(h('div.pause-rules__block.pause-rules__block--anomalies', null,
      h('p.ranking-label', null, groupTitle('anomalies')),
      h('ul.pause-rules__list', null, ...anomalies.map(anomalyBadge)),
    ));
  }
  if (round) {
    const twists = round.twists.map((twist) => badge(twistName(twist), t(`mayhem.twist.${twist.id}.info`, { n: twist.n ?? 0 })));
    if (!twists.length) twists.push(badge(t('mayhem.quiet'), t('mayhem.quietInfo')));
    if (round.jackpot) twists.push(badge(t('mayhem.jackpot', { n: MAYHEM.JACKPOT_FACTOR }), t('mayhem.jackpotInfo')));
    blocks.push(h('div.pause-rules__block', null,
      h('p.ranking-label', null, t('mode.mayhem')),
      h('ul.pause-rules__list', null, ...twists),
    ));
  }
  return h('aside.pause-rules', null, ...blocks);
}

function badge(name: string, info: string, ...before: Node[]): HTMLElement {
  const item = h('li.pause-rules__badge', { tabindex: '0' }, ...before, h('span', null, name));
  attachTooltip(item, info, 0, name);
  return item;
}

function anomalyBadge(anomaly: Anomaly): HTMLElement {
  const size = 18;
  const dpr = typeof devicePixelRatio === 'number' ? Math.max(1, devicePixelRatio) : 1;
  const canvas = h('canvas.pause-rules__icon', { width: String(Math.round(size * dpr)), height: String(Math.round(size * dpr)), 'aria-hidden': 'true' }) as HTMLCanvasElement;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.scale(dpr, dpr);
    ctx.strokeStyle = ctx.fillStyle = ANOMALY_COLORS[anomaly];
    ctx.lineWidth = 1.7;
    ctx.lineCap = ctx.lineJoin = 'round';
    drawAnomalySymbol(ctx, anomaly, size / 2, size / 2, 7);
  }
  const item = badge(t(`anomaly.${anomaly}`), t(`anomaly.${anomaly}.hint`), canvas);
  item.classList.add('pause-rules__badge--anomaly');
  item.style.setProperty('--badge-tone', ANOMALY_COLORS[anomaly]);
  return item;
}
