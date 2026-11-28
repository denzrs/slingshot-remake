/**
 * How an escape pod flies (`Renderer.drawPods` draws it). It flies like a little craft, always the way its nose points:
 * flung nose first out of its ship's wreck, it coasts out, braking; then its engines steer it for a goal (the orbit
 * round the ship its player roots for, or a slow drift) by turning the nose at a limited rate and speeding up or
 * slowing down along it. So a change of mind is a curve, never a turn on the spot, and it slows into place instead
 * of jumping there. Only a picture: every screen flies its own pods.
 */

/** A shot-down player's escape pod: where it was ejected, the way it flies off, and when. */
export interface Pod {
  /** Where it is now. */
  x: number;
  y: number;
  /** The way it was flung out of its wreck. */
  dx: number;
  dy: number;
  /** The streak it leaves while it is flung. */
  path: { x: number; y: number; at: number; fade: number }[];
  /** How hard its engines push (0 → 1, eased) and which way (an angle on the field). */
  thrust: number;
  push: number;
  since: number;
  round: number;
  /** How fast it is going (field units a second) and the way its nose points: always the way it flies. */
  vx: number;
  vy: number;
  heading: number;
  /** The ship it last circled, and its place among that ship's fans. */
  host?: number;
  slot: number;
  /** When it blows up, that ship having gone down; and whether it has. */
  boomAt?: number;
  gone?: boolean;
  /** The fan's last call that was called out over it (kind, state and when), so it is called out once. */
  callSeen?: string;
  /** Its fan's cheers so far this round, and when the last one showed. */
  cheers: number;
  cheeredAt: number;
  /** Your own pod's (or UFO's) last ping, and the ship it circled then: it pings again when it flies to another. */
  pingAt?: number;
  pingHost?: number;
}

/** Where a pod wants to be (moving along at `vx`, `vy`), or only how fast it wants to go; `null` while it coasts. */
export type PodGoal = { x?: number; y?: number; vx: number; vy: number };

/**
 * A pod's flight (field units and seconds). Flung out of its wreck at `LAUNCH_SPEED` and braked by `LAUNCH_DRAG` for
 * `LAUNCH_SECONDS`; then it steers: its top speed, how hard its engines speed it up or slow it down (`MAX_ACCEL`), how
 * fast its nose turns (`TURN`), how hard it closes in on its goal (`ARRIVE`) and how quickly it takes on the speed it
 * wants (`RESPONSE`); how slowly it drifts and how far off the field's edge it keeps (pushed back by `EDGE_PUSH` a
 * unit closer), and how its flames ease. The orbit round a backed ship and its speed; the stands' UFOs' outer ring
 * round it (the inner ring's radius and speed, how many it holds, how many more each ring further out holds and
 * how far out that is, how soon after each other they blow up); how often your own pod pings so you keep it in sight, and how big that ping is against a ship's; a cheer's length
 * and a fan's own hop, how big a pod is drawn, how long after its ship a pod blows up (each fan a little after the last), its
 * streak, and the step it is moved in.
 */
export const POD = {
  LAUNCH_SPEED: 230, LAUNCH_DRAG: 3.2, LAUNCH_SECONDS: 0.9,
  MAX_SPEED: 220, MAX_ACCEL: 340, TURN: 4, ARRIVE: 2.5, RESPONSE: 4.5, DRIFT: 6, EDGE: 110, EDGE_PUSH: 0.25, THRUST_EASE: 8, MARGIN: 24,
  ORBIT: 34, ORBIT_SPEED: 0.6, CHEER_SECONDS: 1.2, OWN_CHEER_SECONDS: 0.7, OWN_HOP: 7, SCALE: 1.5,
  STANDS_ORBIT: 56, STANDS_ORBIT_SPEED: 0.4, STANDS_FIRST: 8, STANDS_MORE: 4, STANDS_RING_GAP: 18, STANDS_STAGGER: 0.06, OWN_PING_EVERY: 10, OWN_PING_SCALE: 0.3,
  BOOM_DELAY: 0.25, BOOM_STAGGER: 0.14, STREAK_SECONDS: 0.3, STREAK_SPEED: 60, CALLOUT_RISE: 50, STEP: 1 / 60,
} as const;

/**
 * Where the `i`-th of a ship's UFOs from the stands flies: on which ring round it (0 the inner), in which place on it,
 * and how many share that ring. The inner ring holds `STANDS_FIRST`, each further out `STANDS_MORE` more, so however
 * many come, every one is shown.
 */
export function standsSlot(i: number, n: number): { ring: number; slot: number; of: number } {
  let start = 0;
  for (let ring = 0; ; ring++) {
    const room = POD.STANDS_FIRST + ring * POD.STANDS_MORE;
    if (i < start + room) return { ring, slot: i - start, of: Math.min(room, n - start) };
    start += room;
  }
}

/** A new pod, flung nose first out of a wreck at (x, y) along `away`. */
export function launchPod(x: number, y: number, away: number, since: number, round: number): Pod {
  return {
    x, y, dx: Math.cos(away), dy: Math.sin(away), since, round,
    vx: Math.cos(away) * POD.LAUNCH_SPEED, vy: Math.sin(away) * POD.LAUNCH_SPEED, heading: away,
    thrust: 0, push: away, path: [], slot: 0, cheers: 0, cheeredAt: -99,
  };
}

/**
 * One step of a pod's flight. With a goal it works out the velocity it wants (the goal's own, plus closing in on the
 * goal's place the further off it is), turns its nose towards it at no more than `TURN`, and speeds up or slows down
 * to the part of that speed its nose points along: wanting to go the other way, it slows while it comes round.
 * Without a goal it coasts nose first, braked. The field's edge stops it. Returns how its velocity changed (field
 * units a second, per second): what its engines did.
 */
function flyPod(pod: Pod, dt: number, goal: PodGoal | null, width: number, height: number): [number, number] {
  const vx = pod.vx;
  const vy = pod.vy;
  let speed = Math.hypot(vx, vy);
  if (goal) {
    const wx = goal.vx + (goal.x === undefined ? 0 : (goal.x - pod.x) * POD.ARRIVE);
    const wy = goal.vy + (goal.y === undefined ? 0 : (goal.y - pod.y) * POD.ARRIVE);
    const want = Math.min(POD.MAX_SPEED, Math.hypot(wx, wy));
    let along = 0;
    if (want > 0.5) {
      const off = Math.atan2(Math.sin(Math.atan2(wy, wx) - pod.heading), Math.cos(Math.atan2(wy, wx) - pod.heading));
      pod.heading += Math.max(-POD.TURN * dt, Math.min(POD.TURN * dt, off));
      along = want * Math.max(0, Math.cos(off));
    }
    const change = (along - speed) * POD.RESPONSE;
    speed += Math.max(-POD.MAX_ACCEL, Math.min(POD.MAX_ACCEL, change)) * dt;
  } else {
    speed *= Math.exp(-POD.LAUNCH_DRAG * dt);
  }
  speed = Math.max(0, speed);
  pod.vx = Math.cos(pod.heading) * speed;
  pod.vy = Math.sin(pod.heading) * speed;
  pod.x += pod.vx * dt;
  pod.y += pod.vy * dt;
  const x = Math.min(width - POD.MARGIN, Math.max(POD.MARGIN, pod.x));
  const y = Math.min(height - POD.MARGIN, Math.max(POD.MARGIN, pod.y));
  if (x !== pod.x || y !== pod.y) {
    pod.x = x;
    pod.y = y;
    pod.vx *= 0.5;
    pod.vy *= 0.5;
  }
  return goal && dt > 0 ? [(pod.vx - vx) / dt, (pod.vy - vy) / dt] : [0, 0];
}

/**
 * A frame of a pod's flight, `dt` seconds, moved in small steps (a slow frame flies the same path); its engines' push
 * eased so the flames do not flicker, and off while it is `launching`. Returns its speed.
 */
export function flyPodFrame(pod: Pod, dt: number, goal: PodGoal | null, launching: boolean, width: number, height: number): number {
  const steps = Math.max(1, Math.ceil(dt / POD.STEP));
  let ax = 0;
  let ay = 0;
  for (let i = 0; i < steps; i++) [ax, ay] = flyPod(pod, dt / steps, launching ? null : goal, width, height);
  const push = launching ? 0 : Math.min(1, Math.hypot(ax, ay) / POD.MAX_ACCEL);
  pod.thrust += (push - pod.thrust) * (1 - Math.exp(-POD.THRUST_EASE * dt));
  if (push > 0.02) pod.push = Math.atan2(ay, ax);
  return Math.hypot(pod.vx, pod.vy);
}
