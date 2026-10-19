import type { Avatar } from './avatars';
import type { GameEvent } from './game';
import type { StatePatch } from './netsync';
import type { RoomColor, RoomLook, RoomSymbol } from './roomLook';
import type { Settings } from './settings';
import { packWireMessage, unpackWireMessage } from './messagepack';

export type RoomMode = 'ffa' | 'team';
export type NetworkGameMode = 'classic' | 'horizon';
/** The level of a CPU seat in an online room: the offline CPUs (the experimental ones are not offered online). */
export type NetworkCpuLevel = 'easy' | 'medium' | 'hard' | 'hawking';

/** The rules of an online game; a subset of the local `Settings`, so it can be spread straight into them. */
export type RoomRules = Pick<Settings, 'rounds' | 'maxPlanets' | 'invisiblePlanets' | 'bounce' | 'fixedPower' | 'fixedPowerLevel' | 'maxPower' | 'shotTime' | 'styleBonuses' | 'neighborGrace' | 'simultaneousShots' | 'hiddenAim' | 'fadingTrails' | 'betting' | 'powerUps' | 'powerUpKinds' | 'powerUpAmount'>;

export type ClientInput =
  | { kind: 'adjust'; dAngle: number; dPower: number }
  | { kind: 'aim'; angle: number; power: number }
  | { kind: 'fire' }
  /** The power-up key: opens or closes a teleport's aim, or arms a preview or a repulse. */
  | { kind: 'power' }
  /** Esc while a teleport is being aimed. */
  | { kind: 'cancel' }
  /** A vote to skip the killcam; it ends once half of the players want that. */
  | { kind: 'skip' }
  /** An eliminated player's oracle tip: a ship's index, -1 for nobody, or 1/0 for hit/miss. With `round` it names the winner of the round instead, and `stake` bets that many of the player's points on it. */
  | { kind: 'bet'; pick: number; round?: boolean; stake?: number };

type ClientMessage =
  | { type: 'lobby' }
  | ({ type: 'create_room'; name: string; mode: RoomMode; gameMode: NetworkGameMode; rules: RoomRules; maxPlayers: number; password?: string; avatar?: Avatar } & Partial<RoomLook>)
  | { type: 'join_room'; roomId: string; name: string; password?: string; avatar?: Avatar }
  /** Your symbol in the game, while the room waits. */
  | { type: 'set_avatar'; avatar: Avatar }
  | { type: 'ready'; ready: boolean }
  | { type: 'set_rules'; rules: RoomRules }
  /** Host only, while waiting: how the room shows up in the lobby. */
  | { type: 'set_room'; look: RoomLook }
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
  /** Post a daily-challenge run to the day's leaderboard; the board comes back either way. */
  | { type: 'daily_submit'; day: string; name: string; score: number }
  /** Look at a day's leaderboard without posting anything. */
  | { type: 'daily_top'; day: string }
  | { type: 'leave_room' };

/** One run on a daily leaderboard, as the relay ranks it. */
export interface DailyEntry {
  /** Place on the board, 1 = best. */
  rank: number;
  name: string;
  score: number;
}

export interface LobbyRoom {
  id: string;
  host: string;
  /** The room's number: rooms are told apart by it. */
  number: number;
  symbol: RoomSymbol;
  color: RoomColor;
  mode: RoomMode;
  gameMode: NetworkGameMode;
  /** Seats taken, CPUs included. */
  players: number;
  /** How many of those seats are CPUs: a human can take one of them when the room is full. */
  cpus: number;
  maxPlayers: number;
  locked: boolean;
}

interface RoomPlayer {
  id: number;
  name: string;
  avatar: Avatar;
  /** A CPU is always ready. */
  ready: boolean;
  team: 0 | 1;
  /** The level of a CPU seat; null for a person. */
  cpu: NetworkCpuLevel | null;
}

export interface RoomInfo extends RoomLook {
  id: string;
  /** The room's number, as the lobby lists it. */
  number: number;
  mode: RoomMode;
  gameMode: NetworkGameMode;
  rules: RoomRules;
  maxPlayers: number;
  status: 'waiting' | 'playing';
  locked: boolean;
  players: RoomPlayer[];
}

export type ServerMessage =
  | { type: 'lobby_update'; rooms: LobbyRoom[] }
  | {
      type: 'room_update';
      room: RoomInfo;
      you: { playerId: number; host: boolean };
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
  | { type: 'input'; from: number; input: ClientInput }
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
  | { type: 'room_closed'; message: string }
  | { type: 'error'; message: string }
  /** Local only: the connection to the server is gone. */
  | { type: 'closed'; message: string };

const CONNECT_TIMEOUT_MS = 10_000;

/** A thin, non-reconnecting WebSocket transport for the lobby and game relay protocol. */
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
      socket = new WebSocket(this.url);
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
        reject(new Error(`Connection to ${this.url} timed out`));
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
        reject(new Error(`Could not connect to ${this.url}. Check the server address and make sure the server is running.`));
      });
      socket.addEventListener('close', () => {
        if (this.socket === socket) {
          this.socket = null;
          this.connectPromise = null;
        }
        if (!settled) {
          settled = true;
          window.clearTimeout(timeout);
          reject(new Error(`Connection to ${this.url} closed before it was established`));
        } else if (opened && !this.closed) {
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
