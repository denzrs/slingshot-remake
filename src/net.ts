import type { GameEvent } from './game';
import type { ClassicSnapshot } from './game/classic';
import type { HorizonSnapshot } from './game/horizon';

export type RoomMode = 'ffa' | 'team';
export type NetworkGameMode = 'classic' | 'horizon';
export type NetworkSnapshot = ClassicSnapshot | HorizonSnapshot;

export type ClientInput =
  | { kind: 'adjust'; dAngle: number; dPower: number }
  | { kind: 'aim'; angle: number; power: number }
  | { kind: 'fire' }
  | { kind: 'advance' };

export type ClientMessage =
  | { type: 'lobby' }
  | { type: 'create_room'; name: string; mode: RoomMode; gameMode: NetworkGameMode; maxPlayers: number }
  | { type: 'join_room'; roomId: string; name: string }
  | { type: 'ready'; ready: boolean }
  | { type: 'start_game' }
  | { type: 'input'; input: ClientInput }
  | { type: 'state'; seq: number; snapshot: NetworkSnapshot; events: GameEvent[] }
  | { type: 'leave_room' };

export interface LobbyRoom {
  id: string;
  mode: RoomMode;
  gameMode: NetworkGameMode;
  players: number;
  maxPlayers: number;
}

export interface RoomPlayer {
  id: number;
  name: string;
  ready: boolean;
  team: 0 | 1;
}

export type ServerMessage =
  | { type: 'lobby_update'; rooms: LobbyRoom[] }
  | {
      type: 'room_update';
      room: {
        id: string;
        mode: RoomMode;
        gameMode: NetworkGameMode;
        maxPlayers: number;
        status: 'waiting' | 'playing';
        players: RoomPlayer[];
      };
      you: { playerId: number; host: boolean };
    }
  | {
      type: 'game_start';
      roomId: string;
      mode: RoomMode;
      gameMode: NetworkGameMode;
      hostId: 0;
      seed: number;
      players: Array<{ id: number; name: string; team: 0 | 1 }>;
    }
  | { type: 'input'; from: number; input: ClientInput }
  | { type: 'state'; seq: number; snapshot: NetworkSnapshot; events: GameEvent[] }
  | { type: 'error'; message: string };

const CONNECT_TIMEOUT_MS = 10_000;

/** A thin, non-reconnecting WebSocket transport for the lobby and game relay protocol. */
export class NetworkClient {
  private socket: WebSocket | null = null;
  private connectPromise: Promise<void> | null = null;
  private listeners = new Set<(message: ServerMessage) => void>();
  private closed = false;

  constructor(private url: string) {}

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
          this.deliver({ type: 'error', message: `Connection to ${this.url} was closed.` });
        }
      });
      socket.addEventListener('message', (event: MessageEvent<unknown>) => this.receive(event.data));
    });

    return this.connectPromise;
  }

  onMessage(listener: (message: ServerMessage) => void): void {
    this.listeners.add(listener);
  }

  send(message: ClientMessage): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('Cannot send: WebSocket is not connected');
    }
    this.socket.send(JSON.stringify(message));
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
      if (typeof data !== 'string') throw new Error('Expected text JSON');
      parsed = JSON.parse(data);
    } catch {
      this.deliver({ type: 'error', message: 'Received malformed response from the server (expected a JSON object).' });
      return;
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      this.deliver({ type: 'error', message: 'Received malformed response from the server (expected a JSON object).' });
      return;
    }
    this.deliver(parsed as ServerMessage);
  }

  private deliver(message: ServerMessage): void {
    for (const listener of this.listeners) listener(message);
  }
}
