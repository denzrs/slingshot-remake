import { beforeAll, describe, expect, it } from 'vitest';
import { setLang } from '../src/i18n';
import { factParts, factText, factTexts } from '../src/statsFacts';

describe('facts for the menu', () => {
  beforeAll(() => setLang('en'));

  it('words a fact with its numbers', () => {
    expect(factText({ id: 'firstTurn', values: [15.6, 18] })).toBe('A shot in the first turn hits 16% of the time, a later one 18%.');
    expect(factText({ id: 'rounds', values: [70.75, 161.1] })).toBe('An average round takes 1:11, the longest 2:41.');
    expect(factText({ id: 'betWin', values: [250] })).toBe('Biggest bet win so far: +250 points.');
    expect(factText({ id: 'hitRate', values: [0.4] })).toContain('0.4%');
    expect(factText({ id: 'plasmaShots', values: [4.2, 50] })).toBe('4.2% of all shots are plasma – 50% of those hit.');
    expect(factText({ id: 'placedNebula', values: [12] })).toBe('12 nebulae have been placed.');
    expect(factText({ id: 'weekTrend', values: [140, 112.5] })).toBe('The last 7 days: 140 rounds – 113% of the week before.');
  });

  it('has nothing to say about a fact it does not know, one with numbers missing, or a harmless 0% self hit', () => {
    expect(factText({ id: 'fromTheFuture', values: [1] })).toBeNull();
    expect(factText({ id: 'firstTurn', values: [15] })).toBeNull();
    expect(factText({ id: 'selfHighHorizon', values: [0, 0] })).toBeNull();
    expect(factText({ id: 'selfHighHorizon', values: [20, 4] })).toBe('In Event Horizon, 20% of shots at power 80 or more hit the shooter – below that, 4%.');
  });

  it('shuffles all the sentences and drops the unusable ones', () => {
    const facts = [
      { id: 'hitRate', values: [17] },
      { id: 'leftField', values: [52] },
      { id: 'nope', values: [] },
    ];
    const texts = factTexts(facts, () => 0);
    expect(texts).toHaveLength(2);
    expect(new Set(texts)).toEqual(new Set(facts.slice(0, 2).map((f) => factText(f))));
  });
});

describe('factParts', () => {
  it('sets the numbers apart from the words', () => {
    expect(factParts({ id: 'firstTurn', values: [15.6, 18] })).toEqual([
      { text: 'A shot in the first turn hits ', number: false },
      { text: '16%', number: true },
      { text: ' of the time, a later one ', number: false },
      { text: '18%', number: true },
      { text: '.', number: false },
    ]);
  });

  it('keeps the space before a percent sign with the number', () => {
    setLang('de');
    expect(factParts({ id: 'hitRate', values: [12] })?.map((p) => p.text)).toEqual(['Nur ', '12 %', ' aller Schüsse treffen ein gegnerisches Schiff.']);
    setLang('en');
  });
});
