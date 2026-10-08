import { describe, expect, it } from 'vitest';
import type { ExperimentalShot, PlanetEstimate } from '../src/experimental-ai';
import { balancedObservations, matchEstimatedSources, retainRepresentativeShots } from '../src/experimental-evidence';

function trajectory(count: number, shotId = 0, angle = 0, originX = 0, originY = 0): ExperimentalShot {
  const points: number[] = [];
  const radians = angle * Math.PI / 180;
  for (let point = 0; point < count; point++) {
    points.push(originX + point * 12 * Math.cos(radians), originY + point * 12 * Math.sin(radians));
  }
  return { points, shotId, angle, power: 65 };
}

function sampleCounts(shots: readonly ExperimentalShot[], cap: number): number[] {
  const counts = shots.map(() => 0);
  for (const observation of balancedObservations(shots, cap)) counts[observation.shot]++;
  return counts;
}

function fieldAt(sources: readonly PlanetEstimate[], x: number, y: number): number[] {
  let ax = 0;
  let ay = 0;
  for (const source of sources) {
    const dx = source.x - x;
    const dy = source.y - y;
    const factor = source.mass / Math.max(1, Math.hypot(dx, dy)) ** 3;
    ax += dx * factor;
    ay += dy * factor;
  }
  return [ax, ay];
}

describe('balanced trajectory observations', () => {
  it('represents short paths and redistributes their unused quota', () => {
    const shots = [trajectory(5), trajectory(203), trajectory(23), trajectory(3)];
    expect(sampleCounts(shots, 24)).toEqual([2, 11, 11, 0]);
    expect(sampleCounts(shots, 3)).toEqual([1, 1, 1, 0]);
  });

  it('returns all eligible points without launch or the final two collision samples', () => {
    const shots = [trajectory(7), trajectory(2), trajectory(5)];
    expect(balancedObservations(shots, 96)).toEqual([
      { shot: 0, point: 1 }, { shot: 0, point: 2 }, { shot: 0, point: 3 }, { shot: 0, point: 4 },
      { shot: 2, point: 1 }, { shot: 2, point: 2 },
    ]);
    expect(balancedObservations(shots, Infinity)).toEqual(balancedObservations(shots, 96));
  });

  it('spreads a budget smaller than the trajectory count deterministically across history', () => {
    const shots = Array.from({ length: 9 }, (_, i) => trajectory(12, i));
    expect(sampleCounts(shots, 3)).toEqual([0, 1, 0, 0, 1, 0, 0, 1, 0]);
    expect(balancedObservations(shots, 3)).toEqual(balancedObservations(shots, 3));
  });

  it('keeps a hard budget, unique chronological references and widely spaced samples', () => {
    const shots = [trajectory(10_003), trajectory(103), trajectory(13)];
    const observations = balancedObservations(shots, 30.9);
    expect(observations).toHaveLength(30);
    expect(sampleCounts(shots, 30)).toEqual([10, 10, 10]);
    expect(new Set(observations.map(({ shot, point }) => `${shot}:${point}`)).size).toBe(30);
    for (let i = 0; i < observations.length; i++) {
      const { shot, point } = observations[i];
      expect(point).toBeGreaterThan(0);
      expect(point).toBeLessThan(shots[shot].points.length / 2 - 2);
      if (i) {
        const previous = observations[i - 1];
        expect(shot > previous.shot || (shot === previous.shot && point > previous.point)).toBe(true);
      }
    }
    expect(observations[0].point).toBeGreaterThan(400);
    expect(observations[9].point).toBeGreaterThan(9_000);
  });

  it('handles empty, unusable and zero budgets without producing invalid references', () => {
    expect(balancedObservations([], 96)).toEqual([]);
    expect(balancedObservations([trajectory(0), trajectory(3)], 96)).toEqual([]);
    for (const cap of [0, -1, NaN, -Infinity, 0.9]) {
      expect(balancedObservations([trajectory(10)], cap)).toEqual([]);
    }
  });
});

describe('estimated source correspondence', () => {
  it('aligns swapped hidden labels before interpolation, preserving field predictions', () => {
    const previous = [{ x: 150, y: 200, mass: 100 }, { x: 850, y: 400, mass: 180 }];
    const candidate = [{ x: 170, y: 220, mass: 110 }, { x: 830, y: 420, mass: 170 }];
    const interpolate = (aligned: readonly PlanetEstimate[]) => aligned.map((source, i) => ({
      x: (source.x + previous[i].x) / 2,
      y: (source.y + previous[i].y) / 2,
      mass: (source.mass + previous[i].mass) / 2,
    }));
    const forward = interpolate(matchEstimatedSources(previous, candidate, 1_000, 800));
    const swapped = interpolate(matchEstimatedSources(previous, [...candidate].reverse(), 1_000, 800));
    expect(swapped).toEqual(forward);
    for (const [x, y] of [[100, 100], [450, 300], [900, 600]]) {
      expect(fieldAt(swapped, x, y)).toEqual(fieldAt(forward, x, y));
    }
    expect(matchEstimatedSources([...previous].reverse(), candidate, 1_000, 800)).toEqual([...candidate].reverse());
  });

  it('solves the global minimum instead of greedily using the nearest remaining source', () => {
    const previous = [{ x: 4, y: 0, mass: 100 }, { x: 6, y: 0, mass: 100 }];
    const candidate = [{ x: 5, y: 0, mass: 100 }, { x: 0, y: 0, mass: 100 }];
    expect(matchEstimatedSources(previous, candidate, 10, 10)).toEqual([candidate[1], candidate[0]]);
  });

  it('normalizes geometry by field dimensions and uses mass as a modest tie breaker', () => {
    const previous = [{ x: 0, y: 0, mass: 100 }, { x: 1_000, y: 10, mass: 1_000 }];
    const candidate = [{ x: 0, y: 10, mass: 100 }, { x: 1_000, y: 0, mass: 1_000 }];
    expect(matchEstimatedSources(previous, candidate, 1_000, 10)).toEqual(candidate);
    const coincident = [{ x: 5, y: 5, mass: 100 }, { x: 5, y: 5, mass: 1_000 }];
    expect(matchEstimatedSources(coincident, [...coincident].reverse(), 10, 10)).toEqual(coincident);
    const far = [{ x: 0, y: 0, mass: 1_000 }, { x: 1_000, y: 10, mass: 100 }];
    expect(matchEstimatedSources(previous, far, 1_000, 10)).toEqual(far);
  });

  it('honors stable IDs over proximity and carries existing IDs into unlabeled fits', () => {
    const previous = [{ id: 7, x: 100, y: 0, mass: 100 }, { id: 9, x: 900, y: 0, mass: 100 }];
    const moved = [{ id: 9, x: 110, y: 0, mass: 100 }, { id: 7, x: 890, y: 0, mass: 100 }];
    expect(matchEstimatedSources(previous, moved, 1_000, 800)).toEqual([moved[1], moved[0]]);
    const hidden = [{ x: 890, y: 0, mass: 105 }, { x: 110, y: 0, mass: 95 }];
    expect(matchEstimatedSources(previous, hidden, 1_000, 800)).toEqual([{ ...hidden[1], id: 7 }, { ...hidden[0], id: 9 }]);
    expect(hidden[0]).not.toHaveProperty('id');
  });

  it('handles empty, removed and additional sources without duplicating candidates', () => {
    const previous = [{ x: 100, y: 0, mass: 100 }, { x: 900, y: 0, mass: 100 }];
    const candidate = [{ x: 880, y: 0, mass: 105 }];
    expect(matchEstimatedSources(previous, candidate, 1_000, 800)).toEqual(candidate);
    expect(matchEstimatedSources(previous, [], 1_000, 800)).toEqual([]);
    const added = [{ x: 800, y: 20, mass: 120 }, { x: 110, y: 0, mass: 100 }, { x: 500, y: 50, mass: 80 }];
    expect(matchEstimatedSources(previous.slice(0, 1), added, 1_000, 800)).toEqual([added[1], added[2], added[0]]);
    expect(matchEstimatedSources([], added, 1_000, 800)).toEqual([added[1], added[2], added[0]]);
    const replaced = [{ id: 2, x: 100, y: 0, mass: 100 }];
    expect(matchEstimatedSources([{ ...previous[0], id: 1 }], replaced, 1_000, 800)).toEqual(replaced);
  });
  it('keeps eight-source correspondence one-to-one across cyclic permutations and metadata ties', () => {
    const previous = Array.from({ length: 8 }, (_, i) => ({ x: 100 + i * 100, y: 100 + i % 2 * 300, mass: 100 + i * 20 }));
    const candidate = previous.map((source) => ({ ...source, x: source.x + 3, y: source.y - 2 }));
    for (let shift = 0; shift < candidate.length; shift++) {
      const permuted = [...candidate.slice(shift), ...candidate.slice(0, shift)];
      const matched = matchEstimatedSources(previous, permuted, 1_000, 800);
      expect(matched).toEqual(candidate);
      expect(new Set(matched).size).toBe(8);
    }
    const tied = [{ x: 10, y: 10, mass: 100, massUncertainty: 0.1 }, { x: 10, y: 10, mass: 100, massUncertainty: 0.5 }];
    expect(matchEstimatedSources(tied, [...tied].reverse(), 100, 100)).toEqual(matchEstimatedSources(tied, tied, 100, 100));
  });
});

describe('representative trajectory history', () => {
  it('preserves an older bend when every coarse coverage and launch bin matches', () => {
    const path = (count: number, shotId: number, curved = false): ExperimentalShot => {
      const points: number[] = [];
      for (let i = 0; i < count; i++) {
        const fraction = i / (count - 1);
        points.push(16 + 64 * fraction, 24 + (curved ? 20 * Math.sin(Math.PI * fraction) : 0));
      }
      return { points, shotId, angle: 0, power: 65 };
    };
    const informative = path(17, 0, true);
    let retained = [informative];
    for (let id = 1; id <= 30; id++) {
      const newest = path(id % 2 ? 17 : 1025, id);
      retained = retainRepresentativeShots([...retained, newest], 2);
      expect(retained).toEqual([informative, newest]);
      expect(retained[0].points).toBe(informative.points);
    }
    const straight = [path(17, 31), path(1025, 32), path(17, 33)];
    expect(retainRepresentativeShots(straight, 2)).toEqual(straight.slice(1));
    expect(retainRepresentativeShots([straight[1], straight[0], straight[2]], 2)).toEqual([straight[0], straight[2]]);
  });

  it('detects a bend between all 64 coarse vertices of a long trajectory', () => {
    const straight = (shotId: number): ExperimentalShot => ({
      points: Array.from({ length: 1025 }, (_, i) => [16 + 64 * i / 1024, 24]).flat(),
      shotId, angle: 0, power: 65,
    });
    const base = straight(0);
    const informative = { ...base, points: [...base.points] };
    for (let i = 504; i < 520; i++) informative.points[2 * i + 1] += 6 * Math.min(i - 503, 520 - i);
    const repeated = Array.from({ length: 20 }, (_, i) => straight(i + 1));
    for (let i = 0; i < 64; i++) {
      const point = Math.floor(i * 1024 / 63);
      expect(informative.points.slice(2 * point, 2 * point + 2)).toEqual(repeated[0].points.slice(2 * point, 2 * point + 2));
    }
    expect(retainRepresentativeShots([informative, ...repeated], 2)).toEqual([informative, repeated.at(-1)]);
    expect(informative.points).toHaveLength(2050);
  });

  it('preserves a lone informative short path through more than twelve repeated long paths', () => {
    const informative = trajectory(15, 0, 90);
    let retained: ExperimentalShot[] = [informative];
    for (let id = 1; id <= 30; id++) {
      const newest = trajectory(120, id, id % 2 ? 0.1 : -0.1);
      retained = retainRepresentativeShots([...retained, newest], 12);
      expect(retained).toContain(informative);
      expect(retained).toContain(newest);
      expect(retained.length).toBeLessThanOrEqual(12);
      expect(retained.at(-1)).toBe(newest);
    }
    expect(retained[0].points).toBe(informative.points);
    expect(retained[0].points).toHaveLength(30);
  });

  it('keeps unique recent spatial evidence and launch diversity instead of oldest-only eviction', () => {
    const repeated = Array.from({ length: 20 }, (_, i) => trajectory(100, i));
    const differentOrigin = trajectory(8, 20, 0, 0, 500);
    const differentAngle = trajectory(8, 21, 90);
    const differentPower = { ...trajectory(100, 22), power: 95 };
    const newest = trajectory(100, 23);
    const history = [...repeated, differentOrigin, differentAngle, differentPower, newest];
    const retained = retainRepresentativeShots(history, 4);
    expect(retained).toEqual([differentOrigin, differentAngle, differentPower, newest]);
    expect(retainRepresentativeShots(history, 4)).toEqual(retained);
    expect(retainRepresentativeShots(history, 1)).toEqual([newest]);
  });

  it('returns chronological original full paths without mutating input or exceeding limits', () => {
    const shots = [trajectory(7, 0), trajectory(20, 1, 90), trajectory(300, 2, 180)];
    const retained = retainRepresentativeShots(shots, 2.9);
    expect(retained).toHaveLength(2);
    expect(retained.at(-1)).toBe(shots[2]);
    for (const shot of retained) {
      expect(shots).toContain(shot);
      expect(shot.points).toBe(shots.find((entry) => entry.shotId === shot.shotId)!.points);
    }
    expect(shots).toHaveLength(3);
    expect(retainRepresentativeShots(shots, 10)).toEqual(shots);
    expect(retainRepresentativeShots(shots, Infinity)).toEqual(shots);
    expect(retainRepresentativeShots([], 12)).toEqual([]);
    for (const limit of [0, -1, NaN, -Infinity]) expect(retainRepresentativeShots(shots, limit)).toEqual([]);
  });
});
