/**
 * Frame times, sent to the dev server that served the page (`dev/perf-reports.ts` writes them to `perf-reports.jsonl`): from
 * `/dev/perf.html`, and from a game opened with `?perf`, which sends the seconds round every planet that breaks.
 */

/** One frame: when (ms from the break), since the frame before, the time it took to update and to draw. */
export type FrameTime = [at: number, gap: number, update: number, draw: number];

const round = (ms: number): number => Math.round(ms * 10) / 10;

/** Frames in the spans round a break, by when they start (ms from it): how many, and their gaps and work. */
export function summarize(frames: readonly FrameTime[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [from, to] of [[-1000, 0], [0, 250], [250, 1000], [1000, 2000], [2000, 4000]] as const) {
    const part = frames.filter(([at]) => at >= from && at < to);
    if (!part.length) continue;
    const of = (pick: (f: FrameTime) => number): string => {
      const sorted = part.map(pick).sort((a, b) => a - b);
      return `${round(sorted[sorted.length >> 1])}/${round(sorted[sorted.length - 1])}`;
    };
    out[`${from}..${to}`] = `n ${part.length} gap ${of((f) => f[1])} work ${of((f) => f[2] + f[3])}`;
  }
  return out;
}

export async function sendPerf(name: string, frames: readonly FrameTime[], extra: object = {}): Promise<boolean> {
  if (!import.meta.env.DEV) return false;
  const body = {
    name,
    summary: summarize(frames),
    agent: navigator.userAgent,
    screen: `${innerWidth}x${innerHeight}@${devicePixelRatio}`,
    cores: navigator.hardwareConcurrency,
    ...extra,
    frames: frames.map((f) => f.map(round)),
  };
  try {
    return (await fetch('/__perf', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).ok;
  } catch {
    return false;
  }
}

const BEFORE = 1000;
const AFTER = 4000;

/** The game's frames, kept for a moment: `broke` marks a planet that breaks, and the frames round it are sent once they are all there. */
export class PerfRecorder {
  private frames: FrameTime[] = [];
  private breaks: { at: number; what: string }[] = [];
  private last = 0;

  broke(what: string): void {
    this.breaks.push({ at: this.last, what });
  }

  frame(now: number, update: number, draw: number): void {
    if (this.last) this.frames.push([now, now - this.last, update, draw]);
    this.last = now;
    const due = this.breaks[0];
    if (due && now - due.at >= AFTER) {
      this.breaks.shift();
      const round = this.frames.filter(([at]) => at >= due.at - BEFORE && at < due.at + AFTER);
      void sendPerf(`game ${due.what}`, round.map(([at, ...rest]) => [at - due.at, ...rest]));
    }
    const keep = now - BEFORE - AFTER;
    let drop = 0;
    while (drop < this.frames.length && this.frames[drop][0] < keep) drop++;
    if (drop > 60) this.frames.splice(0, drop);
  }
}
