import { ANOMALIES, ANOMALY, PHYSICS, type Anomaly } from './config';
import type { ShotRules } from './physics';

/** A number from 0 to 1, the same for the same seed and unlike for another. Not a draw from any stream, so a round without fuses plays as ever. */
function hash01(seed: number, salt: number): number {
  let h = (seed ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * Zeitzünder: how long a shot's fuse burns this round, in seconds. Somewhere between a quarter and a half of the
 * shot time, made from the round's world seed, so the host, every guest and a replay all know it without being told.
 * When shot power is capped or fixed to low levels, the fuse is extended so the blast can reach across the battlefield.
 */
export function fuseSeconds(shotTime: number, worldSeed: number, maxPower?: number): number {
  const share = ANOMALY.FUSE_MIN + hash01(worldSeed, 0x7f17e) * (ANOMALY.FUSE_MAX - ANOMALY.FUSE_MIN);
  let fuse = Math.max(ANOMALY.FUSE_FLOOR, Math.round(shotTime * share * 10) / 10);
  if (maxPower !== undefined && maxPower > 0) {
    // Minimum time to cross the field (~850px) at max available launch speed.
    const crossTime = 850 / (maxPower * PHYSICS.SPEED_PER_POWER);
    if (crossTime > fuse) {
      fuse = Math.min(Math.max(shotTime - 0.5, ANOMALY.FUSE_FLOOR), Math.max(fuse, Math.round(crossTime * 10) / 10));
    }
  }
  return Math.max(ANOMALY.FUSE_FLOOR, fuse);
}

/** The anomalies a flight's rules play by, in their usual order. */
export function anomaliesOf(rules: ShotRules): Anomaly[] {
  return ANOMALIES.filter((anomaly) => (anomaly === 'fuse' ? !!rules.fuse : !!rules[anomaly]));
}

/** The part of a flight's rules the anomalies set: what a mode adds to its edges and shot time. */
export function anomalyRules(
  anomalies: readonly Anomaly[],
  shotTime: number,
  worldSeed: number,
  maxPower?: number,
): Pick<ShotRules, 'trickShots' | 'pinball' | 'fuse' | 'fusion' | 'whiteHole' | 'unstable'> {
  if (!anomalies.length) return {};
  return {
    trickShots: anomalies.includes('trickShots'),
    pinball: anomalies.includes('pinball'),
    fuse: anomalies.includes('fuse') ? fuseSeconds(shotTime, worldSeed, maxPower) : 0,
    fusion: anomalies.includes('fusion'),
    whiteHole: anomalies.includes('whiteHole'),
    unstable: anomalies.includes('unstable'),
  };
}
