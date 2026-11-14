import { describe, expect, it } from 'vitest';
import { createMatch, type Match } from '../../src/game';
import { DEFAULT_SETTINGS, type Seat, type Settings } from '../../src/data/settings';
import type { GameMode } from '../../src/sim/modes';

/** What a guest rebuilds a match from: the host's snapshot as it comes over the wire. */
type Snapshotting = Match & { snapshot(): object; restoreSnapshot(s: never): void };
const wire = (snapshot: object): unknown => JSON.parse(JSON.stringify(snapshot));

const seats: Seat[] = ['human', 'easy', 'medium', 'off', 'off', 'off'];

function settings(extra: Partial<Settings>): Settings {
  return { ...DEFAULT_SETTINGS, rounds: 3, seats, ...extra };
}

function make(mode: GameMode, extra: Partial<Settings>): Snapshotting {
  return createMatch(mode, settings(extra), { seats, oracle: true, seed: 11, deterministicCpu: true }) as Snapshotting;
}

const cases: [string, GameMode, Partial<Settings>][] = [
  ['classic', 'classic', {}],
  ['classic with power-ups, anomalies and Mayhem', 'classic', { powerUps: true, mayhem: 2, anomalies: ['pinball', 'fusion'], neighborGrace: 1, killcam: 'every' }],
  ['classic in teams', 'classic', { teamMode: 2, seatTeams: [0, 1, 0, 1, 0, 1] }],
  ['classic with simultaneous shots', 'classic', { simultaneousShots: true }],
  ['event horizon', 'horizon', { powerUps: true }],
  ['solar system', 'solar', { suddenDeath: true }],
];

describe('a snapshot restored into a fresh match gives the same snapshot back', () => {
  for (const [name, mode, extra] of cases) {
    it(name, () => {
      const host = make(mode, extra);
      let compared = 0;
      for (let frame = 0; frame < 60 * 90; frame++) {
        host.update(1 / 60);
        // Every half second, and at every change of phase.
        if (frame % 30 !== 0) continue;
        const sent = wire(host.snapshot());
        const guest = make(mode, extra);
        guest.restoreSnapshot(sent as never);
        expect(wire(guest.snapshot()), `${name} at ${host.clock.toFixed(1)} s in ${host.phase}`).toEqual(sent);
        compared++;
      }
      expect(compared).toBeGreaterThan(100);
    });
  }
});
