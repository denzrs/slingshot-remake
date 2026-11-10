import { fmt, fmtInt, fmtNum, t, type Key } from '../platform/i18n';
import { ANOMALIES, BONUS_KINDS, SCORING } from '../sim/config';
import type { StatsFact } from './net';

/** A length of time as 1:05. */
const clock = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;

/** A percentage: whole from ten up, one decimal below (none when it is round), so "0.4" is not "0". */
const percent = (n: number): string => (n >= 10 ? fmt(n, 0) : fmtNum(Math.round(n * 10) / 10));

/** A power-up the relay names by its index in this list (the relay keeps the same one: `server/src/stats/facts.rs`). */
const PLACED_KINDS = ['blackhole', 'wormhole', 'nebula', 'planetkiller', 'teleport', 'defense', 'antigravity'] as const;

/** The formats that turn a value into a name, not a figure. */
const NAMES = new WeakSet<(n: number) => string>();

/** The name at an index: one this client does not know (a newer relay) has no sentence. */
function named(prefix: string, names: readonly string[]): (n: number) => string {
  const format = (n: number): string => {
    const name = names[n];
    if (name === undefined) throw new RangeError(`no ${prefix} ${n}`);
    return t(`${prefix}.${name}` as Key);
  };
  NAMES.add(format);
  return format;
}

/** How each fact shows its numbers, in the order the relay sends them. */
const FORMATS: Record<string, ((n: number) => string)[]> = {
  shotsPerKill: [(n) => fmt(n, 1)],
  holeShots: [percent],
  selfHighSolar: [percent, percent],
  previewShots: [percent, percent],
  comeback: [percent],
  topPlacement: [named('powerup', PLACED_KINDS), fmtInt],
  solarShare: [percent],
  todayPlayers: [fmtInt, fmtInt],
  dailyChallenge: [fmtInt, fmtInt],
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
  selfHitRounds: [percent],
  noWinner: [percent],
  horizonShare: [percent],
  teamShare: [percent],
  cpuWins: [percent, percent],
  swingbys: [(n) => fmt(n, 1)],
  bestHit: [fmtInt],
  fastestKill: [(n) => fmt(n, 1)],
  closeCall: [(n) => fmt(n, 1)],
  plasmaShots: [percent, percent],
  piercingShots: [percent, percent],
  splitterShots: [percent, percent],
  lowPower: [percent, percent],
  avgKillTurn: [(n) => fmt(n, 1)],
  longestShot: [fmtInt],
  sniper: [fmtInt],
  multiKill: [percent],
  bigKills: [fmtInt, fmtInt],
  firstShotKill: [percent],
  seatAdvantage: [percent],
  planetsDestroyed: [fmtInt],
  blastShots: [percent, percent],
  fusedShots: [percent],
  anomalyShare: [percent],
  topAnomaly: [named('anomaly', ANOMALIES), fmtInt],
  trickShotHits: [percent, percent],
  anomalyShotsPerKill: [(n) => fmt(n, 1), (n) => fmt(n, 1)],
  pinballSelfHits: [percent, percent],
  anomalyRoundLength: [clock, clock],
  loopShare: [percent],
  wallHits: [percent, percent],
  planetsShattered: [fmtInt, (n) => fmt(n, 1)],
  pinballBumps: [(n) => fmt(n, 1)],
  armedShots: [percent],
  loopCrossings: [(n) => fmt(n, 1)],
  whiteHoleReturns: [fmtInt],
  quickRound: [percent],
  soloVsCpu: [percent],
  spectated: [percent],
  avgHumans: [(n) => fmt(n, 1)],
  planetsEffect: [percent, percent],
  cpuLevels: [percent, percent],
  pickups: [(n) => fmt(n, 1)],
  grazes: [(n) => fmt(n, 2)],
  saves: [fmtInt],
  intercepts: [percent],
  strayKills: [fmtInt],
  firstBlood: [percent],
  bounties: [fmtInt, fmtInt],
  revenges: [percent],
  topBonus: [named('bonus', BONUS_KINDS), fmtInt],
  bonusPoints: [fmtInt, fmtInt],
  dominations: [fmtInt],
  posthumous: [fmtInt],
  shutdowns: [fmtInt],
  lastToFirst: [fmtInt],
  ownGoals: [percent],
  weekTrend: [fmtInt, percent],
  weekend: [percent],
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
  /** A value of the data that is a name (a power-up, an anomaly), not a figure: set apart like a number, but no headline. */
  name?: boolean;
}

// Fences around a number while the sentence is made, so that its place in the translated words survives; the opening one
// carries the value's index, so the part knows which format made it.
const OPEN = '\u0001';
const INDEX = '\u0003';
const CLOSE = '\u0002';

/** The sentence for a fact in parts, numbers apart from words; null for one this client does not know (a newer relay), or one with nothing to say. */
export function factParts(fact: StatsFact): FactPart[] | null {
  const formats = FORMATS[fact.id];
  const key = `fact.${fact.id}` as Key;
  if (!formats || fact.values.length < formats.length) return null;
  // "0 % of shots hit the shooter" is no finding.
  if (fact.id.startsWith('selfHigh') && !(fact.values[0] > 0)) return null;
  let sentence: string;
  try {
    const [a, b] = formats.map((format, i) => OPEN + i + INDEX + format(fact.values[i]) + CLOSE);
    sentence = t(key, { a, b: b ?? '', rounds: SCORING.DOMINATION_ROUNDS });
  } catch {
    return null;
  }
  // A percent sign belongs to its number, with or without the space some languages put before it.
  const parts: FactPart[] = [];
  let from = 0;
  for (const match of sentence.matchAll(new RegExp(`${OPEN}(\\d+)${INDEX}(.*?)${CLOSE}( ?%)?`, 'g'))) {
    if (match.index > from) parts.push({ text: sentence.slice(from, match.index), number: false });
    const part: FactPart = { text: match[2] + (match[3] ?? ''), number: true };
    if (NAMES.has(formats[Number(match[1])])) part.name = true;
    parts.push(part);
    from = match.index + match[0].length;
  }
  if (from < sentence.length) parts.push({ text: sentence.slice(from), number: false });
  return parts;
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

/** Every fact this client can word, in parts, in the order the relay sends them (grouped by what they are about). */
export function factLinesInOrder(facts: readonly StatsFact[]): FactPart[][] {
  return facts.map(factParts).filter((parts): parts is FactPart[] => parts !== null);
}

/** The same as `factTexts`, in parts, for a line that sets its numbers apart. */
export function factLines(facts: readonly StatsFact[], random: () => number = Math.random): FactPart[][] {
  return shuffled(factLinesInOrder(facts), random);
}
