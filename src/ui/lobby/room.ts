import { COLORS, GALLERY, TEAMS } from '../../config';
import { t } from '../../i18n';
import { canCopyInvite, inviteLink } from '../../invite';
import type { MultiplayerSession } from '../../multiplayer';
import type { RoomInfo, RoomMode } from '../../net';
import type { RoomLook, RoomVisibility } from '../../roomLook';
import { optionSelector, segmentedControl, type Control } from '../controls';
import { playerIcon } from '../avatars';
import { h } from '../menu';
import { lookDialog, roomIcon, type LookDialog } from '../roomLook';
import type { App } from '../screens';
import { teamRoster, type RosterCard } from '../team-roster';
import type { Briefing } from './briefing';
import { button, CPU_LEVELS, ICON_CLOSE, ICON_COPY, ICON_KEY, ICON_LINK, iconButton, lockIcon, lookOf, matchTypeName } from './widgets';

/** What the room needs of the lobby around it. */
export interface RoomContext {
  app: App;
  session: MultiplayerSession;
  /** The game and rules: the host sets them up here, everybody else sees them locked. */
  briefing: Briefing;
  /** The relay address is not the player's to share: the build was given one. */
  configuredServer: boolean;
  copyText(text: string, what: string, target: HTMLElement): Promise<void>;
  /** The player is leaving the room. */
  onLeave(): void;
}

export interface RoomView {
  /** The room: its code and switches, the players, and the briefing. */
  el: HTMLElement;
  /** The room's buttons, which sit in the footer. */
  startHint: HTMLElement;
  ready: HTMLButtonElement;
  start: HTMLButtonElement;
  leave: HTMLButtonElement;
  /** Shows the room as the relay describes it. */
  render(room: RoomInfo): void;
  /** The password the host set, which they can copy and put in the invite link, until they leave. */
  setHostPassword(password: string): void;
  /** Out of the room: the host's password and the dialog for the room's look are gone. */
  leaveRoom(): void;
  dialogOpen(): boolean;
  closeDialog(): void;
  dispose(): void;
}

/** The room a player is in while it waits: its code and switches, the seats, and the briefing of the game. */
export function createRoomView({ app, session, briefing, configuredServer, copyText, onLeave }: RoomContext): RoomView {
  const sound = app.menu.sound;
  /** The password the player set for the room they opened; it is shown to the host to share, until they leave. */
  let hostPassword = '';
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
  leave.addEventListener('click', () => {
    onLeave();
    session.leaveRoom();
  });
  /** What the room is about: the host picks the game and its rules here, everybody else reads them. */
  const roomBriefing = h('div.room-deck__briefing', null, briefing.el);
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
    if (!you.host) briefing.follow(room);
    briefing.setRulesLabel(t(you.host ? 'briefing.editRules' : 'shell.roomRules'));
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

  return {
    el: roomView,
    startHint,
    ready,
    start,
    leave,
    render: renderRoom,
    setHostPassword: (password) => { hostPassword = password; },
    leaveRoom: () => {
      hostPassword = '';
      roomLookKey = '';
      roomDialog?.close();
      roomDialog = null;
    },
    dialogOpen: () => !!roomDialog?.isOpen(),
    closeDialog: () => roomDialog?.close(),
    dispose: () => roomDialog?.close(),
  };
}
