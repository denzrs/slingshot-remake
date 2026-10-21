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
import { modeIcon } from './mode-icons';
import { groupTitle, RULE_GROUPS, ruleItems } from './rules';

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
  openLobby(): void;
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

export function titleScreen(app: App): Screen {
  return {
    build: () =>
      h(
        'section.screen.screen--title',
        { 'aria-labelledby': 'wordmark' },
        h(
          'div.title-col',
          null,
          h('p.eyebrow', null, t('title.eyebrow')),
          h('h1.wordmark', { id: 'wordmark' }, 'Slingshot'),
          h('p.lede', null, t('title.lede')),
          h('nav.items', { 'data-items': '', 'aria-label': t('title.menuLabel') }),
          h('p.keys', null, t('title.keys')),
          // Set by the deploy workflow; local builds say so.
          h(
            'div.title-foot',
            null,
            h('p.version', null, String(import.meta.env.VITE_APP_VERSION || 'Local-Dev')),
            ...(import.meta.env.VITE_COFFEE_URL
              ? [coffeeButton()]
              : []),
          ),
        ),
      ),
    // A getter, so the lineup hint is fresh whenever the menu re-renders this screen.
    get items(): MenuItem[] {
      return [
        { kind: 'action', label: t('title.local'), hint: t('title.local.hint'), primary: true, run: () => app.menu.push(() => localScreen(app)) },
        { kind: 'action', label: t('multiplayer.title'), hint: t('multiplayer.hint'), run: () => app.openLobby() },
        { kind: 'action', label: t('common.settings'), run: () => app.menu.push(() => settingsScreen(app)) },
        { kind: 'action', label: t('common.help'), run: () => app.menu.push(tutorialScreen(app)) },
        languageItem(app),
      ];
    },
  };
}

/** The ways to play on this device, as a row of cards: the daily challenge and the three modes. */
function localScreen(app: App): Screen {
  const card = (label: string, hint: string, icon: Parameters<typeof modeIcon>[0], run: () => void, primary = false): MenuItem => ({ kind: 'action', section: 'cards', label, hint, icon: () => modeIcon(icon), primary, run });
  return {
    build: () =>
      h(
        'section.screen.screen--panel',
        { role: 'dialog', 'aria-modal': 'true', 'aria-label': t('title.local') },
        h(
          'div.panel.panel--cards',
          null,
          h('h2.panel__title', null, t('title.local')),
          h('div.items.items--row.items--cards', { 'data-section': 'cards' }),
          h('div.items.items--row', { 'data-section': 'back' }),
        ),
      ),
    items: [
      card(t('mode.daily'), dailyMenuHint(app.today()), 'daily', () => app.menu.push(() => dailyScreen(app)), true),
      card(t('mode.classic'), t('mode.classic.hint'), 'classic', () => app.menu.push(() => setupScreen(app, 'classic'))),
      card(t('mode.horizon'), t('mode.horizon.hint'), 'horizon', () => app.menu.push(() => setupScreen(app, 'horizon'))),
      card(t('mode.mayhem'), t('mode.mayhem.hint'), 'mayhem', () => app.menu.push(() => mayhemScreen(app))),
      { kind: 'action', section: 'back', label: t('common.back'), run: () => app.menu.back() },
    ],
  };
}

export function pauseScreen(app: App): Screen {
  const daily = app.mode === 'challenge';
  const mode = app.mode === 'classic' || app.mode === 'horizon' ? app.mode : null;
  return {
    build: () => panel(t('pause.title'), null),
    items: [
      { kind: 'action', label: t('pause.resume'), primary: true, run: () => app.resume() },
      // Online, the room decides: no restarts from the pause menu. The daily challenge has no setup, only a retry.
      ...(mode && !app.online ? [{ kind: 'action', label: t('pause.newGame'), run: () => app.menu.push(() => (app.mayhem ? mayhemScreen(app) : setupScreen(app, mode))) } satisfies MenuItem] : []),
      ...(daily ? [{ kind: 'action', label: t('daily.retry'), run: () => app.rematch() } satisfies MenuItem] : []),
      { kind: 'action', label: t('common.settings'), run: () => app.menu.push(() => settingsScreen(app)) },
      { kind: 'action', label: t('common.help'), run: () => app.menu.push(tutorialScreen(app)) },
      app.online
        ? { kind: 'action', label: t('multiplayer.toLobby'), run: () => app.toLobby() }
        : { kind: 'action', label: t('common.mainMenu'), run: () => app.toTitle() },
    ],
    onEscape: () => app.resume(),
  };
}

function playersScreen(app: App): Screen {
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
    section: 'actions',
    label,
    disabled: freeSeat(s) === null,
    run: () => {
      if (addSeat(s, flier) === null) return;
      app.settingsChanged();
      // The newcomer is the row after the last one (the mode bar comes first).
      app.menu.rebuild(1 + seats.length);
    },
  });

  /** In team play: how many ships each team has, and a warning when that is no match. */
  const summary = h('p.team-summary', { 'aria-live': 'polite' });
  const update = (): void => {
    summary.hidden = !s.teamMode;
    if (!s.teamMode) return;
    const valid = seatTeamsFor(s, activeSeats(s)) !== null;
    summary.classList.toggle('is-warning', !valid);
    summary.replaceChildren(
      ...teamCounts(s).map((n, k) => {
        const dot = h('span.item__swatch', null);
        dot.style.background = TEAMS[k][0];
        return h('span.team-chip', null, dot, `${teamName(k)} ${n}`);
      }),
      ...(valid ? [] : [h('span.team-warning', null, t('players.teamNote'))]),
    );
  };

  const block = (title: string, section: string) => h('section.setup__group', null, h('h3.setup__title', null, title), h('div.setup__rows', { 'data-section': section }));
  return {
    build: () =>
      h(
        'section.screen.screen--panel.screen--setup',
        { role: 'dialog', 'aria-modal': 'true', 'aria-label': t('common.players') },
        h(
          'div.panel.panel--players',
          null,
          h('h2.panel__title', null, t('common.players')),
          h('p.note', null, t('players.note')),
          block(t('players.group.mode'), 'mode'),
          block(t('players.group.crew', { n: seats.length, max: MAX_PLAYERS }), 'seats'),
          summary,
          h('div.items.items--row.items--actions', { 'data-section': 'actions' }),
        ),
      ),
    items: [
      mode,
      ...seats.map(seat),
      add(t('players.add.human'), 'human'),
      add(t('players.add.cpu'), 'medium'),
      ...(s.teamMode
        ? [
            {
              kind: 'action',
              section: 'actions',
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

/** The rules of a game, shown right before it starts. They are remembered between games. */
function setupScreen(app: App, mode: VersusMode): Screen {
  const rules = ruleItems(mode, {
    get: () => rulesOf(app.settings),
    patch: (values) => {
      Object.assign(app.settings, values);
      app.settingsChanged();
    },
  });
  const rows: MenuItem[] = rules.map(({ group, item }): MenuItem => ({ ...item, section: group }));
  const actions: MenuItem[] = [
    { kind: 'action', section: 'actions', label: t('setup.start'), primary: true, run: () => app.start(mode) },
    { kind: 'action', section: 'actions', label: t('common.players'), hint: lineup(app.settings), run: () => app.menu.push(() => playersScreen(app)) },
    {
      kind: 'action',
      section: 'actions',
      label: t('setup.reset'),
      run: () => {
        Object.assign(app.settings, rulesOf(DEFAULT_SETTINGS));
        app.settingsChanged();
        app.menu.refresh();
      },
    },
    { kind: 'action', section: 'actions', label: t('common.back'), run: () => app.menu.back() },
  ];
  return {
    build: () =>
      h(
        'section.screen.screen--panel.screen--setup',
        { role: 'dialog', 'aria-modal': 'true', 'aria-label': t(mode === 'classic' ? 'mode.classic' : 'mode.horizon') },
        h(
          'div.panel.panel--setup',
          null,
          h('h2.panel__title', null, t(mode === 'classic' ? 'mode.classic' : 'mode.horizon')),
          h('p.note', null, t('setup.note')),
          h(
            'div.setup',
            null,
            ...RULE_GROUPS.filter((group) => rules.some((r) => r.group === group)).map((group) => h('section.setup__group', null, h('h3.setup__title', null, groupTitle(group)), h('div.setup__rows', { 'data-section': group }))),
          ),
          h('div.items.items--row.items--actions', { 'data-section': 'actions' }),
          h('p.keys.keys--menu', null, t('setup.keys')),
        ),
      ),
    items: [...rows, ...actions],
    // Enter starts the game straight away, as it always did.
    focus: rows.length,
  };
}

/**
 * Mayhem: pick the mode the rounds are played in, how wild they get and who plays — that is all there is to set.
 * Every round then plays by twists of its own.
 */
function mayhemScreen(app: App): Screen {
  // The strength is never "off" here: a Mayhem game always has twists.
  if (!app.settings.mayhem) app.settings.mayhem = 2;
  // Every rule of the mode is built, and the Classic-only one hides while Event Horizon is picked.
  const rules = ruleItems('classic', {
    get: () => rulesOf(app.settings),
    patch: (values) => {
      Object.assign(app.settings, values);
      app.settingsChanged();
    },
  }, false, true);
  const base: MenuItem = {
    kind: 'segmented',
    section: 'match',
    label: t('mayhem.base'),
    options: [{ value: 'classic', label: t('mode.classic') }, { value: 'horizon', label: t('mode.horizon') }],
    get: () => app.settings.mayhemBase,
    set: (v) => {
      app.settings.mayhemBase = v as 'classic' | 'horizon';
      app.settingsChanged();
    },
  };
  const rows: MenuItem[] = [
    base,
    ...rules.map(({ key, group, item }): MenuItem => ({ ...item, section: group, ...(key === 'simultaneousShots' ? { hidden: () => app.settings.mayhemBase === 'horizon' } : {}) })),
  ];
  const actions: MenuItem[] = [
    { kind: 'action', section: 'actions', label: t('setup.start'), primary: true, run: () => app.start(app.settings.mayhemBase, true) },
    { kind: 'action', section: 'actions', label: t('common.players'), hint: lineup(app.settings), run: () => app.menu.push(() => playersScreen(app)) },
    { kind: 'action', section: 'actions', label: t('common.back'), run: () => app.menu.back() },
  ];
  return {
    build: () =>
      h(
        'section.screen.screen--panel.screen--setup',
        { role: 'dialog', 'aria-modal': 'true', 'aria-label': t('mode.mayhem') },
        h(
          'div.panel.panel--setup',
          null,
          h('h2.panel__title', null, t('mode.mayhem')),
          h('p.note', null, t('mayhem.note')),
          h('div.setup', null, h('section.setup__group', null, h('h3.setup__title', null, groupTitle('match')), h('div.setup__rows', { 'data-section': 'match' }))),
          h('div.items.items--row.items--actions', { 'data-section': 'actions' }),
          h('p.keys.keys--menu', null, t('setup.keys')),
        ),
      ),
    items: [...rows, ...actions],
    focus: rows.length,
  };
}

/** Only what concerns this device; the rules of a game live on the setup screen. */
function settingsScreen(app: App): Screen {
  return {
    build: () => panel(t('common.settings'), h('p.note', null, t('settings.note')), 'panel--medium'),
    items: [
      settingToggle(app, t('settings.contours'), 'contours'),
      settingToggle(app, t('settings.particles'), 'particles'),
      settingToggle(app, t('settings.sound'), 'sound'),
      {
        kind: 'toggle',
        label: t('settings.fullscreen'),
        get: () => app.isFullscreen(),
        set: () => app.toggleFullscreen(),
      },
      languageItem(app),
      { kind: 'action', label: t('common.back'), run: () => app.menu.back() },
    ],
  };
}

/** One page of the tutorial: a heading and what goes under it. */
interface Lesson {
  title: string;
  body: (Node | string)[];
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

/** A row of the power-up legend: the kind's symbol and its name in its own colour, and what it does. */
const powerRow = (kind: PowerUpKind) =>
  keyRow([powerIcon(kind), ' ', h('span.tutorial__power', { style: `color: ${POWER_UP_COLORS[kind]}` }, t(`powerup.${kind}` as Key))], t(`tutorial.powerups.${kind}` as Key));

/** The kinds each power-up page lists: first the ones for your own shot, then the ones that go on the field. */
const POWER_PAGES: readonly [readonly PowerUpKind[], readonly PowerUpKind[]] = [
  ['preview', 'teleport', 'splitter', 'antigravity', 'piercing', 'plasma'],
  ['shield', 'blackhole', 'planetkiller', 'nebula', 'wormhole', 'defense'],
];

/** A shot bent around a planet onto its target: the swing-by, as a picture. */
function gravityFigure(): HTMLElement {
  const figure = h('figure.tutorial__figure', { role: 'img', 'aria-label': t('tutorial.gravity.figure') });
  figure.innerHTML =
    '<svg viewBox="0 0 480 160" aria-hidden="true">' +
    '<circle cx="300" cy="100" r="62" fill="none" stroke="#5b7db3" stroke-opacity="0.4" stroke-dasharray="2 6"/>' +
    '<circle cx="300" cy="100" r="30" fill="#1d3a6b" stroke="#5b7db3" stroke-width="2"/>' +
    '<path d="M62 124 C150 112 190 34 268 42 C320 48 344 26 390 22" fill="none" stroke="#e8e4d8" stroke-width="2" stroke-dasharray="5 6" stroke-linecap="round"/>' +
    '<path d="M60 112 L72 138 L60 132 L48 138 Z" fill="#ff8660" transform="rotate(80 60 125)"/>' +
    '<circle cx="400" cy="22" r="11" fill="none" stroke="#ffd27a" stroke-width="2"/>' +
    '<circle cx="400" cy="22" r="3.5" fill="#ffd27a"/>' +
    '</svg>';
  return figure;
}

/** The pages of the tutorial, in order. Each one is built when it is shown, so its texts follow the language. */
const TUTORIAL: (() => Lesson)[] = [
  () => ({
    title: t('tutorial.welcome.title'),
    body: [para(t('tutorial.welcome.1')), para(t('tutorial.welcome.2')), para(t('tutorial.welcome.3'))],
  }),
  () => ({
    title: t('tutorial.aim.title'),
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
    body: [para(t('tutorial.gravity.1')), gravityFigure(), para(t('tutorial.gravity.2')), para(t('tutorial.gravity.3')), h('p.tutorial__tip', null, t('tutorial.gravity.tip'))],
  }),
  () => ({
    title: t('tutorial.round.title'),
    body: [
      para(t('tutorial.round.1')),
      para(t('tutorial.round.2')),
      para(t('tutorial.round.3', { selfHit: SCORING.SELF_HIT, survivor: SCORING.SURVIVOR })),
      para(t('tutorial.round.4')),
    ],
  }),
  () => ({
    title: t('tutorial.horizon.title'),
    body: [
      para(t('tutorial.horizon.1', { seconds: HORIZON.SHOT_CLOCK })),
      para(t('tutorial.horizon.2')),
      para(t('tutorial.horizon.3')),
      para(t('tutorial.horizon.4', { volley: SCORING.VOLLEY_SURVIVED, orbit: SCORING.LAST_IN_ORBIT })),
    ],
  }),
  () => ({
    title: t('tutorial.powerups.title'),
    body: [para(t('tutorial.powerups.1')), keysTable(...POWER_PAGES[0].map(powerRow))],
  }),
  () => ({
    title: t('tutorial.powerups.title2'),
    body: [keysTable(...POWER_PAGES[1].map(powerRow)), para(t('tutorial.powerups.2'))],
  }),
  () => ({
    title: t('tutorial.tricks.title'),
    body: [
      para(t('tutorial.tricks.1')),
      keysTable(...(Object.keys(STYLE_MULTIPLIER) as StyleKind[]).map((k) => keyRow([styleLabel(k)], `×${fmtNum(STYLE_MULTIPLIER[k])} – ${t(`style.${k}.text`)}`))),
    ],
  }),
  () => ({
    title: t('tutorial.daily.title'),
    body: [
      para(t('tutorial.daily.1')),
      para(t('tutorial.daily.2')),
      para(t('tutorial.daily.3', { bonus: CHALLENGE.CLEAR_BONUS, selfHit: SCORING.SELF_HIT })),
      para(t('tutorial.daily.4')),
    ],
  }),
  () => ({
    title: t('tutorial.keys.title'),
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
 * How to play: a short tutorial, one page at a time, turned with the buttons (← → and Enter work too).
 * The page is kept in this closure, so a rebuild (say, after a language switch) stays on the same page.
 */
function tutorialScreen(app: App): () => Screen {
  let page = 0;
  return (): Screen => {
    const last = page === TUTORIAL.length - 1;
    return {
      // Every page is in the DOM, only the current one is seen: the pages share one grid cell, so the
      // dialog is as tall as the longest page and the buttons stay in place while you turn them.
      build: () =>
        h(
          'section.screen.screen--panel',
          { role: 'dialog', 'aria-modal': 'true', 'aria-label': t('common.help') },
          h(
            'div.panel.panel--wide',
            null,
            h('h2.panel__title', null, t('common.help')),
            h(
              'div.tutorial',
              null,
              h('div.tutorial__progress', { 'aria-hidden': 'true' }, ...TUTORIAL.map((_, i) => h(i === page ? 'span.is-current' : i < page ? 'span.is-done' : 'span', null))),
              h(
                'div.tutorial__pages',
                null,
                ...TUTORIAL.map((lessonOf, i) => {
                  const lesson = lessonOf();
                  return h(
                    i === page ? 'div.tutorial__page.is-current' : 'div.tutorial__page',
                    null,
                    h('p.eyebrow', null, t('tutorial.step', { n: i + 1, total: TUTORIAL.length })),
                    h('h3.tutorial__title', null, lesson.title),
                    ...lesson.body,
                  );
                }),
              ),
            ),
            h('div.items.items--row', { 'data-section': 'pager' }),
          ),
        ),
      items: [
        {
          kind: 'action',
          section: 'pager',
          label: t('common.back'),
          run: () => {
            // On the first page, back leaves the tutorial.
            if (page === 0) {
              app.menu.back();
              return;
            }
            page -= 1;
            app.menu.rebuild();
          },
        },
        last
          ? { kind: 'action', section: 'pager', label: t('tutorial.done'), primary: true, run: () => app.menu.back() }
          : {
              kind: 'action',
              section: 'pager',
              label: t('common.next'),
              primary: true,
              run: () => {
                page += 1;
                app.menu.rebuild();
              },
            },
      ],
      // "Next" has the focus, so Enter turns the pages.
      focus: 1,
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
      const title = h('h2.result', null, headline);
      if (winner) title.style.color = winner.color;
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
      return h(
        'section.screen.screen--panel',
        { role: 'dialog', 'aria-modal': 'true', 'aria-label': t('over.label') },
        h(
          'div.panel.panel--result',
          null,
          h('p.eyebrow', null, tn('over.after', match.round)),
          title,
          ...lists,
          h('div.items.items--row', { 'data-items': '' }),
        ),
      );
    },
    items: [
      match.canAdvance
        ? { kind: 'action', label: t('over.rematch'), primary: true, run: () => app.rematch() }
        : { kind: 'action', label: t('over.rematch'), hint: t('over.hostRematch'), disabled: true, run: () => {} },
      app.online
        ? { kind: 'action', label: t('multiplayer.toLobby'), run: () => app.toLobby() }
        : { kind: 'action', label: t('common.mainMenu'), run: () => app.toTitle() },
    ],
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

function panel(title: string, body: HTMLElement | null, extraClass = ''): HTMLElement {
  return h(
    'section.screen.screen--panel',
    { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h(`div.panel${extraClass ? '.' + extraClass : ''}`, null, h('h2.panel__title', null, title), ...(body ? [body] : []), h('div.items', { 'data-items': '' })),
  );
}
