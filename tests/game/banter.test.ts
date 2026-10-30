import { afterEach, describe, expect, it } from 'vitest';
import { Banter, BANTER_LINES, type BanterCue, type BanterKind } from '../../src/game/banter';
import { createRng } from '../../src/sim/rng';
import { setLang, t, type Key } from '../../src/platform/i18n';

const levels = ['easy', 'medium', 'hard', 'hawking'] as const;
const kinds: BanterKind[] = ['nearMiss', 'kill', 'died', 'ownGoal'];
const cue = (kind: BanterKind, player = 1): BanterCue => ({ kind, player, other: 0 });

afterEach(() => setLang('en'));

describe('CPU banter', () => {
  it('has lines for every level and kind, in both languages, each different from the rest of its pool', () => {
    for (const lang of ['en', 'de'] as const) {
      setLang(lang);
      for (const level of levels) {
        for (const kind of kinds) {
          const lines = Array.from({ length: BANTER_LINES }, (_, n) => t(`banter.${level}.${kind}.${n}` as Key, { name: 'Ann' }));
          expect(new Set(lines).size).toBe(BANTER_LINES);
          for (const line of lines) {
            expect(line).not.toContain('{');
            // The relay cuts a chat line at 200 characters.
            expect(line.length).toBeLessThanOrEqual(200);
          }
        }
      }
    }
  });

  it('always has a word for an own goal, names the enemy, and then holds its tongue for a while', () => {
    const banter = new Banter(() => 0);
    const first = banter.line('hard', cue('kill'), 'Ann', 100_000);
    expect(first).toBe(t('banter.hard.kill.0', { name: 'Ann' }));
    expect(banter.line('medium', cue('ownGoal', 2), 'Ann', 101_000)).toBeNull();
    expect(banter.line('medium', cue('ownGoal', 2), 'Ann', 105_000)).not.toBeNull();
    // The same CPU waits longer than the others do.
    expect(banter.line('medium', cue('ownGoal', 2), 'Ann', 112_000)).toBeNull();
    expect(banter.line('medium', cue('ownGoal', 2), 'Ann', 121_000)).not.toBeNull();
  });

  it('is not always in the mood for a near miss', () => {
    const talkative = new Banter(() => 0.1);
    const quiet = new Banter(() => 0.99);
    expect(talkative.line('easy', cue('nearMiss'), 'Ann', 100_000)).not.toBeNull();
    expect(quiet.line('easy', cue('nearMiss'), 'Ann', 100_000)).toBeNull();
    // An own goal is told regardless.
    expect(quiet.line('easy', cue('ownGoal'), 'Ann', 100_000)).not.toBeNull();
  });

  it('never says the same line twice in a row for the same remark', () => {
    const banter = new Banter(createRng(5));
    let previous: string | null = null;
    for (let i = 0; i < 40; i++) {
      const line = banter.line('hawking', cue('ownGoal'), 'Ann', 100_000 + i * 20_000);
      expect(line).not.toBeNull();
      expect(line).not.toBe(previous);
      previous = line;
    }
  });
});
