import type { ReplayTurn } from './game/replay';
import type { Avatar } from './avatars';
import type { GameEvent } from './game';
import type { StatePatch } from './netsync';
import type { RoomColor, RoomLook, RoomSymbol } from './roomLook';
import type { RoundReport, TurnReport } from './roundReport';
import type { Settings } from './settings';
import { packWireMessage, unpackWireMessage } from './messagepack';
import { withBrowserId } from './browserId';

export type RoomMode = 'ffa' | 'team';
export type NetworkGameMode = 'classic' | 'solar' | 'horizon';
/** The level of a CPU seat in an online room: the same CPUs as offline. */
export type NetworkCpuLevel = 'easy' | 'medium' | 'hard' | 'hawking';

/** The rules of an online game; a subset of the local `Settings`, so it can be spread straight into them. */
export type RoomRules = Pick<Settings, 'rounds' | 'maxPlanets' | 'invisiblePlanets' | 'bounce' | 'fixedPower' | 'fixedPowerLevel' | 'maxPower' | 'shotTime' | 'styleBonuses' | 'neighborGrace' | 'simultaneousShots' | 'killcam' | 'hiddenAim' | 'fadingTrails' | 'mayhem' | 'betting' | 'chatPlayersOnly' | 'powerUps' | 'powerUpKinds' | 'powerUpAmount'>;

export type ClientInput =
  | { kind: 'adjust'; dAngle: number; dPower: number }
  | { kind: 'aim'; angle: number; power: number }
  | { kind: 'fire' }
  /** The power-up key: opens or closes a teleport's aim, or arms a preview, armor piercing or a plasma shot. */
  | { kind: 'power' }
  /** Esc while a teleport is being aimed. */
  | { kind: 'cancel' }
  /** A vote to skip the killcam; it ends once half of the players want that. */
  | { kind: 'skip' }
  /** The host asks to skip the round: a vote the host's own yes opens. Nobody scores in a skipped round. */
  | { kind: 'skipRound' }
  /** An answer to the open vote to skip the round. */
  | { kind: 'skipVote'; yes: boolean }
  /** An eliminated player's oracle tip: a ship's index, -1 for nobody, or 1/0 for hit/miss. With `round` it names the winner of the round instead, and `stake` bets that many of the player's points on it. A spectator's only input: a bet on the round, with a stake. */
  | { kind: 'bet'; pick: number; round?: boolean; stake?: number };

type ClientMessage =
  | { type: 'lobby' }
  | ({ type: 'create_room'; name: string; roomName?: string; mode: RoomMode; gameMode: NetworkGameMode; rules: RoomRules; maxPlayers: number; password?: string; avatar?: Avatar } & Partial<RoomLook>)
  /** `spectate` takes a place in the stands instead of a seat: it works for a running game of a public room without a password, too. */
  | { type: 'join_room'; roomId: string; name: string; password?: string; avatar?: Avatar; spectate?: boolean }
  /** Your symbol in the game, while the room waits. */
  | { type: 'set_avatar'; avatar: Avatar }
  /** Your name, while the room waits; the relay refuses one it will not carry. */
  | { type: 'set_name'; name: string }
  | { type: 'ready'; ready: boolean }
  /** `gameMode` changes the game the rules are for; without it the room keeps its own. */
  | { type: 'set_rules'; rules: RoomRules; gameMode?: NetworkGameMode }
  /** Host only, while waiting: how the room shows up in the lobby. */
  | { type: 'set_room'; look: RoomLook }
  /** Host only, while waiting: free for all or teams; the players are dealt out to the teams and confirm again. */
  | { type: 'set_mode'; mode: RoomMode }
  /** Pick your own team (team rooms, while waiting); you have to be ready again afterwards. */
  | { type: 'set_team'; team: 0 | 1 }
  /** Host only: deal everybody back out to the two teams in the order they joined. */
  | { type: 'reset_teams' }
  /** Host only, while waiting: seat a CPU, in the team given (team rooms; the smaller team if none). */
  | { type: 'add_cpu'; level: NetworkCpuLevel; team?: 0 | 1 }
  /** Host only, while waiting: change a CPU seat's level (and with it its name) or its team. */
  | { type: 'set_cpu'; playerId: number; level?: NetworkCpuLevel; team?: 0 | 1 }
  /** Host only, while waiting: take a CPU seat away. */
  | { type: 'remove_cpu'; playerId: number }
  | { type: 'start_game' }
  | { type: 'input'; input: ClientInput }
  | { type: 'state'; seq: number; patch: StatePatch; events: GameEvent[] }
  /** Host only: how a round went, for the relay's short-lived, pseudonymised statistics. */
  | ({ type: 'round_stats' } & RoundReport)
  /** Host only: the shots of a turn that has just been flown, and the scores after them. */
  | ({ type: 'turn_stats' } & TurnReport)
  /** Post a daily-challenge run to the day's leaderboard; the board comes back either way. */
  | { type: 'daily_submit'; day: string; name: string; score: number }
  /** Look at a day's leaderboard without posting anything. */
  | { type: 'daily_top'; day: string }
  /** The numbers behind the stats page: the totals of every day, and the latest games. */
  | { type: 'stats_overview' }
  | { type: 'stats_facts' }
  /** A game played on this device, told to the relay when it is over: its rounds and nothing to fly it again with. */
  | ({ type: 'local_game' } & LocalGameReport)
  /** One game from the statistics, to fly it again: what it took is kept for games whose host logged it. */
  | { type: 'stats_replay'; id: string }
  /** Something to say to everybody in the room. The relay cleans it and stars out profanity. */
  | { type: 'chat'; text: string }
  | { type: 'leave_room' }
  /** A new connection asks for the seat that `token` was given for, after the old connection dropped. */
  | { type: 'resume'; token: string };

/** One finding of the statistics, for the menu: what it is about and the numbers its sentence is made of. */
export interface StatsFact {
  id: string;
  values: number[];
}

/** What the oracle's tips and bets came to on the relay. */
export interface StatsBetting {
  shotTips: number;
  shotRight: number;
  roundTips: number;
  roundRight: number;
  /** Right tips against the crowd. */
  underdogs: number;
  /** Tips from the stands. */
  stands: number;
  /** Round tips with points on them, the points staked and paid back, the bets that paid more than the stake. */
  bets: number;
  staked: number;
  paid: number;
  won: number;
  biggestWin: number;
  biggestStake: number;
}

/** One day of the stats heatmap: UTC date, and what happened on it. */
export interface StatsDay {
  day: string;
  rounds: number;
  /** People who played, counted once per day. */
  players: number;
  /** What the shots earned, summed. */
  points: number;
}

/** One game of the stats table: its rounds taken together. */
export interface StatsGame {
  id: string;
  /** Unix seconds of its first reported round. */
  at: number;
  gameMode: NetworkGameMode;
  mode: 'ffa' | 'team';
  humans: number;
  cpus: number;
  rounds: number;
  points: number;
  /** Whether the game can be watched again. */
  replay: boolean;
  /** Played on one device and reported when it was over: it has its rounds and nothing more. */
  local: boolean;
}

/** A game played on one device, as the relay is told of it when it is over. */
export interface LocalGameReport {
  gameMode: NetworkGameMode;
  mode: RoomMode;
  rules: RoomRules;
  /** Who sat where: a CPU's level, or null for a person; the team in team games. */
  seats: { cpu: NetworkCpuLevel | null; team: 0 | 1 | null }[];
  /** Every round, as the host of an online game would report it. */
  rounds: RoundReport[];
}

/** A recorded game as the relay hands it over: what it takes to fly it again (see `game/replay.ts`). */
export interface StatsReplay {
  gameMode: NetworkGameMode;
  mode: RoomMode;
  rules: RoomRules;
  seed: number;
  /** Who sat where: a CPU's level, or null for a person; the team in team games. */
  seats: { cpu: NetworkCpuLevel | null; team: 0 | 1 | null }[];
  turns: ReplayTurn[];
  /** The rounds the room skipped by vote. */
  skipped?: number[];
}

/** One run on a daily leaderboard, as the relay ranks it. */
export interface DailyEntry {
  /** Place on the board, 1 = best. */
  rank: number;
  name: string;
  score: number;
}

export interface LobbyRoom {
  id: string;
  /** What the host called the room ("Ada's room" if they didn't). */
  name: string;
  host: string;
  /** The room's number: rooms are told apart by it. */
  number: number;
  symbol: RoomSymbol;
  color: RoomColor;
  mode: RoomMode;
  gameMode: NetworkGameMode;
  /** The room's chaos strength: above 0 it is a Mayhem room, played in `gameMode`. */
  mayhem: number;
  /** Seats taken, CPUs included. */
  players: number;
  /** How many of those seats are CPUs: a human can take one of them when the room is full. */
  cpus: number;
  maxPlayers: number;
  locked: boolean;
  /** A game that is already running is listed when it can be watched. */
  status: 'waiting' | 'playing';
  /** How many people are in the stands. */
  spectators: number;
}

interface RoomPlayer {
  id: number;
  name: string;
  avatar: Avatar;
  /** A CPU is always ready. */
  ready: boolean;
  /** False while a running game holds the seat for a connection that dropped. Absent counts as connected. */
  connected?: boolean;
  team: 0 | 1;
  /** The level of a CPU seat; null for a person. */
  cpu: NetworkCpuLevel | null;
}

export interface RoomInfo extends RoomLook {
  id: string;
  name: string;
  /** The room's number, as the lobby lists it. */
  number: number;
  mode: RoomMode;
  gameMode: NetworkGameMode;
  rules: RoomRules;
  maxPlayers: number;
  status: 'waiting' | 'playing';
  locked: boolean;
  players: RoomPlayer[];
  /** The people in the stands. */
  spectators: { id: number; name: string }[];
}

export type ServerMessage =
  | { type: 'lobby_update'; rooms: LobbyRoom[] }
  | {
      type: 'room_update';
      room: RoomInfo;
      /** In the stands `playerId` is -1 and `spectatorId` names the place; the points of the bets are kept under it. */
      you: { playerId: number; host: boolean; spectator?: boolean; spectatorId?: number; token?: string };
      /** Why the room changed under you, e.g. a running game was ended. */
      notice?: string;
    }
  | {
      type: 'game_start';
      roomId: string;
      mode: RoomMode;
      gameMode: NetworkGameMode;
      rules?: RoomRules;
      hostId: 0;
      seed: number;
      players: Array<{ id: number; name: string; avatar: Avatar; team: 0 | 1; cpu: NetworkCpuLevel | null }>;
    }
  /** To the host: `from` is a player's seat, or — with `spectator` — a place in the stands. */
  | { type: 'input'; from: number; input: ClientInput; spectator?: true }
  /** Somebody said something in the room — `id` is their seat, or their place in the stands (`spectator`). */
  | { type: 'chat'; id: number; spectator: boolean; name: string; text: string }
  /** To the host: someone joined the stands mid-game; the next state frame has to be a complete one. */
  | { type: 'keyframe' }
  | { type: 'state'; seq: number; patch: StatePatch; events: GameEvent[] }
  | {
      type: 'daily_board';
      /** The day the board is for. */
      day: string;
      /** The best runs of that day, best first. */
      entries: DailyEntry[];
      /** Your own run, wherever it sits — null when you have not posted one for that day. */
      you: DailyEntry | null;
    }
  | {
      type: 'stats_overview';
      /** False when the relay keeps no statistics. */
      enabled: boolean;
      /** Every day with games, oldest first. */
      days: StatsDay[];
      /** The same for the games played on one device. */
      localDays: StatsDay[];
      /** The latest games, newest first. */
      games: StatsGame[];
      /** Tips and bets; null while nobody has tipped (and from a relay that does not say). */
      betting?: StatsBetting | null;
    }
  /** One-line findings of the statistics for the menu: an id, and the numbers its wording is made of. */
  | { type: 'stats_facts'; enabled: boolean; facts: StatsFact[] }
  /** `replay` is null when the relay has no such game, or not the whole of it. */
  | { type: 'stats_replay'; id: string; replay: StatsReplay | null }
  | { type: 'room_closed'; message: string }
  /** The seat asked for with `resume` was given up (or never held). */
  | { type: 'resume_failed'; message: string }
  /** `field` names what the error is about, when it is about one thing the player typed. */
  | { type: 'error'; message: string; field?: 'name' | 'password' }
  /** Local only: the connection to the server is gone. */
  | { type: 'closed'; message: string };

const CONNECT_TIMEOUT_MS = 10_000;

/** Why the socket never opened; the lobby says it in the player's language. */
export class ConnectError extends Error {
  constructor(readonly reason: 'unreachable' | 'timeout' | 'closed', readonly url: string, message: string) {
    super(message);
    this.name = 'ConnectError';
  }
}

/** A thin WebSocket transport (it connects again only when asked to) for the lobby and game relay protocol. */
export class NetworkClient {
  private socket: WebSocket | null = null;
  private connectPromise: Promise<void> | null = null;
  private listeners = new Set<(message: ServerMessage) => void>();
  private closed = false;

  constructor(private url: string) {}

  get address(): string {
    return this.url;
  }

  setAddress(url: string): void {
    this.closed = false;
    if (this.socket && (this.socket.readyState === WebSocket.CONNECTING || this.socket.readyState === WebSocket.OPEN)) {
      throw new Error('Cannot change server address while connected');
    }
    this.url = url;
  }

  connect(): Promise<void> {
    if (this.closed) return Promise.reject(new Error('This network client has been closed'));
    if (this.socket?.readyState === WebSocket.OPEN) return Promise.resolve();
    if (this.connectPromise) return this.connectPromise;

    let socket: WebSocket;
    try {
      socket = new WebSocket(withBrowserId(this.url));
      socket.binaryType = 'arraybuffer';
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
    this.socket = socket;
    this.connectPromise = new Promise<void>((resolve, reject) => {

      let settled = false;
      let opened = false;
      const timeout = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        socket.close();
        if (this.socket === socket) {
          this.socket = null;
          this.connectPromise = null;
        }
        reject(new ConnectError('timeout', this.url, `Connection to ${this.url} timed out`));
      }, CONNECT_TIMEOUT_MS);

      socket.addEventListener('open', () => {
        if (settled) return;
        settled = true;
        opened = true;
        window.clearTimeout(timeout);
        this.connectPromise = null;
        resolve();
      });
      socket.addEventListener('error', () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        if (this.socket === socket) this.socket = null;
        if (this.connectPromise) this.connectPromise = null;
        reject(new ConnectError('unreachable', this.url, `Could not connect to ${this.url}. Check the server address and make sure the server is running.`));
      });
      socket.addEventListener('close', () => {
        // A socket that `drop` already gave up on has been reported; its late close says nothing new.
        const current = this.socket === socket;
        if (this.socket === socket) {
          this.socket = null;
          this.connectPromise = null;
        }
        if (!settled) {
          settled = true;
          window.clearTimeout(timeout);
          reject(new ConnectError('closed', this.url, `Connection to ${this.url} closed before it was established`));
        } else if (opened && current && !this.closed) {
          this.deliver({ type: 'closed', message: `Connection to ${this.url} was closed.` });
        }
      });
      socket.addEventListener('message', (event: MessageEvent<unknown>) => {
        this.receive(event.data);
      });
    });

    return this.connectPromise;
  }

  onMessage(listener: (message: ServerMessage) => void): void {
    this.listeners.add(listener);
  }

  send(message: ClientMessage): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error('Cannot send: WebSocket is not connected');
    }
    const bytes = packWireMessage(message);
    // msgpackr returns a Uint8Array backed by an ArrayBuffer; the assertion narrows
    // its broad library type without copying the encoded frame.
    socket.send(bytes as Uint8Array<ArrayBuffer>);
  }

  /**
   * Gives up on the socket without closing the client: for a connection that has gone quiet while
   * the browser still thinks it is open. Tells the listeners, so they can connect again.
   */
  drop(): void {
    const socket = this.socket;
    if (!socket) return;
    this.socket = null;
    this.connectPromise = null;
    const opened = socket.readyState === WebSocket.OPEN;
    try { socket.close(); } catch { /* already gone */ }
    if (opened && !this.closed) this.deliver({ type: 'closed', message: `Connection to ${this.url} was lost.` });
  }

  close(): void {
    this.closed = true;
    const socket = this.socket;
    this.socket = null;
    this.connectPromise = null;
    if (socket && (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN)) {
      socket.close();
    }
  }

  private receive(data: unknown): void {
    let parsed: unknown;
    try {
      if (data instanceof ArrayBuffer) parsed = unpackWireMessage(new Uint8Array(data));
      else if (ArrayBuffer.isView(data)) parsed = unpackWireMessage(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
      else if (data instanceof Blob) throw new Error('Expected binary MessagePack');
      else throw new Error('Expected binary MessagePack');
    } catch {
      this.deliver({ type: 'error', message: 'Received malformed response from the server (expected a MessagePack object).' });
      return;
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      this.deliver({ type: 'error', message: 'Received malformed response from the server (expected a MessagePack object).' });
      return;
    }
    this.deliver(parsed as ServerMessage);
  }

  private deliver(message: ServerMessage): void {
    for (const listener of this.listeners) listener(message);
  }
}
