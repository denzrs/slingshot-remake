import { AVATARS, type Avatar } from '../avatars';
import { COLORS, GALLERY, MAX_PLAYERS } from '../config';
import { relayText, t, type Key } from '../i18n';
import { POWER_UP_KINDS } from '../powerups';
import { canCopyInvite, inviteJoinAttempt, inviteLink, readInvite, shouldAutoConnectInvite, withoutInvite, withoutInvitePassword } from '../invite';
import { loadLobbyPrefs, mayhemRules, saveLobbyPrefs } from '../lobbyPrefs';
import { DEFAULT_SERVER, isSecureRelay, type MultiplayerSession } from '../multiplayer';
import { ConnectError, type LobbyRoom, type NetworkCpuLevel, type NetworkGameMode, type RoomInfo, type RoomMode, type RoomRules } from '../net';
import type { RoomLook } from '../roomLook';
import { buildControl, optionSelector, segmentedControl, sliderControl, type Control, type Env } from './controls';
import { eyeIcon } from './dom';
import { h, type Screen } from './menu';
import { groupTitle, RULE_GROUPS, ruleItems, type RuleSource } from './rules';
import type { App } from './screens';
import { AVATAR_LABEL, avatarSvg, playerIcon } from './avatars';
import { lookDialog, lookSummary, picker, roomIcon, visibilityControl, type LookControl, type LookDialog } from './roomLook';
import { menuPage } from './menu-page';
import { modeArt } from './mode-icons';
import { flightCard } from './flight-card';
import { pickArt, pickHint, pickName } from './pick-of-day';
import { presetsForMode, matchingPreset, presetRules, MAYHEM_PRESETS, mayhemPresetRules, matchingMayhemPreset, matchingHandpicked, pickOfTheDay } from './match-presets';
import { powerUpSummary } from './powerup-summary';
import { teamRoster, type RosterCard } from './team-roster';

/** A game mode's name; a Mayhem room is the mode its rounds are played in, with Mayhem in front. */
const modeName = (mode: NetworkGameMode, mayhem = false) => {
  const name = t(mode === 'classic' ? 'mode.classic' : 'mode.horizon');
  return mayhem ? `${t('mode.mayhem')} · ${name}` : name;
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
function secretField(input: HTMLInputElement, onCopy?: () => void): HTMLElement {
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
    copy.addEventListener('click', onCopy);
    parts.push(copy);
  }
  return h('span.lobby__secret', null, ...parts);
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
function rulesForm(mode: NetworkGameMode, source: RuleSource, app: App, readonly = false, mayhem = false, changed?: () => void): RulesForm {
  const controls: Control[] = [];
  const refresh = () => controls.forEach((c) => c.refresh());
  const env: Env = { sound: app.menu.sound, readonly, changed: () => { refresh(); changed?.(); } };
  const items = ruleItems(mode, source, true, mayhem);
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
  let createStep: 'mode' | 'setup' = 'mode';
  let lastContentState: string | null = null;
  let createFromRooms = false;
  /** Join passwords typed so far, per room — the room list is rebuilt whenever it changes. */
  const joinPasswords = new Map<string, string>();
  /** The password the player set for the room they opened; it is shown to the host to share, until they leave. */
  let hostPassword = '';

  /** Copies a text to the clipboard and says so, or says that it could not. Nothing happens for an empty text. */
  const copyText = async (text: string, done: string): Promise<void> => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      localMessage = done;
    } catch {
      localMessage = t('multiplayer.copyFailed');
    }
    render();
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
  const roomNameError = nameError();
  /** The name that went out (join, create, rename) and has not been answered yet. It becomes the default for next time only once the relay has taken it. */
  let pendingName: string | null = null;
  const showNameError = (message: string | null) => {
    for (const el of [joinNameError, roomNameError]) {
      el.textContent = message ? relayText(message) : '';
      el.hidden = !message;
    }
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
  });
  const avatarRow = h('div.lobby__avatar', null, h('span.lobby__code-label', null, t('multiplayer.yourSymbol')), avatarBar.el);
  const disconnectButton = button(t('multiplayer.disconnect'));
  // The hosted build is connected as of now: there is nothing to disconnect from.
  disconnectButton.hidden = hosted;
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
    prefs.name = name;
    save();
    profile.open = false;
    render();
  };
  saveProfile.addEventListener('click', commitProfile);
  playerName.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') commitProfile();
  });
  const connectionLabel = h('span.online-connection__state', null);
  const connectionServer = h('span.online-connection__server', null);
  const connection = h('details.online-connection', null,
    h('summary', null, h('span.online-connection__text', null, connectionLabel, connectionServer)), disconnectButton,
  );
  // Nothing to open where there is nothing to disconnect from.
  connection.classList.toggle('is-static', hosted);
  const bar = h('div.online-identity', null, profile, connection);
  const connectSlot = h('div', null, connectView);

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
  const codePasswordError = fieldError();
  /** Whose password the relay is about to judge: it answers a wrong one with an error, and that goes right there. */
  /** A join by code is waiting for the relay's answer; if that is a refusal, it goes under the code. */
  let codeJoinPending = false;
  /** The relay notice that went under the code already, so the general message does not say it again. */
  let codeNotice: string | null = null;
  let passwordTarget: { error: HTMLElement; input: HTMLInputElement; reveal?: HTMLElement } | null = null;
  // A link made by somebody in a locked room carries its password, so the guest needs no second paste.
  codePassword.value = invited?.password ?? '';
  const codeJoin = button(t('multiplayer.join'), true);
  const codeWatch = button(t('multiplayer.watch'));
  const joinByCode = (spectate = false) => {
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
  codeWatch.addEventListener('click', () => joinByCode(true));
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
      field(t('multiplayer.code'), codeInput),
      codeError,
      codePasswordBox,
      h('div.lobby__actions', null, codeWatch, codeJoin),
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
        h('strong', null, roomIcon(room.symbol, room.color), `${room.locked ? '🔒 ' : ''}${room.name}`),
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
  const horizonNote = h('p.lobby__note', null, t('multiplayer.horizonNote'));
  const createPresetStatus = h('span.lobby__preset-status', { 'aria-live': 'polite' });
  const createPresetCards = h('div.items.items--row.briefing__cards', { role: 'group', 'aria-label': t('preset.choose') });
  const createQuick = h('div.briefing__quick', null);
  const createPowerups = powerUpSummary(() => prefs.rules);
  const createMayhemPowerups = powerUpSummary(() => ({ powerUps: true, powerUpKinds: POWER_UP_KINDS }));
  const createRules = h('div', null);
  const createAdvanced = h('details.lobby__rule-details', null, h('summary', null, t('briefing.editRules')), createRules) as HTMLDetailsElement;
  let createRulesOpen = false;
  createAdvanced.open = createRulesOpen;
  createAdvanced.addEventListener('toggle', () => { createRulesOpen = createAdvanced.open; });
  let createRulesForm: RulesForm | null = null;
  let createQuickControls: Control[] = [];
  let paintCreatePresetState = () => {};
  const createFacts = h('dl.briefing__facts.online-create__facts', { 'aria-live': 'polite' });
  const paintCreateFacts = () => {
    const fact = (label: string, value: string) => h('div', null, h('dt', null, label), h('dd', null, value));
    const mayhem = prefs.rules.mayhem > 0;
    createFacts.replaceChildren(
      ...(mayhem ? [fact(t('settings.mayhem'), t(`settings.mayhem.${prefs.rules.mayhem}` as Key)), fact(t('mayhem.base'), modeName(prefs.gameMode))] : []),
      fact(t('settings.rounds'), prefs.rules.rounds ? String(prefs.rules.rounds) : t('settings.endless')),
      ...(mayhem ? [] : [fact(t('settings.maxPlanets'), String(prefs.rules.maxPlanets))]),
      ...(mayhem ? [fact(t('settings.simultaneousShots'), t(prefs.gameMode === 'horizon' || prefs.rules.simultaneousShots ? 'common.on' : 'common.off'))] : []),
      fact(t('settings.shotTime'), t('settings.seconds', { n: prefs.rules.shotTime })),
    );
  };
  const buildCreateRules = () => {
    const mayhem = prefs.rules.mayhem > 0;
    const presets = presetsForMode(prefs.gameMode);
    const pickMode = mayhem ? 'mayhem' : prefs.gameMode;
    const pick = pickOfTheDay(pickMode, app.today());
    createRulesForm = rulesForm(prefs.gameMode, {
      get: () => prefs.rules,
      patch: (v) => (prefs.rules = { ...prefs.rules, ...v }),
      commit: save,
    }, app, false, mayhem, () => {
      paintCreatePresetState();
      paintCreateFacts();
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
      card.addEventListener('click', () => {
        apply();
        save();
        createRulesForm?.refresh();
        createQuickControls.forEach((control) => control.refresh());
        paintCreatePresetState();
        paintCreateFacts();
        createPowerups.update();
        createPresetCards.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus({ preventScroll: true });
        sound.select();
      });
      choices.push({ id, card });
    };
    addPreset('handpicked', pickName(pick), pickHint(pick), pickArt(pick), () => {
      prefs.gameMode = pick.base;
      prefs.rules = { ...pick.rules, powerUpKinds: [...pick.rules.powerUpKinds], betting: prefs.rules.betting, chatPlayersOnly: prefs.rules.chatPlayersOnly };
      buildCreateRules();
      buildCreateQuick();
    }, true);
    if (mayhem) {
      for (const preset of MAYHEM_PRESETS) {
        addPreset(preset.key, t(preset.key), '', modeArt(preset.base, { mode: 'mayhem', preset: preset.art }), () => {
          prefs.gameMode = preset.base;
          prefs.rules = { ...mayhemPresetRules(preset), betting: prefs.rules.betting, chatPlayersOnly: prefs.rules.chatPlayersOnly };
          buildCreateRules();
          buildCreateQuick();
        });
      }
    } else {
      for (const preset of presets) {
        const art = preset === 'simultaneous' ? 'simultaneous' : preset === 'standard' ? 'classic' : preset;
        addPreset(preset, t(`preset.${preset}`), t(`preset.${preset}.hint`), modeArt(art, prefs.gameMode === 'horizon' && preset !== 'simultaneous' ? { mode: 'horizon', preset } : undefined), () => {
          prefs.rules = { ...presetRules(preset), mayhem: 0, betting: prefs.rules.betting, chatPlayersOnly: prefs.rules.chatPlayersOnly };
        });
      }
    }
    createPresetCards.replaceChildren(...choices.map(({ card }) => card));
    paintCreatePresetState = () => {
      const handpicked = matchingHandpicked(prefs.rules, pickMode, prefs.gameMode);
      const selectedId = handpicked?.id === pick.id ? 'handpicked' : mayhem
        ? matchingMayhemPreset({ mayhem: prefs.rules.mayhem, mayhemBase: prefs.gameMode, simultaneousShots: prefs.rules.simultaneousShots })?.key
        : matchingPreset(prefs.rules, prefs.gameMode);
      const selected = selectedId && choices.some(({ id }) => id === selectedId) ? selectedId : undefined;
      createPresetStatus.textContent = handpicked ? pickName(handpicked) : selected
        ? t((mayhem ? selected : `preset.${selected}`) as Key)
        : t('preset.custom');
      choices.forEach(({ id, card }) => card.setAttribute('aria-pressed', String(id === selected)));
    };
    horizonNote.hidden = mayhem || prefs.gameMode !== 'horizon';
    paintCreatePresetState();
    paintCreateFacts();
  };

  const buildCreateQuick = () => {
    const mayhem = prefs.rules.mayhem > 0;
    const quickKeys = mayhem ? ['rounds', 'shotTime', 'mayhem'] : ['rounds', 'shotTime'];
    createQuick.classList.toggle('briefing__quick--mayhem', mayhem);
    createQuickControls = ruleItems(prefs.gameMode, {
      get: () => prefs.rules,
      patch: (v) => (prefs.rules = { ...prefs.rules, ...v }),
      commit: save,
    }, true, mayhem)
      .filter(({ key }) => quickKeys.includes(key))
      .map(({ item }) => buildControl(item, { sound, changed: () => {
        paintRoomOptions();
        paintCreatePresetState();
        paintCreateFacts();
        createPowerups.update();
        createRulesForm?.refresh();
      } }));
    createQuick.replaceChildren(
      ...createQuickControls.map(({ el }) => el),
      mayhem ? createMayhemPowerups.el : createPowerups.el,
    );
    createPowerups.update();
  };

  // The controls redraw themselves; the room and rule summaries follow their values.
  const env: Env = { sound, changed: () => { paintRoomOptions(); paintCreateFacts(); } };
  const modeChoices = (['classic', 'horizon', 'mayhem'] as const).map((mode) => {
    const card = flightCard(t(`mode.${mode}`), t(`mode.${mode}.hint`), mode, () => {
      const pick = pickOfTheDay(mode, app.today());
      prefs.gameMode = pick.base;
      prefs.rules = { ...pick.rules, powerUpKinds: [...pick.rules.powerUpKinds], betting: prefs.rules.betting, chatPlayersOnly: prefs.rules.chatPlayersOnly };
      save();
      buildCreateRules();
      buildCreateQuick();
      createStep = 'setup';
      paintModeChoices();
      sound.select();
      render();
      root.querySelector<HTMLElement>('.menu-page__body')!.scrollTop = 0;
      heading.focus({ preventScroll: true });
    });
    return { mode, card };
  });
  const paintModeChoices = () => {
    const selected = prefs.rules.mayhem > 0 ? 'mayhem' : prefs.gameMode;
    modeChoices.forEach(({ mode, card }) => card.setAttribute('aria-pressed', String(selected === mode)));
  };

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

  /** The listing, symbol and colour of the room to come; remembered, and sent when the room is made. */
  const lookSave = (patch: Partial<RoomLook>) => {
    prefs.look = { ...prefs.look, ...patch };
    save();
    createSummary.refresh(prefs.look);
    createDialog.refresh(prefs.look);
    paintRoomOptions();
  };
  const createVisibility = visibilityControl(prefs.look, lookSave, { sound });
  const createDialog = lookDialog(prefs.look, lookSave, { sound });
  const createSummary = lookSummary(prefs.look, () => createDialog.open());
  const createButton = button(t('multiplayer.create'), true);
  const optionRecap = h('span', null);
  const paintRoomOptions = () => {
    optionRecap.textContent = `${prefs.capacity} ${t('multiplayer.players')} · ${t(prefs.look.visibility === 'public' ? 'multiplayer.public' : 'multiplayer.private')} · ${matchTypeName(prefs.matchType)} · ${t(password.value ? 'multiplayer.passwordProtected' : 'multiplayer.noPassword')}`;
  };
  password.addEventListener('input', paintRoomOptions);
  const roomOptions = h('details.online-options', null,
    h('summary', null, h('span', null, t('flow.options')), optionRecap),
    h('div.lobby__basics', null,
      h('div', null, field(t('multiplayer.roomName'), roomName), capacity.el, matchType.el),
      h('div', null, createVisibility.el, field(t('multiplayer.passwordOptional'), secretField(password, () => void copyText(password.value, t('multiplayer.passwordCopied')))), createSummary.el),
    ),
  );
  const roomNameSection = h('section.online-create__room-name', null,
    h('h3.setup__title', null, t('shell.roomBasics')),
    field(t('multiplayer.roomName'), roomName),
  );
  const createModeView = h('section.online-create__mode', null,
    h('div.flight-cards.flight-cards--modes', null, ...modeChoices.map(({ card }) => card)),
  );
  const createSetupMain = h('div.online-create__main', null,
    horizonNote,
    h('section.briefing__presets', null,
      h('div.launcher__section-head', null, h('h3.setup__title', null, t('preset.choose')), createPresetStatus),
      createPresetCards,
      createQuick,
    ),
    createAdvanced,
  );
  const createSetupAside = h('aside.online-create__aside', null,
    roomNameSection,
    h('h3.setup__title', null, t('briefing.rules')),
    createFacts,
    roomOptions,
  );
  const createSetupView = h('section.online-create__setup', null,
    h('div.online-create__layout', null, createSetupMain, createSetupAside),
  );
  const createView = h('section.online-create', null,
    createModeView,
    createSetupView,
  );
  paintRoomOptions();
  paintCreateFacts();
  paintModeChoices();
  buildCreateRules();
  buildCreateQuick();

  createButton.addEventListener('click', () => {
    const name = takeName();
    if (!name) return;
    session.createRoom({ name, roomName: roomName.value, mode: prefs.matchType, gameMode: prefs.gameMode, rules: prefs.rules.mayhem > 0 ? mayhemRules(prefs.rules, prefs.gameMode) : prefs.rules, maxPlayers: prefs.capacity, password: password.value, look: prefs.look, avatar: prefs.avatar });
    hostPassword = password.value;
    password.value = '';
  });

  // ————————————————————————————— Inside a room —————————————————————————————

  const roomTitle = h('h3.setup__title', null);
  const roomCount = h('p.lobby__note', null);
  /** Host only, in team rooms: deal everybody back out to the teams. */
  const resetTeams = button(t('multiplayer.resetTeams'));
  resetTeams.addEventListener('click', () => session.resetTeams());
  /** The code others join the room with; a private room can only be found this way. */
  const roomCode = h('span.lobby__code-value', null);
  const privateTag = h('span.lobby__tag', null, t('multiplayer.private'));
  /** The invite link: one link that opens the client and puts the guest straight into this room. */
  const copyInvite = button(t('multiplayer.copyInvite'), true);
  copyInvite.addEventListener('click', () =>
    void copyText(inviteLink(`${location.origin}${location.pathname}`, session.room?.id ?? '', configuredServer ? undefined : session.client.address, hostPassword), t('multiplayer.inviteCopied')),
  );
  const copyCode = button(t('multiplayer.copyCode'));
  copyCode.addEventListener('click', () => void copyText(session.room?.id ?? '', t('multiplayer.codeCopied')));
  const copyPassword = button(t('multiplayer.copyPassword'));
  copyPassword.addEventListener('click', () => void copyText(hostPassword, t('multiplayer.passwordCopied')));
  const roster = teamRoster(t('multiplayer.players'));
  const players = roster.el;
  players.classList.add('lobby__players');
  /** The people in the stands, under the players. */
  const stands = h('p.lobby__note.lobby__stands', null);
  /** Said to a spectator in place of the buttons they do not have. */
  const watchNote = h('p.lobby__rules-note', null, t('multiplayer.watchNote'));
  /** When only CPUs share the room with the host: such a game is played offline, not here. */
  const cpuOnlyNote = h('p.lobby__rules-note.is-locked', null, t('multiplayer.cpuOnlyNote'));
  /** Your own symbol, as the game shows it: picked here while the room waits. */
  const roomAvatarPicker = picker<Avatar>(t('multiplayer.yourSymbol'), avatarOptions(), false, (avatar) => {
    sound.blip();
    prefs.avatar = avatar;
    save();
    roomAvatarPicker.show(avatar);
    session.setAvatar(avatar);
  });
  const roomAvatar = h('div.lobby__avatar', null, h('span.lobby__code-label', null, t('multiplayer.yourSymbol')), roomAvatarPicker.el);
  /** Your name, as the others see it: changed here while the room waits. */
  const roomPlayerName = textInput(prefs.name, { maxLength: 24 });
  roomPlayerName.setAttribute('autocomplete', 'nickname');
  /** The name the field was last set from, so a render does not put the old one back over a refused attempt. */
  let syncedName = '';
  const renameButton = button(t('multiplayer.rename'));
  const renameRoomPlayer = () => {
    const name = roomPlayerName.value.trim();
    if (!name) {
      localMessage = t('multiplayer.nameRequired');
      render();
      roomPlayerName.focus();
      return;
    }
    localMessage = null;
    sendingName(name);
    session.setName(name);
  };
  renameButton.addEventListener('click', renameRoomPlayer);
  roomPlayerName.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') renameRoomPlayer();
  });
  const roomRename = h('div', null, h('div.lobby__avatar', null, field(t('multiplayer.name'), roomPlayerName), renameButton), roomNameError);
  /** In team rooms, while a team has nobody in it. */
  const teamWarning = h('p.lobby__rules-note.is-locked', null, t('multiplayer.teamsNeedPlayers'));
  /** The room's look: editable by the host, shown to everybody else. */
  const roomLookSlot = h('div', null);
  /** Where the rules of the room are: sliders for the host, the same, locked, for everybody else. */
  const roomRuleFields = h('div', null);
  const roomRules = h('section.lobby__rule-details', null, h('h3.setup__title', null, t('shell.roomRules')), roomRuleFields);
  /** Above the rules: that they reset everybody's "ready" (host), or that they are not yours to change (everyone else). */
  const rulesNote = h('p.lobby__rules-note', null);
  const roomNote = h('p.lobby__note', null);
  const startHint = h('p.lobby__rules-note', { role: 'status' }, '');
  const ready = button(t('multiplayer.ready'), true);
  const start = button(t('multiplayer.start'), true);
  const leave = button(t('multiplayer.leave'));
  let selfReady = false;
  ready.addEventListener('click', () => session.setReady(!selfReady));
  start.addEventListener('click', () => session.startGame());
  leave.addEventListener('click', () => { view = 'rooms'; session.leaveRoom(); });
  const roomDetails = h('details.online-options', null,
    h('summary', null, t('flow.roomDetails')),
    roomRename, roomAvatar, roomLookSlot, rulesNote, roomRules, roomNote,
  ) as HTMLDetailsElement;
  const roomView = h(
    'section.lobby__card.lobby__card--wide.room-deck',
    null,
    h('div.room-deck__heading', null, roomTitle, h('span.room-deck__connection', null, t('flow.connected'))),
    h('div.lobby__code', null, h('span.lobby__code-label', null, t('multiplayer.code')), roomCode, copyInvite, copyCode, copyPassword, privateTag),
    h('div.lobby__head.room-deck__roster-head', null, roomCount, resetTeams),
    h('div.room-deck__content', null, players, h('div.room-chat-slot', null)),
    stands,
    watchNote,
    cpuOnlyNote,
    teamWarning,
    roomDetails,
    startHint,
  );

  /** The host's change to the look of the room: sent as the whole look, so nothing else gets lost. */
  const changeRoomLook = (patch: Partial<RoomLook>) => {
    if (session.room) session.setRoomLook({ ...lookOf(session.room), ...patch });
  };
  let roomVisibility: LookControl | null = null;
  let roomSummary: LookControl | null = null;
  let roomDialog: LookDialog | null = null;
  let roomLookKey = '';

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
    const self = you.spectator ? undefined : room.players.find((p) => p.id === you.playerId);
    const watching = !!you.spectator;
    selfReady = !!self?.ready;
    roomTitle.replaceChildren(roomIcon(room.symbol, room.color), `${modeName(room.gameMode, room.rules.mayhem > 0)} · ${matchTypeName(room.mode)}${room.locked ? ' 🔒' : ''}`);
    roomCode.textContent = room.id;
    privateTag.hidden = room.visibility !== 'private';
    copyInvite.hidden = !canCopyInvite(room.locked, you.host);
    copyPassword.hidden = !(you.host && room.locked && hostPassword);
    const teamGame = room.mode === 'team';
    const inTeam = (k: number) => room.players.filter((p) => p.team === k).length;
    const teamsReady = !teamGame || (inTeam(0) > 0 && inTeam(1) > 0);
    const crowd = room.spectators ?? [];
    stands.hidden = !crowd.length;
    stands.textContent = crowd.length ? t('multiplayer.standsList', { n: crowd.length, max: GALLERY.MAX_SPECTATORS, names: crowd.map((s) => s.name).join(', ') }) : '';
    watchNote.hidden = !watching;
    roomAvatar.hidden = watching;
    ready.hidden = watching || you.host;
    roomCount.textContent = `${room.players.length}/${room.maxPlayers} ${t('multiplayer.players')}`;
    resetTeams.hidden = !(teamGame && you.host);
    teamWarning.hidden = teamsReady;
    const people = room.players.filter((p) => p.cpu === null).length;
    const cpus = room.players.length - people;
    cpuOnlyNote.hidden = !(cpus > 0 && people < 2);

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
        card.style.setProperty('--slot-tone', COLORS.players[player.id]);
        card.classList.toggle('is-self', mine);
        card.classList.toggle('is-cpu', cpu !== null);
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
        invite.addEventListener('click', () => copyInvite.click());
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
    // The field follows the relay's name when that changes, so a refused name stays in the field to be corrected.
    if (self && self.name !== syncedName) {
      syncedName = self.name;
      roomPlayerName.value = self.name;
    }
    roomAvatarPicker.show(self?.avatar ?? prefs.avatar);
    if (!watching) roomAvatarPicker.el.style.setProperty('--tone', COLORS.players[you.playerId]);

    // The look is rebuilt only when the room or the host changes, so an open dialog keeps its state between updates.
    const lookId = `${room.id}|${you.host}`;
    if (lookId !== roomLookKey) {
      roomLookKey = lookId;
      roomVisibility = visibilityControl(lookOf(room), changeRoomLook, { readonly: !you.host, sound });
      // Only the host changes the look. The others see the room's colour and symbol in its title, so they get no summary.
      roomSummary = you.host ? lookSummary(lookOf(room), () => roomDialog?.open()) : null;
      roomDialog?.close();
      roomDialog = you.host ? lookDialog(lookOf(room), changeRoomLook, { sound }) : null;
      roomLookSlot.replaceChildren(roomSummary ? h('div.lobby__look-row', null, roomVisibility.el, roomSummary.el) : roomVisibility.el);
    }
    roomVisibility?.refresh(lookOf(room));
    roomSummary?.refresh(lookOf(room));
    roomDialog?.refresh(lookOf(room));

    // The sliders live as long as the room does: rebuilding them at every update would drop the one being dragged.
    const key = `${room.id}|${room.gameMode}|${room.rules.mayhem > 0}|${you.host}`;
    if (key !== formKey) {
      formKey = key;
      draft = null;
      form = rulesForm(room.gameMode, roomSource(room), app, !you.host, room.rules.mayhem > 0);
      roomRuleFields.replaceChildren(form.el);
    }
    // What the host is in the middle of changing wins over the room's last word for a moment.
    if (Date.now() - touched > 1000 && !sendTimer) draft = null;
    form?.refresh();

    rulesNote.textContent = you.host ? t('multiplayer.rulesResetNote') : `🔒 ${t('multiplayer.hostRules')}`;
    rulesNote.classList.toggle('is-locked', !you.host);
    roomNote.textContent = room.gameMode === 'horizon' ? t('multiplayer.horizonNote') : '';
    roomNote.hidden = !roomNote.textContent;
    ready.textContent = self?.ready ? t('multiplayer.unready') : t('multiplayer.ready');
    ready.classList.toggle('lobby__button--primary', !you.host && !watching && !self?.ready);
    start.hidden = !you.host;
    // Everybody but the host must be ready; the host's click is its own "ready". CPUs are always ready, but a game needs a second person.
    const guestsReady = room.players.every((p) => p.id === 0 || p.ready);
    start.disabled = people < 2 || !guestsReady || !teamsReady;
    const hint = people < 2 ? t('multiplayer.startNeedHuman') : !guestsReady ? t('multiplayer.startNeedReady') : !teamsReady ? t('multiplayer.teamsNeedPlayers') : '';
    startHint.textContent = you.host ? hint : '';
    startHint.hidden = !you.host || !hint;
    start.classList.toggle('lobby__button--primary', you.host);
  };

  // ————————————————————————————— Rendering —————————————————————————————

  // Each lobby page is a child of Online. Leaving an active room remains a separate action.
  const backButton = button(t('flow.onlineBack'));
  const footerActions = h('div.items.items--row.menu-page__actions.lobby__actions', null, backButton, createButton, ready, start, leave);
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

  const root = menuPage({
    title: t(({ rooms: 'flow.find', create: 'flow.create', code: 'flow.code' } as const)[view]), eyebrow: t('launcher.online'), intro: t(({ rooms: 'flow.findHint', create: 'flow.createIntro', code: 'flow.codeIntro' } as const)[view]), className: 'menu-page--lobby menu-page--mode-enter-next',
    headerTitle: onlineHeader,
    body: [h('div.lobby', null, bar, connectSlot, roomsView, codeView, createView, roomView, status)], footer: footerActions, keys: t('flow.tabKeys'),
  });
  const page = root.querySelector<HTMLElement>('.menu-page')!;
  const eyebrow = root.querySelector<HTMLElement>('.menu-page__head .eyebrow')!;
  const heading = onlineHeading;
  const introduction = root.querySelector<HTMLElement>('.menu-page__intro')!;
  let pendingContentDirection: OnlineSectionDirection | null = null;
  const paintOnlineSectionNav = (inRoom: boolean): void => {
    const index = ONLINE_SECTIONS.indexOf(view);
    const orderedSections = ONLINE_SECTIONS.map((_, distance) => ONLINE_SECTIONS[(index + distance) % ONLINE_SECTIONS.length]);
    onlineSectionButtons.forEach((item, distance) => {
      const section = orderedSections[distance];
      const selected = distance === 0;
      item.className = `item mode-pager__item mode-pager__item--${section} mode-pager__item--${selected ? 'active' : distance === 1 ? 'near' : 'far'}`;
      item.textContent = t(ONLINE_SECTION_TITLE[section]);
      item.dataset.view = section;
      if (selected) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    });
    const visible = !inRoom;
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
  const animateContentState = (inRoom: boolean): void => {
    const state = inRoom ? 'room' : view === 'create' ? `create-${createStep}` : view;
    if (lastContentState !== null && state !== lastContentState) {
      const order: Record<string, number> = { rooms: 0, 'create-mode': 1, 'create-setup': 1, code: 2 };
      const from = order[lastContentState];
      const to = order[state];
      const forward = from === undefined || to === undefined ? 0 : (to - from + ONLINE_SECTIONS.length) % ONLINE_SECTIONS.length;
      const direction = pendingContentDirection ?? (forward <= 1 ? 'next' : 'previous');
      animateOnlineCarousel(direction);
      page.classList.remove('menu-page--mode-enter-next', 'menu-page--mode-enter-previous');
      void page.offsetWidth;
      page.classList.add(`menu-page--mode-enter-${direction}`);
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
    const createSetup = !room && view === 'create' && createStep === 'setup';
    const title = room ? room.name : view === 'create'
      ? createSetup ? prefs.rules.mayhem > 0 ? t('mode.mayhem') : modeName(prefs.gameMode) : t('launcher.choose')
      : t(({ rooms: 'flow.find', code: 'flow.code' } as const)[view]);
    heading.textContent = !room && !createSetup ? t(ONLINE_SECTION_TITLE[view]) : title;
    root.setAttribute('aria-label', title);
    eyebrow.textContent = room ? `${t('launcher.online')} · ${t('multiplayer.roomNumber', { n: room.number })}` : createSetup ? t('launcher.prepare') : t('launcher.online');
    introduction.textContent = room ? t('shell.roomIntro') : view === 'create'
      ? createSetup ? t((prefs.rules.mayhem > 0 ? 'mode.mayhem.hint' : `mode.${prefs.gameMode}.hint`) as Key) : t('flow.createIntro')
      : t(({ rooms: 'flow.findHint', code: 'flow.codeIntro' } as const)[view]);
    page.classList.toggle('menu-page--create-setup', createSetup);
    page.classList.toggle('menu-page--room', !!room);
    profileLabel.textContent = playerName.value.trim() || t('multiplayer.name');
    profileAvatar.replaceChildren(avatarSvg(prefs.avatar));
    connectionLabel.textContent = t(connected ? 'flow.connected' : 'flow.connection');
    connectionServer.textContent = connected && !configuredServer ? (session.client.address || prefs.server).replace(/^wss?:\/\//, '') : '';
    connectionServer.hidden = !connectionServer.textContent;
    connection.classList.toggle('is-connected', connected);
    backButton.textContent = t(createSetup ? 'common.back' : view === 'create' && createFromRooms ? 'flow.roomsBack' : 'flow.onlineBack');
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
    const idle = hosted ? '' : t('multiplayer.connectHint');
    const notice = session.passwordNotice || session.notice === codeNotice ? null : session.notice && relayText(session.notice);
    const message = localMessage ?? notice ?? inviteNote ?? (connecting ? (hosted ? '' : t('multiplayer.connecting')) : !connected ? idle : '');
    status.textContent = message;
    status.classList.toggle('is-busy', connecting);
    status.hidden = !message;

    connectView.hidden = connected || (hosted && !retry);
    connectSlot.hidden = connected || !!room;
    codeView.hidden = !(browsing && view === 'code');
    roomsView.hidden = !(browsing && view === 'rooms');
    createView.hidden = !(browsing && view === 'create');
    createModeView.hidden = createStep !== 'mode';
    createSetupView.hidden = createStep !== 'setup';
    roomView.hidden = !room;
    bar.hidden = !!room;
    backButton.hidden = !!room;
    createButton.hidden = !(browsing && view === 'create' && createStep === 'setup');
    leave.hidden = !room;
    if (!room) {
      ready.hidden = true;
      start.hidden = true;
    }
    paintOnlineSectionNav(!!room);
    animateContentState(!!room);
    if (room) return renderRoom(room);
    // Out of the room the next one starts from scratch.
    formKey = '';
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
    save();
    render();
  };

  const focusOnlineSection = (): void => {
    if (onlineSectionViewport.hidden) heading.focus({ preventScroll: true });
    else onlineSectionButtons.find((item) => item.classList.contains('mode-pager__item--active'))?.focus({ preventScroll: true });
  };
  const show = (next: View, preserveCreateStep = false) => {
    view = next;
    if (next === 'create' && !preserveCreateStep) createStep = 'mode';
    localMessage = null;
    render();
    root.querySelector<HTMLElement>('.menu-page__body')!.scrollTop = 0;
    focusOnlineSection();
  };
  const enter = (next: View, preserveCreateStep = false) => {
    show(next, preserveCreateStep);
    if (!session.connected && !session.connecting) void connect(false);
  };
  const navigateOnlineSection = (next: View, direction: OnlineSectionDirection): void => {
    if (next === view) return;
    pendingContentDirection = direction;
    enter(next, true);
  };
  onlineSectionButtons.forEach((item) => item.addEventListener('click', () => {
    const next = item.dataset.view as View | undefined;
    if (next) navigateOnlineSection(next, 'next');
  }));
  const handleOnlineSectionKey = (event: KeyboardEvent): void => {
    if (!root.isConnected || onlineSectionViewport.hidden || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target;
    if (!(target instanceof Element) || target.closest('input, select, textarea, [contenteditable]:not([contenteditable="false"])')) return;
    const key = event.key.toLowerCase();
    const shortcut = key === 'q' || key === 'e';
    if (!shortcut && (!target.closest('.online-section-pager') || (key !== 'arrowleft' && key !== 'arrowright'))) return;
    event.preventDefault();
    event.stopPropagation();
    const direction: OnlineSectionDirection = key === 'arrowright' || key === 'e' ? 'next' : 'previous';
    const index = ONLINE_SECTIONS.indexOf(view);
    const next = ONLINE_SECTIONS[(index + (direction === 'next' ? 1 : -1) + ONLINE_SECTIONS.length) % ONLINE_SECTIONS.length];
    navigateOnlineSection(next, direction);
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
    const direction: OnlineSectionDirection = dx < 0 ? 'next' : 'previous';
    const index = ONLINE_SECTIONS.indexOf(view);
    const next = ONLINE_SECTIONS[(index + (direction === 'next' ? 1 : -1) + ONLINE_SECTIONS.length) % ONLINE_SECTIONS.length];
    event.preventDefault();
    navigateOnlineSection(next, direction);
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
    if (!session.room && view === 'create' && createStep === 'setup') {
      createStep = 'mode';
      render();
      root.querySelector<HTMLElement>('.menu-page__body')!.scrollTop = 0;
      focusOnlineSection();
      return;
    }
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
            if (self) {
              roomDetails.open = true;
              queueMicrotask(() => roomPlayerName.focus());
            } else {
              profile.open = true;
              queueMicrotask(() => playerName.focus());
            }
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
      render();
      // Reconnect to a previously used relay. A different relay named by an invite requires an explicit click.
      // Deferred until the screen is in the DOM — the session's updates only reach a mounted screen.
      const mayAutoConnect = shouldAutoConnectInvite(invited, prefs.server) && (prefs.autoConnect || !!invited);
      if (!session.connected && !session.connecting && !session.room && (configuredServer || mayAutoConnect)) setTimeout(() => void connect(true), 0);
      focusOnlineSection();
      return root;
    },
    items: [],
    dispose: () => {
      document.removeEventListener('keydown', handleOnlineSectionKey, true);
      unsubscribe?.();
      unsubscribe = null;
      if (sendTimer) {
        clearTimeout(sendTimer);
        sendTimer = undefined;
        if (draft) session.setRules(draft);
      }
      roomDialog?.close();
    },
    // Escape closes an open look dialog first, and only then leaves the lobby.
    onEscape: () => {
      if (createDialog.isOpen()) { createDialog.close(); return true; }
      if (roomDialog?.isOpen()) { roomDialog.close(); return true; }
      if (app.menu.depth === 1) { goBack(); return true; }
      return false;
    },
  };
}
