import type { GameEvent } from '../game';
import type { ClassicSnapshot } from '../game/classic';
import type { HorizonSnapshot } from '../game/horizon';
import { NetworkClient, type ClientInput, type LobbyRoom, type NetworkCpuLevel, type RoomInfo, type RoomMode, type RoomRules, type ServerMessage } from './net';
import type { GameMode } from '../sim/modes';
import type { RoomLook } from '../data/roomLook';
import type { Avatar } from '../platform/avatars';
import { roundReport, turnReport } from '../game/roundReport';
import { SnapshotDecoder, SnapshotEncoder } from './netsync';
import { netMatch, type NetMatch } from './netMatch';
import type { Settings } from '../data/settings';

/** One line of the room's chat. A `system` line is something the relay said back to this client ("you are writing too fast"). */
export interface ChatLine {
  id: number;
  name: string;
  spectator: boolean;
  text: string;
  system?: boolean;
}

/** The most lines the chat keeps. */
const CHAT_KEEP = 100;
/** What the relay answers a chat message that comes too soon after the last. */
const CHAT_TOO_FAST = 'You are writing too fast';

export type { NetMatch };

type GameStart = Extract<ServerMessage, { type: 'game_start' }>;

interface SessionHooks {
  settings(): Settings;
  /** A match began (as host or guest): show the play screen. */
  matchStarted(match: NetMatch): void;
  /** The host started the next game of the room while the result screen was up. */
  matchRestarted(): void;
  /** The match is over for this client (host left, game aborted, connection lost): back to the lobby. */
  matchEnded(): void;
}

interface CreateRoomOptions {
  name: string;
  /** Blank: the server calls the room "<name>'s room". It refuses profane ones. */
  roomName?: string;
  mode: RoomMode;
  gameMode: GameMode;
  rules: RoomRules;
  maxPlayers: number;
  password?: string;
  /** How the room shows up in the lobby; what is left out takes the default. */
  look?: Partial<RoomLook>;
  /** The symbol the player shows in the game. */
  avatar?: Avatar;
}

export const DEFAULT_SERVER: string = String(import.meta.env?.VITE_MULTIPLAYER_SERVER || 'ws://localhost:8080');

/** Whether an address is a secure relay (`wss://`): the hosted one, which the build connects to on its own. */
export function isSecureRelay(address: string): boolean {
  try {
    return new URL(address).protocol === 'wss:';
  } catch {
    return false;
  }
}

/** What the session needs from a connection — the WebSocket client, or a stand-in in tests. */
export type Transport = Pick<NetworkClient, 'address' | 'setAddress' | 'connect' | 'onMessage' | 'send' | 'close'> & Partial<Pick<NetworkClient, 'drop'>>;

/** How long a dropped connection keeps trying to take its seat back; the relay holds the seat for the same time (plus a sweep). */
const RESUME_WINDOW_MS = 30_000;
const RESUME_RETRY_MS = [250, 500, 1000, 2000, 3000];
/** A guest that hears nothing from the host for this long treats its connection as dead and connects again. */
const SILENCE_LIMIT = 6;
/** How often a host that draws no frames (hidden tab) still sends its state. */
const HEARTBEAT_MS = 1000;

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
  /** The first lobby update after connecting has arrived. An empty list before this is still loading. */
  roomListLoaded = false;
  room: RoomInfo | null = null;
  you: { playerId: number; host: boolean; spectator?: boolean; spectatorId?: number } = { playerId: 0, host: false };
  /** The last thing worth telling the player (server errors, "host left", …). */
  notice: string | null = null;
  /** The notice, when it is the relay refusing the name: it belongs under the name field, not in the general message. */
  private nameError: string | null = null;
  /** The notice, when it is the relay refusing the room password: it belongs at the password field. */
  private passwordError: string | null = null;
  match: NetMatch | null = null;
  /** What has been said in the room you are in. */
  chat: ChatLine[] = [];
  /** Lines ever added to the chat: unlike `chat.length` it keeps counting once the cap is reached. */
  chatTotal = 0;
  private chatRoom: string | null = null;
  /** The connection dropped and the session is trying to take its seat back; the room and the match are kept meanwhile. */
  reconnecting = false;
  /** What lets a new connection take this player's seat back; only seated players have one. */
  private token: string | null = null;
  private reconnectLoop = false;
  private lostAt = 0;
  /** Seconds since the last state frame from the host. */
  private silence = 0;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private lastStateAt = 0;

  get nameNotice(): string | null {
    return this.notice !== null && this.notice === this.nameError ? this.notice : null;
  }

  get passwordNotice(): string | null {
    return this.notice !== null && this.notice === this.passwordError ? this.notice : null;
  }

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
    // Closing the tab on purpose is leaving: say so, or the others wait out the held seat. (A page that only
    // goes into the back/forward cache, `persisted`, may come back and keeps its seat.)
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', (event) => {
        if (!event.persisted && this.room) this.send({ type: 'leave_room' });
      });
    }
  }

  /** Whether you may write in this room's chat: everybody may, unless the host limited it to the players. */
  get canChat(): boolean {
    return !!this.room && !(this.isSpectator && this.room.rules.chatPlayersOnly);
  }

  get isHost(): boolean {
    return this.you.host;
  }

  /** In the stands: watching the room without a seat. */
  get isSpectator(): boolean {
    return !!this.you.spectator;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ————————————————————————————— Lobby —————————————————————————————

  async connect(address: string): Promise<void> {
    this.connecting = true;
    this.roomListLoaded = false;
    this.rooms = [];
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
    const { look = {}, ...room } = options;
    this.nameError = null;
    this.send({ type: 'create_room', ...room, ...look, password: options.password || undefined, roomName: options.roomName?.trim() || undefined });
  }

  /** Host only: how the waiting room shows up in the lobby. Nobody has to confirm again. */
  setRoomLook(look: RoomLook): void {
    this.send({ type: 'set_room', look });
  }

  joinRoom(roomId: string, name: string, password?: string, avatar?: Avatar, spectate = false): void {
    this.nameError = null;
    this.send({ type: 'join_room', roomId, name, password: password || undefined, avatar, ...(spectate ? { spectate } : {}) });
  }

  /** Your symbol in the game, while the room waits. Nobody has to confirm again. */
  setAvatar(avatar: Avatar): void {
    this.send({ type: 'set_avatar', avatar });
  }

  /** Your name in the room, while it waits. The relay answers a refused one with an error notice. */
  setName(name: string): void {
    this.nameError = null;
    this.send({ type: 'set_name', name });
  }

  setReady(ready: boolean): void {
    this.send({ type: 'ready', ready });
  }

  /** Host only: change the rules of the waiting room, and with them the game if one is given. */
  setRules(rules: RoomRules, gameMode?: GameMode): void {
    this.send({ type: 'set_rules', rules, ...(gameMode ? { gameMode } : {}) });
  }

  /** Host only: turn the waiting room into a team room or back into a free for all. */
  setRoomMode(mode: RoomMode): void {
    this.send({ type: 'set_mode', mode });
  }

  /** Pick your own team while the team room waits. */
  setTeam(team: 0 | 1): void {
    this.send({ type: 'set_team', team });
  }

  /** Host only: deal everybody back out to the two teams. */
  resetTeams(): void {
    this.send({ type: 'reset_teams' });
  }

  /** Host only, while the room waits: seat a CPU. Everybody confirms again. */
  addCpu(level: NetworkCpuLevel, team?: 0 | 1): void {
    this.send({ type: 'add_cpu', level, team });
  }

  /** Host only, while the room waits: change a CPU seat's level or team. */
  setCpu(playerId: number, change: { level?: NetworkCpuLevel; team?: 0 | 1 }): void {
    this.send({ type: 'set_cpu', playerId, ...change });
  }

  /** Host only, while the room waits: take a CPU seat away. */
  removeCpu(playerId: number): void {
    this.send({ type: 'remove_cpu', playerId });
  }

  startGame(): void {
    this.send({ type: 'start_game' });
  }

  /** Says something to the room. */
  sendChat(text: string): void {
    const trimmed = text.trim();
    if (trimmed && this.canChat) this.send({ type: 'chat', text: trimmed });
  }

  /** Leave the room (and any running game) but stay connected to the lobby. */
  leaveRoom(): void {
    if (this.room) this.send({ type: 'leave_room' });
    this.forgetSeat();
    this.room = null;
    this.clearChat();
    this.rooms = [];
    this.roomListLoaded = false;
    this.notice = null;
    this.dropMatch();
    this.emit();
  }

  disconnect(): void {
    // Say so: otherwise the relay holds the seat of a running game for a while, in case we come back.
    if (this.room) this.send({ type: 'leave_room' });
    this.forgetSeat();
    this.client.close();
    this.connected = false;
    this.room = null;
    this.clearChat();
    this.rooms = [];
    this.roomListLoaded = false;
    this.notice = null;
    this.dropMatch();
    this.emit();
  }

  /** Ask the relay for a fresh room list after a recoverable list error. */
  requestRooms(): void {
    if (!this.connected || this.room) return;
    this.notice = null;
    this.roomListLoaded = false;
    this.send({ type: 'lobby' });
    this.emit();
  }

  // ————————————————————————————— Playing —————————————————————————————

  /** A local aim/fire input. The host applies it directly; a guest applies it optimistically and tells the host. */
  input(input: ClientInput): void {
    const match = this.match;
    if (!match) return;
    // The stands may bet and nothing else — the same tipping game the shot-down play. Remember the tip on this
    // screen at once; the host judges it from its own copy.
    if (this.isSpectator) {
      if (input.kind === 'bet' && match.placeBet(this.you.spectatorId ?? -1, input.pick, !!input.round, input.stake ?? 0, true)) this.send({ type: 'input', input });
      return;
    }
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
    if (input.kind === 'bet') {
      // Remember the tip on this screen at once; the host judges it from its own copy.
      if (!match.placeBet(id, input.pick, !!input.round, input.stake ?? 0)) return;
    } else {
      this.flushAim();
    }
    this.send({ type: 'input', input });
  }

  /** Next round or rematch: the host's call alone, everybody else follows its state. The killcam is put to a vote. */
  advance(): void {
    if (!this.match || this.isSpectator) return;
    if (this.match.phase === 'killcam') this.input({ kind: 'skip' });
    else if (this.isHost) this.match.advance();
  }

  /** Call every frame while an online match is on screen. */
  update(dt: number): void {
    const match = this.match;
    if (!match) return;
    if (!this.isHost) match.extrapolate(dt);
    // A guest hears the host about 30 times a second. Hearing nothing for long, while the host is still
    // there, means this connection died quietly: connect again instead of waiting for the browser to notice.
    // The stands have no seat to take back, so they are not asked to; a closed socket still ends their visit.
    if (!this.isHost && !this.isSpectator && !this.reconnecting && this.room?.players[0]?.connected !== false) {
      this.silence += dt;
      if (this.silence > SILENCE_LIMIT) {
        this.silence = 0;
        this.client.drop?.();
      }
    }
    this.syncElapsed += dt;
    if (this.syncElapsed < SYNC_INTERVAL) return;
    this.syncElapsed %= SYNC_INTERVAL;
    if (this.isHost) this.sendState(match);
    else this.flushAim();
  }

  /** The host's patch of the game since the last one, with the events in between. */
  private sendState(match: NetMatch): void {
    this.lastStateAt = Date.now();
    const events = this.pendingEvents.splice(0);
    const seq = this.seq + 1;
    try {
      this.send({ type: 'state', seq, patch: this.encoder.encode(match.snapshot()), events });
      this.seq = seq;
    } catch (error) {
      // A failed patch may have advanced the encoder's deltas; restart from a full snapshot.
      this.encoder = new SnapshotEncoder();
      this.pendingEvents.unshift(...events);
      console.error('Could not encode game state', error);
    }
  }

  /**
   * A hidden tab stops drawing frames, so a host in the background would fall silent and every guest would
   * take that for a dead connection. Timers still tick there (about once a second): keep the guests posted.
   */
  private startHeartbeat(match: NetMatch): void {
    this.stopHeartbeat();
    this.heartbeat = setInterval(() => {
      if (this.match === match && Date.now() - this.lastStateAt >= HEARTBEAT_MS) this.sendState(match);
    }, HEARTBEAT_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeat !== null) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  // ————————————————————————————— Messages —————————————————————————————

  private receive(message: ServerMessage): void {
    switch (message.type) {
      case 'lobby_update':
        this.rooms = message.rooms;
        this.roomListLoaded = true;
        break;
      case 'room_update':
        if (message.room.id !== this.chatRoom) {
          // A different room: its talk starts from nothing.
          this.chat = [];
          this.chatTotal = 0;
          this.chatRoom = message.room.id;
        }
        this.room = message.room;
        this.you = message.you;
        this.notice = message.notice ?? null;
        if (message.you.token) this.token = message.you.token;
        if (this.reconnecting) this.resumed();
        // In a game nobody reads the notice ("Anna lost the connection", "Anna is back"): the chat says it.
        if (this.match && message.notice) this.say(message.notice);
        // The room went back to waiting under a running game (somebody left): the game is over.
        if (this.match && message.room.status === 'waiting') this.endMatch();
        // The host keeps the stands' accounts: people come and go, the points stay.
        else if (this.match && this.isHost) this.match.crowdChanged(message.room.spectators ?? []);
        break;
      case 'game_start':
        this.startMatch(message);
        break;
      case 'input':
        if (!this.match || !this.isHost) break;
        if (message.spectator) {
          if (message.input.kind === 'bet') this.match.placeBet(message.from, message.input.pick, !!message.input.round, message.input.stake ?? 0, true);
        } else this.applyInput(this.match, message.from, message.input);
        break;
      case 'keyframe':
        // Somebody came in mid-game and has nothing to apply our patches to: start over with a full one.
        if (this.isHost) this.encoder = new SnapshotEncoder();
        break;
      case 'state':
        this.silence = 0;
        this.applyState(message);
        break;
      case 'chat':
        this.chat = [...this.chat, { id: message.id, name: message.name, spectator: message.spectator, text: message.text }].slice(-CHAT_KEEP);
        this.chatTotal++;
        break;
      case 'room_closed':
        this.forgetSeat();
        this.room = null;
        this.clearChat();
        this.notice = message.message;
        if (this.match) this.endMatch();
        break;
      case 'resume_failed':
        // The seat was given up while we were away: the game is over for us, as it would have been.
        this.forgetSeat();
        this.room = null;
        this.clearChat();
        this.rooms = [];
        this.notice = message.message;
        if (this.match) this.endMatch();
        this.send({ type: 'lobby' });
        break;
      case 'error': {
        // Said in the chat, not in the lobby's status line: "you are writing too fast" is about the chat, and nobody reads the notice in a game.
        const aboutChat = message.message === CHAT_TOO_FAST;
        if (aboutChat || this.match) this.say(message.message);
        if (!(aboutChat && this.room)) this.notice = message.message;
        this.nameError = message.field === 'name' ? message.message : null;
        this.passwordError = message.field === 'password' ? message.message : null;
        break;
      }
      case 'closed':
        this.connected = false;
        // A seated player in a room keeps the room and the match and tries to come back to the seat.
        if (this.token && this.room && !this.isSpectator && this.client.address) {
          if (!this.reconnecting) this.lostAt = Date.now();
          this.reconnecting = true;
          this.silence = 0;
          this.notice = 'Connection lost – reconnecting…';
          void this.reconnect();
          break;
        }
        this.room = null;
        this.clearChat();
        this.rooms = [];
        this.roomListLoaded = false;
        this.notice = message.message;
        if (this.match) this.endMatch();
        break;
    }
    this.emit();
  }

  private startMatch(message: GameStart): void {
    const match = netMatch({ ...message, players: message.players.map((p) => ({ cpu: p.cpu, team: p.team, name: p.name, avatar: p.avatar })) }, this.hooks.settings(), { oracle: true });
    if (!match) return;
    // In the stands there is no ship to be: the match is seen from nowhere in particular.
    match.viewer = this.isSpectator ? null : this.you.playerId;
    match.spectatorId = this.isSpectator ? (this.you.spectatorId ?? null) : null;
    match.canAdvance = this.isHost;
    if (this.isHost) match.crowd.sync(this.room?.spectators ?? []);

    this.resetSync();
    this.match?.dispose();
    this.match = match;
    if (this.isHost) {
      match.on((event) => {
        this.pendingEvents.push(event);
        if (event.type === 'roundEnd') this.send({ type: 'round_stats', ...roundReport(match) });
      });
      match.onTurnEnd(() => this.send({ type: 'turn_stats', ...turnReport(match) }));
      this.startHeartbeat(match);
    }
    this.hooks.matchStarted(match);
  }

  private applyInput(match: NetMatch, id: number, input: ClientInput): void {
    if (input.kind === 'adjust') match.adjustPlayer(id, input.dAngle, input.dPower);
    else if (input.kind === 'aim') match.setPlayerAim(id, input.angle, input.power);
    // The announcement of a Mayhem round is the host's to dismiss; a guest's fire key does nothing until the ships are free.
    else if (input.kind === 'fire') {
      if (!match.revealing || id === this.you.playerId) match.commitPlayer(id);
    }
    else if (input.kind === 'power') match.usePowerUp(id);
    else if (input.kind === 'cancel') match.cancelPlacement(id);
    else if (input.kind === 'bet') match.placeBet(id, input.pick, !!input.round, input.stake ?? 0);
    else if (input.kind === 'skipRound') match.requestSkipRound(id);
    else if (input.kind === 'skipVote') match.voteSkipRound(id, input.yes);
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
    for (const event of message.events) {
      if (!isEventForMatch(event, match.players.length)) continue;
      try {
        match.applyRemoteEvent(event);
      } catch {
        // A malformed remote event must not break the client's render/update loop.
      }
    }
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

  private say(text: string): void {
    this.chat = [...this.chat, { id: -1, name: '', spectator: false, text, system: true }].slice(-CHAT_KEEP);
    this.chatTotal++;
  }

  private forgetSeat(): void {
    this.token = null;
    this.reconnecting = false;
  }

  /** Connects again with growing pauses until the seat is ours or the relay would have given it up. */
  private async reconnect(): Promise<void> {
    if (this.reconnectLoop) return;
    this.reconnectLoop = true;
    try {
      for (let attempt = 0; this.reconnecting && Date.now() - this.lostAt < RESUME_WINDOW_MS; attempt++) {
        try {
          await this.client.connect();
        } catch {
          await new Promise((resolve) => setTimeout(resolve, RESUME_RETRY_MS[Math.min(attempt, RESUME_RETRY_MS.length - 1)]));
          continue;
        }
        if (!this.reconnecting || !this.token) return;
        this.connected = true;
        // The answer is a room update (the seat is back) or `resume_failed`; `reconnecting` stays on until then.
        this.send({ type: 'resume', token: this.token });
        return;
      }
      if (this.reconnecting) this.giveUp();
    } finally {
      this.reconnectLoop = false;
    }
  }

  /** Back in the seat: the host starts its sync over with a complete frame, a guest gets one asked for. */
  private resumed(): void {
    this.reconnecting = false;
    this.silence = 0;
    if (this.isHost) this.encoder = new SnapshotEncoder();
    this.emit();
  }

  /** The relay could not be reached in time: what a lost connection used to mean at once. */
  private giveUp(): void {
    this.forgetSeat();
    this.connected = false;
    this.room = null;
    this.clearChat();
    this.rooms = [];
    this.notice = `Connection to ${this.client.address} was lost.`;
    if (this.match) this.endMatch();
    this.emit();
  }

  private clearChat(): void {
    this.chat = [];
    this.chatTotal = 0;
    this.chatRoom = null;
  }

  private endMatch(): void {
    this.dropMatch();
    this.hooks.matchEnded();
  }

  private dropMatch(): void {
    this.stopHeartbeat();
    this.match?.dispose();
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

function isEventForMatch(event: import('../game').GameEvent, playerCount: number): boolean {
  const inRange = (id: number) => Number.isSafeInteger(id) && id >= 0 && id < playerCount;
  switch (event.type) {
    case 'turn': case 'lock': case 'fire': case 'impact': case 'fizzle': case 'style': case 'pickup': case 'teleport': case 'blackhole': case 'planetKiller': case 'nebula': case 'wormhole': case 'defense': case 'antigravity': case 'defenseFire': case 'defenseMiss': case 'defenseWrecked': case 'shotdown': case 'multiKill': case 'split':
      return inRange(event.player);
    case 'explode': case 'shield':
      return inRange(event.ship);
    case 'clash':
      return event.players.every(inRange);
    case 'kill':
      return inRange(event.record.victim) && (event.record.killer === null || inRange(event.record.killer));
    default:
      return true;
  }
}
