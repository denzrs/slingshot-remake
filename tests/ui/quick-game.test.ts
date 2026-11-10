import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, activeSeats, cloneSettings } from '../../src/data/settings';
import type { StatsFavorite } from '../../src/net/net';
import { getLang, setLang } from '../../src/platform/i18n';
import { QUICK_CPUS, QUICK_ROUNDS, quickChoices, quickGame, quickHint, shuffleFavorite } from '../../src/ui/presets/quick-game';

const favorite = (gameMode: StatsFavorite['gameMode'], rules: StatsFavorite['rules']): StatsFavorite => ({ gameMode, rules, games: 4 });

describe('quick game', () => {
  it('plays a favourite in three rounds, the player against two CPUs, and leaves the setup as it was', () => {
    const base = cloneSettings(DEFAULT_SETTINGS);
    base.seats = ['human', 'human', 'hard', 'off', 'off', 'off'];
    base.teamMode = 2;
    const { mode, settings } = quickGame(base, favorite('solar', { maxPlanets: 3, powerUps: true }));
    expect(mode).toBe('solar');
    expect(settings.rounds).toBe(QUICK_ROUNDS);
    expect(settings.maxPlanets).toBe(3);
    expect(settings.powerUps).toBe(true);
    expect(activeSeats(settings).map((i) => settings.seats[i])).toEqual(['human', 'hard', 'hard']);
    expect(settings.teamMode).toBe(0);
    expect(base.seats).toEqual(['human', 'human', 'hard', 'off', 'off', 'off']);
  });

  it('fills in what a favourite leaves out with the standard rules, and plays medium CPUs when none were set up', () => {
    const base = cloneSettings(DEFAULT_SETTINGS);
    base.seats = ['human', 'human', 'off', 'off', 'off', 'off'];
    const { settings } = quickGame(base, favorite('classic', { maxPower: 12345 }));
    expect(settings.maxPower).toBe(DEFAULT_SETTINGS.maxPower);
    expect(activeSeats(settings).map((i) => settings.seats[i])).toEqual(['human', 'medium', 'medium']);
  });

  it('picks from the relay favourites, or the standard rules of every mode when there are none', () => {
    const relay = [favorite('horizon', {}), { ...favorite('classic', {}), gameMode: 'pong' as never }];
    expect(quickChoices(relay).map((f) => f.gameMode)).toEqual(['horizon']);
    expect(quickChoices([]).map((f) => f.gameMode)).toEqual(['classic', 'horizon', 'solar']);
  });

  it('never deals the same one twice in a row when there is another', () => {
    expect(shuffleFavorite(['a', 'b'], 'a', () => 0)).toBe('b');
    expect(shuffleFavorite(['a', 'b', 'c'], 'b', () => 0.99)).toBe('c');
    expect(shuffleFavorite(['a'], 'a', () => 0.5)).toBe('a');
  });

  it('says in its hint how long a quick game is and against how many', () => {
    const before = getLang();
    setLang('en');
    expect(quickHint()).toContain(`${QUICK_ROUNDS} rounds vs ${QUICK_CPUS} CPUs`);
    setLang('de');
    expect(quickHint()).toContain(`${QUICK_ROUNDS} Runden gegen ${QUICK_CPUS} CPUs`);
    setLang(before);
  });
});
