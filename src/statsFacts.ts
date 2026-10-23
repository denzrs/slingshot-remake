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

/** A stretch of a fact's sentence: a number of the data, or the words around it. */
export interface FactPart {
  text: string;
  number: boolean;
}

// Fences around a number while the sentence is made, so that its place in the translated words survives.
const OPEN = '\u0001';
const CLOSE = '\u0002';

/** The sentence for a fact in parts, numbers apart from words; null for one this client does not know (a newer relay), or one with nothing to say. */
export function factParts(fact: StatsFact): FactPart[] | null {
  const formats = FORMATS[fact.id];
  const key = `fact.${fact.id}` as Key;
  if (!formats || fact.values.length < formats.length) return null;
  // "0 % of shots hit the shooter" is no finding.
  if (fact.id.startsWith('selfHigh') && !(fact.values[0] > 0)) return null;
  const [a, b] = formats.map((format, i) => OPEN + format(fact.values[i]) + CLOSE);
  let sentence: string;
  try {
    sentence = t(key, { a, b: b ?? '' });
  } catch {
    return null;
  }
  // Splitting on the fences leaves words at even places and numbers at odd ones.
  return sentence
    .split(new RegExp(`${OPEN}(.*?)${CLOSE}`))
    .map((text, i) => ({ text, number: i % 2 === 1 }))
    .filter((part) => part.text !== '');
}

/** The sentence for a fact as plain text. */
export function factText(fact: StatsFact): string | null {
  return factParts(fact)?.map((part) => part.text).join('') ?? null;
}

function shuffled<T>(items: T[], random: () => number): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/** The sentences of the facts, in a random order (the same fact is not shown twice in a row across a cycle). */
export function factTexts(facts: readonly StatsFact[], random: () => number = Math.random): string[] {
  return shuffled(facts.map(factText).filter((text): text is string => text !== null), random);
}

/** The same, in parts, for a line that sets its numbers apart. */
export function factLines(facts: readonly StatsFact[], random: () => number = Math.random): FactPart[][] {
  return shuffled(facts.map(factParts).filter((parts): parts is FactPart[] => parts !== null), random);
}
