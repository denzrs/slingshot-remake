import { beforeAll, describe, expect, it } from 'vitest';
import { setLang } from '../../src/platform/i18n';
import { factParts, factText, factTexts } from '../../src/net/statsFacts';

describe('facts for the menu', () => {
  beforeAll(() => setLang('en'));

  it('words a fact with its numbers', () => {
    expect(factText({ id: 'firstTurn', values: [15.6, 18] })).toBe('A shot in the first turn hits 16% of the time, a later one 18%.');
    expect(factText({ id: 'rounds', values: [70.75, 161.1] })).toBe('An average round takes 1:11, the longest 2:41.');
    expect(factText({ id: 'betWin', values: [250] })).toBe('Biggest bet win so far: +250 points.');
    expect(factText({ id: 'holeShots', values: [0.4] })).toContain('0.4%');
    expect(factText({ id: 'plasmaShots', values: [4.2, 50] })).toBe('4.2% of all shots are plasma – 50% of those hit.');
    expect(factText({ id: 'shotsPerKill', values: [10.26] })).toBe('It takes 10.3 shots on average to destroy a ship.');
    expect(factText({ id: 'topPlacement', values: [4, 12] })).toBe('The most-placed power-up is the teleport: 12 times so far.');
    expect(factText({ id: 'weekTrend', values: [140, 112.5] })).toBe('The last 7 days: 140 rounds – 113% of the week before.');
    expect(factText({ id: 'intercepts', values: [37.5] })).toBe('Planetary defenses bring down 38% of the shots they fire at.');
    expect(factText({ id: 'strayKills', values: [3] })).toBe('Defense missiles that lost their target have destroyed 3 ships.');
    expect(factText({ id: 'firstBlood', values: [61.2] })).toBe('Whoever draws first blood goes on to win the round 61% of the time.');
    expect(factText({ id: 'bounties', values: [42, 875] })).toBe('42 leaders have been shot down for the bounty on their head – the biggest paid 875 points.');
    expect(factText({ id: 'revenges', values: [8.4] })).toBe('8.4% of kills are revenge on the ship that shot the shooter down the round before.');
    expect(factText({ id: 'topBonus', values: [7, 12] })).toBe('Besides first blood, the extra paid most often is Domination: 12 times.');
    expect(factText({ id: 'topBonus', values: [99, 12] })).toBeNull();
  });

  it('has nothing to say about a fact it does not know, one with numbers missing, or a harmless 0% self hit', () => {
    expect(factText({ id: 'fromTheFuture', values: [1] })).toBeNull();
    expect(factText({ id: 'firstTurn', values: [15] })).toBeNull();
    expect(factText({ id: 'selfHighHorizon', values: [0, 0] })).toBeNull();
    // A power-up this client does not know yet.
    expect(factText({ id: 'topPlacement', values: [99, 12] })).toBeNull();
    expect(factText({ id: 'selfHighHorizon', values: [20, 4] })).toBe('In Event Horizon, 20% of shots at power 80 or more hit the shooter – below that, 4%.');
  });

  it('shuffles all the sentences and drops the unusable ones', () => {
    const facts = [
      { id: 'holeShots', values: [17] },
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
    expect(factParts({ id: 'holeShots', values: [12] })?.map((p) => p.text)).toEqual(['12 %', ' aller Schüsse verschluckt ein Schwarzes Loch.']);
    setLang('en');
  });
});
