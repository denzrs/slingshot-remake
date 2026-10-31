import { describe, expect, it } from 'vitest';
import { buildSector, dailyChallenge, sectorRules, shiftDate, type SectorSpec } from '../../src/sim/challenge';
import { CHALLENGE, FIELD, PHYSICS } from '../../src/sim/config';
import { cloneWorld, simulateShot } from '../../src/sim/physics';

/** The first day with the flak, nebula and ammo variations. */
export const VARIANTS = '2026-10-22';
const days = (n: number, from: string = CHALLENGE.EPOCH) => Array.from({ length: n }, (_, i) => shiftDate(from, i));

/** Every day for five weeks, every sector: the whole point is that none of them can be broken. */
export const allSectors = () => [...days(35), ...days(33, VARIANTS)].flatMap((d) => dailyChallenge(d).sectors.map((spec) => ({ day: d, spec })));

/** Building all 175 sectors costs seconds, so each file builds and sweeps its own share of them and vitest runs the files side by side. */
export const SWEEP_FILES = 4;

/** Registers the sector sweeps for the sectors whose position is `slice` modulo `SWEEP_FILES`. */
export function defineSectorSweeps(slice: number): void {
  const sectors = allSectors().filter((_, i) => i % SWEEP_FILES === slice);
  // Built once for the two sweeps below.
  let built: { day: string; spec: SectorSpec; sector: ReturnType<typeof buildSector> }[] | null = null;
  const buildAll = () => (built ??= sectors.map(({ day, spec }) => ({ day, spec, sector: buildSector(spec) })));
  const SWEEP_TIMEOUT = 60_000;

  describe(`sector layout (sectors ${slice + 1} of ${SWEEP_FILES})`, () => {
    it('puts every target on a path the player can actually fly', () => {
      for (const { day, spec, sector } of buildAll()) {
        const { world, solutions } = sector;
        const rules = sectorRules(spec);
        expect(solutions.length, `${day} sector ${spec.index}`).toBe(spec.targets);
        expect(world.ships).toHaveLength(1 + spec.targets);
        for (const s of solutions) {
          const { end } = simulateShot(cloneWorld(world), 0, s.angle, s.power, rules, [], [], false, spec.ammo === 'plasma');
          const label = `${day} sector ${spec.index} target ${s.target}`;
          expect(end, label).toEqual({ kind: 'ship', ship: s.target });
          expect(s.window).toBeGreaterThanOrEqual(0.08);
        }
      }
    }, SWEEP_TIMEOUT);

    it('keeps targets in the field, away from planets, the hole and each other', () => {
      for (const { day, spec, sector } of buildAll()) {
        const { world } = sector;
        const [me, ...targets] = world.ships;
        targets.forEach((t, i) => {
          const label = `${day} sector ${spec.index} target ${i + 1}`;
          expect(t.x, label).toBeGreaterThan(0);
          expect(t.x, label).toBeLessThan(FIELD.width);
          expect(t.y, label).toBeGreaterThan(0);
          expect(t.y, label).toBeLessThan(FIELD.height);
          for (const p of world.planets) expect(Math.hypot(p.x - t.x, p.y - t.y), label).toBeGreaterThan(p.radius + PHYSICS.SHIP_RADIUS);
          if (world.holes.length > 0) expect(Math.hypot(world.holes[0].x - t.x, world.holes[0].y - t.y), label).toBeGreaterThan(world.holes[0].radius + PHYSICS.SHIP_RADIUS);
          expect(Math.hypot(me.x - t.x, me.y - t.y), label).toBeGreaterThan(100);
          targets.slice(i + 1).forEach((o) => expect(Math.hypot(o.x - t.x, o.y - t.y), label).toBeGreaterThan(60));
        });
        expect(world.holes.length > 0).toBe(spec.hole);
        expect(world.defenses.length, `${day} sector ${spec.index}`).toBe(spec.flak ? 1 : 0);
        expect(world.nebulae.length, `${day} sector ${spec.index}`).toBe(spec.nebulae);
      }
    }, SWEEP_TIMEOUT);
  });
}
