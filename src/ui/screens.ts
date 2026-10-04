import { CHALLENGE, HORIZON, MAX_PLAYERS, SCORING, TEAMS } from '../config';
import { teamName, type Match, type Mode, type VersusMode } from '../game';
import { NetworkClient, type LobbyRoom, type ServerMessage } from '../net';
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
  connectMultiplayer(): void;
  startMultiplayer(message: Extract<ServerMessage, { type: 'game_start' }>): void;
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
        { kind: 'action', label: t('mode.classic'), hint: t('mode.classic.hint'), run: () => app.start('classic') },
        { kind: 'action', label: t('mode.horizon'), hint: t('mode.horizon.hint'), run: () => app.start('horizon') },
        { kind: 'action', label: t('multiplayer.title'), hint: t('multiplayer.hint'), run: () => app.connectMultiplayer() },
        { kind: 'action', label: t('common.players'), hint: lineup(app.settings), run: () => app.menu.push(() => playersScreen(app)) },
        { kind: 'action', label: t('common.settings'), run: () => app.menu.push(() => settingsScreen(app)) },
        { kind: 'action', label: t('common.help'), run: () => app.menu.push(() => helpScreen(app)) },
        languageItem(app),
      ];
    },
  };
}

export function lobbyScreen(app: App, net: NetworkClient): Screen {
  let rooms: LobbyRoom[] = [];
  let currentRoom: Extract<ServerMessage, { type: 'room_update' }> | null = null;
  let connected = false;
  let feedbackText = t('multiplayer.connectHint');
  let serverAddress!: HTMLInputElement;
  let playerName!: HTMLInputElement;
  let roomMode!: HTMLSelectElement;
  let gameMode!: HTMLSelectElement;
  let roomCapacity!: HTMLSelectElement;
  let roomSelect!: HTMLSelectElement;
  let connectButton!: HTMLButtonElement;
  let createButton!: HTMLButtonElement;
  let joinButton!: HTMLButtonElement;
  let readyButton!: HTMLButtonElement;
  let startButton!: HTMLButtonElement;
  let feedback!: HTMLElement;
  let roomsList!: HTMLElement;
  let actions!: HTMLElement;
  let lobbyRoot!: HTMLElement;

  const render = () => {
    if (!feedback) return;
    feedback.textContent = feedbackText;
    connectButton.disabled = connected;
    serverAddress.disabled = connected;
    createButton.disabled = !connected || !!currentRoom;
    joinButton.disabled = !connected || !!currentRoom || !roomSelect.value;
    roomSelect.disabled = !connected || !!currentRoom || rooms.length === 0;
    actions.hidden = !currentRoom;
    roomsList.replaceChildren();
    if (currentRoom) {
      const { room, you } = currentRoom;
      roomsList.append(h('h3.lobby__section-title', null, `${t('multiplayer.room')} ${room.id}`));
      const list = h('ul.lobby__players', null);
      for (const player of room.players) {
        const team = room.mode === 'team' ? ` · ${t('players.teams', { n: player.team + 1 })}` : '';
        list.append(h('li', null, `${player.name}${player.id === 0 ? ` · ${t('multiplayer.host')}` : ''}${team} · ${player.ready ? t('multiplayer.ready') : t('multiplayer.notReady')}`));
      }
      roomsList.append(list);
      const self = room.players.find((player) => player.id === you.playerId);
      readyButton.textContent = self?.ready ? t('multiplayer.unready') : t('multiplayer.ready');
      startButton.hidden = !you.host || room.status !== 'waiting';
      startButton.disabled = room.players.length < 2;
    } else {
      roomsList.append(h('h3.lobby__section-title', null, t('multiplayer.rooms')));
      const list = h('ul.lobby__rooms', null);
      const selected = roomSelect.value;
      roomSelect.replaceChildren(new Option(rooms.length ? t('multiplayer.selectRoom') : t('multiplayer.noRooms'), ''));
      for (const room of rooms) {
        const label = `${room.id} · ${t(room.gameMode === 'classic' ? 'mode.classic' : 'mode.horizon')} · ${room.mode === 'team' ? t('players.teams', { n: 2 }) : t('players.ffa')} · ${room.players}/${room.maxPlayers}`;
        roomSelect.add(new Option(label, room.id));
        list.append(h('li', null, label));
      }
      roomSelect.value = selected;
      roomsList.append(list);
      startButton.hidden = true;
    }
  };

  net.onMessage((message) => {
    switch (message.type) {
      case 'lobby_update': rooms = message.rooms; break;
      case 'room_update': currentRoom = message; break;
      case 'game_start': app.startMultiplayer(message); break;
      case 'error': feedbackText = message.message; break;
      case 'input':
      case 'state': break;
    }
    if (lobbyRoot?.isConnected) render();
  });

  const button = (label: string, primary = false) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `lobby__button${primary ? ' lobby__button--primary' : ''}`;
    b.textContent = label;
    return b;
  };
  const field = (label: string, input: HTMLElement) => h('label.lobby__field', null, h('span', null, label), input);

  return {
    build: () => {
      serverAddress = document.createElement('input');
      serverAddress.type = 'url';
      serverAddress.value = 'ws://localhost:8080';
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
      roomSelect = document.createElement('select');
      connectButton = button(t('multiplayer.connect'), true);
      createButton = button(t('multiplayer.create'));
      joinButton = button(t('multiplayer.join'));
      readyButton = button(t('multiplayer.ready'));
      startButton = button(t('multiplayer.start'), true);
      feedback = h('p.lobby__feedback', { role: 'status', 'aria-live': 'polite' });
      roomsList = h('div.lobby__room-list', null);
      actions = h('div.lobby__actions', null, readyButton, startButton);
      const form = h('div.lobby__form', null,
        field(t('multiplayer.server'), serverAddress), field(t('multiplayer.name'), playerName), connectButton,
        h('div.lobby__create-options', null, field(t('multiplayer.gameMode'), gameMode), field(t('multiplayer.matchType'), roomMode), field(t('multiplayer.capacity'), roomCapacity)),
        createButton, field(t('multiplayer.room'), roomSelect), joinButton,
      );
      connectButton.addEventListener('click', async () => {
        feedbackText = t('multiplayer.connecting');
        render();
        try {
          net.setAddress(serverAddress.value.trim());
          await net.connect();
          net.send({ type: 'lobby' });
          connected = true;
          feedbackText = t('multiplayer.connected');
          connectButton.disabled = true;
          serverAddress.disabled = true;
        } catch (error) {
          feedbackText = error instanceof Error ? error.message : String(error);
        }
        render();
      });
      createButton.addEventListener('click', () => {
        const name = playerName.value.trim();
        if (!name) { feedbackText = t('multiplayer.nameRequired'); render(); return; }
        localStorage.setItem('slingshot.player-name', name);
        net.send({ type: 'create_room', name, mode: roomMode.value as 'ffa' | 'team', gameMode: gameMode.value as 'classic' | 'horizon', maxPlayers: Number(roomCapacity.value) });
      });
      joinButton.addEventListener('click', () => {
        const name = playerName.value.trim();
        if (!name || !roomSelect.value) { feedbackText = t('multiplayer.nameRequired'); render(); return; }
        localStorage.setItem('slingshot.player-name', name);
        net.send({ type: 'join_room', roomId: roomSelect.value, name });
      });
      roomSelect.addEventListener('change', render);
      readyButton.addEventListener('click', () => {
        const self = currentRoom?.room.players.find((p) => p.id === currentRoom?.you.playerId);
        if (self) net.send({ type: 'ready', ready: !self.ready });
      });
      startButton.addEventListener('click', () => net.send({ type: 'start_game' }));
      lobbyRoot = h('section.screen.screen--panel.screen--lobby', { role: 'dialog', 'aria-modal': 'true', 'aria-label': t('multiplayer.title') },
        h('div.panel.panel--wide', null, h('h2.panel__title', null, t('multiplayer.title')), h('div.lobby', null, feedback, form, roomsList, actions), h('div.items', { 'data-items': '' })));
      render();
      return lobbyRoot;
    },
    items: [],
    onEscape: () => { net.close(); app.toTitle(); },
  };
}

export function pauseScreen(app: App): Screen {
  const daily = app.mode === 'challenge';
  return {
    build: () => panel(t('pause.title'), null),
    items: [
      { kind: 'action', label: t('pause.resume'), primary: true, run: () => app.resume() },
      { kind: 'action', label: daily ? t('daily.retry') : t('pause.newGame'), run: () => app.rematch() },
      // Seats make no sense in the daily challenge — it is always you against the targets.
      ...(daily ? [] : [{ kind: 'action', label: t('common.players'), run: () => app.menu.push(() => playersScreen(app)) } satisfies MenuItem]),
      { kind: 'action', label: t('common.settings'), run: () => app.menu.push(() => settingsScreen(app)) },
      { kind: 'action', label: t('common.help'), run: () => app.menu.push(() => helpScreen(app)) },
      { kind: 'action', label: t('common.mainMenu'), run: () => app.toTitle() },
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

export function settingsScreen(app: App): Screen {
  const s = app.settings;
  const choice = <K extends keyof Settings>(label: string, key: K, options: { value: Settings[K]; label: string }[]): MenuItem => ({
    kind: 'choice',
    label,
    options,
    get: () => s[key],
    set: (v) => {
      s[key] = v as Settings[K];
      app.settingsChanged();
    },
  });

  return {
    build: () =>
      panel(t('common.settings'), h('p.note', null, t('settings.note')), 'panel--wide'),
    items: [
      choice(t('settings.rounds'), 'rounds', [1, 3, 5, 7, 10, 15, 20, 0].map((n) => ({ value: n, label: n ? String(n) : t('settings.endless') }))),
      choice(t('settings.maxPlanets'), 'maxPlanets', [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ value: n, label: String(n) }))),
      choice(t('settings.invisible'), 'invisiblePlanets', onOff()),
      choice(t('settings.bounce'), 'bounce', onOff()),
      choice(t('settings.fixedPower'), 'fixedPower', onOff()),
      choice(t('settings.shotTime'), 'shotTime', [10, 20, 30, 60].map((n) => ({ value: n, label: t('settings.seconds', { n }) }))),
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
      { kind: 'action', label: t('common.mainMenu'), run: () => app.toTitle() },
    ],
    onEscape: () => app.toTitle(),
  };
}

function panel(title: string, body: HTMLElement | null, extraClass = ''): HTMLElement {
  return h(
    'section.screen.screen--panel',
    { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h(`div.panel${extraClass ? '.' + extraClass : ''}`, null, h('h2.panel__title', null, title), ...(body ? [body] : []), h('div.items', { 'data-items': '' })),
  );
}
