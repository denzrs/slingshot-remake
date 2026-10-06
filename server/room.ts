import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { DEFAULT_RULES, isGameEvent, isInputMessage, isRecord, parseRules, type RoomRules } from './protocol.js';

export type RoomMode = 'ffa' | 'team';
export type GameMode = 'classic' | 'horizon';
export type RoomStatus = 'waiting' | 'playing';

export interface ClientConnection {
  send(message: unknown): void;
  /** Optional fast path: an already-serialized JSON message (used to fan the host's state out). */
  sendText?(text: string): void;
}

interface Player {
  id: number;
  name: string;
  ready: boolean;
  team: 0 | 1;
  connection: ClientConnection;
}

interface Room {
  id: string;
  mode: RoomMode;
  gameMode: GameMode;
  rules: RoomRules;
  maxPlayers: number;
  status: RoomStatus;
  players: Player[];
  nextPlayerId: number;
  nextJoinOrder: number;
  lastStateSeq: number;
  password: { salt: Buffer; hash: Buffer } | null;
}

interface Membership {
  room: Room;
  player: Player;
}

interface LobbyRoom {
  id: string;
  /** Name of the host, so a room is recognisable without its random id. */
  host: string;
  mode: RoomMode;
  gameMode: GameMode;
  players: number;
  maxPlayers: number;
  locked: boolean;
}

const MAX_ROOM_PLAYERS = 6;
const MAX_NAME_LENGTH = 24;
const MAX_PASSWORD_LENGTH = 64;
const MAX_PASSWORD_ATTEMPTS = 5;

export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly connections = new Set<ClientConnection>();
  private readonly memberships = new Map<ClientConnection, Membership>();
  private readonly passwordFailures = new Map<ClientConnection, number>();

  connect(connection: ClientConnection): void {
    this.connections.add(connection);
    this.sendLobby(connection);
  }

  handle(connection: ClientConnection, message: unknown): void {
    if (!this.connections.has(connection)) return;
    if (!isRecord(message) || typeof message.type !== 'string') {
      this.error(connection, 'Malformed message');
      return;
    }

    switch (message.type) {
      case 'lobby':
        this.sendLobby(connection);
        break;
      case 'create_room':
        this.createRoom(connection, message);
        break;
      case 'join_room':
        this.joinRoom(connection, message);
        break;
      case 'ready':
        this.setReady(connection, message);
        break;
      case 'set_rules':
        this.setRules(connection, message);
        break;
      case 'start_game':
        this.startGame(connection);
        break;
      case 'input':
        this.relayInput(connection, message);
        break;
      case 'state':
        this.relayState(connection, message);
        break;
      case 'leave_room':
        this.leaveRoom(connection);
        break;
      default:
        this.error(connection, `Unknown message type: ${message.type}`);
    }
  }

  disconnect(connection: ClientConnection): void {
    this.connections.delete(connection);
    this.passwordFailures.delete(connection);
    this.removeFromRoom(connection, 'A player disconnected');
  }

  private createRoom(connection: ClientConnection, message: Record<string, unknown>): void {
    if (this.memberships.has(connection)) {
      this.error(connection, 'Leave your current room before creating another');
      return;
    }
    const name = cleanName(message.name);
    if (!name) {
      this.error(connection, 'A non-empty player name is required');
      return;
    }
    if (message.mode !== 'ffa' && message.mode !== 'team') {
      this.error(connection, 'Mode must be ffa or team');
      return;
    }
    if (message.gameMode !== 'classic' && message.gameMode !== 'horizon') {
      this.error(connection, 'gameMode must be classic or horizon');
      return;
    }
    if (!Number.isInteger(message.maxPlayers) || (message.maxPlayers as number) < 2 || (message.maxPlayers as number) > MAX_ROOM_PLAYERS) {
      this.error(connection, 'maxPlayers must be an integer from 2 to 6');
      return;
    }
    if (message.password !== undefined && (typeof message.password !== 'string' || message.password.length > MAX_PASSWORD_LENGTH)) {
      this.error(connection, `The password must be at most ${MAX_PASSWORD_LENGTH} characters`);
      return;
    }

    const rules = message.rules === undefined ? DEFAULT_RULES : parseRules(message.rules);
    if (!rules) {
      this.error(connection, 'Malformed game rules');
      return;
    }

    const room: Room = {
      id: this.newRoomId(),
      mode: message.mode,
      gameMode: message.gameMode,
      rules,
      maxPlayers: message.maxPlayers as number,
      status: 'waiting',
      players: [],
      nextPlayerId: 0,
      nextJoinOrder: 0,
      lastStateSeq: -1,
      password: message.password ? hashPassword(message.password as string) : null,
    };
    this.rooms.set(room.id, room);
    this.addPlayer(room, connection, name);
    this.broadcastRoomUpdate(room);
    this.broadcastLobby();
  }

  private joinRoom(connection: ClientConnection, message: Record<string, unknown>): void {
    if (this.memberships.has(connection)) {
      this.error(connection, 'Leave your current room before joining another');
      return;
    }
    const name = cleanName(message.name);
    if (typeof message.roomId !== 'string' || !name) {
      this.error(connection, 'join_room requires a roomId and non-empty player name');
      return;
    }
    const room = this.rooms.get(message.roomId);
    if (!room || room.status !== 'waiting') {
      this.error(connection, 'Room not found or no longer accepting players');
      return;
    }
    if (room.players.length >= room.maxPlayers) {
      this.error(connection, 'Room is full');
      return;
    }
    if (room.password && !this.passwordMatches(connection, room.password, message.password)) return;

    this.addPlayer(room, connection, name);
    this.broadcastRoomUpdate(room);
    this.broadcastLobby();
  }

  /** Checks a join password; brute-forcing is cut off after a handful of wrong guesses per connection. */
  private passwordMatches(connection: ClientConnection, expected: NonNullable<Room['password']>, given: unknown): boolean {
    const failures = this.passwordFailures.get(connection) ?? 0;
    if (failures >= MAX_PASSWORD_ATTEMPTS) {
      this.error(connection, 'Too many wrong passwords – reconnect to try again');
      return false;
    }
    if (typeof given === 'string' && given.length <= MAX_PASSWORD_LENGTH) {
      const actual = scryptSync(given, expected.salt, expected.hash.length);
      if (timingSafeEqual(actual, expected.hash)) {
        this.passwordFailures.delete(connection);
        return true;
      }
    }
    this.passwordFailures.set(connection, failures + 1);
    this.error(connection, 'Wrong password');
    return false;
  }

  private setReady(connection: ClientConnection, message: Record<string, unknown>): void {
    if (typeof message.ready !== 'boolean') {
      this.error(connection, 'ready must be a boolean');
      return;
    }
    const membership = this.memberships.get(connection);
    if (!membership || membership.room.status !== 'waiting') {
      this.error(connection, 'You are not in a waiting room');
      return;
    }

    membership.player.ready = message.ready;
    const { room } = membership;
    this.broadcastRoomUpdate(room);
    if (room.players.length >= 2 && room.players.every((player) => player.ready)) {
      this.beginGame(room);
    }
  }

  /** The host edits the rules while the room is waiting; everybody has to confirm (ready) again. */
  private setRules(connection: ClientConnection, message: Record<string, unknown>): void {
    const membership = this.memberships.get(connection);
    if (!membership || membership.player.id !== 0) {
      this.error(connection, 'Only the room host can change the rules');
      return;
    }
    const { room } = membership;
    if (room.status !== 'waiting') {
      this.error(connection, 'The rules cannot change while a game is running');
      return;
    }
    const rules = parseRules(message.rules);
    if (!rules) {
      this.error(connection, 'Malformed game rules');
      return;
    }
    room.rules = rules;
    for (const player of room.players) player.ready = false;
    this.broadcastRoomUpdate(room);
  }

  private startGame(connection: ClientConnection): void {
    const membership = this.memberships.get(connection);
    if (!membership || membership.player.id !== 0) {
      this.error(connection, 'Only the room host can start the game');
      return;
    }
    const { room } = membership;
    if (room.status !== 'waiting') {
      this.error(connection, 'Game has already started');
      return;
    }
    if (room.players.length < 2) {
      this.error(connection, 'At least 2 players are required to start');
      return;
    }
    // The host's click counts as its own "ready"; everybody else has to have confirmed.
    if (!room.players.every((player) => player === membership.player || player.ready)) {
      this.error(connection, 'Not everybody is ready yet');
      return;
    }
    this.beginGame(room);
  }

  private beginGame(room: Room): void {
    if (room.status !== 'waiting' || room.players.length < 2) return;
    room.status = 'playing';
    room.lastStateSeq = -1;
    const seed = randomBytes(4).readUInt32BE(0);
    room.players.forEach((player, id) => { player.id = id; });
    const players = room.players.map(({ id, name, team }) => ({ id, name, team }));
    for (const player of room.players) {
      player.connection.send({
        type: 'game_start',
        roomId: room.id,
        mode: room.mode,
        gameMode: room.gameMode,
        rules: room.rules,
        hostId: 0,
        seed,
        players,
      });
    }
    this.broadcastRoomUpdate(room);
    this.broadcastLobby();
  }

  private relayInput(connection: ClientConnection, message: Record<string, unknown>): void {
    const membership = this.memberships.get(connection);
    if (!membership || membership.room.status !== 'playing') {
      this.error(connection, 'You are not in a running game');
      return;
    }
    if (membership.player.id === 0) {
      this.error(connection, 'Host input is not accepted');
      return;
    }
    if (!isInputMessage(message.input)) {
      this.error(connection, 'Malformed input message');
      return;
    }
    const host = membership.room.players.find((player) => player.id === 0);
    if (host) host.connection.send({ type: 'input', from: membership.player.id, input: message.input });
  }

  private relayState(connection: ClientConnection, message: Record<string, unknown>): void {
    const membership = this.memberships.get(connection);
    if (!membership || membership.room.status !== 'playing') {
      this.error(connection, 'You are not in a running game');
      return;
    }
    if (membership.player.id !== 0) {
      this.error(connection, 'Only the room host can send state');
      return;
    }
    if (!Number.isSafeInteger(message.seq) || (message.seq as number) < 0 || !isRecord(message.patch) || !Array.isArray(message.events) || !message.events.every(isGameEvent)) {
      this.error(connection, 'Malformed state message');
      return;
    }
    const room = membership.room;
    const seq = message.seq as number;
    if (seq <= room.lastStateSeq) {
      this.error(connection, 'State sequence must increase monotonically');
      return;
    }
    room.lastStateSeq = seq;
    const text = JSON.stringify({ type: 'state', seq, patch: message.patch, events: message.events });
    for (const player of room.players) {
      if (player.connection === connection) continue;
      if (player.connection.sendText) player.connection.sendText(text);
      else player.connection.send(JSON.parse(text));
    }
  }

  private leaveRoom(connection: ClientConnection): void {
    if (!this.memberships.has(connection)) {
      this.error(connection, 'You are not in a room');
      return;
    }
    this.removeFromRoom(connection, 'A player left');
    this.sendLobby(connection);
  }

  /**
   * Takes a connection out of its room.
   * - The host leaving closes the room; everybody else is sent back to the lobby.
   * - Anyone else leaving a running game aborts that game; the remaining players land in the
   *   waiting room again (the room itself survives).
   */
  private removeFromRoom(connection: ClientConnection, reason: string): void {
    const membership = this.memberships.get(connection);
    if (!membership) return;
    this.memberships.delete(connection);
    const { room, player } = membership;

    if (player.id === 0) {
      this.rooms.delete(room.id);
      for (const other of room.players) {
        if (other === player) continue;
        this.memberships.delete(other.connection);
        other.connection.send({ type: 'room_closed', message: 'The host left the room' });
        this.sendLobby(other.connection);
      }
      this.broadcastLobby();
      return;
    }

    const wasPlaying = room.status === 'playing';
    this.removePlayer(room, player);
    if (wasPlaying) this.resetToWaiting(room);
    this.broadcastRoomUpdate(room, wasPlaying ? `${reason} – the game was ended` : undefined);
    this.broadcastLobby();
  }

  private resetToWaiting(room: Room): void {
    room.status = 'waiting';
    room.lastStateSeq = -1;
    for (const player of room.players) player.ready = false;
  }

  private addPlayer(room: Room, connection: ClientConnection, name: string): void {
    const player: Player = {
      id: room.nextPlayerId++,
      name,
      ready: false,
      team: room.mode === 'team' ? (room.nextJoinOrder++ % 2) as 0 | 1 : 0,
      connection,
    };
    room.players.push(player);
    this.memberships.set(connection, { room, player });
  }

  private removePlayer(room: Room, player: Player): void {
    const index = room.players.indexOf(player);
    if (index !== -1) room.players.splice(index, 1);
    // Room IDs must stay contiguous because they become game player indexes.
    room.players.forEach((remaining, id) => {
      remaining.id = id;
      remaining.team = room.mode === 'team' ? (id % 2) as 0 | 1 : 0;
      this.memberships.set(remaining.connection, { room, player: remaining });
    });
    room.nextPlayerId = room.players.length;
    room.nextJoinOrder = room.players.length;
  }

  private broadcastRoomUpdate(room: Room, notice?: string): void {
    const roomInfo = {
      id: room.id,
      mode: room.mode,
      gameMode: room.gameMode,
      rules: room.rules,
      maxPlayers: room.maxPlayers,
      status: room.status,
      locked: room.password !== null,
      players: room.players.map(({ id, name, ready, team }) => ({ id, name, ready, team })),
    };
    for (const player of room.players) {
      player.connection.send({
        type: 'room_update',
        room: roomInfo,
        you: { playerId: player.id, host: player.id === 0 },
        ...(notice ? { notice } : {}),
      });
    }
  }

  private sendLobby(connection: ClientConnection): void {
    connection.send({ type: 'lobby_update', rooms: this.visibleRooms() });
  }

  private broadcastLobby(): void {
    const message = { type: 'lobby_update', rooms: this.visibleRooms() };
    for (const connection of this.connections) {
      // Players inside a room have no use for the room list.
      if (!this.memberships.has(connection)) connection.send(message);
    }
  }

  private visibleRooms(): LobbyRoom[] {
    return Array.from(this.rooms.values())
      .filter((room) => room.status === 'waiting')
      .map((room) => ({ id: room.id, host: room.players[0]?.name ?? '', mode: room.mode, gameMode: room.gameMode, players: room.players.length, maxPlayers: room.maxPlayers, locked: room.password !== null }));
  }

  private newRoomId(): string {
    let id: string;
    do {
      id = randomBytes(6).toString('base64url');
    } while (this.rooms.has(id));
    return id;
  }

  private error(connection: ClientConnection, message: string): void {
    connection.send({ type: 'error', message });
  }
}

function cleanName(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, MAX_NAME_LENGTH) : '';
}

function hashPassword(password: string): { salt: Buffer; hash: Buffer } {
  const salt = randomBytes(16);
  return { salt, hash: scryptSync(password, salt, 32) };
}
