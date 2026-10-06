import { PHYSICS } from './config';
import { Shot, type ShotEnd, type ShotRules, type StyleEvent, type World } from './physics';

export interface VolleyAim {
  player: number;
  angle: number;
  power: number;
  /** Ships this shot passes through unharmed. */
  spare?: number[];
}

export interface VolleyShot {
  shot: Shot;
  owner: number;
  /** Flat [x0, y0, x1, y1, …] polyline in field units. */
  trail: number[];
}

export interface VolleySnapshot {
  /** Identifies the Volley instance, so a receiver can tell "same flight, more trail" from "a new flight". */
  id: number;
  aims: VolleyAim[];
  steps: number;
  shots: { owner: number; trail: number[]; x: number; y: number; vx: number; vy: number; time: number; end: ShotEnd | null; style: StyleEvent[] | null }[];
}

export type VolleyEvent =
  | { type: 'end'; index: number; end: ShotEnd; x: number; y: number; vx: number; vy: number }
  | { type: 'style'; index: number; event: StyleEvent };

const TRAIL_EVERY = 2;
let nextVolleyId = 1;

/**
 * Any number of shots in flight at once, advanced in lockstep. A ship that's hit drops out
 * immediately; projectiles that meet annihilate. Fully deterministic for the same world and
 * aims — which is what makes killcam replays exact. Mutates `world.ships[].alive`.
 */
export class Volley {
  readonly shots: VolleyShot[];
  private readonly aims: VolleyAim[];
  id = nextVolleyId++;
  steps = 0;

  constructor(
    readonly world: World,
    aims: VolleyAim[],
    rules: ShotRules,
    trackStyle: boolean,
  ) {
    this.aims = aims.map((aim) => ({ ...aim }));
    this.shots = aims.map((a) => {
      const shot = new Shot(world, a.player, a.angle, a.power, rules, trackStyle, a.spare);
      return { shot, owner: a.player, trail: [shot.x, shot.y] };
    });
  }

  get done(): boolean {
    return this.shots.every((s) => s.shot.end);
  }

  snapshot(): VolleySnapshot {
    return {
      id: this.id,
      aims: this.aims.map((aim) => ({ ...aim })),
      steps: this.steps,
      shots: this.shots.map(({ owner, trail, shot }) => ({
        owner, trail, x: shot.x, y: shot.y, vx: shot.vx, vy: shot.vy, time: shot.time, end: shot.end,
        style: shot.style ? [...shot.style] : null,
      })),
    };
  }

  restore(snapshot: VolleySnapshot): void {
    this.id = snapshot.id;
    this.steps = snapshot.steps;
    snapshot.shots.forEach((saved, i) => {
      const current = this.shots[i];
      if (!current) return;
      Object.assign(current.shot, { x: saved.x, y: saved.y, vx: saved.vx, vy: saved.vy, time: saved.time, end: saved.end });
      current.trail = saved.trail;
      if (current.shot.style && saved.style) current.shot.style.splice(0, Infinity, ...saved.style);
    });
  }

  step(): VolleyEvent[] {
    const events: VolleyEvent[] = [];
    this.steps++;
    for (let i = 0; i < this.shots.length; i++) {
      const vs = this.shots[i];
      const shot = vs.shot;
      if (shot.end) continue;
      const styleBefore = shot.style?.length ?? 0;
      const end = shot.step();
      if (shot.style) {
        for (let k = styleBefore; k < shot.style.length; k++) events.push({ type: 'style', index: i, event: shot.style[k] });
      }
      if (end || this.steps % TRAIL_EVERY === 0) vs.trail.push(shot.x, shot.y);
      if (end) {
        if (end.kind === 'ship') this.world.ships[end.ship].alive = false;
        events.push({ type: 'end', index: i, end, x: shot.x, y: shot.y, vx: shot.vx, vy: shot.vy });
      }
    }

    // Projectiles that meet head-on cancel each other out.
    const r2 = PHYSICS.CLASH_RADIUS * PHYSICS.CLASH_RADIUS;
    for (let i = 0; i < this.shots.length; i++) {
      const a = this.shots[i].shot;
      if (a.end) continue;
      for (let j = i + 1; j < this.shots.length; j++) {
        const b = this.shots[j].shot;
        if (b.end) continue;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        if (dx * dx + dy * dy >= r2) continue;
        const endA: ShotEnd = { kind: 'clash', other: j };
        const endB: ShotEnd = { kind: 'clash', other: i };
        a.terminate(endA);
        b.terminate(endB);
        events.push(
          { type: 'end', index: i, end: endA, x: a.x, y: a.y, vx: a.vx, vy: a.vy },
          { type: 'end', index: j, end: endB, x: b.x, y: b.y, vx: b.vx, vy: b.vy },
        );
        break;
      }
    }
    return events;
  }
}
