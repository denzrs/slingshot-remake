import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { MultiplayerSession, type NetMatch, type Transport } from '../src/multiplayer';
import type { RoomRules, ServerMessage } from '../src/net';
import { cloneSettings, DEFAULT_SETTINGS } from '../src/settings';

const activeTransports = new Set<RustTransport>();
let serverProcess: ChildProcess;
let serverUrl: string;

class RustTransport implements Transport {
  private url = '';
  private socket: WebSocket | null = null;
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
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    const socket = new WebSocket(this.url);
    this.socket = socket;
    let opened = false;
    socket.on('open', () => { opened = true; resolve(); });
    socket.on('error', (error) => { if (!opened) reject(error); });
    socket.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString()) as ServerMessage;
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
      if (opened) this.listener?.({ type: 'closed', message: 'Test relay connection closed' });
    });
    await promise;
  }

  send(message: Parameters<Transport['send']>[0]): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) throw new Error('WebSocket is not open');
    this.socket.send(JSON.stringify(message));
  }

  async close(): Promise<void> {
    const socket = this.socket;
    this.socket = null;
    if (!socket || socket.readyState === WebSocket.CLOSED) return;
    const closed = once(socket, 'close');
    if (socket.readyState === WebSocket.OPEN) socket.close();
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
  while (serverProcess.exitCode === null) {
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    const socket = new WebSocket(url);
    socket.once('open', () => { socket.close(); resolve(); });
    socket.once('error', reject);
    try { await promise; return; } catch {
      const nextTurn = Promise.withResolvers<void>();
      setImmediate(nextTurn.resolve);
      await nextTurn.promise;
    }
  }
  throw new Error('Rust relay exited before becoming ready');
}

beforeAll(async () => {
  const port = await freePort();
  serverUrl = `ws://127.0.0.1:${port}`;
  const binary = fileURLToPath(new URL('../server/target/release/slingshot-server', import.meta.url));
  serverProcess = spawn(binary, [], {
    env: { ...process.env, PORT: String(port), ALLOW_ALL_ORIGINS: '1', ALLOWED_ORIGINS: '', CONNECTIONS_PER_IP_PER_SECOND: '1000', MAX_MESSAGES_PER_SECOND: '100000', RUST_LOG: process.env.RUST_LOG ?? 'info' },
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

const rules: RoomRules = { rounds: 2, maxPlanets: 3, invisiblePlanets: false, bounce: true, fixedPower: true, fixedPowerLevel: 55, maxPower: 100, shotTime: 30, styleBonuses: true, neighborGrace: 0, simultaneousShots: false, hiddenAim: false, fadingTrails: 0 };

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

async function startRoom(gameMode: 'classic' | 'horizon', names = ['Anna', 'Ben']): Promise<{ host: Client; guest: Client }> {
  let hostMatch: NetMatch | null = null;
  let guestMatch: NetMatch | null = null;
  const hostSession = await connectSession({ matchStarted: (match) => { hostMatch = match; } });
  const guestSession = await connectSession({ matchStarted: (match) => { guestMatch = match; } });
  hostSession.createRoom({ name: names[0], mode: 'ffa', gameMode, rules, maxPlayers: 2 });
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
    for (let i = 0; i < 5; i++) await frame(host, guest);
    expect(hm.phase).not.toBe('killcam');
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
  async function startTable(names: string[]): Promise<Client[]> {
    const clients: Client[] = [];
    const matches: (NetMatch | null)[] = names.map(() => null);
    for (let index = 0; index < names.length; index++) {
      const session = await connectSession({ matchStarted: (match) => { matches[index] = match; } });
      clients.push({ session, match: () => matches[index]!, syncElapsed: 0 });
    }
    const host = clients[0].session;
    host.createRoom({ name: names[0], mode: 'ffa', gameMode: 'classic', rules: { ...rules, fixedPower: false, bounce: false }, maxPlayers: names.length });
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
    // The tip travels to every screen (only the eliminated get it drawn).
    expect(shooter.match().oracle.picks.get(1)).toBe(1);

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
    expect(dora.match().oracle.picks.get(1)).toBe(1);
    dora.session.input({ kind: 'bet', pick: 0 });
    await tick(everybody, 5);
    expect(ben.match().oracle.picks.get(3)).toBe(0);
    expect([...ben.match().oracle.picks]).toEqual([[1, 1], [3, 0]]);

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
});
