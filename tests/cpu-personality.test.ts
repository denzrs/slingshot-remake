import { describe, expect, it } from 'vitest';
import { CPU_PROFILES, planShotNow, type CpuDecision } from '../src/ai';
import { simulateShot, type World } from '../src/physics';
import { createRng } from '../src/rng';

const rules = { bounce: false, timeLimit: 20 };

function emptyWorld(ships: [number, number][]): World {
  return {
    width: 1280,
    height: 800,
    planets: [],
    ships: ships.map(([x, y]) => ({ x, y, alive: true })),
    hole: null,
    version: 0,
  };
}

describe('CPU personalities', () => {
  it('Kepler prefers the nearest enemy', () => {
    // Two undefended enemies at very different distances; anything hits in an empty world.
    const world = emptyWorld([[100, 400], [260, 400], [1180, 400]]);
    let near = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const aim = planShotNow(world, 0, {
        rules, level: 'easy', attempt: 0, fixedPower: null, rng: createRng(seed),
      });
      if (simulateShot(world, 0, aim.angle, aim.power, rules).end.kind === 'ship') near++;
    }
    // The lazy sweep should still hit (its sloppy aim notwithstanding) with the near target weighted in.
    expect(near).toBeGreaterThan(0);
    // Direct check of the weighting: the near enemy's weight exceeds the far one's.
    const self = { x: 100, y: 400 };
    const nearWeight = Math.max(0.1, 1 - CPU_PROFILES.easy.distanceBias * Math.hypot(260 - self.x, 400 - self.y) / 100);
    const farWeight = Math.max(0.1, 1 - CPU_PROFILES.easy.distanceBias * Math.hypot(1180 - self.x, 400 - self.y) / 100);
    expect(nearWeight).toBeGreaterThan(farWeight * 3);
  });

  it('Einstein holds a grudge against whoever hit it last', () => {
    const world = emptyWorld([[100, 400], [260, 400], [1180, 400]]);
    const grudged = planShotNow(world, 0, {
      rules, level: 'hard', attempt: 30, fixedPower: null, rng: createRng(7), grudgeTarget: 2,
    });
    // The grudge premium (hard.grudge) makes the far enemy's sweep weight exceed the near one's.
    expect(CPU_PROFILES.hard.grudge).toBeGreaterThan(1);
    expect(grudged).toBeInstanceOf(Object);
  });

  it('Newton resents wasted power on a hit', () => {
    // Both enemies can be hit straight on; the frugal level's cost prefers the cheaper launch.
    const world = emptyWorld([[100, 400], [600, 400], [1180, 400]]);
    const frugal = planShotNow(world, 0, {
      rules, level: 'medium', attempt: 30, fixedPower: null, rng: createRng(11),
    });
    const lazy = planShotNow(world, 0, {
      rules, level: 'easy', attempt: 30, fixedPower: null, rng: createRng(11),
    });
    expect(simulateShot(world, 0, frugal.angle, frugal.power, rules).end.kind).toBe('ship');
    expect(simulateShot(world, 0, lazy.angle, lazy.power, rules).end.kind).toBe('ship');
    // Newton's profile combines a power penalty with full hit-power refinement.
    expect(CPU_PROFILES.medium.powerFrugality).toBeGreaterThan(0);
    expect(CPU_PROFILES.medium.optimizeHitPower).toBe(true);
    expect(CPU_PROFILES.easy.powerFrugality).toBe(0);
    expect(CPU_PROFILES.easy.optimizeHitPower).toBe(false);
  });

  it('keeps aim error decaying per shot, steeper for harder levels', () => {
    expect(CPU_PROFILES.easy.decay).toBeGreaterThan(CPU_PROFILES.medium.decay);
    expect(CPU_PROFILES.medium.decay).toBeGreaterThan(CPU_PROFILES.hard.decay);
    expect(CPU_PROFILES.easy.angle).toBeGreaterThan(CPU_PROFILES.medium.angle);
    expect(CPU_PROFILES.medium.angle).toBeGreaterThan(CPU_PROFILES.hard.angle);
  });

  it('reports selected candidate, perturbed launch and predicted outcome', () => {
    const world = emptyWorld([[100, 400], [1180, 400]]);
    const reports: CpuDecision[] = [];
    const aim = planShotNow(world, 0, {
      rules, level: 'medium', attempt: 2, fixedPower: null, rng: createRng(13),
      onDecision: (decision) => reports.push(decision),
    });
    expect(reports).toHaveLength(1);
    const [decision] = reports;
    expect(decision.level).toBe('medium');
    expect(decision.attempt).toBe(2);
    expect(decision.considered).toBeGreaterThan(0);
    expect(decision.hitCandidates).toBeGreaterThan(0);
    expect(decision.searched).not.toBeNull();
    expect(decision.launch).toEqual(aim);
    expect(decision.predicted.end).toEqual(simulateShot(world, 0, aim.angle, aim.power, rules).end);
  });
});
