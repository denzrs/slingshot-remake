import { CHALLENGE, HORIZON, MAX_PLAYERS, SCORING, TEAMS } from '../config';
import { teamName, type Match, type Mode, type VersusMode } from '../game';
import { DEFAULT_SERVER, type MultiplayerSession } from '../multiplayer';
import { fmtNum, LANGS, t, tn, type Lang } from '../i18n';
import { STYLE_MULTIPLIER, styleLabel } from '../scoring';
import type { StyleKind } from '../physics';
import { activeSeats, seatTeamsFor, type Seat, type Settings } from '../settings';
import { dailyMenuHint, dailyScreen } from './daily';
import { h, type Menu, type MenuItem, type Screen } from './menu';

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

export function lobbyScreen(app: App, session: MultiplayerSession): Screen {
  let root!: HTMLElement;
  let serverAddress!: HTMLInputElement;
  let playerName!: HTMLInputElement;
  let roomMode!: HTMLSelectElement;
  let gameMode!: HTMLSelectElement;
  let roomCapacity!: HTMLSelectElement;
  let createPassword!: HTMLInputElement;
  let roomSelect!: HTMLSelectElement;
  let joinPassword!: HTMLInputElement;
  let joinPasswordField!: HTMLElement;
  let connectButton!: HTMLButtonElement;
  let createButton!: HTMLButtonElement;
  let joinButton!: HTMLButtonElement;
  let readyButton!: HTMLButtonElement;
  let startButton!: HTMLButtonElement;
  let leaveButton!: HTMLButtonElement;
  let feedback!: HTMLElement;
  let roomsList!: HTMLElement;
  let actions!: HTMLElement;
  let form!: HTMLElement;
  /** Connection progress / validation messages that don't come from the session. */
  let localMessage: string | null = null;

  const roomLabel = (room: { id: string; gameMode: string; mode: string; players: number; maxPlayers: number; locked: boolean }) =>
    `${room.locked ? '🔒 ' : ''}${room.id} · ${t(room.gameMode === 'classic' ? 'mode.classic' : 'mode.horizon')} · ${room.mode === 'team' ? t('players.teams', { n: 2 }) : t('players.ffa')} · ${room.players}/${room.maxPlayers}`;

  const render = () => {
    const { connected, room, rooms } = session;
    feedback.textContent = localMessage ?? session.notice ?? (room ? '' : connected ? t('multiplayer.connected') : t('multiplayer.connectHint'));
    // The connection and room-creation forms are only needed outside of a room.
    form.hidden = !!room;
    connectButton.disabled = connected;
    serverAddress.disabled = connected;
    createButton.disabled = !connected;
    roomsList.replaceChildren();
    actions.hidden = !room;
    if (room) {
      const { you } = session;
      roomsList.append(h('h3.lobby__section-title', null, `${t('multiplayer.room')} ${room.id}${room.locked ? ' 🔒' : ''}`));
      const list = h('ul.lobby__players', null);
      for (const player of room.players) {
        const team = room.mode === 'team' ? ` · ${t('players.teams', { n: player.team + 1 })}` : '';
        list.append(h('li', null, `${player.name}${player.id === 0 ? ` · ${t('multiplayer.host')}` : ''}${team} · ${player.ready ? t('multiplayer.ready') : t('multiplayer.notReady')}`));
      }
      roomsList.append(list);
      const self = room.players.find((player) => player.id === you.playerId);
      readyButton.textContent = self?.ready ? t('multiplayer.unready') : t('multiplayer.ready');
      startButton.hidden = !you.host;
      startButton.disabled = room.players.length < 2;
      return;
    }
    roomsList.append(h('h3.lobby__section-title', null, t('multiplayer.rooms')));
    const list = h('ul.lobby__rooms', null);
    const selected = roomSelect.value;
    roomSelect.replaceChildren(new Option(rooms.length ? t('multiplayer.selectRoom') : t('multiplayer.noRooms'), ''));
    for (const entry of rooms) {
      roomSelect.add(new Option(roomLabel(entry), entry.id));
      list.append(h('li', null, roomLabel(entry)));
    }
    roomSelect.value = rooms.some((entry) => entry.id === selected) ? selected : '';
    roomsList.append(list);
    const chosen = rooms.find((entry) => entry.id === roomSelect.value);
    joinPasswordField.hidden = !chosen?.locked;
    roomSelect.disabled = !connected || rooms.length === 0;
    joinButton.disabled = !connected || !roomSelect.value;
  };

  const button = (label: string, primary = false) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `lobby__button${primary ? ' lobby__button--primary' : ''}`;
    b.textContent = label;
    return b;
  };
  const field = (label: string, input: HTMLElement) => h('label.lobby__field', null, h('span', null, label), input);
  const passwordInput = () => {
    const input = document.createElement('input');
    input.type = 'password';
    input.maxLength = 64;
    input.autocomplete = 'off';
    return input;
  };
  /** The trimmed player name, remembered for next time; null (with a message) when empty. */
  const takeName = (): string | null => {
    const name = playerName.value.trim();
    if (!name) {
      localMessage = t('multiplayer.nameRequired');
      render();
      return null;
    }
    localStorage.setItem('slingshot.player-name', name);
    localMessage = null;
    return name;
  };

  return {
    build: () => {
      localMessage = null;
      serverAddress = document.createElement('input');
      serverAddress.type = 'url';
      serverAddress.value = session.client.address || DEFAULT_SERVER;
      playerName = document.createElement('input');
      playerName.maxLength = 24;
      playerName.setAttribute('autocomplete', 'nickname');
      playerName.value = localStorage.getItem('slingshot.player-name') || 'Player';
      roomMode = document.createElement('select');
      roomMode.add(new Option(t('players.ffa'), 'ffa'));
      roomMode.add(new Option(t('players.teams', { n: 2 }), 'team'));
      gameMode = document.createElement('select');
      gameMode.add(new Option(t('mode.classic'), 'classic'));
      gameMode.add(new Option(t('mode.horizon'), 'horizon'));
      roomCapacity = document.createElement('select');
      for (let count = 2; count <= MAX_PLAYERS; count++) roomCapacity.add(new Option(String(count), String(count)));
      createPassword = passwordInput();
      roomSelect = document.createElement('select');
      joinPassword = passwordInput();
      joinPasswordField = field(t('multiplayer.password'), joinPassword);
      connectButton = button(t('multiplayer.connect'), true);
      createButton = button(t('multiplayer.create'));
      joinButton = button(t('multiplayer.join'));
      readyButton = button(t('multiplayer.ready'));
      startButton = button(t('multiplayer.start'), true);
      leaveButton = button(t('multiplayer.leave'));
      feedback = h('p.lobby__feedback', { role: 'status', 'aria-live': 'polite' });
      roomsList = h('div.lobby__room-list', null);
      actions = h('div.lobby__actions', null, readyButton, startButton, leaveButton);
      form = h('div.lobby__form', null,
        field(t('multiplayer.server'), serverAddress), field(t('multiplayer.name'), playerName), connectButton,
        h('div.lobby__create-options', null,
          field(t('multiplayer.gameMode'), gameMode), field(t('multiplayer.matchType'), roomMode), field(t('multiplayer.capacity'), roomCapacity),
          field(t('multiplayer.passwordOptional'), createPassword)),
        createButton, field(t('multiplayer.room'), roomSelect), joinButton, joinPasswordField,
      );

      connectButton.addEventListener('click', async () => {
        localMessage = t('multiplayer.connecting');
        render();
        try {
          await session.connect(serverAddress.value.trim());
          localMessage = null;
        } catch (error) {
          localMessage = error instanceof Error ? error.message : String(error);
        }
        render();
      });
      createButton.addEventListener('click', () => {
        const name = takeName();
        if (!name) return;
        session.createRoom({
          name,
          mode: roomMode.value as 'ffa' | 'team',
          gameMode: gameMode.value as 'classic' | 'horizon',
          maxPlayers: Number(roomCapacity.value),
          password: createPassword.value,
        });
        createPassword.value = '';
      });
      joinButton.addEventListener('click', () => {
        const name = takeName();
        if (!name || !roomSelect.value) return;
        session.joinRoom(roomSelect.value, name, joinPassword.value);
        joinPassword.value = '';
      });
      roomSelect.addEventListener('change', render);
      readyButton.addEventListener('click', () => {
        const self = session.room?.players.find((p) => p.id === session.you.playerId);
        if (self) session.setReady(!self.ready);
      });
      startButton.addEventListener('click', () => session.startGame());
      leaveButton.addEventListener('click', () => session.leaveRoom());

      root = h('section.screen.screen--panel.screen--lobby', { role: 'dialog', 'aria-modal': 'true', 'aria-label': t('multiplayer.title') },
        h('div.panel.panel--wide', null, h('h2.panel__title', null, t('multiplayer.title')), h('div.lobby', null, feedback, form, roomsList, actions), h('div.items', { 'data-items': '' })));
      // The session outlives this screen: re-render on its changes until the screen is gone.
      const unsubscribe = session.subscribe(() => {
        if (!root.isConnected) return unsubscribe();
        localMessage = null;
        render();
      });
      render();
      return root;
    },
    items: [],
    onEscape: () => {
      if (session.room) session.leaveRoom();
      else {
        session.disconnect();
        app.toTitle();
      }
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
  const s = app.settings;
  const classic = mode === 'classic';
  const choice = <K extends keyof Settings>(label: string, key: K, options: { value: Settings[K]; label: string }[]) => settingChoice(app, label, key, options);
  return {
    build: () => panel(t(classic ? 'mode.classic' : 'mode.horizon'), h('p.note', null, t('setup.note')), 'panel--wide'),
    items: [
      { kind: 'action', label: t('setup.start'), primary: true, run: () => app.start(mode) },
      { kind: 'action', label: t('common.players'), hint: lineup(s), run: () => app.menu.push(() => playersScreen(app)) },
      choice(t('settings.rounds'), 'rounds', [1, 3, 5, 7, 10, 15, 20, 0].map((n) => ({ value: n, label: n ? String(n) : t('settings.endless') }))),
      choice(t('settings.maxPlanets'), 'maxPlanets', [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ value: n, label: String(n) }))),
      ...(classic ? [choice(t('settings.invisible'), 'invisiblePlanets', onOff())] : []),
      choice(t('settings.bounce'), 'bounce', onOff()),
      choice(t('settings.fixedPower'), 'fixedPower', onOff()),
      choice(t('settings.shotTime'), 'shotTime', [10, 20, 30, 60].map((n) => ({ value: n, label: t('settings.seconds', { n }) }))),
      ...(classic ? [choice(t('settings.styleBonuses'), 'styleBonuses', onOff())] : []),
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
      const lists: HTMLElement[] = [];
      if (match.teamMode) {
        // Teams first; the individual standings follow, smaller.
        lists.push(h('ol.ranking', null, ...match.teamRanking().map((r, i) => entry(i + 1, t('team.name', { team: teamName(r.team) }), TEAMS[r.team][0], r.score))));
        lists.push(h('p.ranking-label', null, t('over.players')));
        lists.push(h('ol.ranking.ranking--small', null, ...match.ranking().map((p, i) => entry(i + 1, p.name, p.color, p.score))));
      } else {
        lists.push(h('ol.ranking', null, ...match.ranking().map((p, i) => entry(i + 1, p.name, p.color, p.score))));
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
      { kind: 'action', label: t('over.rematch'), primary: true, run: () => app.rematch() },
      app.online
        ? { kind: 'action', label: t('multiplayer.toLobby'), run: () => app.toLobby() }
        : { kind: 'action', label: t('common.mainMenu'), run: () => app.toTitle() },
    ],
    onEscape: () => (app.online ? app.toLobby() : app.toTitle()),
  };
}

function panel(title: string, body: HTMLElement | null, extraClass = ''): HTMLElement {
  return h(
    'section.screen.screen--panel',
    { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h(`div.panel${extraClass ? '.' + extraClass : ''}`, null, h('h2.panel__title', null, title), ...(body ? [body] : []), h('div.items', { 'data-items': '' })),
  );
}
