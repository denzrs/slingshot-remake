import { relayText, t, type Key } from '../../platform/i18n';
import { inviteJoinAttempt, readInvite, shouldAutoConnectInvite, withoutInvite, withoutInvitePassword } from '../../net/invite';
import { loadLobbyPrefs, saveLobbyPrefs } from '../../data/lobbyPrefs';
import { DEFAULT_SERVER, isSecureRelay, type MultiplayerSession } from '../../net/multiplayer';
import { GAME_MODES, type GameMode } from '../../sim/modes';
import { h, type Screen } from '../menu/menu';
import type { App } from '../screens';
import { factTicker } from '../stats/facts';
import { menuPage } from '../menu/menu-page';
import { modeName } from '../menu/mode-name';
import { createBriefing } from './briefing';
import { createBrowse } from './browse';
import { createConnection } from './connection';
import { createOpenRoom } from './open-room';
import { createRoomView } from './room';
import { button, flashCopied } from './widgets';

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
 *
 * This is the frame: it holds the page, the pager between the pages and what the player came for (an invite). The
 * connection, the list of rooms, the form to open one and the room itself are the modules beside it.
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
  let view: View = invited ? 'code' : entry ?? 'rooms';
  let lastContentState: string | null = null;
  let createFromRooms = false;

  const status = h('p.lobby__status', { role: 'status', 'aria-live': 'polite' });

  const connection = createConnection({ app, session, prefs, save, configuredServer, hosted, invited, render: () => render() });

  /** Copies a text to the clipboard and says so in the button that asked for it, or says that it could not. Nothing happens for an empty text. */
  const copyText = async (text: string, what: string, target: HTMLElement): Promise<void> => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      flashCopied(target, what);
    } catch {
      connection.message = t('multiplayer.copyFailed');
      render();
    }
  };

  const browse = createBrowse({
    app, session, prefs, invited,
    takeName: connection.takeName,
    onOpenCreate: () => {
      createFromRooms = true;
      enter('create');
    },
  });
  const briefing = createBriefing({ app, session, prefs, save });
  const roomView = createRoomView({ app, session, briefing, configuredServer, copyText, onLeave: () => { view = 'rooms'; } });
  const openRoom = createOpenRoom({
    app, session, prefs, save, copyText,
    playerName: connection.playerName,
    takeName: connection.takeName,
    onCreated: (password) => roomView.setHostPassword(password),
  });
  /** Opening a room and joining one by code share one slot, so the two boxes are the same size whichever shows. */
  const openForms = h('div.online-forms', null, browse.codeView, openRoom.el);
  // A new lobby starts on the mode's first preset, as the local setup does; the pager and the cards change it from there.
  briefing.begin();

  const currentMode = (): GameMode => prefs.gameMode;
  /** The host's pick in the pager: the game starts from that mode's first preset, and the room follows. */
  const setMode = (mode: GameMode, direction: OnlineSectionDirection) => {
    if (mode === currentMode()) return;
    prefs.gameMode = mode;
    briefing.startGame();
    sound.select();
    pendingContentDirection = direction;
    render();
  };

  // ————————————————————————————— Rendering —————————————————————————————

  // Each lobby page is a child of Online. Leaving an active room remains a separate action.
  const backButton = button(t('common.back'));
  const footerActions = h('div.items.items--row.menu-page__actions.lobby__actions', null, h('div.lobby__chat-slot', null), roomView.startHint, backButton, browse.codeJoin, openRoom.createButton, roomView.ready, roomView.start, roomView.leave);
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

  const lobbyEl = h('div.lobby', null, connection.bar, connection.slot, browse.roomsView, openForms, roomView.el, status);
  const root = menuPage({
    title: t(({ rooms: 'flow.find', create: 'flow.create', code: 'flow.code' } as const)[view]), eyebrow: t('launcher.online'), className: 'menu-page--lobby menu-page--mode-enter-next',
    headerTitle: onlineHeader,
    headerAside: factTicker(app.settings.statsTicker),
    body: [lobbyEl], footer: footerActions, keys: t('flow.tabKeys'),
  });
  const page = root.querySelector<HTMLElement>('.menu-page')!;
  const eyebrow = root.querySelector<HTMLElement>('.menu-page__head .eyebrow')!;
  const heading = onlineHeading;
  let pendingContentDirection: OnlineSectionDirection | null = null;
  let enterTimer: ReturnType<typeof setTimeout> | undefined;
  /** The host of a waiting room picks the game in the pager, where everybody else has the online pages. */
  const hostPicking = (): boolean => !!session.room && session.you.host && !session.you.spectator && session.room.status === 'waiting';
  const paintOnlineSectionNav = (inRoom: boolean): void => {
    const picking = hostPicking();
    const entries: { id: string; label: string }[] = picking
      ? GAME_MODES.map((mode) => ({ id: mode, label: t(`mode.${mode}`) }))
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
    page.classList.toggle('menu-page--room', !!room);
    connection.paint(connected, lobbyEl, page);
    const browsing = connected && !room;
    if (room) dropInvite();
    // Whoever followed an invite came here to get into that room, so it is joined for them — no second click.
    // Only a missing player name stops it: then the lobby asks for one and shows the join row as usual.
    const inviteAttempt = inviteJoinAttempt(invited, invitePending, browsing, connection.playerName.value);
    invitePending = inviteAttempt.pending;
    if (inviteAttempt.kind === 'join') {
      prefs.name = inviteAttempt.name!;
      save();
      session.joinRoom(inviteAttempt.roomId!, inviteAttempt.name!, inviteAttempt.password, prefs.avatar);
      inviteNote = null;
    } else if (inviteAttempt.kind === 'name-required') {
      inviteNote = t('multiplayer.nameRequired');
      connection.profile.open = true;
      connection.playerName.focus();
    }
    // The hosted build says nothing about connecting or being connected; its connect card returns only when that failed.
    const retry = hosted && !connected && !connecting && (connection.failed || session.notice !== null);
    connection.card.hidden = connected || (hosted && !retry) || connection.quiet;
    // The code page says what went wrong at its own fields; what is left over from earlier is not its news.
    const ownsNotice = session.passwordNotice !== null || session.notice === browse.codeNotice || (view === 'code' && !room);
    const notice = ownsNotice ? null : session.notice && relayText(session.notice);
    const message = connection.message ?? notice ?? inviteNote ?? (connecting && !hosted ? t('multiplayer.connecting') : '');
    status.textContent = message;
    status.classList.toggle('is-busy', connecting);
    status.hidden = !message || !connection.card.hidden;

    connection.slot.hidden = connected || !!room || connection.quiet;
    browse.codeView.hidden = !(browsing && view === 'code');
    browse.roomsView.hidden = !(browsing && view === 'rooms');
    openRoom.el.hidden = !(browsing && view === 'create');
    openForms.hidden = browse.codeView.hidden && openRoom.el.hidden;
    roomView.el.hidden = !room;
    connection.bar.hidden = !!room && !!session.you.spectator;
    backButton.hidden = !!room;
    openRoom.createButton.hidden = !(browsing && view === 'create');
    browse.codeJoin.hidden = !(browsing && view === 'code');
    roomView.leave.hidden = !room;
    if (!room) {
      roomView.ready.hidden = true;
      roomView.start.hidden = true;
      roomView.startHint.hidden = true;
    }
    paintOnlineSectionNav(!!room);
    animateContentState(!!room);
    if (room) return roomView.render(room);
    // Out of the room the next one starts from scratch, with the rules one had before.
    briefing.leaveRoom();
    roomView.leaveRoom();
    connection.paintCard(connecting);
    browse.renderRooms(open, session.roomListLoaded, !session.roomListLoaded && !!session.notice);
  };

  const focusOnlineSection = (): void => {
    if (onlineSectionViewport.hidden) heading.focus({ preventScroll: true });
    else onlineSectionButtons.find((item) => item.classList.contains('mode-pager__item--active'))?.focus({ preventScroll: true });
  };
  const show = (next: View) => {
    view = next;
    connection.message = null;
    // What the relay said on the page we leave is not news on the next one.
    if (!session.room) session.notice = null;
    render();
    root.querySelector<HTMLElement>('.menu-page__body')!.scrollTop = 0;
    focusOnlineSection();
  };
  const enter = (next: View) => {
    show(next);
    // Whoever disconnected (or never connected) stays offline while paging; the connect card has the button.
    if (!session.connected && !session.connecting && (configuredServer || prefs.autoConnect)) void connection.connect(false);
  };
  const navigateOnlineSection = (next: View, direction: OnlineSectionDirection): void => {
    if (next === view) return;
    pendingContentDirection = direction;
    enter(next);
  };
  onlineSectionButtons.forEach((item) => item.addEventListener('click', () => {
    const mode = item.dataset.mode as GameMode | undefined;
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
      setMode(GAME_MODES[(GAME_MODES.indexOf(currentMode()) + step + GAME_MODES.length) % GAME_MODES.length], direction);
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
        connection.message = null;
        connection.onSessionUpdate();
        browse.onSessionUpdate();
        render();
      });
      // Reconnect to a previously used relay. A different relay named by an invite requires an explicit click.
      // Deferred until the screen is in the DOM — the session's updates only reach a mounted screen.
      const mayAutoConnect = shouldAutoConnectInvite(invited, prefs.server) && (prefs.autoConnect || !!invited);
      const reconnect = !session.connected && !session.connecting && !session.room && (configuredServer || mayAutoConnect);
      connection.quiet = reconnect;
      render();
      enterTimer = setTimeout(() => endEntrance(), 900);
      if (reconnect) setTimeout(() => void connection.connect(true), 0);
      focusOnlineSection();
      return root;
    },
    items: [],
    dispose: () => {
      document.removeEventListener('keydown', handleOnlineSectionKey, true);
      unsubscribe?.();
      unsubscribe = null;
      browse.dispose();
      briefing.dispose();
      roomView.dispose();
    },
    // Escape closes an open look dialog first, and only then leaves the lobby.
    onEscape: () => {
      if (briefing.dialogOpen()) { briefing.closeDialog(); return true; }
      if (openRoom.dialog.isOpen()) { openRoom.dialog.close(); return true; }
      if (roomView.dialogOpen()) { roomView.closeDialog(); return true; }
      if (app.menu.depth === 1) { goBack(); return true; }
      return false;
    },
  };
}
