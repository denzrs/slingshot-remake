import { MAX_PLAYERS, TEAMS } from '../config';
import { t } from '../i18n';
import { loadLobbyPrefs, saveLobbyPrefs } from '../lobbyPrefs';
import { DEFAULT_SERVER, type MultiplayerSession } from '../multiplayer';
import type { LobbyRoom, NetworkGameMode, RoomInfo, RoomRules } from '../net';
import { h, type Screen } from './menu';
import { ruleLabel, rulesFor } from './rules';
import type { App } from './screens';

const modeName = (mode: NetworkGameMode) => t(mode === 'classic' ? 'mode.classic' : 'mode.horizon');
const matchTypeName = (mode: 'ffa' | 'team') => (mode === 'team' ? t('players.teams', { n: 2 }) : t('players.ffa'));

function button(label: string, primary = false): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `lobby__button${primary ? ' lobby__button--primary' : ''}`;
  b.textContent = label;
  return b;
}

function textInput(value: string, attrs: Partial<HTMLInputElement> = {}): HTMLInputElement {
  const input = document.createElement('input');
  Object.assign(input, attrs, { value });
  return input;
}

function passwordInput(placeholder = ''): HTMLInputElement {
  return textInput('', { type: 'password', maxLength: 64, autocomplete: 'off', placeholder });
}

const field = (label: string, input: HTMLElement) => h('label.lobby__field', null, h('span', null, label), input);

function select<T extends string | number | boolean>(options: { value: T; label: string }[], current: T, onChange: (value: T) => void): HTMLSelectElement {
  const el = document.createElement('select');
  options.forEach((o, i) => el.add(new Option(o.label, String(i))));
  el.value = String(Math.max(0, options.findIndex((o) => o.value === current)));
  el.addEventListener('change', () => onChange(options[Number(el.value)].value));
  return el;
}

/** The rules as editable selects. */
function rulesEditor(rules: RoomRules, gameMode: NetworkGameMode, onChange: (rules: RoomRules) => void): HTMLElement {
  // Every select builds on the latest rules, so changing two of them keeps both.
  let current = rules;
  return h(
    'div.lobby__rules',
    null,
    ...rulesFor(gameMode).map((row) =>
      field(row.label, select(row.options, rules[row.key], (value) => {
        current = { ...current, [row.key]: value };
        onChange(current);
      })),
    ),
  );
}

/** The rules as a read-only list, for everybody but the host. */
function rulesSummary(rules: RoomRules, gameMode: NetworkGameMode): HTMLElement {
  return h(
    'dl.lobby__summary',
    null,
    ...rulesFor(gameMode).flatMap((row) => [h('dt', null, row.label), h('dd', null, ruleLabel(row, rules[row.key]))]),
  );
}

/**
 * Online play: connect to a relay, browse or create rooms, wait for the others. Everything the
 * player fills in is remembered, and the room's rules are chosen here — the host can still change
 * them while the room is waiting.
 */
export function lobbyScreen(app: App, session: MultiplayerSession): Screen {
  const prefs = loadLobbyPrefs(DEFAULT_SERVER, app.settings);
  const save = () => saveLobbyPrefs(prefs);
  /** Connection progress / validation messages that don't come from the session. */
  let localMessage: string | null = null;
  /** Join passwords typed so far, per room — the room list is rebuilt whenever it changes. */
  const joinPasswords = new Map<string, string>();

  const feedback = h('p.lobby__feedback', { role: 'status', 'aria-live': 'polite' });
  const serverAddress = textInput(session.client.address && session.connected ? session.client.address : prefs.server, { type: 'url', spellcheck: false });
  const playerName = textInput(prefs.name, { maxLength: 24 });
playerName.setAttribute('autocomplete', 'nickname');
  const connectButton = button(t('multiplayer.connect'), true);
  const connection = h('section.lobby__card', null, h('h3.lobby__section-title', null, t('multiplayer.connection')), field(t('multiplayer.server'), serverAddress), field(t('multiplayer.name'), playerName), connectButton);

  const roomsList = h('ul.lobby__rooms', null);
  const rooms = h('section.lobby__card', null, h('h3.lobby__section-title', null, t('multiplayer.rooms')), roomsList);

  const createDetails = h('div.lobby__create', null);
  const createButton = button(t('multiplayer.create'), true);
  const create = h('section.lobby__card', null, h('h3.lobby__section-title', null, t('multiplayer.newRoom')), createDetails, createButton);

  const roomView = h('section.lobby__card.lobby__card--room', null);
  // Out of a room, the way back to the main menu; inside one there is "Leave room".
  const backButton = button(`← ${t('common.mainMenu')}`);
  const backBar = h('div.lobby__back', null, backButton);
  const lobbyView = h('div.lobby__columns', null, h('div.lobby__col', null, connection, create), h('div.lobby__col', null, rooms));

  const root = h(
    'section.screen.screen--panel.screen--lobby',
    { role: 'dialog', 'aria-modal': 'true', 'aria-label': t('multiplayer.title') },
    h('div.panel.panel--lobby', null, h('h2.panel__title', null, t('multiplayer.title')), h('div.lobby', null, feedback, lobbyView, roomView, backBar), h('div.items', { 'data-items': '' })),
  );

  // ————————————————————————————— Create form —————————————————————————————

  const buildCreateForm = () => {
    const capacity = select(Array.from({ length: MAX_PLAYERS - 1 }, (_, i) => ({ value: i + 2, label: String(i + 2) })), prefs.capacity, (n) => {
      prefs.capacity = n;
      save();
    });
    const password = passwordInput();
    createDetails.replaceChildren(
      h('div.lobby__pair', null,
        field(t('multiplayer.gameMode'), select<NetworkGameMode>([{ value: 'classic', label: modeName('classic') }, { value: 'horizon', label: modeName('horizon') }], prefs.gameMode, (mode) => {
          prefs.gameMode = mode;
          save();
          // Classic-only rules appear or disappear.
          buildCreateForm();
        })),
        field(t('multiplayer.matchType'), select<'ffa' | 'team'>([{ value: 'ffa', label: matchTypeName('ffa') }, { value: 'team', label: matchTypeName('team') }], prefs.matchType, (mode) => {
          prefs.matchType = mode;
          save();
        })),
      ),
      h('div.lobby__pair', null, field(t('multiplayer.capacity'), capacity), field(t('multiplayer.passwordOptional'), password)),
      h('h4.lobby__subtitle', null, t('multiplayer.rules')),
      rulesEditor(prefs.rules, prefs.gameMode, (rules) => {
        prefs.rules = rules;
        save();
      }),
      ...(prefs.gameMode === 'horizon' ? [h('p.lobby__note', null, t('multiplayer.horizonNote'))] : []),
    );
    createButton.onclick = () => {
      const name = takeName();
      if (!name) return;
      session.createRoom({ name, mode: prefs.matchType, gameMode: prefs.gameMode, rules: prefs.rules, maxPlayers: prefs.capacity, password: password.value });
      password.value = '';
    };
  };

  /** The trimmed player name, remembered for next time; null (with a message) when empty. */
  const takeName = (): string | null => {
    const name = playerName.value.trim();
    if (!name) {
      localMessage = t('multiplayer.nameRequired');
      render();
      return null;
    }
    prefs.name = name;
    save();
    localMessage = null;
    return name;
  };

  // ————————————————————————————— Rendering —————————————————————————————

  const roomRow = (room: LobbyRoom) => {
    const full = room.players >= room.maxPlayers;
    const join = button(t('multiplayer.join'), true);
    join.disabled = full;
    const password = passwordInput(t('multiplayer.password'));
    password.value = joinPasswords.get(room.id) ?? '';
    password.addEventListener('input', () => joinPasswords.set(room.id, password.value));
    const doJoin = () => {
      const name = takeName();
      if (!name) return;
      session.joinRoom(room.id, name, password.value);
      joinPasswords.delete(room.id);
    };
    join.addEventListener('click', doJoin);
    password.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doJoin();
    });
    return h(
      'li.lobby-room',
      null,
      h('div.lobby-room__info', null,
        h('strong', null, `${room.locked ? '🔒 ' : ''}${t('multiplayer.roomOf', { name: room.host || room.id })}`),
        h('span', null, `${modeName(room.gameMode)} · ${matchTypeName(room.mode)} · ${room.players}/${room.maxPlayers}`)),
      room.locked ? password : '',
      join,
    );
  };

  const renderRoom = (room: RoomInfo) => {
    const { you } = session;
    const self = room.players.find((p) => p.id === you.playerId);
    const players = h('ul.lobby__players', null, ...room.players.map((player) => {
      const dot = h('span.lobby__dot', null);
      if (room.mode === 'team') dot.style.background = TEAMS[player.team][0];
      else dot.classList.add('lobby__dot--none');
      return h(
        'li',
        null,
        dot,
        h('span.lobby__player-name', null, player.name),
        ...(player.id === you.playerId ? [h('span.lobby__tag', null, t('multiplayer.you'))] : []),
        ...(player.id === 0 ? [h('span.lobby__tag.lobby__tag--host', null, t('multiplayer.host'))] : []),
        ...(room.mode === 'team' ? [h('span.lobby__tag', null, t('players.teams', { n: player.team + 1 }))] : []),
        h(player.ready ? 'span.lobby__ready.lobby__ready--on' : 'span.lobby__ready', null, player.ready ? `✓ ${t('multiplayer.ready')}` : t('multiplayer.notReady')),
      );
    }));
    const ready = button(self?.ready ? t('multiplayer.unready') : t('multiplayer.ready'), !self?.ready);
    ready.addEventListener('click', () => session.setReady(!self?.ready));
    const start = button(t('multiplayer.start'), true);
    start.hidden = !you.host;
    start.disabled = room.players.length < 2;
    start.addEventListener('click', () => session.startGame());
    const leave = button(t('multiplayer.leave'));
    leave.addEventListener('click', () => session.leaveRoom());

    roomView.replaceChildren(
      h('h3.lobby__section-title', null, `${t('multiplayer.room')} · ${modeName(room.gameMode)} · ${matchTypeName(room.mode)}${room.locked ? ' 🔒' : ''}`),
      h('p.lobby__note', null, `${room.players.length}/${room.maxPlayers} ${t('multiplayer.players')}`),
      players,
      h('h4.lobby__subtitle', null, t('multiplayer.rules')),
      you.host ? rulesEditor(room.rules, room.gameMode, (rules) => session.setRules(rules)) : rulesSummary(room.rules, room.gameMode),
      h('p.lobby__note', null, [you.host ? t('multiplayer.rulesResetNote') : t('multiplayer.hostRules'), room.gameMode === 'horizon' ? t('multiplayer.horizonNote') : ''].filter(Boolean).join(' ')),
      h('div.lobby__actions', null, ready, start, leave),
    );
  };

  const render = () => {
    const { connected, connecting, room, rooms: open } = session;
    feedback.textContent = localMessage ?? session.notice ?? (room ? '' : connected ? t('multiplayer.connected') : connecting ? t('multiplayer.connecting') : t('multiplayer.connectHint'));
    lobbyView.hidden = !!room;
    roomView.hidden = !room;
    backBar.hidden = !!room;
    if (room) return renderRoom(room);

    connectButton.textContent = connected ? t('multiplayer.disconnect') : t('multiplayer.connect');
    connectButton.classList.toggle('lobby__button--primary', !connected);
    connectButton.disabled = connecting;
    serverAddress.disabled = connected || connecting;
    create.hidden = !connected;
    rooms.hidden = !connected;
    roomsList.replaceChildren(...(open.length ? open.map(roomRow) : [h('li.lobby__empty', null, t('multiplayer.noRooms'))]));
  };

  const connect = async (silent: boolean) => {
    localMessage = silent ? null : t('multiplayer.connecting');
    render();
    try {
      await session.connect(serverAddress.value.trim());
      prefs.server = serverAddress.value.trim();
      prefs.autoConnect = true;
      localMessage = null;
    } catch (error) {
      prefs.autoConnect = false;
      localMessage = error instanceof Error ? error.message : String(error);
    }
    save();
    render();
  };

  connectButton.addEventListener('click', () => {
    if (!session.connected) return void connect(false);
    session.disconnect();
    prefs.autoConnect = false;
    save();
  });
  playerName.addEventListener('change', () => {
    prefs.name = playerName.value.trim() || prefs.name;
    save();
  });

  /** Leave the room, or — from the lobby itself — disconnect and go back to the title screen. */
  const goBack = () => {
    if (session.room) session.leaveRoom();
    else {
      session.disconnect();
      app.toTitle();
    }
  };
  backButton.addEventListener('click', goBack);

  return {
    build: () => {
      buildCreateForm();
      // The session outlives this screen: re-render on its changes until the screen is gone.
      const unsubscribe = session.subscribe(() => {
        if (!root.isConnected) return unsubscribe();
        localMessage = null;
        render();
      });
      render();
      // Came back to a lobby that worked before: reconnect without making the player press anything.
      // Deferred until the screen is in the DOM — the session's updates only reach a mounted screen.
      if (!session.connected && !session.connecting && !session.room && prefs.autoConnect) setTimeout(() => void connect(true), 0);
      return root;
    },
    items: [],
    onEscape: goBack,
  };
}
