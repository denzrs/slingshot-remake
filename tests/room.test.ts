import { describe, expect, it } from 'vitest';
import { RoomManager, type ClientConnection } from '../server/room';

type Message = Record<string, any>;

class FakeClient implements ClientConnection {
  readonly received: Message[] = [];
  send(message: unknown): void {
    this.received.push(JSON.parse(JSON.stringify(message)));
  }
  sendText(text: string): void {
    this.received.push(JSON.parse(text));
  }
  last(type: string): Message | undefined {
    return [...this.received].reverse().find((m) => m.type === type);
  }
  count(type: string): number {
    return this.received.filter((m) => m.type === type).length;
  }
}

function setup() {
  const manager = new RoomManager();
  const client = (): FakeClient => {
    const c = new FakeClient();
    manager.connect(c);
    return c;
  };
  return { manager, client };
}

const create = (extra: Message = {}) => ({ type: 'create_room', name: 'Host', mode: 'ffa', gameMode: 'classic', maxPlayers: 4, ...extra });

describe('rooms', () => {
  it('lists open rooms and marks password-protected ones', () => {
    const { manager, client } = setup();
    const host = client();
    const watcher = client();
    manager.handle(host, create({ password: 'geheim' }));
    expect(watcher.last('lobby_update')!.rooms).toMatchObject([{ players: 1, locked: true }]);
    expect(host.last('room_update')!.room.locked).toBe(true);
  });

  it('only lets people in with the right password', () => {
    const { manager, client } = setup();
    const host = client();
    manager.handle(host, create({ password: 'geheim' }));
    const roomId = host.last('room_update')!.room.id;
    const guest = client();

    manager.handle(guest, { type: 'join_room', roomId, name: 'Gast' });
    expect(guest.last('error')!.message).toBe('Wrong password');
    manager.handle(guest, { type: 'join_room', roomId, name: 'Gast', password: 'falsch' });
    expect(guest.count('room_update')).toBe(0);
    manager.handle(guest, { type: 'join_room', roomId, name: 'Gast', password: 'geheim' });
    expect(guest.last('room_update')!.room.players).toHaveLength(2);
  });

  it('cuts off password guessing after a few attempts', () => {
    const { manager, client } = setup();
    const host = client();
    manager.handle(host, create({ password: 'geheim' }));
    const roomId = host.last('room_update')!.room.id;
    const guest = client();
    for (let i = 0; i < 5; i++) manager.handle(guest, { type: 'join_room', roomId, name: 'Gast', password: `x${i}` });
    manager.handle(guest, { type: 'join_room', roomId, name: 'Gast', password: 'geheim' });
    expect(guest.count('room_update')).toBe(0);
    expect(guest.last('error')!.message).toMatch(/Too many/);
  });

  it('rooms without a password stay open', () => {
    const { manager, client } = setup();
    const host = client();
    manager.handle(host, create());
    const guest = client();
    manager.handle(guest, { type: 'join_room', roomId: host.last('room_update')!.room.id, name: 'Gast' });
    expect(guest.last('room_update')!.room.locked).toBe(false);
    expect(guest.last('room_update')!.room.players).toHaveLength(2);
  });

  function startedGame() {
    const { manager, client } = setup();
    const host = client();
    manager.handle(host, create());
    const roomId = host.last('room_update')!.room.id;
    const guest = client();
    const third = client();
    manager.handle(guest, { type: 'join_room', roomId, name: 'Gast' });
    manager.handle(third, { type: 'join_room', roomId, name: 'Dritte' });
    manager.handle(host, { type: 'start_game' });
    return { manager, host, guest, third, roomId };
  }

  it('relays the host state to the guests only, as one patch message', () => {
    const { manager, host, guest, third } = startedGame();
    manager.handle(host, { type: 'state', seq: 1, patch: { phase: 'aiming' }, events: [] });
    expect(guest.last('state')).toEqual({ type: 'state', seq: 1, patch: { phase: 'aiming' }, events: [] });
    expect(third.count('state')).toBe(1);
    expect(host.count('state')).toBe(0);
    manager.handle(guest, { type: 'state', seq: 2, patch: {}, events: [] });
    expect(third.count('state')).toBe(1);
  });

  it('a guest leaving a running game ends the game but keeps the room', () => {
    const { manager, host, guest, third } = startedGame();
    manager.handle(third, { type: 'leave_room' });
    const update = host.last('room_update')!;
    expect(update.room.status).toBe('waiting');
    expect(update.room.players.map((p: Message) => p.name)).toEqual(['Host', 'Gast']);
    expect(update.room.players.every((p: Message) => !p.ready)).toBe(true);
    expect(update.notice).toMatch(/game was ended/);
    expect(guest.last('room_update')!.room.status).toBe('waiting');
    // The one who left is back in the lobby, which lists the (waiting) room again.
    expect(third.last('lobby_update')!.rooms).toHaveLength(1);
  });

  it('the host leaving closes the room and sends everybody to the lobby', () => {
    const { manager, host, guest, third } = startedGame();
    manager.handle(host, { type: 'leave_room' });
    expect(guest.last('room_closed')).toBeDefined();
    expect(third.last('room_closed')).toBeDefined();
    expect(guest.last('lobby_update')!.rooms).toEqual([]);
    // They are free to open a new room right away.
    manager.handle(guest, create({ name: 'Gast' }));
    expect(guest.last('room_update')!.room.players).toHaveLength(1);
  });

  it('a dropped connection is handled like leaving', () => {
    const { manager, host, guest, third } = startedGame();
    manager.disconnect(guest);
    expect(host.last('room_update')!.room.status).toBe('waiting');
    expect(host.last('room_update')!.room.players).toHaveLength(2);
    expect(third.last('room_update')!.you.playerId).toBe(1);
  });

  it('trims over-long names', () => {
    const { manager, client } = setup();
    const host = client();
    manager.handle(host, create({ name: '  ' + 'x'.repeat(100) }));
    expect(host.last('room_update')!.room.players[0].name).toHaveLength(24);
  });
});
