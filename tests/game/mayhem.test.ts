import { describe, expect, it } from 'vitest';
import { MAYHEM } from '../../src/sim/config';
import { applyTwists, MayhemDeck, TWIST_IDS, twistedRules, type MayhemRound } from '../../src/game/mayhem';
import { cloneSettings, DEFAULT_SETTINGS, type Settings } from '../../src/data/settings';

const rules = (patch: Partial<Settings> = {}): Settings => ({ ...cloneSettings(DEFAULT_SETTINGS), mayhem: 2, ...patch });

/** A whole match worth of rounds from one deck. */
function play(seed: number, base: Settings, mode: 'classic' | 'horizon', rounds: number): MayhemRound[] {
  const deck = new MayhemDeck(seed);
  return Array.from({ length: rounds }, (_, i) => deck.draw({ base, mode, round: i + 1, rounds }));
}

describe('mayhem deck', () => {
  it('draws the same rounds from the same seed', () => {
    expect(play(7, rules(), 'classic', 12)).toEqual(play(7, rules(), 'classic', 12));
    expect(play(7, rules(), 'classic', 12)).not.toEqual(play(8, rules(), 'classic', 12));
  });

  it.each([1, 2, 3])('never repeats a twist in two rounds in a row and never pairs twists that share a slot (level %i)', (mayhem) => {
    for (let seed = 1; seed <= 40; seed++) {
      const rounds = play(seed, rules({ mayhem }), 'classic', 20);
      rounds.forEach((round, i) => {
        const ids = round.twists.map((t) => t.id);
        expect(new Set(ids).size).toBe(ids.length);
        if (i > 0) for (const id of ids) expect(rounds[i - 1].twists.map((t) => t.id)).not.toContain(id);
      });
      for (const round of rounds) {
        const laid = applyTwists(rules({ mayhem }), round);
        // Fixed power and a cap never apply together; a power-up round carries one theme.
        expect(laid.fixedPower && laid.maxPower < 100).toBe(false);
        expect(round.twists.filter((t) => ['pickupRain', 'plasmaStorm', 'gravityParty', 'fortress', 'teleportChaos'].includes(t.id)).length).toBeLessThanOrEqual(1);
      }
    }
  });

  it('plays every twist once before any comes up twice', () => {
    const seen = new Set<string>();
    const deck = new MayhemDeck(3);
    const base = rules({ mayhem: 2 });
    let round = 0;
    while (seen.size < TWIST_IDS.length - 3 && round < 40) {
      for (const t of deck.draw({ base, mode: 'classic', round: ++round, rounds: 0 }).twists) seen.add(t.id);
    }
    expect(seen.size).toBeGreaterThanOrEqual(TWIST_IDS.length - 3);
  });

  it('leaves out Classic-only twists in Event Horizon', () => {
    for (let seed = 1; seed <= 30; seed++) {
      for (const round of play(seed, rules({ mayhem: 3 }), 'horizon', 15)) {
        for (const { id } of round.twists) expect(id).not.toBe('blind');
      }
    }
  });

  it('keeps mild rounds gentle: one twist or a quiet round, nothing that takes sight or power away', () => {
    for (let seed = 1; seed <= 40; seed++) {
      for (const round of play(seed, rules({ mayhem: 1 }), 'classic', 10).filter((r) => !r.finale)) {
        expect(round.twists.length).toBeLessThanOrEqual(1);
        for (const { id } of round.twists) expect(['blind', 'memory', 'precision']).not.toContain(id);
      }
    }
  });

  it('opens with a twist, never with a quiet round', () => {
    for (let seed = 1; seed <= 60; seed++) expect(play(seed, rules({ mayhem: 1 }), 'classic', 3)[0].twists.length).toBe(1);
  });

  it('stacks at least two twists in the finale of a finite match, and none in an endless one', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const rounds = play(seed, rules({ mayhem: 1 }), 'classic', 5);
      expect(rounds[4].finale).toBe(true);
      expect(rounds[4].twists.length).toBeGreaterThanOrEqual(2);
      expect(rounds.slice(0, 4).some((r) => r.finale)).toBe(false);
    }
    const deck = new MayhemDeck(1);
    expect(deck.draw({ base: rules(), mode: 'classic', round: 1, rounds: 1 }).finale).toBe(false);
    expect(deck.draw({ base: rules(), mode: 'classic', round: 9, rounds: 0 }).finale).toBe(false);
  });

  it('makes jackpots rare and never opens with one', () => {
    let jackpots = 0;
    let total = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const rounds = play(seed, rules({ mayhem: 2 }), 'classic', 10);
      expect(rounds[0].jackpot).toBe(false);
      for (const r of rounds.slice(1, 9)) {
        total++;
        if (r.jackpot) jackpots++;
      }
    }
    expect(jackpots / total).toBeGreaterThan(MAYHEM.JACKPOT_CHANCE * 0.6);
    expect(jackpots / total).toBeLessThan(MAYHEM.JACKPOT_CHANCE * 1.4);
  });

  it('skips a twist the room already plays by', () => {
    const base = rules({ mayhem: 3, bounce: true, maxPlanets: 8, powerUps: true, powerUpKinds: ['plasma', 'piercing'], powerUpAmount: 3 });
    for (let seed = 1; seed <= 40; seed++) {
      for (const round of play(seed, base, 'classic', 10)) {
        for (const { id, n } of round.twists) {
          const laid = applyTwists(base, { twists: [{ id, n }] });
          expect(laid, id).not.toEqual(base);
        }
      }
    }
  });
});

describe('applying twists', () => {
  it('lays the twists over the room rules and leaves the rest and the original alone', () => {
    const base = rules({ maxPlanets: 5, shotTime: 30, rounds: 7 });
    const laid = applyTwists(base, { twists: [{ id: 'billiard', n: 3 }, { id: 'precision', n: 45 }] });
    expect(laid).toMatchObject({ bounce: true, maxPlanets: 3, fixedPower: true, fixedPowerLevel: 45, maxPower: 100, shotTime: 30, rounds: 7 });
    expect(base).toMatchObject({ bounce: false, maxPlanets: 5, fixedPower: false });
  });

  it('plays a quiet round by the room rules as they are', () => {
    const base = rules();
    expect(applyTwists(base, { twists: [] })).toEqual(base);
  });

  it('builds a themed power-up round from the kinds of its theme', () => {
    const laid = applyTwists(rules(), { twists: [{ id: 'plasmaStorm' }] });
    expect(laid).toMatchObject({ powerUps: true, powerUpKinds: ['plasma', 'piercing'], powerUpAmount: 3 });
  });

  it('lets a cap replace fixed power', () => {
    const laid = applyTwists(rules({ fixedPower: true, fixedPowerLevel: 55 }), { twists: [{ id: 'shortBreath', n: 40 }] });
    expect(laid).toMatchObject({ fixedPower: false, maxPower: 40 });
  });
});

describe('twisted rules', () => {
  it('lists the rules some twist can lay over the room, and none of the others', () => {
    const wild = twistedRules('classic', 2);
    for (const key of ['maxPlanets', 'bounce', 'invisiblePlanets', 'fixedPower', 'maxPower', 'hiddenAim', 'fadingTrails', 'powerUps', 'powerUpKinds', 'powerUpAmount'] as const) expect(wild.has(key)).toBe(true);
    // The rest of the rules (rounds, the shot clock, grace …) are never part of a twist.
    expect([...wild].every((key) => ['maxPlanets', 'bounce', 'invisiblePlanets', 'fixedPower', 'fixedPowerLevel', 'maxPower', 'hiddenAim', 'fadingTrails', 'powerUps', 'powerUpKinds', 'powerUpAmount'].includes(key))).toBe(true);
  });

  it('leaves out what only the harsh twists change when the level is mild, and what a mode does not have', () => {
    expect(twistedRules('classic', 1).has('invisiblePlanets')).toBe(false);
    expect(twistedRules('classic', 1).has('fadingTrails')).toBe(false);
    expect(twistedRules('classic', 1).has('maxPlanets')).toBe(true);
    expect(twistedRules('horizon', 3).has('invisiblePlanets')).toBe(false);
  });
});
