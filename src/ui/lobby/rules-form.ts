import type { GameMode } from '../../sim/modes';
import { buildControl, type Control, type Env } from '../menu/controls';
import { h } from '../menu/menu';
import { groupTitle, RULE_COLUMNS, RULE_GROUPS, ruleItems, type RuleSource } from '../menu/rules';
import type { App } from '../screens';

export interface RulesForm {
  el: HTMLElement;
  /** Show the rules as they are now. */
  refresh(): void;
}

/**
 * The rules of a game as sliders and switches, in the blocks and columns of the rules page. Read-only, they
 * are what everybody but the host sees of a room.
 */
export function rulesForm(mode: GameMode, source: RuleSource, app: App, readonly = false, changed?: () => void): RulesForm {
  const controls: Control[] = [];
  const refresh = () => controls.forEach((c) => c.refresh());
  const env: Env = { sound: app.menu.sound, readonly, changed: () => { refresh(); changed?.(); } };
  const items = ruleItems(mode, source, true);
  const groups = new Map(RULE_GROUPS.filter((group) => items.some((i) => i.group === group)).map((group) => {
    const rows = h('div.setup__rows', null);
    for (const { group: g, item } of items) {
      if (g !== group) continue;
      const control = buildControl(item, env);
      controls.push(control);
      rows.append(control.el);
    }
    return [group, h('section.setup__group', null, h('h3.setup__title', null, groupTitle(group)), rows)] as const;
  }));
  const el = h('div.sheet.rules-browser', null,
    ...RULE_COLUMNS.map((column) => column.filter((group) => groups.has(group))).filter((column) => column.length)
      .map((column) => h('div.sheet__col', null, ...column.map((group) => groups.get(group)!))),
  );
  refresh();
  return { el, refresh };
}
