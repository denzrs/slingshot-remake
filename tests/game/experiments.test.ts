import { describe, expect, it } from 'vitest';
import { createMatch } from '../../src/game';
import { EXPERIMENT_NAMES, experimentsFrom, isExperiment } from '../../src/game/experiments';
import { DEFAULT_SETTINGS, cloneSettings } from '../../src/data/settings';

const settings = () => ({ ...cloneSettings(DEFAULT_SETTINGS), seats: ['human', 'cpu', 'off', 'off', 'off', 'off'] as typeof DEFAULT_SETTINGS.seats });
type Trier = { trying(name: string): boolean };

describe('experiments', () => {
  it('reads known names from a page address, each once, and nothing else', () => {
    expect(experimentsFrom('?try=lane-check')).toEqual(['lane-check']);
    expect(experimentsFrom('?try=lane-check,lane-check,nonsense')).toEqual(['lane-check']);
    expect(experimentsFrom('?debug=1')).toEqual([]);
    expect(isExperiment('lane-check')).toBe(true);
    expect(isExperiment('toString')).toBe(false);
  });

  it('plays by an experiment only in an offline game that asked for it', () => {
    const name = EXPERIMENT_NAMES[0];
    const asked = createMatch('classic', settings(), { experiments: [name], seed: 1 });
    expect((asked as unknown as Trier).trying(name)).toBe(true);
    expect(asked.experiments).toEqual([name]);
    const plain = createMatch('classic', settings(), { seed: 1 });
    expect((plain as unknown as Trier).trying(name)).toBe(false);
    expect(plain.experiments).toEqual([]);
  });

  it('ignores them online and in attract mode', () => {
    const name = EXPERIMENT_NAMES[0];
    const online = createMatch('classic', settings(), { experiments: [name], oracle: true, seed: 1 });
    expect((online as unknown as Trier).trying(name)).toBe(false);
    const attract = createMatch('classic', settings(), { experiments: [name], attract: true, seed: 1 });
    expect((attract as unknown as Trier).trying(name)).toBe(false);
  });
});
