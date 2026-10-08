import type { ExperimentalShot, PlanetEstimate } from './experimental-ai';

export type TrajectoryObservation = { shot: number; point: number };

/** Budget trajectories first, then spread each quota over its collision-free samples. */
export function balancedObservations(shots: readonly ExperimentalShot[], sampleCap: number): TrajectoryObservation[] {
  const cap = Number.isFinite(sampleCap) ? Math.max(0, Math.floor(sampleCap)) : sampleCap === Infinity ? Number.MAX_SAFE_INTEGER : 0;
  if (!cap) return [];
  const usable: { shot: number; count: number; quota: number }[] = [];
  let total = 0;
  for (let shot = 0; shot < shots.length; shot++) {
    const count = Math.max(0, Math.floor(shots[shot].points.length / 2) - 3);
    if (count) {
      usable.push({ shot, count, quota: 0 });
      total += count;
    }
  }
  let remaining = Math.min(cap, total);
  if (remaining < usable.length) {
    // A small budget covers the history evenly instead of always favoring its head.
    for (let i = 0; i < remaining; i++) usable[Math.floor((i + 0.5) * usable.length / remaining)].quota = 1;
  } else {
    let active = usable.length;
    while (remaining && active) {
      const increment = Math.max(1, Math.floor(remaining / active));
      active = 0;
      for (const entry of usable) {
        const added = Math.min(entry.count - entry.quota, increment, remaining);
        entry.quota += added;
        remaining -= added;
        if (entry.quota < entry.count) active++;
      }
    }
  }
  const observations: TrajectoryObservation[] = [];
  for (const { shot, count, quota } of usable) {
    for (let i = 0; i < quota; i++) {
      observations.push({ shot, point: 1 + Math.floor((i + 0.5) * count / quota) });
    }
  }
  return observations;
}

/** Align inferred fields without consulting truth or treating hidden labels as geometry. */
export function matchEstimatedSources(previous: readonly PlanetEstimate[], candidate: readonly PlanetEstimate[], width: number, height: number): PlanetEstimate[] {
  const matched = new Map<number, number>();
  const used = new Set<number>();
  // A known ID is authoritative, even after a source moves farther than its neighbor.
  for (let p = 0; p < previous.length; p++) {
    if (previous[p].id === undefined) continue;
    const c = candidate.findIndex((source, index) => !used.has(index) && source.id === previous[p].id);
    if (c >= 0) {
      matched.set(p, c);
      used.add(c);
    }
  }
  const rows = previous.map((_, i) => i).filter((i) => !matched.has(i)).sort((a, b) => {
    const left = previous[a];
    const right = previous[b];
    return left.x - right.x || left.y - right.y || left.mass - right.mass || (left.id ?? -1) - (right.id ?? -1)
      || (left.radius ?? -1) - (right.radius ?? -1)
      || (left.massUncertainty ?? -1) - (right.massUncertainty ?? -1)
      || (left.massStandardDeviation ?? -1) - (right.massStandardDeviation ?? -1);
  });
  const columns = candidate.map((_, i) => i).filter((i) => !used.has(i)).sort((a, b) => {
    const left = candidate[a];
    const right = candidate[b];
    return left.x - right.x || left.y - right.y || left.mass - right.mass || (left.id ?? -1) - (right.id ?? -1)
      || (left.radius ?? -1) - (right.radius ?? -1)
      || (left.massUncertainty ?? -1) - (right.massUncertainty ?? -1)
      || (left.massStandardDeviation ?? -1) - (right.massStandardDeviation ?? -1);
  });
  const size = 2 ** columns.length;
  let costs = new Float64Array(size).fill(Infinity);
  costs[0] = 0;
  const parents: Int32Array[] = [];
  const choices: Int32Array[] = [];
  const scaleX = Math.max(1, Math.abs(width));
  const scaleY = Math.max(1, Math.abs(height));
  for (const p of rows) {
    const next = new Float64Array(size).fill(Infinity);
    const parent = new Int32Array(size).fill(-1);
    const choice = new Int32Array(size).fill(-1);
    for (let mask = 0; mask < size; mask++) {
      if (!Number.isFinite(costs[mask])) continue;
      if (costs[mask] < next[mask]) {
        next[mask] = costs[mask];
        parent[mask] = mask;
        choice[mask] = -1;
      }
      for (let column = 0; column < columns.length; column++) {
        if (mask & (1 << column)) continue;
        const before = previous[p];
        const after = candidate[columns[column]];
        if (before.id !== undefined && after.id !== undefined && before.id !== after.id) continue;
        const dx = (before.x - after.x) / scaleX;
        const dy = (before.y - after.y) / scaleY;
        const logMass = Math.min(4, Math.abs(Math.log(Math.max(1e-12, before.mass)) - Math.log(Math.max(1e-12, after.mass))));
        const cost = costs[mask] + dx * dx + dy * dy + 0.01 * logMass * logMass;
        const target = mask | (1 << column);
        if (cost < next[target]) {
          next[target] = cost;
          parent[target] = mask;
          choice[target] = column;
        }
      }
    }
    costs = next;
    parents.push(parent);
    choices.push(choice);
  }
  let bestMask = 0;
  let bestCount = 0;
  for (let mask = 0; mask < size; mask++) {
    if (!Number.isFinite(costs[mask])) continue;
    let count = 0;
    for (let bits = mask; bits; bits &= bits - 1) count++;
    if (count > bestCount || (count === bestCount && costs[mask] < costs[bestMask])) {
      bestMask = mask;
      bestCount = count;
    }
  }
  for (let row = rows.length - 1; row >= 0; row--) {
    const column = choices[row][bestMask];
    if (column >= 0) {
      const c = columns[column];
      matched.set(rows[row], c);
      used.add(c);
    }
    bestMask = parents[row][bestMask];
  }
  const result: PlanetEstimate[] = [];
  for (let p = 0; p < previous.length; p++) {
    const c = matched.get(p);
    if (c === undefined) continue; // Removed sources do not become phantom duplicates.
    const source = candidate[c];
    result.push(previous[p].id !== undefined && source.id === undefined ? { ...source, id: previous[p].id } : source);
  }
  // New sources have no prior slot. Append in geometry order, independent of input labels.
  for (const c of columns) if (!used.has(c)) result.push(candidate[c]);
  return result;
}

type ShotCoverage = { cells: Set<string>; angle: number; power: number; origin: string; shape: Float64Array };

/** Fixed-size arc-length resampling compares bends, not vertex count or flight duration. */
function trajectoryShape(points: readonly number[]): Float64Array {
  const count = Math.floor(points.length / 2);
  const samples = Math.min(257, count);
  const polyline = new Float64Array(samples * 3);
  const shape = new Float64Array(32);
  for (let i = 0; i < samples; i++) {
    const point = samples === 1 ? 0 : Math.floor(i * (count - 1) / (samples - 1));
    polyline[3 * i] = points[2 * point];
    polyline[3 * i + 1] = points[2 * point + 1];
    if (i) polyline[3 * i + 2] = polyline[3 * (i - 1) + 2]
      + Math.hypot(polyline[3 * i] - polyline[3 * (i - 1)], polyline[3 * i + 1] - polyline[3 * (i - 1) + 1]);
  }
  const length = samples ? polyline[3 * (samples - 1) + 2] : 0;
  if (!length) return shape;
  let segment = 1;
  let previousX = polyline[0];
  let previousY = polyline[1];
  for (let i = 1; i <= 16; i++) {
    const distance = length * i / 16;
    while (segment < samples - 1 && polyline[3 * segment + 2] < distance) segment++;
    const start = 3 * (segment - 1);
    const end = 3 * segment;
    const span = polyline[end + 2] - polyline[start + 2];
    const fraction = span ? (distance - polyline[start + 2]) / span : 0;
    const x = polyline[start] + fraction * (polyline[end] - polyline[start]);
    const y = polyline[start + 1] + fraction * (polyline[end + 1] - polyline[start + 1]);
    const dx = x - previousX;
    const dy = y - previousY;
    const norm = Math.hypot(dx, dy);
    if (norm) {
      shape[2 * (i - 1)] = dx / norm;
      shape[2 * (i - 1) + 1] = dy / norm;
    }
    previousX = x;
    previousY = y;
  }
  return shape;
}

function shapeDistance(a: Float64Array, b: Float64Array): number {
  let squared = 0;
  for (let i = 0; i < a.length; i++) squared += (a[i] - b[i]) ** 2;
  // Ignore tiny direction noise; cap the contribution so launch/spatial novelty still matters.
  return Math.min(1, Math.max(0, Math.sqrt(squared / 16) - 0.05));
}

function coverageOf(shot: ExperimentalShot): ShotCoverage {
  const cells = new Set<string>();
  const count = Math.floor(shot.points.length / 2);
  const samples = Math.min(64, count);
  for (let i = 0; i < samples; i++) {
    const point = samples === 1 ? 0 : Math.floor(i * (count - 1) / (samples - 1));
    cells.add(`${Math.floor(shot.points[2 * point] / 96)}:${Math.floor(shot.points[2 * point + 1] / 96)}`);
  }
  const angle = ((shot.angle % 360) + 360) % 360;
  return {
    cells,
    angle: Math.round(angle / 15) % 24,
    power: Math.round(shot.power / 10),
    origin: count ? `${Math.round(shot.points[0] / 64)}:${Math.round(shot.points[1] / 64)}` : 'empty',
    shape: trajectoryShape(shot.points),
  };
}

/** Greedy coverage keeps novel evidence, not simply long or old trajectories. */
export function retainRepresentativeShots(shots: readonly ExperimentalShot[], limit: number): ExperimentalShot[] {
  const cap = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : limit === Infinity ? shots.length : 0;
  if (!cap || !shots.length) return [];
  if (shots.length <= cap) return shots.slice();
  const signatures = shots.map(coverageOf);
  const selected = new Set<number>();
  const cells = new Set<string>();
  const angles = new Set<number>();
  const powers = new Set<number>();
  const origins = new Set<string>();
  const add = (index: number) => {
    selected.add(index);
    const signature = signatures[index];
    for (const cell of signature.cells) cells.add(cell);
    angles.add(signature.angle);
    powers.add(signature.power);
    origins.add(signature.origin);
  };
  add(shots.length - 1);
  while (selected.size < cap) {
    let best = -1;
    let bestScore = -1;
    // Recency breaks ties only after novelty, protecting recent evidence from duplicates.
    for (let i = shots.length - 1; i >= 0; i--) {
      if (selected.has(i)) continue;
      const signature = signatures[i];
      let novel = 0;
      for (const cell of signature.cells) if (!cells.has(cell)) novel++;
      let shapeNovelty = 1;
      for (const index of selected) shapeNovelty = Math.min(shapeNovelty, shapeDistance(signature.shape, signatures[index].shape));
      const score = 4 * novel / Math.max(1, signature.cells.size)
        + (angles.has(signature.angle) ? 0 : 1)
        + (powers.has(signature.power) ? 0 : 0.5)
        + (origins.has(signature.origin) ? 0 : 1)
        + 0.5 * shapeNovelty;
      if (score > bestScore) {
        best = i;
        bestScore = score;
      }
    }
    add(best);
  }
  return shots.filter((_, index) => selected.has(index));
}
