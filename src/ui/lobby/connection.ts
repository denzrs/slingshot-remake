import type { Avatar } from '../../avatars';
import { relayText, t } from '../../i18n';
import type { Invite } from '../../invite';
import type { LobbyPrefs } from '../../lobbyPrefs';
import { DEFAULT_SERVER, type MultiplayerSession } from '../../multiplayer';
import { ConnectError } from '../../net';
import { avatarSvg } from '../avatars';
import { h } from '../menu';
import { modeArt } from '../mode-icons';
import { picker } from '../roomLook';
import type { App } from '../screens';
import { avatarOptions, button, field, textInput } from './widgets';

/** What the connection and the player's own name need of the lobby around them. */
export interface ConnectionContext {
  app: App;
  session: MultiplayerSession;
  prefs: LobbyPrefs;
  save(): void;
  /** The build was given a relay to use: there is no address to type. */
  configuredServer: boolean;
  /** The configured relay is a secure one: the build connects on its own, with no connection card. */
  hosted: boolean;
  /** The invite the page was opened with, whose relay the address field starts with. */
  invited: Invite | null;
  /** Draws the lobby again. */
  render(): void;
}

export interface Connection {
  /** Who you are connected to, your name and a way out, above the pages. */
  bar: HTMLElement;
  /** The card that connects, for before there is a connection. */
  card: HTMLElement;
  /** Holds the card, hidden while connected. */
  slot: HTMLElement;
  /** The player's name; the card or the bar shows it, whichever is on. */
  playerName: HTMLInputElement;
  /** The profile panel, which opens when the name is missing or refused. */
  profile: HTMLDetailsElement;
  /** Connection progress and validation messages that don't come from the session. */
  message: string | null;
  /** The last connection attempt failed; the hosted build then offers the connect card again. */
  readonly failed: boolean;
  /** A reconnect the player did not ask for is under way: the page waits for it instead of showing the card for a moment. */
  quiet: boolean;
  /** The trimmed player name, noted as sent; null (with a message) when empty. */
  takeName(): string | null;
  /** Notes a name that went out (join, create, rename) and has not been answered yet. */
  sendingName(name: string): void;
  /** Redraws the bar for the state of the connection; the page and the lobby take the entrance and the ping. */
  paint(connected: boolean, lobby: HTMLElement, page: HTMLElement): void;
  /** Redraws the card and puts the name field where it belongs. */
  paintCard(connecting: boolean): void;
  /** The relay has answered something: what it said about the name. */
  onSessionUpdate(): void;
  connect(silent: boolean): Promise<void>;
}

/** The player's identity and the connection to the relay: the card to connect with, the bar once connected, the name and symbol. */
export function createConnection({ app, session, prefs, save, configuredServer, hosted, invited, render }: ConnectionContext): Connection {
  const sound = app.menu.sound;
  const serverAddress = textInput(session.client.address && session.connected ? session.client.address : invited?.server ?? prefs.server, { type: 'url', spellcheck: false });
  const playerName = textInput(prefs.name, { maxLength: 24 });
  playerName.setAttribute('autocomplete', 'nickname');
  /** Why the relay turned the name down, right under the field it is about. */
  const nameError = () => h('p.lobby__field-error', { role: 'alert' });
  const joinNameError = nameError();
  /** The name that went out (join, create, rename) and has not been answered yet. It becomes the default for next time only once the relay has taken it. */
  let pendingName: string | null = null;
  const showNameError = (message: string | null) => {
    joinNameError.textContent = message ? relayText(message) : '';
    joinNameError.hidden = !message;
  };
  showNameError(null);
  /** The name belongs to the connection card until there is a connection, and to the bar after it (in the hosted build: always the bar). */
  const nameField = h('div', null, field(t('multiplayer.name'), playerName), joinNameError);
  const connectButton = button(hosted ? t('multiplayer.retry') : t('multiplayer.connect'), true);
  const connectFields = h('div.lobby__fields', null, ...(configuredServer ? [] : [field(t('multiplayer.server'), serverAddress)]));
  const connectView = h('section.lobby__card.lobby__card--narrow.lobby__connect', null,
    h('h3.setup__title', null, t('multiplayer.connection')), connectFields, connectButton,
    h('div.lobby__connect-art', null, modeArt('classic'), h('p.note', null, t('shell.connectNote'))),
  );

  /** Once connected: who you are connected to, your name, a way out. */
  const barName = h('div.lobby__name', null);
  /** The symbol the player shows in online games: picked here before a room, and inside one (below the players). */
  const avatarBar = picker<Avatar>(t('multiplayer.yourSymbol'), avatarOptions(), false, (avatar) => {
    sound.blip();
    prefs.avatar = avatar;
    save();
    avatarBar.show(avatar);
    if (session.room && !session.you.spectator) session.setAvatar(avatar);
  });
  const avatarRow = h('div.lobby__avatar', null, h('span.lobby__code-label', null, t('multiplayer.yourSymbol')), avatarBar.el);
  const disconnectButton = button(t('multiplayer.disconnect'));
  // Nothing to disconnect from before a connection, and the hosted build is connected as of now (render keeps this up to date).
  disconnectButton.hidden = true;
  const saveProfile = button(t('flow.profileSave'), true);
  const profileLabel = h('span.online-profile__name', null);
  const profileAvatar = h('span.online-profile__avatar', null);
  const profile = h('details.online-profile', null,
    h('summary', null,
      profileAvatar,
      h('span.online-profile__text', null, h('span.online-profile__label', null, t('flow.profile')), profileLabel),
      h('span.online-profile__edit', null, t('flow.profileEdit')),
    ),
    h('div.online-profile__fields', null, barName, avatarRow, h('div.online-profile__actions', null, saveProfile)),
  ) as HTMLDetailsElement;

  const sendingName = (name: string) => {
    pendingName = name;
    showNameError(null);
  };

  /** The name and the symbol are the player's own: saving them closes the panel, whatever the relay will say to the name later. */
  const commitProfile = () => {
    const name = playerName.value.trim();
    if (!name) {
      showNameError(t('multiplayer.nameRequired'));
      playerName.focus();
      return;
    }
    showNameError(null);
    profile.open = false;
    if (session.room) {
      // Inside a room the relay has the last word on the name; the field keeps what was typed until it answers.
      sendingName(name);
      session.setName(name);
      render();
      return;
    }
    prefs.name = name;
    save();
    render();
  };
  saveProfile.addEventListener('click', commitProfile);
  playerName.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') commitProfile();
  });
  const connectionLabel = h('span.online-connection__state', null);
  const connectionServer = h('span.online-connection__server', null);
  const link = h('div.online-connection', null,
    h('div.online-connection__status', null, h('span.online-connection__text', null, connectionLabel, connectionServer)), disconnectButton,
  );
  const bar = h('div.online-identity', null, profile, link);
  const connectSlot = h('div', null, connectView);
  /** True once the relay has answered while this page was open; the page opening on a live connection is not news. */
  let wasConnected: boolean | null = null;
  let linkedTimer: ReturnType<typeof setTimeout> | undefined;
  /** The connection coming up or going away: one ping on the status dot, and what the card made room for fades in. */
  const flashConnection = (state: 'is-linked' | 'is-dropped', lobby: HTMLElement, page: HTMLElement): void => {
    lobby.classList.remove('lobby--linked');
    link.classList.remove('is-linked', 'is-dropped');
    void link.offsetWidth;
    // While the page is still building itself up, the content fade would be a second entrance.
    if (page.classList.contains('menu-page--entered')) lobby.classList.add('lobby--linked');
    link.classList.add(state);
    clearTimeout(linkedTimer);
    linkedTimer = setTimeout(() => {
      lobby.classList.remove('lobby--linked');
      link.classList.remove('is-linked', 'is-dropped');
    }, 1400);
  };

  const connectErrorText = (error: unknown): string => {
    if (!(error instanceof ConnectError)) return error instanceof Error ? error.message : String(error);
    const params = { server: error.url };
    if (error.reason === 'timeout') return t('multiplayer.connectTimeout', params);
    if (error.reason === 'closed') return t('multiplayer.connectClosed', params);
    return t('multiplayer.connectUnreachable', params);
  };

  const state = { message: null as string | null, failed: false, quiet: false };

  const connect = async (silent: boolean) => {
    const address = configuredServer ? DEFAULT_SERVER : serverAddress.value.trim();
    state.message = silent ? null : t('multiplayer.connecting');
    state.failed = false;
    state.quiet = silent;
    render();
    try {
      await session.connect(address);
      if (!configuredServer) prefs.server = address;
      prefs.autoConnect = true;
      state.message = null;
    } catch (error) {
      state.failed = true;
      prefs.autoConnect = false;
      state.message = configuredServer ? t('multiplayer.connectFailed') : connectErrorText(error);
    }
    state.quiet = false;
    save();
    render();
  };

  connectButton.addEventListener('click', () => void connect(false));
  serverAddress.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !session.connecting) void connect(false);
  });
  disconnectButton.addEventListener('click', () => {
    session.disconnect();
    prefs.autoConnect = false;
    save();
  });
  playerName.addEventListener('change', () => {
    prefs.name = playerName.value.trim() || prefs.name;
    save();
  });

  return {
    bar,
    card: connectView,
    slot: connectSlot,
    playerName,
    profile,
    get message() { return state.message; },
    set message(value) { state.message = value; },
    get failed() { return state.failed; },
    get quiet() { return state.quiet; },
    set quiet(value) { state.quiet = value; },
    sendingName,
    takeName: () => {
      const name = playerName.value.trim();
      if (!name) {
        state.message = t('multiplayer.nameRequired');
        profile.open = true;
        render();
        playerName.focus();
        return null;
      }
      state.message = null;
      sendingName(name);
      return name;
    },
    paint: (connected, lobby, page) => {
      const { connecting } = session;
      profileLabel.textContent = playerName.value.trim() || t('multiplayer.name');
      profileAvatar.replaceChildren(avatarSvg(prefs.avatar));
      connectionLabel.textContent = t(connected ? 'flow.connected' : 'flow.connection');
      connectionServer.textContent = connected && !configuredServer ? (session.client.address || prefs.server).replace(/^wss?:\/\//, '') : '';
      connectionServer.hidden = !connectionServer.textContent;
      link.classList.toggle('is-connected', connected);
      link.classList.toggle('is-connecting', connecting && !connected && !hosted);
      if (wasConnected !== null && connected !== wasConnected) flashConnection(connected ? 'is-linked' : 'is-dropped', lobby, page);
      wasConnected = connected;
      disconnectButton.hidden = hosted || !connected;
      avatarBar.show(prefs.avatar);
    },
    paintCard: (connecting) => {
      barName.append(nameField);
      connectButton.disabled = connecting;
      serverAddress.disabled = connecting;
    },
    onSessionUpdate: () => {
      // The relay's reason for refusing a name goes under the name; other errors stay in the general message.
      if (pendingName === null) return;
      const self = session.room?.players.find((p) => p.id === session.you.playerId);
      if (session.nameNotice) {
        showNameError(session.nameNotice);
        profile.open = true;
        queueMicrotask(() => playerName.focus());
        pendingName = null;
      } else if (self?.name === pendingName) {
        // Taken: only now is it the default for next time.
        prefs.name = pendingName;
        save();
        pendingName = null;
      }
    },
    connect,
  };
}
