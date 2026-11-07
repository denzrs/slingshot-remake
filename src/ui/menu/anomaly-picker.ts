import { t } from '../../platform/i18n';
import { ANOMALY_COLORS, drawAnomalySymbol } from '../../render/anomaly-art';
import type { Anomaly } from '../../sim/config';
import { h } from './menu';
import { groupTitle } from './rules';

export interface AnomalyPicker {
  /** The sheet over the page the tiles open in; the page puts it on itself. */
  layer: HTMLElement;
  /** Where the menu entry that opens the picker goes. */
  slot: HTMLElement;
  /** Where the picker's own buttons (Done) go. */
  actions: HTMLElement;
  readonly isOpen: boolean;
  /** Opens or closes the picker; on phones the tiles are in the list and there is nothing to open. */
  setOpen(open: boolean): void;
  /** Draws it as the rules are now: where the tiles sit, whether it is open, the symbols of the chosen anomalies. */
  sync(): void;
  /** The page behind the sheet, which stops answering while the sheet is open. */
  setFrame(frame: HTMLElement | null): void;
  dispose(): void;
}

/**
 * The anomalies' tiles are an entry in the list of rules that opens them in a sheet, as on the local rules page; only on phones
 * (`narrow`) are they in the list itself. `close` is what a click beside the sheet does.
 */
export function anomalyPicker(group: HTMLElement, narrow: MediaQueryList, active: () => readonly Anomaly[], close: () => void): AnomalyPicker {
  const rows = group.querySelector<HTMLElement>('.setup__rows')!;
  group.classList.add('anomaly-menu');
  const slot = h('div', { 'data-section': 'rules-anomalies-trigger' });
  group.append(slot);
  const actions = h('div.items.items--row.anomaly-picker__actions', { 'data-section': 'anomaly-picker-actions' });
  const picker = h('section.anomaly-picker', { role: 'dialog', 'aria-modal': 'true', 'aria-label': groupTitle('anomalies') },
    h('h3.setup__title', null, groupTitle('anomalies')),
    actions,
  );
  const layer = h('div.anomaly-picker-layer', null, picker);
  picker.id = `${group.id}-picker`;
  const symbols = h('span.anomaly-menu__active', { 'aria-hidden': 'true' });
  let isOpen = false;
  let frame: HTMLElement | null = null;
  let shown: string | undefined;

  const place = (): void => {
    if (narrow.matches) {
      isOpen = false;
      if (!group.contains(rows)) group.insertBefore(rows, slot);
    } else if (!picker.contains(rows)) {
      picker.insertBefore(rows, actions);
    }
    slot.hidden = narrow.matches;
    layer.hidden = narrow.matches;
  };
  const sync = (): void => {
    place();
    const any = active().length > 0;
    group.classList.toggle('has-anomalies', any);
    layer.classList.toggle('has-anomalies', any);
    if (narrow.matches) {
      layer.classList.remove('is-open');
      layer.setAttribute('inert', '');
      layer.setAttribute('aria-hidden', 'true');
      frame?.removeAttribute('inert');
      return;
    }
    layer.classList.toggle('is-open', isOpen);
    layer.toggleAttribute('inert', !isOpen);
    layer.setAttribute('aria-hidden', String(!isOpen));
    frame?.toggleAttribute('inert', isOpen);
    const trigger = group.querySelector('.anomaly-menu__trigger');
    if (!trigger) return;
    trigger.setAttribute('aria-expanded', String(isOpen));
    trigger.setAttribute('aria-controls', picker.id);
    if (!trigger.contains(symbols)) {
      trigger.replaceChildren(h('span.anomaly-menu__label.item__label', null, groupTitle('anomalies')), symbols);
      shown = undefined;
    }
    const chosen = active();
    const key = chosen.join('|');
    if (key === shown) return;
    shown = key;
    symbols.hidden = !chosen.length;
    trigger.setAttribute('aria-label', `${groupTitle('anomalies')}: ${chosen.length ? chosen.map((anomaly) => t(`anomaly.${anomaly}`)).join(', ') : t('common.off')}`);
    const size = 22;
    const dpr = Math.max(1, devicePixelRatio || 1);
    symbols.replaceChildren(...chosen.map((anomaly) => {
      const icon = h('canvas', { width: String(Math.round(size * dpr)), height: String(Math.round(size * dpr)), title: t(`anomaly.${anomaly}`) }) as HTMLCanvasElement;
      const ctx = icon.getContext('2d');
      if (ctx) {
        ctx.scale(dpr, dpr);
        ctx.strokeStyle = ctx.fillStyle = ANOMALY_COLORS[anomaly];
        ctx.lineWidth = 1.7;
        ctx.lineCap = ctx.lineJoin = 'round';
        drawAnomalySymbol(ctx, anomaly, size / 2, size / 2, 8);
      }
      return icon;
    }));
  };
  layer.addEventListener('click', (event) => {
    if (event.target === layer) close();
  });
  narrow.addEventListener?.('change', sync);
  place();
  return {
    layer, slot, actions,
    get isOpen() { return isOpen; },
    setOpen: (open) => { isOpen = open && !narrow.matches; sync(); },
    sync,
    setFrame: (el) => { frame = el; },
    dispose: () => {
      narrow.removeEventListener?.('change', sync);
      layer.remove();
    },
  };
}
