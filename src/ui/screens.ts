import { NetworkClient, type LobbyRoom, type ServerMessage } from '../net';
import { COLORS, SCORING } from '../config';
import type { Game } from '../game';
import type { Settings } from '../settings';
import { h, type Menu, type MenuItem, type Screen } from './menu';

export interface App {
  menu: Menu;
  settings: Settings;
  settingsChanged(): void;
  startGame(): void;
  connectMultiplayer(): void;
  resume(): void;
  rematch(): void;
  toTitle(): void;
  toggleFullscreen(): void;
  isFullscreen(): boolean;
}

const onOff = [
  { value: true, label: 'An' },
  { value: false, label: 'Aus' },
];

export function titleScreen(app: App): Screen {
  return {
    build: () =>
      h(
        'section.screen.screen--title',
        { 'aria-labelledby': 'wordmark' },
        h(
          'div.title-col',
          null,
          h('p.eyebrow', null, 'Gravitationsduell für zwei'),
          h('h1.wordmark', { id: 'wordmark' }, 'Slingshot'),
          h(
            'p.lede',
            null,
            'Zwei Raumschiffe, dazwischen Planeten. Jeder Schuss folgt der Schwerkraft – lies deine alten Bahnen und tast dich an den Treffer heran.',
          ),
          h('nav.items', { 'data-items': '', 'aria-label': 'Hauptmenü' }),
          h('p.keys', null, '↑ ↓ wählen · Enter bestätigen'),
        ),
      ),
    items: [
      { kind: 'action', label: 'Spiel starten', primary: true, run: () => app.startGame() },
      { kind: 'action', label: 'Multiplayer', run: () => app.connectMultiplayer() },
      { kind: 'action', label: 'Einstellungen', run: () => app.menu.push(settingsScreen(app)) },
      { kind: 'action', label: 'Anleitung', run: () => app.menu.push(helpScreen(app)) },
    ],
  };
}

export function lobbyScreen(app: App, net: NetworkClient): Screen {
  let rooms: LobbyRoom[] = [];
  let currentRoom: Extract<ServerMessage, { type: 'room_update' }> | null = null;
  let roomRequested = false;
  let connected = false;
  let statusMessage = 'Mit einem Server verbinden, um Räume zu sehen.';
  let errorMessage = '';
  let serverAddress!: HTMLInputElement;
  let playerName!: HTMLInputElement;
  let mode!: HTMLSelectElement;
  let capacity!: HTMLSelectElement;
  let roomSelect!: HTMLSelectElement;
  let connectButton!: HTMLButtonElement;
  let createButton!: HTMLButtonElement;
  let joinButton!: HTMLButtonElement;
  let readyButton!: HTMLButtonElement;
  let startButton!: HTMLButtonElement;
  let feedback!: HTMLElement;
  let roomList!: HTMLElement;
  let actions!: HTMLElement;

  const persistName = (): string => {
    const name = playerName.value.trim();
    if (!name) throw new Error('Bitte gib einen Spielernamen ein.');
    localStorage.setItem('slingshot.player-name', name);
    return name;
  };

  const render = () => {
    if (!feedback) return;
    const selectedRoomId = roomSelect?.value ?? '';
    feedback.textContent = errorMessage || statusMessage;
    feedback.classList.toggle('lobby__feedback--error', Boolean(errorMessage));
    connectButton.disabled = connected;
    serverAddress.disabled = connected;
    mode.disabled = !connected || currentRoom !== null;
    capacity.disabled = !connected || currentRoom !== null;
    createButton.disabled = !connected || currentRoom !== null;
    joinButton.disabled = !connected || currentRoom !== null || !roomSelect.value;
    roomSelect.disabled = !connected || currentRoom !== null || rooms.length === 0;
    actions.hidden = currentRoom === null;
    roomList.replaceChildren();

    if (currentRoom) {
      const { room, you } = currentRoom;
      const players = h('ul.lobby__players', null);
      for (const player of room.players) {
        const readyLabel = player.ready ? 'Bereit' : 'Nicht bereit';
        const teamLabel = room.mode === 'team' ? ` · Team ${player.team + 1}` : '';
        const hostLabel = player.id === 0 ? ' · Host' : '';
        players.append(h('li', null, `${player.name}${hostLabel}${teamLabel} — ${readyLabel}`));
      }
      roomList.append(h('h3.lobby__section-title', null, `Raum ${room.id} · ${room.mode === 'team' ? 'Team' : 'FFA'}`), players);
      const self = room.players.find((player) => player.id === you.playerId);
      readyButton.textContent = self?.ready ? 'Bereit zurücknehmen' : 'Bereit';
      readyButton.disabled = room.status !== 'waiting';
      startButton.hidden = !you.host || room.status !== 'waiting';
      startButton.disabled = room.players.length < 2;
    } else {
      roomList.append(h('h3.lobby__section-title', null, 'Verfügbare Räume'));
      const list = h('ul.lobby__rooms', null);
      roomSelect.replaceChildren();
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = rooms.length ? 'Raum auswählen' : 'Keine Räume verfügbar';
      roomSelect.append(placeholder);
      for (const room of rooms) {
        const option = document.createElement('option');
        option.value = room.id;
        option.textContent = `${room.id} · ${room.mode === 'team' ? 'Team' : 'FFA'} · ${room.players}/${room.maxPlayers}`;
        roomSelect.append(option);
        list.append(h('li', null, option.textContent));
      }
      roomSelect.value = selectedRoomId;
      roomList.append(list);
      startButton.hidden = true;
    }
  };

  net.onMessage((message) => {
    switch (message.type) {
      case 'lobby_update':
        rooms = message.rooms;
        if (connected && !currentRoom) statusMessage = rooms.length ? 'Räume aktualisiert.' : 'Verbunden. Noch keine offenen Räume.';
        errorMessage = '';
        break;
      case 'room_update':
        currentRoom = message;
        roomRequested = true;
        errorMessage = '';
        statusMessage = `Im Raum ${message.room.id}${message.room.status === 'playing' ? ' · Spiel läuft' : ''}.`;
        break;
      case 'game_start':
        statusMessage = 'Das Spiel wurde vom Host gestartet.';
        errorMessage = '';
        break;
      case 'error':
        errorMessage = message.message;
        break;
      case 'input':
      case 'state':
        break;
    }
    render();
  });

  return {
    build: () => {
      serverAddress = document.createElement('input');
      serverAddress.type = 'url';
      serverAddress.value = 'ws://localhost:8080';
      serverAddress.setAttribute('aria-label', 'Serveradresse');
      playerName = document.createElement('input');
      playerName.type = 'text';
      playerName.setAttribute('autocomplete', 'nickname');
      playerName.value = localStorage.getItem('slingshot.player-name') || 'Player';
      playerName.setAttribute('aria-label', 'Spielername');
      mode = document.createElement('select');
      mode.setAttribute('aria-label', 'Spielmodus');
      mode.add(new Option('Free-for-All', 'ffa'));
      mode.add(new Option('Team', 'team'));
      capacity = document.createElement('select');
      capacity.setAttribute('aria-label', 'Maximale Spielerzahl');
      for (let count = 2; count <= 6; count++) capacity.add(new Option(String(count), String(count)));
      roomSelect = document.createElement('select');
      roomSelect.setAttribute('aria-label', 'Raum auswählen');
      connectButton = lobbyButton('Verbinden', true);
      createButton = lobbyButton('Raum erstellen');
      joinButton = lobbyButton('Beitreten');
      readyButton = lobbyButton('Bereit');
      startButton = lobbyButton('Spiel starten', true);
      feedback = h('p.lobby__feedback', { role: 'status', 'aria-live': 'polite' });
      roomList = h('div.lobby__room-list', null);
      actions = h('div.lobby__actions', null, readyButton, startButton);

      connectButton.addEventListener('click', async () => {
        errorMessage = '';
        statusMessage = 'Verbindung wird hergestellt …';
        render();
        try {
          net.setAddress(serverAddress.value.trim());
          await net.connect();
          net.send({ type: 'lobby' });
          connected = true;
          statusMessage = 'Verbunden. Räume werden geladen …';
        } catch (error) {
          errorMessage = error instanceof Error ? error.message : String(error);
          statusMessage = 'Verbindung fehlgeschlagen.';
        }
        render();
      });
      createButton.addEventListener('click', () => {
        try {
          const name = persistName();
          net.send({ type: 'create_room', name, mode: mode.value as 'ffa' | 'team', maxPlayers: Number(capacity.value) });
          roomRequested = true;
          statusMessage = 'Raum wird erstellt …';
          errorMessage = '';
        } catch (error) {
          errorMessage = error instanceof Error ? error.message : String(error);
        }
        render();
      });
      joinButton.addEventListener('click', () => {
        try {
          const name = persistName();
          if (!roomSelect.value) throw new Error('Wähle zuerst einen Raum aus.');
          net.send({ type: 'join_room', roomId: roomSelect.value, name });
          roomRequested = true;
          statusMessage = 'Raumbeitritt wird angefragt …';
          errorMessage = '';
        } catch (error) {
          errorMessage = error instanceof Error ? error.message : String(error);
        }
        render();
      });
      readyButton.addEventListener('click', () => {
        if (!currentRoom) return;
        const self = currentRoom.room.players.find((player) => player.id === currentRoom?.you.playerId);
        if (!self) return;
        try {
          net.send({ type: 'ready', ready: !self.ready });
          errorMessage = '';
        } catch (error) {
          errorMessage = error instanceof Error ? error.message : String(error);
          render();
        }
      });
      startButton.addEventListener('click', () => {
        try {
          net.send({ type: 'start_game' });
          errorMessage = '';
        } catch (error) {
          errorMessage = error instanceof Error ? error.message : String(error);
          render();
        }
      });
      roomSelect.addEventListener('change', render);
      const row = (label: string, control: HTMLElement) => h('label.lobby__field', null, h('span', null, label), control);
      const form = h(
        'div.lobby__form',
        null,
        row('Serveradresse', serverAddress),
        row('Spielername', playerName),
        connectButton,
        h('div.lobby__create-options', null, row('Modus', mode), row('Maximale Spieler', capacity)),
        createButton,
        row('Raum', roomSelect),
        joinButton,
      );
      const content = h('div.lobby', null, feedback, form, roomList, actions);
      const screen = h(
        'section.screen.screen--panel.screen--lobby',
        { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Multiplayer-Lobby' },
        h('div.panel.panel--wide', null, h('h2.panel__title', null, 'Lobby'), content, h('div.items', { 'data-items': '' })),
      );
      render();
      return screen;
    },
    items: [],
    onEscape: () => {
      if (currentRoom || roomRequested) {
        try {
          net.send({ type: 'leave_room' });
        } catch {
          // A closed transport has already left the room.
        }
      }
      net.close();
      app.toTitle();
    },
  };
}

function lobbyButton(label: string, primary = false): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `lobby__button${primary ? ' lobby__button--primary' : ''}`;
  button.textContent = label;
  return button;
}

export function pauseScreen(app: App): Screen {
  return {
    build: () => panel('Pause', null),
    items: [
      { kind: 'action', label: 'Weiterspielen', primary: true, run: () => app.resume() },
      { kind: 'action', label: 'Neues Spiel', run: () => app.rematch() },
      { kind: 'action', label: 'Einstellungen', run: () => app.menu.push(settingsScreen(app)) },
      { kind: 'action', label: 'Anleitung', run: () => app.menu.push(helpScreen(app)) },
      { kind: 'action', label: 'Hauptmenü', run: () => app.toTitle() },
    ],
    onEscape: () => app.resume(),
  };
}

export function settingsScreen(app: App): Screen {
  const settings = app.settings;
  const choice = <K extends keyof Settings>(
    label: string,
    key: K,
    options: { value: Settings[K]; label: string }[],
    disabled?: () => boolean,
  ): MenuItem => ({
    kind: 'choice',
    label,
    options,
    get: () => settings[key],
    set: (value) => {
      settings[key] = value as Settings[K];
      app.settingsChanged();
    },
    disabled,
  });
  return {
    build: () => panel('Einstellungen', h('p.note', null, 'Änderungen werden sofort übernommen.')),
    items: [
      choice('Gegner', 'opponent', [
        { value: 'human', label: 'Mensch' },
        { value: 'cpu', label: 'CPU' },
      ]),
      choice('CPU-Stärke', 'cpuLevel', [
        { value: 'easy', label: 'Leicht' },
        { value: 'medium', label: 'Mittel' },
        { value: 'hard', label: 'Schwer' },
      ], () => settings.opponent !== 'cpu'),
      choice('Runden', 'rounds', [
        { value: 0, label: 'Endlos' },
        { value: 3, label: '3' },
        { value: 5, label: '5' },
        { value: 10, label: '10' },
      ]),
      choice('Maximale Planeten', 'maxPlanets', [2, 3, 4, 5, 6, 7, 8].map((value) => ({ value, label: String(value) }))),
      choice('Unsichtbare Planeten', 'invisiblePlanets', onOff),
      choice('Abprallen', 'bounce', onOff),
      choice('Feste Schusskraft', 'fixedPower', onOff),
      choice('Schusszeit', 'shotTime', [
        { value: 10, label: '10 s' },
        { value: 20, label: '20 s' },
        { value: 30, label: '30 s' },
      ]),
      choice('Gravitationslinien', 'contours', onOff),
      choice('Partikel', 'particles', onOff),
      choice('Ton', 'sound', onOff),
      {
        kind: 'action',
        label: app.isFullscreen() ? 'Vollbild verlassen' : 'Vollbild',
        run: () => {
          app.toggleFullscreen();
          app.menu.refresh();
        },
      },
      { kind: 'action', label: 'Zurück', primary: true, run: () => app.menu.back() },
    ],
    onEscape: () => app.menu.back(),
  };
}

export function helpScreen(app: App): Screen {
  const key = (value: string) => h('kbd', null, value);
  const row = (keys: (Node | string)[], text: string) => h('tr', null, h('th', { scope: 'row' }, ...keys), h('td', null, text));
  const body = h(
    'div.help',
    null,
    h('p', null, 'Ziele mit Winkel und Kraft, um das gegnerische Schiff zu treffen. Die Gravitation der Planeten krümmt jede Flugbahn.'),
    h('p', null, `Treffer bringen bis zu ${SCORING.BASE} Punkte. Wer sich selbst trifft, schenkt dem Gegner ${SCORING.SELF_HIT} Punkte.`),
    h(
      'table.keys-table',
      null,
      h(
        'tbody',
        null,
        row([key('←'), key('→'), key('↑'), key('↓')], 'Winkel und Schusskraft einstellen'),
        row([key('Shift'), key('←/→'), key('↑/↓')], 'Winkel und Kraft in größeren Schritten ändern'),
        row([key('Space')], 'Schießen oder nächste Runde'),
        row([key('Esc')], 'Pausemenü öffnen'),
        row([key('F')], 'Vollbild umschalten'),
      ),
    ),
  );
  return {
    build: () => panel('Anleitung', body, 'panel--wide'),
    items: [{ kind: 'action', label: 'Zurück', primary: true, run: () => app.menu.back() }],
    onEscape: () => app.menu.back(),
  };
}

export function gameOverScreen(app: App, game: Game, names: string[]): Screen {
  const leader = game.leader;
  const winningTeam = game.winningTeam;
  const headline = game.mode === 'team'
    ? winningTeam === null ? 'Unentschieden' : `Team ${winningTeam + 1} gewinnt`
    : leader === null ? 'Unentschieden' : `${names[leader]} gewinnt`;
  return {
    build: () => {
      const title = h('h2.result', null, headline);
      if (game.mode === 'team' && winningTeam !== null) title.style.color = COLORS.players[winningTeam];
      else if (leader !== null) title.style.color = COLORS.players[leader];
      const scores = h('div.scoreline', null);
      if (game.mode === 'team') {
        const [teamA, teamB] = game.teamScores;
        const first = h('span.scoreline__n', null, `Team 1: ${teamA}`);
        first.style.color = COLORS.players[0];
        const second = h('span.scoreline__n', null, `Team 2: ${teamB}`);
        second.style.color = COLORS.players[1];
        scores.append(first, h('span.scoreline__sep', null, ' · '), second);
      } else {
        game.players.forEach((player, id) => {
          const score = h('span.scoreline__n', null, `${names[id]}: ${player.score}`);
          score.style.color = COLORS.players[id];
          scores.append(score);
        });
      }
      return h(
        'section.screen.screen--panel',
        { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Endstand' },
        h(
          'div.panel.panel--result',
          null,
          h('p.eyebrow', null, `Endstand nach ${game.round} ${game.round === 1 ? 'Runde' : 'Runden'}`),
          title,
          scores,
          h('div.items.items--row', { 'data-items': '' }),
        ),
      );
    },
    items: [
      { kind: 'action', label: 'Revanche', primary: true, run: () => app.rematch() },
      { kind: 'action', label: 'Hauptmenü', run: () => app.toTitle() },
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
