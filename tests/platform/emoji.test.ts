import { describe, expect, it } from 'vitest';
import { applySuggestion, emojify, suggest } from '../../src/platform/emoji';

describe('emojify', () => {
  it('turns codes and smileys into emoji', () => {
    expect(emojify('gg :fire: :-) ok')).toBe('gg 🔥 🙂 ok');
  });
  it('leaves unknown codes and smiley-like text inside words alone', () => {
    expect(emojify(':nope: http://a:)b')).toBe(':nope: http://a:)b');
  });
});

describe('suggest', () => {
  it('offers at most three codes for a started code', () => {
    const s = suggest('hi :sm');
    expect(s.length).toBeGreaterThan(0);
    expect(s.length).toBeLessThanOrEqual(3);
    expect(s[0].label).toBe(':smile:');
  });
  it('offers smileys for a started smiley and for a finished one', () => {
    expect(suggest(':-').map((x) => x.label)).toContain(':-)');
    expect(suggest(':-)')[0].emoji).toBe('🙂');
  });
  it('offers nothing for ordinary words', () => {
    expect(suggest('hello x')).toEqual([]);
  });
  it('puts the pick in place of the word at the caret', () => {
    const [s] = suggest('a :fir');
    expect(applySuggestion('a :fir', 6, s)).toEqual({ text: 'a 🔥 ', caret: 5 });
  });
});
