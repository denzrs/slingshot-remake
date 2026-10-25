import { GALLERY } from '../../sim/config';
import { relayText, t } from '../../platform/i18n';
import type { Invite } from '../../net/invite';
import type { LobbyPrefs } from '../../data/lobbyPrefs';
import type { MultiplayerSession } from '../../net/multiplayer';
import type { LobbyRoom } from '../../net/net';
import { segmentedControl } from '../menu/controls';
import { eyeIcon } from '../dom';
import { h } from '../menu/menu';
import { modeArt } from '../menu/mode-icons';
import { modeName } from '../menu/mode-name';
import { roomIcon } from '../room/roomLook';
import type { App } from '../screens';
import { button, field, lockIcon, matchTypeName, passwordInput, pips, secretField, textInput } from './widgets';

/** What finding a room needs of the lobby around it. */
export interface BrowseContext {
  app: App;
  session: MultiplayerSession;
  prefs: LobbyPrefs;
  /** The invite the page was opened with: its code and password start in the fields. */
  invited: Invite | null;
  /** The player's name, noted as sent; null (with a message) when empty. */
  takeName(): string | null;
  /** The player wants to open a room of their own instead. */
  onOpenCreate(): void;
}

export interface Browse {
  /** The list of open rooms. */
  roomsView: HTMLElement;
  /** The page to join with a code, and the button that does it (it sits in the footer). */
  codeView: HTMLElement;
  codeJoin: HTMLButtonElement;
  /** The relay notice that went under the code already, so the general message does not say it again. */
  readonly codeNotice: string | null;
  /** Shows the rooms, once the relay has listed them (or failed to). */
  renderRooms(open: LobbyRoom[], loaded: boolean, failed: boolean): void;
  /** The relay has answered something: what it said about the code and the passwords. */
  onSessionUpdate(): void;
  dispose(): void;
}

/** Finding a room to join: the list of open rooms, with a button for each, and the page to join one by its code. */
export function createBrowse({ app, session, prefs, invited, takeName, onOpenCreate }: BrowseContext): Browse {
  const sound = app.menu.sound;
  /** Join passwords typed so far, per room — the room list is rebuilt whenever it changes. */
  const joinPasswords = new Map<string, string>();
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
  /** A join by code is waiting for the relay's answer; if that is a refusal, it goes under the code. */
  let codeJoinPending = false;
  /** The relay notice that went under the code already, so the general message does not say it again. */
  let codeNotice: string | null = null;
  /** Whose password the relay is about to judge: it answers a wrong one with an error, and that goes right there. */
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
  openCreate.addEventListener('click', onOpenCreate);

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
  let roomsWereSearching = false;
  let roomsHaveRendered = false;
  let roomsFeedbackTimer: ReturnType<typeof setTimeout> | undefined;
  const retryRooms = button(t('multiplayer.retryRooms'));
  retryRooms.addEventListener('click', () => session.requestRooms());
  const renderRooms = (open: LobbyRoom[], loaded: boolean, failed: boolean) => {
    const key = `${loaded}:${failed}:${JSON.stringify(open)}`;
    if (key === shownRooms) return;
    shownRooms = key;
    const wasSearching = roomsWereSearching;
    roomsWereSearching = !loaded && !failed;
    const shouldFlashResult = (loaded || failed) && (wasSearching || !roomsHaveRendered);
    clearTimeout(roomsFeedbackTimer);
    roomsList.classList.remove('is-found');
    roomsCount.textContent = String(open.length);
    roomsCount.hidden = !loaded || failed;
    const radar = () => h('span.lobby__empty-radar', { 'aria-hidden': 'true' });
    if (open.length) {
      roomsList.replaceChildren(...open.map(roomRow));
      if (loaded && !failed && shouldFlashResult) {
        void roomsList.offsetWidth;
        roomsList.classList.add('is-found');
        roomsFeedbackTimer = setTimeout(() => roomsList.classList.remove('is-found'), 1000);
      }
    } else {
      const empty = failed
        ? h('li.lobby__empty', null, radar(), h('strong', null, t('multiplayer.roomsFailed')), retryRooms)
        : !loaded
          ? h('li.lobby__empty.is-searching', null, radar(), h('strong', null, t('multiplayer.roomsLoading')))
          : h('li.lobby__empty', null, radar(), h('strong', null, t('multiplayer.noRooms')), h('span', null, t('multiplayer.noRoomsHint')));
      if (shouldFlashResult && loaded && !failed) empty.classList.add('is-not-found');
      if (shouldFlashResult && failed) empty.classList.add('is-error');
      roomsList.replaceChildren(empty);
      if (empty.classList.contains('is-not-found') || empty.classList.contains('is-error')) {
        roomsFeedbackTimer = setTimeout(() => empty.classList.remove('is-not-found', 'is-error'), 1000);
      }
    }
    roomsHaveRendered = true;
  };

  return {
    roomsView,
    codeView,
    codeJoin,
    get codeNotice() { return codeNotice; },
    renderRooms,
    onSessionUpdate: () => {
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
    },
    dispose: () => clearTimeout(roomsFeedbackTimer),
  };
}
