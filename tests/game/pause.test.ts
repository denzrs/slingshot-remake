import { describe, expect, it } from 'vitest';
import { createMatch, type ClassicMatch } from '../../src/game';
import { PAUSE_COUNTDOWN } from '../../src/game/match';
import { DEFAULT_SETTINGS, type Seat } from '../../src/data/settings';

const seats: Seat[] = ['human', 'easy', 'off', 'off'];

function online(): ClassicMatch {
  return createMatch('classic', { ...DEFAULT_SETTINGS, rounds: 3, seats }, { seats, oracle: true, seed: 7 }) as ClassicMatch;
}

/** Plays on until a CPU has thought for a while: a running game keeps changing, a paused one does not. */
function run(m: ClassicMatch, seconds: number): void {
  for (let t = 0; t < seconds; t += 1 / 60) m.update(1 / 60);
}

describe("the host's pause", () => {
  it('freezes the clocks, the CPUs and the shot in the air until the countdown is over', () => {
    const m = online();
    run(m, 0.5);
    m.pauseGame();
    expect(m.pause).toEqual({ resumeIn: null });
    const before = JSON.stringify(m.snapshot());
    run(m, 20);
    m.extrapolate(5);
    expect(JSON.stringify(m.snapshot())).toBe(before);

    m.resumeGame();
    run(m, PAUSE_COUNTDOWN - 0.5);
    expect(m.pause?.resumeIn).toBeGreaterThan(0);
    expect(m.pause?.resumeIn).toBeLessThanOrEqual(0.5 + 0.02);
    run(m, 0.6);
    expect(m.pause).toBeNull();
    const clock = m.clock;
    run(m, 1);
    expect(m.clock).toBeGreaterThan(clock);
  });

  it('is the host\'s alone, and only online', () => {
    const guest = online();
    guest.canAdvance = false;
    guest.pauseGame();
    expect(guest.pause).toBeNull();

    const offline = createMatch('classic', { ...DEFAULT_SETTINGS, rounds: 3, seats }, { seats, seed: 7 }) as ClassicMatch;
    offline.pauseGame();
    expect(offline.pause).toBeNull();
  });

  it('only counts down once the host has resumed, and rides along in the snapshot', () => {
    const m = online();
    m.pauseGame();
    run(m, 10);
    expect(m.pause).toEqual({ resumeIn: null });

    const copy = online();
    copy.restoreSnapshot(m.snapshot());
    expect(copy.pause).toEqual({ resumeIn: null });
    m.resumeGame();
    copy.restoreSnapshot(m.snapshot());
    expect(copy.pause).toEqual({ resumeIn: PAUSE_COUNTDOWN });

    m.pause = null;
    copy.restoreSnapshot(m.snapshot());
    expect(copy.pause).toBeNull();
  });
});
