import { afterEach, describe, expect, it, vi } from 'vitest';
import { AIM } from '../src/config';
import { defaultRoomRules, loadLobbyPrefs, rulesOf } from '../src/lobbyPrefs';
import { DEFAULT_SETTINGS } from '../src/settings';

const stored = (values: Record<string, unknown>) =>
  vi.stubGlobal('localStorage', { getItem: (key: string) => (key in values ? JSON.stringify(values[key]) : null), setItem: () => {} });

afterEach(() => vi.unstubAllGlobals());

/** What a player has set up for offline games: nothing like the standard rules. */
const OFFLINE = { rounds: 20, maxPlanets: 8, bounce: true, fixedPower: true, fixedPowerLevel: 90, maxPower: 30, shotTime: 60, hiddenAim: true, fadingTrails: 4, neighborGrace: 2 };

describe('the lobby has its own state', () => {
  it('starts every new room with the standard rules', () => {
    stored({});
    expect(loadLobbyPrefs('ws://x').rules).toEqual(defaultRoomRules());
    expect(defaultRoomRules()).toEqual(rulesOf(DEFAULT_SETTINGS));
  });

  it('does not borrow what was set up for offline games', () => {
    stored({ 'slingshot.settings.v1': OFFLINE });
    expect(loadLobbyPrefs('ws://x').rules).toEqual(defaultRoomRules());
  });

  it('fills what a saved lobby leaves out from the standard rules, never from offline ones', () => {
    stored({ 'slingshot.settings.v1': OFFLINE, 'slingshot.lobby.v1': { rules: { rounds: 7 } } });
    expect(loadLobbyPrefs('ws://x').rules).toEqual({ ...defaultRoomRules(), rounds: 7 });
  });

  it('keeps what the lobby itself saved', () => {
    stored({ 'slingshot.lobby.v1': { name: 'Anna', server: 'ws://there', gameMode: 'horizon', matchType: 'team', capacity: 6, rules: { maxPower: 40, fixedPowerLevel: 75, hiddenAim: true } } });
    const prefs = loadLobbyPrefs('ws://x');
    expect(prefs).toMatchObject({ name: 'Anna', server: 'ws://there', gameMode: 'horizon', matchType: 'team', capacity: 6 });
    expect(prefs.rules).toMatchObject({ maxPower: 40, fixedPowerLevel: 75, hiddenAim: true });
  });

  it('puts a value no slider has back to the standard one', () => {
    stored({ 'slingshot.lobby.v1': { rules: { maxPower: 75, fixedPowerLevel: 57, fadingTrails: 3, neighborGrace: 9 } } });
    expect(loadLobbyPrefs('ws://x').rules).toMatchObject({ maxPower: AIM.MAX_POWER, fixedPowerLevel: AIM.FIXED_POWER, fadingTrails: 0, neighborGrace: 0 });
  });

  it('keeps the number of players between two and six', () => {
    for (const capacity of [1, 7, 2.5, 'four']) {
      stored({ 'slingshot.lobby.v1': { capacity } });
      expect(loadLobbyPrefs('ws://x').capacity).toBe(4);
    }
    for (const capacity of [2, 3, 5, 6]) {
      stored({ 'slingshot.lobby.v1': { capacity } });
      expect(loadLobbyPrefs('ws://x').capacity).toBe(capacity);
    }
  });

  it('survives storage that is broken or blocked', () => {
    vi.stubGlobal('localStorage', { getItem: () => '{not json', setItem: () => {} });
    expect(loadLobbyPrefs('ws://x').rules).toEqual(defaultRoomRules());
    vi.stubGlobal('localStorage', undefined);
    expect(loadLobbyPrefs('ws://x').capacity).toBe(4);
  });
});
