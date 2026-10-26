import { COLORS, TEAMS } from '../../sim/config';
import { loadCustomPresets } from '../../data/customPresets';
import { t, tn } from '../../platform/i18n';
import { GAME_MODES, type GameMode } from '../../sim/modes';
import { rulesOf } from '../../data/roomRules';
import { activeSeats, seatTeamsFor, type Settings } from '../../data/settings';
import { changedRules, presetRules } from '../presets/match-presets';
import { h, type MenuItem, type Screen } from '../menu/menu';
import { menuPage } from '../menu/menu-page';
import { modeName } from '../menu/mode-name';
import { powerUpSummary } from '../presets/powerup-summary';
import { PresetCards, type PresetCard, type PresetHost, type PresetSelection } from '../presets/preset-cards';
import { ruleItems, ruleValueText } from '../menu/rules';
import type { App } from './app';
import { enablePagerNavigation, modePagerHeader, positionModeCarousel, type ModeTransition } from './mode-pager';
import { openPlayers } from './players';
import { rulesScreen } from './rules-page';

/** One ship per seat; when teams are in play the ships group under their team's colour. */
function crewMarkers(s: Settings): HTMLElement[] {
  const seats = activeSeats(s);
  const ship = (color: string) => {
    const marker = h('span.briefing__ship', null, '▲');
    marker.style.color = color;
    return marker;
  };
  const teams = seatTeamsFor(s, seats);
  if (!teams) return seats.map((i) => ship(COLORS.players[i]));
  return Array.from({ length: s.teamMode }, (_, team) => {
    const members = seats.filter((_, k) => teams[k] === team);
    if (!members.length) return null;
    const group = h('span.briefing__team', null, ...members.map((_, k) => ship(TEAMS[team][k % 3])));
    group.style.setProperty('--team-tone', TEAMS[team][0]);
    return group;
  }).filter((group): group is HTMLElement => group !== null);
}

function lineup(s: Settings): string {
  const seats = activeSeats(s).map((i) => s.seats[i]);
  const humans = seats.filter((x) => x === 'human').length;
  const cpus = seats.length - humans;
  const parts = [];
  if (humans) parts.push(`${humans} ${tn('lineup.human', humans)}`);
  if (cpus) parts.push(`${cpus} ${tn('lineup.cpu', cpus)}`);
  if (seatTeamsFor(s, activeSeats(s))) parts.push(t('lineup.teams', { n: s.teamMode }));
  return parts.join(' · ');
}

const localPresetSelections = new WeakMap<App, Map<GameMode, { current?: PresetSelection }>>();

/** The card chosen on a mode's setup page, kept for as long as the app runs so that rebuilding the page keeps it. */
function localPresetSelectionState(app: App, mode: GameMode): { current?: PresetSelection } {
  let byMode = localPresetSelections.get(app);
  if (!byMode) {
    byMode = new Map();
    localPresetSelections.set(app, byMode);
  }
  let state = byMode.get(mode);
  if (!state) {
    state = {};
    byMode.set(mode, state);
  }
  return state;
}

/** The preset cards of a mode's setup page: the rules they play are the local settings. */
function localPresetCards(app: App, mode: GameMode, showCreator: PresetHost['showCreator'] = () => {}): PresetCards {
  return new PresetCards({
    mode: () => mode,
    rules: () => rulesOf(app.settings),
    apply: (rules) => { Object.assign(app.settings, rules); app.settingsChanged(); app.menu.refresh(); },
    repaint: () => app.menu.refresh(),
    rebuild: () => app.menu.rebuild(),
    showCreator,
    today: () => app.today(),
  }, localPresetSelectionState(app, mode));
}

/** Default once on entry; rebuilding after rule or crew edits keeps the player's subsequent choices. */
export function prepareModeScreen(app: App, mode: GameMode, transition?: ModeTransition): () => Screen {
  Object.assign(app.settings, localPresetCards(app, mode).startRules());
  app.settingsChanged();
  return () => setupScreen(app, mode, transition);
}

function changeLocalMode(app: App, from: GameMode, to: GameMode, transition: ModeTransition): void {
  if (from === to) return;
  app.menu.replace(
    prepareModeScreen(app, to, transition),
    0,
  );
}

function modePagerItems(app: App, current: GameMode): MenuItem[] {
  const currentIndex = GAME_MODES.indexOf(current);
  // Rotate the cycle so the active mode stays first and the next two always peek in from the right.
  const modes = GAME_MODES.map((_, distance) => GAME_MODES[(currentIndex + distance) % GAME_MODES.length]);
  return modes.map((mode, distance): MenuItem => ({
    kind: 'action', section: 'mode-pager',
    label: modeName(mode),
    className: `mode-pager__item mode-pager__item--${mode} mode-pager__item--${distance === 0 ? 'active' : distance === 1 ? 'near' : 'far'}`,
    selected: () => mode === current,
    run: () => changeLocalMode(app, current, mode, 'next'),
  }));
}

function enableModeSwipe(root: HTMLElement, app: App, current: GameMode): () => void {
  return enablePagerNavigation(root, (direction) => {
    const index = GAME_MODES.indexOf(current);
    const next = GAME_MODES[(index + (direction === 'next' ? 1 : -1) + GAME_MODES.length) % GAME_MODES.length];
    changeLocalMode(app, current, next, direction);
  }, '.briefing__quick, .briefing__players, .briefing__edit');
}

/** A concise briefing; rule and crew subpages preserve edits made after entering the mode. */
function setupScreen(app: App, mode: GameMode, transition?: ModeTransition): Screen {
  const s = app.settings;
  const customs = loadCustomPresets(mode);
  const presets: PresetCards = localPresetCards(app, mode, (creator) => app.menu.push(() => rulesScreen(app, mode, { creator })));
  if (!presets.selection()) presets.detect();
  const summary = h('dl.briefing__facts', { 'aria-live': 'polite' });
  const rulesHeading = h('h3.setup__title', null, t('briefing.rules'));
  // The rounds, the shot clock and the power-ups sit in the page itself: the summary lists what else differs from the standard.
  const shownInPage: readonly string[] = ['rounds', 'shotTime', 'powerUpKinds', 'powerUpAmount'];
  const standard = presetRules('standard', mode);
  const crew = h('div.briefing__crew', { 'aria-hidden': 'true' });
  const crewLabel = h('p.briefing__lineup', null);
  const quickKeys = ['rounds', 'shotTime'] as const;
  const powerups = powerUpSummary(() => s, {
    mode,
    patch: (values) => {
      Object.assign(s, values);
      app.settingsChanged();
      update();
      app.menu.refresh();
    },
  });
  const rules = ruleItems(mode, {
    get: () => rulesOf(s),
    patch: (values) => { Object.assign(s, values); app.settingsChanged(); app.menu.refresh(); },
  });
  const quick = rules.filter(({ key }) => quickKeys.some((quickKey) => quickKey === key));
  // The strength of Mayhem shows up under the sliders while Mayhem is on.
  const mayhem = rules.find(({ key }) => key === 'mayhem')!;
  const update = (): void => {
    crewLabel.textContent = lineup(s);
    crew.replaceChildren(...crewMarkers(s));
    const rules = rulesOf(s);
    const changes = changedRules(rules, standard, mode).filter(({ key }) => !shownInPage.includes(key));
    rulesHeading.textContent = t(changes.length ? 'briefing.rulesChanged' : 'briefing.rules');
    summary.replaceChildren(...(changes.length
      ? changes.map((row) => h('div', null, h('dt', null, row.label), h('dd', null, ruleValueText(row, rules))))
      : [h('div', null, h('dt', null, t('briefing.rulesStandard')))]));
    powerups.update();
  };
  let disposeModeCarousel = (): void => {};
  const items: MenuItem[] = [
    ...modePagerItems(app, mode),
    ...presets.cards().map(presetItem),
    ...quick.map(({ item }): MenuItem => ({ ...item, section: 'quick' })),
    { ...mayhem.item, section: 'quick-mayhem' },
    { kind: 'action', section: 'players', label: t('briefing.editCrew'), run: () => openPlayers(app) },
    { kind: 'action', section: 'edit', label: t('briefing.editRules'), run: () => app.menu.push(() => rulesScreen(app, mode, { reset: () => presets.resetToStandard() })) },
    { kind: 'action', section: 'actions', label: t('common.back'), run: () => app.menu.back() },
    { kind: 'action', section: 'actions', label: t('setup.start'), primary: true, run: () => app.start(mode) },
  ];
  return {
    build: () => {
      const page = menuPage({
        title: modeName(mode), eyebrow: t('launcher.prepare'),
        headerTitle: modePagerHeader(mode, transition),
        className: `menu-page--briefing menu-page--mode-pager${transition ? ` menu-page--mode-enter-${transition}` : ''}`,
        body: [
          h('section.briefing__presets', null,
            h('div.items.items--row.briefing__cards', { 'data-section': 'presets', role: 'group', 'aria-label': t('preset.choose') },
              h('div.briefing__own', { 'data-section': 'presets-own', 'data-own': String(customs.length) })),
            h('div.briefing__quick', null,
              h('div.briefing__quick-controls', { 'data-section': 'quick' }),
              h('div.briefing__mayhem', { 'data-section': 'quick-mayhem' }),
              powerups.el,
            ),
          ),
        ],
        aside: [
          h('h3.setup__title', null, t('briefing.crew')),
          crew, crewLabel,
          h('div.items.briefing__players', { 'data-section': 'players' }),
          rulesHeading,
          summary,
          h('div.items.briefing__edit', { 'data-section': 'edit' }),
        ],
        keys: t('briefing.keys'),
        footer: h('div.items.items--row.menu-page__actions', { 'data-section': 'actions' }),
      });
      const stopCarousel = positionModeCarousel(page);
      const stopNavigation = enableModeSwipe(page, app, mode);
      disposeModeCarousel = () => { stopNavigation(); stopCarousel(); };
      return page;
    },
    dispose: () => disposeModeCarousel(),
    items,
    // Enter keeps the quick route into the game; the presets remain a click or arrow away.
    focusItem: items.length - 1,
    update,
  };
}

/** The card of a preset as a menu row: the player's own are slim strips in the column after the cards, the first empty slot a card of its own. */
function presetItem(card: PresetCard): MenuItem {
  const own = card.kind === 'custom' || card.kind === 'new';
  const common = { kind: 'action', section: own ? 'presets-own' : 'presets', label: card.label, run: card.open ?? card.choose } satisfies MenuItem;
  if (card.kind === 'new') {
    return card.art
      ? { ...common, className: 'item--custom-empty', hint: card.hint, icon: card.art }
      : { ...common, className: 'item--strip item--strip-empty' };
  }
  return {
    ...common,
    selected: card.selected,
    ...(card.kind === 'custom' ? { className: 'item--strip' } : card.kind === 'pick' ? { className: 'item--pick', tag: t('preset.pick.today') } : {}),
    ...(card.hint ? { hint: card.hint } : {}),
    ...(card.art ? { icon: card.art } : {}),
    status: card.status,
    modified: card.modified,
    statusActionLabel: card.actionLabel,
    statusAction: card.action,
    ...(card.secondary ? { statusSecondaryLabel: t('preset.custom.save'), statusSecondaryVisible: card.secondary.visible, statusSecondary: card.secondary.run } : {}),
  };
}
