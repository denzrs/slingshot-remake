import { PHYSICS, SUDDEN_DEATH } from './config';
import type { World } from './physics';

/** Where one ship drifts from and to during a pass of sudden death's collision course. */
export interface DriftMove {
  id: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}

const { COLLISION } = SUDDEN_DEATH;

/** How far along the way from `from` to `to` (0 → 1) a ship can go before it touches the circle at `c` with radius `r`. */
function reach(from: { x: number; y: number }, to: { x: number; y: number }, c: { x: number; y: number; r: number }): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const fx = from.x - c.x;
  const fy = from.y - c.y;
  const a = dx * dx + dy * dy;
  if (a === 0) return 1;
  const b = 2 * (fx * dx + fy * dy);
  const k = fx * fx + fy * fy - c.r * c.r;
  // Already touching it: it cannot go deeper, but nothing holds it back from leaving.
  if (k <= 0) return b < 0 ? 0 : 1;
  const disc = b * b - 4 * a * k;
  if (disc < 0) return 1;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : 1;
}

/**
 * Collision course, one pass: every ship in `ids` drifts toward the middle of the field, a share of the way that grows
 * with `step` (the pass of sudden death). A planet or a hole stops the ship short of its edge, and no two ships end
 * up closer than the minimum gap (pairs that were already closer just stop getting closer). Pure and deterministic.
 */
export function planCollision(world: World, ids: readonly number[], step: number): DriftMove[] {
  const cx = world.width / 2;
  const cy = world.height / 2;
  const share = Math.min(COLLISION.FRACTION_MAX, COLLISION.FRACTION + COLLISION.FRACTION_STEP * (step - 1));
  const margin = PHYSICS.SHIP_RADIUS + COLLISION.MARGIN;
  const obstacles = [...world.planets.map((p) => ({ x: p.x, y: p.y, r: p.radius + margin })), ...world.holes.map((h) => ({ x: h.x, y: h.y, r: h.radius + margin }))];
  const from = ids.map((id) => ({ id, x: world.ships[id].x, y: world.ships[id].y }));

  const land = (k: number): { x: number; y: number }[] =>
    from.map((s) => {
      const to = { x: s.x + (cx - s.x) * k, y: s.y + (cy - s.y) * k };
      const t = Math.min(1, ...obstacles.map((o) => reach(s, to, o)));
      return { x: s.x + (to.x - s.x) * t, y: s.y + (to.y - s.y) * t };
    });
  const apart = (to: { x: number; y: number }[]): boolean =>
    from.every((a, i) => to.every((b, j) => {
      if (j <= i) return true;
      const before = Math.hypot(a.x - from[j].x, a.y - from[j].y);
      return Math.hypot(b.x - to[i].x, b.y - to[i].y) >= Math.min(before, COLLISION.MIN_GAP) - 1e-6;
    }));

  let to = land(share);
  if (!apart(to)) {
    // The gaps close in proportion, so the largest share that keeps them is found by halving.
    let [low, high] = [0, share];
    for (let i = 0; i < 14; i++) {
      const mid = (low + high) / 2;
      if (apart(land(mid))) low = mid;
      else high = mid;
    }
    to = land(low);
  }
  return from.map((s, i) => ({ id: s.id, fromX: s.x, fromY: s.y, toX: to[i].x, toY: to[i].y }));
}
