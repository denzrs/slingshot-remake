import { afterEach, describe, expect, it, vi } from 'vitest';
import { AIM } from '../../src/sim/config';
import { loadLobbyPrefs } from '../../src/data/lobbyPrefs';
import { defaultRoomRules, rulesOf } from '../../src/data/roomRules';
import { DEFAULT_ROOM_LOOK } from '../../src/data/roomLook';
import { DEFAULT_SETTINGS } from '../../src/data/settings';

const stored = (values: Record<string, unknown>) =>
  vi.stubGlobal('localStorage', { getItem: (key: string) => (key in values ? JSON.stringify(values[key]) : null), setItem: () => {} });

afterEach(() => vi.unstubAllGlobals());

/** What a player has set up for offline games: nothing like the standard rules. */
const OFFLINE = { rounds: 20, maxPlanets: 8, bounce: true, fixedPower: true, fixedPowerLevel: 90, maxPower: 30, shotTime: 60, hiddenAim: true, fadingTrails: 4, neighborGrace: 2 };

describe('Mayhem rules', () => {
  it('keep a saved chaos strength, and fall back to off for one nobody offers', () => {
    stored({ 'slingshot.lobby.v1': { rules: { mayhem: 3 } } });
    expect(loadLobbyPrefs('ws://x').rules.mayhem).toBe(3);
    stored({ 'slingshot.lobby.v1': { rules: { mayhem: 9 } } });
    expect(loadLobbyPrefs('ws://x').rules.mayhem).toBe(0);
  });
});

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
    stored({ 'slingshot.lobby.v1': { name: 'Anna', server: 'ws://there', gameMode: 'horizon', capacity: 6, rules: { maxPower: 40, fixedPowerLevel: 75, hiddenAim: true } } });
    const prefs = loadLobbyPrefs('ws://x');
    expect(prefs).toMatchObject({ name: 'Anna', server: 'ws://there', gameMode: 'horizon', capacity: 6 });
    expect(prefs.rules).toMatchObject({ maxPower: 40, fixedPowerLevel: 75, hiddenAim: true });
  });

  it('remembers the power-ups of a room, and cleans up what a saved lobby got wrong', () => {
    stored({ 'slingshot.lobby.v1': { rules: { powerUps: true, powerUpKinds: ['shield', 'laser', 'teleport'], powerUpAmount: 3 } } });
    expect(loadLobbyPrefs('ws://x').rules).toMatchObject({ powerUps: true, powerUpKinds: ['teleport', 'shield'], powerUpAmount: 3 });
    stored({ 'slingshot.lobby.v1': { rules: { powerUps: 'yes', powerUpKinds: [], powerUpAmount: 9 } } });
    expect(loadLobbyPrefs('ws://x').rules).toMatchObject({ powerUps: false, powerUpKinds: defaultRoomRules().powerUpKinds, powerUpAmount: defaultRoomRules().powerUpAmount });
  });

  it('plays without bets until the host switches them on, and remembers it', () => {
    stored({});
    expect(loadLobbyPrefs('ws://x').rules.betting).toBe(false);
    stored({ 'slingshot.lobby.v1': { rules: { betting: true } } });
    expect(loadLobbyPrefs('ws://x').rules.betting).toBe(true);
    // Anything but a plain "true" is no.
    stored({ 'slingshot.lobby.v1': { rules: { betting: 'yes' } } });
    expect(loadLobbyPrefs('ws://x').rules.betting).toBe(false);
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

  it('remembers the look of the next room, and starts over from the default when it is not a known choice', () => {
    stored({});
    expect(loadLobbyPrefs('ws://x').look).toEqual(DEFAULT_ROOM_LOOK);
    stored({ 'slingshot.lobby.v1': { look: { visibility: 'private', symbol: 'moon', color: '#c6e86a' } } });
    expect(loadLobbyPrefs('ws://x').look).toEqual({ visibility: 'private', symbol: 'moon', color: '#c6e86a' });
    stored({ 'slingshot.lobby.v1': { look: { visibility: 'secret', symbol: 'dragon', color: '#000000' } } });
    expect(loadLobbyPrefs('ws://x').look).toEqual(DEFAULT_ROOM_LOOK);
  });

  it('remembers the symbol the player shows in games, and starts over from the default when it is not a choice', () => {
    stored({});
    expect(loadLobbyPrefs('ws://x').avatar).toBe('rocket');
    stored({ 'slingshot.lobby.v1': { avatar: 'bolt' } });
    expect(loadLobbyPrefs('ws://x').avatar).toBe('bolt');
    stored({ 'slingshot.lobby.v1': { avatar: 'dragon' } });
    expect(loadLobbyPrefs('ws://x').avatar).toBe('rocket');
  });

  it('survives storage that is broken or blocked', () => {
    vi.stubGlobal('localStorage', { getItem: () => '{not json', setItem: () => {} });
    expect(loadLobbyPrefs('ws://x').rules).toEqual(defaultRoomRules());
    vi.stubGlobal('localStorage', undefined);
    expect(loadLobbyPrefs('ws://x').capacity).toBe(4);
  });
});

describe('killcam room preferences', () => {
  it.each(['auto', 'off', 'every', 'round'] as const)('remembers %s independently of offline settings', (killcam) => {
    stored({ 'slingshot.lobby.v1': { rules: { killcam } } });
    expect(loadLobbyPrefs('ws://x').rules.killcam).toBe(killcam);
  });

  it('uses automatic salvos for old or invalid saved rules', () => {
    for (const killcam of [undefined, null, true, 'always']) {
      stored({ 'slingshot.lobby.v1': { rules: { killcam } } });
      expect(loadLobbyPrefs('ws://x').rules.killcam).toBe('auto');
    }
  });
});
