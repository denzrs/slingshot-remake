import { describe, expect, it, vi } from 'vitest';
import { createMatch } from '../src/game';
import type { ClassicMatch } from '../src/game/classic';
import type { HorizonMatch } from '../src/game/horizon';
import { SnapshotDecoder, SnapshotEncoder } from '../src/netsync';
import { createRng } from '../src/rng';
import { DEFAULT_SETTINGS, type Seat } from '../src/settings';

/** Trail points are rounded on the wire; round the expected side the same way before comparing. */
function normalized(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value), (key, v) => (key === 'trail' || key === 'points') && Array.isArray(v) ? v.map((n: number) => Math.round(n * 10) / 10 + 0) : v);
}

const seats = (n: number): Seat[] => [...Array(n).fill('hard'), ...Array(6 - n).fill('off')];

/** Host and guest: every patch the host encodes must rebuild exactly the host's snapshot on the guest. */
function sync(mode: 'classic' | 'horizon') {
  // Worlds and CPU shots come from Math.random; a fixed seed keeps the sizes below from varying between runs.
  const rng = createRng(7);
  vi.spyOn(Math, 'random').mockImplementation(() => rng());
  try {
    return syncSeeded(mode);
  } finally {
    vi.restoreAllMocks();
  }
}

function syncSeeded(mode: 'classic' | 'horizon') {
  const host = createMatch(mode, { ...DEFAULT_SETTINGS, rounds: 2, seats: seats(4) }, { seats: seats(4) }) as ClassicMatch | HorizonMatch;
  const encoder = new SnapshotEncoder();
  const decoder = new SnapshotDecoder();
  const sizes: number[] = [];
  let checked = 0;
  for (let i = 0; i < 60 * 40 && host.phase !== 'gameOver'; i++) {
    host.update(1 / 60);
    if (i % 4) continue;
    // Over the wire and back, exactly as the relay would do it.
    const patch = JSON.parse(JSON.stringify(encoder.encode(host.snapshot())));
    sizes.push(JSON.stringify(patch).length);
    const rebuilt = decoder.apply(patch);
    expect(rebuilt).not.toBeNull();
    expect(normalized(rebuilt)).toEqual(normalized(host.snapshot()));
    checked++;
  }
  return { sizes, checked };
}

describe('state patches', () => {
  for (const mode of ['classic', 'horizon'] as const) {
    it(`rebuild the ${mode} host state exactly and stay small`, () => {
      const { sizes, checked } = sync(mode);
      expect(checked).toBeGreaterThan(300);
      const typical = [...sizes].sort((a, b) => a - b)[Math.floor(sizes.length / 2)];
      expect(typical).toBeLessThan(6_000);
      // The occasional spike is a volley's finished trails, once per volley (up to ~150 KB for a long flight);
      // a tick used to cost 40–150 KB, which the typical size above catches.
      expect(Math.max(...sizes)).toBeLessThan(250_000);
    }, 30_000);
  }

  it('sends nothing for an unchanged state apart from the clock', () => {
    const host = createMatch('classic', { ...DEFAULT_SETTINGS, seats: seats(3) }, { seats: seats(3) }) as ClassicMatch;
    const encoder = new SnapshotEncoder();
    encoder.encode(host.snapshot());
    expect(Object.keys(encoder.encode(host.snapshot()))).toEqual([]);
  });
});
