import type { ReplayTurn, SeatChange } from '../game/replay';
import type { Avatar } from '../platform/avatars';
import type { Emblem } from '../platform/emblems';
import type { DailyShot } from '../sim/challenge';
import type { GameMode } from '../sim/modes';
import type { GameEvent } from '../game';
import type { StatePatch } from './netsync';
import type { TournamentPatch } from './tournament-patch';
import type { RoomColor, RoomLook, RoomSymbol } from '../data/roomLook';
import type { RoundReport, TurnReport } from '../game/roundReport';
import type { RoomRules } from '../data/roomRules';
import { packWireMessage, unpackWireMessage } from './messagepack';
import { withBrowserId } from '../data/browserId';
import { onlineAllowed } from '../data/online';

export type RoomMode = 'ffa' | 'team';
/** The level of a CPU seat in an online room: the same CPUs as offline. */
export type NetworkCpuLevel = 'easy' | 'medium' | 'hard' | 'hawking';

export type { RoomRules };

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
  /** A shot-down player's bet on who wins the round: a ship's index, or -1 for a draw, and `stake` points on it. A spectator's only input. */
  | { kind: 'bet'; pick: number; stake: number }
  /** A shot-down player roots for a ship still in the round: their escape pod flies over to it. For fun, no points. */
  | { kind: 'fan'; pick: number }
  /** A shot-down player cheers on the ship they root for. */
  | { kind: 'cheer' }
  /** A shot-down player calls the next shot of the ship they root for: it hits an enemy, hits nobody, or is hit itself. */
  | { kind: 'call'; call: 'hit' | 'miss' | 'hitBy' };

type ClientMessage =
  | { type: 'lobby' }
  | ({ type: 'create_room'; name: string; roomName?: string; mode: RoomMode; gameMode: GameMode; rules: RoomRules; maxPlayers: number; password?: string; avatar?: Avatar } & Partial<RoomLook>)
  /** `spectate` takes a place in the stands instead of a seat: it works for a running game of a public room without a password, too. */
  | { type: 'join_room'; roomId: string; name: string; password?: string; avatar?: Avatar; spectate?: boolean }
  /** Your symbol in the game, while the room waits. */
  | { type: 'set_avatar'; avatar: Avatar }
  /** Your name, while the room waits; the relay refuses one it will not carry. */
  | { type: 'set_name'; name: string }
  | { type: 'ready'; ready: boolean }
  /** `gameMode` changes the game the rules are for; without it the room keeps its own. */
  | { type: 'set_rules'; rules: RoomRules; gameMode?: GameMode }
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
  /** Host only: a person at the table dropped out, came back or left, and the turn it came at. A replay has no room to hear it from. */
  | ({ type: 'seat_stats' } & SeatChange)
  /** Post a daily-challenge run to the day's leaderboard; the board comes back either way. */
  | { type: 'daily_submit'; day: string; name: string; score: number; shot?: DailyShot }
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
  /** Host only, in a running game: a taunt the host's CPU says, shown to the room as that seat's chat line. */
  | { type: 'cpu_chat'; playerId: number; text: string }
  /** Host only, in a running game or on its results: the room goes back to waiting, with everybody still in it. */
  | { type: 'end_game' }
  /** Host only, from a game's results: the same table plays again, a game of its own for the statistics, its worlds from `seed`. The relay answers with `rematch`. */
  | { type: 'rematch'; seed: number }
  | { type: 'leave_room' }
  /** A new connection asks for the seat that `token` was given for, after the old connection dropped. */
  | { type: 'resume'; token: string }
  /** Make a tournament: the team size, the most teams, and a game for each level of the bracket, the final first. */
  | { type: 'tournament_create'; name: string; avatar: Avatar; teamSize: number; maxTeams: number; stages: TournamentStage[] }
  /** Come into a tournament with its code. */
  | { type: 'tournament_join'; code: string; name: string; avatar: Avatar }
  /** A new connection asks for the person that `token` was given to. */
  | { type: 'tournament_resume'; token: string }
  /** Leave the tournament for good: the name is free again, and the token brings nobody back. */
  | { type: 'tournament_leave' }
  /** While the tournament registers: a team of your own, which you are put in. A closed one gets a code to hand on. */
  | { type: 'tournament_create_team'; name: string; closed: boolean; slot?: number }
  /** Join a team, leaving the one you were in; a closed team wants its code. */
  | { type: 'tournament_join_team'; team: number; code?: string }
  | { type: 'tournament_leave_team' }
  /** A member of the team (or an organizer): what the team shows in the bracket. */
  | { type: 'tournament_team_look'; team: number; emblem: Emblem; color: RoomColor }
  /** Organizers only: make somebody an organizer too. */
  | { type: 'tournament_promote'; person: number }
  /** Organizers only: take a team out. Once the bracket is drawn, it loses its match. */
  | { type: 'tournament_remove_team'; team: number }
  /** Organizers only: close registration and draw the bracket. */
  | { type: 'tournament_start' }
  /** Organizers only: what a level of the bracket plays (0 is the final), until one of its matches has begun. */
  | ({ type: 'tournament_set_stage'; stage: number } & TournamentStage)
  /** Organizers only, after a team kept a ready match waiting: the team that is there goes through. When neither came, `team` goes through, or lots are drawn. */
  | { type: 'tournament_skip'; level: number; index: number; team?: number }
  /** A seat in your team's ready match (whoever comes first opens its room), or its stands when your team's seats are taken. */
  | { type: 'tournament_enter'; avatar: Avatar }
  /** Watch a match of your tournament from its stands. */
  | { type: 'tournament_watch'; level: number; index: number }
  /** The host of a tournament match, once its game is over: which of the room's two teams won. */
  | { type: 'match_result'; team: 0 | 1 };

/** What one level of a tournament's bracket plays. */
export interface TournamentStage {
  gameMode: GameMode;
  rules: RoomRules;
}

export interface TournamentMatch {
  /** The two teams, by their place in `teams`; null while an earlier match has still to say who. */
  teams: [number | null, number | null];
  state: 'waiting' | 'ready' | 'playing' | 'done';
  winner: number | null;
  /** One team had nobody to meet in the first level and went through without playing. */
  bye: boolean;
  /** The points each side ended the game on, in the order of `teams`; null for a match not played out. */
  score: [number, number] | null;
  /** Its room is open. */
  room: boolean;
  /** How many watch it. */
  watching: number;
  /** How it stands while it is played: the rounds its host reported so far and each side's points, in the order of `teams` (null until they add up). */
  live: { round: number; score: [number, number] | null } | null;
  /** A dev relay plays it out itself, as both its teams are pretend players only: there is no game to watch. */
  simulated: boolean;
  /** Seconds a ready match has waited for its teams. */
  waited: number | null;
  /** An organizer may skip it now. */
  skippable: boolean;
}

/** A tournament as the relay tells everybody in it. */
export interface TournamentView {
  code: string;
  phase: 'registration' | 'running' | 'finished';
  settings: { teamSize: number; maxTeams: number; stages: TournamentStage[] };
  /** Seconds until it runs out. */
  expiresIn: number;
  people: { name: string; avatar: Avatar; connected: boolean; team: number | null; organizer: boolean; gone: boolean }[];
  /** `code` only on your own team, when it is closed. */
  teams: { name: string; slot: number; closed: boolean; code?: string | null; members: number[]; withdrawn: boolean; present: boolean; emblem: Emblem; color: RoomColor }[];
  /** `levels[0]` is the first level played, the last one holds the final alone. */
  bracket: { levels: TournamentMatch[][]; champion: number | null } | null;
  you: { id: number; token: string; organizer: boolean; team: number | null };
}

/** One finding of the statistics, for the menu: what it is about and the numbers its sentence is made of. */
export interface StatsFact {
  id: string;
  values: number[];
}

/** A rule set many games on the relay were played by: their length and a room's own rules left out. */
export interface StatsFavorite {
  gameMode: GameMode;
  rules: Partial<RoomRules>;
  games: number;
}

/** What the bets (and, in older games, the tips on shots) came to on the relay. */
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
  gameMode: GameMode;
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
  gameMode: GameMode;
  mode: RoomMode;
  rules: RoomRules;
  /** Who sat where: a CPU's level, or null for a person; the team in team games. */
  seats: { cpu: NetworkCpuLevel | null; team: 0 | 1 | null }[];
  /** Every round, as the host of an online game would report it. */
  rounds: RoundReport[];
  /** A quick game: its rules were dealt from the favourites, so the relay does not count it among them. */
  quick?: boolean;
}

/** A recorded game as the relay hands it over: what it takes to fly it again (see `game/replay.ts`). */
export interface StatsReplay {
  gameMode: GameMode;
  mode: RoomMode;
  rules: RoomRules;
  seed: number;
  /** Who sat where: a CPU's level, or null for a person; the team in team games. */
  seats: { cpu: NetworkCpuLevel | null; team: 0 | 1 | null }[];
  turns: ReplayTurn[];
  /** The rounds the room skipped by vote. */
  skipped?: number[];
  /** Who dropped out, came back or left, in the order it came; absent when nobody did. */
  seatChanges?: SeatChange[];
}

/** One run on a daily leaderboard, as the relay ranks it. */
export interface DailyEntry {
  /** Place on the board, 1 = best. */
  rank: number;
  name: string;
  score: number;
}

/** The one shot of a day that paid the most across every run posted, and who fired it. */
export type ShotOfDay = DailyShot & { name: string };

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
  gameMode: GameMode;
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
  /** The person left the running game: the seat stays empty until the room waits again. */
  left?: boolean;
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
  gameMode: GameMode;
  rules: RoomRules;
  maxPlayers: number;
  status: 'waiting' | 'playing';
  locked: boolean;
  players: RoomPlayer[];
  /** The people in the stands. */
  spectators: { id: number; name: string }[];
  /** A tournament's match: its setup is the tournament's, and it is entered from the tournament. */
  tournament?: boolean;
  /** In a tournament's match: the two teams' own names, side 0 first, which the game shows in place of its team names. */
  teamNames?: [string, string] | null;
  /** In a tournament's match: the two teams' own colours, side 0 first, which the game draws the teams in. */
  teamColors?: [RoomColor, RoomColor] | null;
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
      gameMode: GameMode;
      rules?: RoomRules;
      hostId: 0;
      seed: number;
      players: Array<{ id: number; name: string; avatar: Avatar; team: 0 | 1; cpu: NetworkCpuLevel | null }>;
    }
  /** To the host: the relay agrees to the rematch it asked for, a game of its own from `seed`. */
  | { type: 'rematch'; seed: number }
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
      /** The shot of that day, once a run has brought one; a relay from before it leaves it out. */
      shot?: ShotOfDay | null;
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
      /** How the online games are played and their records, as facts (a relay from before them leaves them out). */
      facts?: StatsFact[];
      /** The same for the games played on one device. */
      localFacts?: StatsFact[];
    }
  /**
   * One-line findings of the statistics for the menu: an id, and the numbers its wording is made of; and the rule sets played
   * most, most first, that a quick game is dealt from (a relay from before them leaves them out).
   */
  | { type: 'stats_facts'; enabled: boolean; facts: StatsFact[]; favorites?: StatsFavorite[] }
  /** `replay` is null when the relay has no such game, or not the whole of it. */
  | { type: 'stats_replay'; id: string; replay: StatsReplay | null }
  | { type: 'room_closed'; message: string }
  /** The seat asked for with `resume` was given up (or never held). */
  | { type: 'resume_failed'; message: string }
  /** Your tournament as it stands now. */
  | ({ type: 'tournament' } & TournamentView)
  /** Your tournament has changed: what did, for a connection that holds it already. */
  | ({ type: 'tournament_patch' } & TournamentPatch)
  /** The person asked for with `tournament_resume` is not in a tournament any more. */
  | { type: 'tournament_resume_failed'; message: string }
  | { type: 'tournament_left' }
  /** The tournament ran out. */
  | { type: 'tournament_closed'; message: string }
  /** `field` names what the error is about, when it is about one thing the player typed. */
  | { type: 'error'; message: string; field?: 'name' | 'password' }
  /** The relay speaks a newer protocol than this client was built for, and lets go of it: reload to get the new build. */
  | { type: 'outdated'; protocol: number }
  /** Local only: the connection to the server is gone. */
  | { type: 'closed'; message: string };

/**
 * The version of the wire protocol this client speaks, sent with every connection (`?v=`). A relay on a newer one answers with
 * `outdated` and lets go, so a client left open across a deploy is told to reload and never plays on a misread protocol. Not raised
 * by hand: a test notices when the wire changed (the messages, the state patches, the rules) and `npm run protocol` raises it here, in
 * `server/src/protocol.rs` and in `server/protocol-contract.json`.
 */
export const PROTOCOL_VERSION = 14;

/** The address to open a socket on, with the protocol this client speaks added. */
export function withProtocol(url: string): string {
  try {
    const address = new URL(url);
    address.searchParams.set('v', String(PROTOCOL_VERSION));
    return address.toString();
  } catch {
    return url;
  }
}

/** Called when a relay turns this client away for being out of date, whichever connection it was. */
const outdatedListeners = new Set<() => void>();

/** Listen for the relay saying this build is out of date. Returns how to stop. */
export function onOutdated(listener: () => void): () => void {
  outdatedListeners.add(listener);
  return () => outdatedListeners.delete(listener);
}

const CONNECT_TIMEOUT_MS = 10_000;

/** Why the socket never opened; the lobby says it in the player's language. */
export class ConnectError extends Error {
  constructor(readonly reason: 'unreachable' | 'timeout' | 'closed' | 'offline', readonly url: string, message: string) {
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
    // The player chose to play offline: no connection to the relay, whoever asks for one.
    if (!onlineAllowed()) return Promise.reject(new ConnectError('offline', this.url, 'Online features are switched off'));
    if (this.socket?.readyState === WebSocket.OPEN) return Promise.resolve();
    if (this.connectPromise) return this.connectPromise;

    let socket: WebSocket;
    try {
      socket = new WebSocket(withProtocol(withBrowserId(this.url)));
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
    if ((parsed as { type?: unknown }).type === 'outdated') for (const listener of [...outdatedListeners]) listener();
    this.deliver(parsed as ServerMessage);
  }

  private deliver(message: ServerMessage): void {
    for (const listener of this.listeners) listener(message);
  }
}
