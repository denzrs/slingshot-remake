import { AVATARS, type Avatar } from '../avatars';
import { COLORS, GALLERY, MAX_PLAYERS, TEAMS } from '../config';
import { relayText, t, type Key } from '../i18n';
import { canCopyInvite, inviteJoinAttempt, inviteLink, readInvite, shouldAutoConnectInvite, withoutInvite, withoutInvitePassword } from '../invite';
import { defaultRoomRules, loadLobbyPrefs, saveLobbyPrefs } from '../lobbyPrefs';
import { DEFAULT_SERVER, isSecureRelay, type MultiplayerSession } from '../multiplayer';
import { ConnectError, type LobbyRoom, type NetworkCpuLevel, type NetworkGameMode, type RoomInfo, type RoomMode, type RoomRules } from '../net';
import type { RoomLook, RoomVisibility } from '../roomLook';
import { buildControl, optionSelector, segmentedControl, sliderControl, type Control, type Env } from './controls';
import { eyeIcon } from './dom';
import { h, type Screen } from './menu';
import { groupTitle, RULE_GROUPS, ruleItems, type RuleSource } from './rules';
import type { App } from './screens';
import { AVATAR_LABEL, avatarSvg, playerIcon } from './avatars';
import { lookDialog, picker, roomIcon, visibilityControl, type LookDialog } from './roomLook';
import { menuPage } from './menu-page';
import { modeArt, presetArt } from './mode-icons';
import { pickArt, pickHint, pickName } from './pick-of-day';
import { presetsForMode, matchingPreset, presetRules, matchingHandpicked, pickOfTheDay, samePick } from './match-presets';
import { powerUpSummary } from './powerup-summary';
import { teamRoster, type RosterCard } from './team-roster';

/** A game mode's name, with Mayhem behind it when its rounds have twists. */
const modeName = (mode: NetworkGameMode, mayhem = false) => {
  const name = t(`mode.${mode}` as Key);
  return mayhem ? `${name} · ${t('mode.mayhem')}` : name;
};
const matchTypeName = (mode: RoomMode) => (mode === 'team' ? t('players.teams', { n: 2 }) : t('players.ffa'));
/** The symbols a player can pick, as the choices of a picker. */
const avatarOptions = () => AVATARS.map((avatar) => ({ value: avatar, label: t(AVATAR_LABEL[avatar]), face: avatarSvg(avatar) }));
const lookOf = (room: RoomInfo): RoomLook => ({ visibility: room.visibility, symbol: room.symbol, color: room.color });

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

/** Stroke icons for the password fields: an eye, the same with a slash, and a copy sheet. */
const ICON_EYE = '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>';
const ICON_EYE_OFF = '<path d="M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6A16.5 16.5 0 0 0 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/><path d="M3 3l18 18"/>';
const ICON_COPY = '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>';
const ICON_CLOSE = '<path d="M6 6l12 12M18 6L6 18"/>';

/** A square button with one of the icons above. */
/** The levels a CPU seat can take online, in the order the offline game lists them. */
const CPU_LEVELS: NetworkCpuLevel[] = ['easy', 'medium', 'hard', 'hawking'];

function iconButton(label: string, icon: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'lobby__icon-button';
  b.title = label;
  b.setAttribute('aria-label', label);
  // Only our own constants go in here.
  b.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon}</svg>`;
  return b;
}

/**
 * A password field with an eye that shows or hides what is typed. With `onCopy`, a button beside it
 * copies the password.
 */
function secretField(input: HTMLInputElement, onCopy?: (button: HTMLElement) => void): HTMLElement {
  const eye = iconButton('', ICON_EYE);
  const paintEye = (): void => {
    const shown = input.type === 'text';
    const label = t(shown ? 'multiplayer.hidePassword' : 'multiplayer.showPassword');
    eye.title = label;
    eye.setAttribute('aria-label', label);
    eye.setAttribute('aria-pressed', String(shown));
    eye.querySelector('svg')?.replaceChildren(...svgChildren(shown ? ICON_EYE_OFF : ICON_EYE));
  };
  eye.addEventListener('click', () => {
    input.type = input.type === 'text' ? 'password' : 'text';
    paintEye();
  });
  paintEye();
  const parts: Node[] = [input, eye];
  if (onCopy) {
    const copy = iconButton(t('multiplayer.copyPassword'), ICON_COPY);
    copy.addEventListener('click', () => onCopy(copy));
    parts.push(copy);
  }
  return h('span.lobby__secret', null, ...parts);
}

const ICON_LINK = '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>';
const ICON_KEY = '<circle cx="8" cy="15" r="4"/><path d="M11 12l8-8M16 7l3 3M14 9l2 2"/>';
const ICON_CHECK = '<path d="M5 12.5l4.5 4.5L19 7"/>';

/** Confirms "copied" in the thing that was pressed, for a moment, and then gives it back. */
function flashCopied(button: HTMLElement, what: string): void {
  if (button.classList.contains('is-flash')) return;
  button.classList.add('is-flash');
  if (button.classList.contains('slot-card__join')) {
    flashSeat(button, what);
    return;
  }
  // An icon button lights up and draws a check; what was copied floats under it as a tooltip, so nothing around it moves.
  const note = h('span.flash-note', { role: 'status' }, what);
  const icon = button.querySelector('svg');
  const saved = icon?.innerHTML;
  if (icon) icon.replaceChildren(...svgChildren(ICON_CHECK));
  button.classList.add('is-copied');
  button.append(note);
  setTimeout(() => {
    if (icon && saved !== undefined) icon.innerHTML = saved;
    note.remove();
    button.classList.remove('is-copied', 'is-flash');
  }, 1600);
}

/** An open seat says it in the seat itself: the card lights up and its label is swapped for what was copied. */
function flashSeat(button: HTMLElement, what: string): void {
  const card = button.closest('.slot-card');
  const saved = [...button.childNodes];
  const check = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  check.setAttribute('viewBox', '0 0 24 24');
  check.setAttribute('class', 'slot-card__check');
  check.setAttribute('aria-hidden', 'true');
  check.innerHTML = ICON_CHECK;
  card?.classList.add('is-copied');
  button.replaceChildren(check, h('span.slot-card__copied', { role: 'status' }, what));
  setTimeout(() => {
    button.replaceChildren(...saved);
    button.classList.remove('is-flash');
    card?.classList.remove('is-copied');
  }, 1800);
}

/** A small padlock that takes the colour of its text. */
function lockIcon(): SVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'lock-icon');
  svg.setAttribute('aria-hidden', 'true');
  // Only our own constants go in here.
  svg.innerHTML = '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>';
  return svg;
}

/** The children of an SVG, parsed from a constant. */
function svgChildren(markup: string): Node[] {
  const holder = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  holder.innerHTML = markup;
  return [...holder.childNodes];
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
function rulesForm(mode: NetworkGameMode, source: RuleSource, app: App, readonly = false, changed?: () => void): RulesForm {
  const controls: Control[] = [];
  const refresh = () => controls.forEach((c) => c.refresh());
  const env: Env = { sound: app.menu.sound, readonly, changed: () => { refresh(); changed?.(); } };
  const items = ruleItems(mode, source, true);
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
  const labels = RULE_GROUPS.filter((group) => items.some((i) => i.group === group));
  const tabs = labels.map((group, index) => {
    const tab = button(groupTitle(group));
    tab.className = 'item';
    tab.addEventListener('click', () => select(index));
    return tab;
  });
  const select = (index: number) => {
    groups.forEach((group, i) => { group.hidden = i !== index; });
    tabs.forEach((tab, i) => { tab.classList.toggle('is-selected', i === index); tab.setAttribute('aria-pressed', String(i === index)); });
  };
  const el = h('div.category-editor.rules-browser', null,
    h('nav.items.category-nav', { 'aria-label': t('briefing.rules') }, ...tabs),
    h('div.category-editor__fields', null, ...groups),
  );
  select(0);
  refresh();
  return { el, refresh };
}

/** Direct child views reachable from the Online section of the main launcher. */
export type LobbyEntry = 'rooms' | 'create' | 'code';
type View = LobbyEntry;
/** The games a host picks between in the room, in the order of the pager. */
const PICKER_MODES: readonly NetworkGameMode[] = ['classic', 'horizon', 'solar'];
type OnlineSectionDirection = 'next' | 'previous';
// Keep the focused section at the anchor and preview the next two, wrapping back to the start.
const ONLINE_SECTIONS: readonly LobbyEntry[] = ['rooms', 'create', 'code'];
const ONLINE_SECTION_TITLE: Record<LobbyEntry, Key> = {
  rooms: 'flow.find',
  create: 'flow.create',
  code: 'flow.code',
};

/**
 * Online play, one step at a time: connect to a relay, see the open rooms, open one of your own —
 * and wait for the others inside it. The lobby has its own settings, apart from the offline ones;
 * everything the player fills in is remembered, and the host can still change the rules while the
 * room is waiting.
 *
 * A build that was given a secure relay (`wss://`) is hosted: it connects as soon as the lobby opens,
 * with no connection screen. Every other build (self-hosted or local dev) keeps the connection card.
 */
export function lobbyScreen(app: App, session: MultiplayerSession, entry?: LobbyEntry): Screen {
  const prefs = loadLobbyPrefs(DEFAULT_SERVER);
  const configuredServer = Boolean(import.meta.env.VITE_MULTIPLAYER_SERVER);
  const hosted = configuredServer && isSecureRelay(DEFAULT_SERVER);
  /** The invite this page was opened with; it stays until the room is joined or the lobby is left. */
  const invited = readInvite(location.search, location.hash);
  // Remove the secret from history immediately; keep the room and relay until the invite is consumed.
  if (invited?.password) history.replaceState(null, '', withoutInvitePassword(location.href));
  let inviteNote: string | null = invited
    ? invited.server && invited.server !== prefs.server
      ? t('multiplayer.inviteServerConfirm', { server: invited.server })
      : t('multiplayer.invited', { code: invited.roomId })
    : null;
  /** The invited guest is joined to the room on arrival — the link is all they were given. */
  let invitePending = !!invited;
  /** The invite is still in the address bar; the code, the relay and the password have been read out of it. */
  let inviteInUrl = !!invited;
  const save = () => saveLobbyPrefs(prefs);
  const sound = app.menu.sound;
  /** Connection progress / validation messages that don't come from the session. */
  let localMessage: string | null = null;
  /** The last connection attempt failed; the hosted build then offers the connect card again. */
  let connectFailed = false;
  let view: View = invited ? 'code' : entry ?? 'rooms';
  let lastContentState: string | null = null;
  let createFromRooms = false;
  /** Join passwords typed so far, per room — the room list is rebuilt whenever it changes. */
  const joinPasswords = new Map<string, string>();
  /** The password the player set for the room they opened; it is shown to the host to share, until they leave. */
  let hostPassword = '';

  /** Copies a text to the clipboard and says so in the button that asked for it, or says that it could not. Nothing happens for an empty text. */
  const copyText = async (text: string, what: string, target: HTMLElement): Promise<void> => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      flashCopied(target, what);
    } catch {
      localMessage = t('multiplayer.copyFailed');
      render();
    }
  };

  const status = h('p.lobby__status', { role: 'status', 'aria-live': 'polite' });

  // ————————————————————————————— Connecting —————————————————————————————

  const serverAddress = textInput(session.client.address && session.connected ? session.client.address : invited?.server ?? prefs.server, { type: 'url', spellcheck: false });
  const playerName = textInput(prefs.name, { maxLength: 24 });
  playerName.setAttribute('autocomplete', 'nickname');
  /** The name belongs to the connection card until there is a connection, and to the bar after it (in the hosted build: always the bar). */
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
  const connection = h('div.online-connection', null,
    h('div.online-connection__status', null, h('span.online-connection__text', null, connectionLabel, connectionServer)), disconnectButton,
  );
  const bar = h('div.online-identity', null, profile, connection);
  const connectSlot = h('div', null, connectView);
  /** True once the relay has answered while this page was open; the page opening on a live connection is not news. */
  let wasConnected: boolean | null = null;
  let linkedTimer: ReturnType<typeof setTimeout> | undefined;
  /** A reconnect the player did not ask for: the page waits for it instead of showing a connect card for a moment. */
  let quietConnect = false;
  /** The connection coming up or going away: one ping on the status dot, and what the card made room for fades in. */
  const flashConnection = (state: 'is-linked' | 'is-dropped'): void => {
    lobbyEl.classList.remove('lobby--linked');
    connection.classList.remove('is-linked', 'is-dropped');
    void connection.offsetWidth;
    // While the page is still building itself up, the content fade would be a second entrance.
    if (page.classList.contains('menu-page--entered')) lobbyEl.classList.add('lobby--linked');
    connection.classList.add(state);
    clearTimeout(linkedTimer);
    linkedTimer = setTimeout(() => {
      lobbyEl.classList.remove('lobby--linked');
      connection.classList.remove('is-linked', 'is-dropped');
    }, 1400);
  };

  // ————————————————————————————— The open rooms —————————————————————————————

  const openCreate = button(t('multiplayer.openCreate'), true);
  const roomsList = h('ul.lobby__rooms', null);
  // A private room is not listed: its code gets you in — or the invite link, which carries it.
  const codeInput = textInput(invited?.roomId ?? '', { maxLength: 16, autocomplete: 'off', spellcheck: false, placeholder: t('multiplayer.codePlaceholder') });
  const codePassword = passwordInput(t('multiplayer.password'));
  /** A line under the field it is about; empty and hidden until there is something to say. */
  const fieldError = () => {
    const el = h('p.lobby__field-error', { role: 'alert' });
    el.hidden = true;
    return el;
  };
  const showFieldError = (el: HTMLElement, message: string | null) => {
    el.textContent = message ?? '';
    el.hidden = !message;
  };
  const codeError = fieldError();
  // Its line is kept free, so a refusal fills it instead of pushing the form down.
  codeError.classList.add('online-code__error');
  const codePasswordError = fieldError();
  codePasswordError.classList.add('online-code__error');
  /** Whose password the relay is about to judge: it answers a wrong one with an error, and that goes right there. */
  /** A join by code is waiting for the relay's answer; if that is a refusal, it goes under the code. */
  let codeJoinPending = false;
  /** The relay notice that went under the code already, so the general message does not say it again. */
  let codeNotice: string | null = null;
  let passwordTarget: { error: HTMLElement; input: HTMLInputElement; reveal?: HTMLElement } | null = null;
  // A link made by somebody in a locked room carries its password, so the guest needs no second paste.
  codePassword.value = invited?.password ?? '';
  const codeJoin = button(t('multiplayer.join'), true);
  /** Whoever has a code may sit down or watch from the stands; the choice is made before the one button. */
  let joinAsSpectator = false;
  const joinAs = segmentedControl(
    {
      kind: 'segmented',
      label: t('multiplayer.joinAs'),
      options: [{ value: 'player', label: t('multiplayer.asPlayer') }, { value: 'spectator', label: t('multiplayer.asSpectator') }],
      get: () => (joinAsSpectator ? 'spectator' : 'player'),
      set: (v) => { joinAsSpectator = v === 'spectator'; },
    },
    { sound, changed: () => {} },
  );
  const joinByCode = () => {
    const spectate = joinAsSpectator;
    const roomId = codeInput.value.trim();
    if (!roomId) {
      showFieldError(codeError, t('multiplayer.codeRequired'));
      codeInput.focus();
      return;
    }
    const name = takeName();
    if (!name) return;
    showFieldError(codePasswordError, null);
    codeJoinPending = true;
    codeNotice = null;
    passwordTarget = { error: codePasswordError, input: codePassword, reveal: codePasswordBox };
    session.joinRoom(roomId, name, codePassword.value, prefs.avatar, spectate);
  };
  codeJoin.addEventListener('click', () => joinByCode());
  for (const input of [codeInput, codePassword]) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') joinByCode();
    });
  }
  codeInput.addEventListener('input', () => showFieldError(codeError, null));
  codePassword.addEventListener('input', () => showFieldError(codePasswordError, null));
  codeInput.setAttribute('aria-label', t('multiplayer.code'));
  // Most rooms have no password: its field comes up only when the relay says this one does.
  const codePasswordBox = h('div.online-code__password', null, field(t('multiplayer.password'), secretField(codePassword)), codePasswordError);
  codePasswordBox.hidden = true;
  const codeView = h('section.online-code', null,
    h('div.online-code__art', null, modeArt('code')),
    h('div.online-code__form', null,
      // The placeholder names the field, so it has no label of its own: the box stays as tall as the one for opening a room.
      h('div.online-code__code', null, h('div.lobby__field', null, codeInput), codeError),
      joinAs.el,
      codePasswordBox,
    ),
  );
  const roomsCount = h('span.online-rooms__count', null, '0');
  const roomsView = h('section.online-rooms', null, h('div.lobby__head', null, h('h3.setup__title', null, t('multiplayer.rooms'), roomsCount), openCreate), roomsList);

  const sendingName = (name: string) => {
    pendingName = name;
    showNameError(null);
  };

  /** The trimmed player name; null (with a message) when empty. */
  const takeName = (): string | null => {
    const name = playerName.value.trim();
    if (!name) {
      localMessage = t('multiplayer.nameRequired');
      profile.open = true;
      render();
      playerName.focus();
      return null;
    }
    localMessage = null;
    sendingName(name);
    return name;
  };

  const roomRow = (room: LobbyRoom) => {
    // A room whose seats are CPUs still has room for a person: the newest CPU gives its seat up.
    const full = room.players >= room.maxPlayers && room.cpus === 0;
    // A game under way has no seat to take, but anybody may watch it from the stands.
    const running = room.status === 'playing';
    const join = button(full ? t('multiplayer.full') : t('multiplayer.join'), true);
    join.disabled = full;
    const watch = button(t('multiplayer.watch'), running);
    const standsFull = room.spectators >= GALLERY.MAX_SPECTATORS;
    watch.disabled = standsFull;
    if (standsFull) watch.title = t('multiplayer.standsFull');
    const pass = passwordInput(t('multiplayer.password'));
    pass.value = joinPasswords.get(room.id) ?? '';
    const passError = fieldError();
    pass.addEventListener('input', () => {
      joinPasswords.set(room.id, pass.value);
      showFieldError(passError, null);
    });
    const doJoin = (spectate = false) => {
      const name = takeName();
      if (!name) return;
      showFieldError(passError, null);
      passwordTarget = { error: passError, input: pass };
      session.joinRoom(room.id, name, pass.value, prefs.avatar, spectate);
      joinPasswords.delete(room.id);
    };
    join.addEventListener('click', () => doJoin());
    watch.addEventListener('click', () => doJoin(true));
    pass.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doJoin(running);
    });
    return h(
      'li.lobby-room',
      null,
      h(
        'div.lobby-room__info',
        null,
        h('strong', null, roomIcon(room.symbol, room.color), ...(room.locked ? [lockIcon()] : []), room.name),
        h('span.lobby-room__host', null, t('multiplayer.hostedBy', { name: room.host })),
        h('span.lobby-room__tags', null, h('span.lobby__tag', null, modeName(room.gameMode, room.mayhem > 0)), h('span.lobby__tag', null, matchTypeName(room.mode)), pips(room.players, room.maxPlayers), ...(running ? [h('span.lobby__tag.lobby__tag--live', null, t('multiplayer.inProgress'))] : []), ...(room.spectators ? [h('span.lobby__tag.lobby__tag--watchers', null, eyeIcon(), String(room.spectators))] : [])),
      ),
      ...(room.locked ? [secretField(pass), passError] : []),
      h('div.lobby-room__actions', null, ...(running ? [] : [join]), watch),
    );
  };

  /** What the room list showed last: it is only rebuilt when that changes, so a half-typed password survives. */
  let shownRooms = '';
  const retryRooms = button(t('multiplayer.retryRooms'));
  retryRooms.addEventListener('click', () => session.requestRooms());
  const renderRooms = (open: LobbyRoom[], loaded: boolean, failed: boolean) => {
    const key = `${loaded}:${failed}:${JSON.stringify(open)}`;
    if (key === shownRooms) return;
    shownRooms = key;
    roomsCount.textContent = String(open.length);
    roomsCount.hidden = !loaded || failed;
    const radar = () => h('span.lobby__empty-radar', { 'aria-hidden': 'true' });
    const empty = failed
      ? h('li.lobby__empty', null, radar(), h('strong', null, t('multiplayer.roomsFailed')), retryRooms)
      : !loaded
        ? h('li.lobby__empty', null, radar(), h('strong', null, t('multiplayer.roomsLoading')))
        : h('li.lobby__empty', null, radar(), h('strong', null, t('multiplayer.noRooms')), h('span', null, t('multiplayer.noRoomsHint')));
    roomsList.replaceChildren(...(open.length ? open.map(roomRow) : [empty]));
  };

  // ————————————————————————————— Opening a room —————————————————————————————

  const password = passwordInput();
  const roomName = textInput('', { maxLength: 40, autocomplete: 'off', placeholder: t('multiplayer.roomNamePlaceholder', { name: playerName.value.trim() || t('multiplayer.host') }) });
  playerName.addEventListener('input', () => (roomName.placeholder = t('multiplayer.roomNamePlaceholder', { name: playerName.value.trim() || t('multiplayer.host') })));
  const createPresetCards = h('div.items.items--row.briefing__cards', { role: 'group', 'aria-label': t('preset.choose') });
  const createQuick = h('div.briefing__quick', null);
  const createPowerups = powerUpSummary(() => prefs.rules);
  const createRules = h('div', null);
  /** All the rules, one category at a time, over the page: a link below the presets opens them, as it does in the local briefing. */
  const rulesLinkLabel = h('span.item__label', null, t('briefing.editRules'));
  const rulesLink = h('button.item', { type: 'button' }, rulesLinkLabel);
  const rulesDone = h('button.item.item--primary', { type: 'button' }, t('briefing.done'));
  const rulesReset = h('button.item', { type: 'button' }, t('setup.reset'));
  /** The page of the local briefing — the same frame, the same categories, the same footer — over the lobby. */
  const rulesDialog = menuPage({
    title: t('briefing.editRules'), eyebrow: '', className: 'menu-page--rules',
    body: [createRules],
    keys: t('briefing.keys'),
    footer: h('div.items.items--row.menu-page__actions', null, rulesReset, rulesDone),
  });
  rulesDialog.classList.add('rules-page');
  rulesDialog.hidden = true;
  const closeRulesDialog = () => {
    rulesDialog.hidden = true;
    rulesDialog.remove();
    rulesLink.focus({ preventScroll: true });
  };
  rulesDone.addEventListener('click', closeRulesDialog);
  rulesLink.addEventListener('click', () => {
    rulesDialog.querySelector('.eyebrow')!.textContent = modeName(prefs.gameMode, prefs.rules.mayhem > 0);
    rulesDialog.querySelector('.menu-page__title')!.textContent = rulesLinkLabel.textContent;
    rulesReset.hidden = readOnly();
    rulesDialog.hidden = false;
    document.body.append(rulesDialog);
    rulesDone.focus();
  });
  const createAdvanced = h('div.items.briefing__edit', null, rulesLink);
  let createRulesForm: RulesForm | null = null;
  let createQuickControls: Control[] = [];
  let paintCreatePresetState = () => {};
  /** Everybody but the host sees the game and its rules as the host set them, locked. */
  const readOnly = (): boolean => !!session.room && !session.you.host;
  /** What the host changes goes to the relay a moment later, as one message however many keys were pressed. */
  let rulesTimer: ReturnType<typeof setTimeout> | undefined;
  const pushRules = () => {
    clearTimeout(rulesTimer);
    rulesTimer = undefined;
    if (session.room && session.you.host) session.setRules(prefs.rules, prefs.gameMode);
  };
  /** The host's rules are remembered for the next room, and — inside a room — sent to everybody in it. */
  const commitRules = () => {
    save();
    if (!session.room) return;
    clearTimeout(rulesTimer);
    rulesTimer = setTimeout(pushRules, 250);
  };
  /** Which game the rules are for. Presets within one game only change values, so the cards and sliders stay where they are. */
  const gameKey = () => prefs.gameMode;
  const rebuildIfGameChanged = (before: string) => {
    if (gameKey() === before) return;
    buildCreateRules();
    buildCreateQuick();
  };
  const buildCreateRules = () => {
    const presets = presetsForMode(prefs.gameMode);
    const pick = pickOfTheDay(prefs.gameMode, app.today());
    createRulesForm = rulesForm(prefs.gameMode, {
      get: () => prefs.rules,
      patch: (v) => (prefs.rules = { ...prefs.rules, ...v }),
      commit: commitRules,
    }, app, readOnly(), () => {
      paintCreatePresetState();
      createPowerups.update();
    });
    createRules.replaceChildren(createRulesForm.el);
    const choices: { id: string; card: HTMLButtonElement }[] = [];
    const addPreset = (id: string, label: string, hint: string, art: SVGElement, apply: () => void, featured = false) => {
      const card = h('button.item.item--card.lobby__preset', { type: 'button', 'aria-pressed': 'false' },
        h('span.item__icon', { 'aria-hidden': 'true' }, art),
        h('span.item__title', null, label),
        ...(hint ? [h('span.item__hint', null, hint)] : []),
      ) as HTMLButtonElement;
      if (featured) {
        card.classList.add('item--pick');
        card.prepend(h('span.item__tag', null, t('preset.pick.today')));
      }
      card.classList.toggle('is-readonly', readOnly());
      card.addEventListener('click', () => {
        if (readOnly()) return;
        apply();
        commitRules();
        createRulesForm?.refresh();
        createQuickControls.forEach((control) => control.refresh());
        paintCreatePresetState();
        createPowerups.update();
        createPresetCards.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus({ preventScroll: true });
        sound.select();
      });
      choices.push({ id, card });
    };
    addPreset('handpicked', pickName(pick), pickHint(pick), pickArt(pick), () => {
      const before = gameKey();
      prefs.gameMode = pick.base;
      prefs.rules = { ...pick.rules, powerUpKinds: [...pick.rules.powerUpKinds], betting: prefs.rules.betting, chatPlayersOnly: prefs.rules.chatPlayersOnly };
      rebuildIfGameChanged(before);
    }, true);
    for (const preset of presets) {
      addPreset(preset, t(`preset.${preset}`), t(`preset.${preset}.hint`), presetArt(preset, prefs.gameMode), () => {
        prefs.rules = { ...presetRules(preset), betting: prefs.rules.betting, chatPlayersOnly: prefs.rules.chatPlayersOnly };
      });
    }
    createPresetCards.replaceChildren(...choices.map(({ card }) => card));
    paintCreatePresetState = () => {
      const selectedId = samePick(matchingHandpicked(prefs.rules, prefs.gameMode), pick) ? 'handpicked' : matchingPreset(prefs.rules, prefs.gameMode);
      const selected = selectedId && choices.some(({ id }) => id === selectedId) ? selectedId : undefined;
      choices.forEach(({ id, card }) => card.setAttribute('aria-pressed', String(id === selected)));
    };
    paintCreatePresetState();
      };

  /** Back to the standard rules of the game being played, as the local rules page does. */
  rulesReset.addEventListener('click', () => {
    if (readOnly()) return;
    // A Mayhem game goes back to the Mayhem preset at its strength, any other one to the standard rules.
    const { mayhem } = prefs.rules;
    prefs.rules = mayhem ? { ...presetRules('mayhem'), mayhem } : defaultRoomRules();
    commitRules();
    createRulesForm?.refresh();
    createQuickControls.forEach((control) => control.refresh());
    paintCreatePresetState();
    createPowerups.update();
    sound.select();
  });

  const buildCreateQuick = () => {
    // The strength of Mayhem comes last, in a row of its own under the sliders, while Mayhem is on.
    const quickKeys = ['rounds', 'shotTime', 'mayhem'];
    createQuickControls = ruleItems(prefs.gameMode, {
      get: () => prefs.rules,
      patch: (v) => (prefs.rules = { ...prefs.rules, ...v }),
      commit: commitRules,
    }, true)
      .filter(({ key }) => quickKeys.includes(key))
      .sort((a, b) => quickKeys.indexOf(a.key) - quickKeys.indexOf(b.key))
      .map(({ item }) => buildControl(item, { sound, readonly: readOnly(), changed: () => {
        paintCreatePresetState();
        createPowerups.update();
        createRulesForm?.refresh();
      } }));
    const sliders = createQuickControls.map(({ el }) => el);
    const mayhem = sliders.pop()!;
    createQuick.replaceChildren(...sliders, h('div.briefing__mayhem', null, mayhem), createPowerups.el);
    createPowerups.update();
  };

  // The controls redraw themselves; the room and rule summaries follow their values.
  const env: Env = { sound, changed: () => {} };
  const currentMode = (): NetworkGameMode => prefs.gameMode;
  /** The host's pick in the pager: the game starts from that mode's pick of the day, and the room follows. */
  const setMode = (mode: NetworkGameMode, direction: OnlineSectionDirection) => {
    if (mode === currentMode()) return;
    const pick = pickOfTheDay(mode, app.today());
    prefs.gameMode = pick.base;
    prefs.rules = { ...pick.rules, powerUpKinds: [...pick.rules.powerUpKinds], betting: prefs.rules.betting, chatPlayersOnly: prefs.rules.chatPlayersOnly };
    commitRules();
    buildCreateRules();
    buildCreateQuick();
    sound.select();
    pendingContentDirection = direction;
    render();
  };

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

  /** The listing, symbol and colour of the room to come; remembered, and sent when the room is made. */
  const lookSave = (patch: Partial<RoomLook>) => {
    prefs.look = { ...prefs.look, ...patch };
    save();
    paintLookButton();
    createDialog.refresh(prefs.look);
  };
  const createVisibility = visibilityControl(prefs.look, lookSave, { sound });
  const createDialog = lookDialog(prefs.look, lookSave, { sound });
  /** The room's symbol in its colour, beside its name: a click opens the dialog to change both. */
  const lookButton = iconButton(t('multiplayer.lookTitle'), '');
  lookButton.classList.add('online-create__look');
  const paintLookButton = () => lookButton.replaceChildren(roomIcon(prefs.look.symbol, prefs.look.color));
  lookButton.addEventListener('click', () => createDialog.open());
  paintLookButton();
  const createButton = button(t('multiplayer.create'), true);
  const createSetupMain = h('div.online-create__main', null,
    h('section.briefing__presets', null,
      createPresetCards,
      createQuick,
    ),
    createAdvanced,
  );
  /** A room is opened with a name and who may come in; the game is the host's to pick once the room stands. */
  roomName.setAttribute('aria-label', t('multiplayer.roomName'));
  const createView = h('section.online-create', null,
    h('div.lobby__field', null, h('span', null, t('multiplayer.roomSymbolName')), h('div.online-create__name', null, lookButton, roomName)),
    createVisibility.el,
    field(t('multiplayer.passwordOptional'), secretField(password, (copy) => void copyText(password.value, t('multiplayer.passwordCopied'), copy))),
    capacity.el,
  );
  /** Opening a room and joining one by code share one slot, so the two boxes are the same size whichever shows. */
  const openForms = h('div.online-forms', null, codeView, createView);
  buildCreateRules();
  buildCreateQuick();

  createButton.addEventListener('click', () => {
    const name = takeName();
    if (!name) return;
    // An empty field names the room as its placeholder promised, in the player's language — not the relay's English default.
    session.createRoom({ name, roomName: roomName.value.trim() || roomName.placeholder, mode: 'ffa', gameMode: prefs.gameMode, rules: prefs.rules, maxPlayers: prefs.capacity, password: password.value, look: prefs.look, avatar: prefs.avatar });
    hostPassword = password.value;
    password.value = '';
  });

  // ————————————————————————————— Inside a room —————————————————————————————

  /** The room's symbol in its colour; for the host it opens the dialog that changes it. */
  const roomSymbol = h('button.room-info__symbol', { type: 'button' }) as HTMLButtonElement;
  roomSymbol.addEventListener('click', () => roomDialog?.open());
  /** Who may find the room and whether it is teams: the host's selectors, read-only for everybody else. */
  const roomSwitches = h('span.room-info__switches', null);
  /** Free for all or teams: it belongs to the players, so it sits above them. */
  const roomModeSlot = h('span.room-deck__mode', null);
  let roomSwitchesKey = '';
  let roomSwitchControls: Control[] = [];
  const shownRoom = { visibility: 'public' as RoomVisibility, mode: 'ffa' as RoomMode };
  const paintRoomSwitches = (room: RoomInfo, host: boolean): void => {
    shownRoom.visibility = room.visibility;
    shownRoom.mode = room.mode;
    const key = `${room.id}|${host}`;
    if (key !== roomSwitchesKey) {
      roomSwitchesKey = key;
      const env = { sound, changed: () => {}, readonly: !host };
      roomSwitchControls = [
        segmentedControl({
          kind: 'segmented', label: t('multiplayer.visibility'),
          options: [{ value: 'public', label: t('multiplayer.public') }, { value: 'private', label: t('multiplayer.private') }],
          get: () => shownRoom.visibility,
          set: (v) => { shownRoom.visibility = v as RoomVisibility; changeRoomLook({ visibility: shownRoom.visibility }); },
        }, env),
        segmentedControl({
          kind: 'segmented', label: t('multiplayer.matchType'),
          options: [{ value: 'ffa', label: matchTypeName('ffa') }, { value: 'team', label: matchTypeName('team') }],
          get: () => shownRoom.mode,
          set: (v) => { shownRoom.mode = v as RoomMode; session.setRoomMode(shownRoom.mode); },
        }, env),
      ];
      roomSwitches.replaceChildren(roomSwitchControls[0].el);
      roomModeSlot.replaceChildren(roomSwitchControls[1].el);
    }
    roomSwitchControls.forEach((control) => control.refresh());
  };
  const roomCount = h('p.lobby__note', null);
  /** Host only, in team rooms: deal everybody back out to the teams. */
  const resetTeams = button(t('multiplayer.resetTeams'));
  resetTeams.addEventListener('click', () => session.resetTeams());
  /** The code others join the room with; a private room can only be found this way. */
  const roomCode = h('span.lobby__code-value', null);
  /** Whether the room takes a password. */
  const lockTag = h('span.lobby__tag', null, lockIcon(), t('multiplayer.passwordProtected'));
  /** The invite link: one link that opens the client and puts the guest straight into this room. */
  const copyInvite = iconButton(t('multiplayer.copyInvite'), ICON_LINK);
  const copyInviteLink = (target: HTMLElement) =>
    void copyText(inviteLink(`${location.origin}${location.pathname}`, session.room?.id ?? '', configuredServer ? undefined : session.client.address, hostPassword), t('multiplayer.inviteCopied'), target);
  copyInvite.addEventListener('click', () => copyInviteLink(copyInvite));
  const copyCode = iconButton(t('multiplayer.copyCode'), ICON_COPY);
  copyCode.addEventListener('click', () => void copyText(session.room?.id ?? '', t('multiplayer.codeCopied'), copyCode));
  const copyPassword = iconButton(t('multiplayer.copyPassword'), ICON_KEY);
  copyPassword.addEventListener('click', () => void copyText(hostPassword, t('multiplayer.passwordCopied'), copyPassword));
  const roster = teamRoster(t('multiplayer.players'));
  const players = roster.el;
  players.classList.add('lobby__players');
  /** The people in the stands, under the players. */
  const stands = h('p.lobby__note.lobby__stands', null);
  /** Said to a spectator in place of the buttons they do not have. */
  const watchNote = h('p.lobby__rules-note', null, t('multiplayer.watchNote'));
  /** The room's look: editable by the host, shown to everybody else. */
  const startHint = h('p.lobby__start-hint', { role: 'status' }, '');
  const ready = button(t('multiplayer.ready'), true);
  const start = button(t('multiplayer.start'), true);
  const leave = button(t('multiplayer.leave'));
  let selfReady = false;
  ready.addEventListener('click', () => session.setReady(!selfReady));
  start.addEventListener('click', () => session.startGame());
  leave.addEventListener('click', () => { view = 'rooms'; session.leaveRoom(); });
  /** What the room is about: the host picks the game and its rules here, everybody else reads them. */
  const hostBriefing = createSetupMain;
  const roomBriefing = h('div.room-deck__briefing', null, hostBriefing);
  const roomCrew = h('div.room-deck__crew', null,
    h('div.lobby__head.room-deck__roster-head', null, roomCount, roomModeSlot, resetTeams),
    players,
    stands,
    watchNote,
  );
  const roomView = h(
    'section.lobby__card.lobby__card--wide.room-deck',
    null,
    h('div.lobby__code.room-info', null, roomSymbol,
      h('div.room-info__share', null, h('span.lobby__code-label', null, t('multiplayer.code')), roomCode, copyCode, copyInvite, lockTag, copyPassword),
      roomSwitches),
    h('div.room-deck__layout', null, roomCrew, roomBriefing),
  );

  /** The host's change to the look of the room: sent as the whole look, so nothing else gets lost. */
  const changeRoomLook = (patch: Partial<RoomLook>) => {
    if (session.room) session.setRoomLook({ ...lookOf(session.room), ...patch });
  };
  let roomDialog: LookDialog | null = null;
  let roomLookKey = '';

  /** The host's own rules, kept aside while the room's are on show; they come back when the room is left. */
  let ownGame: { gameMode: NetworkGameMode; rules: RoomRules } | null = null;
  let followed = '';

  const renderRoom = (room: RoomInfo) => {
    const { you } = session;
    const self = you.spectator ? undefined : room.players.find((p) => p.id === you.playerId);
    const watching = !!you.spectator;
    selfReady = !!self?.ready;
    roomSymbol.replaceChildren(roomIcon(room.symbol, room.color));
    roomCode.textContent = room.id;
    paintRoomSwitches(room, you.host);
    lockTag.hidden = !room.locked;
    copyInvite.hidden = !canCopyInvite(room.locked, you.host);
    copyPassword.hidden = !(you.host && room.locked && hostPassword);
    const teamGame = room.mode === 'team';
    const inTeam = (k: number) => room.players.filter((p) => p.team === k).length;
    const teamsReady = !teamGame || (inTeam(0) > 0 && inTeam(1) > 0);
    const crowd = room.spectators ?? [];
    stands.hidden = !crowd.length;
    stands.textContent = crowd.length ? t('multiplayer.standsList', { n: crowd.length, max: GALLERY.MAX_SPECTATORS, names: crowd.map((s) => s.name).join(', ') }) : '';
    watchNote.hidden = !watching;
    ready.hidden = watching || you.host;
    roomCount.textContent = `${room.players.length}/${room.maxPlayers} ${t('multiplayer.players')}`;
    resetTeams.hidden = !(teamGame && you.host);
    const people = room.players.filter((p) => p.cpu === null).length;
    const cpus = room.players.length - people;

    // Restore the actual control after relay updates rebuild the cards.
    const focused = document.activeElement as HTMLElement | null;
    const focusKey = players.contains(focused) ? focused?.dataset.slotFocus : undefined;
    const cards: RosterCard[] = [
      ...room.players.map((player): RosterCard => {
        const mine = player.id === you.playerId;
        const cpu = player.cpu;
        // A CPU seat is the host's to change; the others only see what it is.
        const cpuTag = cpu === null ? [] : [h('span.lobby__tag', null, t('multiplayer.cpuTag'))];
        const levelPick = cpu === null ? [] : you.host && room.status === 'waiting'
          ? [optionSelector(`${player.name} · ${t('multiplayer.cpuLevel')}`, CPU_LEVELS.map((level) => ({ value: level, label: t(`cpu.${level}`) })), () => cpu, (level) => session.setCpu(player.id, { level })).el]
          : [h('span.lobby__tag', null, t(`cpu.${cpu}`))];
        const removeButton = cpu === null || !you.host ? null : iconButton(t('multiplayer.removeCpu'), ICON_CLOSE);
        removeButton?.addEventListener('click', () => session.removeCpu(player.id));
        const card = h('li.slot-card.player-slot', { 'aria-label': t('players.player', { n: player.id + 1 }) },
          h('div.slot-card__head', null,
            h('span.slot-card__number', null, `P${player.id + 1}`),
            h('span.slot-card__kind', null, t(cpu !== null ? 'players.cpu' : mine ? 'slots.local' : 'slots.online')),
            ...(removeButton ? [removeButton] : []),
          ),
          h('div.slot-card__portrait', { 'aria-hidden': 'true' }, playerIcon(player.avatar, COLORS.players[player.id])),
          h('div.player-slot__identity', null,
            h('span.lobby__player-name', { title: player.name }, player.name),
            ...(mine ? [h('span.lobby__tag', null, t('multiplayer.you'))] : []),
            ...(player.id === 0 ? [h('span.lobby__tag.lobby__tag--host', null, t('multiplayer.host'))] : []),
            ...cpuTag,
          ),
          h('div.player-slot__controls', null, ...levelPick),
          h(player.ready ? 'span.lobby__ready.lobby__ready--on' : 'span.lobby__ready', null,
            player.id === 0 ? t('multiplayer.host') : player.ready ? `✓ ${t('multiplayer.ready')}` : t('multiplayer.notReady')),
        );
        card.style.setProperty('--slot-tone', teamGame ? TEAMS[player.team][0] : COLORS.players[player.id]);
        card.classList.toggle('is-self', mine);
        card.classList.toggle('is-cpu', cpu !== null);
        card.classList.toggle('has-remove', !!removeButton);
        card.classList.toggle('is-ready', player.ready);
        card.querySelectorAll<HTMLElement>('button').forEach((control, i) => {
          control.dataset.slotFocus = `${player.id}-${i}`;
        });
        return {
          key: String(player.id), el: card, label: player.name, team: player.team,
          ...(teamGame && room.status === 'waiting' && (mine || (cpu !== null && you.host)) ? { move: (team: number) => {
            sound.blip();
            if (cpu !== null) session.setCpu(player.id, { team: team as 0 | 1 });
            else session.setTeam(team as 0 | 1);
          } } : {}),
        };
      }),
      ...Array.from({ length: room.maxPlayers - room.players.length }, (_, i) => {
        const slot = room.players.length + i;
        const invite = button(t('slots.invite'));
        invite.className = 'slot-card__join';
        invite.append(h('span.slot-card__plus', { 'aria-hidden': 'true' }, '+'));
        invite.disabled = !canCopyInvite(room.locked, you.host);
        invite.dataset.slotFocus = `invite-${slot}`;
        invite.addEventListener('click', () => copyInviteLink(invite));
        const addCpu = button(t('multiplayer.addCpu'));
        addCpu.className = 'slot-card__add-cpu';
        addCpu.dataset.slotFocus = `cpu-${slot}`;
        addCpu.addEventListener('click', () => {
          const team = roster.teamOf(`free-${slot}`);
          session.addCpu('medium', teamGame && team !== null ? team as 0 | 1 : undefined);
        });
        addCpu.hidden = !(you.host && room.status === 'waiting');
        const card = h('article.slot-card.slot-card--empty', null,
          h('div.slot-card__head', null, h('span.slot-card__number', null, `P${slot + 1}`), h('span.slot-card__kind', null, t('slots.free'))),
          invite, h('span.slot-card__waiting', null, t('slots.waiting')), addCpu,
        );
        return { key: `free-${slot}`, label: t('slots.free'), el: card, team: null };
      }),
    ];
    roster.show(cards, teamGame ? 2 : 0, room.maxPlayers);
    if (focusKey) players.querySelector<HTMLElement>(`[data-slot-focus="${focusKey}"]`)?.focus({ preventScroll: true });
    // The look is rebuilt only when the room or the host changes, so an open dialog keeps its state between updates.
    const lookId = `${room.id}|${you.host}`;
    if (lookId !== roomLookKey) {
      roomLookKey = lookId;
      roomDialog?.close();
      roomDialog = you.host ? lookDialog(lookOf(room), changeRoomLook, { sound }) : null;
    }
    roomSymbol.disabled = !you.host;
    roomSymbol.title = you.host ? t('multiplayer.lookTitle') : '';
    roomDialog?.refresh(lookOf(room));

    // The host edits the game and its rules in the briefing; everybody else sees the same page, locked, and it follows the host.
    if (!you.host) {
      ownGame ??= { gameMode: prefs.gameMode, rules: prefs.rules };
      const sameGame = followed.startsWith(`${room.id}|${room.gameMode}|`);
      followed = `${room.id}|${room.gameMode}|${JSON.stringify(room.rules)}`;
      prefs.gameMode = room.gameMode;
      prefs.rules = { ...prefs.rules, ...room.rules, powerUpKinds: [...room.rules.powerUpKinds] };
      if (sameGame) {
        createRulesForm?.refresh();
        createQuickControls.forEach((control) => control.refresh());
        paintCreatePresetState();
        createPowerups.update();
      } else {
        buildCreateRules();
        buildCreateQuick();
      }
    }
    rulesLinkLabel.textContent = t(you.host ? 'briefing.editRules' : 'shell.roomRules');
    ready.textContent = self?.ready ? t('multiplayer.unready') : t('multiplayer.ready');
    ready.classList.toggle('lobby__button--primary', !you.host && !watching && !self?.ready);
    start.hidden = !you.host;
    // Everybody but the host must be ready; the host's click is its own "ready". CPUs are always ready, but a game needs a second person.
    const guestsReady = room.players.every((p) => p.id === 0 || p.ready);
    start.disabled = people < 2 || !guestsReady || !teamsReady;
    // Why the game cannot start, beside the start button: CPUs alone play offline, and a team game needs somebody in each team.
    const hints = [
      ...(cpus > 0 && people < 2 ? [t('multiplayer.cpuOnlyNote')] : you.host && people < 2 ? [t('multiplayer.startNeedHuman')] : []),
      ...(!teamsReady ? [t('multiplayer.teamsNeedPlayers')] : []),
    ];
    if (!hints.length && you.host && !guestsReady) hints.push(t('multiplayer.startNeedReady'));
    startHint.textContent = hints.join('\n');
    startHint.hidden = !hints.length;
    start.classList.toggle('lobby__button--primary', you.host);
  };

  // ————————————————————————————— Rendering —————————————————————————————

  // Each lobby page is a child of Online. Leaving an active room remains a separate action.
  const backButton = button(t('common.back'));
  const footerActions = h('div.items.items--row.menu-page__actions.lobby__actions', null, h('div.lobby__chat-slot', null), startHint, backButton, codeJoin, createButton, ready, start, leave);
  const onlineSectionNav = h('nav.items.items--row.mode-pager.online-section-pager', { 'aria-label': t('launcher.online') });
  onlineSectionNav.classList.add('is-positioned');
  const onlineSectionButtons = ONLINE_SECTIONS.map(() => h('button.item.mode-pager__item', { type: 'button' }) as HTMLButtonElement);
  onlineSectionNav.append(...onlineSectionButtons);
  const onlineSectionViewport = h('div.mode-pager__viewport.online-section-viewport', null, onlineSectionNav);
  const onlineSectionKeys = h('div.mode-pager__keys.online-section-keys', { 'aria-hidden': 'true' },
    h('span', null, '‹ (Q)'), h('span', null, '(E) ›'),
  );
  const onlineHeading = h('h2.menu-page__title.online-view-title', { tabindex: '-1', 'aria-live': 'polite' });
  const onlineHeader = h('div.mode-carousel.online-section-header', null, onlineSectionViewport, onlineSectionKeys, onlineHeading);

  const lobbyEl = h('div.lobby', null, bar, connectSlot, roomsView, openForms, roomView, status);
  const root = menuPage({
    title: t(({ rooms: 'flow.find', create: 'flow.create', code: 'flow.code' } as const)[view]), eyebrow: t('launcher.online'), intro: t(({ rooms: 'flow.findHint', create: 'flow.createIntro', code: 'flow.codeIntro' } as const)[view]), className: 'menu-page--lobby menu-page--mode-enter-next',
    headerTitle: onlineHeader,
    body: [lobbyEl], footer: footerActions, keys: t('flow.tabKeys'),
  });
  const page = root.querySelector<HTMLElement>('.menu-page')!;
  const eyebrow = root.querySelector<HTMLElement>('.menu-page__head .eyebrow')!;
  const heading = onlineHeading;
  const introduction = root.querySelector<HTMLElement>('.menu-page__intro')!;
  let pendingContentDirection: OnlineSectionDirection | null = null;
  let enterTimer: ReturnType<typeof setTimeout> | undefined;
  /** The host of a waiting room picks the game in the pager, where everybody else has the online pages. */
  const hostPicking = (): boolean => !!session.room && session.you.host && !session.you.spectator && session.room.status === 'waiting';
  const paintOnlineSectionNav = (inRoom: boolean): void => {
    const picking = hostPicking();
    const entries: { id: string; label: string }[] = picking
      ? PICKER_MODES.map((mode) => ({ id: mode, label: t(`mode.${mode}` as Key) }))
      : ONLINE_SECTIONS.map((section) => ({ id: section, label: t(ONLINE_SECTION_TITLE[section]) }));
    const index = Math.max(0, entries.findIndex((entry) => entry.id === (picking ? currentMode() : view)));
    onlineSectionButtons.forEach((item, distance) => {
      // Two games fill only two of the three places.
      item.hidden = distance >= entries.length;
      const entry = entries[(index + distance) % entries.length];
      const selected = distance === 0;
      item.className = `item mode-pager__item mode-pager__item--${entry.id} mode-pager__item--${selected ? 'active' : distance === 1 ? 'near' : 'far'}`;
      item.textContent = entry.label;
      delete item.dataset.view;
      delete item.dataset.mode;
      item.dataset[picking ? 'mode' : 'view'] = entry.id;
      if (selected) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    });
    const visible = !inRoom || picking;
    onlineSectionViewport.hidden = !visible;
    onlineSectionKeys.hidden = !visible;
    page.classList.toggle('menu-page--online-carousel-active', visible);
  };
  const animateOnlineCarousel = (direction: OnlineSectionDirection): void => {
    if (onlineSectionViewport.hidden) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      onlineSectionNav.classList.add('is-positioned');
      onlineSectionNav.style.transform = 'translate3d(0, 0, 0)';
      return;
    }
    const offset = direction === 'next' ? 72 : -72;
    onlineSectionNav.classList.remove('is-positioned');
    onlineSectionNav.style.transform = `translate3d(${offset}px, 0, 0)`;
    void onlineSectionNav.offsetWidth;
    requestAnimationFrame(() => {
      if (!onlineSectionNav.isConnected || onlineSectionViewport.hidden) return;
      onlineSectionNav.classList.add('is-positioned');
      onlineSectionNav.style.transform = 'translate3d(0, 0, 0)';
    });
  };
  /** Without the marker the page would fall back to its own entrance and play it a second time. */
  const endEntrance = (): void => {
    page.classList.remove('menu-page--mode-enter-next', 'menu-page--mode-enter-previous');
    page.classList.add('menu-page--entered');
  };
  const animateContentState = (inRoom: boolean): void => {
    const state = inRoom ? `room-${hostPicking() ? currentMode() : ''}` : view;
    if (lastContentState !== null && state !== lastContentState) {
      const order: Record<string, number> = { rooms: 0, create: 1, code: 2 };
      const from = order[lastContentState];
      const to = order[state];
      const forward = from === undefined || to === undefined ? 0 : (to - from + ONLINE_SECTIONS.length) % ONLINE_SECTIONS.length;
      const direction = pendingContentDirection ?? (forward <= 1 ? 'next' : 'previous');
      animateOnlineCarousel(direction);
      page.classList.remove('menu-page--mode-enter-next', 'menu-page--mode-enter-previous', 'menu-page--entered');
      void page.offsetWidth;
      page.classList.add(`menu-page--mode-enter-${direction}`);
      // The entrance is over after a moment; cards rebuilt later must not play it again.
      clearTimeout(enterTimer);
      enterTimer = setTimeout(() => endEntrance(), 900);
    }
    pendingContentDirection = null;
    lastContentState = state;
  };

  /** An invite is a one-shot: once a room is entered, or the lobby is left, it is out of the URL again. */
  const dropInvite = () => {
    if (inviteInUrl) history.replaceState(null, '', withoutInvite(location.href));
    inviteInUrl = false;
    inviteNote = null;
    invitePending = false;
  };

  const render = () => {
    const { connected, connecting, room, rooms: open } = session;
    const title = room ? room.name : t(ONLINE_SECTION_TITLE[view]);
    heading.textContent = room && !hostPicking() ? modeName(room.gameMode, room.rules.mayhem > 0) : title;
    root.setAttribute('aria-label', title);
    eyebrow.textContent = room ? `${t('launcher.online')} · ${t('multiplayer.roomNumber', { n: room.number })} · ${room.name}` : t('launcher.online');
    introduction.hidden = !!room;
    introduction.textContent = room ? t(hostPicking() ? 'flow.roomHostIntro' : 'shell.roomIntro') : t(({ rooms: 'flow.findHint', create: 'flow.createIntro', code: 'flow.codeIntro' } as const)[view]);
    page.classList.toggle('menu-page--room', !!room);
    profileLabel.textContent = playerName.value.trim() || t('multiplayer.name');
    profileAvatar.replaceChildren(avatarSvg(prefs.avatar));
    connectionLabel.textContent = t(connected ? 'flow.connected' : 'flow.connection');
    connectionServer.textContent = connected && !configuredServer ? (session.client.address || prefs.server).replace(/^wss?:\/\//, '') : '';
    connectionServer.hidden = !connectionServer.textContent;
    connection.classList.toggle('is-connected', connected);
    connection.classList.toggle('is-connecting', connecting && !connected && !hosted);
    if (wasConnected !== null && connected !== wasConnected) flashConnection(connected ? 'is-linked' : 'is-dropped');
    wasConnected = connected;
    disconnectButton.hidden = hosted || !connected;
    avatarBar.show(prefs.avatar);
    const browsing = connected && !room;
    if (room) dropInvite();
    // Whoever followed an invite came here to get into that room, so it is joined for them — no second click.
    // Only a missing player name stops it: then the lobby asks for one and shows the join row as usual.
    const inviteAttempt = inviteJoinAttempt(invited, invitePending, browsing, playerName.value);
    invitePending = inviteAttempt.pending;
    if (inviteAttempt.kind === 'join') {
      prefs.name = inviteAttempt.name!;
      save();
      session.joinRoom(inviteAttempt.roomId!, inviteAttempt.name!, inviteAttempt.password, prefs.avatar);
      inviteNote = null;
    } else if (inviteAttempt.kind === 'name-required') {
      inviteNote = t('multiplayer.nameRequired');
      profile.open = true;
      playerName.focus();
    }
    // The hosted build says nothing about connecting or being connected; its connect card returns only when that failed.
    const retry = hosted && !connected && !connecting && (connectFailed || session.notice !== null);
    // The code page says what went wrong at its own fields; what is left over from earlier is not its news.
    const ownsNotice = session.passwordNotice !== null || session.notice === codeNotice || (view === 'code' && !room);
    const notice = ownsNotice ? null : session.notice && relayText(session.notice);
    const message = localMessage ?? notice ?? inviteNote ?? (connecting && !hosted ? t('multiplayer.connecting') : '');
    status.textContent = message;
    status.classList.toggle('is-busy', connecting);
    status.hidden = !message;

    connectView.hidden = connected || (hosted && !retry) || quietConnect;
    connectSlot.hidden = connected || !!room || quietConnect;
    codeView.hidden = !(browsing && view === 'code');
    roomsView.hidden = !(browsing && view === 'rooms');
    createView.hidden = !(browsing && view === 'create');
    openForms.hidden = codeView.hidden && createView.hidden;
    roomView.hidden = !room;
    bar.hidden = !!room && !!session.you.spectator;
    backButton.hidden = !!room;
    createButton.hidden = !(browsing && view === 'create');
    codeJoin.hidden = !(browsing && view === 'code');
    leave.hidden = !room;
    if (!room) {
      ready.hidden = true;
      start.hidden = true;
      startHint.hidden = true;
    }
    paintOnlineSectionNav(!!room);
    animateContentState(!!room);
    if (room) return renderRoom(room);
    // Out of the room the next one starts from scratch, with the rules one had before.
    followed = '';
    if (ownGame) {
      prefs.gameMode = ownGame.gameMode;
      prefs.rules = ownGame.rules;
      ownGame = null;
      buildCreateRules();
      buildCreateQuick();
    }
    hostPassword = '';
    roomLookKey = '';
    roomDialog?.close();
    roomDialog = null;

    barName.append(nameField);
    connectButton.disabled = connecting;
    serverAddress.disabled = connecting;
    renderRooms(open, session.roomListLoaded, !session.roomListLoaded && !!session.notice);
  };

  const connectErrorText = (error: unknown): string => {
    if (!(error instanceof ConnectError)) return error instanceof Error ? error.message : String(error);
    const params = { server: error.url };
    if (error.reason === 'timeout') return t('multiplayer.connectTimeout', params);
    if (error.reason === 'closed') return t('multiplayer.connectClosed', params);
    return t('multiplayer.connectUnreachable', params);
  };

  const connect = async (silent: boolean) => {
    const address = configuredServer ? DEFAULT_SERVER : serverAddress.value.trim();
    localMessage = silent ? null : t('multiplayer.connecting');
    connectFailed = false;
    quietConnect = silent;
    render();
    try {
      await session.connect(address);
      if (!configuredServer) prefs.server = address;
      prefs.autoConnect = true;
      localMessage = null;
    } catch (error) {
      connectFailed = true;
      prefs.autoConnect = false;
      localMessage = configuredServer ? t('multiplayer.connectFailed') : connectErrorText(error);
    }
    quietConnect = false;
    save();
    render();
  };

  const focusOnlineSection = (): void => {
    if (onlineSectionViewport.hidden) heading.focus({ preventScroll: true });
    else onlineSectionButtons.find((item) => item.classList.contains('mode-pager__item--active'))?.focus({ preventScroll: true });
  };
  const show = (next: View) => {
    view = next;
    localMessage = null;
    // What the relay said on the page we leave is not news on the next one.
    if (!session.room) session.notice = null;
    render();
    root.querySelector<HTMLElement>('.menu-page__body')!.scrollTop = 0;
    focusOnlineSection();
  };
  const enter = (next: View) => {
    show(next);
    // Whoever disconnected (or never connected) stays offline while paging; the connect card has the button.
    if (!session.connected && !session.connecting && (configuredServer || prefs.autoConnect)) void connect(false);
  };
  const navigateOnlineSection = (next: View, direction: OnlineSectionDirection): void => {
    if (next === view) return;
    pendingContentDirection = direction;
    enter(next);
  };
  onlineSectionButtons.forEach((item) => item.addEventListener('click', () => {
    const mode = item.dataset.mode as NetworkGameMode | undefined;
    if (mode) {
      setMode(mode, 'next');
      focusOnlineSection();
      return;
    }
    const next = item.dataset.view as View | undefined;
    if (next) navigateOnlineSection(next, 'next');
  }));
  /** One step along the pager: the next page, or the next game for the host of a waiting room. */
  const stepPager = (direction: OnlineSectionDirection): void => {
    const step = direction === 'next' ? 1 : -1;
    if (hostPicking()) {
      setMode(PICKER_MODES[(PICKER_MODES.indexOf(currentMode()) + step + PICKER_MODES.length) % PICKER_MODES.length], direction);
      focusOnlineSection();
      return;
    }
    navigateOnlineSection(ONLINE_SECTIONS[(ONLINE_SECTIONS.indexOf(view) + step + ONLINE_SECTIONS.length) % ONLINE_SECTIONS.length], direction);
  };
  const handleOnlineSectionKey = (event: KeyboardEvent): void => {
    if (!root.isConnected || onlineSectionViewport.hidden || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target;
    if (!(target instanceof Element) || target.closest('input, select, textarea, [contenteditable]:not([contenteditable="false"])')) return;
    const key = event.key.toLowerCase();
    const shortcut = key === 'q' || key === 'e';
    if (!shortcut && (!target.closest('.online-section-pager') || (key !== 'arrowleft' && key !== 'arrowright'))) return;
    event.preventDefault();
    event.stopPropagation();
    stepPager(key === 'arrowright' || key === 'e' ? 'next' : 'previous');
  };
  // Capture at document level so the shortcuts still work when focus is on content controls
  // whose own key handlers stop bubbling. Text fields remain untouched.
  document.addEventListener('keydown', handleOnlineSectionKey, true);
  let swipeStart: { x: number; y: number } | null = null;
  onlineSectionViewport.addEventListener('touchstart', (event: TouchEvent) => {
    if (event.touches.length !== 1) { swipeStart = null; return; }
    swipeStart = { x: event.touches[0].clientX, y: event.touches[0].clientY };
  }, { passive: true });
  onlineSectionViewport.addEventListener('touchend', (event: TouchEvent) => {
    if (!swipeStart || event.changedTouches.length !== 1) { swipeStart = null; return; }
    const dx = event.changedTouches[0].clientX - swipeStart.x;
    const dy = event.changedTouches[0].clientY - swipeStart.y;
    swipeStart = null;
    if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 1.3) return;
    event.preventDefault();
    stepPager(dx < 0 ? 'next' : 'previous');
  }, { passive: false });

  connectButton.addEventListener('click', () => void connect(false));
  serverAddress.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !session.connecting) void connect(false);
  });
  disconnectButton.addEventListener('click', () => {
    session.disconnect();
    prefs.autoConnect = false;
    save();
  });
  openCreate.addEventListener('click', () => {
    createFromRooms = true;
    enter('create');
  });
  playerName.addEventListener('change', () => {
    prefs.name = playerName.value.trim() || prefs.name;
    save();
  });

  /** Return to the main menu's Online section, or leave a standalone invite/lobby screen. */
  const goBack = () => {
    dropInvite();
    if (session.room) {
      view = 'rooms';
      session.leaveRoom();
    } else if (app.menu.depth > 1) {
      app.menu.back();
    } else {
      session.disconnect();
      app.toTitle();
    }
  };
  backButton.addEventListener('click', () => {
    if (!session.room && view === 'create' && createFromRooms) {
      createFromRooms = false;
      show('rooms');
      return;
    }
    goBack();
  });

  let unsubscribe: (() => void) | null = null;
  return {
    build: () => {
      unsubscribe?.();
      // The session outlives this screen. Subscribe while mounted and release on a stack change/rebuild.
      unsubscribe = session.subscribe(() => {
        if (!root.isConnected) {
          unsubscribe?.();
          unsubscribe = null;
          return;
        }
        localMessage = null;
        // The relay's reason for refusing a name goes under the name; other errors stay in the general message.
        if (pendingName !== null) {
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
        }
        if (codeJoinPending && session.room) codeJoinPending = false;
        else if (codeJoinPending && session.notice && !session.passwordNotice) {
          showFieldError(codeError, relayText(session.notice));
          codeNotice = session.notice;
          codeJoinPending = false;
        }
        if (session.passwordNotice && passwordTarget) {
          const { error, input, reveal } = passwordTarget;
          // "Wrong password" is all the relay says for a missing one too; the player is told which it was.
          const wrong = session.passwordNotice === 'Wrong password';
          showFieldError(error, wrong ? t(input.value ? 'multiplayer.passwordWrong' : 'multiplayer.passwordNeeded') : relayText(session.passwordNotice));
          if (reveal) reveal.hidden = false;
          queueMicrotask(() => input.focus());
          passwordTarget = null;
        }
        render();
      });
      // Reconnect to a previously used relay. A different relay named by an invite requires an explicit click.
      // Deferred until the screen is in the DOM — the session's updates only reach a mounted screen.
      const mayAutoConnect = shouldAutoConnectInvite(invited, prefs.server) && (prefs.autoConnect || !!invited);
      const reconnect = !session.connected && !session.connecting && !session.room && (configuredServer || mayAutoConnect);
      quietConnect = reconnect;
      render();
      enterTimer = setTimeout(() => endEntrance(), 900);
      if (reconnect) setTimeout(() => void connect(true), 0);
      focusOnlineSection();
      return root;
    },
    items: [],
    dispose: () => {
      document.removeEventListener('keydown', handleOnlineSectionKey, true);
      unsubscribe?.();
      unsubscribe = null;
      if (rulesTimer) pushRules();
      roomDialog?.close();
      rulesDialog.remove();
    },
    // Escape closes an open look dialog first, and only then leaves the lobby.
    onEscape: () => {
      if (!rulesDialog.hidden) { closeRulesDialog(); return true; }
      if (createDialog.isOpen()) { createDialog.close(); return true; }
      if (roomDialog?.isOpen()) { roomDialog.close(); return true; }
      if (app.menu.depth === 1) { goBack(); return true; }
      return false;
    },
  };
}
