import { afterEach, describe, expect, it, vi } from 'vitest';
import { t } from '../src/i18n';
import type { GameMode } from '../src/modes';
import { loadCustomPresets, loadOverride, MAX_CUSTOM_PRESETS, saveCustomPreset } from '../src/customPresets';
import { defaultRoomRules, type RoomRules } from '../src/roomRules';
import { PresetCards, type PresetCreator, type PresetHost, type PresetSelection } from '../src/ui/preset-cards';
import { handpickedPresets, pickOfTheDay, presetRules, presetsForMode, savedPresetRules } from '../src/ui/match-presets';

const DAY = '2026-10-25';

/** A localStorage that keeps what is written, like the browser's. */
function storage(): void {
  const values: Record<string, string> = {};
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values[key] ?? null,
    setItem: (key: string, value: string) => void (values[key] = value),
  });
}

afterEach(() => vi.unstubAllGlobals());

interface Setup {
  cards: PresetCards;
  host: PresetHost;
  state: { current?: PresetSelection };
  /** The rules as they play now; the page edits them like a player would. */
  rules: RoomRules;
  calls: { apply: number; repaint: number; rebuild: number };
  creators: PresetCreator[];
}

function setup(mode: GameMode = 'classic', online = false, start: RoomRules = defaultRoomRules()): Setup {
  storage();
  const state: { current?: PresetSelection } = {};
  const calls = { apply: 0, repaint: 0, rebuild: 0 };
  const creators: PresetCreator[] = [];
  const result = { rules: start } as Setup;
  const host: PresetHost = {
    mode: () => mode,
    online,
    rules: () => result.rules,
    apply: (rules) => { result.rules = rules; calls.apply++; },
    repaint: () => { calls.repaint++; },
    rebuild: () => { calls.rebuild++; },
    showCreator: (creator) => { creators.push(creator); },
    today: () => DAY,
  };
  return Object.assign(result, { cards: new PresetCards(host, state), host, state, calls, creators });
}

const card = (s: Setup, id: string) => s.cards.cards().find((c) => c.id === id)!;

describe('the preset cards', () => {
  it('lay out the presets, today\'s pick, the player\'s own and the slot for the next one', () => {
    for (const mode of ['classic', 'horizon', 'solar'] as const) {
      const s = setup(mode);
      expect(s.cards.cards().map((c) => [c.kind, c.id])).toEqual([
        ...presetsForMode(mode).map((preset) => ['preset', preset]),
        ['pick', 'handpicked'],
        ['new', 'custom:new'],
      ]);
    }
  });

  it('start on the first preset, keeping the table\'s switches', () => {
    const s = setup('solar', true, { ...defaultRoomRules(), betting: true, chatPlayersOnly: true, rounds: 20 });
    s.cards.start();
    expect(s.state.current?.id).toBe('standard');
    expect(s.rules).toEqual({ ...savedPresetRules('standard', 'solar'), betting: true, chatPlayersOnly: true });
  });

  it('recognise the card that plays the rules as they are', () => {
    const s = setup('classic', false, presetRules('mayhem', 'classic'));
    s.cards.detect();
    expect(s.state.current?.id).toBe('mayhem');

    const pick = pickOfTheDay('classic', DAY);
    const picked = setup('classic', false, pick.rules);
    picked.cards.detect();
    expect(picked.state.current?.id).toBe('handpicked');

    const odd = setup('classic', false, { ...defaultRoomRules(), rounds: 15, bounce: true });
    odd.cards.detect();
    expect(odd.state.current).toBeUndefined();
  });

  it('recognise a preset of the player\'s own', () => {
    const s = setup();
    const mine = saveCustomPreset('classic', { name: 'Mine', rules: { ...defaultRoomRules(), rounds: 15 } })!;
    s.rules = { ...defaultRoomRules(), rounds: 15 };
    s.cards.detect();
    expect(s.state.current?.id).toBe(`custom:${mine.id}`);
  });

  it('count the rules changed since a card was chosen, and say so on the card', () => {
    const s = setup();
    card(s, 'simultaneous').choose();
    expect(s.rules.simultaneousShots).toBe(true);
    expect(card(s, 'simultaneous').selected()).toBe(true);
    expect(card(s, 'simultaneous').status()).toBe('');
    s.rules = { ...s.rules, rounds: 10 };
    expect(card(s, 'simultaneous').modified()).toBe(true);
    expect(card(s, 'simultaneous').status()).toBe(t('preset.modified.one'));
    s.rules = { ...s.rules, hiddenAim: true };
    expect(card(s, 'simultaneous').status()).toBe(t('preset.modified.many', { n: 2 }));
    expect(card(s, 'standard').modified()).toBe(false);
  });

  it('go back to what the card gave, or keep the changes as what it gives from now on', () => {
    const s = setup();
    card(s, 'simultaneous').choose();
    s.rules = { ...s.rules, rounds: 10 };
    card(s, 'simultaneous').action();
    expect(s.rules.rounds).toBe(5);
    expect(card(s, 'simultaneous').modified()).toBe(false);

    s.rules = { ...s.rules, rounds: 10 };
    const before = s.calls.repaint;
    s.cards.keep('simultaneous');
    expect(s.calls.repaint).toBe(before + 1);
    expect(card(s, 'simultaneous').modified()).toBe(false);
    s.rules = { ...s.rules, rounds: 3 };
    s.cards.reset('simultaneous');
    expect(s.rules.rounds).toBe(10);
  });

  it('save the changes to a built-in preset as its own version, and restore the original', () => {
    const s = setup();
    card(s, 'simultaneous').choose();
    s.rules = { ...s.rules, rounds: 10 };
    expect(card(s, 'simultaneous').secondary!.visible()).toBe(true);
    card(s, 'simultaneous').secondary!.run();
    expect(loadOverride('classic', 'simultaneous')?.rounds).toBe(10);
    expect(card(s, 'simultaneous').modified()).toBe(false);
    expect(card(s, 'simultaneous').status()).toBe(t('preset.overridden'));
    expect(card(s, 'simultaneous').actionLabel()).toBe(t('preset.restoreOriginal'));

    card(s, 'simultaneous').action();
    expect(loadOverride('classic', 'simultaneous')).toBeNull();
    expect(s.rules.rounds).toBe(5);
    expect(card(s, 'simultaneous').status()).toBe('');
  });

  it('leave the rules alone when the original of a card that is not chosen is restored', () => {
    const s = setup();
    card(s, 'standard').choose();
    const before = s.calls.apply;
    card(s, 'mayhem').action();
    expect(s.calls.apply).toBe(before);
  });

  it('ignore a choice made in another game', () => {
    const s = setup('classic');
    card(s, 'standard').choose();
    expect(s.cards.selection()).toBeDefined();
    const other = new PresetCards({ ...s.host, mode: () => 'horizon' }, s.state);
    expect(other.selection()).toBeUndefined();
    expect(other.changes('standard')).toBe(0);
  });

  it('send the rules page\'s reset back to the standard rules, or to Mayhem at its strength', () => {
    const s = setup('classic', false, { ...defaultRoomRules(), rounds: 15 });
    s.cards.resetToStandard();
    expect(s.state.current?.id).toBe('standard');
    expect(s.rules).toEqual(defaultRoomRules());

    const mayhem = setup('horizon', false, { ...presetRules('mayhem', 'horizon'), mayhem: 3, rounds: 15 });
    mayhem.cards.resetToStandard();
    expect(mayhem.state.current?.id).toBe('mayhem');
    expect(mayhem.rules).toEqual({ ...presetRules('mayhem', 'horizon'), mayhem: 3 });
  });
});

describe('the player\'s own presets', () => {
  it('get a page to make them on, named by default and kept with the rules as they play then', () => {
    const s = setup();
    card(s, 'custom:new').open!();
    const creator = s.creators[0];
    expect(creator.existing).toBeUndefined();
    expect(creator.defaultName).toBe(t('preset.creator.namePlaceholder', { n: 1 }));
    s.rules = { ...s.rules, rounds: 15 };
    creator.name = 'Marathon';
    expect(creator.save()).toBe(true);
    const [kept] = loadCustomPresets('classic');
    expect(kept).toMatchObject({ name: 'Marathon', rules: { rounds: 15 } });
    expect(s.state.current?.id).toBe(`custom:${kept.id}`);
    expect(creator.saved).toBe(true);
    // Leaving after Save puts nothing back.
    const before = s.calls.apply;
    creator.cancel();
    expect(s.calls.apply).toBe(before);
  });

  it('put the rules back when the page is left without saving', () => {
    const s = setup();
    card(s, 'custom:new').open!();
    const creator = s.creators[0];
    s.rules = { ...s.rules, rounds: 15 };
    creator.cancel();
    expect(s.rules.rounds).toBe(5);
    expect(loadCustomPresets('classic')).toEqual([]);
  });

  it('open on the rules they were kept with, change in place, and go when deleted', () => {
    const s = setup();
    const mine = saveCustomPreset('classic', { name: 'Mine', rules: { ...defaultRoomRules(), rounds: 15 } })!;
    const id = `custom:${mine.id}`;
    expect(card(s, id).status()).toBe(t('preset.custom.edit'));
    expect(card(s, id).actionLabel()).toBe(t('preset.custom.edit'));
    card(s, id).choose();
    expect(s.rules.rounds).toBe(15);
    s.rules = { ...s.rules, rounds: 20 };
    expect(card(s, id).status()).toBe(t('preset.custom.modified'));
    expect(card(s, id).actionLabel()).toBe(t('preset.resetAction'));

    card(s, id).secondary!.run();
    expect(loadCustomPresets('classic')[0].rules.rounds).toBe(20);
    expect(s.calls.rebuild).toBe(1);

    s.rules = { ...s.rules, rounds: 3 };
    s.cards.reset(id);
    expect(s.rules.rounds).toBe(20);

    card(s, id).action();
    const creator = s.creators[0];
    expect(creator.existing?.id).toBe(mine.id);
    expect(creator.name).toBe('Mine');
    expect(s.rules.rounds).toBe(20);
    creator.remove();
    expect(loadCustomPresets('classic')).toEqual([]);
  });

  it('keep the table\'s switches when one is chosen, and stop offering the slot once the list is full', () => {
    const s = setup('classic', true);
    const mine = saveCustomPreset('classic', { name: 'Mine', rules: { ...defaultRoomRules(), rounds: 15 } })!;
    s.rules = { ...s.rules, betting: true };
    card(s, `custom:${mine.id}`).choose();
    expect(s.rules.betting).toBe(true);
    expect(card(s, 'custom:new').hint).toBe('');
    for (let i = 1; i < MAX_CUSTOM_PRESETS; i++) saveCustomPreset('classic', { name: `P${i}`, rules: defaultRoomRules() });
    expect(s.cards.cards().some((c) => c.kind === 'new')).toBe(false);
  });

  it('give the first one a card to itself, with a hint', () => {
    const s = setup();
    expect(card(s, 'custom:new').hint).not.toBe('');
    expect(card(s, 'custom:new').art).toBeDefined();
  });

  it('show today\'s pick of the chosen mode', () => {
    const s = setup('horizon');
    const pick = handpickedPresets('horizon').find(({ id }) => id === pickOfTheDay('horizon', DAY).id)!;
    card(s, 'handpicked').choose();
    expect(s.rules).toEqual({ ...pick.rules, betting: false, chatPlayersOnly: false });
    expect(s.state.current?.id).toBe('handpicked');
  });
});
