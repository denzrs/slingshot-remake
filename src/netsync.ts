/**
 * Keeps the guests' copy of the match in sync with the host without resending the world.
 *
 * A full snapshot is 40–150 KB (planets, every trail, the killcam clip …) — far too much to send
 * 20 times a second. The host therefore sends *patches*: only the top-level fields that changed
 * since the last send, and for flights only the trail points added since then. The guest merges
 * patches back into a complete snapshot. The first patch is naturally the full snapshot.
 */
import type { VolleySnapshot } from './volley';

export type StatePatch = Record<string, unknown>;

/** A trail on the wire: the points from index `from` on (`from: 0` = the whole trail). */
interface TrailTail {
  from: number;
  points: number[];
}

type WireShot = Omit<VolleySnapshot['shots'][number], 'trail'> & { trail: TrailTail };
type WireVolley = Omit<VolleySnapshot, 'shots'> & { shots: WireShot[] };

/** Trail points are drawn, not computed with: a tenth of a field unit is invisible and ~3× cheaper to send. */
const q = (n: number): number => Math.round(n * 10) / 10;

interface Trail {
  owner: number;
  points: number[];
  volley: number;
}

/** The round's finished trails as an append-only list on the wire: entries from index `from` on. */
interface TrailsTail {
  from: number;
  items: Trail[];
}

/** Fields that are replaced, never mutated in place — a reference check is enough to see a change. */
const IMMUTABLE = new Set(['killcamClip', 'lastClip', 'snapshot']);

interface TrailCursor {
  volleyId: number;
  lengths: number[];
}

export class SnapshotEncoder {
  private readonly sentJson = new Map<string, string>();
  private readonly sentRef = new Map<string, unknown>();
  private readonly cursors = new Map<string, TrailCursor>();
  private trailsSent: { first: Trail | undefined; length: number } = { first: undefined, length: 0 };

  /** The fields of `snapshot` that differ from what was last encoded. */
  encode(snapshot: object): StatePatch {
    const fields: Record<string, unknown> = { ...snapshot };
    fields.volley = this.trimVolley('volley', fields.volley as VolleySnapshot | null);
    fields.trails = this.trimTrails(fields.trails as Trail[]);
    const killcam = fields.killcam as { replay: VolleySnapshot } | null;
    if (killcam) fields.killcam = { ...killcam, replay: this.trimVolley('replay', killcam.replay) };
    else this.cursors.delete('replay');

    const patch: StatePatch = {};
    for (const [key, value] of Object.entries(fields)) {
      if (IMMUTABLE.has(key)) {
        if (this.sentRef.get(key) === value && this.sentRef.has(key)) continue;
        this.sentRef.set(key, value);
      } else {
        const json = JSON.stringify(value) ?? 'null';
        if (this.sentJson.get(key) === json) continue;
        this.sentJson.set(key, json);
      }
      patch[key] = value;
    }
    return patch;
  }

  private trimTrails(trails: Trail[]): TrailsTail {
    const sent = this.trailsSent;
    // Same round (same first entry) and only appended to: send just the news.
    const appended = sent.length > 0 && trails.length >= sent.length && trails[0] === sent.first;
    const from = appended ? sent.length : 0;
    this.trailsSent = { first: trails[0], length: trails.length };
    return { from, items: trails.slice(from).map((trail) => ({ ...trail, points: trail.points.map(q) })) };
  }

  private trimVolley(key: string, volley: VolleySnapshot | null): WireVolley | null {
    if (!volley) {
      this.cursors.delete(key);
      return null;
    }
    const cursor = this.cursors.get(key);
    const same = cursor?.volleyId === volley.id;
    const lengths = volley.shots.map((shot) => shot.trail.length);
    this.cursors.set(key, { volleyId: volley.id, lengths });
    return {
      ...volley,
      shots: volley.shots.map((shot, i) => {
        const from = same ? Math.min(cursor!.lengths[i] ?? 0, shot.trail.length) : 0;
        return { ...shot, trail: { from, points: shot.trail.slice(from).map(q) } };
      }),
    };
  }
}

export class SnapshotDecoder {
  private readonly fields: Record<string, unknown> = {};
  private readonly trails = new Map<string, { volleyId: number; shots: number[][] }>();
  private finishedTrails: Trail[] = [];

  /** Merges a patch; returns the complete snapshot, or null while the first (full) patch is missing. */
  apply(patch: StatePatch): Record<string, unknown> | null {
    for (const [key, value] of Object.entries(patch)) {
      if (key === 'trails') {
        const { from, items } = value as TrailsTail;
        this.finishedTrails = [...this.finishedTrails.slice(0, from), ...items];
        this.fields.trails = this.finishedTrails;
      } else if (key === 'volley') this.fields.volley = this.rebuildVolley('volley', value as WireVolley | null);
      else if (key === 'killcam' && value) {
        const killcam = value as { replay: WireVolley };
        this.fields.killcam = { ...killcam, replay: this.rebuildVolley('replay', killcam.replay) };
      } else {
        if (key === 'killcam') this.trails.delete('replay');
        this.fields[key] = value;
      }
    }
    return 'volley' in this.fields && 'phase' in this.fields ? { ...this.fields } : null;
  }

  private rebuildVolley(key: string, wire: WireVolley | null): VolleySnapshot | null {
    if (!wire) {
      this.trails.delete(key);
      return null;
    }
    const known = this.trails.get(key);
    const previous = known?.volleyId === wire.id ? known.shots : [];
    const shots = wire.shots.map((shot, i) => {
      const { from, points } = shot.trail;
      const trail = from === 0 ? [...points] : [...(previous[i] ?? []).slice(0, from), ...points];
      return { ...shot, trail };
    });
    this.trails.set(key, { volleyId: wire.id, shots: shots.map((shot) => shot.trail) });
    return { ...wire, shots };
  }
}
