import { CHALLENGE, HORIZON, MAX_PLAYERS, SCORING, TEAMS } from '../config';
import { teamName, type Match, type Mode, type VersusMode } from '../game';
import { fmtNum, LANGS, t, tn, type Lang } from '../i18n';
import { awardLabel, awardValue, awardWho } from '../scorecard';
import { STYLE_MULTIPLIER, styleLabel } from '../scoring';
import { awards } from '../stats';
import type { StyleKind } from '../physics';
import { activeSeats, seatTeamsFor, type Seat, type Settings } from '../settings';
import { dailyMenuHint, dailyScreen } from './daily';
import { h, type Menu, type MenuItem, type Screen } from './menu';
import { rulesFor } from './rules';

export interface App {
  menu: Menu;
  settings: Settings;
  settingsChanged(): void;
  /** The mode being played right now, null on the title screen. */
  readonly mode: Mode | null;
  /** Today's date key — the real one, unless the URL asks for another day. */
  today(): string;
  start(mode: VersusMode): void;
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

const onOff = () => [
  { value: true, label: t('common.on') },
  { value: false, label: t('common.off') },
];

const seatOptions = (): { value: Seat; label: string }[] => [
  { value: 'human', label: t('seat.human') },
  { value: 'easy', label: t('seat.easy') },
  { value: 'medium', label: t('seat.medium') },
  { value: 'hard', label: t('seat.hard') },
  { value: 'off', label: '—' },
];

const LANG_NAMES: Record<Lang, string> = { de: 'Deutsch', en: 'English' };

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
          // Set by the deploy workflow; absent in local dev builds.
          ...(import.meta.env.VITE_APP_VERSION ? [h('p.version', null, String(import.meta.env.VITE_APP_VERSION))] : []),
        ),
      ),
    // A getter, so the lineup hint is fresh whenever the menu re-renders this screen.
    get items(): MenuItem[] {
      return [
        { kind: 'action', label: t('mode.daily'), hint: dailyMenuHint(app.today()), primary: true, run: () => app.menu.push(() => dailyScreen(app)) },
        { kind: 'action', label: t('mode.classic'), hint: t('mode.classic.hint'), run: () => app.menu.push(() => setupScreen(app, 'classic')) },
        { kind: 'action', label: t('mode.horizon'), hint: t('mode.horizon.hint'), run: () => app.menu.push(() => setupScreen(app, 'horizon')) },
        { kind: 'action', label: t('multiplayer.title'), hint: t('multiplayer.hint'), run: () => app.openLobby() },
        { kind: 'action', label: t('common.settings'), run: () => app.menu.push(() => settingsScreen(app)) },
        { kind: 'action', label: t('common.help'), run: () => app.menu.push(() => helpScreen(app)) },
        languageItem(app),
      ];
    },
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
      ...(mode && !app.online ? [{ kind: 'action', label: t('pause.newGame'), run: () => app.menu.push(() => setupScreen(app, mode)) } satisfies MenuItem] : []),
      ...(daily ? [{ kind: 'action', label: t('daily.retry'), run: () => app.rematch() } satisfies MenuItem] : []),
      { kind: 'action', label: t('common.settings'), run: () => app.menu.push(() => settingsScreen(app)) },
      { kind: 'action', label: t('common.help'), run: () => app.menu.push(() => helpScreen(app)) },
      app.online
        ? { kind: 'action', label: t('multiplayer.toLobby'), run: () => app.toLobby() }
        : { kind: 'action', label: t('common.mainMenu'), run: () => app.toTitle() },
    ],
    onEscape: () => app.resume(),
  };
}

export function playersScreen(app: App): Screen {
  const s = app.settings;
  const mode: MenuItem = {
    kind: 'choice',
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
      // Team rows appear or disappear.
      app.menu.rebuild();
    },
  };
  const seat = (i: number): MenuItem => ({
    kind: 'choice',
    label: t('players.player', { n: i + 1 }),
    options: seatOptions(),
    get: () => s.seats[i],
    set: (v) => {
      let next = v as Seat;
      // At least two seats must stay taken: skip "—" in whichever direction we were cycling.
      if (next === 'off' && activeSeats(s).length <= 2 && s.seats[i] !== 'off') next = s.seats[i] === 'human' ? 'hard' : 'human';
      const joinedOrLeft = (s.seats[i] === 'off') !== (next === 'off');
      s.seats[i] = next;
      app.settingsChanged();
      if (s.teamMode && joinedOrLeft) app.menu.rebuild();
    },
  });
  const team = (i: number): MenuItem => ({
    kind: 'choice',
    label: t('players.teamOf', { n: i + 1 }),
    options: Array.from({ length: s.teamMode }, (_, k) => ({ value: k, label: teamName(k) })),
    get: () => s.seatTeams[i] % s.teamMode,
    set: (v) => {
      s.seatTeams[i] = v as number;
      app.settingsChanged();
    },
  });
  const note = s.teamMode ? `${t('players.note')} ${t('players.teamNote')}` : t('players.note');
  return {
    build: () => panel(t('common.players'), h('p.note', null, note), 'panel--wide'),
    items: [
      mode,
      ...Array.from({ length: MAX_PLAYERS }, (_, i) => seat(i)),
      ...(s.teamMode ? activeSeats(s).map(team) : []),
      { kind: 'action', label: t('common.back'), run: () => app.menu.back() },
    ],
  };
}

/** A row that cycles one setting through a list of values. */
function settingChoice<K extends keyof Settings>(app: App, label: string, key: K, options: { value: Settings[K]; label: string }[]): MenuItem {
  return {
    kind: 'choice',
    label,
    options,
    get: () => app.settings[key],
    set: (v) => {
      app.settings[key] = v as Settings[K];
      app.settingsChanged();
    },
  };
}

/** The rules of a game, shown right before it starts. They are remembered between games. */
export function setupScreen(app: App, mode: VersusMode): Screen {
  const rules: MenuItem[] = rulesFor(mode).map((row) => settingChoice(app, row.label, row.key, row.options));
  return {
    build: () => panel(t(mode === 'classic' ? 'mode.classic' : 'mode.horizon'), h('p.note', null, t('setup.note')), 'panel--wide'),
    items: [
      { kind: 'action', label: t('setup.start'), primary: true, run: () => app.start(mode) },
      { kind: 'action', label: t('common.players'), hint: lineup(app.settings), run: () => app.menu.push(() => playersScreen(app)) },
      ...rules,
      { kind: 'action', label: t('common.back'), run: () => app.menu.back() },
    ],
  };
}

/** Only what concerns this device; the rules of a game live on the setup screen. */
export function settingsScreen(app: App): Screen {
  const choice = <K extends keyof Settings>(label: string, key: K, options: { value: Settings[K]; label: string }[]) => settingChoice(app, label, key, options);
  return {
    build: () => panel(t('common.settings'), h('p.note', null, t('settings.note')), 'panel--wide'),
    items: [
      choice(t('settings.contours'), 'contours', onOff()),
      choice(t('settings.particles'), 'particles', onOff()),
      choice(t('settings.sound'), 'sound', onOff()),
      {
        kind: 'choice',
        label: t('settings.fullscreen'),
        options: onOff(),
        get: () => app.isFullscreen(),
        set: () => app.toggleFullscreen(),
      },
      languageItem(app),
      { kind: 'action', label: t('common.back'), run: () => app.menu.back() },
    ],
  };
}

export function helpScreen(app: App): Screen {
  const key = (k: string) => h('kbd', null, k);
  const row = (keys: (Node | string)[], text: string) => h('tr', null, h('th', { scope: 'row' }, ...keys), h('td', null, text));
  const combos = (Object.keys(STYLE_MULTIPLIER) as StyleKind[]).map((k) =>
    row([styleLabel(k)], `×${fmtNum(STYLE_MULTIPLIER[k])} – ${t(`style.${k}.text`)}`),
  );
  return {
    build: () =>
      panel(
        t('common.help'),
        h(
          'div.help',
          null,
          h('h3', null, t('help.classic.title')),
          h('p', null, t('help.classic.body')),
          h('h3', null, t('help.teams.title')),
          h('p', null, t('help.teams.body', { penalty: SCORING.SELF_HIT, bonus: SCORING.SURVIVOR })),
          h('h3', null, t('help.horizon.title')),
          h('p', null, t('help.horizon.body', { seconds: HORIZON.SHOT_CLOCK })),
          h('h3', null, t('help.daily.title')),
          h('p', null, t('help.daily.body', { base: SCORING.BASE, bonus: CHALLENGE.CLEAR_BONUS, selfHit: SCORING.SELF_HIT })),
          h(
            'table.keys-table',
            null,
            h(
              'tbody',
              null,
              row([key('←'), ' ', key('→')], t('help.key.rotate')),
              row([key('↑'), ' ', key('↓')], t('help.key.power')),
              row([key('Enter')], t('help.key.fire')),
              row([key('Shift')], t('help.key.large')),
              row([key('Alt')], t('help.key.small')),
              row([key(t('common.ctrl')), t('help.key.or'), key('Alt'), '+', key('Shift')], t('help.key.tiny')),
              row([t('help.key.dragName')], t('help.key.drag')),
              row([key(t('common.space'))], t('help.key.next')),
              row([key('C')], t('help.key.clip')),
              row([key('Esc')], t('help.key.menu')),
              row([key('F')], t('help.key.fullscreen')),
            ),
          ),
          h('h3', null, t('help.scoring.title')),
          h('p', null, t('help.scoring.classic', { survivor: SCORING.SURVIVOR, selfHit: SCORING.SELF_HIT })),
          h('p', null, t('help.scoring.horizon', { volley: SCORING.VOLLEY_SURVIVED, orbit: SCORING.LAST_IN_ORBIT })),
          h('table.keys-table', null, h('tbody', null, ...combos)),
        ),
        'panel--wide',
      ),
    items: [{ kind: 'action', label: t('common.back'), primary: true, run: () => app.menu.back() }],
  };
}

export function gameOverScreen(app: App, match: Match): Screen {
  const winner = match.winner();
  const headline = !winner ? t('over.draw') : match.teamMode ? t('over.teamWins', { team: winner.name }) : t('over.wins', { name: winner.name });
  const entry = (place: number, name: string, color: string, score: number) => {
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
      // The match's records, e.g. the longest shot of all rounds.
      const highlights = awards(match.matchStats).map((award) => {
        const who = awardWho(match, award);
        const name = h('span.highlights__who', null, who.name);
        name.style.color = who.color;
        return h('li', null, h('span.highlights__label', null, awardLabel(award.kind)), name, h('span.highlights__value', null, awardValue(award)));
      });
      if (highlights.length) lists.push(h('p.ranking-label', null, t('scorecard.match')), h('ul.highlights', null, ...highlights));
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
