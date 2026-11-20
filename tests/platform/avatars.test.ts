import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AVATAR_PATHS, AVATARS, DEFAULT_AVATAR, avatarFrom } from '../../src/platform/avatars';
import { ROOM_SYMBOLS } from '../../src/data/roomLook';
import { DEFAULT_EMBLEM, EMBLEM_PATHS, EMBLEMS, emblemFrom } from '../../src/platform/emblems';

const relayContract = JSON.parse(readFileSync(fileURLToPath(new URL('../../server/protocol-contract.json', import.meta.url)), 'utf8')) as {
  avatar: { default: string; options: string[] };
  emblem: { default: string; options: string[] };
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

describe('team emblems', () => {
  it('offer exactly the choices the relay accepts, with the same default', () => {
    expect([...EMBLEMS]).toEqual(relayContract.emblem.options);
    expect(DEFAULT_EMBLEM).toBe(relayContract.emblem.default);
  });

  it('are neither player symbols nor room symbols, so a team never looks like one of its players', () => {
    const others = [...AVATARS, ...ROOM_SYMBOLS] as readonly string[];
    expect(EMBLEMS.filter((emblem) => others.includes(emblem))).toEqual([]);
  });

  it('have a drawing for every choice', () => {
    for (const emblem of EMBLEMS) expect(EMBLEM_PATHS[emblem].length, emblem).toBeGreaterThan(0);
  });

  it('fall back to the default for anything that is not a choice', () => {
    expect(emblemFrom('crown')).toBe('crown');
    expect(emblemFrom('rocket')).toBe(DEFAULT_EMBLEM);
  });
});
