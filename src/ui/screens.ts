import { CHALLENGE, COLORS, HORIZON, MAX_PLAYERS, SCORING, TEAMS } from '../config';
import { teamName, type Match, type Mode, type VersusMode } from '../game';
import { oracleAwards } from '../game/oracle';
import { fmtInt, fmtNum, LANGS, t, tn, type Key, type Lang } from '../i18n';
import { rulesOf } from '../lobbyPrefs';
import { roundTitle } from '../mayhem';
import { awardLabel, awardValue, awardWho } from '../scorecard';
import { STYLE_MULTIPLIER, styleLabel } from '../scoring';
import { awards } from '../stats';
import type { StyleKind } from '../physics';
import type { PowerUpKind } from '../powerups';
import { drawPowerUpSymbol, POWER_UP_COLORS } from '../render/powerup-art';
import { activeSeats, addSeat, balanceTeams, DEFAULT_SETTINGS, freeSeat, MIN_SEATS, removeSeat, seatTeamsFor, teamCounts, type Seat, type Settings } from '../settings';
import { dailyMenuHint, dailyScreen } from './daily';
import { h, type Menu, type MenuItem, type Screen } from './menu';
import { modeArt, pilotArt } from './mode-icons';
import type { LobbyEntry } from './lobby';
import { menuGroup, menuPage } from './menu-page';
import { presetsForMode, matchingPreset, presetRules, MAYHEM_PRESETS, matchingMayhemPreset } from './match-presets';
import { groupTitle, RULE_GROUPS, ruleItems, type RuleSource } from './rules';
import { mountTutorialPreview, type TutorialPreviewKind } from './tutorial-preview';

export interface App {
  menu: Menu;
  settings: Settings;
  settingsChanged(): void;
  /** The mode being played right now, null on the title screen. */
  readonly mode: Mode | null;
  /** Whether the game on screen is a Mayhem game. */
  readonly mayhem: boolean;
  /** Today's date key — the real one, unless the URL asks for another day. */
  today(): string;
  start(mode: VersusMode, mayhem?: boolean): void;
  startDaily(): void;
  /** True while an online match is on screen. */
  readonly online: boolean;
  openLobby(entry?: LobbyEntry): void;
  /** Leave the online game (and its room) for the multiplayer lobby, still connected. */
  toLobby(): void;
  resume(): void;
  rematch(): void;
  toTitle(): void;
  toggleFullscreen(): void;
  isFullscreen(): boolean;
}

const LANG_NAMES: Record<Lang, string> = { de: 'Deutsch', en: 'English' };

type BmcButtonWidget = (text: string, slug: string, color: string, emoji: string, font: string, fontColor: string, outlineColor: string, coffeeColor: string) => string;

let bmcWidget: Promise<BmcButtonWidget | null> | null = null;
let bmcStylesInstalled = false;

function loadBmcWidget(): Promise<BmcButtonWidget | null> {
  if (bmcWidget) return bmcWidget;
  bmcWidget = new Promise((resolve) => {
    const existing = (window as Window & { bmcBtnWidget?: BmcButtonWidget }).bmcBtnWidget;
    if (existing) {
      resolve(existing);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://cdnjs.buymeacoffee.com/1.0.0/button.prod.min.js';
    script.async = true;
    script.onload = () => resolve((window as Window & { bmcBtnWidget?: BmcButtonWidget }).bmcBtnWidget ?? null);
    script.onerror = () => resolve(null);
    document.head.append(script);
  });
  return bmcWidget;
}

/** The official BMC widget uses document.write when initialized from its data-name embed.
 * Load its renderer without that attribute, then mount its generated button into the title UI. */
function coffeeButton(): HTMLElement {
  const fallback = h('a.coffee-link', {
    href: import.meta.env.VITE_COFFEE_URL,
    target: '_blank',
    rel: 'noopener noreferrer',
    'aria-label': t('title.coffee'),
  }, t('title.coffee'));
  const container = h('div.coffee-button', null, fallback);

  void loadBmcWidget().then((renderWidget) => {
    if (!renderWidget || !container.isConnected) return;
    const html = renderWidget('Buy me a coffee', 'slingshot.remake', '#132746', '🚀', 'Bree', '#ffffff', '#5B7DB3', '#FFDD00');
    const template = document.createElement('template');
    template.innerHTML = html;
    template.content.querySelector('link[rel="stylesheet"]')?.remove();
    const styles = template.content.querySelector('style');
    const button = template.content.querySelector<HTMLAnchorElement>('.bmc-btn');
    const widget = template.content.querySelector<HTMLElement>('.bmc-btn-container');
    if (!styles || !button || !widget) return;

    button.rel = 'noopener noreferrer';
    if (!bmcStylesInstalled) {
      styles.textContent += `\n.bmc-btn, .bmc-btn-text { font-family: var(--font-body) !important; }\n.bmc-btn { min-width: 0; height: 40px; padding: 0 12px; border: 1px solid var(--line) !important; border-radius: 3px; font-size: 13px; }\n.bmc-btn svg { height: 25px !important; }\n`;
      document.head.append(styles);
      bmcStylesInstalled = true;
    }
    fallback.hidden = true;
    container.append(widget);
  });

  return container;
}

/** Language picker; the names stay in their own language so it is findable from any UI language. */
function languageItem(app: App): MenuItem {
  return {
    kind: 'choice',
    label: t('common.language'),
    options: LANGS.map((value) => ({ value, label: LANG_NAMES[value] })),
    get: () => app.settings.language,
    set: (v) => {
      app.settings.language = v as Lang;
      app.settingsChanged();
    },
  };
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

type LocalMode = VersusMode | 'mayhem';
type LauncherSection = 'local' | 'online';
let launcherSection: LauncherSection = 'local';
const modeName = (mode: LocalMode): string => t(`mode.${mode}` as Key);
const MAIN_MODES = ['classic', 'horizon', 'mayhem'] as const satisfies readonly LocalMode[];
type ModeTransition = 'next' | 'previous';

function changeLocalMode(app: App, from: LocalMode, to: LocalMode): void {
  if (from === to) return;
  const fromIndex = MAIN_MODES.indexOf(from as (typeof MAIN_MODES)[number]);
  const toIndex = MAIN_MODES.indexOf(to as (typeof MAIN_MODES)[number]);
  const transition: ModeTransition = toIndex > fromIndex ? 'next' : 'previous';
  app.menu.replace(
    () => to === 'mayhem' ? mayhemScreen(app, transition) : setupScreen(app, to, transition),
    toIndex,
  );
}

function modePagerItems(app: App, current: LocalMode): MenuItem[] {
  const currentIndex = MAIN_MODES.indexOf(current as (typeof MAIN_MODES)[number]);
  return MAIN_MODES.map((mode, index) => ({ mode, index, distance: Math.abs(index - currentIndex) }))
    .filter(({ mode }) => mode !== current)
    .sort((a, b) => a.distance - b.distance || a.index - b.index)
    .map(({ mode, index, distance }): MenuItem => ({
      kind: 'action', section: 'mode-pager',
      label: index < currentIndex ? `‹ ${modeName(mode)}` : `${modeName(mode)} ›`,
      className: `mode-pager__item mode-pager__item--${distance === 1 ? 'near' : 'far'}`,
      run: () => changeLocalMode(app, current, mode),
    }));
}

function enableModeSwipe(root: HTMLElement, app: App, current: LocalMode): void {
  let start: { x: number; y: number } | null = null;
  root.addEventListener('touchstart', (event: TouchEvent) => {
    if (event.touches.length !== 1) { start = null; return; }
    const target = event.target;
    if (target instanceof Element && target.closest('input, select, textarea, .briefing__quick, .briefing__players, .briefing__edit')) {
      start = null;
      return;
    }
    start = { x: event.touches[0].clientX, y: event.touches[0].clientY };
  }, { passive: true });
  root.addEventListener('touchend', (event: TouchEvent) => {
    if (!start || event.changedTouches.length !== 1) { start = null; return; }
    const dx = event.changedTouches[0].clientX - start.x;
    const dy = event.changedTouches[0].clientY - start.y;
    start = null;
    if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 1.3) return;
    const index = MAIN_MODES.indexOf(current as (typeof MAIN_MODES)[number]);
    const next = MAIN_MODES[index + (dx < 0 ? 1 : -1)];
    if (!next) return;
    event.preventDefault();
    changeLocalMode(app, current, next);
  }, { passive: false });
}

/** The modes live on the title screen: choose here, prepare the match next. */
export function titleScreen(app: App): Screen {
  const sectionTitle = h('h2', null);
  const modesWrap = h('div.items.items--row.launcher__modes', { 'data-section': 'modes', role: 'group', 'aria-label': t('launcher.choose') });
  const dailyWrap = h('div.items.launcher__daily', { 'data-section': 'daily' });
  const onlineWrap = h('div.items.items--row.launcher__online', { 'data-section': 'online', role: 'group', 'aria-label': t('launcher.online') });
  const content = h('div.launcher__content', null,
    h('div.launcher__section-head', null, sectionTitle),
    modesWrap,
    dailyWrap,
    onlineWrap,
  );
  const showSection = (section: LauncherSection): void => {
    sectionTitle.textContent = t(section === 'local' ? 'launcher.choose' : 'launcher.online');
    modesWrap.hidden = section !== 'local';
    dailyWrap.hidden = section !== 'local';
    onlineWrap.hidden = section !== 'online';
    for (const [wrap, visible] of [
      [modesWrap, section === 'local'],
      [dailyWrap, section === 'local'],
      [onlineWrap, section === 'online'],
    ] as const) {
      for (const item of wrap.children) (item as HTMLElement).hidden = !visible;
    }
  };
  const update = (): void => {
    // Measure both sections at the current width and reserve the taller one. This keeps the
    // footer anchored even on short viewports where the content itself cannot fill the shell.
    content.style.minHeight = '';
    showSection('local');
    const localHeight = content.getBoundingClientRect().height;
    showSection('online');
    const onlineHeight = content.getBoundingClientRect().height;
    showSection(launcherSection);
    content.style.minHeight = `${Math.max(localHeight, onlineHeight)}px`;
  };
  const chooseSection = (section: LauncherSection): void => {
    launcherSection = section;
    app.menu.refresh();
    app.menu.focusSection(section === 'local' ? 'modes' : 'online');
  };
  const modeCard = (mode: LocalMode): MenuItem => ({
    kind: 'action', section: 'modes', label: modeName(mode), hint: t(`mode.${mode}.hint` as Key),
    icon: () => modeArt(mode),
    hidden: () => launcherSection !== 'local',
    run: () => app.menu.push(() => mode === 'mayhem' ? mayhemScreen(app) : setupScreen(app, mode)),
  });
  return {
    build: () => h('section.screen.screen--title', { 'aria-labelledby': 'wordmark' },
      h('div.launcher', null,
        h('header.launcher__head', null,
          h('h1.wordmark', { id: 'wordmark' }, 'Slingshot'),
        ),
        h('div.launcher__body', null,
          h('nav.launcher__nav.items', { 'data-section': 'navigation', 'aria-label': t('title.menuLabel') }),
          content,
        ),
        h('footer.launcher__foot', null,
          h('p.keys', null, t('launcher.keys')),
          h('div.items.launcher__language', { 'data-section': 'language' }),
          h('div.title-foot', null,
            h('p.version', null, String(import.meta.env.VITE_APP_VERSION || 'Local-Dev')),
            ...(import.meta.env.VITE_COFFEE_URL ? [coffeeButton()] : []),
          ),
        ),
      ),
    ),
    items: [
      { kind: 'action', section: 'navigation', label: t('launcher.local'), selected: () => launcherSection === 'local', run: () => chooseSection('local') },
      { kind: 'action', section: 'navigation', label: t('launcher.online'), selected: () => launcherSection === 'online', run: () => chooseSection('online') },
      { kind: 'action', section: 'navigation', label: t('common.help'), run: () => app.menu.push(tutorialScreen(app)) },
      { kind: 'action', section: 'navigation', label: t('common.settings'), run: () => app.menu.push(() => settingsScreen(app)) },
      modeCard('classic'),
      modeCard('horizon'),
      modeCard('mayhem'),
      { kind: 'action', section: 'daily', hidden: () => launcherSection !== 'local', label: t('mode.daily'), hint: dailyMenuHint(app.today()), icon: () => modeArt('daily'), run: () => app.menu.push(() => dailyScreen(app)) },
      { kind: 'action', section: 'online', hidden: () => launcherSection !== 'online', label: t('flow.find'), hint: t('flow.findHint'), icon: () => modeArt('rooms'), run: () => app.openLobby('rooms') },
      { kind: 'action', section: 'online', hidden: () => launcherSection !== 'online', label: t('flow.create'), hint: t('flow.createHint'), icon: () => modeArt('create'), run: () => app.openLobby('create') },
      { kind: 'action', section: 'online', hidden: () => launcherSection !== 'online', label: t('flow.code'), hint: t('flow.codeHint'), icon: () => modeArt('code'), run: () => app.openLobby('code') },
      { ...languageItem(app), section: 'language' },
    ],
    focus: launcherSection === 'local' ? 4 : 8,
    update,
    onEscape: () => {
      if (launcherSection === 'online') chooseSection('local');
    },
  };
}

export function pauseScreen(app: App): Screen {
  const daily = app.mode === 'challenge';
  const mode = app.mode === 'classic' || app.mode === 'horizon' ? app.mode : null;
  return {
    build: () => menuPage({
      title: t('pause.title'), eyebrow: app.mode === 'challenge' ? t('mode.daily') : app.mayhem ? t('mode.mayhem') : modeName(app.mode === 'horizon' ? 'horizon' : 'classic'),
      intro: t('shell.pauseNote'), className: 'menu-page--pause',
      body: [h('div.menu-page__art', null, modeArt(app.mode === 'challenge' ? 'daily' : app.mayhem ? 'mayhem' : app.mode === 'horizon' ? 'horizon' : 'classic'))],
      footer: h('nav.items.items--row.pause-actions.menu-page__actions', { 'data-section': 'actions', 'aria-label': t('pause.title') }),
    }),
    items: [
      { kind: 'action', section: 'actions', label: t('pause.resume'), primary: true, run: () => app.resume() },
      // Online, the room decides: no restarts from the pause menu. The daily challenge has no setup, only a retry.
      ...(mode && !app.online ? [{ kind: 'action', section: 'actions', label: t('pause.newGame'), run: () => app.menu.push(() => (app.mayhem ? mayhemScreen(app) : setupScreen(app, mode))) } satisfies MenuItem] : []),
      ...(daily ? [{ kind: 'action', section: 'actions', label: t('daily.retry'), run: () => app.rematch() } satisfies MenuItem] : []),
      { kind: 'action', section: 'actions', label: t('common.settings'), run: () => app.menu.push(() => settingsScreen(app)) },
      { kind: 'action', section: 'actions', label: t('common.help'), run: () => app.menu.push(tutorialScreen(app)) },
      app.online
        ? { kind: 'action', section: 'actions', label: t('multiplayer.toLobby'), run: () => app.toLobby() }
        : { kind: 'action', section: 'actions', label: t('common.mainMenu'), run: () => app.toTitle() },
    ],
    onEscape: () => app.resume(),
  };
}

function playersScreen(app: App, lastCpuBySeat: Map<number, Seat>): Screen {
  const s = app.settings;
  const seats = activeSeats(s);
  const fliers = [
    { value: 'human', label: t('seat.human') },
    { value: 'easy', label: t('cpu.easy') },
    { value: 'medium', label: t('cpu.medium') },
    { value: 'hard', label: t('cpu.hard') },
    { value: 'hawking', label: t('cpu.hawking') },
  ];
  const teams = Array.from({ length: s.teamMode }, (_, k) => k);

  const mode: MenuItem = {
    kind: 'segmented',
    section: 'mode',
    label: t('players.mode'),
    options: [
      { value: 0, label: t('players.ffa') },
      { value: 2, label: t('players.teams', { n: 2 }) },
      { value: 3, label: t('players.teams', { n: 3 }) },
    ],
    get: () => s.teamMode,
    set: (v) => {
      s.teamMode = v as number;
      app.settingsChanged();
      // The seats gain or lose their team buttons.
      app.menu.rebuild();
    },
  };
  const seat = (i: number): MenuItem => ({
    kind: 'seat',
    section: 'seats',
    label: t('players.player', { n: i + 1 }),
    swatch: COLORS.players[i],
    fliers,
    cpuCaption: t('players.cpu'),
    lastCpu: () => lastCpuBySeat.get(i),
    rememberCpu: (value) => lastCpuBySeat.set(i, value as Seat),
    get: () => s.seats[i],
    set: (v) => {
      s.seats[i] = v as Seat;
      app.settingsChanged();
    },
    teams: s.teamMode
      ? {
          caption: t('players.team'),
          options: teams.map((k) => ({ value: k, label: teamName(k) })),
          tones: teams.map((k) => TEAMS[k][0]),
          get: () => s.seatTeams[i] % s.teamMode,
          set: (v) => {
            s.seatTeams[i] = v as number;
            app.settingsChanged();
          },
        }
      : undefined,
    remove: {
      label: t('players.remove', { n: i + 1 }),
      disabled: () => activeSeats(s).length <= MIN_SEATS,
      run: () => {
        const at = seats.indexOf(i);
        if (!removeSeat(s, i)) return;
        app.settingsChanged();
        // The focus stays where the ship was: on whoever moved up, or on the last one.
        app.menu.rebuild(1 + Math.min(at, seats.length - 2));
      },
    },
  });

  const add = (label: string, flier: 'human' | 'medium'): MenuItem => ({
    kind: 'action',
    section: 'seats',
    icon: pilotArt,
    hint: t('flow.addPilotHint'),
    label,
    disabled: freeSeat(s) === null,
    run: () => {
      if (addSeat(s, flier) === null) return;
      app.settingsChanged();
      // The newcomer is the row after the last one (the mode bar comes first).
      app.menu.rebuild(1 + seats.length);
    },
  });

  const metric = (label: string): { el: HTMLElement; value: HTMLElement } => {
    const value = h('strong.crew-overview__value', null, '0');
    return { el: h('div.crew-overview__metric', null, h('span', null, label), value), value };
  };
  const shipsMetric = metric(t('players.ships'));
  const humansMetric = metric(t('players.humans'));
  const cpusMetric = metric(t('players.cpus'));
  const formatMetric = metric(t('players.format'));

  /** In team play: how many ships each team has, and a warning when that is no match. */
  const summary = h('div.team-summary', { 'aria-live': 'polite', hidden: '' });
  const crewActions = h('div.items.items--row.crew-actions', { 'data-section': 'crew-actions' });
  const overview = h('section.crew-overview', null,
    h('div.crew-overview__heading', null, h('h3', null, t('players.overview'))),
    h('div.crew-overview__metrics', null, shipsMetric.el, humansMetric.el, cpusMetric.el, formatMetric.el),
    h('p.crew-overview__note', null, t('players.note')),
    summary,
    crewActions,
  );
  const roster = h('section.crew-roster', null,
    h('div.crew-roster__heading', null,
      h('h3.setup__title', null, t('players.group.crew', { n: seats.length, max: MAX_PLAYERS })),
      h('p', null, t('players.rosterHint')),
    ),
    h('div.items.crew-roster__grid', { 'data-section': 'seats' }),
  );
  const update = (): void => {
    const active = activeSeats(s);
    const humans = active.filter((i) => s.seats[i] === 'human').length;
    shipsMetric.value.textContent = `${active.length}/${MAX_PLAYERS}`;
    humansMetric.value.textContent = String(humans);
    cpusMetric.value.textContent = String(active.length - humans);
    formatMetric.value.textContent = s.teamMode ? t('players.teams', { n: s.teamMode }) : t('players.ffa');
    summary.hidden = !s.teamMode;
    if (!s.teamMode) return;
    const valid = seatTeamsFor(s, active) !== null;
    summary.classList.toggle('is-warning', !valid);
    summary.replaceChildren(
      h('span.team-summary__label', null, t('players.teamDistribution')),
      ...teamCounts(s).map((n, k) => {
        const dot = h('span.item__swatch', null);
        dot.style.background = TEAMS[k][0];
        return h('span.team-chip', null, dot, h('span', null, teamName(k)), h('strong', null, String(n)));
      }),
      ...(valid ? [] : [h('span.team-warning', null, t('players.teamNote'))]),
    );
  };

  return {
    build: () => menuPage({
      title: t('flow.crewTitle'), eyebrow: t('briefing.crew'), intro: t('flow.crewIntro'), className: 'menu-page--crew',
      body: [h('div.crew-config', null, menuGroup(t('players.group.mode'), 'mode'), overview), roster],
      keys: t('flow.tabKeys'),
      footer: h('div.items.items--row.menu-page__actions', { 'data-section': 'actions' }),
    }),
    items: [
      mode,
      ...seats.map(seat),
      ...(seats.length < MAX_PLAYERS ? [add(t('flow.addPilot'), 'human')] : []),
      ...(s.teamMode
        ? [
            {
              kind: 'action',
              section: 'crew-actions',
              label: t('players.balance'),
              run: () => {
                balanceTeams(s);
                app.settingsChanged();
                app.menu.refresh();
              },
            } satisfies MenuItem,
          ]
        : []),
      { kind: 'action', section: 'actions', label: t('players.done'), primary: true, run: () => app.menu.back() },
    ],
    update,
  };
}

/** Keep each crew edit's remembered CPU choices across the screen's language/team rebuilds. */
function openPlayers(app: App): void {
  const lastCpuBySeat = new Map<number, Seat>();
  app.menu.push(() => playersScreen(app, lastCpuBySeat));
}

/** The settings that are plain on/off switches. */
type BooleanSetting = { [P in keyof Settings]: Settings[P] extends boolean ? P : never }[keyof Settings];

/** A switch for one on/off setting. */
function settingToggle(app: App, label: string, key: BooleanSetting): MenuItem {
  return {
    kind: 'toggle',
    label,
    get: () => app.settings[key],
    set: (v) => {
      app.settings[key] = v;
      app.settingsChanged();
    },
  };
}

/** A concise briefing; the complete rules are one step away. Existing custom rules are preserved. */
function setupScreen(app: App, mode: VersusMode, transition?: ModeTransition): Screen {
  const s = app.settings;
  const presets = presetsForMode(mode);
  const summary = h('dl.briefing__facts', { 'aria-live': 'polite' });
  const crew = h('div.briefing__crew', { 'aria-hidden': 'true' });
  const crewLabel = h('p.briefing__lineup', null);
  const quickKeys = ['rounds', 'maxPlanets', 'powerUps'] as const;
  const quick = ruleItems(mode, {
    get: () => rulesOf(s),
    patch: (values) => { Object.assign(s, values); app.settingsChanged(); },
  }).filter(({ key }) => quickKeys.some((quickKey) => quickKey === key));
  const update = (): void => {
    crewLabel.textContent = lineup(s);
    crew.replaceChildren(...activeSeats(s).map((i) => {
      const marker = h('span.briefing__ship', null, '▲');
      marker.style.color = COLORS.players[i];
      return marker;
    }));
    const fact = (label: string, value: string) => h('div', null, h('dt', null, label), h('dd', null, value));
    summary.replaceChildren(
      fact(t('settings.shotTime'), t('settings.seconds', { n: s.shotTime })),
      fact(t('settings.bounce'), t(s.bounce ? 'common.on' : 'common.off')),
      fact(t('settings.hiddenAim'), t(s.hiddenAim ? 'common.on' : 'common.off')),
    );
  };
  return {
    build: () => {
      const page = menuPage({
        title: modeName(mode), eyebrow: t('launcher.prepare'), intro: t(`mode.${mode}.hint` as Key),
        headerAside: h('nav.items.items--row.mode-pager', { 'data-section': 'mode-pager', 'aria-label': t('launcher.switchMode') }),
        className: `menu-page--briefing menu-page--mode-pager${transition ? ` menu-page--mode-enter-${transition}` : ''}`,
        body: [
          h('section.briefing__presets', { 'aria-labelledby': 'preset-heading' },
            h('div.launcher__section-head', null, h('h3', { id: 'preset-heading' }, t('preset.choose'))),
            h('div.items.items--row.briefing__cards', { 'data-section': 'presets', role: 'group', 'aria-label': t('preset.choose') }),
            h('div.briefing__quick', { 'data-section': 'quick' }),
          ),
        ],
        aside: [
          h('h3.setup__title', null, t('briefing.crew')),
          crew, crewLabel,
          h('p.briefing__crew-note', null, t('briefing.crewHint')),
          h('div.items.briefing__players', { 'data-section': 'players' }),
          h('h3.setup__title', null, t('briefing.rules')),
          summary,
          h('div.items.briefing__edit', { 'data-section': 'edit' }),
        ],
        keys: t('briefing.keys'),
        footer: h('div.items.items--row.menu-page__actions', { 'data-section': 'actions' }),
      });
      enableModeSwipe(page, app, mode);
      return page;
    },
    items: [
      ...modePagerItems(app, mode),
      ...presets.map((preset): MenuItem => ({
        kind: 'action', section: 'presets', label: t(`preset.${preset}` as Key), hint: t(`preset.${preset}.hint` as Key),
        icon: () => modeArt(preset === 'simultaneous' ? 'simultaneous' : preset === 'standard' ? 'classic' : preset, mode === 'horizon' && preset !== 'simultaneous' ? { mode: 'horizon', preset } : undefined),
        selected: () => matchingPreset(rulesOf(s), mode) === preset,
        run: () => { Object.assign(s, presetRules(preset)); app.settingsChanged(); app.menu.refresh(); },
      })),
      ...quick.map(({ item }): MenuItem => ({ ...item, section: 'quick' })),
      { kind: 'action', section: 'players', label: t('briefing.editCrew'), run: () => openPlayers(app) },
      { kind: 'action', section: 'edit', label: t('briefing.editRules'), run: () => app.menu.push(() => rulesScreen(app, mode)) },
      { kind: 'action', section: 'actions', label: t('common.back'), run: () => app.menu.back() },
      { kind: 'action', section: 'actions', label: t('setup.start'), primary: true, run: () => app.start(mode) },
    ],
    // Enter keeps the quick route into the game; the presets remain a click or arrow away.
    focus: MAIN_MODES.length + presets.length + quick.length + 3,
    update,
  };
}

/** All rules, grouped by subject, without overwhelming the match briefing. */
function rulesScreen(app: App, mode: VersusMode, mayhem = false): Screen {
  const source: RuleSource = {
    get: () => rulesOf(app.settings),
    patch: (values) => {
      Object.assign(app.settings, values);
      app.settingsChanged();
    },
  };
  const rules = ruleItems(mode, source);
  if (mayhem) rules.push(...ruleItems(mode, source, false, true).filter(({ key }) => key === 'mayhem'));
  const groups = RULE_GROUPS.filter((group) => rules.some((r) => r.group === group));
  let category = groups[0];
  const heading = h('h3.setup__title', null);
  const rows: MenuItem[] = rules.map(({ group, item }): MenuItem => ({
    ...item, section: 'fields',
    hidden: () => category !== group || (item.hidden?.() ?? false),
    reserve: () => category === group && (item.reserve?.() ?? false),
  }));
  return {
    build: () => menuPage({
      title: t('briefing.editRules'), eyebrow: mayhem ? t('mode.mayhem') : modeName(mode), intro: t('flow.rulesIntro'), className: 'menu-page--rules',
      body: [h('div.category-editor', null,
        h('nav.items.category-nav', { 'data-section': 'categories', 'aria-label': t('briefing.rules') }),
        h('div.category-editor__fields', null, heading, h('div.setup__rows', { 'data-section': 'fields' })),
      )],
      keys: t('briefing.keys'),
      footer: h('div.items.items--row.menu-page__actions', { 'data-section': 'actions' }),
    }),
    items: [
      ...groups.map((group): MenuItem => ({
        kind: 'action', section: 'categories', label: groupTitle(group), selected: () => category === group,
        run: () => { category = group; app.menu.refresh(); },
      })),
      ...rows,
      { kind: 'action', section: 'actions', label: t('setup.reset'), run: () => {
        if (mayhem) {
          Object.assign(app.settings, rulesOf(DEFAULT_SETTINGS), { mayhem: 2, mayhemBase: mode });
        } else {
          Object.assign(app.settings, rulesOf(DEFAULT_SETTINGS));
        }
        app.settingsChanged(); app.menu.refresh();
      } },
      { kind: 'action', section: 'actions', label: t('briefing.done'), primary: true, run: () => app.menu.back() },
    ],
    update: () => { heading.textContent = groupTitle(category); },
    focus: 0,
  };
}

/** Mayhem uses the same briefing layout as Classic and Event Horizon, with its own four setup presets. */
function mayhemScreen(app: App, transition?: ModeTransition): Screen {
  const s = app.settings;
  // The strength is never "off" here: a Mayhem game always has twists.
  if (!s.mayhem) s.mayhem = 2;
  const summary = h('dl.briefing__facts', { 'aria-live': 'polite' });
  const crew = h('div.briefing__crew', { 'aria-hidden': 'true' });
  const crewLabel = h('p.briefing__lineup', null);
  const quickKeys = ['rounds', 'mayhem', 'shotTime'] as const;
  const quick = ruleItems('classic', {
    get: () => rulesOf(s),
    patch: (values) => {
      Object.assign(s, values);
      app.settingsChanged();
    },
  }, false, true).filter(({ key }) => quickKeys.some((quickKey) => quickKey === key));
  const update = (): void => {
    crewLabel.textContent = lineup(s);
    crew.replaceChildren(...activeSeats(s).map((i) => {
      const marker = h('span.briefing__ship', null, '▲');
      marker.style.color = COLORS.players[i];
      return marker;
    }));
    const fact = (label: string, value: string) => h('div', null, h('dt', null, label), h('dd', null, value));
    summary.replaceChildren(
      fact(t('settings.mayhem'), t(`settings.mayhem.${s.mayhem}` as Key)),
      fact(t('mayhem.base'), modeName(s.mayhemBase)),
      fact(t('settings.rounds'), s.rounds ? String(s.rounds) : t('settings.endless')),
      fact(t('settings.simultaneousShots'), t(s.mayhemBase === 'horizon' || s.simultaneousShots ? 'common.on' : 'common.off')),
      fact(t('settings.shotTime'), t('settings.seconds', { n: s.shotTime })),
    );
  };
  return {
    build: () => {
      const page = menuPage({
        title: t('mode.mayhem'), eyebrow: t('launcher.prepare'), intro: t('mode.mayhem.hint'),
        headerAside: h('nav.items.items--row.mode-pager', { 'data-section': 'mode-pager', 'aria-label': t('launcher.switchMode') }),
        className: `menu-page--briefing menu-page--mayhem menu-page--mode-pager${transition ? ` menu-page--mode-enter-${transition}` : ''}`,
        body: [
          h('section.briefing__presets', { 'aria-labelledby': 'preset-heading' },
            h('div.launcher__section-head', null, h('h3', { id: 'preset-heading' }, t('preset.choose'))),
            h('div.items.items--row.briefing__cards', { 'data-section': 'presets', role: 'group', 'aria-label': t('preset.choose') }),
            h('p.briefing__preset-note', null, t('mayhem.preset.note')),
            h('div.briefing__quick', { 'data-section': 'quick' }),
          ),
        ],
        aside: [
          h('h3.setup__title', null, t('briefing.crew')),
          crew, crewLabel,
          h('p.briefing__crew-note', null, t('briefing.crewHint')),
          h('div.items.briefing__players', { 'data-section': 'players' }),
          h('h3.setup__title', null, t('briefing.rules')),
          summary,
          h('div.items.briefing__edit', { 'data-section': 'edit' }),
        ],
        keys: t('briefing.keys'),
        footer: h('div.items.items--row.menu-page__actions', { 'data-section': 'actions' }),
      });
      enableModeSwipe(page, app, 'mayhem');
      return page;
    },
    items: [
      ...modePagerItems(app, 'mayhem'),
      ...MAYHEM_PRESETS.map((preset): MenuItem => ({
        kind: 'action', section: 'presets', label: t(preset.key),
        icon: () => modeArt(preset.base, { mode: 'mayhem', preset: preset.art }), selected: () => matchingMayhemPreset(s) === preset,
        run: () => {
          s.mayhem = preset.strength;
          s.mayhemBase = preset.base;
          s.simultaneousShots = preset.simultaneousShots;
          app.settingsChanged();
          app.menu.refresh();
        },
      })),
      ...quick.map(({ item }): MenuItem => ({ ...item, section: 'quick' })),
      { kind: 'action', section: 'players', label: t('briefing.editCrew'), run: () => openPlayers(app) },
      { kind: 'action', section: 'edit', label: t('briefing.editRules'), run: () => app.menu.push(() => rulesScreen(app, s.mayhemBase, true)) },
      { kind: 'action', section: 'actions', label: t('common.back'), run: () => app.menu.back() },
      { kind: 'action', section: 'actions', label: t('setup.start'), primary: true, run: () => app.start(s.mayhemBase, true) },
    ],
    focus: MAIN_MODES.length + MAYHEM_PRESETS.length + quick.length + 3,
    update,
  };
}

type PreferenceCategory = 'display' | 'device' | 'language' | 'touch';
let preferenceCategory: PreferenceCategory = 'display';

/** Only what concerns this device; the rules of a game live on the setup screen. */
function settingsScreen(app: App): Screen {
  const categories: { key: PreferenceCategory; label: string }[] = [
    { key: 'display', label: t('shell.display') }, { key: 'device', label: t('shell.soundDevice') },
    { key: 'language', label: t('common.language') },
    ...(matchMedia('(pointer: coarse)').matches ? [{ key: 'touch' as const, label: t('shell.touch') }] : []),
  ];
  if (!categories.some(({ key }) => key === preferenceCategory)) preferenceCategory = 'display';
  const heading = h('h3.setup__title', null);
  const inCategory = (item: MenuItem, category: PreferenceCategory): MenuItem => {
    const wasHidden = item.hidden;
    const wasReserved = 'reserve' in item ? item.reserve : undefined;
    return {
      ...item,
      section: 'fields',
      hidden: () => preferenceCategory !== category || (wasHidden?.() ?? false),
      ...(wasReserved ? { reserve: () => preferenceCategory === category && wasReserved() } : {}),
    } as MenuItem;
  };
  return {
    build: () => menuPage({
      title: t('common.settings'), eyebrow: t('shell.device'), intro: t('settings.note'), className: 'menu-page--settings',
      body: [h('div.category-editor', null,
        h('nav.items.category-nav', { 'data-section': 'categories', 'aria-label': t('common.settings') }),
        h('div.category-editor__fields', null, heading, h('div.setup__rows', { 'data-section': 'fields' })),
      )],
      keys: t('briefing.keys'),
      footer: h('div.items.items--row.menu-page__actions', { 'data-section': 'actions' }),
    }),
    update: () => { heading.textContent = categories.find(({ key }) => key === preferenceCategory)!.label; },
    items: [
      ...categories.map(({ key, label }): MenuItem => ({ kind: 'action', section: 'categories', label, selected: () => preferenceCategory === key, run: () => { preferenceCategory = key; app.menu.refresh(); } })),
      inCategory(settingToggle(app, t('settings.contours'), 'contours'), 'display'),
      inCategory(settingToggle(app, t('settings.particles'), 'particles'), 'display'),
      inCategory(settingToggle(app, t('settings.menuBackground'), 'menuBackground'), 'display'),
      // Only a touch screen has the stick.
      ...(matchMedia('(pointer: coarse)').matches
        ? [
            {
              kind: 'segmented' as const,
              section: 'fields', hidden: () => preferenceCategory !== 'touch',
              label: t('settings.stickSide'),
              options: [
                { value: 'left', label: t('settings.stickLeft') },
                { value: 'right', label: t('settings.stickRight') },
              ],
              get: () => app.settings.stickSide,
              set: (v: unknown) => {
                app.settings.stickSide = v === 'right' ? 'right' : 'left';
                app.settingsChanged();
              },
            },
          ]
        : []),
      inCategory(settingToggle(app, t('settings.sound'), 'sound'), 'device'),
      {
        kind: 'toggle',
        label: t('settings.fullscreen'),
        section: 'fields', hidden: () => preferenceCategory !== 'device',
        get: () => app.isFullscreen(),
        set: () => app.toggleFullscreen(),
      },
      inCategory(languageItem(app), 'language'),
      { kind: 'action', section: 'actions', label: t('briefing.done'), primary: true, run: () => app.menu.back() },
    ],
  };
}

/** One page of the tutorial: a heading and what goes under it. */
interface Lesson {
  title: string;
  demo: TutorialPreviewKind;
  body: (Node | string)[];
  powerUps?: readonly PowerUpKind[];
  tricks?: readonly StyleKind[];
}

const kbd = (k: string) => h('kbd', null, k);
const para = (text: string) => h('p', null, text);
const keyRow = (keys: (Node | string)[], text: string) => h('tr', null, h('th', { scope: 'row' }, ...keys), h('td', null, text));
const keysTable = (...rows: HTMLElement[]) => h('table.keys-table', null, h('tbody', null, ...rows));

/** The kind's symbol, drawn small on a canvas in its own colour, for the power-up legend. */
function powerIcon(kind: PowerUpKind): HTMLCanvasElement {
  const dpr = typeof devicePixelRatio === 'number' ? Math.max(1, devicePixelRatio) : 1;
  const size = 22;
  const icon = h('canvas.power-icon', { width: String(Math.round(size * dpr)), height: String(Math.round(size * dpr)), 'aria-hidden': 'true' }) as HTMLCanvasElement;
  const ctx = icon.getContext('2d');
  if (ctx) {
    ctx.scale(dpr, dpr);
    ctx.translate(size / 2, size / 2);
    ctx.strokeStyle = ctx.fillStyle = POWER_UP_COLORS[kind];
    ctx.lineWidth = 1.8;
    ctx.lineCap = ctx.lineJoin = 'round';
    drawPowerUpSymbol(ctx, kind, 0, 0, size * 0.34);
  }
  return icon;
}

/** A small line symbol for each trick-shot selector. */
function trickIcon(kind: StyleKind): HTMLCanvasElement {
  const dpr = typeof devicePixelRatio === 'number' ? Math.max(1, devicePixelRatio) : 1;
  const size = 22;
  const icon = h('canvas.trick-icon', { width: String(Math.round(size * dpr)), height: String(Math.round(size * dpr)), 'aria-hidden': 'true' }) as HTMLCanvasElement;
  const ctx = icon.getContext('2d');
  if (!ctx) return icon;
  ctx.scale(dpr, dpr);
  ctx.strokeStyle = COLORS.sodium;
  ctx.fillStyle = COLORS.sodium;
  ctx.lineWidth = 1.6;
  ctx.lineCap = ctx.lineJoin = 'round';
  if (kind === 'swingby') {
    ctx.beginPath(); ctx.arc(15, 14, 4, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(1, 19); ctx.quadraticCurveTo(7, 20, 9, 15); ctx.quadraticCurveTo(11, 8, 17, 9); ctx.stroke();
  } else if (kind === 'bank') {
    ctx.beginPath(); ctx.moveTo(2, 18); ctx.lineTo(16, 4); ctx.lineTo(20, 8); ctx.lineTo(8, 20); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(14, 4); ctx.lineTo(20, 4); ctx.lineTo(20, 10); ctx.stroke();
  } else if (kind === 'graze') {
    ctx.beginPath(); ctx.arc(14, 16, 5, Math.PI, 0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(1, 9); ctx.lineTo(20, 9); ctx.stroke();
  } else if (kind === 'photon') {
    ctx.beginPath(); ctx.arc(11, 11, 3, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(11, 11, 9, 5, -0.55, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(19, 6, 1.5, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.setLineDash([2, 2]);
    ctx.beginPath(); ctx.moveTo(1, 17); ctx.bezierCurveTo(7, 15, 9, 6, 16, 7); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(17, 16, 4, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(17, 16); ctx.lineTo(17, 13); ctx.moveTo(17, 16); ctx.lineTo(19, 17); ctx.stroke();
  }
  return icon;
}

/** The kinds each power-up page lists: first the ones for your own shot, then the ones that go on the field. */
const POWER_PAGES: readonly [readonly PowerUpKind[], readonly PowerUpKind[]] = [
  ['preview', 'teleport', 'splitter', 'antigravity', 'piercing', 'plasma'],
  ['shield', 'blackhole', 'planetkiller', 'nebula', 'wormhole', 'defense'],
];
const TRICKS = Object.keys(STYLE_MULTIPLIER) as StyleKind[];

/** The pages of the tutorial, in order. Each one is built when it is shown, so its texts follow the language. */
const TUTORIAL: (() => Lesson)[] = [
  () => ({
    title: t('tutorial.welcome.title'),
    demo: 'welcome',
    body: [para(t('tutorial.welcome.1')), para(t('tutorial.welcome.2')), para(t('tutorial.welcome.3'))],
  }),
  () => ({
    title: t('tutorial.aim.title'),
    demo: 'aim',
    body: [
      para(t('tutorial.aim.1')),
      keysTable(
        keyRow([kbd('←'), ' ', kbd('→')], t('tutorial.aim.rotate')),
        keyRow([kbd('↑'), ' ', kbd('↓')], t('tutorial.aim.power')),
        keyRow([kbd('Enter')], t('tutorial.aim.fire')),
      ),
      para(t('tutorial.aim.2')),
    ],
  }),
  () => ({
    title: t('tutorial.gravity.title'),
    demo: 'gravity',
    body: [para(t('tutorial.gravity.1')), para(t('tutorial.gravity.2')), para(t('tutorial.gravity.3')), h('p.tutorial__tip', null, t('tutorial.gravity.tip'))],
  }),
  () => ({
    title: t('tutorial.round.title'),
    demo: 'round',
    body: [
      para(t('tutorial.round.1')),
      para(t('tutorial.round.2')),
      para(t('tutorial.round.3', { selfHit: SCORING.SELF_HIT, survivor: SCORING.SURVIVOR })),
      para(t('tutorial.round.4')),
    ],
  }),
  () => ({
    title: t('tutorial.horizon.title'),
    demo: 'horizon',
    body: [
      para(t('tutorial.horizon.1', { seconds: HORIZON.SHOT_CLOCK })),
      para(t('tutorial.horizon.2')),
      para(t('tutorial.horizon.3')),
      para(t('tutorial.horizon.4', { volley: SCORING.VOLLEY_SURVIVED, orbit: SCORING.LAST_IN_ORBIT })),
    ],
  }),
  () => ({
    title: t('tutorial.powerups.title'),
    demo: 'powerups',
    powerUps: POWER_PAGES[0],
    body: [para(t('tutorial.powerups.1')), para(t('tutorial.powerups.group1'))],
  }),
  () => ({
    title: t('tutorial.powerups.title2'),
    demo: 'powerupsField',
    powerUps: POWER_PAGES[1],
    body: [para(t('tutorial.powerups.2'))],
  }),
  () => ({
    title: t('tutorial.tricks.title'),
    demo: 'tricks',
    tricks: TRICKS,
    body: [para(t('tutorial.tricks.1'))],
  }),
  () => ({
    title: t('tutorial.daily.title'),
    demo: 'daily',
    body: [
      para(t('tutorial.daily.1')),
      para(t('tutorial.daily.2')),
      para(t('tutorial.daily.3', { bonus: CHALLENGE.CLEAR_BONUS, selfHit: SCORING.SELF_HIT })),
      para(t('tutorial.daily.4')),
    ],
  }),
  () => ({
    title: t('tutorial.keys.title'),
    demo: 'keys',
    body: [
      para(t('tutorial.keys.1')),
      keysTable(
        keyRow([kbd(t('common.space'))], t('tutorial.keys.space')),
        keyRow([kbd('C')], t('tutorial.keys.clip')),
        keyRow([kbd('Esc')], t('tutorial.keys.menu')),
        keyRow([kbd('F')], t('tutorial.keys.fullscreen')),
      ),
      para(t('tutorial.keys.2')),
    ],
  }),
];

/**
 * How to play: chapters are selected from the sidebar or with keyboard navigation.
 * The page is kept in this closure, so a rebuild (say, after a language switch) stays on the same page.
 */
function tutorialScreen(app: App): () => Screen {
  let page = 0;
  let selectedPowerUp: PowerUpKind = POWER_PAGES[0][0];
  let selectedTrick: StyleKind = TRICKS[0];
  let preview: ReturnType<typeof mountTutorialPreview> | null = null;
  return (): Screen => {
    const lessons = TUTORIAL.map((lesson) => lesson());
    const powerUps = lessons[page].powerUps ?? [];
    const tricks = lessons[page].tricks ?? [];
    if (powerUps.length && !powerUps.includes(selectedPowerUp)) selectedPowerUp = powerUps[0];
    if (tricks.length && !tricks.includes(selectedTrick)) selectedTrick = tricks[0];
    const canvas = h('canvas.tutorial__canvas', { 'aria-hidden': 'true' }) as HTMLCanvasElement;
    const timeline = h('input.tutorial__timeline', {
      type: 'range', min: '0', max: '1000', step: '1', value: '0',
      'aria-label': t('tutorial.preview.timeline'),
    }) as HTMLInputElement;
    timeline.addEventListener('input', () => preview?.seek(Number(timeline.value) / 1000));
    return {
      build: () => {
        const previewPanel = h('section.tutorial__preview', { 'aria-label': t('tutorial.preview.aria') },
          h('div.tutorial__preview-head', null,
            h('span.tutorial__preview-label', null, t('tutorial.preview.label')),
            powerUps.length ? h('span.tutorial__preview-choice', null, t(`powerup.${selectedPowerUp}` as Key))
              : tricks.length ? h('span.tutorial__preview-choice', null, styleLabel(selectedTrick)) : '',
          ),
          canvas,
          h('div.tutorial__transport', null,
            timeline,
            h('div.items', { 'data-section': 'preview-action' }),
          ),
        );
        preview = mountTutorialPreview(canvas, lessons[page].demo, (progress) => {
          timeline.value = String(Math.round(progress * 1000));
        }, powerUps.length ? selectedPowerUp : undefined, tricks.length ? selectedTrick : undefined);
        const powerContent: (Node | string)[] = powerUps.length
          ? [
              h('p.tutorial__selection-prompt', null, t('tutorial.powerups.choose')),
              h('nav.tutorial__selection-grid.items', { 'data-section': 'powerups', 'aria-label': t('tutorial.powerups.choose') }),
              h('section.tutorial__selection-info', { 'aria-live': 'polite' },
                h('div.tutorial__selection-icon', null, powerIcon(selectedPowerUp)),
                h('div', null,
                  h('h4', { style: `color: ${POWER_UP_COLORS[selectedPowerUp]}` }, t(`powerup.${selectedPowerUp}` as Key)),
                  h('p', null, t(`tutorial.powerups.${selectedPowerUp}` as Key)),
                ),
              ),
            ]
          : [];
        const trickContent: (Node | string)[] = tricks.length
          ? [
              h('p.tutorial__selection-prompt', null, t('tutorial.tricks.choose')),
              h('nav.tutorial__selection-grid.items', { 'data-section': 'tricks', 'aria-label': t('tutorial.tricks.choose') }),
              h('section.tutorial__selection-info', { 'aria-live': 'polite' },
                h('div.tutorial__selection-icon', null, trickIcon(selectedTrick)),
                h('div', null,
                  h('div.tutorial__selection-heading', null,
                    h('h4', null, styleLabel(selectedTrick)),
                    h('span.tutorial__selection-multiplier', null, `×${fmtNum(STYLE_MULTIPLIER[selectedTrick])}`),
                  ),
                  h('p', null, t(`style.${selectedTrick}.text` as Key)),
                ),
              ),
            ]
          : [];
        return menuPage({
          title: t('common.help'), eyebrow: t('shell.flightSchool'), className: 'menu-page--tutorial',
          body: [h('article.tutorial', { 'aria-live': 'polite' },
            h('p.eyebrow', null, t('tutorial.step', { n: page + 1, total: TUTORIAL.length })),
            h('h3.tutorial__title', null, lessons[page].title),
            h('div.tutorial__layout', null,
              h('div.tutorial__copy', null, ...lessons[page].body, ...powerContent, ...trickContent),
              previewPanel,
            ),
          )],
          aside: [h('nav.items.tutorial-chapters', { 'data-section': 'chapters', 'aria-label': t('shell.chapters') })],
          footer: h('div.items.items--row.menu-page__actions', { 'data-section': 'actions' }),
        });
      },
      items: [
        ...lessons.map((lesson, i): MenuItem => ({
          kind: 'action', section: 'chapters', label: lesson.title, selected: () => page === i,
          run: () => { page = i; app.menu.rebuild(); },
        })),
        ...powerUps.map((kind): MenuItem => ({
          kind: 'action', section: 'powerups', label: t(`powerup.${kind}` as Key),
          icon: () => powerIcon(kind), selected: () => selectedPowerUp === kind,
          run: () => { selectedPowerUp = kind; app.menu.rebuild(); },
        })),
        ...tricks.map((kind): MenuItem => ({
          kind: 'action', section: 'tricks', label: styleLabel(kind),
          icon: () => trickIcon(kind), selected: () => selectedTrick === kind,
          run: () => { selectedTrick = kind; app.menu.rebuild(); },
        })),
        { kind: 'action', section: 'preview-action', label: t('tutorial.preview.replay'), run: () => { timeline.value = '0'; preview?.replay(); } },
        { kind: 'action', section: 'actions', label: t('briefing.done'), primary: true, run: () => app.menu.back() },
      ],
      // Keep focus on this chapter so ↑/↓ navigates the lesson list.
      focus: page,
      dispose: () => {
        preview?.dispose();
        preview = null;
      },
    };
  };
}

export function gameOverScreen(app: App, match: Match): Screen {
  const winner = match.winner();
  const headline = !winner ? t('over.draw') : match.teamMode ? t('over.teamWins', { team: winner.name }) : t('over.wins', { name: winner.name });
  const entry = (place: number, name: string, color: string, score: number | string) => {
    const label = h('span.ranking__name', null, name);
    label.style.color = color;
    return h('li', null, h('span.ranking__place', null, `${place}.`), label, h('span.ranking__score', null, String(score)));
  };
  return {
    build: () => {
      const lists: Element[] = [];
      if (match.teamMode) {
        // Teams first; the individual standings follow, smaller.
        lists.push(h('ol.ranking', null, ...match.teamRanking().map((r, i) => entry(i + 1, t('team.name', { team: teamName(r.team) }), TEAMS[r.team][0], r.score))));
        lists.push(h('p.ranking-label', null, t('over.players')));
        lists.push(h('ol.ranking.ranking--small', null, ...match.ranking().map((p, i) => entry(i + 1, p.name, p.color, p.score))));
      } else {
        lists.push(h('ol.ranking', null, ...match.ranking().map((p, i) => entry(i + 1, p.name, p.color, p.score))));
      }
      const chart = scoreChart(match);
      if (chart) lists.push(h('p.ranking-label', null, t('scorecard.history')), chart);
      // Mayhem: what every round was about and who took it.
      if (match.mayhemHistory.length) lists.push(h('p.ranking-label', null, t('mayhem.recap')), h('ul.highlights', null, ...roundRecap(match)));
      // The match's records, e.g. the longest shot of all rounds.
      const highlights = awards(match.matchStats).map((award) => {
        const who = awardWho(match, award);
        const name = h('span.highlights__who', null, who.name);
        name.style.color = who.color;
        return h('li', null, h('span.highlights__label', null, awardLabel(award.kind)), name, h('span.highlights__value', null, awardValue(award)));
      });
      if (highlights.length) lists.push(h('p.ranking-label', null, t('scorecard.match')), h('ul.highlights', null, ...highlights));
      // The stands play the same game: whoever read the rounds best.
      const seers = match.stands.ranking();
      if (seers.length) {
        const rows = seers.slice(0, 10).map(({ player, score }, i) => entry(i + 1, match.crowd.seat(player)?.name ?? '?', COLORS.bone, `${fmtInt(score.points)}  ·  ${score.right}/${score.total}`));
        lists.push(h('p.ranking-label', null, t('stands.standings')), h('ol.ranking.ranking--small', null, ...rows));
      }
      // The eliminated players' side standings.
      const tipsters = match.oracle.ranking();
      if (tipsters.length) {
        const rows = tipsters.map(({ player, score }, i) => entry(i + 1, match.players[player].name, match.players[player].color, `${fmtInt(score.points)}  ·  ${score.right}/${score.total}`));
        lists.push(h('p.ranking-label', null, t('oracle.match')), h('ol.ranking.ranking--small', null, ...rows));
        // Their honours: the prophet, the seer, the lone wolf …
        const honours = oracleAwards(match.oracle.scores, 'match').flatMap((award) => {
          const who = match.players[award.player];
          if (!who) return [];
          const name = h('span.highlights__who', null, who.name);
          name.style.color = who.color;
          return [h('li', null, h('span.highlights__label', null, t(`oracle.award.${award.kind}`)), name, h('span.highlights__value', null, t(`oracle.awardValue.${award.kind}`, { n: award.value })))];
        });
        if (honours.length) lists.push(h('p.ranking-label', null, t('oracle.awards')), h('ul.highlights', null, ...honours));
      }
      const page = menuPage({
        title: headline, eyebrow: t('over.label'), intro: tn('over.after', match.round), className: 'menu-page--results',
        body: [h('div.match-report', null, ...lists)],
      });
      if (winner) page.style.setProperty('--winner', winner.color);
      return page;
    },
    items: [
      app.online
        ? { kind: 'action', label: t('multiplayer.toLobby'), run: () => app.toLobby() }
        : { kind: 'action', label: t('common.mainMenu'), run: () => app.toTitle() },
      match.canAdvance
        ? { kind: 'action', label: t('over.rematch'), primary: true, run: () => app.rematch() }
        : { kind: 'action', label: t('over.rematch'), hint: t('over.hostRematch'), disabled: true, run: () => {} },
    ],
    focus: 1,
    onEscape: () => (app.online ? app.toLobby() : app.toTitle()),
  };
}

/** One line per round of a Mayhem match: its twists, and whoever scored most in it. */
function roundRecap(match: Match): Element[] {
  return match.mayhemHistory.map((round, i) => {
    const before = match.scoreHistory[i] ?? [];
    const after = match.scoreHistory[i + 1] ?? [];
    let best = -1;
    let gain = 0;
    match.players.forEach((_p, id) => {
      const delta = (after[id] ?? 0) - (before[id] ?? 0);
      if (delta > gain) {
        best = id;
        gain = delta;
      }
    });
    const winner = best >= 0 ? match.players[best] : null;
    const who = h('span.highlights__who', null, winner?.name ?? '');
    if (winner) who.style.color = winner.color;
    return h('li', null, h('span.highlights__label', null, `${i + 1}. ${roundTitle(round)}`), who, h('span.highlights__value', null, winner ? `+${fmtInt(gain)}` : ''));
  });
}

/** Everybody's score after every round as lines, so you can see who caught up when. Needs at least two rounds. */
function scoreChart(match: Match): SVGElement | null {
  const history = match.scoreHistory;
  if (history.length < 3) return null;
  const W = 340;
  const H = 96;
  const pad = 8;
  const scores = history.flat();
  const lo = Math.min(0, ...scores);
  const hi = Math.max(0, ...scores);
  const x = (round: number) => pad + (round / (history.length - 1)) * (W - 2 * pad);
  const y = (score: number) => H - pad - ((score - lo) / (hi - lo || 1)) * (H - 2 * pad);
  const el = (tag: string, attrs: Record<string, string>): SVGElement => {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
    return node as SVGElement;
  };
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'score-chart', role: 'img', 'aria-label': t('scorecard.history') });
  svg.append(el('line', { x1: String(pad), x2: String(W - pad), y1: String(y(0)), y2: String(y(0)), class: 'score-chart__zero' }));
  // Leaders last, so their lines are on top.
  for (const p of [...match.players].sort((a, b) => a.score - b.score)) {
    const points = history.map((row, round) => `${x(round).toFixed(1)},${y(row[p.id] ?? 0).toFixed(1)}`);
    svg.append(
      el('polyline', { points: points.join(' '), fill: 'none', stroke: p.color, 'stroke-width': '2', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }),
      el('circle', { cx: String(x(history.length - 1)), cy: String(y(history[history.length - 1][p.id] ?? 0)), r: '3', fill: p.color }),
    );
  }
  return svg;
}
