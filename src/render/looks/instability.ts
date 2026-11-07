import { planetDurability, type Planet } from '../../sim/physics';

/** Shared warning rhythm; each look paints its own light and material. */
export function instabilityPulse(planet: Planet, time: number): { danger: number; pulse: number; hz: number } | null {
  const hits = planet.fractures?.length ?? 0;
  if (!hits || planet.sun) return null;
  // The last surviving hit is full danger, whatever the planet's size.
  const danger = Math.min(1, hits / Math.max(1, planetDurability(planet) - 1));
  const hz = .35 + 2.45 * danger * danger;
  const phase = time * hz + (planet.seed % 101) / 101;
  const pulse = (.5 - .5 * Math.cos(phase * Math.PI * 2)) ** 2;
  return { danger, pulse, hz };
}
