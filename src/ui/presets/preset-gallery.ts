import '@fontsource/big-shoulders-stencil-display/800';
import '@fontsource/b612/400';
import '@fontsource/b612/700';
import '@fontsource/b612-mono/400';
import './preset-gallery.css';
import { isLang, setLang, t, tn } from '../../platform/i18n';
import { GAME_MODES, type GameMode } from '../../sim/modes';
import type { RoomRules } from '../../data/roomRules';
import { loadCustomPresets } from '../../data/customPresets';
import { h } from '../dom';
import { modeArt, presetArt } from '../menu/mode-icons';
import { modeName } from '../menu/mode-name';
import { groupTitle, RULE_GROUPS, rulesFor, ruleValueText, type RuleRow } from '../menu/rules';
import { changedRules, handpickedPresets, presetHintKey, presetLabelKey, presetRules, presetsForMode } from './match-presets';
import { pickArt, pickHint, pickName } from './pick-of-day';

type Kind = 'regular' | 'daily' | 'custom';
interface Entry {
  id: string;
  mode: GameMode;
  kind: Kind;
  name: string;
  hint: string;
  rules: RoomRules;
  art(): SVGElement;
}

/** Dev-only catalogue of the real authored cards, plus this browser's saved custom presets. */
function entries(mode: GameMode): Entry[] {
  return [
    ...presetsForMode(mode).map((id): Entry => ({
      id, mode, kind: 'regular', name: t(presetLabelKey(id, mode)), hint: t(presetHintKey(id, mode)),
      rules: presetRules(id, mode), art: () => presetArt(id, mode),
    })),
    ...handpickedPresets(mode).map((pick): Entry => ({
      id: pick.id, mode, kind: 'daily', name: pickName(pick), hint: pickHint(pick), rules: pick.rules, art: () => pickArt(pick),
    })),
    ...loadCustomPresets(mode).map((saved): Entry => ({
      id: `custom-${saved.id}`, mode, kind: 'custom', name: saved.name, hint: '', rules: saved.rules, art: () => modeArt(mode),
    })),
  ];
}

/** Keep full pickup names here: a catalogue should show what is selected, rather than only a count. */
function value(row: RuleRow, rules: RoomRules): string {
  if (row.inactive?.(rules) || (row.key === 'mayhem' && !rules.mayhem)) return t('common.off');
  if (row.key === 'powerUpKinds' && rules.powerUps) {
    return rules.powerUpKinds.map((kind) => row.options.find((o) => o.value === kind)?.label ?? kind).join(', ');
  }
  return ruleValueText(row, rules);
}

const state = { mode: 'all', kind: 'all', search: '', anomalies: false, expanded: false };
const root = h('main.preset-gallery', null);
const requestedLanguage = new URLSearchParams(location.search).get('lang');
setLang(isLang(requestedLanguage) ? requestedLanguage : 'de');

function render(): void {
  document.documentElement.lang = new URLSearchParams(location.search).get('lang') === 'en' ? 'en' : 'de';
  document.title = `Slingshot — ${t('gallery.presets.title')} (dev)`;
  const listing = h('div.preset-gallery__listing', null);
  const count = h('output.preset-gallery__count', { 'aria-live': 'polite' });
  const expand = h('button', { type: 'button', 'aria-pressed': String(state.expanded) }, t(state.expanded ? 'gallery.presets.collapse' : 'gallery.presets.expand'));
  const card = (entry: Entry): HTMLElement => {
    const { rules, mode } = entry;
    const rows = rulesFor(mode).filter((row) => !row.when || row.when(rules) || row.key === 'mayhem');
    const changed = new Set(changedRules(rules, presetRules('standard', mode), mode).map((row) => row.key));
    const ruleList = (list: RuleRow[]): HTMLElement => h('dl.preset-gallery__values', null,
      ...list.flatMap((row) => [h('dt', null, row.label), h(`dd${changed.has(row.key) ? '.is-changed' : ''}`, null, value(row, rules))]),
    );
    const details = h('details.preset-gallery__details', null,
      h('summary', null, t('gallery.presets.rules', { n: rows.length })),
      ...RULE_GROUPS.flatMap((group) => {
        const grouped = rows.filter((row) => row.group === group);
        return grouped.length ? [h('section', null, h('h4', null, groupTitle(group)), ruleList(grouped))] : [];
      }),
    ) as HTMLDetailsElement;
    details.open = state.expanded;
    const id = `${mode}-${entry.id}`;
    const badges = h('div.preset-gallery__badges', null, ...rules.anomalies.map((anomaly) =>
      h('span', { title: t(`anomaly.${anomaly}.hint`) }, t(`anomaly.${anomaly}`)),
    ));
    return h(`article.preset-gallery__card${rules.anomalies.length ? '.has-anomalies' : ''}`, { id, 'data-mode': mode, 'data-kind': entry.kind, 'data-preset': entry.id },
      h('div.preset-gallery__art', null, entry.art()),
      h('div.preset-gallery__content', null,
        h('p.preset-gallery__kind', null, t(`gallery.presets.${entry.kind}`)),
        h('h3', null, h('a', { href: `#${id}` }, entry.name)),
        h('p.preset-gallery__hint', null, entry.hint),
        ...(rules.anomalies.length ? [badges] : []),
        ruleList(rows.filter((row) => row.key === 'rounds' || row.key === 'shotTime' || row.key === 'edges')),
        details,
      ),
    );
  };
  const refresh = (): void => {
    let total = 0;
    const query = state.search.trim().toLocaleLowerCase(document.documentElement.lang);
    listing.replaceChildren(...GAME_MODES.flatMap((mode) => {
      if (state.mode !== 'all' && mode !== state.mode) return [];
      const visible = entries(mode).filter((entry) => {
        if (state.kind !== 'all' && state.kind !== entry.kind) return false;
        if (state.anomalies && !entry.rules.anomalies.length) return false;
        const text = [entry.name, entry.hint, entry.id, modeName(mode), ...rulesFor(mode).map((row) => `${row.label} ${value(row, entry.rules)}`)].join(' ').toLocaleLowerCase(document.documentElement.lang);
        return !query || text.includes(query);
      });
      total += visible.length;
      return visible.length ? [h('section.preset-gallery__mode', { 'data-mode-section': mode },
        h('h2', null, modeName(mode), h('span', null, String(visible.length))),
        h('div.preset-gallery__grid', null, ...visible.map(card)),
      )] : [];
    }));
    if (!total) listing.append(h('p.preset-gallery__empty', null, t('gallery.presets.empty')));
    count.textContent = tn('gallery.presets.count', total);
  };
  const select = (label: string, options: { value: string; label: string }[], selected: string, change: (value: string) => void): HTMLElement => {
    const el = h('select', { 'aria-label': label }, ...options.map((o) => h('option', { value: o.value }, o.label))) as HTMLSelectElement;
    el.value = selected;
    el.addEventListener('change', () => change(el.value));
    return h('label', null, h('span', null, label), el);
  };
  const mode = select(t('gallery.presets.mode'), [{ value: 'all', label: t('gallery.presets.allModes') }, ...GAME_MODES.map((mode) => ({ value: mode, label: modeName(mode) }))], state.mode, (value) => { state.mode = value; refresh(); });
  const kind = select(t('gallery.presets.kind'), [{ value: 'all', label: t('gallery.presets.allKinds') }, ...(['regular', 'daily', 'custom'] as const).map((kind) => ({ value: kind, label: t(`gallery.presets.${kind}`) }))], state.kind, (value) => { state.kind = value; refresh(); });
  const search = h('input', { type: 'search', 'aria-label': t('gallery.presets.search'), placeholder: t('gallery.presets.search') }) as HTMLInputElement;
  search.value = state.search;
  search.addEventListener('input', () => { state.search = search.value; refresh(); });
  const anomalies = h('input', { type: 'checkbox' }) as HTMLInputElement;
  anomalies.checked = state.anomalies;
  anomalies.addEventListener('change', () => { state.anomalies = anomalies.checked; refresh(); });
  expand.addEventListener('click', () => {
    state.expanded = !state.expanded;
    listing.querySelectorAll<HTMLDetailsElement>('details').forEach((details) => { details.open = state.expanded; });
    expand.textContent = t(state.expanded ? 'gallery.presets.collapse' : 'gallery.presets.expand');
    expand.setAttribute('aria-pressed', String(state.expanded));
  });
  const language = select(t('common.language'), [{ value: 'de', label: 'DE' }, { value: 'en', label: 'EN' }], document.documentElement.lang, (lang) => {
    if (!isLang(lang)) return;
    setLang(lang);
    const url = new URL(location.href); url.searchParams.set('lang', lang); history.replaceState(null, '', url);
    render();
  });
  root.replaceChildren(
    h('header.preset-gallery__head', null,
      h('p.preset-gallery__eyebrow', null, 'SLINGSHOT · DEV'),
      h('h1', null, t('gallery.presets.title')),
      h('p.preset-gallery__intro', null, t('gallery.presets.intro')),
      h('div.preset-gallery__language', null, language),
    ),
    h('div.preset-gallery__filters', null,
      mode, kind, h('label.preset-gallery__search', null, h('span', null, t('gallery.presets.searchLabel')), search),
      h('label.preset-gallery__check', null, anomalies, t('gallery.presets.anomaliesOnly')),
      expand, count,
    ),
    h('p.preset-gallery__legend', null, t('gallery.presets.changed')),
    listing,
  );
  refresh();
}

if (import.meta.env.DEV) {
  document.body.append(root);
  render();
  if (location.hash) requestAnimationFrame(() => document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView());
}
