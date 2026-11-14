import { describe, expect, it } from 'vitest';
import { HostPause } from '../../src/game/host-pause';
import { PAUSE_COUNTDOWN } from '../../src/game/match-types';
import { SkipVoting, type SkipVoteDeps } from '../../src/game/skip-vote';

function voting(people: number[], over: Partial<SkipVoteDeps> = {}) {
  const log = { skipped: 0, said: [] as string[], clock: 0 };
  const v = new SkipVoting({
    clock: () => log.clock,
    voters: () => people,
    canSkipRound: () => true,
    skipRound: () => {
      log.skipped++;
      v.clear();
    },
    online: () => true,
    isCpu: () => false,
    said: (text) => log.said.push(text),
    ...over,
  });
  return { v, log };
}

describe('the vote to skip a round', () => {
  it('is skipped at once offline, and opened by the host only online', () => {
    const offline = voting([0], { online: () => false });
    offline.v.request(0);
    expect(offline.log.skipped).toBe(1);
    const { v, log } = voting([0, 1, 2]);
    v.request(1);
    expect(v.vote).toBeNull();
    v.request(0);
    expect(v.vote?.yes).toEqual([0]);
    expect(log.skipped).toBe(0);
  });

  it('carries on more than half of the people at the table, once each', () => {
    const { v, log } = voting([0, 1, 2]);
    v.request(0);
    v.answer(0, true);
    expect(v.vote?.yes).toEqual([0]);
    expect(v.needed).toBe(2);
    v.answer(1, true);
    expect(log.skipped).toBe(1);
  });

  it('is declined when too many say no, and lapses when time runs out', () => {
    const declined = voting([0, 1, 2]);
    declined.v.request(0);
    declined.v.answer(1, false);
    declined.v.answer(2, false);
    expect(declined.v.vote).toBeNull();
    expect(declined.log.said).toEqual(['skip.declined']);

    const lapsed = voting([0, 1, 2]);
    lapsed.v.request(0);
    lapsed.log.clock = 21;
    lapsed.v.tick();
    expect(lapsed.v.vote).toBeNull();
    expect(lapsed.log.said).toEqual(['skip.lapsed']);
  });

  it('counts again for whoever is still at the table', () => {
    const people = [0, 1, 2];
    const { v, log } = voting(people);
    v.request(0);
    expect(v.canAnswer(1)).toBe(true);
    expect(v.canAnswer(0)).toBe(false);
    people.splice(2, 1);
    v.tableChanged();
    expect(v.needed).toBe(2);
    expect(log.skipped).toBe(0);
    people.splice(1, 1);
    v.tableChanged();
    expect(log.skipped).toBe(1);
  });
});

describe("the host's pause", () => {
  it('stops only when allowed, counts down once resumed and then ends', () => {
    const pause = new HostPause();
    pause.stop(false);
    expect(pause.state).toBeNull();
    pause.stop(true);
    expect(pause.state).toEqual({ resumeIn: null });
    pause.tick(5);
    expect(pause.state).toEqual({ resumeIn: null });
    pause.resume();
    expect(pause.state).toEqual({ resumeIn: PAUSE_COUNTDOWN });
    pause.tick(1);
    expect(pause.state).toEqual({ resumeIn: PAUSE_COUNTDOWN - 1 });
    pause.tick(PAUSE_COUNTDOWN);
    expect(pause.state).toBeNull();
  });
});
