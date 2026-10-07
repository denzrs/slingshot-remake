import { describe, expect, it } from 'vitest';
import { createMatch } from '../src/game';
import type { ClassicMatch } from '../src/game/classic';
import type { HorizonMatch } from '../src/game/horizon';
import { SnapshotDecoder, SnapshotEncoder } from '../src/netsync';
import { DEFAULT_SETTINGS, type Seat } from '../src/settings';

/** Trail points are rounded on the wire; round the expected side the same way before comparing. */
function normalized(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value), (key, v) => (key === 'trail' || key === 'points') && Array.isArray(v) ? v.map((n: number) => Math.round(n * 10) / 10 + 0) : v);
}

const seats = (n: number): Seat[] => [...Array(n).fill('hard'), ...Array(6 - n).fill('off')];

/** Host and guest: every patch the host encodes must rebuild exactly the host's snapshot on the guest. */
function sync(mode: 'classic' | 'horizon') {
  const host = createMatch(mode, { ...DEFAULT_SETTINGS, rounds: 2, seats: seats(4) }, { seats: seats(4) }) as ClassicMatch | HorizonMatch;
  const encoder = new SnapshotEncoder();
  const decoder = new SnapshotDecoder();
  for (let i = 0; i < 60 * 40 && host.phase !== 'gameOver'; i++) {
    host.update(1 / 60);
    if (i % 4) continue;
    // Over the wire and back, exactly as the relay would do it.
    const patch = JSON.parse(JSON.stringify(encoder.encode(host.snapshot())));
    const rebuilt = decoder.apply(patch);
    expect(rebuilt).not.toBeNull();
    expect(normalized(rebuilt)).toEqual(normalized(host.snapshot()));
  }
}

describe('state patches', () => {
  for (const mode of ['classic', 'horizon'] as const) {
    it(`rebuilds the ${mode} host state exactly`, () => {
      sync(mode);
    }, 30_000);
  }

  it('sends nothing for an unchanged state apart from the clock', () => {
    const host = createMatch('classic', { ...DEFAULT_SETTINGS, seats: seats(3) }, { seats: seats(3) }) as ClassicMatch;
    const encoder = new SnapshotEncoder();
    encoder.encode(host.snapshot());
    expect(Object.keys(encoder.encode(host.snapshot()))).toEqual([]);
  });
});
