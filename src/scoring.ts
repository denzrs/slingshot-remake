import { AIM, SCORING } from './config';
import { t } from './i18n';
import type { StyleKind } from './physics';

export const STYLE_MULTIPLIER: Record<StyleKind, number> = {
  swingby: 1.5,
  bank: 1.25,
  graze: 1.3,
  photon: 3,
  airtime: 1.2,
};

export function styleLabel(kind: StyleKind): string {
  return t(`style.${kind}`);
}

/** Trick-shot multipliers stack multiplicatively, capped. */
export function comboMultiplier(kinds: StyleKind[]): number {
  const m = kinds.reduce((acc, k) => acc * STYLE_MULTIPLIER[k], 1);
  return Math.min(SCORING.MAX_COMBO, m);
}

/** Event Horizon: a kill is worth base × power factor × trick-shot combo. */
export function scoreHorizonKill(power: number, kinds: StyleKind[], fixedPower: boolean): { points: number; combo: number } {
  const powerFactor = fixedPower ? 1 : 1.5 - power / AIM.MAX_POWER;
  const combo = comboMultiplier(kinds);
  return { points: Math.round((SCORING.BASE * powerFactor * combo) / 10) * 10, combo };
}

/**
 * Daily challenge: a hit pays base × shot factor × power factor × trick-shot combo.
 * `attempt` counts the shots spent on this target (1 = first try), like the round's shot count in Classic.
 */
export function scoreChallengeHit(attempt: number, power: number, fixedPower: boolean, kinds: StyleKind[]): { points: number; multiplier: number } {
  const shotFactor = Math.max(0.25, 1 - 0.15 * (attempt - 1));
  const powerFactor = fixedPower ? 1 : 1.5 - power / AIM.MAX_POWER;
  const multiplier = comboMultiplier(kinds);
  return { points: Math.round((SCORING.BASE * shotFactor * powerFactor * multiplier) / 10) * 10, multiplier };
}
