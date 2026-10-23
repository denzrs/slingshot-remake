import { fmt, fmtInt, fmtNum, t, type Key } from './i18n';
import type { StatsFact } from './net';

/** A length of time as 1:05. */
const clock = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;

/** A percentage: whole from ten up, one decimal below (none when it is round), so "0.4" is not "0". */
const percent = (n: number): string => (n >= 10 ? fmt(n, 0) : fmtNum(Math.round(n * 10) / 10));

/** How each fact shows its numbers, in the order the relay sends them. */
const FORMATS: Record<string, ((n: number) => string)[]> = {
  hitRate: [percent],
  leftField: [percent],
  planetCrash: [percent],
  clash: [percent],
  firstTurn: [percent, percent],
  maxPower: [percent, percent],
  defaultPower: [percent],
  selfHighClassic: [percent, percent],
  selfHighHorizon: [percent, percent],
  powerUpShots: [percent, percent],
  repeatMiss: [percent],
  rounds: [clock, clock],
  longestRound: [fmtInt],
  selfHitRounds: [percent],
  noWinner: [percent],
  horizonShare: [percent],
  teamShare: [percent],
  cpuWins: [percent, percent],
  swingbys: [(n) => fmt(n, 1)],
  bestHit: [fmtInt],
  fastestKill: [(n) => fmt(n, 1)],
  closeCall: [(n) => fmt(n, 1)],
  today: [fmtInt, fmtInt],
  tipRound: [percent],
  tipShot: [percent],
  tipUnderdog: [percent],
  tipStands: [percent],
  betPaid: [percent],
  betStake: [fmtInt, fmtInt],
  betWin: [fmtInt],
  betLoss: [fmtInt],
};

/** The sentence for a fact; null for one this client does not know (a newer relay), or one with nothing to say. */
export function factText(fact: StatsFact): string | null {
  const formats = FORMATS[fact.id];
  const key = `fact.${fact.id}` as Key;
  if (!formats || fact.values.length < formats.length) return null;
  // "0 % of shots hit the shooter" is no finding.
  if (fact.id.startsWith('selfHigh') && !(fact.values[0] > 0)) return null;
  const [a, b] = formats.map((format, i) => format(fact.values[i]));
  try {
    return t(key, { a, b: b ?? '' });
  } catch {
    return null;
  }
}

/** The sentences of the facts, in a random order (the same fact is not shown twice in a row across a cycle). */
export function factTexts(facts: readonly StatsFact[], random: () => number = Math.random): string[] {
  const texts = facts.map(factText).filter((text): text is string => text !== null);
  for (let i = texts.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [texts[i], texts[j]] = [texts[j], texts[i]];
  }
  return texts;
}
