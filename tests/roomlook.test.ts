import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isSecureRelay } from '../src/multiplayer';
import { DEFAULT_ROOM_LOOK, ROOM_COLORS, ROOM_SYMBOLS, ROOM_VISIBILITIES, roomLookFrom } from '../src/roomLook';

const relayContract = JSON.parse(readFileSync(fileURLToPath(new URL('../server/protocol-contract.json', import.meta.url)), 'utf8')) as {
  room: { defaults: Record<string, string>; options: Record<string, string[]> };
};

describe('the room look matches the relay', () => {
  it('offers exactly the choices the relay accepts, with the same defaults', () => {
    expect([...ROOM_VISIBILITIES]).toEqual(relayContract.room.options.visibility);
    expect([...ROOM_SYMBOLS]).toEqual(relayContract.room.options.symbol);
    expect([...ROOM_COLORS]).toEqual(relayContract.room.options.color);
    expect(DEFAULT_ROOM_LOOK).toEqual(relayContract.room.defaults);
  });
});

describe('a room look from storage', () => {
  it('keeps what is valid and falls back to the default for the rest', () => {
    expect(roomLookFrom(undefined)).toEqual(DEFAULT_ROOM_LOOK);
    expect(roomLookFrom({ visibility: 'private', symbol: 'ufo', color: '#62b6ff' })).toEqual({ visibility: 'private', symbol: 'ufo', color: '#62b6ff' });
    expect(roomLookFrom({ visibility: 'secret', symbol: '<b>', color: '#000000' })).toEqual(DEFAULT_ROOM_LOOK);
  });

  it('ignores the names rooms used to have', () => {
    expect(roomLookFrom({ roomName: 'Sunday duel', visibility: 'public', symbol: 'sun', color: '#ffd27a' })).toEqual({ visibility: 'public', symbol: 'sun', color: '#ffd27a' });
  });
});

describe('the hosted relay', () => {
  it('is recognised by its secure address; local and self-hosted addresses are not', () => {
    expect(isSecureRelay('wss://slingshot-relay.eu:8080')).toBe(true);
    expect(isSecureRelay('ws://localhost:8080')).toBe(false);
    expect(isSecureRelay('https://slingshot-relay.eu')).toBe(false);
    expect(isSecureRelay('wss//typo')).toBe(false);
  });
});
