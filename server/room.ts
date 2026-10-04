import { randomBytes } from 'node:crypto';

export type RoomMode = 'ffa' | 'team';
export type GameMode = 'classic' | 'horizon';
export type RoomStatus = 'waiting' | 'playing';

export interface ClientConnection {
  send(message: unknown): void;
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
  maxPlayers: number;
  status: RoomStatus;
  players: Player[];
  nextPlayerId: number;
  nextJoinOrder: number;
  lastStateSeq: number;
}

interface Membership {
  room: Room;
  player: Player;
}

interface LobbyRoom {
  id: string;
  mode: RoomMode;
  gameMode: GameMode;
  players: number;
  maxPlayers: number;
}

const MAX_ROOM_PLAYERS = 6;

export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly connections = new Set<ClientConnection>();
  private readonly memberships = new Map<ClientConnection, Membership>();

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
    const membership = this.memberships.get(connection);
    if (!membership) return;
    this.memberships.delete(connection);

    const { room, player } = membership;
    if (player.id === 0 || room.status === 'playing') {
      this.closeRoom(room, player.id === 0 ? 'Room host disconnected; room closed' : 'A player disconnected; room closed');
      this.broadcastLobby();
      return;
    }
    this.removePlayer(room, player);
    if (room.players.length === 0) {
      this.rooms.delete(room.id);
    } else {
      this.broadcastRoomUpdate(room);
    }
    this.broadcastLobby();
  }

  private createRoom(connection: ClientConnection, message: Record<string, unknown>): void {
    if (this.memberships.has(connection)) {
      this.error(connection, 'Leave your current room before creating another');
      return;
    }
    if (typeof message.name !== 'string' || !message.name.trim()) {
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

    const room: Room = {
      id: this.newRoomId(),
      mode: message.mode,
      gameMode: message.gameMode,
      maxPlayers: message.maxPlayers as number,
      status: 'waiting',
      players: [],
      nextPlayerId: 0,
      nextJoinOrder: 0,
      lastStateSeq: -1,
    };
    this.rooms.set(room.id, room);
    this.addPlayer(room, connection, message.name);
    this.broadcastRoomUpdate(room);
    this.broadcastLobby();
  }

  private joinRoom(connection: ClientConnection, message: Record<string, unknown>): void {
    if (this.memberships.has(connection)) {
      this.error(connection, 'Leave your current room before joining another');
      return;
    }
    if (typeof message.roomId !== 'string' || typeof message.name !== 'string' || !message.name.trim()) {
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

    this.addPlayer(room, connection, message.name);
    this.broadcastRoomUpdate(room);
    this.broadcastLobby();
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
    if (!Number.isSafeInteger(message.seq) || (message.seq as number) < 0 || !Object.hasOwn(message, 'snapshot') || !Array.isArray(message.events) || !message.events.every(isGameEvent)) {
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
    const relayed = { type: 'state', seq, snapshot: message.snapshot, events: message.events };
    for (const player of room.players) {
      if (player.connection !== connection) player.connection.send(relayed);
    }
  }

  private leaveRoom(connection: ClientConnection): void {
    const membership = this.memberships.get(connection);
    if (!membership) {
      this.error(connection, 'You are not in a room');
      return;
    }
    this.memberships.delete(connection);
    const { room, player } = membership;
    if (player.id === 0 || room.status === 'playing') {
      this.closeRoom(room, player.id === 0 ? 'Room host left; room closed' : 'A player left; room closed');
      this.broadcastLobby();
      return;
    }
    this.removePlayer(room, player);
    if (room.players.length === 0) this.rooms.delete(room.id);
    else this.broadcastRoomUpdate(room);
    this.broadcastLobby();
  }

  private addPlayer(room: Room, connection: ClientConnection, name: string): void {
    const player: Player = {
      id: room.nextPlayerId++,
      name: name.trim(),
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
    // Waiting-room IDs must stay contiguous because they become game player indexes.
    room.players.forEach((remaining, id) => {
      remaining.id = id;
      remaining.team = room.mode === 'team' ? (id % 2) as 0 | 1 : 0;
      this.memberships.set(remaining.connection, { room, player: remaining });
    });
    room.nextPlayerId = room.players.length;
    room.nextJoinOrder = room.players.length;
  }

  private closeRoom(room: Room, message: string): void {
    this.rooms.delete(room.id);
    for (const player of room.players) {
      this.memberships.delete(player.connection);
      if (player.id !== 0) this.error(player.connection, message);
    }
  }

  private broadcastRoomUpdate(room: Room): void {
    const roomInfo = {
      id: room.id,
      mode: room.mode,
      gameMode: room.gameMode,
      maxPlayers: room.maxPlayers,
      status: room.status,
      players: room.players.map(({ id, name, ready, team }) => ({ id, name, ready, team })),
    };
    for (const player of room.players) {
      player.connection.send({
        type: 'room_update',
        room: roomInfo,
        you: { playerId: player.id, host: player.id === 0 },
      });
    }
  }

  private sendLobby(connection: ClientConnection): void {
    connection.send({ type: 'lobby_update', rooms: this.visibleRooms() });
  }

  private broadcastLobby(): void {
    const message = { type: 'lobby_update', rooms: this.visibleRooms() };
    for (const connection of this.connections) connection.send(message);
  }

  private visibleRooms(): LobbyRoom[] {
    return Array.from(this.rooms.values())
      .filter((room) => room.status === 'waiting')
      .map((room) => ({ id: room.id, mode: room.mode, gameMode: room.gameMode, players: room.players.length, maxPlayers: room.maxPlayers }));
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isInputMessage(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  switch (value.kind) {
    case 'adjust':
      return isFiniteNumber(value.dAngle) && isFiniteNumber(value.dPower);
    case 'aim':
      return isFiniteNumber(value.angle) && isFiniteNumber(value.power);
    case 'fire':
    case 'advance':
      return true;
    default:
      return false;
  }
}

function isGameEvent(value: unknown): boolean {
  if (!isRecord(value) || typeof value.type !== 'string') return false;
  switch (value.type) {
    case 'round':
    case 'gameOver':
    case 'roundEnd':
    case 'volley':
    case 'collapse':
      return true;
    case 'killcam':
      return typeof value.active === 'boolean' && typeof value.recording === 'boolean';
    case 'turn':
    case 'lock':
      return Number.isSafeInteger(value.player) && (value.player as number) >= 0;
    case 'fire':
      return Number.isSafeInteger(value.player) && (value.player as number) >= 0 &&
        isFiniteNumber(value.x) && isFiniteNumber(value.y) && isFiniteNumber(value.angle) && isFiniteNumber(value.power);
    case 'impact':
      return Number.isSafeInteger(value.player) && (value.player as number) >= 0 && isFiniteNumber(value.x) && isFiniteNumber(value.y);
    case 'explode':
      return isFiniteNumber(value.x) && isFiniteNumber(value.y) && Number.isSafeInteger(value.ship) && (value.ship as number) >= 0;
    case 'fizzle':
      return Number.isSafeInteger(value.player) && (value.player as number) >= 0 && isFiniteNumber(value.x) && isFiniteNumber(value.y) && typeof value.lost === 'boolean';
    case 'clash':
      return isFiniteNumber(value.x) && isFiniteNumber(value.y) && Array.isArray(value.players) && value.players.length === 2 && value.players.every((id) => Number.isSafeInteger(id) && id >= 0);
    case 'devour':
      return isFiniteNumber(value.x) && isFiniteNumber(value.y) && isFiniteNumber(value.toX) && isFiniteNumber(value.toY) && typeof value.color === 'string';
    case 'style':
      return Number.isSafeInteger(value.player) && (value.player as number) >= 0 && typeof value.kind === 'string' && isFiniteNumber(value.x) && isFiniteNumber(value.y);
    case 'kill':
      return isRecord(value.record);
    default:
      return false;
  }
}
