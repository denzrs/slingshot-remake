import { describe, expect, it } from 'vitest';
import { RoomManager, type ClientConnection } from '../server/room';
import { MultiplayerSession, type NetMatch, type Transport } from '../src/multiplayer';
import type { RoomRules, ServerMessage } from '../src/net';
import { cloneSettings, DEFAULT_SETTINGS } from '../src/settings';

/** A connection to an in-process relay: messages cross as JSON, like on the wire, but instantly. */
class Loopback implements Transport {
  address = 'loopback';
  private listener: ((message: ServerMessage) => void) | null = null;
  private readonly connection: ClientConnection = {
    send: (message) => this.listener?.(JSON.parse(JSON.stringify(message))),
  };

  constructor(private readonly relay: RoomManager) {}

  setAddress(): void {}
  async connect(): Promise<void> {
    this.relay.connect(this.connection);
  }
  onMessage(listener: (message: ServerMessage) => void): void {
    this.listener = listener;
  }
  send(message: Parameters<Transport['send']>[0]): void {
    this.relay.handle(this.connection, JSON.parse(JSON.stringify(message)));
  }
  close(): void {
    this.relay.disconnect(this.connection);
  }
}

interface Client {
  session: MultiplayerSession;
  /** The match this client mirrors (or runs, for the host). */
  match(): NetMatch;
}

const rules: RoomRules = { rounds: 2, maxPlanets: 3, invisiblePlanets: false, bounce: true, fixedPower: true, shotTime: 30, styleBonuses: true, neighborGrace: false, simultaneousShots: false, hiddenAim: false };

async function startRoom(gameMode: 'classic' | 'horizon', names = ['Anna', 'Ben']): Promise<{ host: Client; guest: Client }> {
  const relay = new RoomManager();
  const make = async (): Promise<Client> => {
    let current: NetMatch | null = null;
    const session = new MultiplayerSession(
      { settings: () => cloneSettings(DEFAULT_SETTINGS), matchStarted: (m) => (current = m), matchRestarted() {}, matchEnded: () => (current = null) },
      new Loopback(relay),
    );
    await session.connect('loopback');
    return { session, match: () => current! };
  };
  const host = await make();
  const guest = await make();
  host.session.createRoom({ name: names[0], mode: 'ffa', gameMode, rules, maxPlayers: 2 });
  guest.session.joinRoom(guest.session.rooms[0].id, names[1]);
  host.session.setReady(true);
  guest.session.setReady(true);
  return { host, guest };
}

/** One frame of the main loop for both clients. */
function frame(host: Client, guest: Client, dt = 1 / 60): void {
  host.match().update(dt);
  host.session.update(dt);
  guest.session.update(dt);
}

describe('online games', () => {
  it("play by the room's rules, not by the players' own settings", async () => {
    const { host, guest } = await startRoom('classic');
    for (const client of [host, guest]) {
      const settings = client.match().settings;
      expect(settings).toMatchObject(rules);
    }
  });

  it('lets the host change the rules while the room waits, and everyone must confirm again', async () => {
    const relay = new RoomManager();
    const connect = async () => {
      const session = new MultiplayerSession({ settings: () => cloneSettings(DEFAULT_SETTINGS), matchStarted() {}, matchRestarted() {}, matchEnded() {} }, new Loopback(relay));
      await session.connect('loopback');
      return session;
    };
    const host = await connect();
    const guest = await connect();
    host.createRoom({ name: 'Anna', mode: 'ffa', gameMode: 'classic', rules, maxPlayers: 3 });
    guest.joinRoom(guest.rooms[0].id, 'Ben');
    guest.setReady(true);
    host.setRules({ ...rules, maxPlanets: 6 });
    expect(guest.room!.rules.maxPlanets).toBe(6);
    expect(guest.room!.players.every((p) => !p.ready)).toBe(true);
    // Guests have no say.
    guest.setRules({ ...rules, maxPlanets: 1 });
    expect(guest.room!.rules.maxPlanets).toBe(6);
    expect(guest.notice).toMatch(/host/i);
  });

  it('let only the host move on from the scorecard', async () => {
    const { host, guest } = await startRoom('classic');
    expect(host.match().canAdvance).toBe(true);
    expect(guest.match().canAdvance).toBe(false);
    const m = host.match();
    for (let i = 0; i < 5; i++) frame(host, guest);
    m.phase = 'roundOver';
    m.phaseTime = 1;
    for (let i = 0; i < 5; i++) frame(host, guest);
    expect(guest.match().phase).toBe('roundOver');

    guest.session.advance();
    for (let i = 0; i < 5; i++) frame(host, guest);
    expect(host.match().phase).toBe('roundOver');
    expect(guest.match().phase).toBe('roundOver');

    host.session.advance();
    for (let i = 0; i < 5; i++) frame(host, guest);
    expect(host.match().phase).not.toBe('roundOver');
    expect(guest.match().phase).not.toBe('roundOver');
  });

  it('keep the names through a rematch, on the host and on the guest', async () => {
    for (const mode of ['classic', 'horizon'] as const) {
      const { host, guest } = await startRoom(mode, ['Anna', 'Ben']);
      const m = host.match();
      for (let i = 0; i < 5; i++) frame(host, guest);
      // Jump to the final standings, as if the last round had just been decided.
      m.phase = 'gameOver';
      m.phaseTime = 1;
      for (let i = 0; i < 5; i++) frame(host, guest);
      expect(guest.match().phase).toBe('gameOver');

      host.session.advance();
      for (let i = 0; i < 5; i++) frame(host, guest);
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
    for (let i = 0; i < 5; i++) frame(host, guest);
    for (let i = 0; i < 60 * 60 && hm.phase !== 'killcam'; i++) {
      if (hm.phase === 'aiming') {
        host.session.input({ kind: 'aim', angle: 0, power: 30 });
        host.session.input({ kind: 'fire' });
        guest.session.input({ kind: 'aim', angle: 90, power: 30 });
        guest.session.input({ kind: 'fire' });
      }
      frame(host, guest);
    }
    expect(hm.phase).toBe('killcam');
    for (let i = 0; i < 30; i++) frame(host, guest);
    expect(guest.match().phase).toBe('killcam');

    guest.session.advance();
    for (let i = 0; i < 5; i++) frame(host, guest);
    expect(hm.phase).not.toBe('killcam');
    expect(guest.match().phase).not.toBe('killcam');
  });

  it('lets everybody aim at once in Classic with simultaneous shots', async () => {
    const relay = new RoomManager();
    const make = async (): Promise<Client> => {
      let current: NetMatch | null = null;
      const session = new MultiplayerSession(
        { settings: () => cloneSettings(DEFAULT_SETTINGS), matchStarted: (m) => (current = m), matchRestarted() {}, matchEnded: () => (current = null) },
        new Loopback(relay),
      );
      await session.connect('loopback');
      return { session, match: () => current! };
    };
    const host = await make();
    const guest = await make();
    host.session.createRoom({ name: 'Anna', mode: 'ffa', gameMode: 'classic', rules: { ...rules, simultaneousShots: true }, maxPlayers: 2 });
    guest.session.joinRoom(guest.session.rooms[0].id, 'Ben');
    host.session.setReady(true);
    guest.session.setReady(true);
    const hm = host.match();
    expect(hm.salvo).toBe(true);
    expect(hm.simultaneous).toBe(true);
    for (let i = 0; i < 5; i++) frame(host, guest);
    expect(hm.canAim(0)).toBe(true);
    expect(hm.canAim(1)).toBe(true);
    expect(guest.match().localCanAim).toBe(true);

    host.session.input({ kind: 'aim', angle: 10, power: 40 });
    guest.session.input({ kind: 'aim', angle: 170, power: 40 });
    host.session.input({ kind: 'fire' });
    for (let i = 0; i < 5; i++) frame(host, guest);
    // One is locked in and waits for the other: nothing flies yet.
    expect(hm.phase).toBe('aiming');
    expect(guest.match().players[0].locked).toBe(true);
    guest.session.input({ kind: 'fire' });
    for (let i = 0; i < 60; i++) frame(host, guest);
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
      for (let i = 0; i < 5; i++) frame(host, guest);
      expect(hm.localCanAim).toBe(true);
      expect(gm.localCanAim).toBe(true);
      expect(hm.shotClock).not.toBeNull();

      // The guest's aim reaches the host while the host is aiming too.
      guest.session.input({ kind: 'aim', angle: 123, power: 40 });
      host.session.input({ kind: 'aim', angle: 33, power: 60 });
      for (let i = 0; i < 5; i++) frame(host, guest);
      expect(hm.players[1].angle).toBe(123);
      expect(hm.players[0].angle).toBe(33);
      // Our own aim is not dragged back by the host's snapshots.
      expect(gm.players[1].angle).toBe(123);
    });

    it('fire all shots once the last player has locked in, and lock out the ones who are done', async () => {
      const { host, guest } = await startRoom('horizon');
      const hm = host.match();
      const gm = guest.match();
      for (let i = 0; i < 5; i++) frame(host, guest);
      host.session.input({ kind: 'fire' });
      for (let i = 0; i < 5; i++) frame(host, guest);
      expect(hm.players[0].locked).toBe(true);
      expect(hm.localCanAim).toBe(false);
      // A locked-in player can no longer move the aim.
      host.session.input({ kind: 'aim', angle: 200, power: 10 });
      expect(hm.players[0].angle).not.toBe(200);
      expect(hm.phase).toBe('aiming');
      expect(gm.localCanAim).toBe(true);

      guest.session.input({ kind: 'fire' });
      for (let i = 0; i < 90 && hm.phase !== 'flying'; i++) frame(host, guest);
      expect(hm.phase).toBe('flying');
      expect(hm.volley!.shots).toHaveLength(2);
    });

    it('lock everybody in when the shared clock runs out', async () => {
      const { host, guest } = await startRoom('horizon');
      const hm = host.match();
      for (let i = 0; i < 60 * 16 && hm.phase === 'aiming'; i++) frame(host, guest);
      expect(hm.phase).toBe('flying');
    });
  });

  it("move a guest's view of the flight on between snapshots", async () => {
    const { host, guest } = await startRoom('classic');
    const hm = host.match();
    const gm = guest.match();
    // An empty field and ships out of each other's line: the shot simply keeps flying (it bounces off the walls).
    hm.world.planets = [];
    Object.assign(hm.world.ships[0], { x: 100, y: 400 });
    Object.assign(hm.world.ships[1], { x: 1180, y: 700 });
    for (let i = 0; i < 5; i++) frame(host, guest);
    host.session.input({ kind: 'aim', angle: 0, power: 55 });
    host.session.input({ kind: 'fire' });
    // The host's snapshots come in 30 Hz steps; the guest renders 60 Hz frames in between.
    let moved = 0;
    let last: number | null = null;
    for (let i = 0; i < 40; i++) {
      host.match().update(1 / 60);
      host.session.update(1 / 60);
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
      for (let i = 0; i < 5; i++) frame(host, guest);
      // Everybody shoots at the other one whenever they may aim (Classic: in turn; Horizon: all at once).
      for (let i = 0; i < 60 * 60 && hm.phase !== 'roundOver'; i++) {
        if (hm.phase === 'killcam') hm.voteSkip(0);
        if (hm.phase === 'aiming') {
          host.session.input({ kind: 'aim', angle: 0, power: 55 });
          guest.session.input({ kind: 'aim', angle: 180, power: 55 });
          host.session.input({ kind: 'fire' });
          guest.session.input({ kind: 'fire' });
        }
        frame(host, guest);
      }
      for (let i = 0; i < 10; i++) frame(host, guest);
      expect(hm.phase).toBe('roundOver');
      expect(guest.match().phase).toBe('roundOver');
      expect(hm.roundStats.longestShot).not.toBeNull();
      expect(guest.match().roundStats).toEqual(hm.roundStats);
      expect(guest.match().matchStats).toEqual(hm.matchStats);
    }
  });
});
