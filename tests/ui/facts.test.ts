import { describe, expect, it, vi } from 'vitest';
import type { StatsBoard } from '../../src/net/statsBoard';
import { loadFacts } from '../../src/ui/stats/facts';

describe('loadFacts', () => {
  it('keeps no failure: the next one to ask goes to the relay again', async () => {
    const facts = [{ id: 'holeShots', values: [17] }];
    const board = { facts: vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(facts) } as unknown as StatsBoard;
    await expect(loadFacts(board)).rejects.toThrow('offline');
    expect(await loadFacts(board)).toEqual(facts);
    // Once they came, they are kept.
    expect(await loadFacts(board)).toEqual(facts);
    expect(board.facts).toHaveBeenCalledTimes(2);
  });
});
