import { relayText, t } from '../../platform/i18n';
import { loadLobbyPrefs, saveLobbyPrefs } from '../../data/lobbyPrefs';
import { loadTournamentToken } from '../../data/tournamentToken';
import { DEFAULT_SERVER, isSecureRelay, type MultiplayerSession } from '../../net/multiplayer';
import type { TournamentView } from '../../net/net';
import type { Sound } from '../../platform/audio';
import { cap } from '../../platform/input-device';
import { h, type Screen } from '../menu/menu';
import { menuPage } from '../menu/menu-page';
import { button, ICON_CLOSE, ICON_COPY, iconButton, lockIcon, textInput } from '../lobby/widgets';
import { createConnection } from '../lobby/connection';
import { bracketDepth, bracketSize, bracketView, cupSvg, ownMatch, stageEditable, teamBadge, type BracketContext } from './bracket';
import { stageName } from './setup';
import { stageEditor } from './stage-editor';
import { confirmDialog } from './confirm';
import { nameDialog } from './templates';
import { SECTION_TITLE, SECTIONS, tournamentEntry, type Section } from './entry';
import { arenaView } from './arena';
import { morph } from './morph';
import { saveTemplate } from '../../data/tournamentTemplates';
import type { App } from '../screens';
import { EMBLEMS, type Emblem } from '../../platform/emblems';
import { ROOM_COLORS, type RoomColor } from '../../data/roomLook';
import { EMBLEM_LABEL, emblemSvg, playerIcon } from '../room/avatars';
import { COLOR_LABEL, picker } from '../room/roomLook';
import './tournament.css';

export { keepTournamentTicker } from './ticker';

/** The pages of a tournament you are in, switched with Q and E: the bracket, and the arena where it is played. */
type Inside = 'bracket' | 'arena';
const INSIDE: readonly Inside[] = ['bracket', 'arena'];
const INSIDE_TITLE = { bracket: 'tournament.view.bracket', arena: 'tournament.view.arena' } as const;

/** The menu card's line: where your tournament stands, or what the page is for. */
export function tournamentMenuHint(session: MultiplayerSession | null): string {
  const view = session?.tournament;
  if (!view) return loadTournamentToken() ? t('tournament.menuResume') : t('tournament.menuHint');
  if (view.phase === 'registration') return t('tournament.menuRegistration', { n: view.teams.length });
  if (view.phase === 'finished') return t('tournament.menuFinished');
  const own = ownMatch(view);
  if (!own) return t('tournament.menuOut');
  const stage = stageName(view.bracket!.levels.length - 1 - own.level, view.bracket!.levels.length);
  return own.match.state === 'ready' ? t('tournament.menuReady', { stage }) : t('tournament.menuStage', { stage });
}

/**
 * A knockout tournament online. The bracket is the page: while teams register it grows with them and has free places to found a
 * team in; once it is drawn it shows every match, live ones to watch, and your own when it is ready. A team opens as a dialog.
 */
export function tournamentScreen(app: App, session: MultiplayerSession): Screen {
  const prefs = loadLobbyPrefs(DEFAULT_SERVER);
  const save = () => saveLobbyPrefs(prefs);
  let selectedTeam: number | null = null;
  let creatingAt: string | null = null;
  const seenTeams = new Set<number>();
  let section: Section = 'create';
  let inside: Inside = 'bracket';
  /** The arena's ticker lines up to this time have been shown: newer ones slide in. */
  let tickerSeen = Date.now();
  /** A line of our own in the status, such as a template saved; it gives way to the relay's after a while. */
  let localNotice: string | null = null;
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  const notify = (message: string) => {
    localNotice = message;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { localNotice = null; render(); }, 3500);
    render();
  };

  let lastStatus = '';
  let shownRelay: typeof session.tournamentNotice = null;
  let hiddenRelay: typeof session.tournamentNotice = null;
  let relayTimer: ReturnType<typeof setTimeout> | undefined;
  const status = h('p.lobby__start-hint.t-status', { role: 'status', 'aria-live': 'polite' });
  const editor = stageEditor(app, (stages, game) => stages.forEach((stage) => session.setStage(stage, game)));
  const confirm = confirmDialog();
  const naming = nameDialog();
  const configuredServer = Boolean(import.meta.env.VITE_MULTIPLAYER_SERVER);
  const hosted = configuredServer && isSecureRelay(DEFAULT_SERVER);
  // The name, the symbol and the connection are the online lobby's own, the same module.
  const connection = createConnection({ app, session, prefs, save, configuredServer, hosted, invited: null, render: () => render() });
  const entry = tournamentEntry({ session, takeName: connection.takeName, avatar: () => prefs.avatar, notify, confirm });

  const copy = async (text: string, target: HTMLElement) => {
    try {
      await navigator.clipboard.writeText(text);
      target.classList.add('is-copied');
      setTimeout(() => target.classList.remove('is-copied'), 1400);
    } catch {
      notify(t('multiplayer.copyFailed'));
    }
  };

  // ————————————————————————————— The tournament —————————————————————————————

  const enterMatch = () => session.enterMatch(prefs.avatar);
  /** The first match being played: what "watch live" goes to. */
  const liveMatch = (view: TournamentView) => {
    for (const [level, matches] of (view.bracket?.levels ?? []).entries()) {
      const index = matches.findIndex((m) => m.state === 'playing' && m.room);
      if (index >= 0) return { level, index };
    }
    return null;
  };

  const ctx = (view: TournamentView): BracketContext => ({
    view, selectedTeam, creatingAt, seenTeams,
    selectTeam: (team) => {
      selectedTeam = team;
      render();
    },
    startCreating: (slot) => { creatingAt = slot; render(); },
    cancelCreating: () => { creatingAt = null; render(); },
    createTeam: (teamName, closed, slot) => { creatingAt = null; session.createTeam(teamName, closed, slot); },
    showStage: (stage) => editor.open(stage, view.settings.stages[stage], bracketDepth(view), stageEditable(view, stage)),
    enter: enterMatch,
    watch: (level, index) => session.watchMatch(level, index),
    skip: (level, index, team) => session.skipMatch(level, index, team),
  });

  /** The callout over the bracket when your match waits for you. */
  const callout = (view: TournamentView): HTMLElement | null => {
    const own = ownMatch(view);
    if (!own || own.match.state !== 'ready' || own.match.bye) return null;
    const stage = stageName(view.bracket!.levels.length - 1 - own.level, view.bracket!.levels.length);
    const other = own.match.teams.find((team) => team !== view.you.team);
    const go = button(t('tournament.joinNow'), true);
    go.classList.add('t-callout__go');
    go.addEventListener('click', enterMatch);
    /** A side of the pairing: the team's symbol in its colour, and its name; yours first. */
    const side = (team: number | null | undefined) => {
      const info = team == null ? null : view.teams[team];
      return h(`span.t-callout__team${team === view.you.team ? '.is-mine' : ''}`, null,
        ...(info ? [teamBadge(info)] : []),
        h('span.t-callout__name', null, info?.name ?? '?'));
    };
    return h('div.t-callout', { role: 'alert' },
      h('span.t-callout__pulse', { 'aria-hidden': 'true' }),
      h('div.t-callout__text', null,
        h('span.t-callout__eyebrow', null, `${stage} · ${t('tournament.readyToPlay')}`),
        h('strong.t-callout__title', null, t('tournament.yourMatchReady')),
      ),
      h('div.t-callout__versus', { 'aria-label': t('tournament.calloutVs', { stage, team: other == null ? '?' : view.teams[other].name }) },
        side(view.you.team), h('span.t-callout__vs', { 'aria-hidden': 'true' }, 'vs'), side(other)),
      go,
    );
  };

  const phaseLine = (view: TournamentView): string => {
    if (view.phase === 'registration') return '';
    if (view.phase === 'finished') return '';
    if (view.you.team === null) return '';
    const own = ownMatch(view);
    if (!own) return t('tournament.out');
    const stage = stageName(view.bracket!.levels.length - 1 - own.level, view.bracket!.levels.length);
    return own.match.state === 'waiting' ? t('tournament.waitingFor', { stage }) : t('tournament.underWay', { stage });
  };

  /** The tournament's card beside the pilot's, as the online room has it: the code to share, and the facts at the right. */
  const infoBar = (view: TournamentView) => {
    const copyCode = iconButton(t('tournament.copyCode'), ICON_COPY);
    copyCode.addEventListener('click', () => void copy(view.code, copyCode));
    const hours = Math.floor(view.expiresIn / 3600);
    const minutes = Math.floor((view.expiresIn % 3600) / 60);
    const size = bracketSize(view);
    return h('div.lobby__code.room-info', null,
      h('span.room-info__symbol', { 'aria-hidden': 'true' }, cupSvg()),
      h('div.room-info__share', null,
        h('span.room-info__code', null, h('span.lobby__code-label', null, t('tournament.inviteCode')), h('span.lobby__code-value', null, view.code)),
        copyCode),
      h('span.t-bar__facts', null, [
        t('tournament.versus', { n: view.settings.teamSize }),
        t('tournament.formatLine', { n: size }),
        t('tournament.expires', { h: hours, m: minutes }),
      ].join(' · ')),
    );
  };

  const head = (view: TournamentView) => h('header.t-head', null,
    callout(view) ?? h('p.t-head__phase', phaseLine(view) ? null : { hidden: 'hidden' }, phaseLine(view)),
  );

  /** A member as the room's seats show a player: number, symbol in the team's colour, name and tags. Organizers may make another one. */
  const memberCard = (view: TournamentView, info: TournamentView['teams'][number], id: number, seat: number) => {
    const p = view.people[id];
    const promote = view.you.organizer && !p.organizer && p.connected ? button(t('tournament.promote')) : null;
    promote?.addEventListener('click', () => session.promote(id));
    const card = h('li.slot-card.player-slot', { 'aria-label': p.name },
      h('div.slot-card__head', null,
        h('span.slot-card__number', null, `P${seat + 1}`),
        h('span.slot-card__kind', null, t(p.connected ? 'slots.online' : 'hud.away'))),
      h('div.slot-card__portrait', { 'aria-hidden': 'true' }, playerIcon(p.avatar, info.color)),
      h('div.player-slot__identity', null,
        h('span.lobby__player-name', { title: p.name }, p.name),
        ...(id === view.you.id ? [h('span.lobby__tag', null, t('tournament.you'))] : []),
        ...(p.organizer ? [h('span.lobby__tag.lobby__tag--host', null, t('tournament.organizer'))] : [])),
      ...(promote ? [h('div.player-slot__controls', null, promote)] : []),
    );
    card.style.setProperty('--slot-tone', info.color);
    card.classList.toggle('is-self', id === view.you.id);
    card.classList.toggle('is-away', !p.connected);
    return card;
  };
  const freeCard = (seat: number) => h('li.slot-card.slot-card--empty', null,
    h('div.slot-card__head', null, h('span.slot-card__number', null, `P${seat + 1}`), h('span.slot-card__kind', null, t('slots.free'))),
    h('span.slot-card__waiting', null, t('slots.waiting')));

  /** The team's emblem and colour, with the room's own pickers. */
  const lookPickers = (team: number, emblem: Emblem, color: RoomColor) => {
    const emblems = picker<Emblem>(t('tournament.emblem'),
      EMBLEMS.map((e) => ({ value: e, label: t(EMBLEM_LABEL[e]), face: emblemSvg(e) })), false,
      (e) => session.setTeamLook(team, e, color),
      { row: 8 });
    const colours = picker<RoomColor>(t('tournament.colour'), ROOM_COLORS.map((c) => {
      const swatch = h('span.room-swatch', null);
      swatch.style.background = c;
      return { value: c, label: t(COLOR_LABEL[c]), face: swatch };
    }), false, (c) => session.setTeamLook(team, emblem, c),
    { row: 8 });
    emblems.show(emblem);
    colours.show(color);
    return h('div.t-teamcard__look', null,
      h('p.t-label', null, t('tournament.emblem')), emblems.el,
      h('p.t-label', null, t('tournament.colour')), colours.el);
  };

  /** A team as a card over the page, built like the room's look dialog: its look, its seats, and what you may do with it. */
  const teamCard = (view: TournamentView, team: number) => {
    const info = view.teams[team];
    const mine = view.you.team === team;
    const open = !info.withdrawn && view.phase !== 'finished';
    const actions: HTMLElement[] = [];
    if (mine) {
      const leaveTeam = button(t('tournament.leaveTeam'));
      leaveTeam.addEventListener('click', () => session.leaveTeam());
      actions.push(leaveTeam);
    } else if (open) {
      const teamCode = info.closed ? textInput('', { maxLength: 16, autocomplete: 'off', placeholder: t('tournament.teamCodePlaceholder') }) : null;
      const join = button(t('tournament.joinTeam'), true);
      join.addEventListener('click', () => session.joinTeam(team, teamCode?.value));
      if (teamCode) actions.push(teamCode);
      actions.push(join);
    }
    if (view.you.organizer && open) {
      const remove = button(t('tournament.removeTeam'));
      remove.classList.add('t-remove');
      // Asks twice, as deleting a preset does: the first click turns the button red and pulsing, the second deletes.
      let reset: ReturnType<typeof setTimeout> | undefined;
      remove.addEventListener('click', () => {
        if (!remove.classList.contains('is-confirming')) {
          remove.classList.add('is-confirming');
          remove.textContent = t('tournament.removeSure');
          reset = setTimeout(() => { remove.classList.remove('is-confirming'); remove.textContent = t('tournament.removeTeam'); }, 4000);
          return;
        }
        clearTimeout(reset);
        selectedTeam = null;
        session.removeTeam(team);
      });
      actions.push(remove);
    }
    const members = info.members.filter((id) => !view.people[id]?.gone);
    const seats = Math.max(view.settings.teamSize, members.length);
    const close = iconButton(t('tournament.close'), ICON_CLOSE);
    close.addEventListener('click', () => { selectedTeam = null; render(); });
    const card = h('div.lobby__card.look-dialog__card.t-teamcard', null,
      h('header.t-teamcard__head', null,
        teamBadge(info),
        h('div.t-teamcard__title', null,
          h('p.t-label', null, t('tournament.team'), ...(info.closed ? [lockIcon()] : [])),
          h('h3.t-teamcard__name', null, info.name)),
        close),
      ...(mine && info.code ? [h('p.t-teamcard__code', null, t('tournament.teamCode', { code: info.code }))] : []),
      // Its members, and the organizers, pick what the team shows.
      ...((mine || view.you.organizer) && !info.withdrawn ? [lookPickers(team, info.emblem, info.color)] : []),
      h('p.t-label', null, t('tournament.membersOf', { n: members.length, size: view.settings.teamSize })),
      h('ul.slot-grid.t-teamcard__seats', null,
        ...members.map((id, seat) => memberCard(view, info, id, seat)),
        ...Array.from({ length: seats - members.length }, (_, i) => freeCard(members.length + i))),
      ...(actions.length ? [h('div.lobby__actions.t-teamcard__actions', null, ...actions)] : []),
    );
    card.style.setProperty('--seats', String(seats));
    card.style.setProperty('--tone', info.color);
    return card;
  };

  // ————————————————————————————— Frame —————————————————————————————

  const back = button(t('common.back'));
  back.addEventListener('click', () => (app.menu.depth > 1 ? app.menu.back() : app.toTitle()));
  const leave = button(t('tournament.leave'));
  leave.addEventListener('click', () => confirm.ask({
    title: t('tournament.leaveTitle'), text: '', yes: t('tournament.leave'), no: t('tournament.stay'), danger: true,
  }, () => session.leaveTournament()));
  const keepTemplate = button(t('tournament.saveTemplate'));
  keepTemplate.addEventListener('click', () => {
    const view = session.tournament;
    if (!view) return;
    naming.ask(`${t('tournament.title')} ${view.code}`, (name) => {
      const now = session.tournament?.settings ?? view.settings;
      const saved = saveTemplate({ name, teamSize: now.teamSize, stages: now.stages });
      notify(saved ? t('tournament.templateSaved', { name: saved.name }) : t('tournament.templateSaveFailed'));
    });
  });
  const primary = button('', true);
  primary.classList.add('t-primary');
  let primaryAction: (() => void) | null = null;
  primary.addEventListener('click', () => primaryAction?.());
  /** The load page's upload, beside the primary button. */
  const upload = button(t('tournament.templateUpload'), true);
  upload.hidden = true;
  upload.addEventListener('click', () => entry.upload());

  const main = h('div.t-main', null);

  // The header is the online pages' own: the two ways in as a pager, with the same keys, swipe and entrance.
  const sectionNav = h('nav.items.items--row.mode-pager.online-section-pager.is-positioned', { 'aria-label': t('launcher.online') });
  const sectionButtons = Array.from({ length: Math.max(SECTIONS.length, INSIDE.length) }, () => h('button.item.mode-pager__item', { type: 'button' }) as HTMLButtonElement);
  sectionNav.append(...sectionButtons);
  const sectionViewport = h('div.mode-pager__viewport.online-section-viewport', null, sectionNav);
  const sectionKeys = h('div.mode-pager__keys.online-section-keys', { 'aria-hidden': 'true' }, h('span', null, `‹ (${cap('Q')})`), h('span', null, `(${cap('E')}) ›`));
  const heading = h('h2.menu-page__title.online-view-title', { tabindex: '-1', 'aria-live': 'polite' });
  const header = h('div.mode-carousel.online-section-header', null, sectionViewport, sectionKeys, heading);
  const root = menuPage({
    title: t('tournament.title'), eyebrow: t('launcher.online'), className: 'menu-page--tournament menu-page--lobby menu-page--mode-enter-next',
    headerTitle: header,
    body: [main],
    footer: h('div.items.items--row.menu-page__actions', null, status, back, leave, keepTemplate, upload, primary),
    keys: '',
  });
  /** A team's card over the page: who is in it, how to join it, what it looks like, and for organizers a way to remove it. */
  const teamDialog = h('div.look-dialog.t-teamdialog', { role: 'dialog', 'aria-modal': 'true', hidden: 'hidden' });
  teamDialog.addEventListener('click', (event) => { if (event.target === teamDialog) { selectedTeam = null; render(); } });
  let teamDialogKey = '';
  const paintTeamDialog = (view: TournamentView | null) => {
    if (!view || selectedTeam === null || !view.teams[selectedTeam]) {
      teamDialog.hidden = true;
      teamDialogKey = '';
      return;
    }
    const team = selectedTeam;
    const key = JSON.stringify([team, view.teams[team], view.phase, view.you, view.settings.teamSize, view.people.map((p) => [p.name, p.team, p.organizer, p.connected, p.gone])]);
    teamDialog.hidden = false;
    // Rebuilt only when something it shows changed, so a team code being typed is not wiped by an unrelated update.
    if (key === teamDialogKey) return;
    teamDialogKey = key;
    const typed = teamDialog.querySelector<HTMLInputElement>('input')?.value ?? '';
    teamDialog.setAttribute('aria-label', view.teams[team].name);
    teamDialog.replaceChildren(teamCard(view, team));
    const field = teamDialog.querySelector<HTMLInputElement>('input');
    if (field && typed) field.value = typed;
  };

  root.append(editor.el, confirm.el, naming.el);
  const page = root.querySelector<HTMLElement>('.menu-page')!;
  // Inside the page, so the room's seat cards (styled under `.menu-page`) look as they do in a room.
  page.append(teamDialog);
  const keys = root.querySelector<HTMLElement>('.menu-page__foot .keys')!;
  let enterTimer: ReturnType<typeof setTimeout> | undefined;
  let direction: 'next' | 'previous' = 'next';
  let lastSection: Section | Inside | null = null;
  let swipeStart: { x: number; y: number } | null = null;
  /** The page's entrance animation ends after its 900 ms. */
  const settleEnter = () => {
    clearTimeout(enterTimer);
    enterTimer = setTimeout(() => { page.classList.remove('menu-page--mode-enter-next', 'menu-page--mode-enter-previous'); page.classList.add('menu-page--entered'); }, 900);
  };
  /** The pages Q and E go through: the ways in before you are in a tournament, its bracket and arena once you are. */
  const pager = () => (session.tournament
    ? { pages: INSIDE as readonly (Section | Inside)[], current: inside as Section | Inside, title: (id: Section | Inside) => INSIDE_TITLE[id as Inside] }
    : { pages: SECTIONS as readonly (Section | Inside)[], current: section as Section | Inside, title: (id: Section | Inside) => SECTION_TITLE[id as Section] });
  const paintSections = (visible: boolean) => {
    const { pages, current, title } = pager();
    const index = pages.indexOf(current);
    sectionButtons.forEach((item, distance) => {
      const id = pages[(index + distance) % pages.length];
      item.hidden = distance >= pages.length;
      item.className = `item mode-pager__item mode-pager__item--${id} mode-pager__item--${distance === 0 ? 'active' : distance === 1 ? 'near' : 'far'}`;
      item.textContent = t(title(id));
      item.dataset.view = id;
      if (distance === 0) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    });
    sectionViewport.hidden = !visible;
    sectionKeys.hidden = !visible;
    page.classList.toggle('menu-page--online-carousel-active', visible);
    heading.textContent = t(visible ? title(current) : 'tournament.title');
    if (visible && lastSection !== null && lastSection !== current) {
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        sectionNav.classList.remove('is-positioned');
        sectionNav.style.transform = `translate3d(${direction === 'next' ? 72 : -72}px, 0, 0)`;
        void sectionNav.offsetWidth;
        requestAnimationFrame(() => {
          if (!sectionNav.isConnected) return;
          sectionNav.classList.add('is-positioned');
          sectionNav.style.transform = 'translate3d(0, 0, 0)';
        });
      }
      page.classList.remove('menu-page--mode-enter-next', 'menu-page--mode-enter-previous', 'menu-page--entered');
      void page.offsetWidth;
      page.classList.add(`menu-page--mode-enter-${direction}`);
      settleEnter();
    }
    lastSection = current;
  };
  const goTo = (id: Section | Inside) => {
    // A line of our own belonged to the page it was said on.
    clearTimeout(noticeTimer);
    localNotice = null;
    hiddenRelay = session.tournamentNotice;
    if (session.tournament) inside = id as Inside;
    else section = id as Section;
    render();
  };
  sectionButtons.forEach((item) => item.addEventListener('click', () => {
    const id = item.dataset.view as Section | Inside | undefined;
    if (id && id !== pager().current) { direction = 'next'; goTo(id); }
  }));
  sectionViewport.addEventListener('touchstart', (event: TouchEvent) => {
    swipeStart = event.touches.length === 1 ? { x: event.touches[0].clientX, y: event.touches[0].clientY } : null;
  }, { passive: true });
  sectionViewport.addEventListener('touchend', (event: TouchEvent) => {
    if (!swipeStart || event.changedTouches.length !== 1) { swipeStart = null; return; }
    const dx = event.changedTouches[0].clientX - swipeStart.x;
    const dy = event.changedTouches[0].clientY - swipeStart.y;
    swipeStart = null;
    if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 1.3) return;
    stepSection(dx < 0 ? 1 : -1);
  }, { passive: true });

  const setPrimary = (label: string | null, action: (() => void) | null) => {
    primary.hidden = !label;
    primary.textContent = label ?? '';
    primaryAction = action;
  };

  const stepSection = (step: number) => {
    const { pages, current } = pager();
    direction = step > 0 ? 'next' : 'previous';
    goTo(pages[(pages.indexOf(current) + step + pages.length) % pages.length]);
  };
  /** A dialog over the page keeps the keys to itself. */
  const dialogOpen = () => naming.isOpen() || confirm.isOpen() || editor.isOpen() || creatingAt !== null || selectedTeam !== null;
  const onSectionKey = (event: KeyboardEvent) => {
    if (!root.isConnected || !session.connected || dialogOpen() || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target;
    if (!(target instanceof Element) || target.closest('input, select, textarea, [contenteditable]:not([contenteditable="false"])')) return;
    const key = event.key.toLowerCase();
    if (key !== 'q' && key !== 'e' && !(target.closest('.online-section-pager') && (key === 'arrowleft' || key === 'arrowright'))) return;
    event.preventDefault();
    event.stopPropagation();
    stepSection(key === 'arrowright' || key === 'e' ? 1 : -1);
  };
  const paint = () => {
    const view = session.tournament;
    keys.textContent = t(!view ? 'tournament.keysEntry' : inside === 'arena' ? 'tournament.keysArena' : view.phase === 'registration' ? 'tournament.keysRegistration' : 'tournament.keys');
    leave.hidden = !view;
    if (view) upload.hidden = true;
    keepTemplate.hidden = !view?.you.organizer;
    // The relay's line goes after a few seconds or when the page changes, like our own.
    const relayNotice = session.tournamentNotice;
    if (relayNotice !== shownRelay) {
      shownRelay = relayNotice;
      clearTimeout(relayTimer);
      if (relayNotice) relayTimer = setTimeout(() => { hiddenRelay = relayNotice; render(); }, 3500);
    }
    if (!relayNotice) hiddenRelay = null;
    status.textContent = localNotice ?? (relayNotice && relayNotice !== hiddenRelay ? relayText(relayNotice) : '');
    paintSections(true);
    if (!view) paintTeamDialog(null);
    connection.paint(session.connected, main, page);
    entry.settleJoin(view !== null);
    if (!view) {
      upload.hidden = !(session.connected && section === 'load');
      if (session.connected && section === 'create') setPrimary(t('tournament.createButton'), entry.create);
      else setPrimary(session.connected && section === 'join' ? t('tournament.joinTitle') : null, entry.join);
      const retry = hosted && !session.connected && !session.connecting && (connection.failed || session.notice !== null);
      connection.card.hidden = session.connected || (hosted && !retry) || connection.quiet;
      connection.slot.hidden = session.connected || connection.quiet;
      connection.paintCard(session.connecting);
      if (connection.message && !localNotice) status.textContent = connection.message;
      else if (session.connecting && !hosted) status.textContent = t('multiplayer.connecting');
      main.replaceChildren(h('div.lobby', null, connection.bar, connection.slot, ...(session.connected ? [entry.view(section)] : [])));
      return;
    }
    if (!session.connected) {
      setPrimary(null, null);
      if (session.connecting) status.textContent = t('multiplayer.connecting');
      main.replaceChildren();
      return;
    }
    if (selectedTeam !== null && !view.teams[selectedTeam]) selectedTeam = null;
    paintTeamDialog(view);
    connection.paintCard(session.connecting);
    const bar = h('div.lobby', null, h('div.t-bar', null, connection.bar, infoBar(view)));
    if (inside === 'arena') {
      const arena = arenaView({ view, seenUntil: tickerSeen, enter: enterMatch, watch: (level, index) => session.watchMatch(level, index) });
      const [oldBar, oldHead, oldArena] = Array.from(main.children);
      if (main.children.length === 3 && oldArena.classList.contains('ta')) {
        // Updated in place, so what is running in it (the live dots, the sliding score bars) is not started over by every change.
        oldBar.replaceWith(bar);
        oldHead.replaceWith(head(view));
        morph(oldArena, arena);
      } else main.replaceChildren(bar, head(view), arena);
      tickerSeen = Date.now();
    } else {
      const bracket = bracketView(ctx(view));
      for (const team of view.teams.keys()) seenTeams.add(team);
      main.replaceChildren(bar, head(view), h('div.t-body.t-body--bare', null, h('div.t-bracket', null, bracket)));
    }

    const own = ownMatch(view);
    const live = liveMatch(view);
    if (view.phase === 'registration' && view.you.organizer) setPrimary(t('tournament.start'), () => session.startTournament());
    else if (own && own.match.state === 'ready' && !own.match.bye) setPrimary(t('tournament.joinNow'), enterMatch);
    else if (own && own.match.state === 'playing') setPrimary(t('tournament.watchLive'), enterMatch);
    else if (live) setPrimary(t('tournament.watchLive'), () => session.watchMatch(live.level, live.index));
    else setPrimary(null, null);
  };

  const render = () => {
    // The page is drawn anew on every change; whoever is typing keeps the field they type in, and the bracket its scroll.
    const focused = document.activeElement instanceof HTMLInputElement && root.contains(document.activeElement) ? document.activeElement : null;
    const scroll = root.querySelector('.t-bracket')?.scrollLeft ?? 0;
    const tickerScroll = root.querySelector('.ta-ticker__lines')?.scrollTop ?? 0;
    paint();
    if (focused?.isConnected && document.activeElement !== focused) focused.focus({ preventScroll: true });
    const bracket = root.querySelector('.t-bracket');
    if (bracket) bracket.scrollLeft = scroll;
    const lines = root.querySelector('.ta-ticker__lines');
    if (lines) lines.scrollTop = tickerScroll;
    // The line fades in and out: when it ends it keeps its words until it is gone.
    if (status.textContent) {
      lastStatus = status.textContent;
      status.classList.add('is-shown');
    } else {
      status.textContent = lastStatus;
      status.classList.remove('is-shown');
    }
  };

  // The relay can send several changes within a frame (a whole bracket filling up): the page is drawn once for them.
  let renderFrame = 0;
  const scheduleRender = () => {
    if (renderFrame) return;
    renderFrame = requestAnimationFrame(() => {
      renderFrame = 0;
      if (root.isConnected) render();
    });
  };

  // How long a match has waited counts on by itself between the relay's messages.
  let waitClock: ReturnType<typeof setInterval> | undefined;

  let unsubscribe: (() => void) | null = null;
  return {
    build: () => {
      document.removeEventListener('keydown', onSectionKey, true);
      document.addEventListener('keydown', onSectionKey, true);
      clearInterval(waitClock);
      waitClock = setInterval(() => {
        if (!document.hidden && root.isConnected && root.querySelector('.is-waiting')) scheduleRender();
      }, 1000);
      unsubscribe?.();
      unsubscribe = session.subscribe(() => {
        connection.message = null;
        connection.onSessionUpdate();
        if (!root.isConnected) {
          unsubscribe?.();
          unsubscribe = null;
          return;
        }
        // Your match's room (or its stands) is where the game goes on: the room's page takes over.
        if (session.room) {
          unsubscribe?.();
          unsubscribe = null;
          app.openLobby();
          return;
        }
        scheduleRender();
      });
      render();
      settleEnter();
      const reconnect = !session.connected && !session.connecting && (configuredServer || prefs.autoConnect || !!loadTournamentToken());
      connection.quiet = reconnect;
      if (reconnect) setTimeout(() => void connection.connect(true), 0);
      return root;
    },
    items: [],
    dispose: () => {
      document.removeEventListener('keydown', onSectionKey, true);
      clearTimeout(enterTimer);
      clearTimeout(noticeTimer);
      clearInterval(waitClock);
      cancelAnimationFrame(renderFrame);
      renderFrame = 0;
      unsubscribe?.();
      unsubscribe = null;
    },
    onEscape: () => {
      if (naming.isOpen()) { naming.close(); return true; }
      if (confirm.isOpen()) { confirm.close(); return true; }
      if (editor.isOpen()) { editor.close(); return true; }
      if (creatingAt !== null) { creatingAt = null; render(); return true; }
      if (selectedTeam !== null) { selectedTeam = null; render(); return true; }
      return false;
    },
  };
}

/**
 * "Your match is ready", wherever in the game you are: a sound when your team's match becomes ready to enter, and a mark in the
 * tab's title while it waits for you, so a player in another tab sees it too.
 */
export function watchMatchCalls(session: MultiplayerSession, sound: Pick<Sound, 'select'>): void {
  const plain = document.title;
  let called = false;
  session.subscribe(() => {
    const view = session.tournament;
    const own = view ? ownMatch(view) : null;
    const calling = !!own && own.match.state === 'ready' && !own.match.bye && !session.room;
    if (calling && !called) sound.select();
    called = calling;
    document.title = calling ? `● ${t('tournament.tabReady')} · ${plain}` : plain;
  });
}
