import { describe, expect, it } from 'vitest';
import { inviteLink, readInvite, withoutInvite } from '../src/invite';

const CLIENT = 'https://denzrs.github.io/slingshot-remake/';

describe('an invite link', () => {
  it('opens the client it was made from, with the room code in it', () => {
    expect(inviteLink(CLIENT, 'AbC123xy')).toBe(`${CLIENT}?join=AbC123xy`);
    // The client's own path stays, wherever it is served from.
    expect(inviteLink('http://localhost:5173/', 'AbC123xy')).toBe('http://localhost:5173/?join=AbC123xy');
  });

  it('carries the relay and the password along when they are known', () => {
    const link = inviteLink(CLIENT, 'AbC123xy', 'wss://relay.example:8080', 'open sesame');
    const params = new URL(link).searchParams;
    expect(params.get('server')).toBe('wss://relay.example:8080');
    expect(params.get('pw')).toBe('open sesame');
    // Anything that is not a relay address is left out rather than shared, and a room without a password gets no parameter.
    expect(new URL(inviteLink(CLIENT, 'AbC123xy', 'https://relay.example')).searchParams.has('server')).toBe(false);
    expect(new URL(inviteLink(CLIENT, 'AbC123xy', '', '')).searchParams.has('pw')).toBe(false);
  });

  it('is no link at all without a usable room code', () => {
    expect(inviteLink(CLIENT, '')).toBe('');
    expect(inviteLink(CLIENT, 'room 1')).toBe('');
    expect(inviteLink(CLIENT, 'AbC123xyAbC123xy7')).toBe('');
  });
});

describe('reading an invite off the URL', () => {
  it('finds the room code, the relay and the password', () => {
    expect(readInvite('?join=AbC123xy')).toEqual({ roomId: 'AbC123xy' });
    expect(readInvite('?join=AbC123xy&server=ws://192.168.1.5:8080')).toEqual({ roomId: 'AbC123xy', server: 'ws://192.168.1.5:8080' });
    expect(readInvite('?join=AbC123xy&pw=hunter2')).toEqual({ roomId: 'AbC123xy', password: 'hunter2' });
    // Other parameters on the page stay out of it.
    expect(readInvite('?daily=2026-10-16&join=AbC123xy')).toEqual({ roomId: 'AbC123xy' });
  });

  it('is nothing for a plain visit, or a code the relay would reject', () => {
    expect(readInvite('')).toBeNull();
    expect(readInvite('?daily=2026-10-16')).toBeNull();
    expect(readInvite('?join=')).toBeNull();
    expect(readInvite('?join=two+rooms')).toBeNull();
    expect(readInvite('?join=AbC123xyAbC123xy7')).toBeNull();
  });

  it('keeps a room code but drops a relay address that is not one, and an empty password', () => {
    expect(readInvite('?join=AbC123xy&server=https://relay.example')).toEqual({ roomId: 'AbC123xy' });
    expect(readInvite('?join=AbC123xy&server=https://relay.example&pw=')).toEqual({ roomId: 'AbC123xy' });
  });

  it('comes back the same way it went out', () => {
    const link = inviteLink(CLIENT, 'AbC123xy', 'wss://relay.example:8080', 'hunter2');
    expect(readInvite(new URL(link).search)).toEqual({ roomId: 'AbC123xy', server: 'wss://relay.example:8080', password: 'hunter2' });
  });
});

describe('a URL an invite was used from', () => {
  it('loses the invite, and nothing else', () => {
    expect(withoutInvite('https://x/y/?daily=2026-10-16&join=AbC123xy&pw=hunter2&server=wss://r:1')).toBe('https://x/y/?daily=2026-10-16');
    expect(withoutInvite('https://x/y/?join=AbC123xy')).toBe('https://x/y/');
    expect(withoutInvite(CLIENT)).toBe(CLIENT);
  });
});
