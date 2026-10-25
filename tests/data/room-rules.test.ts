import { describe, expect, it } from 'vitest';
import { DEFAULT_ROOM_RULES, defaultRoomRules, RULE_KEYS, roomRulesFrom, rulesOf } from '../../src/data/roomRules';
import { DEFAULT_SETTINGS } from '../../src/data/settings';

describe('the rules of a game', () => {
  it('names every rule once, and the standard rules give every one a value', () => {
    expect(new Set(RULE_KEYS).size).toBe(RULE_KEYS.length);
    expect(Object.keys(DEFAULT_ROOM_RULES).sort()).toEqual([...RULE_KEYS].sort());
  });

  it('is what the local settings start from', () => {
    expect(rulesOf(DEFAULT_SETTINGS)).toEqual(DEFAULT_ROOM_RULES);
  });

  it('copies the rules out of settings without taking the rest along or sharing the power-up list', () => {
    const settings = { ...DEFAULT_SETTINGS, rounds: 9, language: 'en' as const, powerUpKinds: ['shield' as const] };
    const rules = rulesOf(settings);
    expect(Object.keys(rules).sort()).toEqual([...RULE_KEYS].sort());
    expect(rules.rounds).toBe(9);
    rules.powerUpKinds.push('plasma');
    expect(settings.powerUpKinds).toEqual(['shield']);
    defaultRoomRules().powerUpKinds.pop();
    expect(DEFAULT_ROOM_RULES.powerUpKinds).toEqual(DEFAULT_SETTINGS.powerUpKinds);
  });

  it('keeps only the rules out of what was saved, so nothing else is sent on to a room', () => {
    const saved = { ...defaultRoomRules(), rounds: 7, party: true, language: 'en' } as Parameters<typeof roomRulesFrom>[0];
    const rules = roomRulesFrom(saved);
    expect(rules.rounds).toBe(7);
    expect(Object.keys(rules).sort()).toEqual([...RULE_KEYS].sort());
  });
});
