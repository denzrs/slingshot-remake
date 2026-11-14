import { planShot, type Aim, type PlanOptions } from '../src/sim/ai';
import type { World } from '../src/sim/physics';

/** Runs a planner to completion synchronously. */
export function planShotNow(world: World, shooter: number, opts: PlanOptions): Aim {
  const it = planShot(world, shooter, opts);
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
  }
}

/** The CPU's side of a match, for tests that set up what it holds: where it lays a placement, whether it can, and the rescue it tries when its plan came up blind. */
export function cpuSide(match: object): {
  cpuPlacementAim(p: unknown): Aim | null;
  cpuRescueIfBlind(p: unknown, job: unknown): boolean;
  placeForCpu(id: number): boolean;
} {
  const m = match as unknown as {
    cpu: { placementAim(p: unknown): Aim | null; rescueIfBlind(p: unknown, job: unknown): boolean };
    placeForCpu(id: number): boolean;
  };
  return {
    cpuPlacementAim: (p) => m.cpu.placementAim(p),
    cpuRescueIfBlind: (p, job) => m.cpu.rescueIfBlind(p, job),
    placeForCpu: (id) => m.placeForCpu(id),
  };
}
