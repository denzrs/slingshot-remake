/**
 * What happened during a round (or a whole match), kept just so the scorecard can hand out awards.
 * Pure data and pure functions — the matches feed it, the HUD and the final screen read it.
 */

export type AwardKind = 'longestShot' | 'fastestKill' | 'swingbys' | 'grazes' | 'bestHit' | 'kills' | 'closeCall' | 'sniper' | 'ownGoals';

export interface Point {
  x: number;
  y: number;
}

/** A record and who set it — with the shot behind it, so the scorecard can replay it on the field. */
export interface Best {
  player: number;
  value: number;
  /** The shot's path, thinned: flat [x0, y0, x1, y1, …] in field units. */
  trail?: number[];
  /** The moment that earned the record: where it ended, where it came closest, … */
  at?: Point;
}

export interface StatBook {
  /** Per player index. */
  swingbys: number[];
  grazes: number[];
  kills: number[];
  /** Longest flight of any shot, hit or miss, in field units. */
  longestShot: Best | null;
  /** Quickest kill, in seconds since its round began. */
  fastestKill: Best | null;
  /** Most points for a single hit. */
  bestHit: Best | null;
  /** Own goals per player. */
  ownGoals: number[];
  /** The narrowest miss: the smallest gap between a shot and an enemy ship it did not hit, in field units. */
  closeCall: Best | null;
  /** The hit from the greatest distance, in field units. */
  sniper: Best | null;
}

export interface Award {
  kind: AwardKind;
  /** The shot behind a record, if there is one to show. */
  trail?: number[];
  at?: Point;
  /** Everybody who shares the award (a tie for the most swing-bys, say); one player for records. */
  players: number[];
  value: number;
}

/** A miss counts as a close call within this gap (field units), a hit as a sniper shot from this distance. */
export const CLOSE_CALL = 40;
export const SNIPER = 500;

export const newStatBook = (): StatBook => ({
  swingbys: [],
  grazes: [],
  kills: [],
  longestShot: null,
  fastestKill: null,
  bestHit: null,
  ownGoals: [],
  closeCall: null,
  sniper: null,
});

/** Add one to a player's counter; the list grows as new players show up. */
export function bump(counts: number[], player: number): void {
  while (counts.length <= player) counts.push(0);
  counts[player]++;
}

/** Keep the better of the current record and a new value (`higher`: bigger is better). Earlier holders keep a tie. */
export function improve(best: Best | null, player: number, value: number, higher: boolean, shot?: { trail: number[]; at: Point }): Best {
  if (best && !(higher ? value > best.value : value < best.value)) return best;
  return shot ? { player, value, trail: thinTrail(shot.trail), at: shot.at } : { player, value };
}

/** A path light enough to travel in a snapshot: every few points, to a tenth of a unit. */
export function thinTrail(points: number[], every = 3): number[] {
  const q = (n: number) => Math.round(n * 10) / 10;
  const out: number[] = [];
  const count = points.length / 2;
  for (let i = 0; i < count; i += every) out.push(q(points[2 * i]), q(points[2 * i + 1]));
  // Always end exactly where the shot ended.
  if ((count - 1) % every !== 0) out.push(q(points[2 * count - 2]), q(points[2 * count - 1]));
  return out;
}

/** Where a polyline comes closest to a point, and how close. */
export function closestApproach(points: number[], target: Point): { distance: number; at: Point } {
  let best = { distance: Infinity, at: { x: points[0], y: points[1] } };
  for (let i = 2; i < points.length; i += 2) {
    const ax = points[i - 2];
    const ay = points[i - 1];
    const dx = points[i] - ax;
    const dy = points[i + 1] - ay;
    const len2 = dx * dx + dy * dy;
    const k = len2 ? Math.min(1, Math.max(0, ((target.x - ax) * dx + (target.y - ay) * dy) / len2)) : 0;
    const x = ax + k * dx;
    const y = ay + k * dy;
    const distance = Math.hypot(target.x - x, target.y - y);
    if (distance < best.distance) best = { distance, at: { x, y } };
  }
  return best;
}

/** Length of a flat [x0, y0, x1, y1, …] polyline. */
export function pathLength(points: number[]): number {
  let length = 0;
  for (let i = 2; i < points.length; i += 2) length += Math.hypot(points[i] - points[i - 2], points[i + 1] - points[i - 1]);
  return length;
}

function mostOf(kind: AwardKind, counts: number[], atLeast: number): Award | null {
  const top = Math.max(0, ...counts);
  if (top < atLeast) return null;
  return { kind, players: counts.flatMap((n, player) => (n === top ? [player] : [])), value: top };
}

/** The awards earned so far, in the order the scorecard shows them. Nothing is handed out for nothing. */
export function awards(book: StatBook): Award[] {
  const record = (kind: AwardKind, best: Best | null, show = true): Award | null =>
    best && best.value > 0 && show ? { kind, players: [best.player], value: best.value, trail: best.trail, at: best.at } : null;
  return [
    record('longestShot', book.longestShot),
    record('fastestKill', book.fastestKill),
    mostOf('swingbys', book.swingbys, 1),
    mostOf('grazes', book.grazes, 1),
    record('bestHit', book.bestHit),
    // One kill is just winning the round; the award is for racking up several.
    mostOf('kills', book.kills, 2),
    // A miss only deserves a card when it was a real nail-biter, a hit only when it came from far away.
    record('closeCall', book.closeCall, (book.closeCall?.value ?? Infinity) <= CLOSE_CALL),
    record('sniper', book.sniper, (book.sniper?.value ?? 0) >= SNIPER),
    mostOf('ownGoals', book.ownGoals, 1),
  ].filter((a): a is Award => a !== null);
}
