/**
 * What happened during a round (or a whole match), kept just so the scorecard can hand out awards.
 * Pure data and pure functions — the matches feed it, the HUD and the final screen read it.
 */

export type AwardKind = 'longestShot' | 'fastestKill' | 'swingbys' | 'grazes' | 'bestHit' | 'kills';

/** A record and who set it. */
export interface Best {
  player: number;
  value: number;
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
}

export interface Award {
  kind: AwardKind;
  /** Everybody who shares the award (a tie for the most swing-bys, say); one player for records. */
  players: number[];
  value: number;
}

export const newStatBook = (): StatBook => ({ swingbys: [], grazes: [], kills: [], longestShot: null, fastestKill: null, bestHit: null });

/** Add one to a player's counter; the list grows as new players show up. */
export function bump(counts: number[], player: number): void {
  while (counts.length <= player) counts.push(0);
  counts[player]++;
}

/** Keep the better of the current record and a new value (`higher`: bigger is better). Earlier holders keep a tie. */
export function improve(best: Best | null, player: number, value: number, higher: boolean): Best {
  return !best || (higher ? value > best.value : value < best.value) ? { player, value } : best;
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
  const record = (kind: AwardKind, best: Best | null): Award | null => (best && best.value > 0 ? { kind, players: [best.player], value: best.value } : null);
  return [
    record('longestShot', book.longestShot),
    record('fastestKill', book.fastestKill),
    mostOf('swingbys', book.swingbys, 1),
    mostOf('grazes', book.grazes, 1),
    record('bestHit', book.bestHit),
    // One kill is just winning the round; the award is for racking up several.
    mostOf('kills', book.kills, 2),
  ].filter((a): a is Award => a !== null);
}
