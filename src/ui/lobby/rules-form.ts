import type { GameMode } from '../../sim/modes';
import { buildControl, twistNote, type Control, type Env } from '../menu/controls';
import { h } from '../menu/menu';
import { mobileSheet } from '../menu/mobile-sheet';
import { anyTwisted, groupTitle, RULE_COLUMNS, ruleItems, type RuleSource } from '../menu/rules';
import { t } from '../../platform/i18n';
import type { App } from '../screens';

export interface RulesForm {
  el: HTMLElement;
  navigation: HTMLElement;
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
  const refresh = () => {
    controls.forEach((c) => c.refresh());
    note.update(anyTwisted(mode, source.get(), true));
  };
  const env: Env = { sound: app.menu.sound, readonly, changed: () => { refresh(); changed?.(); } };
  const items = ruleItems(mode, source, true);
  const columns = RULE_COLUMNS.map((column) => column.filter((group) => items.some((item) => item.group === group))).filter((column) => column.length);
  const sheet = mobileSheet(columns.map((column) => column.map((group) => ({ id: `rules-${group}`, title: groupTitle(group) }))), t('briefing.rules'), refresh);
  sheet.el.classList.add('rules-browser');
  for (const { group, item } of items) {
    const control = buildControl(sheet.bind({ ...item, section: `rules-${group}` }), env);
    controls.push(control);
    sheet.el.querySelector(`[data-section="rules-${group}"]`)!.append(control.el);
  }
  // The note stays out of the sheet's grid: a row of its own there would hold an empty column open.
  const el = h('div.rules-form', null, note.el, sheet.el);
  refresh();
  return { el, refresh, navigation: sheet.navigation, dispose: sheet.dispose };
}
