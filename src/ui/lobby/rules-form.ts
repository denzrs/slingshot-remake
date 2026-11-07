import type { GameMode } from '../../sim/modes';
import { anomalyPicker, type AnomalyPicker } from '../menu/anomaly-picker';
import { buildControl, twistNote, type Control, type Env } from '../menu/controls';
import { h } from '../menu/menu';
import { mobileSheet } from '../menu/mobile-sheet';
import { anyTwisted, groupTitle, orderRulesForMobile, RULE_COLUMNS, ruleItems, type RuleSource } from '../menu/rules';
import { t } from '../../platform/i18n';
import { hideActiveTooltip } from '../menu/tooltip';
import type { App } from '../screens';

export interface RulesForm {
  el: HTMLElement;
  navigation: HTMLElement;
  /** The sheet the anomalies open in, for the page to put on itself; none where the mode has no anomalies. */
  picker?: HTMLElement;
  /** The page behind the sheet, which stops answering while the sheet is open. */
  setFrame(frame: HTMLElement | null): void;
  /** Closes the anomalies' sheet if it is open; false if it was not. */
  closePicker(): boolean;
  /** Show the rules as they are now. */
  refresh(): void;
  dispose(): void;
}

/**
 * The rules of a game as sliders and switches, in the blocks and columns of the rules page. Read-only, they
 * are what everybody but the host sees of a room.
 */
export function rulesForm(mode: GameMode, source: RuleSource, app: App, readonly = false, changed?: () => void): RulesForm {
  const controls: Control[] = [];
  const note = twistNote();
  let anomalies: AnomalyPicker | undefined;
  const refresh = () => {
    controls.forEach((c) => c.refresh());
    note.update(anyTwisted(mode, source.get(), true));
    anomalies?.sync();
  };
  const env: Env = { sound: app.menu.sound, readonly, changed: () => { refresh(); changed?.(); } };
  const items = ruleItems(mode, source, true);
  const columns = RULE_COLUMNS.map((column) => column.filter((group) => items.some((item) => item.group === group))).filter((column) => column.length);
  const sheet = mobileSheet(
    columns.map((column) => column.map((group) => ({ id: `rules-${group}`, title: groupTitle(group) }))),
    t('briefing.rules'),
    refresh,
    undefined,
    orderRulesForMobile,
  );
  sheet.el.classList.add('rules-browser');
  for (const { group, item } of items) {
    const control = buildControl(sheet.bind({ ...item, section: `rules-${group}` }), env);
    controls.push(control);
    sheet.el.querySelector(`[data-section="rules-${group}"]`)!.append(control.el);
  }
  // As on the local rules page, the anomalies are an entry that opens their tiles; only on phones are the tiles in the list.
  const group = sheet.el.querySelector<HTMLElement>('.menu-group[id$="-rules-anomalies"]');
  const narrow = matchMedia('(max-width: 760px)');
  const closePicker = (): boolean => {
    if (!anomalies?.isOpen) return false;
    anomalies.setOpen(false);
    hideActiveTooltip();
    group?.querySelector<HTMLElement>('.anomaly-menu__trigger')?.focus({ preventScroll: true });
    return true;
  };
  if (group) {
    anomalies = anomalyPicker(group, narrow, () => source.get().anomalies, closePicker);
    const trigger = h('button.item.anomaly-menu__trigger', { type: 'button' });
    trigger.addEventListener('click', () => {
      anomalies!.setOpen(true);
      anomalies!.layer.querySelector<HTMLElement>('.item--tiles')?.focus({ preventScroll: true });
    });
    anomalies.slot.append(trigger);
    const done = h('button.item.item--primary', { type: 'button' }, t('briefing.done'));
    done.addEventListener('click', closePicker);
    anomalies.actions.append(done);
  }
  // The note stays out of the sheet's grid: a row of its own there would hold an empty column open.
  const el = h('div.rules-form', null, note.el, sheet.el);
  refresh();
  return {
    el, refresh, closePicker, setFrame: (frame) => anomalies?.setFrame(frame), navigation: sheet.navigation, picker: anomalies?.layer,
    dispose: () => { anomalies?.dispose(); sheet.dispose(); },
  };
}
