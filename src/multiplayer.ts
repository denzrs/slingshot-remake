import { MAX_PLAYERS } from './config';
import { ClassicMatch, createMatch, HorizonMatch, type GameEvent } from './game';
import type { ClassicSnapshot } from './game/classic';
import type { HorizonSnapshot } from './game/horizon';
import { NetworkClient, type ClientInput, type LobbyRoom, type NetworkGameMode, type RoomInfo, type RoomMode, type RoomRules, type ServerMessage } from './net';
import { defaultRoomRules } from './lobbyPrefs';
import { SnapshotDecoder, SnapshotEncoder } from './netsync';
import type { Seat, Settings } from './settings';

export type NetMatch = ClassicMatch | HorizonMatch;

type GameStart = Extract<ServerMessage, { type: 'game_start' }>;

export interface SessionHooks {
  settings(): Settings;
  /** A match began (as host or guest): show the play screen. */
  matchStarted(match: NetMatch): void;
  /** The host started the next game of the room while the result screen was up. */
  matchRestarted(): void;
  /** The match is over for this client (host left, game aborted, connection lost): back to the lobby. */
  matchEnded(): void;
}

export interface CreateRoomOptions {
  name: string;
  mode: RoomMode;
  gameMode: NetworkGameMode;
  rules: RoomRules;
  maxPlayers: number;
  password?: string;
}

export const DEFAULT_SERVER = 'ws://localhost:8080';

/** What the session needs from a connection — the WebSocket client, or a stand-in in tests. */
export type Transport = Pick<NetworkClient, 'address' | 'setAddress' | 'connect' | 'onMessage' | 'send' | 'close'>;

/** The host sends the match state this often; the guest sends its aim at the same rate. */
const SYNC_INTERVAL = 1 / 30;

/**
 * One online session: the connection, the lobby/room state, and — while a game runs — the sync
 * between the host (who simulates) and the guests (who mirror the host's state and send inputs).
 * It outlives individual matches, so leaving a game puts you back into the lobby, still connected.
 */
export class MultiplayerSession {
  readonly client: Transport;
  connected = false;
  /** A connection attempt is under way. */
  connecting = false;
  rooms: LobbyRoom[] = [];
  room: RoomInfo | null = null;
  you = { playerId: 0, host: false };
  /** The last thing worth telling the player (server errors, "host left", …). */
  notice: string | null = null;
  match: NetMatch | null = null;

  private readonly listeners = new Set<() => void>();
  private readonly pendingEvents: GameEvent[] = [];
  private encoder = new SnapshotEncoder();
  private decoder = new SnapshotDecoder();
  private seq = 0;
  private lastSeq = -1;
  private syncElapsed = 0;
  private aimDirty = false;

  constructor(
    private readonly hooks: SessionHooks,
    client: Transport = new NetworkClient(DEFAULT_SERVER),
  ) {
    this.client = client;
    this.client.onMessage((message) => this.receive(message));
  }

  get isHost(): boolean {
    return this.you.host;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ————————————————————————————— Lobby —————————————————————————————

  async connect(address: string): Promise<void> {
    this.connecting = true;
    this.emit();
    try {
      this.client.setAddress(address);
      await this.client.connect();
    } finally {
      this.connecting = false;
    }
    this.connected = true;
    this.notice = null;
    this.send({ type: 'lobby' });
    this.emit();
  }

  createRoom(options: CreateRoomOptions): void {
    this.send({ type: 'create_room', ...options, password: options.password || undefined });
  }

  joinRoom(roomId: string, name: string, password?: string): void {
    this.send({ type: 'join_room', roomId, name, password: password || undefined });
  }

  setReady(ready: boolean): void {
    this.send({ type: 'ready', ready });
  }

  /** Host only: change the rules of the waiting room. */
  setRules(rules: RoomRules): void {
    this.send({ type: 'set_rules', rules });
  }

  startGame(): void {
    this.send({ type: 'start_game' });
  }

  /** Leave the room (and any running game) but stay connected to the lobby. */
  leaveRoom(): void {
    if (this.room) this.send({ type: 'leave_room' });
    this.room = null;
    this.rooms = [];
    this.notice = null;
    this.dropMatch();
    this.emit();
  }

  disconnect(): void {
    this.client.close();
    this.connected = false;
    this.room = null;
    this.rooms = [];
    this.notice = null;
    this.dropMatch();
    this.emit();
  }

  // ————————————————————————————— Playing —————————————————————————————

  /** A local aim/fire input. The host applies it directly; a guest applies it optimistically and tells the host. */
  input(input: ClientInput): void {
    const match = this.match;
    if (!match) return;
    const id = this.you.playerId;
    if (this.isHost) {
      this.applyInput(match, id, input);
      return;
    }
    if (input.kind === 'adjust' || input.kind === 'aim') {
      // Move our own aim at once instead of waiting for the host's round trip; it is sent in the next sync tick.
      if (!match.canAim(id)) return;
      this.applyInput(match, id, input);
      this.aimDirty = true;
      return;
    }
    this.flushAim();
    this.send({ type: 'input', input });
  }

  /** Next round or rematch: the host's call alone, everybody else follows its state. The killcam is put to a vote. */
  advance(): void {
    if (!this.match) return;
    if (this.match.phase === 'killcam') this.input({ kind: 'skip' });
    else if (this.isHost) this.match.advance();
  }

  /** Call every frame while an online match is on screen. */
  update(dt: number): void {
    const match = this.match;
    if (!match) return;
    if (!this.isHost) match.extrapolate(dt);
    this.syncElapsed += dt;
    if (this.syncElapsed < SYNC_INTERVAL) return;
    this.syncElapsed %= SYNC_INTERVAL;
    if (this.isHost) {
      const events = this.pendingEvents.splice(0);
      this.send({ type: 'state', seq: ++this.seq, patch: this.encoder.encode(match.snapshot()), events });
    } else {
      this.flushAim();
    }
  }

  // ————————————————————————————— Messages —————————————————————————————

  private receive(message: ServerMessage): void {
    switch (message.type) {
      case 'lobby_update':
        this.rooms = message.rooms;
        break;
      case 'room_update':
        this.room = message.room;
        this.you = message.you;
        this.notice = message.notice ?? null;
        // The room went back to waiting under a running game (somebody left): the game is over.
        if (this.match && message.room.status === 'waiting') this.endMatch();
        break;
      case 'game_start':
        this.startMatch(message);
        break;
      case 'input':
        if (this.match && this.isHost) this.applyInput(this.match, message.from, message.input);
        break;
      case 'state':
        this.applyState(message);
        break;
      case 'room_closed':
        this.room = null;
        this.notice = message.message;
        if (this.match) this.endMatch();
        break;
      case 'error':
        this.notice = message.message;
        break;
      case 'closed':
        this.connected = false;
        this.room = null;
        this.rooms = [];
        this.notice = message.message;
        if (this.match) this.endMatch();
        break;
    }
    this.emit();
  }

  private startMatch(message: GameStart): void {
    const base = this.hooks.settings();
    const seats: Seat[] = Array.from({ length: MAX_PLAYERS }, (_, i) => (i < message.players.length ? 'human' : 'off'));
    // The room's rules decide, not whatever this player has set up for offline games: from this device only
    // the display settings (lines, particles, sound, language) carry over.
    const settings: Settings = {
      ...base,
      ...defaultRoomRules(),
      ...message.rules,
      seats,
      seatTeams: [...base.seatTeams],
      teamMode: message.mode === 'team' ? 2 : 0,
    };
    const match = createMatch(message.gameMode, settings, {
      seats,
      names: message.players.map((p) => p.name),
      teams: message.mode === 'team' ? message.players.map((p) => p.team) : undefined,
      simultaneous: message.gameMode === 'horizon' || settings.simultaneousShots,
    });
    if (!(match instanceof ClassicMatch || match instanceof HorizonMatch)) return;
    match.viewer = this.you.playerId;
    match.canAdvance = this.isHost;

    this.resetSync();
    this.match = match;
    if (this.isHost) match.on((event) => this.pendingEvents.push(event));
    this.hooks.matchStarted(match);
  }

  private applyInput(match: NetMatch, id: number, input: ClientInput): void {
    if (input.kind === 'adjust') match.adjustPlayer(id, input.dAngle, input.dPower);
    else if (input.kind === 'aim') match.setPlayerAim(id, input.angle, input.power);
    else if (input.kind === 'fire') match.commitPlayer(id);
    else match.voteSkip(id);
  }

  private applyState(message: Extract<ServerMessage, { type: 'state' }>): void {
    const match = this.match;
    if (!match || this.isHost || message.seq <= this.lastSeq) return;
    this.lastSeq = message.seq;
    const snapshot = this.decoder.apply(message.patch);
    if (!snapshot) return;

    // Our own aim is ahead of the host's copy; don't let a snapshot drag the crosshair back.
    const id = this.you.playerId;
    const own = match.canAim(id) ? { angle: match.players[id].angle, power: match.players[id].power } : null;
    const previousPhase = match.phase;
    match.restoreSnapshot(snapshot as unknown as ClassicSnapshot & HorizonSnapshot);
    if (own && match.canAim(id)) Object.assign(match.players[id], own);
    for (const event of message.events) match.applyRemoteEvent(event);
    if (previousPhase === 'gameOver' && match.phase !== 'gameOver') this.hooks.matchRestarted();
  }

  private flushAim(): void {
    const match = this.match;
    if (!match || !this.aimDirty) return;
    this.aimDirty = false;
    const player = match.players[this.you.playerId];
    this.send({ type: 'input', input: { kind: 'aim', angle: player.angle, power: player.power } });
  }

  // ————————————————————————————— Plumbing —————————————————————————————

  private endMatch(): void {
    this.dropMatch();
    this.hooks.matchEnded();
  }

  private dropMatch(): void {
    this.match = null;
    this.resetSync();
  }

  private resetSync(): void {
    this.encoder = new SnapshotEncoder();
    this.decoder = new SnapshotDecoder();
    this.pendingEvents.length = 0;
    this.seq = 0;
    this.lastSeq = -1;
    this.syncElapsed = 0;
    this.aimDirty = false;
  }

  private send(message: Parameters<Transport['send']>[0]): void {
    try {
      this.client.send(message);
    } catch {
      // The transport reports a dead connection with a 'closed' message.
    }
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener();
  }
}
