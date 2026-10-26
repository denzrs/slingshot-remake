import { t } from '../../platform/i18n';
import type { GameMode } from '../../sim/modes';
import { rulesOf } from '../../data/roomRules';
import { resetRules } from '../presets/match-presets';
import { h, type MenuItem, type Screen } from '../menu/menu';
import { twistNote } from '../menu/controls';
import { menuGroup, menuPage } from '../menu/menu-page';
import { modeName } from '../menu/mode-name';
import type { PresetCreator } from '../presets/preset-cards';
import { presetNameField } from '../presets/preset-name';
import { anyTwisted, groupTitle, RULE_COLUMNS, ruleItems, type RuleSource } from '../menu/rules';
import type { App } from './app';

/**
 * All rules on one page, grouped by subject in two columns. As the preset creator it has a name above it, and leaving it any
 * way but Save puts the rules back; `reset` is what its Reset button does (it goes back to the standard rules by default).
 */
export function rulesScreen(app: App, mode: GameMode, { creator, reset }: { creator?: PresetCreator; reset?: () => void } = {}): Screen {
  // The creator edits the live rules like any rules page.
  const restore = (): void => creator?.cancel();
  const source: RuleSource = {
    get: () => rulesOf(app.settings),
    patch: (values) => {
      Object.assign(app.settings, values);
      app.settingsChanged();
      app.menu.refresh();
    },
  };
  const rules = ruleItems(mode, source);
  const note = twistNote();
  const columns = RULE_COLUMNS.map((groups) => groups.filter((group) => rules.some((r) => r.group === group))).filter((groups) => groups.length);
  // The keyboard walks the items in this order: down the left column, then down the right one.
  const order = columns.flat();
  const rows: MenuItem[] = rules
    .filter(({ group }) => order.includes(group))
    .sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group))
    .map(({ group, item }): MenuItem => ({ ...item, section: `rules-${group}` }));
  return {
    build: () => menuPage({
      title: t(creator ? (creator.existing ? 'preset.creator.titleEdit' : 'preset.creator.title') : 'briefing.editRules'), eyebrow: modeName(mode), className: 'menu-page--rules',
      headerAside: creator ? presetNameField(creator.name, creator.defaultName, (name) => { creator.name = name; }) : undefined,
      body: [note.el, h('div.sheet', null, ...columns.map((groups) => h('div.sheet__col', null, ...groups.map((group) => menuGroup(groupTitle(group), `rules-${group}`)))))],
      keys: t('briefing.keys'),
      footer: h('div.items.items--row.menu-page__actions', { 'data-section': 'actions' }),
    }),
    items: [
      ...rows,
      { kind: 'action', section: 'actions', label: t('setup.reset'), run: reset ?? (() => {
        Object.assign(app.settings, resetRules(rulesOf(app.settings), mode).rules);
        app.settingsChanged(); app.menu.refresh();
      }) },
      ...(creator
        ? [
            // Deleting asks twice; the question outlives the rebuild of this screen in the creator's own state.
            ...(creator.existing ? [{ kind: 'action', section: 'actions', label: t(creator.confirmDelete ? 'preset.creator.deleteConfirm' : 'preset.creator.delete'), className: creator.confirmDelete ? 'item--delete is-confirming' : 'item--delete', run: () => {
              if (!creator.confirmDelete) { creator.confirmDelete = true; app.menu.rebuild(); return; }
              creator.remove();
              app.menu.back();
            } } satisfies MenuItem] : []),
            { kind: 'action', section: 'actions', label: t('preset.creator.cancel'), run: () => app.menu.back() } satisfies MenuItem,
            { kind: 'action', section: 'actions', label: t('preset.creator.save'), primary: true, run: () => {
              if (!creator.save()) return;
              app.menu.back();
            } } satisfies MenuItem,
          ]
        : [{ kind: 'action', section: 'actions', label: t('briefing.done'), primary: true, run: () => app.menu.back() } satisfies MenuItem]),
    ],
    focus: 0,
    update: () => note.update(anyTwisted(mode, source.get())),
    // Back, Cancel and Esc all leave through here.
    onEscape: () => { restore(); },
  };
}
