import { CHALLENGE, COLORS, HORIZON, MAX_PLAYERS, SCORING, TEAMS } from '../config';
import { teamName, type Match, type Mode, type VersusMode } from '../game';
import { fmtInt, fmtNum, LANGS, t, tn, type Lang } from '../i18n';
import { rulesOf } from '../lobbyPrefs';
import { awardLabel, awardValue, awardWho } from '../scorecard';
import { STYLE_MULTIPLIER, styleLabel } from '../scoring';
import { awards } from '../stats';
import type { StyleKind } from '../physics';
import { activeSeats, addSeat, balanceTeams, DEFAULT_SETTINGS, freeSeat, MIN_SEATS, removeSeat, seatTeamsFor, teamCounts, type Seat, type Settings } from '../settings';
import { dailyMenuHint, dailyScreen } from './daily';
import { h, type Menu, type MenuItem, type Screen } from './menu';
import { groupTitle, RULE_GROUPS, ruleItems } from './rules';

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
  /** The Easter egg on the title screen: opens or closes a ghost lane. */
  ghostEgg(): void;
}

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

/** A small ghost beside the version: whoever finds it can play the ghost lane from the title screen. */
function ghostEgg(app: App): HTMLElement {
  const button = h('button.ghost-egg', { type: 'button', tabindex: '-1', title: t('title.ghostEgg'), 'aria-label': t('title.ghostEgg') });
  button.innerHTML =
    '<svg viewBox="0 0 20 22" width="20" height="22" aria-hidden="true"><path fill="currentColor" d="M3 19V10a7 7 0 0 1 14 0v9l-2.33-2-2.34 2-2.33-2-2.33 2-2.34-2-2.33 2z"/>' +
    '<circle cx="7.6" cy="10" r="1.4" fill="#0b1a33"/><circle cx="12.4" cy="10" r="1.4" fill="#0b1a33"/><ellipse cx="10" cy="13.6" rx="1.1" ry="1.5" fill="#0b1a33"/></svg>';
  button.addEventListener('click', () => {
    // Keep Enter and Space for the lane, not for this button.
    button.blur();
    app.ghostEgg();
  });
  return button;
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
          h('div.title-foot', null, h('p.version', null, String(import.meta.env.VITE_APP_VERSION || 'Local-Dev')), ghostEgg(app)),
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
    items: [...rules.map(({ group, item }) => ({ ...item, section: group })), ...actions],
    // Enter starts the game straight away, as it always did.
    focus: rules.length,
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
      settingToggle(app, t('settings.oracle'), 'oracle'),
      settingToggle(app, t('settings.ghostLane'), 'ghostLane'),
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

function helpScreen(app: App): Screen {
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
              row([key('G')], t('help.key.ghost')),
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
