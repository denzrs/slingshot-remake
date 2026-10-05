import type { Match } from './game';
import { fmt, fmtInt, t } from './i18n';
import { COLORS } from './config';
import type { Award, AwardKind } from './stats';

const LABELS: Record<AwardKind, 'award.longestShot' | 'award.fastestKill' | 'award.swingbys' | 'award.grazes' | 'award.bestHit' | 'award.kills'> = {
  longestShot: 'award.longestShot',
  fastestKill: 'award.fastestKill',
  swingbys: 'award.swingbys',
  grazes: 'award.grazes',
  bestHit: 'award.bestHit',
  kills: 'award.kills',
};

export const awardLabel = (kind: AwardKind): string => t(LABELS[kind]);

/** The record or count, ready to print: "1,432 px", "12.4 s", "×3", "+1,300". */
export function awardValue(award: Award): string {
  switch (award.kind) {
    case 'longestShot':
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
