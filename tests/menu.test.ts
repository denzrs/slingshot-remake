import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, loadSettings } from '../src/settings';
import { AIM } from '../src/config';
import type { RoomRules } from '../src/net';
import { rulesOf } from '../src/lobbyPrefs';
import { indexAtFraction, positionOf, stepIndex } from '../src/ui/controls';
import { CAP_STOPS, DEFAULT_CAP, powerModeOf, powerModePatch, RULE_GROUPS, ruleItems, ruleRows, rulesFor, type PowerMode, type RuleSource } from '../src/ui/rules';
import { startPower } from '../src/settings';

describe('stepping through values', () => {
  it('wraps around when asked to, in both directions', () => {
    expect(stepIndex(2, 1, 3, true)).toBe(0);
    expect(stepIndex(0, -1, 3, true)).toBe(2);
    expect(stepIndex(1, 1, 3, true)).toBe(2);
  });

  it('stops at the ends of a slider', () => {
    expect(stepIndex(2, 1, 3, false)).toBe(2);
    expect(stepIndex(0, -1, 3, false)).toBe(0);
    expect(stepIndex(1, -1, 3, false)).toBe(0);
  });

  it('copes with a list that has no values', () => {
    expect(stepIndex(0, 1, 0, true)).toBe(0);
    expect(stepIndex(0, 1, 0, false)).toBe(0);
  });
});

describe('slider track', () => {
  it('snaps a hit on the track to the nearest stop', () => {
    // Ten stops, like the shot power cap: each one owns a ninth of the track.
    expect(indexAtFraction(0, 10)).toBe(0);
    expect(indexAtFraction(1, 10)).toBe(9);
    expect(indexAtFraction(0.5, 10)).toBe(5);
    expect(indexAtFraction(0.05, 10)).toBe(0);
    expect(indexAtFraction(0.06, 10)).toBe(1);
  });

  it('clamps a drag that leaves the track', () => {
    expect(indexAtFraction(-3, 8)).toBe(0);
    expect(indexAtFraction(7, 8)).toBe(7);
  });

  it('puts the first stop at the left end and the last at the right end', () => {
    expect(positionOf(0, 5)).toBe(0);
    expect(positionOf(4, 5)).toBe(1);
    expect(positionOf(1, 5)).toBe(0.25);
    expect(positionOf(0, 1)).toBe(0);
  });

  it('lands on every stop when dragged to where it is drawn', () => {
    for (const count of [2, 3, 4, 8, 10]) {
      for (let i = 0; i < count; i++) expect(indexAtFraction(positionOf(i, count), count)).toBe(i);
    }
  });
});

describe('game rules in the menu', () => {
  const all = ruleRows();
  const valued = all.filter((row) => row.control !== 'toggle');

  it('lists every rule the setup and online lobby share, once — the shot power one in three parts', () => {
    expect(all.map((row) => row.key).sort()).toEqual(Object.keys(rulesOf(DEFAULT_SETTINGS)).sort());
  });

  it('sorts every rule into a block of the setup screen', () => {
    for (const row of all) expect(RULE_GROUPS).toContain(row.group);
    for (const group of RULE_GROUPS) expect(all.some((row) => row.group === group)).toBe(true);
  });

  it('starts every slider on one of its stops', () => {
    const defaults = rulesOf(DEFAULT_SETTINGS);
    for (const row of all.filter((r) => r.control === 'slider')) {
      // The cap's slider only has stops below "no cap": no cap is the power mode "free".
      if (row.key === 'maxPower') continue;
      expect(row.options.map((o) => o.value), row.key).toContain(defaults[row.key]);
    }
  });

  it('makes switches of the on/off rules, a bar of the power mode and sliders of the rest', () => {
    for (const row of all) {
      if (row.key === 'fixedPower') expect(row.control).toBe('segmented');
      else if (row.options.length === 0) expect(row.control, row.key).toBe('toggle');
      else expect(row.control, row.key).toBe('slider');
    }
  });

  it('orders slider stops from low to high, endless rounds last', () => {
    for (const row of valued.filter((r) => r.control === 'slider')) {
      const values = row.options.map((o) => o.value as number);
      const sorted = row.key === 'rounds' ? [...values.filter((n) => n > 0)].sort((a, b) => a - b).concat(values.filter((n) => n === 0)) : [...values].sort((a, b) => a - b);
      expect(values, row.key).toEqual(sorted);
      expect(new Set(values).size, row.key).toBe(values.length);
    }
  });

  it('hides the Classic-only rules in Event Horizon', () => {
    const horizon = rulesFor('horizon').map((row) => row.key);
    for (const row of all.filter((r) => r.classicOnly)) {
      expect(horizon).not.toContain(row.key);
      expect(rulesFor('classic').map((r) => r.key)).toContain(row.key);
    }
  });

  describe('saved settings', () => {
    const saved = (value: unknown) => vi.stubGlobal('localStorage', { getItem: () => JSON.stringify(value), setItem: () => {} });
    afterEach(() => vi.unstubAllGlobals());

    it('keep a slider on the stop it was left on', () => {
      saved({ maxPower: 30, fadingTrails: 2, neighborGrace: 1, fixedPowerLevel: 65 });
      expect(loadSettings()).toMatchObject({ maxPower: 30, fadingTrails: 2, neighborGrace: 1, fixedPowerLevel: 65 });
    });

    it('drop a value no slider stop matches back to the default', () => {
      saved({ maxPower: 75, fadingTrails: 3, neighborGrace: 5, fixedPowerLevel: 57 });
      expect(loadSettings()).toMatchObject({ maxPower: 100, fadingTrails: 0, neighborGrace: 0, fixedPowerLevel: 55 });
    });

    it('from before the fixed level existed keep their classic 55', () => {
      saved({ fixedPower: true });
      const s = loadSettings();
      expect(s.fixedPowerLevel).toBe(55);
      expect(startPower(s)).toBe(55);
    });

    it('still read the old on/off neighbour grace as two shots', () => {
      saved({ neighborGrace: true });
      expect(loadSettings().neighborGrace).toBe(2);
    });
  });
});

describe('shot power: free, capped or fixed', () => {
  const rules = (over: Partial<RoomRules> = {}): RoomRules => ({ ...rulesOf(DEFAULT_SETTINGS), ...over });

  it('is exactly one of the three', () => {
    expect(powerModeOf(rules())).toBe('free');
    expect(powerModeOf(rules({ maxPower: 60 }))).toBe('cap');
    expect(powerModeOf(rules({ fixedPower: true }))).toBe('fixed');
    // Old saves could hold both; the fixed power wins.
    expect(powerModeOf(rules({ fixedPower: true, maxPower: 40 }))).toBe('fixed');
  });

  it('never has a cap and a fixed power at once after a switch', () => {
    for (const mode of ['free', 'cap', 'fixed'] as PowerMode[]) {
      const after = rules(powerModePatch(mode));
      expect(powerModeOf(after), mode).toBe(mode);
      expect(after.fixedPower && after.maxPower < AIM.MAX_POWER, mode).toBe(false);
    }
  });

  it('comes back to the cap it had', () => {
    expect(powerModePatch('cap', 40)).toEqual({ fixedPower: false, maxPower: 40 });
    expect(powerModePatch('cap')).toEqual({ fixedPower: false, maxPower: DEFAULT_CAP });
  });

  it('keeps the cap slider below "no cap", so dragging it can never drop out of the mode', () => {
    expect(CAP_STOPS).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90]);
    for (const n of CAP_STOPS) expect(powerModeOf(rules({ maxPower: n }))).toBe('cap');
  });

  it('fixes shots at the chosen level', () => {
    expect(startPower({ fixedPower: true, fixedPowerLevel: 80, maxPower: 100 })).toBe(80);
    expect(startPower({ fixedPower: true, fixedPowerLevel: 10, maxPower: 100 })).toBe(10);
    expect(startPower({ fixedPower: false, fixedPowerLevel: 80, maxPower: 100 })).toBe(AIM.DEFAULT_POWER);
    expect(startPower({ fixedPower: false, fixedPowerLevel: 80, maxPower: 30 })).toBe(30);
  });

  it('offers a fixed level every 5, the classic 55 among them', () => {
    expect(AIM.FIXED_OPTIONS[0]).toBe(10);
    expect(AIM.FIXED_OPTIONS.at(-1)).toBe(100);
    expect(AIM.FIXED_OPTIONS).toContain(AIM.FIXED_POWER);
  });

  describe('in the menu', () => {
    const sourceOf = (start: RoomRules) => {
      let current = start;
      const source: RuleSource = { get: () => current, patch: (v) => (current = { ...current, ...v }) };
      return { source, current: () => current };
    };
    /** The control with that label, seen through what every kind of control can do. */
    type Any = { get(): unknown; set(v: unknown): void; hidden?: () => boolean };
    const find = (items: ReturnType<typeof ruleItems>, label: RegExp) => items.find((i) => label.test(i.item.label))!.item as Any;

    it('shows the slider that belongs to the mode, and only that one', () => {
      const { source } = sourceOf(rules());
      const items = ruleItems('classic', source);
      const mode = find(items, /^(Schusskraft|Shot power)$/);
      const cap = find(items, /^Max\. (Schusskraft|shot power)$/);
      const fixed = find(items, /^(Feste Schusskraft|Fixed shot power)$/);
      const hiddenOf = (item: typeof cap) => item.hidden!();

      expect([hiddenOf(cap), hiddenOf(fixed)]).toEqual([true, true]);
      mode.set('cap');
      expect([hiddenOf(cap), hiddenOf(fixed)]).toEqual([false, true]);
      mode.set('fixed');
      expect([hiddenOf(cap), hiddenOf(fixed)]).toEqual([true, false]);
      mode.set('free');
      expect([hiddenOf(cap), hiddenOf(fixed)]).toEqual([true, true]);
    });

    it('moves the right setting with each slider', () => {
      const { source, current } = sourceOf(rules());
      const items = ruleItems('classic', source);
      const mode = find(items, /^(Schusskraft|Shot power)$/);
      mode.set('cap');
      expect(current()).toMatchObject({ fixedPower: false, maxPower: DEFAULT_CAP });
      find(items, /^Max\. (Schusskraft|shot power)$/).set(40);
      expect(current()).toMatchObject({ fixedPower: false, maxPower: 40 });
      mode.set('fixed');
      expect(current()).toMatchObject({ fixedPower: true, maxPower: 100 });
      find(items, /^(Feste Schusskraft|Fixed shot power)$/).set(75);
      expect(current()).toMatchObject({ fixedPower: true, fixedPowerLevel: 75 });
    });

    it('remembers the cap while another mode is tried', () => {
      const { source, current } = sourceOf(rules());
      const items = ruleItems('classic', source);
      const mode = find(items, /^(Schusskraft|Shot power)$/);
      mode.set('cap');
      find(items, /^Max\. (Schusskraft|shot power)$/).set(30);
      mode.set('fixed');
      mode.set('cap');
      expect(current().maxPower).toBe(30);
    });

    it('starts on the mode a game already has', () => {
      const { source } = sourceOf(rules({ maxPower: 50 }));
      const items = ruleItems('horizon', source);
      expect(find(items, /^(Schusskraft|Shot power)$/).get()).toBe('cap');
      expect(find(items, /^Max\. (Schusskraft|shot power)$/).hidden!()).toBe(false);
    });
  });
});
