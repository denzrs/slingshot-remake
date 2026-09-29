import { AIM, SCORING } from './config';

export interface HitScore {
  points: number;
  shotFactor: number;
  powerFactor: number;
}

/**
 * Faster kills and gentler shots pay more.
 * - shots: how many shots the shooter needed this round (1 = first try)
 * - power: power of the hitting shot; ignored when power is fixed for everyone
 */
export function scoreHit(shots: number, power: number, fixedPower: boolean): HitScore {
  const shotFactor = Math.max(0.25, 1 - 0.15 * (shots - 1));
  const powerFactor = fixedPower ? 1 : 1.5 - power / AIM.MAX_POWER;
  const points = Math.round((SCORING.BASE * shotFactor * powerFactor) / 10) * 10;
  return { points, shotFactor, powerFactor };
}
