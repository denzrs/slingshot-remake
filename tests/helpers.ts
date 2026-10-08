import { planShot, type Aim, type PlanOptions } from '../src/ai';
import type { World } from '../src/physics';

/** Runs a planner to completion synchronously. */
export function planShotNow(world: World, shooter: number, opts: PlanOptions): Aim {
  const it = planShot(world, shooter, opts);
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
  }
}
