import { t } from '../platform/i18n';
import { AVATARS, type Avatar } from '../platform/avatars';
import { NetworkClient, type NetworkCpuLevel, type RoomInfo, type ServerMessage, type TournamentView } from '../net/net';
import { botAddress, impersonationUrl } from './impersonate';

/**
 * Pretend players for testing online play alone (dev build, `?debug`). Each is a connection of its own to the relay, so the
 * relay takes it for a person: it joins, gets ready, founds or joins a tournament team and comes to its team's matches. A dev
 * relay (`npm run dev:server`) is told it is a pretend one (`?bot=<level>` on its address) and hands its seat to the game as a
 * CPU of that level, so the host plays it. Another relay takes it for a person in the game too, and its turns never come.
 *
 * A pretend player never hosts, as nobody would run its game: one that would open a tournament match waits for a person
 * to open it, and one left as a room's host leaves.
 */
export class OnlineBot {
  readonly client: NetworkClient;
  readonly avatar: Avatar = AVATARS[Math.floor(Math.random() * AVATARS.length)];
  room: RoomInfo | null = null;
  you: { playerId: number; host: boolean; spectator?: boolean } | null = null;
  /** The seat's token, for a tab to take the seat over with. */
  seatToken: string | null = null;
  /** Its seat and person were taken over by a tab: this connection is left with nothing. */
  takenOver = false;
  tournament: TournamentView | null = null;
  /** The last thing the relay refused, shown beside the bot. */
  notice = '';
  /** What to do once the bot is in a tournament: found a team of its own, or join one. */
  private wantsTeam: 'own' | number | null = null;
  /** The match it asked to enter, so it asks once. */
  private entering: string | null = null;
  private gone = false;

  constructor(readonly name: string, readonly relay: string, readonly level: NetworkCpuLevel, private readonly changed: () => void) {
    this.client = new NetworkClient(botAddress(relay, level));
    this.client.onMessage((message) => this.receive(message));
  }

  async joinRoom(roomId: string): Promise<void> {
    await this.client.connect();
    this.client.send({ type: 'join_room', roomId, name: this.name, avatar: this.avatar });
  }

  async joinTournament(code: string, team: 'own' | number): Promise<void> {
    await this.client.connect();
    this.wantsTeam = team;
    this.client.send({ type: 'tournament_join', code, name: this.name, avatar: this.avatar });
  }

  close(): void {
    this.gone = true;
    this.client.close();
  }

  /** Open a tab that looks through the bot's eyes: it takes the seat and the tournament person over. */
  impersonate(): void {
    const seat = this.room && !this.you?.spectator ? this.seatToken : null;
    const tournament = this.tournament?.you.token ?? null;
    if (!seat && !tournament) return;
    window.open(impersonationUrl({ name: this.name, relay: this.relay, level: this.level, seat, tournament }), '_blank');
    this.takenOver = true;
    this.room = null;
    this.tournament = null;
    this.changed();
  }

  /** Where the bot is, in a few words. */
  where(): string {
    if (this.takenOver) return t('dev.bots.takenOver');
    if (this.gone) return '–';
    const parts: string[] = [];
    const team = this.tournament?.you.team;
    if (this.tournament) parts.push(team == null ? this.tournament.code : `${this.tournament.code} · ${this.tournament.teams[team]?.name}`);
    if (this.room) parts.push(this.you?.spectator ? `${this.room.id} (${t('dev.bots.stands')})` : this.room.id);
    return parts.join(' · ') || '…';
  }

  private send(message: Parameters<NetworkClient['send']>[0]): void {
    try { this.client.send(message); } catch { /* the socket went away; `closed` follows */ }
  }

  private receive(message: ServerMessage): void {
    switch (message.type) {
      case 'room_update':
        if (this.takenOver) return;
        this.room = message.room;
        this.you = message.you;
        if (message.you.token) this.seatToken = message.you.token;
        this.notice = '';
        this.settle();
        break;
      case 'room_closed':
        this.room = null;
        this.you = null;
        this.entering = null;
        break;
      case 'tournament':
        if (this.takenOver) return;
        this.tournament = message;
        this.settleTournament();
        break;
      case 'tournament_left':
      case 'tournament_closed':
        this.tournament = null;
        break;
      case 'error':
        this.notice = message.message;
        break;
      case 'closed':
        this.room = null;
        this.tournament = null;
        this.notice = message.message;
        break;
      default:
        return;
    }
    this.changed();
  }

  /** In a waiting room: ready, as a person would be. Left as its host: out, since nobody would run the game. */
  private settle(): void {
    const room = this.room;
    const you = this.you;
    if (!room || !you || you.spectator) return;
    if (you.host) {
      this.send({ type: 'leave_room' });
      this.room = null;
      this.you = null;
      return;
    }
    const seat = room.players.find((p) => p.id === you.playerId);
    if (room.status === 'waiting' && seat && !seat.ready) this.send({ type: 'ready', ready: true });
  }

  private settleTournament(): void {
    const view = this.tournament;
    if (!view) return;
    if (this.wantsTeam !== null && view.you.team === null) {
      const wanted = this.wantsTeam;
      this.wantsTeam = null;
      if (wanted === 'own') this.send({ type: 'tournament_create_team', name: this.name, closed: false });
      else this.send({ type: 'tournament_join_team', team: wanted });
      return;
    }
    // Its team's match, once a person has opened its room.
    const team = view.you.team;
    if (team === null || this.room || !view.bracket) return;
    view.bracket.levels.forEach((level, l) => level.forEach((m, i) => {
      const key = `${l}-${i}`;
      if (m.teams.includes(team) && m.state === 'ready' && m.room && this.entering !== key) {
        this.entering = key;
        this.send({ type: 'tournament_enter', avatar: this.avatar });
      }
    }));
  }
}

export interface OnlineBotsHost {
  /** The relay the game talks to, and where this page is online now. */
  online(): { relay: string; room: RoomInfo | null; tournament: TournamentView | null } | null;
  /** Starts the tournament this page organizes. */
  startTournament(): void;
}

/** The sizes a simulated tournament can be filled up to. */
const SIMULATED_TEAMS = [4, 8, 16] as const;
/** How long the bots may take to found their teams before the start is given up. */
const SIMULATE_WAIT_MS = 15_000;

const LEVELS: NetworkCpuLevel[] = ['easy', 'medium', 'hard', 'hawking'];

/** The bots' part of the dev panel: a level, what to add, and the bots there are, each with a way out. */
export function mountOnlineBots(panel: HTMLElement, host: OnlineBotsHost): void {
  const bots: OnlineBot[] = [];
  let made = 0;
  const section = document.createElement('div');
  section.className = 'dev-bots';
  const title = document.createElement('div');
  title.className = 'dev-bots__title';
  title.textContent = t('dev.bots.title');
  const level = document.createElement('select');
  for (const name of LEVELS) level.append(new Option(t(`cpu.${name}`), name, name === 'medium', name === 'medium'));
  const actions = document.createElement('div');
  actions.className = 'dev-bots__actions';
  const list = document.createElement('ul');
  list.className = 'dev-bots__list';
  const action = (label: string, run: (bot: OnlineBot, where: NonNullable<ReturnType<OnlineBotsHost['online']>>) => Promise<void>) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', () => {
      const where = host.online();
      if (!where) return;
      made += 1;
      const bot = new OnlineBot(`Bot ${made}`, where.relay, level.value as NetworkCpuLevel, paint);
      bots.push(bot);
      run(bot, where).catch((error: unknown) => {
        bot.notice = error instanceof Error ? error.message : String(error);
        paint();
      });
      paint();
    });
    actions.append(button);
    return button;
  };
  const toRoom = action(t('dev.bots.room'), (bot, where) => bot.joinRoom(where.room!.id));
  const ownTeam = action(t('dev.bots.ownTeam'), (bot, where) => bot.joinTournament(where.tournament!.code, 'own'));
  const myTeam = action(t('dev.bots.myTeam'), (bot, where) => bot.joinTournament(where.tournament!.code, where.tournament!.you.team!));
  // A whole tournament at once: bot teams up to the size picked, then the start. The dev relay plays their matches out.
  const simulateRow = document.createElement('div');
  simulateRow.className = 'dev-bots__simulate';
  const simulateSize = document.createElement('select');
  for (const n of SIMULATED_TEAMS) simulateSize.append(new Option(t('dev.bots.simulateTeams', { n }), String(n), n === 8, n === 8));
  const simulate = document.createElement('button');
  simulate.type = 'button';
  simulate.textContent = t('dev.bots.simulate');
  simulate.title = t('dev.bots.simulateHint');
  let simulating = false;
  simulate.addEventListener('click', () => {
    const where = host.online();
    const tournament = where?.tournament;
    if (!where || !tournament || simulating) return;
    const size = Math.min(Number(simulateSize.value), tournament.settings.maxTeams);
    for (let i = tournament.teams.length; i < size; i++) {
      made += 1;
      const bot = new OnlineBot(`Bot ${made}`, where.relay, level.value as NetworkCpuLevel, paint);
      bots.push(bot);
      bot.joinTournament(tournament.code, 'own').catch((error: unknown) => {
        bot.notice = error instanceof Error ? error.message : String(error);
        paint();
      });
    }
    paint();
    // Started once every team is there, or with whoever came when the bots take too long.
    simulating = true;
    const since = Date.now();
    const wait = setInterval(() => {
      const now = host.online()?.tournament;
      if (!now || now.phase !== 'registration') { clearInterval(wait); simulating = false; return; }
      if (now.teams.length >= size || Date.now() - since > SIMULATE_WAIT_MS) {
        clearInterval(wait);
        simulating = false;
        host.startTournament();
      }
    }, 300);
  });
  simulateRow.append(simulateSize, simulate);
  const clear = document.createElement('button');
  clear.type = 'button';
  clear.textContent = t('dev.bots.clear');
  clear.addEventListener('click', () => {
    for (const bot of bots.splice(0)) bot.close();
    paint();
  });
  section.append(title, level, actions, simulateRow, list, clear);
  panel.append(section);

  function paint(): void {
    list.replaceChildren(...bots.map((bot) => {
      const row = document.createElement('li');
      const text = document.createElement('span');
      text.textContent = `${bot.name} (${t(`cpu.${bot.level}`)}) · ${bot.where()}${bot.notice ? ` – ${bot.notice}` : ''}`;
      const look = document.createElement('button');
      look.type = 'button';
      look.textContent = t('dev.bots.view');
      look.title = t('dev.bots.impersonate');
      look.disabled = bot.takenOver || (!bot.room && !bot.tournament);
      look.addEventListener('click', () => bot.impersonate());
      const out = document.createElement('button');
      out.type = 'button';
      out.textContent = '×';
      out.title = t('dev.bots.remove');
      out.addEventListener('click', () => {
        bot.close();
        bots.splice(bots.indexOf(bot), 1);
        paint();
      });
      row.append(text, look, out);
      return row;
    }));
    clear.hidden = !bots.length;
  }

  // What can be added follows where this page is: a room that waits and is not a tournament's, a tournament still registering, your team.
  const refresh = (): void => {
    const where = host.online();
    const room = where?.room;
    const tournament = where?.tournament;
    toRoom.disabled = !room || room.status !== 'waiting' || !!room.tournament;
    ownTeam.disabled = tournament?.phase !== 'registration';
    myTeam.disabled = !tournament || tournament.phase === 'finished' || tournament.you.team === null;
    simulate.disabled = simulating || tournament?.phase !== 'registration' || !tournament.you.organizer;
  };
  paint();
  refresh();
  setInterval(refresh, 500);
  window.addEventListener('pagehide', () => { for (const bot of bots) bot.close(); });
}
