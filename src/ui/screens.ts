import { CHALLENGE, COLORS, DEBRIS, HORIZON, MAX_PLAYERS, SCORING, TEAMS, type Debris } from '../config';
import { ChallengeMatch, teamName, type Match, type Mode, type VersusMode } from '../game';
import { oracleAwards } from '../game/oracle';
import { fmtInt, fmtNum, LANGS, t, tn, type Key, type Lang } from '../i18n';
import { rulesOf } from '../lobbyPrefs';
import type { StatsReplay } from '../net';
import { roundTitle } from '../mayhem';
import { awardLabel, awardValue, awardWho } from '../scorecard';
import { STYLE_MULTIPLIER, styleLabel } from '../scoring';
import { awards } from '../stats';
import type { StyleKind } from '../physics';
import { type PowerUpKind } from '../powerups';
import { isLook } from '../render/look';
import { drawPowerUpSymbol, POWER_UP_COLORS } from '../render/powerup-art';
import { activeSeats, addSeat, balanceTeams, DEFAULT_SETTINGS, MIN_SEATS, removeSeat, seatTeamsFor, type Seat, type Settings } from '../settings';
import { dailyMenuHint, dailyScreen } from './daily';
import { factTicker } from './facts';
import { heartIcon } from './dom';
import { h, type Menu, type MenuItem, type Screen } from './menu';
import { modeArt, presetArt } from './mode-icons';
import type { LobbyEntry } from './lobby';
import { menuGroup, menuPage } from './menu-page';
import { presetsForMode, presetRules, matchingPreset, matchingHandpicked, pickOfTheDay, samePick } from './match-presets';
import { pickArt, pickHint, pickName } from './pick-of-day';
import { groupTitle, RULE_GROUPS, ruleItems, type RuleSource } from './rules';
import { powerUpSummary } from './powerup-summary';
import { teamRoster } from './team-roster';
import { mountTutorialPreview, type TutorialPreviewKind } from './tutorial-preview';
import { newsScreen } from './whats-new';
import { NEWS } from '../news/items';
import type { NewsItem } from '../news/types';

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
  start(mode: VersusMode): void;
  startDaily(): void;
  /** True while an online match is on screen. */
  readonly online: boolean;
  /** True while a recorded game is being flown again. */
  readonly replaying: boolean;
  watchReplay(data: StatsReplay): void;
  /** Fly the replay on screen again from the start. */
  watchAgain(): void;
  /** Back to the statistics, from a replay. */
  leaveReplay(): void;
  openLobby(entry?: LobbyEntry): void;
  /** Leave the online game (and its room) for the multiplayer lobby, still connected. */
  toLobby(): void;
  resume(): void;
  rematch(): void;
  /** What the pause menu offers about skipping the round: nothing, to skip it, to call a vote, or to answer the open one. */
  readonly skipOffer: 'skip' | 'call' | 'answer' | null;
  /** Skips the round (offline) or calls the vote (online host). */
  skipRound(): void;
  /** Answers the open vote to skip the round. */
  answerSkip(yes: boolean): void;
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

/** The version tag; hovering or focusing it swaps the text for who built the game. */
function creditsBadge(): HTMLElement {
  const link = (user: string) => h('a', { href: `https://github.com/${user}`, target: '_blank', rel: 'noopener noreferrer' }, user);
  return h('div.version.credits', { tabindex: '0' },
    h('span.credits__slot.credits__slot--tag', null,
      h('span.credits__tag', null, String(import.meta.env.VITE_APP_VERSION || 'Local-Dev')),
    ),
    h('span.credits__slot.credits__slot--line', null,
      h('span.credits__line', null,
        `${t('credits.with')} `, heartIcon(), ` ${t('credits.by')} `, link('denzrs'), ' & ', link('matthias-Q'),
        h('span.credits__agents', null, t('credits.agents')),
      ),
    ),
  );
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

type LauncherSection = 'local' | 'online';
let launcherSection: LauncherSection = 'local';
const modeName = (mode: VersusMode): string => t(`mode.${mode}` as Key);
const MAIN_MODES = ['classic', 'horizon', 'solar'] as const satisfies readonly VersusMode[];
type ModeTransition = 'next' | 'previous';

/** Default once on entry; rebuilding after rule or crew edits keeps the player's subsequent choices. */
function prepareModeScreen(app: App, mode: VersusMode, transition?: ModeTransition): () => Screen {
  const pick = pickOfTheDay(mode, app.today());
  Object.assign(app.settings, pick.rules, { powerUpKinds: [...pick.rules.powerUpKinds] });
  app.settingsChanged();
  return () => setupScreen(app, mode, transition);
}

function changeLocalMode(app: App, from: VersusMode, to: VersusMode, transition: ModeTransition): void {
  if (from === to) return;
  app.menu.replace(
    prepareModeScreen(app, to, transition),
    0,
  );
}

function modePagerItems(app: App, current: VersusMode): MenuItem[] {
  const currentIndex = MAIN_MODES.indexOf(current as (typeof MAIN_MODES)[number]);
  // Rotate the cycle so the active mode stays first and the next two always peek in from the right.
  const modes = MAIN_MODES.map((_, distance) => MAIN_MODES[(currentIndex + distance) % MAIN_MODES.length]);
  return modes.map((mode, distance): MenuItem => ({
    kind: 'action', section: 'mode-pager',
    label: modeName(mode),
    className: `mode-pager__item mode-pager__item--${mode} mode-pager__item--${distance === 0 ? 'active' : distance === 1 ? 'near' : 'far'}`,
    selected: () => mode === current,
    run: () => changeLocalMode(app, current, mode, 'next'),
  }));
}

function modePagerHeader(current: VersusMode, transition?: ModeTransition): HTMLElement {
  return h('div.mode-carousel', null,
    h('h2.mode-pager__semantic-title', { 'aria-live': 'polite', 'aria-atomic': 'true' }, modeName(current)),
    h('div.mode-pager__viewport', null,
      h('nav.items.items--row.mode-pager', {
        'data-section': 'mode-pager', 'data-transition': transition ?? '', 'aria-label': t('launcher.switchMode'),
      }),
    ),
    h('div.mode-pager__keys', { 'aria-hidden': 'true' },
      h('span', null, '‹ (Q)'),
      h('span', null, '(E) ›'),
    ),
  );
}

/** Place the selected mode at a stable anchor after the menu has mounted its button rows. */
function positionModeCarousel(root: HTMLElement): () => void {
  const viewport = root.querySelector<HTMLElement>('.mode-pager__viewport');
  const track = root.querySelector<HTMLElement>('.mode-pager');
  if (!viewport || !track) return () => {};

  let frame = 0;
  let settleFrame = 0;
  const targetOffset = (): number => {
    const active = track.querySelector<HTMLElement>('.is-selected');
    if (!active) return 0;
    const configuredAnchor = Number.parseFloat(getComputedStyle(viewport).getPropertyValue('--mode-anchor'));
    const anchorPercent = Number.isFinite(configuredAnchor) ? configuredAnchor : 0;
    const anchor = viewport.clientWidth * anchorPercent / 100;
    return anchor - active.offsetLeft;
  };
  const position = (): void => {
    if (!track.isConnected) return;
    const target = targetOffset();
    if (!track.classList.contains('is-positioned')) {
      const entering = track.dataset.transition;
      const entranceOffset = entering === 'next' ? 72 : entering === 'previous' ? -72 : 0;
      track.style.transform = `translate3d(${target + entranceOffset}px, 0, 0)`;
      if (!settleFrame) {
        settleFrame = requestAnimationFrame(() => {
          settleFrame = 0;
          if (!track.isConnected) return;
          track.classList.add('is-positioned');
          track.style.transform = `translate3d(${targetOffset()}px, 0, 0)`;
        });
      }
      return;
    }
    track.style.transform = `translate3d(${target}px, 0, 0)`;
  };
  const schedulePosition = (): void => {
    if (frame) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      frame = 0;
      position();
    });
  };
  const observer = new ResizeObserver(schedulePosition);
  observer.observe(viewport);
  observer.observe(track);
  schedulePosition();

  return () => {
    observer.disconnect();
    if (frame) cancelAnimationFrame(frame);
    if (settleFrame) cancelAnimationFrame(settleFrame);
  };
}

function enableModeSwipe(root: HTMLElement, app: App, current: VersusMode): void {
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
    const direction = dx < 0 ? 'next' : 'previous';
    const next = MAIN_MODES[(index + (direction === 'next' ? 1 : -1) + MAIN_MODES.length) % MAIN_MODES.length];
    event.preventDefault();
    changeLocalMode(app, current, next, direction);
  }, { passive: false });
  root.addEventListener('keydown', (event: KeyboardEvent) => {
    const target = event.target;
    if (!(target instanceof Element) || event.altKey || event.ctrlKey || event.metaKey) return;
    const key = event.key.toLowerCase();
    const shortcut = key === 'q' || key === 'e';
    if (target.closest('input, select, textarea, [contenteditable="true"]')) return;
    if (!shortcut && ((key !== 'arrowleft' && key !== 'arrowright') || !target.closest('.mode-pager'))) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const index = MAIN_MODES.indexOf(current as (typeof MAIN_MODES)[number]);
    const direction = key === 'arrowright' || key === 'e' ? 'next' : 'previous';
    const next = MAIN_MODES[(index + (direction === 'next' ? 1 : -1) + MAIN_MODES.length) % MAIN_MODES.length];
    changeLocalMode(app, current, next, direction);
  });
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
    if (section !== launcherSection) {
      const direction = section === 'online' ? 'next' : 'previous';
      content.classList.remove('launcher__content--enter-next', 'launcher__content--enter-previous');
      void content.offsetWidth;
      content.classList.add(`launcher__content--enter-${direction}`);
    }
    launcherSection = section;
    app.menu.refresh();
    app.menu.focusSection(section === 'local' ? 'modes' : 'online');
  };
  const modeCard = (mode: VersusMode): MenuItem => ({
    kind: 'action', section: 'modes', label: modeName(mode), hint: t(`mode.${mode}.hint` as Key),
    icon: () => modeArt(mode),
    hidden: () => launcherSection !== 'local',
    run: () => app.menu.push(prepareModeScreen(app, mode)),
  });
  return {
    build: () => h('section.screen.screen--title', { 'aria-labelledby': 'wordmark' },
      h('div.launcher', null,
        h('header.launcher__head', null,
          h('h1.wordmark', { id: 'wordmark' }, 'Slingshot'),
          factTicker(app.settings.statsTicker),
        ),
        h('div.launcher__body', null,
          h('nav.launcher__nav.items', { 'data-section': 'navigation', 'aria-label': t('title.menuLabel') }),
          content,
        ),
        h('footer.launcher__foot', null,
          h('p.keys', null, t('launcher.keys')),
          h('div.items.launcher__language', { 'data-section': 'language' }),
          h('div.items.launcher__news', { 'data-section': 'news' }),
          h('div.title-foot', null,
            creditsBadge(),
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
      modeCard('solar'),
      { kind: 'action', section: 'daily', hidden: () => launcherSection !== 'local', label: t('mode.daily'), hint: dailyMenuHint(app.today()), icon: () => modeArt('daily'), run: () => app.menu.push(() => dailyScreen(app)) },
      { kind: 'action', section: 'online', hidden: () => launcherSection !== 'online', label: t('flow.find'), hint: t('flow.findHint'), icon: () => modeArt('rooms'), run: () => app.openLobby('rooms') },
      { kind: 'action', section: 'online', hidden: () => launcherSection !== 'online', label: t('flow.create'), hint: t('flow.createHint'), icon: () => modeArt('create'), run: () => app.openLobby('create') },
      { kind: 'action', section: 'online', hidden: () => launcherSection !== 'online', label: t('flow.code'), hint: t('flow.codeHint'), icon: () => modeArt('code'), run: () => app.openLobby('code') },
      { ...languageItem(app), section: 'language' },
      { kind: 'action', section: 'news', label: t('news.open'), run: () => app.menu.push(() => whatsNewScreen(app, NEWS)) },
    ],
    focus: launcherSection === 'local' ? 4 : 7,
    update,
    onEscape: () => {
      if (launcherSection === 'online') chooseSection('local');
    },
  };
}

const skipAnswerItems = (app: App, section?: string): MenuItem[] => [
  { kind: 'action', ...(section ? { section } : {}), label: t('skip.yes'), primary: true, run: () => (app.answerSkip(true), app.resume()) },
  { kind: 'action', ...(section ? { section } : {}), label: t('skip.no'), run: () => (app.answerSkip(false), app.resume()) },
];

/** What a touch screen shows when the host has called a vote to skip the round: the answer, without hunting for a key. */
export function skipVoteScreen(app: App): Screen {
  return {
    build: () => menuPage({ title: t('skip.banner'), eyebrow: t('pause.title'), body: [] }),
    items: skipAnswerItems(app),
    onEscape: () => app.resume(),
  };
}

/** The What's New dialog with its buttons wired: "Try it" opens the place an item is about. */
export function whatsNewScreen(app: App, items: readonly NewsItem[]): Screen {
  return newsScreen(app, items, { settings: () => app.menu.push(() => settingsScreen(app)) });
}

export function pauseScreen(app: App, match: Match | null): Screen {
  if (app.replaying) {
    const items: MenuItem[] = [
      { kind: 'action', section: 'actions', label: t('replay.back'), run: () => app.leaveReplay() },
      { kind: 'action', section: 'actions', label: t('common.settings'), run: () => app.menu.push(() => settingsScreen(app)) },
      { kind: 'action', section: 'actions', label: t('replay.again'), run: () => app.watchAgain() },
      { kind: 'action', section: 'actions', label: t('pause.resume'), primary: true, run: () => app.resume() },
    ];
    return {
      build: () => menuPage({
        title: t('replay.title'), eyebrow: t('pause.title'), className: 'menu-page--pause', body: [],
        footer: h('nav.items.items--row.pause-actions.menu-page__actions', { 'data-section': 'actions', 'aria-label': t('pause.title') }),
      }),
      items,
      focus: items.length - 1,
      onEscape: () => app.resume(),
    };
  }
  const daily = app.mode === 'challenge';
  const mode = app.mode === 'classic' || app.mode === 'solar' || app.mode === 'horizon' ? app.mode : null;
  // The way on is the last button, at the right edge, where the eye ends up.
  const items: MenuItem[] = [
    // Online, the room decides: no restarts from the pause menu. The daily challenge has no setup, only a retry.
    ...(mode && !app.online ? [{ kind: 'action', section: 'actions', label: t('pause.newGame'), run: () => app.menu.push(prepareModeScreen(app, mode)) } satisfies MenuItem] : []),
    ...(daily ? [{ kind: 'action', section: 'actions', label: t('daily.retry'), run: () => app.rematch() } satisfies MenuItem] : []),
    ...(app.skipOffer === 'skip' || app.skipOffer === 'call'
      ? [{ kind: 'action', section: 'actions', label: t(app.skipOffer === 'skip' ? 'skip.action' : 'skip.call'), run: () => app.skipRound() } satisfies MenuItem]
      : []),
    ...(app.skipOffer === 'answer' ? skipAnswerItems(app, 'actions') : []),
    { kind: 'action', section: 'actions', label: t('common.settings'), run: () => app.menu.push(() => settingsScreen(app)) },
    { kind: 'action', section: 'actions', label: t('common.help'), run: () => app.menu.push(tutorialScreen(app)) },
    app.online
      ? { kind: 'action', section: 'actions', label: t('multiplayer.toLobby'), run: () => app.toLobby() }
      : { kind: 'action', section: 'actions', label: t('common.mainMenu'), run: () => app.toTitle() },
    { kind: 'action', section: 'actions', label: t('pause.resume'), primary: true, run: () => app.resume() },
  ];
  return {
    build: () => menuPage({
      title: t('pause.title'), eyebrow: app.mode === 'challenge' ? t('mode.daily') : `${modeName(app.mode === 'horizon' || app.mode === 'solar' ? app.mode : 'classic')}${app.mayhem ? ` · ${t('mode.mayhem')}` : ''}`,
      className: 'menu-page--pause',
      body: [h('div.menu-page__art', null, modeArt(app.mode === 'challenge' ? 'daily' : app.mayhem ? 'mayhem' : app.mode === 'horizon' || app.mode === 'solar' ? app.mode : 'classic'))],
      aside: match ? pauseStanding(match) : undefined,
      footer: h('nav.items.items--row.pause-actions.menu-page__actions', { 'data-section': 'actions', 'aria-label': t('pause.title') }),
    }),
    items,
    focus: items.length - 1,
    onEscape: () => app.resume(),
  };
}

/** The pause menu's side panel: where the match stands right now. */
function pauseStanding(match: Match): Node[] {
  const row = (place: number, name: string, color: string, score: number | string) => {
    const label = h('span.ranking__name', null, name);
    label.style.color = color;
    return h('li', null, h('span.ranking__place', null, `${place}.`), label, h('span.ranking__score', null, String(score)));
  };
  if (match instanceof ChallengeMatch) {
    return [
      h('p.ranking-label', null, t('pause.standings')),
      h('p.pause-standing__round', null, t('daily.sector', { n: match.spec.index + 1 })),
      h('p.pause-standing__score', null, fmtInt(match.total)),
      h('p.pause-standing__meta', null, tn('daily.shots', match.shotsLeft)),
    ];
  }
  const nodes: Node[] = [h('p.ranking-label', null, t('pause.standings'))];
  nodes.push(h('p.pause-standing__round', null, match.totalRounds ? `${t('hud.round')} ${match.round} / ${match.totalRounds}` : `${t('hud.round')} ${match.round}`));
  if (match.teamMode) {
    nodes.push(h('ol.ranking', null, ...match.teamRanking().map((r, i) => row(i + 1, t('team.name', { team: teamName(r.team) }), TEAMS[r.team][0], r.score))));
    nodes.push(h('p.ranking-label', null, t('over.players')));
    nodes.push(h('ol.ranking.ranking--small', null, ...match.ranking().map((p, i) => row(i + 1, p.name, p.color, p.score))));
  } else {
    nodes.push(h('ol.ranking', null, ...match.ranking().map((p, i) => row(i + 1, p.name, p.color, p.score))));
  }
  const chart = scoreChart(match);
  if (chart) nodes.push(h('p.ranking-label', null, t('scorecard.history')), chart);
  return nodes;
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
  const board = teamRoster(t('briefing.crew'));
  const slots = Array.from({ length: MAX_PLAYERS }, (_, i) => h('div.crew-slot', { 'data-section': `seat-${i}` }));

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
      if (s.teamMode) balanceTeams(s);
      app.settingsChanged();
      // The roster gains one column per team.
      app.menu.rebuild();
    },
  };
  const seat = (i: number): MenuItem => ({
    kind: 'seat',
    section: `seat-${i}`,
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
    remove: {
      label: t('players.remove', { n: i + 1 }),
      disabled: () => activeSeats(s).length <= MIN_SEATS,
      run: () => {
        if (!removeSeat(s, i)) return;
        app.settingsChanged();
        // The removed ship becomes an empty slot in the same position.
        app.menu.rebuild(1 + i);
      },
    },
  });

  const add = (i: number): MenuItem => ({
    kind: 'action', section: `seat-${i}`, className: 'slot-card slot-card--empty',
    tag: t('players.player', { n: i + 1 }),
    icon: () => h('span.slot-card__plus', { 'aria-hidden': 'true' }, '+'),
    hint: t('slots.free'), label: t('flow.addPilot'),
    run: () => {
      const team = board.teamOf(String(i));
      if (addSeat(s, 'human', i) === null) return;
      if (s.teamMode && team !== null) s.seatTeams[i] = team;
      app.settingsChanged();
      app.menu.rebuild(1 + i);
    },
  });

  const crewActions = h('div.items.items--row.crew-actions', { 'data-section': 'crew-actions' });
  const count = h('h3.setup__title', null, t('players.group.crew', { n: seats.length, max: MAX_PLAYERS }));
  const crewStatus = h('p.crew-roster__status', { 'aria-live': 'polite' });
  const roster = h('section.crew-roster', null,
    h('div.crew-roster__heading', null, count, h('div.crew-roster__aside', null, crewStatus, crewActions)),
    board.el,
  );
  const update = (): void => {
    const active = activeSeats(s);
    const humans = active.filter((i) => s.seats[i] === 'human').length;
    crewStatus.textContent = [
      ...(humans ? [`${humans} ${tn('lineup.human', humans)}`] : []),
      ...(active.length > humans ? [`${active.length - humans} ${tn('lineup.cpu', active.length - humans)}`] : []),
    ].join(' · ');
    board.show(slots.map((el, i) => ({
      key: String(i), el, label: t('players.player', { n: i + 1 }),
      team: s.seats[i] === 'off' ? null : s.seatTeams[i] % Math.max(1, s.teamMode),
      ...(s.seats[i] !== 'off' && s.teamMode ? { move: (team: number) => {
        s.seatTeams[i] = team;
        app.settingsChanged();
        app.menu.refresh();
      } } : {}),
    })), s.teamMode);
  };

  return {
    build: () => {
      board.show(slots.map((el, i) => ({ key: String(i), el, label: t('players.player', { n: i + 1 }), team: s.seats[i] === 'off' ? null : s.seatTeams[i] % Math.max(1, s.teamMode) })), s.teamMode);
      return menuPage({
        title: t('flow.crewTitle'), className: 'menu-page--crew',
        headerAside: h('div.crew-config', null, menuGroup(t('players.group.mode'), 'mode')),
        body: [roster],
        keys: t('flow.tabKeys'),
        footer: h('div.items.items--row.menu-page__actions', { 'data-section': 'actions' }),
      });
    },
    items: [
      mode,
      ...Array.from({ length: MAX_PLAYERS }, (_, i) => s.seats[i] === 'off' ? add(i) : seat(i)),
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

/** A concise briefing; rule and crew subpages preserve edits made after entering the mode. */
function setupScreen(app: App, mode: VersusMode, transition?: ModeTransition): Screen {
  const s = app.settings;
  const presets = presetsForMode(mode);
  const pick = pickOfTheDay(mode, app.today());
  const summary = h('dl.briefing__facts', { 'aria-live': 'polite' });
  const crew = h('div.briefing__crew', { 'aria-hidden': 'true' });
  const crewLabel = h('p.briefing__lineup', null);
  const quickKeys = ['rounds', 'shotTime'] as const;
  const powerups = powerUpSummary(() => s);
  const rules = ruleItems(mode, {
    get: () => rulesOf(s),
    patch: (values) => { Object.assign(s, values); app.settingsChanged(); },
  });
  const quick = rules.filter(({ key }) => quickKeys.some((quickKey) => quickKey === key));
  // The strength of Mayhem shows up under the sliders while Mayhem is on.
  const mayhem = rules.find(({ key }) => key === 'mayhem')!;
  const update = (): void => {
    crewLabel.textContent = lineup(s);
    crew.replaceChildren(...crewMarkers(s));
    const fact = (label: string, value: string) => h('div', null, h('dt', null, label), h('dd', null, value));
    summary.replaceChildren(
      fact(t('settings.shotTime'), t('settings.seconds', { n: s.shotTime })),
      fact(t('settings.bounce'), t(s.bounce ? 'common.on' : 'common.off')),
      fact(t('settings.hiddenAim'), t(s.hiddenAim ? 'common.on' : 'common.off')),
      ...(s.mayhem ? [fact(t('mode.mayhem'), t(`settings.mayhem.${s.mayhem}` as Key))] : []),
    );
    powerups.update();
  };
  let disposeModeCarousel = (): void => {};
  return {
    build: () => {
      const page = menuPage({
        title: modeName(mode), eyebrow: t('launcher.prepare'),
        headerTitle: modePagerHeader(mode, transition),
        className: `menu-page--briefing menu-page--mode-pager${transition ? ` menu-page--mode-enter-${transition}` : ''}`,
        body: [
          h('section.briefing__presets', null,
            h('div.items.items--row.briefing__cards', { 'data-section': 'presets', role: 'group', 'aria-label': t('preset.choose') }),
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
          h('h3.setup__title', null, t('briefing.rules')),
          summary,
          h('div.items.briefing__edit', { 'data-section': 'edit' }),
        ],
        keys: t('briefing.keys'),
        footer: h('div.items.items--row.menu-page__actions', { 'data-section': 'actions' }),
      });
      disposeModeCarousel = positionModeCarousel(page);
      enableModeSwipe(page, app, mode);
      return page;
    },
    dispose: () => disposeModeCarousel(),
    items: [
      ...modePagerItems(app, mode),
      {
        kind: 'action', section: 'presets', label: pickName(pick), className: 'item--pick',
        tag: t('preset.pick.today'), hint: pickHint(pick),
        icon: () => pickArt(pick),
        selected: () => samePick(matchingHandpicked(rulesOf(s), mode), pick),
        run: () => { Object.assign(s, pick.rules); app.settingsChanged(); app.menu.refresh(); },
      },
      ...presets.map((preset): MenuItem => ({
        kind: 'action', section: 'presets', label: t(`preset.${preset}` as Key), hint: t(`preset.${preset}.hint` as Key),
        icon: () => presetArt(preset, mode),
        selected: () => !samePick(matchingHandpicked(rulesOf(s), mode), pick) && matchingPreset(rulesOf(s), mode) === preset,
        run: () => { Object.assign(s, presetRules(preset)); app.settingsChanged(); app.menu.refresh(); },
      })),
      ...quick.map(({ item }): MenuItem => ({ ...item, section: 'quick' })),
      { ...mayhem.item, section: 'quick-mayhem' },
      { kind: 'action', section: 'players', label: t('briefing.editCrew'), run: () => openPlayers(app) },
      { kind: 'action', section: 'edit', label: t('briefing.editRules'), run: () => app.menu.push(() => rulesScreen(app, mode)) },
      { kind: 'action', section: 'actions', label: t('common.back'), run: () => app.menu.back() },
      { kind: 'action', section: 'actions', label: t('setup.start'), primary: true, run: () => app.start(mode) },
    ],
    // Enter keeps the quick route into the game; the presets remain a click or arrow away.
    focus: MAIN_MODES.length + 1 + presets.length + quick.length + 1 + 3,
    update,
  };
}

/** All rules, grouped by subject, without overwhelming the match briefing. */
function rulesScreen(app: App, mode: VersusMode): Screen {
  const source: RuleSource = {
    get: () => rulesOf(app.settings),
    patch: (values) => {
      Object.assign(app.settings, values);
      app.settingsChanged();
    },
  };
  const rules = ruleItems(mode, source);
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
      title: t('briefing.editRules'), eyebrow: modeName(mode), className: 'menu-page--rules',
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
        // A Mayhem game goes back to the Mayhem preset at its strength, any other one to the standard rules.
        const { mayhem } = app.settings;
        Object.assign(app.settings, mayhem ? { ...presetRules('mayhem'), mayhem } : rulesOf(DEFAULT_SETTINGS));
        app.settingsChanged(); app.menu.refresh();
      } },
      { kind: 'action', section: 'actions', label: t('briefing.done'), primary: true, run: () => app.menu.back() },
    ],
    update: () => { heading.textContent = groupTitle(category); },
    focus: 0,
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
      title: t('common.settings'), intro: t('settings.note'), className: 'menu-page--settings',
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
      inCategory({
        kind: 'segmented',
        section: 'fields',
        label: t('settings.look'),
        options: [
          { value: 'refined', label: t('settings.lookRefined') },
          { value: 'classic', label: t('settings.lookClassic') },
        ],
        get: () => app.settings.look,
        set: (v: unknown) => {
          app.settings.look = isLook(v) ? v : 'classic';
          app.settingsChanged();
        },
      }, 'display'),
      inCategory(settingToggle(app, t('settings.contours'), 'contours'), 'display'),
      inCategory(settingToggle(app, t('settings.particles'), 'particles'), 'display'),
      inCategory({
        kind: 'segmented',
        label: t('settings.debris'),
        options: (Object.keys(DEBRIS) as Debris[]).map((value) => ({ value, label: t(`settings.debris.${value}`) })),
        hidden: () => !app.settings.particles,
        get: () => app.settings.debris,
        set: (v) => {
          app.settings.debris = v as Debris;
          app.settingsChanged();
        },
      }, 'display'),
      inCategory(settingToggle(app, t('settings.menuBackground'), 'menuBackground'), 'display'),
      inCategory(settingToggle(app, t('settings.statsTicker'), 'statsTicker'), 'display'),
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
    const hasPreview = page !== 0 && page !== lessons.length - 1;
    const powerUps = lessons[page].powerUps ?? [];
    const tricks = lessons[page].tricks ?? [];
    if (powerUps.length && !powerUps.includes(selectedPowerUp)) selectedPowerUp = powerUps[0];
    if (tricks.length && !tricks.includes(selectedTrick)) selectedTrick = tricks[0];
    const canvas = hasPreview ? h('canvas.tutorial__canvas', { 'aria-hidden': 'true' }) as HTMLCanvasElement : null;
    const timeline = hasPreview ? h('input.tutorial__timeline', {
      type: 'range', min: '0', max: '1000', step: '1', value: '0',
      'aria-label': t('tutorial.preview.timeline'),
    }) as HTMLInputElement : null;
    timeline?.addEventListener('input', (event) => {
      const range = event.currentTarget as HTMLInputElement;
      preview?.seek(Number(range.value) / 1000);
    });
    return {
      build: () => {
        const previewPanel = hasPreview && canvas && timeline ? h('section.tutorial__preview', { 'aria-label': t('tutorial.preview.aria') },
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
        ) : null;
        if (canvas && timeline) {
          preview = mountTutorialPreview(canvas, lessons[page].demo, (progress) => {
            timeline.value = String(Math.round(progress * 1000));
          }, powerUps.length ? selectedPowerUp : undefined, tricks.length ? selectedTrick : undefined);
        }
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
            h(`div.tutorial__layout${hasPreview ? '' : '.tutorial__layout--text-only'}`, null,
              h('div.tutorial__copy', null, ...lessons[page].body, ...powerContent, ...trickContent),
              ...(previewPanel ? [previewPanel] : []),
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
        ...(hasPreview ? [{ kind: 'action' as const, section: 'preview-action', label: t('tutorial.preview.replay'), run: () => { if (timeline) timeline.value = '0'; preview?.replay(); } }] : []),
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
        const row = h('li.match-highlight', null, h('span.highlights__label', null, awardLabel(award.kind)), name, h('span.highlights__value', null, awardValue(award)));
        if (award.trail && award.trail.length >= 4) row.append(matchShotTrail(award.trail, who.color, `${awardLabel(award.kind)} · ${who.name}`));
        return row;
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
    items: match.replaying
      ? [
          { kind: 'action', label: t('replay.back'), run: () => app.leaveReplay() },
          { kind: 'action', label: t('replay.again'), primary: true, run: () => app.watchAgain() },
        ]
      : [
          app.online
            ? { kind: 'action', label: t('multiplayer.toLobby'), run: () => app.toLobby() }
            : { kind: 'action', label: t('common.mainMenu'), run: () => app.toTitle() },
          match.canAdvance
            ? { kind: 'action', label: t('over.rematch'), primary: true, run: () => app.rematch() }
            : { kind: 'action', label: t('over.rematch'), hint: t('over.hostRematch'), disabled: true, run: () => {} },
        ],
    focus: 1,
    onEscape: () => (match.replaying ? app.leaveReplay() : app.online ? app.toLobby() : app.toTitle()),
  };
}

/** The match record's saved path, drawn across as a small, replay-like trajectory highlight. */
function matchShotTrail(points: number[], color: string, label: string): SVGSVGElement {
  const size = 240;
  const height = 52;
  const pad = 9;
  const xs = points.filter((_, i) => i % 2 === 0);
  const ys = points.filter((_, i) => i % 2 === 1);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const point = (i: number): [number, number] => [
    pad + ((points[i] - minX) / spanX) * (size - pad * 2),
    height - pad - ((points[i + 1] - minY) / spanY) * (height - pad * 2),
  ];
  const pathData = Array.from({ length: points.length / 2 }, (_, i) => {
    const [x, y] = point(i * 2);
    return `${i ? 'L' : 'M'}${x},${y}`;
  }).join(' ');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'match-highlight__trail');
  svg.setAttribute('viewBox', `0 0 ${size} ${height}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', label);
  const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
  title.textContent = label;
  svg.append(title);
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('class', 'match-highlight__path');
  path.setAttribute('d', pathData);
  path.setAttribute('pathLength', '1');
  path.setAttribute('stroke', color);
  svg.append(path);
  const [startX, startY] = point(0);
  const start = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  start.setAttribute('class', 'match-highlight__start');
  start.setAttribute('cx', String(startX));
  start.setAttribute('cy', String(startY));
  start.setAttribute('r', '2');
  svg.append(start);
  const [endX, endY] = point(points.length - 2);
  const end = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  end.setAttribute('class', 'match-highlight__end');
  end.setAttribute('cx', String(endX));
  end.setAttribute('cy', String(endY));
  end.setAttribute('r', '3');
  end.setAttribute('fill', color);
  svg.append(end);
  return svg;
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
