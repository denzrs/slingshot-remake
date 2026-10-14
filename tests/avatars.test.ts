import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AVATAR_PATHS, AVATARS, DEFAULT_AVATAR, avatarFrom } from '../src/avatars';
import { ROOM_SYMBOLS } from '../src/roomLook';

const relayContract = JSON.parse(readFileSync(fileURLToPath(new URL('../server/protocol-contract.json', import.meta.url)), 'utf8')) as {
  avatar: { default: string; options: string[] };
};

describe('player symbols', () => {
  it('offer exactly the choices the relay accepts, with the same default', () => {
    expect([...AVATARS]).toEqual(relayContract.avatar.options);
    expect(DEFAULT_AVATAR).toBe(relayContract.avatar.default);
  });

  it('are not the room symbols, so the two never look alike', () => {
    expect(AVATARS.filter((avatar) => (ROOM_SYMBOLS as readonly string[]).includes(avatar))).toEqual([]);
  });

  it('have a drawing for every choice', () => {
    for (const avatar of AVATARS) expect(AVATAR_PATHS[avatar].length, avatar).toBeGreaterThan(0);
  });

  it('fall back to the default for anything that is not a choice', () => {
    expect(avatarFrom('gem')).toBe('gem');
    expect(avatarFrom('planet')).toBe(DEFAULT_AVATAR);
    expect(avatarFrom(undefined)).toBe(DEFAULT_AVATAR);
  });
});
