import { MAX_PLAYERS, TEAMS } from '../config';
import { teamName } from '../game';
import { t } from '../i18n';
import { loadLobbyPrefs, saveLobbyPrefs } from '../lobbyPrefs';
import { DEFAULT_SERVER, type MultiplayerSession } from '../multiplayer';
import type { LobbyRoom, NetworkGameMode, RoomInfo, RoomMode, RoomRules } from '../net';
import { buildControl, segmentedControl, sliderControl, type Control, type Env } from './controls';
import { h, type Screen } from './menu';
import { groupTitle, RULE_GROUPS, ruleItems, type RuleSource } from './rules';
import type { App } from './screens';

const modeName = (mode: NetworkGameMode) => t(mode === 'classic' ? 'mode.classic' : 'mode.horizon');
const matchTypeName = (mode: RoomMode) => (mode === 'team' ? t('players.teams', { n: 2 }) : t('players.ffa'));

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

/** One of the pips that show how full a room is. */
const pips = (taken: number, total: number) => h('span.pips.pips--room', { role: 'img', 'aria-label': `${taken}/${total}` }, ...Array.from({ length: total }, (_, i) => h(i < taken ? 'span.pip.pip--on' : 'span.pip', null)));

interface RulesForm {
  el: HTMLElement;
  /** Show the rules as they are now. */
  refresh(): void;
}

/**
 * The rules of a game as sliders and switches, in the blocks of the setup screen. Read-only, they
 * are what everybody but the host sees of a room.
 */
function rulesForm(mode: NetworkGameMode, source: RuleSource, app: App, readonly = false): RulesForm {
  const controls: Control[] = [];
  const refresh = () => controls.forEach((c) => c.refresh());
  const env: Env = { sound: app.menu.sound, readonly, changed: refresh };
  const items = ruleItems(mode, source);
  const groups = RULE_GROUPS.filter((group) => items.some((i) => i.group === group)).map((group) => {
    const rows = h('div.setup__rows', null);
    for (const { group: g, item } of items) {
      if (g !== group) continue;
      const control = buildControl(item, env);
      controls.push(control);
      rows.append(control.el);
    }
    return h('section.setup__group', null, h('h3.setup__title', null, groupTitle(group)), rows);
  });
  const el = h('div.setup.setup--lobby', null, ...groups);
  refresh();
  return { el, refresh };
}

/** What the lobby is showing while the player is not in a room. */
type View = 'rooms' | 'create';

/**
 * Online play, one step at a time: connect to a relay, see the open rooms, open one of your own —
 * and wait for the others inside it. The lobby has its own settings, apart from the offline ones;
 * everything the player fills in is remembered, and the host can still change the rules while the
 * room is waiting.
 */
export function lobbyScreen(app: App, session: MultiplayerSession): Screen {
  const prefs = loadLobbyPrefs(DEFAULT_SERVER);
  const save = () => saveLobbyPrefs(prefs);
  const sound = app.menu.sound;
  /** Connection progress / validation messages that don't come from the session. */
  let localMessage: string | null = null;
  let view: View = 'rooms';
  /** Join passwords typed so far, per room — the room list is rebuilt whenever it changes. */
  const joinPasswords = new Map<string, string>();

  const status = h('p.lobby__status', { role: 'status', 'aria-live': 'polite' });

  // ————————————————————————————— Connecting —————————————————————————————

  const serverAddress = textInput(session.client.address && session.connected ? session.client.address : prefs.server, { type: 'url', spellcheck: false });
  const playerName = textInput(prefs.name, { maxLength: 24 });
  playerName.setAttribute('autocomplete', 'nickname');
  /** The name belongs to the connection card until there is a connection, and to the bar after it. */
  const nameField = field(t('multiplayer.name'), playerName);
  const connectButton = button(t('multiplayer.connect'), true);
  const connectFields = h('div.lobby__fields', null, field(t('multiplayer.server'), serverAddress));
  const connectView = h('section.lobby__card.lobby__card--narrow', null, h('h3.setup__title', null, t('multiplayer.connection')), connectFields, connectButton);

  /** Once connected: who you are connected to, your name, a way out. */
  const linkText = h('span.lobby__link-text', null);
  const barName = h('div.lobby__name', null);
  const disconnectButton = button(t('multiplayer.disconnect'));
  const bar = h('div.lobby__bar', null, h('span.lobby__link', null, linkText), barName, disconnectButton);

  // ————————————————————————————— The open rooms —————————————————————————————

  const openCreate = button(t('multiplayer.openCreate'), true);
  const roomsList = h('ul.lobby__rooms', null);
  const roomsView = h('section.lobby__card', null, h('div.lobby__head', null, h('h3.setup__title', null, t('multiplayer.rooms')), openCreate), roomsList);

  /** The trimmed player name, remembered for next time; null (with a message) when empty. */
  const takeName = (): string | null => {
    const name = playerName.value.trim();
    if (!name) {
      localMessage = t('multiplayer.nameRequired');
      render();
      playerName.focus();
      return null;
    }
    prefs.name = name;
    save();
    localMessage = null;
    return name;
  };

  const roomRow = (room: LobbyRoom) => {
    const full = room.players >= room.maxPlayers;
    const join = button(full ? t('multiplayer.full') : t('multiplayer.join'), true);
    join.disabled = full;
    const pass = passwordInput(t('multiplayer.password'));
    pass.value = joinPasswords.get(room.id) ?? '';
    pass.addEventListener('input', () => joinPasswords.set(room.id, pass.value));
    const doJoin = () => {
      const name = takeName();
      if (!name) return;
      session.joinRoom(room.id, name, pass.value);
      joinPasswords.delete(room.id);
    };
    join.addEventListener('click', doJoin);
    pass.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doJoin();
    });
    return h(
      'li.lobby-room',
      null,
      h(
        'div.lobby-room__info',
        null,
        h('strong', null, `${room.locked ? '🔒 ' : ''}${t('multiplayer.roomOf', { name: room.host || room.id })}`),
        h('span.lobby-room__tags', null, h('span.lobby__tag', null, modeName(room.gameMode)), h('span.lobby__tag', null, matchTypeName(room.mode)), pips(room.players, room.maxPlayers)),
      ),
      room.locked ? pass : '',
      join,
    );
  };

  /** What the room list showed last: it is only rebuilt when that changes, so a half-typed password survives. */
  let shownRooms = '';
  const renderRooms = (open: LobbyRoom[]) => {
    const key = JSON.stringify(open);
    if (key === shownRooms) return;
    shownRooms = key;
    roomsList.replaceChildren(...(open.length ? open.map(roomRow) : [h('li.lobby__empty', null, h('strong', null, t('multiplayer.noRooms')), h('span', null, t('multiplayer.noRoomsHint')))]));
  };

  // ————————————————————————————— Opening a room —————————————————————————————

  const password = passwordInput();
  const horizonNote = h('p.lobby__note', null, t('multiplayer.horizonNote'));
  /** Where the rules of the room to create go; rebuilt when the game mode changes the list. */
  const createRules = h('div', null);
  const buildCreateRules = () => {
    createRules.replaceChildren(rulesForm(prefs.gameMode, { get: () => prefs.rules, patch: (v) => (prefs.rules = { ...prefs.rules, ...v }), commit: save }, app).el);
    horizonNote.hidden = prefs.gameMode !== 'horizon';
  };

  // The controls redraw themselves; nothing else on this form depends on them.
  const env: Env = { sound, changed: () => {} };
  const gameMode = segmentedControl(
    {
      kind: 'segmented',
      label: t('multiplayer.gameMode'),
      options: [{ value: 'classic', label: modeName('classic') }, { value: 'horizon', label: modeName('horizon') }],
      get: () => prefs.gameMode,
      set: (v) => {
        prefs.gameMode = v as NetworkGameMode;
        save();
        // Classic-only rules appear or disappear.
        buildCreateRules();
      },
    },
    env,
  );
  const matchType = segmentedControl(
    {
      kind: 'segmented',
      label: t('multiplayer.matchType'),
      options: [{ value: 'ffa', label: matchTypeName('ffa') }, { value: 'team', label: matchTypeName('team') }],
      get: () => prefs.matchType,
      set: (v) => {
        prefs.matchType = v as RoomMode;
        save();
      },
    },
    env,
  );
  const capacity = sliderControl(
    {
      kind: 'slider',
      label: t('multiplayer.capacity'),
      steps: Array.from({ length: MAX_PLAYERS - 1 }, (_, i) => ({ value: i + 2, label: String(i + 2) })),
      get: () => prefs.capacity,
      set: (v) => (prefs.capacity = v as number),
      commit: save,
    },
    env,
  );

  const backToRooms = button(t('multiplayer.backToRooms'));
  const createButton = button(t('multiplayer.create'), true);
  const createView = h(
    'section.lobby__card.lobby__card--wide',
    null,
    h('h3.setup__title', null, t('multiplayer.newRoom')),
    h('div.lobby__basics', null, h('div', null, gameMode.el, matchType.el), h('div', null, capacity.el, field(t('multiplayer.passwordOptional'), password))),
    createRules,
    horizonNote,
    h('div.lobby__actions', null, backToRooms, createButton),
  );
  buildCreateRules();

  createButton.addEventListener('click', () => {
    const name = takeName();
    if (!name) return;
    session.createRoom({ name, mode: prefs.matchType, gameMode: prefs.gameMode, rules: prefs.rules, maxPlayers: prefs.capacity, password: password.value });
    password.value = '';
  });

  // ————————————————————————————— Inside a room —————————————————————————————

  const roomTitle = h('h3.setup__title', null);
  const roomCount = h('p.lobby__note', null);
  const players = h('ul.lobby__players', null);
  /** Where the rules of the room are: sliders for the host, the same, locked, for everybody else. */
  const roomRules = h('div', null);
  /** Above the rules: that they reset everybody's "ready" (host), or that they are not yours to change (everyone else). */
  const rulesNote = h('p.lobby__rules-note', null);
  const roomNote = h('p.lobby__note', null);
  const ready = button(t('multiplayer.ready'), true);
  const start = button(t('multiplayer.start'), true);
  const leave = button(t('multiplayer.leave'));
  let selfReady = false;
  ready.addEventListener('click', () => session.setReady(!selfReady));
  start.addEventListener('click', () => session.startGame());
  leave.addEventListener('click', () => session.leaveRoom());
  const roomView = h('section.lobby__card.lobby__card--wide', null, roomTitle, roomCount, players, rulesNote, roomRules, roomNote, h('div.lobby__actions', null, ready, start, leave));

  /** The rules as the host is editing them; the room's own once nobody is. */
  let draft: RoomRules | null = null;
  let touched = 0;
  let sendTimer: ReturnType<typeof setTimeout> | undefined;
  let form: RulesForm | null = null;
  let formKey = '';

  const roomSource = (room: RoomInfo): RuleSource => ({
    get: () => draft ?? session.room?.rules ?? room.rules,
    patch: (v) => {
      draft = { ...(draft ?? session.room?.rules ?? room.rules), ...v };
      touched = Date.now();
    },
    // Every change resets everybody to "not ready", so a burst of key presses goes out as one.
    commit: () => {
      clearTimeout(sendTimer);
      sendTimer = setTimeout(() => {
        sendTimer = undefined;
        if (draft) session.setRules(draft);
      }, 250);
    },
  });

  const renderRoom = (room: RoomInfo) => {
    const { you } = session;
    const self = room.players.find((p) => p.id === you.playerId);
    selfReady = !!self?.ready;
    roomTitle.textContent = `${t('multiplayer.room')} · ${modeName(room.gameMode)} · ${matchTypeName(room.mode)}${room.locked ? ' 🔒' : ''}`;
    roomCount.textContent = `${room.players.length}/${room.maxPlayers} ${t('multiplayer.players')}`;
    players.replaceChildren(
      ...room.players.map((player) => {
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
          ...(room.mode === 'team' ? [h('span.lobby__tag', null, teamName(player.team))] : []),
          h(player.ready ? 'span.lobby__ready.lobby__ready--on' : 'span.lobby__ready', null, player.ready ? `✓ ${t('multiplayer.ready')}` : t('multiplayer.notReady')),
        );
      }),
    );

    // The sliders live as long as the room does: rebuilding them at every update would drop the one being dragged.
    const key = `${room.id}|${room.gameMode}|${you.host}`;
    if (key !== formKey) {
      formKey = key;
      draft = null;
      form = rulesForm(room.gameMode, roomSource(room), app, !you.host);
      roomRules.replaceChildren(form.el);
    }
    // What the host is in the middle of changing wins over the room's last word for a moment.
    if (Date.now() - touched > 1000 && !sendTimer) draft = null;
    form?.refresh();

    rulesNote.textContent = you.host ? t('multiplayer.rulesResetNote') : `🔒 ${t('multiplayer.hostRules')}`;
    rulesNote.classList.toggle('is-locked', !you.host);
    roomNote.textContent = room.gameMode === 'horizon' ? t('multiplayer.horizonNote') : '';
    roomNote.hidden = !roomNote.textContent;
    ready.textContent = self?.ready ? t('multiplayer.unready') : t('multiplayer.ready');
    ready.classList.toggle('lobby__button--primary', !self?.ready);
    start.hidden = !you.host;
    // Everybody but the host must be ready; the host's click is its own "ready".
    start.disabled = room.players.length < 2 || !room.players.every((p) => p.id === 0 || p.ready);
  };

  // ————————————————————————————— Rendering —————————————————————————————

  // Out of a room, the way back to the main menu; inside one there is "Leave room".
  const backButton = button(`← ${t('common.mainMenu')}`);
  const backBar = h('div.lobby__back', null, backButton);

  const root = h(
    'section.screen.screen--panel.screen--lobby',
    { role: 'dialog', 'aria-modal': 'true', 'aria-label': t('multiplayer.title') },
    h('div.panel.panel--lobby', null, h('h2.panel__title', null, t('multiplayer.title')), h('div.lobby', null, status, bar, connectView, roomsView, createView, roomView, backBar), h('div.items', { 'data-items': '' })),
  );

  const render = () => {
    const { connected, connecting, room, rooms: open } = session;
    // A room, once left, leaves you at the list of rooms.
    if (room) view = 'rooms';
    const message = localMessage ?? session.notice ?? (connecting ? t('multiplayer.connecting') : !connected ? t('multiplayer.connectHint') : '');
    status.textContent = message;
    status.classList.toggle('is-busy', connecting);
    status.hidden = !message;

    const browsing = connected && !room;
    bar.hidden = !browsing;
    connectView.hidden = connected;
    roomsView.hidden = !(browsing && view === 'rooms');
    createView.hidden = !(browsing && view === 'create');
    roomView.hidden = !room;
    backBar.hidden = !!room || (connected && view === 'create');
    if (room) return renderRoom(room);
    // Out of the room the next one starts from scratch.
    formKey = '';

    (connected ? barName : connectFields).append(nameField);
    linkText.textContent = t('multiplayer.connectedTo', { server: session.client.address || prefs.server });
    connectButton.disabled = connecting;
    serverAddress.disabled = connecting;
    renderRooms(open);
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

  const show = (next: View) => {
    view = next;
    localMessage = null;
    render();
  };

  connectButton.addEventListener('click', () => void connect(false));
  serverAddress.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !session.connecting) void connect(false);
  });
  disconnectButton.addEventListener('click', () => {
    session.disconnect();
    prefs.autoConnect = false;
    view = 'rooms';
    save();
  });
  openCreate.addEventListener('click', () => show('create'));
  backToRooms.addEventListener('click', () => show('rooms'));
  playerName.addEventListener('change', () => {
    prefs.name = playerName.value.trim() || prefs.name;
    save();
  });

  /** One step back: out of the room, out of the form, and from the list of rooms out of the lobby. */
  const goBack = () => {
    if (session.room) session.leaveRoom();
    else if (session.connected && view === 'create') show('rooms');
    else {
      session.disconnect();
      app.toTitle();
    }
  };
  backButton.addEventListener('click', goBack);

  return {
    build: () => {
      // The session outlives this screen: re-render on its changes until the screen is gone.
      const unsubscribe = session.subscribe(() => {
        if (!root.isConnected) {
          clearTimeout(sendTimer);
          return unsubscribe();
        }
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
