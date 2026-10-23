import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { packMessage, packWireMessage, unpackWireMessage } from '../src/messagepack';
import { mayhemRules } from '../src/lobbyPrefs';
import { MultiplayerSession, type NetMatch, type Transport } from '../src/multiplayer';
import type { RoomRules, ServerMessage } from '../src/net';
import { TIP_HIDDEN } from '../src/game/oracle';
import { cloneSettings, DEFAULT_SETTINGS } from '../src/settings';
import { netMatch } from '../src/netMatch';
import { POWER_UP_KINDS } from '../src/powerups';
import { StatsBoard } from '../src/statsBoard';
import { createMatch } from '../src/game';
import { reportLocalGame, trackLocalGame } from '../src/localStats';
import type { LocalGameReport } from '../src/net';

const activeTransports = new Set<RustTransport>();
let serverProcess: ChildProcess;
let serverUrl: string;

class RustTransport implements Transport {
  private url = '';
  /** Closed on purpose by the test: no reconnecting, and the relay is told so it frees the seat at once. */
  private closing = false;
  private socket: WebSocket | null = null;
  get rawSocket(): WebSocket | null { return this.socket; }
  private edit: (message: ServerMessage) => ServerMessage;
  private listener: ((message: ServerMessage) => void) | null = null;
  private messageWaiters = new Set<{ predicate: (message: ServerMessage) => boolean; resolve: () => void }>();
  waitForMessage(predicate: (message: ServerMessage) => boolean): Promise<void> {
    const { promise, resolve } = Promise.withResolvers<void>();
    this.messageWaiters.add({ predicate, resolve });
    return promise;
  }

  constructor(edit: (message: ServerMessage) => ServerMessage = (message) => message) {
    this.edit = edit;
    activeTransports.add(this);
  }

  get address(): string { return this.url; }

  setAddress(url: string): void { this.url = url; }

  onMessage(listener: (message: ServerMessage) => void): void { this.listener = listener; }

  async connect(): Promise<void> {
    this.closing = false;
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    const socket = new WebSocket(this.url);
    this.socket = socket;
    let opened = false;
    socket.on('open', () => { opened = true; resolve(); });
    socket.on('error', (error) => { if (!opened) reject(error); });
    socket.on('message', (data) => {
      try {
        const message = unpackWireMessage(data as Buffer) as ServerMessage;
        const edited = this.edit(message);
        this.listener?.(edited);
        for (const waiter of this.messageWaiters) {
          if (!waiter.predicate(edited)) continue;
          this.messageWaiters.delete(waiter);
          waiter.resolve();
        }
      } catch {
        this.listener?.({ type: 'error', message: 'Malformed relay response' });
      }
    });
    socket.on('close', () => {
      activeTransports.delete(this);
      if (opened && !this.closing) this.listener?.({ type: 'closed', message: 'Test relay connection closed' });
    });
    await promise;
  }

  send(message: Parameters<Transport['send']>[0]): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) throw new Error('WebSocket is not open');
    this.socket.send(packWireMessage(JSON.parse(JSON.stringify(message))));
  }

  async close(): Promise<void> {
    const socket = this.socket;
    this.socket = null;
    this.closing = true;
    if (!socket || socket.readyState === WebSocket.CLOSED) return;
    const closed = once(socket, 'close');
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(packWireMessage({ type: 'leave_room' }));
      socket.close();
    }
    else socket.terminate();
    await closed;
  }
}

async function freePort(): Promise<number> {
  const listener = createServer();
  const { promise, resolve, reject } = Promise.withResolvers<number>();
  listener.once('error', reject);
  listener.listen(0, '127.0.0.1', () => {
    const address = listener.address();
    if (!address || typeof address === 'string') { reject(new Error('Could not get test port')); return; }
    listener.close((error) => error ? reject(error) : resolve(address.port));
  });
  return promise;
}

async function waitForServer(url: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (serverProcess.exitCode === null && Date.now() < deadline) {
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    const socket = new WebSocket(url);
    socket.once('open', () => { socket.close(); resolve(); });
    socket.once('error', reject);
    try { await promise; return; } catch {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw new Error(serverProcess.exitCode === null ? 'Rust relay did not become ready within 15 seconds' : 'Rust relay exited before becoming ready');
}

beforeAll(async () => {
  const port = await freePort();
  serverUrl = `ws://127.0.0.1:${port}`;
  const binary = fileURLToPath(new URL('../server/target/debug/slingshot-server', import.meta.url));
  serverProcess = spawn(binary, [], {
    // The relay opens a daily leaderboard wherever it runs; this one writes it to a throwaway file
    // rather than leaving a board behind in the working tree.
    env: { ...process.env, PORT: String(port), ALLOW_ALL_ORIGINS: '1', ALLOWED_ORIGINS: '', STATS: '1', CONNECTIONS_PER_IP_PER_SECOND: '1000', MAX_MESSAGES_PER_SECOND: '100000', DATABASE: join(tmpdir(), `slingshot-${port}.db`), RUST_LOG: process.env.RUST_LOG ?? 'info' },
    stdio: process.env.RELAY_LOG ? 'inherit' : 'ignore',
  });
  await waitForServer(serverUrl);
});

afterEach(async () => {
  await Promise.all([...activeTransports].map((transport) => transport.close()));
  activeTransports.clear();
});

afterAll(async () => {
  if (serverProcess && serverProcess.exitCode === null) {
    const exited = once(serverProcess, 'exit');
    serverProcess.kill('SIGTERM');
    await exited;
  }
});

interface Client {
  session: MultiplayerSession;
  /** The match this client mirrors (or runs, for the host). */
  match(): NetMatch;
  syncElapsed: number;
}

const rules: RoomRules = { rounds: 2, maxPlanets: 3, invisiblePlanets: false, bounce: true, fixedPower: true, fixedPowerLevel: 55, maxPower: 100, shotTime: 30, styleBonuses: true, neighborGrace: 0, simultaneousShots: false, hiddenAim: false, fadingTrails: 0, mayhem: 0, betting: false, chatPlayersOnly: false, powerUps: false, powerUpKinds: ['preview', 'teleport', 'splitter', 'antigravity', 'shield'], powerUpAmount: 2 };

async function connectSession(hooks: Partial<ConstructorParameters<typeof MultiplayerSession>[0]> = {}, settings = DEFAULT_SETTINGS, edit?: (message: ServerMessage) => ServerMessage): Promise<MultiplayerSession> {
  const session = new MultiplayerSession({ settings: () => cloneSettings(settings), matchStarted() {}, matchRestarted() {}, matchEnded() {}, ...hooks }, new RustTransport(edit));
  await session.connect(serverUrl);
  return session;
}

function waitForSession(session: MultiplayerSession, predicate: () => boolean): Promise<void> {
  if (predicate()) return Promise.resolve();
  const { promise, resolve } = Promise.withResolvers<void>();
  const unsubscribe = session.subscribe(() => {
    if (!predicate()) return;
    unsubscribe();
    resolve();
  });
  if (predicate()) { unsubscribe(); resolve(); }
  return promise;
}

async function startRoom(gameMode: 'classic' | 'horizon', names = ['Anna', 'Ben'], roomRules: RoomRules = rules): Promise<{ host: Client; guest: Client }> {
  let hostMatch: NetMatch | null = null;
  let guestMatch: NetMatch | null = null;
  const hostSession = await connectSession({ matchStarted: (match) => { hostMatch = match; } });
  const guestSession = await connectSession({ matchStarted: (match) => { guestMatch = match; } });
  hostSession.createRoom({ name: names[0], mode: 'ffa', gameMode, rules: roomRules, maxPlayers: 2 });
  await waitForSession(hostSession, () => hostSession.room !== null);
  await waitForSession(guestSession, () => guestSession.rooms.some((room) => room.id === hostSession.room!.id));
  guestSession.joinRoom(hostSession.room!.id, names[1]);
  await waitForSession(guestSession, () => guestSession.room?.players.length === 2);
  await waitForSession(hostSession, () => hostSession.room?.players.length === 2);
  guestSession.setReady(true);
  await waitForSession(hostSession, () => hostSession.room!.players.slice(1).every((player) => player.ready));
  await waitForSession(guestSession, () => guestSession.room!.players.slice(1).every((player) => player.ready));
  hostSession.startGame();
  await waitForSession(hostSession, () => hostMatch !== null);
  await waitForSession(guestSession, () => guestMatch !== null);
  return { host: { session: hostSession, match: () => hostMatch!, syncElapsed: 0 }, guest: { session: guestSession, match: () => guestMatch!, syncElapsed: 0 } };
}

async function frame(host: Client, guest: Client, dt = 1 / 60): Promise<void> {
  host.syncElapsed += dt;
  const sendsState = host.syncElapsed >= 1 / 30;
  if (sendsState) host.syncElapsed %= 1 / 30;
  const stateReceived = sendsState
    ? (guest.session.client as RustTransport).waitForMessage((message) => message.type === 'state')
    : null;
  host.match().update(dt);
  host.session.update(dt);
  guest.session.update(dt);
  if (stateReceived) await stateReceived;
}

describe('online games', () => {
  it('rejects unsupported state envelope versions', async () => {
    const { host } = await startRoom('classic');
    const transport = host.session.client as RustTransport;
    const response = transport.waitForMessage(
      (message) => message.type === 'error' && message.message === 'Invalid state envelope',
    );
    const frame = packWireMessage({ type: 'state', seq: 1, patch: {}, events: [] });
    frame[4] += 1;
    transport.rawSocket!.send(frame);
    await response;
  });

  it('forwards the envelope frame byte-for-byte to guests', async () => {
    const { host, guest } = await startRoom('classic');
    const hostSocket = (host.session.client as RustTransport).rawSocket!;
    const guestSocket = (guest.session.client as RustTransport).rawSocket!;
    const frame = packWireMessage({ type: 'state', seq: 1, patch: { phase: 'aiming' }, events: [] });
    const received = new Promise<Buffer>((resolve) => {
      const listener = (data: WebSocket.RawData) => {
        const bytes = Buffer.from(data as Buffer);
        if (bytes.subarray(0, 4).toString() !== 'SLNG') return;
        guestSocket.off('message', listener);
        resolve(bytes);
      };
      guestSocket.on('message', listener);
    });
    hostSocket.send(frame);
    expect(await received).toEqual(Buffer.from(frame));
  });

  it('rejects unsafe state envelope sequence numbers', async () => {
    const host = await connectSession();
    const guest = await connectSession();
    host.createRoom({ name: 'Anna', mode: 'ffa', gameMode: 'classic', rules, maxPlayers: 2 });
    await waitForSession(host, () => host.room !== null);
    await waitForSession(guest, () => guest.rooms.some((room) => room.id === host.room!.id));
    guest.joinRoom(host.room!.id, 'Ben');
    await waitForSession(host, () => host.room?.players.length === 2);
    guest.setReady(true);
    await waitForSession(host, () => host.room!.players[1].ready);
    host.startGame();
    await waitForSession(host, () => host.match !== null);

    const transport = host.client as RustTransport;
    const seq = BigInt(Number.MAX_SAFE_INTEGER) + 1n;
    const frame = new Uint8Array(15);
    frame.set([0x53, 0x4c, 0x4e, 0x47, 1, 1]);
    new DataView(frame.buffer).setBigUint64(6, seq, false);
    frame[14] = 0x80; // Empty MessagePack map payload.
    const response = transport.waitForMessage((message) => message.type === 'error' && message.message === 'Invalid state sequence');
    transport.rawSocket!.send(frame);
    await response;
  });

  it('rejects legacy text frames and replies with MessagePack', async () => {
    const transport = await connectSession();
    const response = (transport.client as RustTransport).waitForMessage(
      (message) => message.type === 'error' && message.message === 'Only binary MessagePack messages are accepted',
    );
    (transport.client as RustTransport).rawSocket!.send('{"type":"lobby"}');
    await response;
  });

  it("play by the room's rules, not by the players' own settings", async () => {
    const { host, guest } = await startRoom('classic');
    for (const client of [host, guest]) {
      const settings = client.match().settings;
      expect(settings).toMatchObject(rules);
    }
  });

  it("never fill a rule the room leaves out from the player's own settings", async () => {
    // Simulate an older relay that omits rules introduced after this client.
    const forget = (message: ServerMessage): ServerMessage => {
      if (message.type === 'game_start' && message.rules) {
        const { fixedPowerLevel: _fixedPowerLevel, hiddenAim: _hiddenAim, ...rest } = message.rules;
        return { ...message, rules: rest as RoomRules };
      }
      return message;
    };
    const own = { ...cloneSettings(DEFAULT_SETTINGS), fixedPowerLevel: 80, hiddenAim: true, rounds: 20, contours: false };
    let match: NetMatch | null = null;
    const host = await connectSession({}, own);
    const guest = await connectSession({ matchStarted: (started) => { match = started; } }, own, forget);
    host.createRoom({ name: 'Anna', mode: 'ffa', gameMode: 'classic', rules, maxPlayers: 2 });
    await waitForSession(host, () => host.room !== null);
    await waitForSession(guest, () => guest.rooms.some((room) => room.id === host.room!.id));
    guest.joinRoom(host.room!.id, 'Ben');
    await waitForSession(host, () => host.room?.players.length === 2);
    await waitForSession(guest, () => guest.room?.players.length === 2);
    guest.setReady(true);
    await waitForSession(host, () => host.room!.players.slice(1).every((player) => player.ready));
    await waitForSession(guest, () => guest.room!.players.slice(1).every((player) => player.ready));
    host.startGame();
    await waitForSession(host, () => host.match !== null);
    await waitForSession(guest, () => match !== null);
    expect(match!.settings).toMatchObject({ rounds: 2, fixedPowerLevel: 55, hiddenAim: false });
    // What belongs to this device still does.
    expect(match!.settings.contours).toBe(false);
  });

  it('lets the host change the rules while the room waits, and everyone must confirm again', async () => {
    const host = await connectSession();
    const guest = await connectSession();
    host.createRoom({ name: 'Anna', mode: 'ffa', gameMode: 'classic', rules, maxPlayers: 3 });
    await waitForSession(host, () => host.room !== null);
    await waitForSession(guest, () => guest.rooms.some((room) => room.id === host.room!.id));
    guest.joinRoom(host.room!.id, 'Ben');
    await waitForSession(host, () => host.room?.players.length === 2);
    await waitForSession(guest, () => guest.room?.players.length === 2);
    guest.setReady(true);
    await waitForSession(host, () => host.room!.players[1].ready);
    host.setRules({ ...rules, maxPlanets: 6 });
    await waitForSession(guest, () => guest.room!.rules.maxPlanets === 6);
    expect(guest.room!.players.every((player) => !player.ready)).toBe(true);
    // Guests have no say.
    guest.setRules({ ...rules, maxPlanets: 1 });
    await waitForSession(guest, () => guest.notice !== null);
    expect(guest.room!.rules.maxPlanets).toBe(6);
    expect(guest.notice).toMatch(/host/i);
  });

  it('lets everybody pick their own team, and the host deal them out again', async () => {
    const host = await connectSession();
    const guest = await connectSession();
    const teams = (session: MultiplayerSession) => session.room!.players.map((player) => player.team);
    host.createRoom({ name: 'Anna', mode: 'team', gameMode: 'classic', rules, maxPlayers: 4 });
    await waitForSession(host, () => host.room !== null);
    await waitForSession(guest, () => guest.rooms.some((room) => room.id === host.room!.id));
    guest.joinRoom(host.room!.id, 'Ben');
    await waitForSession(guest, () => guest.room?.players.length === 2);
    await waitForSession(host, () => host.room?.players.length === 2);
    expect(teams(guest)).toEqual([0, 1]);
    guest.setTeam(0);
    await waitForSession(host, () => teams(host)[1] === 0);
    expect(teams(host)).toEqual([0, 0]);
    host.setTeam(1);
    // The host hears its own roster over the wire too — assert only after it landed.
    await waitForSession(host, () => teams(host)[0] === 1);
    await waitForSession(guest, () => teams(guest)[0] === 1);
    expect(teams(guest)).toEqual([1, 0]);
    // Only the host deals the teams out again.
    guest.resetTeams();
    await waitForSession(guest, () => guest.notice !== null);
    expect(guest.notice).toMatch(/host/i);
    expect(teams(host)).toEqual([1, 0]);
    host.resetTeams();
    await waitForSession(guest, () => teams(guest)[0] === 0 && teams(guest)[1] === 1);
    expect(teams(guest)).toEqual([0, 1]);
  });


  it('let only the host move on from the scorecard', async () => {
    const { host, guest } = await startRoom('classic');
    expect(host.match().canAdvance).toBe(true);
    expect(guest.match().canAdvance).toBe(false);
    const m = host.match();
    for (let i = 0; i < 5; i++) await frame(host, guest);
    m.phase = 'roundOver';
    m.phaseTime = 1;
    for (let i = 0; i < 5; i++) await frame(host, guest);
    expect(guest.match().phase).toBe('roundOver');

    guest.session.advance();
    for (let i = 0; i < 5; i++) await frame(host, guest);
    expect(host.match().phase).toBe('roundOver');
    expect(guest.match().phase).toBe('roundOver');

    host.session.advance();
    for (let i = 0; i < 5; i++) await frame(host, guest);
    expect(host.match().phase).not.toBe('roundOver');
    expect(guest.match().phase).not.toBe('roundOver');
  });

  it('keep the names through a rematch, on the host and on the guest', async () => {
    for (const mode of ['classic', 'horizon'] as const) {
      const { host, guest } = await startRoom(mode, ['Anna', 'Ben']);
      const m = host.match();
      for (let i = 0; i < 5; i++) await frame(host, guest);
      // Jump to the final standings, as if the last round had just been decided.
      m.phase = 'gameOver';
      m.phaseTime = 1;
      for (let i = 0; i < 5; i++) await frame(host, guest);
      expect(guest.match().phase).toBe('gameOver');

      host.session.advance();
      for (let i = 0; i < 5; i++) await frame(host, guest);
      expect(host.match().phase).not.toBe('gameOver');
      expect(guest.match().phase).not.toBe('gameOver');
      expect(host.match().players.map((p) => p.name)).toEqual(['Anna', 'Ben']);
      expect(guest.match().players.map((p) => p.name)).toEqual(['Anna', 'Ben']);
    }
  });

  it('lets a guest vote to skip the killcam', async () => {
    const { host, guest } = await startRoom('horizon');
    const hm = host.match();
    hm.world.planets = [];
    Object.assign(hm.world.ships[0], { x: 100, y: 400 });
    Object.assign(hm.world.ships[1], { x: 300, y: 400 });
    for (let i = 0; i < 5; i++) await frame(host, guest);
    for (let i = 0; i < 60 * 60 && hm.phase !== 'killcam'; i++) {
      if (hm.phase === 'aiming') {
        host.session.input({ kind: 'aim', angle: 0, power: 30 });
        host.session.input({ kind: 'fire' });
        guest.session.input({ kind: 'aim', angle: 90, power: 30 });
        guest.session.input({ kind: 'fire' });
      }
      await frame(host, guest);
    }
    expect(hm.phase).toBe('killcam');
    for (let i = 0; i < 30; i++) await frame(host, guest);
    expect(guest.match().phase).toBe('killcam');

    guest.session.advance();
    for (let i = 0; i < 120 && (hm.phase === 'killcam' || guest.match().phase === 'killcam'); i++) {
      await frame(host, guest);
    }
    expect(hm.phase).not.toBe('killcam');
    // The vote is delivered asynchronously, so keep pumping simulated frames until the next
    // authoritative state reaches the guest rather than assuming five frames is enough.
    expect(guest.match().phase).not.toBe('killcam');
  }, 60_000);

  it('lets everybody aim at once in Classic with simultaneous shots', async () => {
    let hostMatch: NetMatch | null = null;
    let guestMatch: NetMatch | null = null;
    const hostSession = await connectSession({ matchStarted: (match) => { hostMatch = match; } });
    const guestSession = await connectSession({ matchStarted: (match) => { guestMatch = match; } });
    hostSession.createRoom({ name: 'Anna', mode: 'ffa', gameMode: 'classic', rules: { ...rules, simultaneousShots: true }, maxPlayers: 2 });
    await waitForSession(hostSession, () => hostSession.room !== null);
    await waitForSession(guestSession, () => guestSession.rooms.some((room) => room.id === hostSession.room!.id));
    guestSession.joinRoom(hostSession.room!.id, 'Ben');
    await waitForSession(hostSession, () => hostSession.room?.players.length === 2);
    await waitForSession(guestSession, () => guestSession.room?.players.length === 2);
    guestSession.setReady(true);
    await waitForSession(hostSession, () => hostSession.room!.players.slice(1).every((player) => player.ready));
    await waitForSession(guestSession, () => guestSession.room!.players.slice(1).every((player) => player.ready));
    hostSession.startGame();
    await waitForSession(hostSession, () => hostMatch !== null);
    await waitForSession(guestSession, () => guestMatch !== null);
    const host: Client = { session: hostSession, match: () => hostMatch!, syncElapsed: 0 };
    const guest: Client = { session: guestSession, match: () => guestMatch!, syncElapsed: 0 };
    const hm = host.match();
    expect(hm.salvo).toBe(true);
    expect(hm.simultaneous).toBe(true);
    for (let i = 0; i < 5; i++) await frame(host, guest);
    expect(hm.canAim(0)).toBe(true);
    expect(hm.canAim(1)).toBe(true);
    expect(guest.match().localCanAim).toBe(true);

    host.session.input({ kind: 'aim', angle: 10, power: 40 });
    guest.session.input({ kind: 'aim', angle: 170, power: 40 });
    host.session.input({ kind: 'fire' });
    for (let i = 0; i < 5; i++) await frame(host, guest);
    // One is locked in and waits for the other: nothing flies yet.
    expect(hm.phase).toBe('aiming');
    expect(guest.match().players[0].locked).toBe(true);
    guest.session.input({ kind: 'fire' });
    for (let i = 0; i < 60; i++) await frame(host, guest);
    expect(hm.phase).not.toBe('aiming');
    expect(guest.match().phase).toBe(hm.phase);
  });

  describe('in Event Horizon', () => {
    it('let everybody aim at once, sharing one clock', async () => {
      const { host, guest } = await startRoom('horizon');
      const hm = host.match();
      const gm = guest.match();
      expect(hm.simultaneous).toBe(true);
      expect([hm.viewer, gm.viewer]).toEqual([0, 1]);
      for (let i = 0; i < 5; i++) await frame(host, guest);
      expect(hm.localCanAim).toBe(true);
      expect(gm.localCanAim).toBe(true);
      expect(hm.shotClock).not.toBeNull();

      // The guest's aim reaches the host while the host is aiming too.
      guest.session.input({ kind: 'aim', angle: 123, power: 40 });
      host.session.input({ kind: 'aim', angle: 33, power: 60 });
      for (let i = 0; i < 5; i++) await frame(host, guest);
      expect(hm.players[1].angle).toBe(123);
      expect(hm.players[0].angle).toBe(33);
      // Our own aim is not dragged back by the host's snapshots.
      expect(gm.players[1].angle).toBe(123);
    });

    it('fire all shots once the last player has locked in, and lock out the ones who are done', async () => {
      const { host, guest } = await startRoom('horizon');
      const hm = host.match();
      const gm = guest.match();
      for (let i = 0; i < 5; i++) await frame(host, guest);
      host.session.input({ kind: 'fire' });
      for (let i = 0; i < 5; i++) await frame(host, guest);
      expect(hm.players[0].locked).toBe(true);
      expect(hm.localCanAim).toBe(false);
      // A locked-in player can no longer move the aim.
      host.session.input({ kind: 'aim', angle: 200, power: 10 });
      expect(hm.players[0].angle).not.toBe(200);
      expect(hm.phase).toBe('aiming');
      expect(gm.localCanAim).toBe(true);

      guest.session.input({ kind: 'fire' });
      for (let i = 0; i < 90 && hm.phase !== 'flying'; i++) await frame(host, guest);
      expect(hm.phase).toBe('flying');
      expect(hm.volley!.shots).toHaveLength(2);
    });

    it('lock everybody in when the shared clock runs out', async () => {
      const { host, guest } = await startRoom('horizon');
      const hm = host.match();
      for (let i = 0; i < 60 * 16 && hm.phase === 'aiming'; i++) await frame(host, guest);
      expect(hm.phase).toBe('flying');
    }, 30_000);
  });

  it("move a guest's view of the flight on between snapshots", async () => {
    const { host, guest } = await startRoom('classic');
    const hm = host.match();
    const gm = guest.match();
    // An empty field and ships out of each other's line: the shot simply keeps flying (it bounces off the walls).
    hm.world.planets = [];
    Object.assign(hm.world.ships[0], { x: 100, y: 400 });
    Object.assign(hm.world.ships[1], { x: 1180, y: 700 });
    for (let i = 0; i < 5; i++) await frame(host, guest);
    host.session.input({ kind: 'aim', angle: 0, power: 55 });
    host.session.input({ kind: 'fire' });
    // The host's snapshots come in 30 Hz steps; the guest renders 60 Hz frames in between.
    let moved = 0;
    let last: number | null = null;
    for (let i = 0; i < 40; i++) {
      host.match().update(1 / 60);
      host.syncElapsed += 1 / 60;
      const sendsState = host.syncElapsed >= 1 / 30;
      const stateReceived = sendsState
        ? (guest.session.client as RustTransport).waitForMessage((message) => message.type === 'state')
        : null;
      if (sendsState) host.syncElapsed %= 1 / 30;
      host.session.update(1 / 60);
      if (stateReceived) await stateReceived;
      const x = gm.volley?.shots[0].shot.x ?? null;
      if (x !== null && last !== null && x !== last) moved++;
      if (x !== null) last = x;
      guest.session.update(1 / 60);
      const after = gm.volley?.shots[0].shot.x ?? null;
      if (after !== null && last !== null && after !== last) moved++;
      if (after !== null) last = after;
    }
    expect(gm.phase).toBe('flying');
    // Every one of the guest's frames shows progress, not only every second one.
    expect(moved).toBeGreaterThan(30);
    // …and it never strays from what the host really simulates (same deterministic physics).
    const gx = gm.volley!.shots[0].shot;
    const hx = hm.volley!.shots[0].shot;
    expect(Math.hypot(gx.x - hx.x, gx.y - hx.y)).toBeLessThan(25);
  });
});

describe('the scorecard online', () => {
  it('reaches the guest at the end of a round, through the relay', async () => {
    for (const mode of ['classic', 'horizon'] as const) {
      const { host, guest } = await startRoom(mode);
      const hm = host.match();
      // Straight shots across an empty field: player 0 hits player 1 sooner or later.
      hm.world.planets = [];
      Object.assign(hm.world.ships[0], { x: 100, y: 400 });
      Object.assign(hm.world.ships[1], { x: 1180, y: 400 });
      for (let i = 0; i < 5; i++) await frame(host, guest);
      // Everybody shoots at the other one whenever they may aim (Classic: in turn; Horizon: all at once).
      for (let i = 0; i < 60 * 60 && hm.phase !== 'roundOver'; i++) {
        if (hm.phase === 'killcam') hm.voteSkip(0);
        if (hm.phase === 'aiming') {
          host.session.input({ kind: 'aim', angle: 0, power: 55 });
          guest.session.input({ kind: 'aim', angle: 180, power: 55 });
          host.session.input({ kind: 'fire' });
          guest.session.input({ kind: 'fire' });
        }
        await frame(host, guest);
      }
      for (let i = 0; i < 10; i++) await frame(host, guest);
      expect(hm.phase).toBe('roundOver');
      expect(guest.match().phase).toBe('roundOver');
      expect(hm.roundStats.longestShot).not.toBeNull();
      expect(guest.match().roundStats).toEqual(hm.roundStats);
      expect(guest.match().matchStats).toEqual(hm.matchStats);
    }
  }, 180_000);
});

describe('the oracle online', () => {
  async function startTable(names: string[], betting = false): Promise<Client[]> {
    const clients: Client[] = [];
    const matches: (NetMatch | null)[] = names.map(() => null);
    for (let index = 0; index < names.length; index++) {
      const session = await connectSession({ matchStarted: (match) => { matches[index] = match; } });
      clients.push({ session, match: () => matches[index]!, syncElapsed: 0 });
    }
    const host = clients[0].session;
    host.createRoom({ name: names[0], mode: 'ffa', gameMode: 'classic', rules: { ...rules, fixedPower: false, bounce: false, betting }, maxPlayers: names.length });
    await waitForSession(host, () => host.room !== null);
    for (let index = 1; index < names.length; index++) {
      const guest = clients[index].session;
      await waitForSession(guest, () => guest.rooms.some((room) => room.id === host.room!.id));
      guest.joinRoom(host.room!.id, names[index]);
      await waitForSession(guest, () => guest.room?.players.length === index + 1);
      await waitForSession(host, () => host.room?.players.length === index + 1);
    }
    for (const client of clients.slice(1)) client.session.setReady(true);
    await Promise.all(clients.slice(1).map((client) => waitForSession(client.session, () => client.session.room!.players.slice(1).every((player) => player.ready))));
    await waitForSession(host, () => host.room!.players.slice(1).every((player) => player.ready));
    host.startGame();
    await Promise.all(clients.map((client, index) => waitForSession(client.session, () => matches[index] !== null)));
    return clients;
  }

  const tick = async (clients: Client[], frames = 1): Promise<void> => {
    for (let index = 0; index < frames; index++) {
      const stateReceived = clients.slice(1).map((client) => (client.session.client as RustTransport).waitForMessage((message) => message.type === 'state'));
      clients[0].match().update(1 / 30);
      for (const client of clients) client.session.update(1 / 30);
      await Promise.all(stateReceived);
    }
  };

  it('lets a shot-down guest tip, judges it on the host, and shows everybody the verdict', async () => {
    const [host, ghost, shooter] = await startTable(['Anna', 'Ben', 'Cleo']);
    const hm = host.match();
    hm.world.planets = [];
    Object.assign(hm.world.ships[0], { x: 100, y: 400 });
    Object.assign(hm.world.ships[1], { x: 500, y: 400 });
    Object.assign(hm.world.ships[2], { x: 300, y: 100 });
    await tick([host, ghost, shooter], 5);

    // Anna shoots Ben out of the game.
    host.session.input({ kind: 'aim', angle: 0, power: 50 });
    host.session.input({ kind: 'fire' });
    for (let i = 0; i < 600 && !(hm.phase === 'aiming' && hm.current === 2); i++) await tick([host, ghost, shooter]);
    expect(hm.players[1].alive).toBe(false);
    await tick([host, ghost, shooter], 5);
    expect(ghost.match().ghost).toBe(true);
    expect(ghost.match().oracle.question).toMatchObject({ kind: 'shot', shooter: 2, locked: false });

    // Only the shot-down may tip; Cleo is on turn and alive, so her tip never leaves her screen.
    shooter.session.input({ kind: 'bet', pick: 1 });
    expect(shooter.match().oracle.mine).toBeNull();
    ghost.session.input({ kind: 'bet', pick: 1 });
    expect(ghost.match().oracle.mine).toMatchObject({ pick: 1 });
    await tick([host, ghost, shooter], 5);
    // The tip travels to every screen — face down: everybody sees that Ben tipped, not what.
    expect(shooter.match().oracle.picks.get(1)).toBe(TIP_HIDDEN);

    // Cleo hits Anna.
    const a = hm.world.ships[2];
    const b = hm.world.ships[0];
    shooter.session.input({ kind: 'aim', angle: (Math.atan2(-(b.y - a.y), b.x - a.x) * 180) / Math.PI, power: Math.hypot(b.x - a.x, b.y - a.y) / 8 });
    shooter.session.input({ kind: 'fire' });
    for (let i = 0; i < 600 && hm.oracle.result?.shooter !== 2; i++) await tick([host, ghost, shooter]);
    await tick([host, ghost, shooter], 5);

    for (const client of [host, ghost, shooter]) {
      expect(client.match().oracle.result).toMatchObject({ shooter: 2, hit: true, victims: [0] });
      expect(client.match().oracle.result!.tips).toEqual([{ player: 1, pick: 1, right: true, points: 100 }]);
      expect(client.match().oracle.scores[1].points).toBe(100);
    }
  }, 60_000);

  it('refuses a tip from a player who is still alive, whatever their client claims', async () => {
    const [host, ghost, shooter] = await startTable(['Anna', 'Ben', 'Cleo']);
    const hm = host.match();
    hm.world.planets = [];
    Object.assign(hm.world.ships[0], { x: 100, y: 400 });
    Object.assign(hm.world.ships[1], { x: 500, y: 400 });
    await tick([host, ghost, shooter], 5);
    host.session.input({ kind: 'aim', angle: 0, power: 50 });
    host.session.input({ kind: 'fire' });
    for (let i = 0; i < 600 && !(hm.phase === 'aiming' && hm.current === 2); i++) await tick([host, ghost, shooter]);

    // A tampered client skips its own check and sends the tip anyway.
    shooter.session.client.send({ type: 'input', input: { kind: 'bet', pick: 1 } });
    await tick([host, ghost, shooter], 5);
    expect(hm.canBet(2)).toBe(false);

    shooter.session.input({ kind: 'aim', angle: 90, power: 20 });
    shooter.session.input({ kind: 'fire' });
    for (let i = 0; i < 900 && !hm.oracle.result; i++) await tick([host, ghost, shooter]);
    expect(hm.oracle.result?.tips).toEqual([]);
  }, 60_000);

  it('shows the eliminated players each other\'s tips while the question is open, and the verdict to both', async () => {
    const [host, ben, cleo, dora] = await startTable(['Anna', 'Ben', 'Cleo', 'Dora']);
    const hm = host.match();
    const everybody = [host, ben, cleo, dora];
    hm.world.planets = [];
    [[100, 400], [500, 400], [900, 200], [900, 600]].forEach(([x, y], i) => Object.assign(hm.world.ships[i], { x, y }));
    await tick(everybody, 5);

    // Anna shoots Ben, Cleo shoots Dora: two are out and watch Anna's shot.
    host.session.input({ kind: 'aim', angle: 0, power: 50 });
    host.session.input({ kind: 'fire' });
    for (let i = 0; i < 600 && !(hm.phase === 'aiming' && hm.current === 2); i++) await tick(everybody);
    cleo.session.input({ kind: 'aim', angle: 270, power: 50 });
    cleo.session.input({ kind: 'fire' });
    for (let i = 0; i < 600 && !(hm.phase === 'aiming' && hm.current === 0 && !hm.players[3].alive); i++) await tick(everybody);
    await tick(everybody, 5);
    expect(hm.oracle.question).toMatchObject({ kind: 'shot', shooter: 0 });

    ben.session.input({ kind: 'bet', pick: 1 });
    await tick(everybody, 5);
    expect(dora.match().oracle.picks.get(1)).toBe(TIP_HIDDEN);
    dora.session.input({ kind: 'bet', pick: 0 });
    await tick(everybody, 5);
    expect([...ben.match().oracle.picks]).toEqual([[1, TIP_HIDDEN], [3, TIP_HIDDEN]]);
    // Nothing a guest holds gives away what the other tipped.
    expect(ben.match().snapshot().oracle.tips!.every(([, pick]) => pick === TIP_HIDDEN)).toBe(true);

    // Anna hits Cleo: Ben was right, Dora wasn't, and both screens know.
    host.session.input({ kind: 'aim', angle: 14.04, power: 100 });
    host.session.input({ kind: 'fire' });
    for (let i = 0; i < 900 && hm.oracle.result?.shooter !== 0; i++) await tick(everybody);
    await tick(everybody, 5);
    for (const client of [ben, dora]) {
      expect(client.match().oracle.result!.tips).toEqual([
        { player: 1, pick: 1, right: true, points: 100 },
        { player: 3, pick: 0, right: false, points: 0 },
      ]);
      expect(client.match().oracle.picks.size).toBe(0);
    }
  }, 60_000);

  it('lets the eliminated tip on who wins the round, face down, and shows everybody the verdict at the end', async () => {
    const [host, ben, cleo, dora] = await startTable(['Anna', 'Ben', 'Cleo', 'Dora']);
    const hm = host.match();
    const everybody = [host, ben, cleo, dora];
    hm.world.planets = [];
    [[100, 400], [500, 400], [900, 200], [900, 600]].forEach(([x, y], i) => Object.assign(hm.world.ships[i], { x, y }));
    await tick(everybody, 5);

    // Anna shoots Ben, then Cleo shoots Dora: Ben tips on Cleo while Cleo is on turn, Dora once she is out.
    host.session.input({ kind: 'aim', angle: 0, power: 50 });
    host.session.input({ kind: 'fire' });
    for (let i = 0; i < 600 && !(hm.phase === 'aiming' && hm.current === 2); i++) await tick(everybody);
    await tick(everybody, 5);
    expect(ben.match().oracle.roundQuestion).toMatchObject({ kind: 'winner', choices: [0, 2, 3] });
    ben.session.input({ kind: 'bet', pick: 2, round: true });
    expect(ben.match().oracle.roundMine).toMatchObject({ pick: 2 });
    await tick(everybody, 5);
    // Everybody sees that somebody tipped, nobody sees what — and it has not touched the tip on the shot.
    for (const client of everybody) expect([...client.match().oracle.roundTippers]).toEqual([1]);
    expect(dora.match().oracle.roundMine).toBeNull();
    expect(hm.oracle.picks.size).toBe(0);

    // A tampered client cannot tip on the round while alive.
    cleo.session.client.send({ type: 'input', input: { kind: 'bet', pick: 0, round: true } });
    await tick(everybody, 5);
    expect([...hm.oracle.roundTippers]).toEqual([1]);

    cleo.session.input({ kind: 'aim', angle: 270, power: 50 });
    cleo.session.input({ kind: 'fire' });
    for (let i = 0; i < 600 && !(hm.phase === 'aiming' && hm.current === 0 && !hm.players[3].alive); i++) await tick(everybody);
    await tick(everybody, 5);
    dora.session.input({ kind: 'bet', pick: 0, round: true });
    await tick(everybody, 5);
    expect([...hm.oracle.roundTippers].sort()).toEqual([1, 3]);

    // Anna hits Cleo and wins: Dora was right with two ships in (100), Ben was not.
    host.session.input({ kind: 'aim', angle: 14.04, power: 100 });
    host.session.input({ kind: 'fire' });
    for (let i = 0; i < 900 && hm.phase !== 'roundOver'; i++) await tick(everybody);
    await tick(everybody, 5);
    for (const client of everybody) {
      expect(client.match().oracle.roundResult).toMatchObject({ winners: [0], tips: [{ player: 1, pick: 2, right: false }, { player: 3, pick: 0, right: true, points: 100 }] });
      expect(client.match().oracle.roundQuestion).toBeNull();
    }
  }, 60_000);

  it('has the relay pass a tip on the round to the host as it is, and refuse one whose flag or stake is malformed', async () => {
    const [host, ben] = await startTable(['Anna', 'Ben']);
    const guest = ben.session.client as RustTransport;
    for (const bad of [{ round: 'yes' }, { round: true, stake: -10 }, { round: true, stake: '100' }, { round: true, stake: 2.5 }]) {
      const rejected = guest.waitForMessage((message) => message.type === 'error' && message.message === 'Malformed input message');
      guest.rawSocket!.send(packMessage({ type: 'input', input: { kind: 'bet', pick: 1, ...bad } }));
      await rejected;
    }

    const relayed = (host.session.client as RustTransport).waitForMessage(
      (message) => message.type === 'input' && message.from === 1 && message.input.kind === 'bet' && message.input.round === true && message.input.stake === 100,
    );
    guest.rawSocket!.send(packMessage({ type: 'input', input: { kind: 'bet', pick: 1, round: true, stake: 100 } }));
    await relayed;
  }, 60_000);

  it('lets the eliminated stake points on the round through the relay, and pays the pot out on every screen', async () => {
    const [host, ben, cleo, dora] = await startTable(['Anna', 'Ben', 'Cleo', 'Dora'], true);
    const hm = host.match();
    const everybody = [host, ben, cleo, dora];
    hm.world.planets = [];
    [[100, 400], [500, 400], [900, 200], [900, 600]].forEach(([x, y], i) => Object.assign(hm.world.ships[i], { x, y }));
    await tick(everybody, 5);
    expect(hm.settings.betting).toBe(true);

    host.session.input({ kind: 'aim', angle: 0, power: 50 });
    host.session.input({ kind: 'fire' });
    for (let i = 0; i < 600 && !(hm.phase === 'aiming' && hm.current === 2); i++) await tick(everybody);
    // Ben is out with 400 points: he may stake 100 or 200. He bets 200 on Cleo.
    hm.players[1].score = 400;
    await tick(everybody, 5);
    ben.session.input({ kind: 'bet', pick: 2, round: true, stake: 200 });
    await tick(everybody, 5);
    for (const client of everybody) {
      expect(client.match().oracle.stakeOf(1)).toBe(200);
      expect(client.match().oracle.pot).toBe(200);
      expect(client.match().players[1].score).toBe(200);
    }

    cleo.session.input({ kind: 'aim', angle: 270, power: 50 });
    cleo.session.input({ kind: 'fire' });
    for (let i = 0; i < 600 && !(hm.phase === 'aiming' && hm.current === 0 && !hm.players[3].alive); i++) await tick(everybody);
    // Dora is out with 800 points and bets her most, 400, on Anna.
    hm.players[3].score = 800;
    await tick(everybody, 5);
    dora.session.input({ kind: 'bet', pick: 0, round: true, stake: 400 });
    await tick(everybody, 5);
    for (const client of everybody) expect(client.match().oracle.pot).toBe(600);
    // A stake the tampered client has no points for is not taken.
    ben.session.client.send({ type: 'input', input: { kind: 'bet', pick: 2, round: true, stake: 100 } });
    await tick(everybody, 5);
    expect(hm.players[1].score).toBe(200);

    host.session.input({ kind: 'aim', angle: 14.04, power: 100 });
    host.session.input({ kind: 'fire' });
    for (let i = 0; i < 900 && hm.phase !== 'roundOver'; i++) await tick(everybody);
    await tick(everybody, 5);
    // Anna wins: Dora takes the pot (600) for her 400, Ben loses his 200.
    const before = { ben: 200, dora: 400 };
    for (const client of everybody) {
      expect(client.match().oracle.roundResult!.tips).toMatchObject([
        { player: 1, right: false, stake: 200, payout: 0 },
        { player: 3, right: true, stake: 400, payout: 600 },
      ]);
      expect(client.match().players[1].score).toBe(before.ben);
      expect(client.match().players[3].score).toBe(before.dora + 600);
      expect(client.match().oracle.pot).toBe(0);
    }
  }, 60_000);

  it('plays without bets unless the room allows them: the tip counts, the stake does not', async () => {
    const [host, ben, cleo, dora] = await startTable(['Anna', 'Ben', 'Cleo', 'Dora']);
    const hm = host.match();
    const everybody = [host, ben, cleo, dora];
    hm.world.planets = [];
    [[100, 400], [500, 400], [900, 200], [900, 600]].forEach(([x, y], i) => Object.assign(hm.world.ships[i], { x, y }));
    await tick(everybody, 5);
    expect(hm.settings.betting).toBe(false);
    for (const client of everybody) expect(client.match().settings.betting).toBe(false);

    host.session.input({ kind: 'aim', angle: 0, power: 50 });
    host.session.input({ kind: 'fire' });
    for (let i = 0; i < 600 && !(hm.phase === 'aiming' && hm.current === 2); i++) await tick(everybody);
    hm.players[1].score = 400;
    await tick(everybody, 5);
    ben.session.input({ kind: 'bet', pick: 2, round: true, stake: 200 });
    await tick(everybody, 5);
    for (const client of everybody) {
      expect([...client.match().oracle.roundTippers]).toEqual([1]);
      expect(client.match().oracle.pot).toBe(0);
      expect(client.match().players[1].score).toBe(400);
    }
  }, 60_000);
});

describe('the lobby look online', () => {
  it('lists public rooms by number with their symbol and colour, and keeps private ones out of the list until the host opens them', async () => {
    const host = await connectSession();
    const watcher = await connectSession();
    host.createRoom({ name: 'Anna', mode: 'ffa', gameMode: 'classic', rules, maxPlayers: 2, look: { visibility: 'public', symbol: 'comet', color: '#62b6ff' } });
    await waitForSession(host, () => host.room !== null);
    await waitForSession(watcher, () => watcher.rooms.length === 1);
    expect(watcher.rooms[0]).toMatchObject({ host: 'Anna', symbol: 'comet', color: '#62b6ff' });
    expect(watcher.rooms[0].number).toBe(host.room!.number);
    const publicId = watcher.rooms[0].id;

    const secret = await connectSession();
    secret.createRoom({ name: 'Ben', mode: 'ffa', gameMode: 'classic', rules, maxPlayers: 2, look: { visibility: 'private' } });
    await waitForSession(secret, () => secret.room !== null);
    expect(secret.room).toMatchObject({ visibility: 'private', symbol: 'planet' });
    const privateId = secret.room!.id;
    // The watcher hears about the public room only.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(watcher.rooms.map((room) => room.id)).toEqual([publicId]);

    // Opening the room puts it in the list; the host's change reaches the watcher.
    secret.setRoomLook({ visibility: 'public', symbol: 'ufo', color: '#ff6f9f' });
    await waitForSession(watcher, () => watcher.rooms.length === 2);
    expect(watcher.rooms.find((room) => room.id === privateId)).toMatchObject({ symbol: 'ufo', color: '#ff6f9f' });
  });

  it('lets anybody who has the code join a private room', async () => {
    const host = await connectSession();
    const guest = await connectSession();
    host.createRoom({ name: 'Anna', mode: 'ffa', gameMode: 'classic', rules, maxPlayers: 2, look: { visibility: 'private' } });
    await waitForSession(host, () => host.room !== null);
    guest.joinRoom(host.room!.id, 'Ben');
    await waitForSession(guest, () => guest.room?.players.length === 2);
    expect(guest.room).toMatchObject({ id: host.room!.id, visibility: 'private' });
  });

  it('lets only the host change how the room shows up, and only while it waits', async () => {
    const host = await connectSession();
    const guest = await connectSession();
    host.createRoom({ name: 'Anna', mode: 'ffa', gameMode: 'classic', rules, maxPlayers: 2 });
    await waitForSession(host, () => host.room !== null);
    guest.joinRoom(host.room!.id, 'Ben');
    await waitForSession(guest, () => guest.room?.players.length === 2);

    guest.setRoomLook({ visibility: 'public', symbol: 'ufo', color: '#ff6f9f' });
    await waitForSession(guest, () => guest.notice !== null);
    expect(guest.notice).toMatch(/host/i);
    expect(guest.room!.symbol).toBe('planet');

    host.setRoomLook({ visibility: 'public', symbol: 'moon', color: '#c6e86a' });
    await waitForSession(guest, () => guest.room?.symbol === 'moon');
    expect(guest.room).toMatchObject({ color: '#c6e86a' });

    guest.setReady(true);
    await waitForSession(host, () => host.room!.players[1].ready);
    host.startGame();
    await waitForSession(guest, () => guest.match !== null);
    host.setRoomLook({ visibility: 'public', symbol: 'star', color: '#ffd27a' });
    await waitForSession(host, () => host.notice !== null);
    expect(host.notice).toMatch(/running/i);
    expect(host.room!.symbol).toBe('moon');
  });
});

describe('the player symbols online', () => {
  it('lets a player rename in the waiting room and refuses a profane name', async () => {
    const host = await connectSession();
    const guest = await connectSession();
    host.createRoom({ name: 'Anna', mode: 'ffa', gameMode: 'classic', rules, maxPlayers: 2 });
    await waitForSession(host, () => host.room !== null);
    guest.joinRoom(host.room!.id, 'Ben');
    await waitForSession(host, () => host.room?.players.length === 2);

    guest.setName('Benedikt');
    await waitForSession(host, () => host.room!.players[1].name === 'Benedikt');

    guest.setName('fuck');
    await waitForSession(guest, () => guest.notice === 'That name is not allowed');
    expect(guest.nameNotice).toBe('That name is not allowed');
    expect(host.room!.players[1].name).toBe('Benedikt');

    // Another refusal is not about the name, and a new attempt clears the old name error.
    // The relay lets a connection rename once a second.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    guest.setName('Benno');
    expect(guest.nameNotice).toBeNull();
    guest.setReady(true);
    await waitForSession(host, () => host.room!.players[1].name === 'Benno' && host.room!.players[1].ready);
    guest.setName('Benedikt');
    await waitForSession(guest, () => guest.nameNotice === 'Wait a moment before changing your name again');
    await new Promise((resolve) => setTimeout(resolve, 1100));
    guest.setName('Benedikt');
    await waitForSession(host, () => host.room!.players[1].name === 'Benedikt');
    expect(host.room!.players[1].ready).toBe(false);

    // Nobody else in the room can have the name.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    guest.setName('anna');
    await waitForSession(guest, () => guest.nameNotice === 'That name is taken in this room');
    expect(host.room!.players[1].name).toBe('Benedikt');
  }, 60_000);

  it('shows each player the symbol they picked, in the lobby and in the game on both screens', async () => {
    const hostMatches: NetMatch[] = [];
    const guestMatches: NetMatch[] = [];
    const host = await connectSession({ matchStarted: (match) => { hostMatches.push(match); } });
    const guest = await connectSession({ matchStarted: (match) => { guestMatches.push(match); } });
    host.createRoom({ name: 'Anna', mode: 'ffa', gameMode: 'classic', rules, maxPlayers: 2, avatar: 'gem' });
    await waitForSession(host, () => host.room !== null);
    guest.joinRoom(host.room!.id, 'Ben', undefined, 'alien');
    await waitForSession(host, () => host.room?.players.length === 2);
    expect(host.room!.players.map((player) => player.avatar)).toEqual(['gem', 'alien']);

    guest.setAvatar('bolt');
    await waitForSession(host, () => host.room!.players[1].avatar === 'bolt');
    await waitForSession(guest, () => guest.room?.players[1]?.avatar === 'bolt');

    guest.setReady(true);
    await waitForSession(host, () => host.room!.players[1].ready);
    host.startGame();
    await waitForSession(host, () => hostMatches.length === 1);
    await waitForSession(guest, () => guestMatches.length === 1);
    expect(hostMatches[0].players.map((player) => player.avatar)).toEqual(['gem', 'bolt']);
    expect(guestMatches[0].players.map((player) => player.avatar)).toEqual(['gem', 'bolt']);
  }, 60_000);
});

describe('CPU seats online', () => {
  it('lets the host seat, change and remove CPUs that everybody sees, and makes the humans confirm again', async () => {
    const host = await connectSession();
    const guest = await connectSession();
    host.createRoom({ name: 'Anna', mode: 'ffa', gameMode: 'classic', rules, maxPlayers: 4 });
    await waitForSession(host, () => host.room !== null);
    await waitForSession(guest, () => guest.rooms.some((room) => room.id === host.room!.id));
    guest.joinRoom(host.room!.id, 'Ben');
    await waitForSession(host, () => host.room?.players.length === 2);
    guest.setReady(true);
    await waitForSession(host, () => host.room!.players[1].ready);

    host.addCpu('hawking');
    await waitForSession(guest, () => guest.room?.players.length === 3);
    expect(guest.room!.players[2]).toMatchObject({ cpu: 'hawking', name: 'Hawking', ready: true });
    // A CPU changes the game, so Ben has to confirm again.
    expect(guest.room!.players[1].ready).toBe(false);

    // Guests have no say over the CPUs.
    guest.addCpu('easy');
    await waitForSession(guest, () => guest.notice !== null);
    expect(guest.notice).toMatch(/host/i);
    expect(guest.room!.players).toHaveLength(3);

    host.setCpu(2, { level: 'easy' });
    await waitForSession(guest, () => guest.room!.players[2].cpu === 'easy');
    expect(guest.room!.players[2].name).toBe('Kepler');

    host.removeCpu(2);
    await waitForSession(guest, () => guest.room!.players.length === 2);
    await waitForSession(host, () => host.room!.players.length === 2);
    expect(host.room!.players.map((player) => player.cpu)).toEqual([null, null]);
  });

  it('refuses a game against CPUs alone, and gives the newest CPU seat to a person who joins a full room', async () => {
    const hostMatches: NetMatch[] = [];
    const guestMatches: NetMatch[] = [];
    const host = await connectSession({ matchStarted: (match) => { hostMatches.push(match); } });
    const guest = await connectSession({ matchStarted: (match) => { guestMatches.push(match); } });
    host.createRoom({ name: 'Anna', mode: 'ffa', gameMode: 'classic', rules, maxPlayers: 3 });
    await waitForSession(host, () => host.room !== null);
    host.addCpu('medium');
    host.addCpu('hard');
    await waitForSession(host, () => host.room?.players.length === 3);

    host.startGame();
    await waitForSession(host, () => host.notice !== null);
    expect(host.notice).toMatch(/singleplayer/i);
    expect(hostMatches).toHaveLength(0);

    // The room is full, but its newest CPU (the hard one) gives its seat to Ben.
    await waitForSession(guest, () => guest.rooms.some((room) => room.id === host.room!.id));
    guest.joinRoom(host.room!.id, 'Ben');
    await waitForSession(host, () => host.room?.players.some((player) => player.name === 'Ben') === true);
    expect(host.room!.players.map((player) => player.cpu)).toEqual([null, 'medium', null]);

    guest.setReady(true);
    await waitForSession(host, () => host.room!.players[2].ready);
    host.startGame();
    await waitForSession(host, () => hostMatches.length === 1);
    await waitForSession(guest, () => guestMatches.length === 1);
    expect(hostMatches[0].players.map((player) => player.cpu)).toEqual([null, 'medium', null]);
    expect(guestMatches[0].players.map((player) => player.cpu)).toEqual([null, 'medium', null]);
    // The host's copy runs the CPU's turns; a few seconds of game are enough to see it work.
    for (let i = 0; i < 300; i++) hostMatches[0].update(1 / 60);
    expect(hostMatches[0].players[1].cpu).toBe('medium');
  }, 60_000);

  it('seats a CPU in the team the host names, and the teams have to be real', async () => {
    const host = await connectSession();
    const guest = await connectSession();
    host.createRoom({ name: 'Anna', mode: 'team', gameMode: 'classic', rules, maxPlayers: 4 });
    await waitForSession(host, () => host.room !== null);
    await waitForSession(guest, () => guest.rooms.some((room) => room.id === host.room!.id));
    guest.joinRoom(host.room!.id, 'Ben');
    await waitForSession(host, () => host.room?.players.length === 2);

    host.addCpu('easy', 1);
    await waitForSession(guest, () => guest.room?.players.length === 3);
    expect(guest.room!.players[2].team).toBe(1);

    host.setCpu(2, { team: 0 });
    await waitForSession(guest, () => guest.room!.players[2].team === 0);

    // Only team rooms have teams, and a team is 0 or 1.
    host.setCpu(2, { team: 2 as 0 });
    await waitForSession(host, () => host.notice !== null);
    expect(host.notice).toMatch(/team must be 0 or 1/i);
  });

  describe('Mayhem', () => {
    it("plays every round by its own twists, and shows the guest the same ones and the same rules", async () => {
      for (const mode of ['classic', 'horizon'] as const) {
        const { host, guest } = await startRoom(mode, ['Anna', 'Ben'], { ...rules, mayhem: 2 });
        expect(host.match().mayhem).not.toBeNull();
        expect(host.match().revealing).toBe(true);
        for (let i = 0; i < 12; i++) await frame(host, guest);
        expect(guest.match().mayhem).toEqual(host.match().mayhem);
        expect(guest.match().settings).toEqual(host.match().settings);
        expect(guest.match().revealing).toBe(true);
      }
    }, 30_000);

    it('leaves ending the announcement to the host, for everybody', async () => {
      const { host, guest } = await startRoom('horizon', ['Anna', 'Ben'], { ...rules, mayhem: 3 });
      expect(host.match().canAim(1)).toBe(false);
      guest.session.input({ kind: 'fire' });
      for (let i = 0; i < 12; i++) await frame(host, guest);
      expect(host.match().revealing).toBe(true);
      host.session.input({ kind: 'fire' });
      for (let i = 0; i < 12; i++) await frame(host, guest);
      expect(host.match().revealing).toBe(false);
      expect(guest.match().revealing).toBe(false);
      expect(host.match().canAim(1)).toBe(true);
      expect(host.match().players.every((p) => !p.locked)).toBe(true);
    }, 30_000);

    it('lists a Mayhem room as one, with the mode its rounds are played in', async () => {
      const host = await connectSession();
      const plain = await connectSession();
      const watcher = await connectSession();
      host.createRoom({ name: 'Anna', mode: 'ffa', gameMode: 'horizon', rules: { ...rules, mayhem: 3 }, maxPlayers: 2 });
      plain.createRoom({ name: 'Ben', mode: 'ffa', gameMode: 'classic', rules, maxPlayers: 2 });
      await waitForSession(watcher, () => watcher.rooms.length === 2);
      expect(watcher.rooms.find((room) => room.host === 'Anna')).toMatchObject({ gameMode: 'horizon', mayhem: 3 });
      expect(watcher.rooms.find((room) => room.host === 'Ben')).toMatchObject({ gameMode: 'classic', mayhem: 0 });
    }, 30_000);

    it('plays a Mayhem room by the rules it was made with: trick shots always on, its flight time, and simultaneous shots in Classic only', async () => {
      const chosen = { mayhem: 2, rounds: 3, shotTime: 30, simultaneousShots: true };
      for (const mode of ['classic', 'horizon'] as const) {
        const { host, guest } = await startRoom(mode, ['Anna', 'Ben'], mayhemRules(chosen, mode));
        for (const side of [host, guest]) {
          expect(side.match().settings).toMatchObject({ mayhem: 2, rounds: 3, shotTime: 30, styleBonuses: true, betting: false });
          expect(side.match().settings.simultaneousShots).toBe(mode === 'classic');
        }
        expect(host.match().salvo).toBe(true);
      }
    }, 30_000);

    it('plays without twists when it is off', async () => {
      const { host, guest } = await startRoom('classic', ['Anna', 'Ben'], rules);
      for (let i = 0; i < 6; i++) await frame(host, guest);
      expect(host.match().mayhem).toBeNull();
      expect(guest.match().mayhem).toBeNull();
    }, 30_000);
  });

  describe('power-ups', () => {
    const powerRules: RoomRules = { ...rules, simultaneousShots: true, powerUps: true, powerUpKinds: ['teleport', 'splitter'], powerUpAmount: 3 };
    type Inner = { power: { scene(): { placement: { owner: number; target: unknown } | null } } };

    it("plays them by the room's rules, in Classic and Event Horizon, and shows the guest the same pickups", async () => {
      for (const mode of ['classic', 'horizon'] as const) {
        const { host, guest } = await startRoom(mode, ['Anna', 'Ben'], { ...powerRules, simultaneousShots: false });
        expect(host.match().settings).toMatchObject({ powerUps: true, powerUpKinds: ['teleport', 'splitter'], powerUpAmount: 3 });
        expect(guest.match().settings).toMatchObject({ powerUps: true, powerUpKinds: ['teleport', 'splitter'], powerUpAmount: 3 });
        expect(host.match().pickups).toHaveLength(3);
        for (let i = 0; i < 12; i++) await frame(host, guest);
        expect(guest.match().pickups).toEqual(host.match().pickups);
        for (const pickup of host.match().pickups) expect(['teleport', 'splitter']).toContain(pickup.kind);
      }
    }, 30_000);

    it('lets a guest aim a teleport, jump with fire, and everybody sees the ship move', async () => {
      const { host, guest } = await startRoom('classic', ['Anna', 'Ben'], powerRules);
      const before = { ...host.match().world.ships[1] };
      host.match().players[1].powerUp = 'teleport';
      const events: string[] = [];
      guest.match().on((e) => events.push(e.type));

      guest.session.input({ kind: 'aim', angle: 0, power: 50 });
      guest.session.input({ kind: 'power' });
      for (let i = 0; i < 12; i++) await frame(host, guest);
      // Only the ship aiming sees its spot: the host's own screen is the other player's.
      expect((host.match() as unknown as Inner).power.scene().placement).toBeNull();
      const aimed = (guest.match() as unknown as Inner).power.scene().placement;
      expect(aimed?.owner).toBe(1);
      expect(aimed?.target).not.toBeNull();

      guest.session.input({ kind: 'fire' });
      for (let i = 0; i < 12; i++) await frame(host, guest);
      // The salvo is not over until the host has locked in too: the jump waits for the volley.
      expect(host.match().players[1].locked).toBe(true);
      expect(host.match().world.ships[1]).toMatchObject(before);
      expect(host.match().players[1].powerUp).toBe('teleport');
      host.session.input({ kind: 'fire' });
      for (let i = 0; i < 60 && host.match().phase === 'aiming'; i++) await frame(host, guest);
      for (let i = 0; i < 12; i++) await frame(host, guest);
      const after = host.match().world.ships[1];
      expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeGreaterThan(0);
      expect(host.match().players[1].powerUp).toBeNull();
      expect(guest.match().world.ships[1].x).toBeCloseTo(after.x, 5);
      expect(events).toContain('teleport');
    }, 30_000);

    it("keeps a guest from aiming somebody else's teleport", async () => {
      const { host, guest } = await startRoom('classic', ['Anna', 'Ben'], powerRules);
      host.match().players[0].powerUp = 'teleport';
      const start = { ...host.match().world.ships[0] };
      guest.session.input({ kind: 'power' });
      for (let i = 0; i < 12; i++) await frame(host, guest);
      expect(host.match().players[0].powerUp).toBe('teleport');
      expect(host.match().world.ships[0]).toMatchObject({ x: start.x, y: start.y });
    }, 30_000);

    it('splits a guest\'s shot in the air when the guest presses fire again', async () => {
      const { host, guest } = await startRoom('classic', ['Anna', 'Ben'], powerRules);
      host.match().players[1].powerUp = 'splitter';
      host.match().players[1].armed = true;
      guest.session.input({ kind: 'aim', angle: 90, power: 40 });
      guest.session.input({ kind: 'fire' });
      host.session.input({ kind: 'aim', angle: 270, power: 40 });
      host.session.input({ kind: 'fire' });
      for (let i = 0; i < 240 && host.match().phase !== 'flying'; i++) await frame(host, guest);
      expect(host.match().phase).toBe('flying');
      guest.session.input({ kind: 'fire' });
      for (let i = 0; i < 6; i++) await frame(host, guest);
      expect(host.match().volley!.shots.length).toBe(4);
      expect(host.match().players[1].powerUp).toBeNull();
    }, 30_000);
  });
});

describe('spectators online', () => {
  /** Two players and any number of spectators who walk into the running, public room. */
  async function startStands(fans: string[], roomRules: Partial<RoomRules> = {}): Promise<{ players: Client[]; stands: Client[] }> {
    const { host, guest } = await startRoom('classic', ['Anna', 'Ben'], { ...rules, fixedPower: false, bounce: false, ...roomRules });
    const stands: Client[] = [];
    for (const name of fans) {
      let fanMatch: NetMatch | null = null;
      const session = await connectSession({ matchStarted: (match) => { fanMatch = match; } });
      await waitForSession(session, () => session.rooms.some((room) => room.id === host.session.room!.id));
      session.joinRoom(host.session.room!.id, name, undefined, undefined, true);
      await waitForSession(session, () => fanMatch !== null);
      stands.push({ session, match: () => fanMatch!, syncElapsed: 0 });
    }
    return { players: [host, guest], stands };
  }

  const tick = async (clients: Client[], frames = 1): Promise<void> => {
    for (let index = 0; index < frames; index++) {
      const stateReceived = clients.slice(1).map((client) => (client.session.client as RustTransport).waitForMessage((message) => message.type === 'state'));
      clients[0].match().update(1 / 30);
      for (const client of clients) client.session.update(1 / 30);
      await Promise.all(stateReceived);
    }
  };

  it('lets a spectator walk into a running game, see the same match, and do nothing but bet', async () => {
    const { players, stands } = await startStands(['Fan']);
    const [host, guest] = players;
    const [fan] = stands;
    const everybody = [host, guest, fan];
    await tick(everybody, 5);

    expect(fan.session.isSpectator).toBe(true);
    expect(fan.match().spectating).toBe(true);
    expect(fan.match().viewer).toBeNull();
    expect(fan.match().localCanAim).toBe(false);
    // The keyframe request gave the latecomer a complete picture, not a patch on nothing.
    expect(fan.match().round).toBe(host.match().round);
    expect(fan.match().players.map((p) => p.name)).toEqual(['Anna', 'Ben']);
    expect(host.session.room!.spectators.map((s) => s.name)).toEqual(['Fan']);
    expect(guest.session.you.spectator).toBeUndefined();

    // Aiming and firing from the stands go nowhere; a tampered client is told off.
    const before = host.match().players.map((p) => ({ angle: p.angle, power: p.power, locked: p.locked }));
    fan.session.input({ kind: 'aim', angle: 33, power: 77 });
    fan.session.input({ kind: 'fire' });
    fan.session.client.send({ type: 'input', input: { kind: 'aim', angle: 33, power: 77 } });
    await waitForSession(fan.session, () => fan.session.notice === 'Spectators can only bet');
    await tick(everybody, 3);
    expect(host.match().players.map((p) => ({ angle: p.angle, power: p.power, locked: p.locked }))).toEqual(before);

    // Leaving the stands does not end the game.
    fan.session.leaveRoom();
    await waitForSession(host.session, () => host.session.room!.spectators.length === 0);
    expect(host.session.room!.status).toBe('playing');
    expect(host.match().crowd.seats.every((seat) => !seat.present)).toBe(true);
  }, 30_000);

  it('lets everybody in the room talk, with the relay starring out profanity, and tells the sender when it is refused', async () => {
    const { players, stands } = await startStands(['Fan']);
    const [host, guest] = players;
    const [fan] = stands;
    host.session.sendChat('  gg you shit  ');
    await waitForSession(host.session, () => host.session.chat.length === 1);
    await waitForSession(fan.session, () => fan.session.chat.length === 1);
    await waitForSession(guest.session, () => guest.session.chat.length === 1);
    for (const watcher of [host, guest, fan]) {
      const [line] = watcher.session.chat;
      expect(line).toMatchObject({ name: 'Anna', id: 0, spectator: false });
      expect(line.text.startsWith('gg you ') && !line.text.includes('shit')).toBe(true);
    }
    expect(fan.session.canChat).toBe(true);
    fan.session.sendChat('nice game');
    await waitForSession(host.session, () => host.session.chat.length === 2);
    expect(host.session.chat[1]).toMatchObject({ name: 'Fan', spectator: true, text: 'nice game' });

    // A flood is cut off after five, and the relay says so in the chat.
    for (let i = 0; i < 8; i++) guest.session.sendChat(`spam ${i}`);
    await waitForSession(guest.session, () => guest.session.chat.some((line) => line.system));
    expect(guest.session.chat.find((line) => line.system)!.text).toBe('You are writing too fast');
  }, 30_000);

  it('lets the host keep the chat to the players: spectators read along but cannot write', async () => {
    const { players, stands } = await startStands(['Fan'], { chatPlayersOnly: true });
    const [host] = players;
    const [fan] = stands;
    expect(fan.session.canChat).toBe(false);
    expect(host.session.canChat).toBe(true);
    // The input is closed on a spectator's screen; a client that ignores that is refused by the relay.
    fan.session.sendChat('let me in');
    expect(fan.session.chat).toEqual([]);
    fan.session.client.send({ type: 'chat', text: 'let me in' });
    await waitForSession(fan.session, () => fan.session.chat.some((line) => line.system));
    expect(fan.session.chat[0].text).toBe('Only the players can write in this room');
    expect(host.session.chat).toEqual([]);

    host.session.sendChat('players only');
    await waitForSession(fan.session, () => fan.session.chat.some((line) => line.text === 'players only'));
  }, 30_000);

  it('lets the stands play the oracle: odds from their bets, a pot of their own, paid into bankrolls and not into scores', async () => {
    const { players, stands } = await startStands(['Fan', 'Gus']);
    const [host, guest] = players;
    const [fan, gus] = stands;
    const everybody = [host, guest, fan, gus];
    const hm = host.match();
    hm.world.planets = [];
    Object.assign(hm.world.ships[0], { x: 100, y: 400 });
    Object.assign(hm.world.ships[1], { x: 500, y: 400 });
    await tick(everybody, 5);

    // Nobody is out, and the stands can already bet on who wins the round.
    expect(hm.stands.roundQuestion).not.toBeNull();
    expect(hm.crowd.seats.map((seat) => seat.balance)).toEqual([500, 500]);
    const [fanId, gusId] = [fan.session.you.spectatorId!, gus.session.you.spectatorId!];
    fan.session.input({ kind: 'bet', pick: 1, round: true, stake: 250 });
    gus.session.input({ kind: 'bet', pick: 0, round: true, stake: 120 });
    await tick(everybody, 5);
    // The odds are the pot over what is on a side, and every screen can work them out.
    for (const watcher of [hm, fan.match(), gus.match()]) {
      expect(watcher.stands.pot).toBe(370);
      expect(watcher.stands.oddsFor(1, (pick) => watcher.sideOf(pick))).toBeCloseTo(370 / 250);
      expect(watcher.stands.oddsFor(0, (pick) => watcher.sideOf(pick))).toBeCloseTo(370 / 120);
      expect(watcher.crowd.seat(fanId)!.balance).toBe(250);
    }
    // Their points are not the players': the ghosts' pot is empty, and the tips stay face down.
    expect(hm.oracle.pot).toBe(0);
    expect(fan.match().stands.roundTippers.has(gusId)).toBe(true);

    // Anna shoots Ben. Bets do not reach the host after the shot is away.
    host.session.input({ kind: 'aim', angle: 0, power: 50 });
    host.session.input({ kind: 'fire' });
    for (let i = 0; i < 600 && hm.phase !== 'flying'; i++) await tick(everybody);
    gus.session.input({ kind: 'bet', pick: 1, round: true, stake: 120 });
    await tick(everybody, 3);
    expect(hm.stands.stakeOf(gusId)).toBe(120);

    for (let i = 0; i < 900 && hm.phase !== 'roundOver'; i++) await tick(everybody);
    expect(hm.phase).toBe('roundOver');
    await tick(everybody, 5);
    // Gus was the only one right, so the whole pot is his; Anna's score is only what she shot for.
    for (const watcher of [hm, fan.match(), gus.match()]) {
      expect(watcher.stands.roundResult?.winners).toEqual([0]);
      expect(watcher.crowd.seats.map((seat) => seat.balance)).toEqual([250, 750]);
    }
    expect(hm.players[0].score).toBe(1000);
    expect(hm.players[1].score).toBe(0);
  }, 90_000);
});

describe('statistics and replays', () => {
  it('a game played on the relay can be flown again from what the relay kept, with the same result', async () => {
    let hostMatch: NetMatch | null = null;
    const hostSession = await connectSession({ matchStarted: (match) => { hostMatch = match; } });
    const guestSession = await connectSession();
    const playRules: RoomRules = { ...rules, rounds: 2, maxPlanets: 5, bounce: false, fixedPower: false, powerUps: true, powerUpAmount: 4, powerUpKinds: [...POWER_UP_KINDS] };
    hostSession.createRoom({ name: 'Anna', mode: 'ffa', gameMode: 'classic', rules: playRules, maxPlayers: 3 });
    await waitForSession(hostSession, () => hostSession.room !== null);
    await waitForSession(guestSession, () => guestSession.rooms.some((room) => room.id === hostSession.room!.id));
    guestSession.joinRoom(hostSession.room!.id, 'Ben');
    await waitForSession(hostSession, () => hostSession.room?.players.length === 2);
    hostSession.addCpu('hard');
    await waitForSession(hostSession, () => hostSession.room?.players.length === 3);
    guestSession.setReady(true);
    await waitForSession(hostSession, () => hostSession.room!.players.slice(1).every((player) => player.ready));
    hostSession.startGame();
    await waitForSession(hostSession, () => hostMatch !== null);
    const match = hostMatch!;

    // Both people shoot at whatever their own angle says; the CPU thinks for itself.
    const dt = 1 / 30;
    for (let i = 0; i < 60_000 && match.phase !== 'gameOver'; i++) {
      for (const p of match.players) {
        if (p.cpu || !match.canAim(p.id)) continue;
        match.setPlayerAim(p.id, 20 + ((i * 37 + p.id * 91) % 140), 35 + ((i * 13) % 55));
        match.commitPlayer(p.id);
      }
      match.update(dt);
      hostSession.update(dt);
      if (match.phase === 'roundOver' && match.phaseTime > 1) match.advance();
      // Let the sockets run now and then: a loop that never yields leaves the guest unread, and the relay
      // drops a client whose backlog grows (which ends the game early and nothing is kept for it).
      if (i % 200 === 199) await new Promise((resolve) => setImmediate(resolve));
    }
    expect(match.phase).toBe('gameOver');

    // The relay writes behind a queue: ask until the game is on the list and flyable.
    const board = () => new StatsBoard(() => { const transport = new RustTransport(); transport.setAddress(serverUrl); return transport; });
    let game;
    for (let i = 0; i < 100 && !game; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const overview = await board().overview();
      game = overview.games.find((g) => g.replay);
    }
    expect(game, 'the game is on the list and can be flown again').toBeDefined();
    expect(game!.rounds).toBe(2);
    const data = await board().replay(game!.id);
    expect(data).not.toBeNull();
    expect(data!.seats).toHaveLength(3);

    // Fly it from what the relay has: the same ships end up with the same scores.
    const again = netMatch({ ...data!, players: data!.seats }, DEFAULT_SETTINGS, { script: { turns: data!.turns } })!;
    for (let i = 0; i < 60_000 && again.replayState === 'playing' && again.phase !== 'gameOver'; i++) again.update(dt);
    expect(again.replayState).not.toBe('drifted');
    expect(again.phase).toBe('gameOver');
    expect(again.players.map((p) => Math.round(p.score))).toEqual(match.players.map((p) => Math.round(p.score)));
    expect(again.round).toBe(match.round);
  }, 120_000);

  it('keeps a game played on one device, without turns, and lists it as local and not to be watched again', async () => {
    const seats = ['medium', 'hard', 'off', 'off', 'off', 'off'] as const;
    const settings = { ...cloneSettings(DEFAULT_SETTINGS), rounds: 2, seats: [...seats] };
    const match = createMatch('horizon', settings, { seats: [...seats], seed: 6, deterministicCpu: true });
    let report: LocalGameReport | null = null;
    trackLocalGame(match, settings, (sent) => { report = sent; });
    for (let i = 0; i < 100_000 && match.phase !== 'gameOver'; i++) {
      match.update(1 / 30);
      if (match.phase === 'roundOver' && match.phaseTime > 1) match.advance();
    }
    expect(report).not.toBeNull();
    const transport = new RustTransport();
    transport.setAddress(serverUrl);
    await reportLocalGame(report!, transport);

    const board = () => new StatsBoard(() => { const t = new RustTransport(); t.setAddress(serverUrl); return t; });
    let game;
    for (let i = 0; i < 100 && !game; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      game = (await board().overview()).games.find((g) => g.local && g.gameMode === 'horizon');
    }
    expect(game, 'the game is on the list').toBeDefined();
    expect(game).toMatchObject({ local: true, replay: false, rounds: 2, cpus: 2, humans: 0 });
    expect(await board().replay(game!.id)).toBeNull();
  }, 60_000);

  it('keeps the game when a guest\'s connection drops and comes back', async () => {
    const { host, guest } = await startRoom('classic');
    const guestTransport = guest.session.client as RustTransport;
    const held = waitForSession(host.session, () => host.session.room?.players[1].connected === false);
    guestTransport.rawSocket!.terminate();
    await held;
    // The room and the game are still there, only the seat is marked.
    expect(host.session.room?.status).toBe('playing');
    expect(guest.session.match).not.toBeNull();
    await waitForSession(host.session, () => host.session.room?.players[1].connected === true);
    await waitForSession(guest.session, () => !guest.session.reconnecting && guest.session.connected);
    expect(guest.session.room?.status).toBe('playing');
    expect(guest.session.you.playerId).toBe(1);
    // The host's next frame reaches the guest over the new connection.
    const state = guestTransport.waitForMessage((message) => message.type === 'state');
    host.session.update(1 / 30);
    await state;
    expect(host.session.room?.status).toBe('playing');
  }, 30_000);

  it('keeps the room when the host\'s connection drops and comes back', async () => {
    const { host, guest } = await startRoom('classic');
    const hostTransport = host.session.client as RustTransport;
    const held = waitForSession(guest.session, () => guest.session.room?.players[0].connected === false);
    hostTransport.rawSocket!.terminate();
    await held;
    expect(guest.session.room?.status).toBe('playing');
    await waitForSession(guest.session, () => guest.session.room?.players[0].connected === true);
    await waitForSession(host.session, () => !host.session.reconnecting && host.session.connected);
    expect(host.session.isHost).toBe(true);
    const state = (guest.session.client as RustTransport).waitForMessage((message) => message.type === 'state');
    host.session.update(1 / 30);
    await state;
    expect(guest.session.room?.status).toBe('playing');
  }, 30_000);

  it('keeps the guests posted while the host draws no frames', async () => {
    const { guest } = await startRoom('classic');
    // Nobody calls `update`, as in a hidden tab: the state still comes, from the host's heartbeat.
    await (guest.session.client as RustTransport).waitForMessage((message) => message.type === 'state');
  }, 10_000);
});
