import type { Match } from './game';
import { fmt, fmtInt, t, type Key } from './i18n';
import { COLORS } from './config';
import { awards, type Award, type AwardKind } from './stats';

const LABELS: Record<AwardKind, Key> = {
  longestShot: 'award.longestShot',
  fastestKill: 'award.fastestKill',
  swingbys: 'award.swingbys',
  grazes: 'award.grazes',
  bestHit: 'award.bestHit',
  kills: 'award.kills',
  closeCall: 'award.closeCall',
  sniper: 'award.sniper',
  ownGoals: 'award.ownGoals',
};

export const awardLabel = (kind: AwardKind): string => t(LABELS[kind]);

/** The record or count, ready to print: "1,432 px", "12.4 s", "×3", "+1,300". */
export function awardValue(award: Award): string {
  switch (award.kind) {
    case 'closeCall':
      return `${fmt(award.value, 1)} px`;
    case 'longestShot':
    case 'sniper':
      return `${fmtInt(Math.round(award.value))} px`;
    case 'fastestKill':
      return `${fmt(award.value, 1)} s`;
    case 'bestHit':
      return `+${fmtInt(award.value)}`;
    default:
      return `×${award.value}`;
  }
}

/** Who earned it: one name, or several joined when the top spot is shared. */
export function awardWho(match: Match, award: Award): { name: string; color: string } {
  const players = award.players.map((id) => match.players[id]).filter(Boolean);
  return { name: players.map((p) => p.name).join(' · '), color: players.length === 1 ? players[0].color : COLORS.bone };
}

/** How long the scorecard dwells on one award's shot before moving on to the next, in seconds. */
export const SPOTLIGHT_EVERY = 2.4;
/** The first spotlight comes once the cards have faded in. */
const SPOTLIGHT_AFTER = 1.2;

/**
 * The round-end scorecard walks through the awards that come with a shot and lights each one up on
 * the field in turn. Derived from the round's clock alone, so every screen shows the same one.
 */
export function spotlight(match: Match): { award: Award; index: number; /** Seconds into this award's turn. */ age: number } | null {
  const list = awards(match.roundStats);
  const shots = list.filter((a) => a.trail && a.trail.length >= 4);
  if (!shots.length || match.phaseTime < SPOTLIGHT_AFTER) return null;
  const turn = Math.floor((match.phaseTime - SPOTLIGHT_AFTER) / SPOTLIGHT_EVERY);
  const award = shots[turn % shots.length];
  return { award, index: list.indexOf(award), age: match.phaseTime - SPOTLIGHT_AFTER - turn * SPOTLIGHT_EVERY };
}
