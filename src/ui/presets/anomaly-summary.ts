import { ANOMALY_COLORS, drawAnomalySymbol } from '../../render/anomaly-art';
import { t } from '../../platform/i18n';
import type { Anomaly } from '../../sim/config';
import { h } from '../dom';
import { groupTitle } from '../menu/rules';
import { attachTooltip } from '../menu/tooltip';

/** The anomalies in play, as small red tiles under the power-ups, like the power-ups' own; there is nothing to show (and no room taken) while there are none. */
export function anomalySummary(getAnomalies: () => readonly Anomaly[]): { el: HTMLElement; update: () => void } {
  const list = h('ul.briefing__anomaly-list', null);
  const el = h('div.briefing__anomalies', { role: 'group', 'aria-label': groupTitle('anomalies'), hidden: '' },
    h('span.briefing__anomalies-label', null, groupTitle('anomalies')),
    list,
  );
  let shown: string | undefined;
  const update = (): void => {
    const active = getAnomalies();
    el.hidden = !active.length;
    const key = active.join('|');
    if (key === shown) return;
    shown = key;
    list.replaceChildren(...active.map(anomalyChip));
  };
  update();
  return { el, update };
}

function anomalyChip(anomaly: Anomaly): HTMLElement {
  const size = 28;
  const dpr = typeof devicePixelRatio === 'number' ? Math.max(1, devicePixelRatio) : 1;
  const canvas = h('canvas.briefing__anomaly-icon', { width: String(Math.round(size * dpr)), height: String(Math.round(size * dpr)), 'aria-hidden': 'true' }) as HTMLCanvasElement;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.scale(dpr, dpr);
    ctx.strokeStyle = ctx.fillStyle = ANOMALY_COLORS[anomaly];
    ctx.lineWidth = 1.8;
    ctx.lineCap = ctx.lineJoin = 'round';
    drawAnomalySymbol(ctx, anomaly, size / 2, size / 2, 8.5);
  }
  const name = t(`anomaly.${anomaly}`);
  const chip = h('li.briefing__anomaly', { tabindex: '0', 'aria-label': name }, canvas);
  chip.style.setProperty('--anomaly-tone', ANOMALY_COLORS[anomaly]);
  attachTooltip(chip, t(`anomaly.${anomaly}.hint`), 0, name);
  return chip;
}
