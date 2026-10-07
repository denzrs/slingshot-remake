import type { ExperimentalObservationReport, KillRecord, VersusMode } from '../src/game/match';
import type { ShotEnd } from '../src/physics';
import type { ExperimentalDecision, ExperimentalRecoveryDiagnostics } from '../src/experimental-ai';

export type Format = '1v1' | '2v2' | '3v3';
export type Opponent = 'easy' | 'medium' | 'hard';
export type Side = 'experimental' | 'opponent';
export interface DecisionRecord {
  kind: string;
  startingKnowledge: number;
  learningRate: number;
  observedShots: number;
  learnedShots: number;
  retainedShots: number;
  samples: number;
  predictionRms: number | null;
  predictionSamples: number;
  fitMs: number;
  relativeGravityMapRms: number | null;
  details?: ExperimentalDecision;
  recovery?: ExperimentalRecoveryDiagnostics;
}
export interface ShotRecord {
  round: number;
  player: number;
  shot: number;
  side: Side;
  outcome: string | null;
  hitShip: number | null;
  elapsed: number | null;
  decision: DecisionRecord | null;
  observation?: ExperimentalObservationReport | null;
  end?: ShotEnd | null;
  hitRelation?: 'enemy' | 'friendly' | 'self' | null;
  launch?: { x: number; y: number; angle: number; power: number };
}
export interface RoundRecord {
  round: number;
  shots: number;
  shotsByPlayer: number[];
  scores: number[];
  survivor: number | null;
  winningTeam: number | null;
  title: string;
}
export interface MatchRecord {
  mode: VersusMode;
  format: Format;
  opponent: Opponent;
  learningRate: number;
  startingKnowledge: number;
  pair: number;
  leg: 0 | 1;
  seed: number;
  rounds: number;
  status: 'completed' | 'failed';
  failure: string | null;
  experimentalScore: number;
  opponentScore: number;
  winner: Side | 'draw' | null;
  shots: ShotRecord[];
  kills: KillRecord[];
  roundResults: RoundRecord[];
  updates: number;
}
export interface Distribution {
  n: number; missing: number; mean: number | null; p50: number | null;
  p90: number | null; p95: number | null; min: number | null; max: number | null;
}
export interface MeanEstimate { n: number; mean: number | null; ci95: [number, number] | null }
export interface OutcomeSummary {
  attempted: number; completed: number; failed: number; wins: number; losses: number;
  draws: number; winPoints: number | null;
}
/** Completed-shot denominator, with historical/missing recovery left unavailable. */
export interface RecoverySummary {
  observationCount: number;
  missingObservationCount: number;
  optimizerInitialRms: Distribution; optimizerFinalRms: Distribution;
  beliefBeforeRms: Distribution; beliefAfterRms: Distribution;
  candidateValidationRms: Distribution; previousValidationRms: Distribution;
  validationSamples: Distribution;
  proposedLearningRate: Distribution; effectiveLearningRate: Distribution;
  matchedSources: Distribution; stagnationCount: Distribution; recoveryStarts: Distribution;
  stalled: number;
  updateStatuses: Partial<Record<ExperimentalRecoveryDiagnostics['updateStatus'], number>>;
}

export interface ShotSummary {
  fired: number; completed: number; unfinished: number; shipHits: number; shipHitRate: number | null;
  enemyHits: number; friendlyHits: number; selfHits: number; hitRelationMissing: number;
  enemyHitRate: number | null;
  outcomes: Record<string, number>; decisionCount: number; missingDecisionCount: number;
  decisions: Record<string, number>; offensiveKills: number; shotsPerKill: number | null;
  observationCount: number; missingObservationCount: number;
  elapsed: Distribution; outcomeElapsed: Record<string, Distribution>; observationFitMs: Distribution;
  predictionRms: Distribution; predictionSamples: Distribution; fitMs: Distribution;
  observedShots: Distribution; learnedShots: Distribution; retainedShots: Distribution;
  trajectorySamples: Distribution; relativeGravityMapRms: Distribution;
  recovery?: RecoverySummary;
}
export interface CellSummary {
  legs: OutcomeSummary;
  sides: { side0: OutcomeSummary; side1: OutcomeSummary };
  pairs: { attempted: number; completed: number; failed: number; wins: number; losses: number;
    draws: number; winRate: number | null; winRateCi95: [number, number] | null;
    scoreDelta: MeanEstimate; winPoints: MeanEstimate; scoreWinPoints: MeanEstimate };
  shots: { fired: number; completed: number; unfinished: number; perRound: Distribution; perLeg: Distribution };
  scores: { experimental: Distribution; opponent: Distribution };
  roundOutcomes: Record<string, number>;
  experimental: ShotSummary; opponent: ShotSummary;
  kills: { experimentalOffensive: number; experimentalSelf: number; experimentalFriendly: number;
    opponentOffensive: number; opponentSelf: number; opponentFriendly: number; swallowed: number };
  stages: Record<string, ShotSummary>;
  inference: string;
}
export interface ScoreOutcome { experimentalScore: number; opponentScore: number; winner: Side | 'draw' }

export function scoreOutcome(scores: readonly number[], experimentalPlayers: ReadonlySet<number>): ScoreOutcome {
  const experimentalScore = scores.reduce((sum, score, player) => sum + (experimentalPlayers.has(player) ? score : 0), 0);
  const opponentScore = scores.reduce((sum, score, player) => sum + (experimentalPlayers.has(player) ? 0 : score), 0);
  const winner: Side | 'draw' = experimentalScore > opponentScore ? 'experimental' : experimentalScore < opponentScore ? 'opponent' : 'draw';
  return { experimentalScore, opponentScore, winner };
}

export function distribution(values: readonly (number | null)[]): Distribution {
  const sorted = values.filter((value): value is number => value !== null && Number.isFinite(value)).sort((a, b) => a - b);
  const quantile = (p: number): number | null => {
    if (!sorted.length) return null;
    const index = (sorted.length - 1) * p;
    const lo = Math.floor(index);
    return sorted[lo] + (sorted[Math.ceil(index)] - sorted[lo]) * (index - lo);
  };
  return {
    n: sorted.length, missing: values.length - sorted.length,
    mean: sorted.length ? sorted.reduce((sum, value) => sum + value, 0) / sorted.length : null,
    p50: quantile(0.5), p90: quantile(0.9), p95: quantile(0.95),
    min: sorted[0] ?? null, max: sorted.at(-1) ?? null,
  };
}

/** Wilson interval is used only for independent matched-pair binary outcomes. */
export function wilsonInterval(successes: number, trials: number): [number, number] | null {
  if (!Number.isInteger(trials) || trials < 0 || !Number.isInteger(successes) || successes < 0 || successes > trials) throw new Error('Invalid binomial counts');
  if (trials === 0) return null;
  const z = 1.959963984540054;
  const p = successes / trials;
  const denominator = 1 + z * z / trials;
  const center = (p + z * z / (2 * trials)) / denominator;
  const half = z * Math.sqrt(p * (1 - p) / trials + z * z / (4 * trials * trials)) / denominator;
  return [Math.max(0, center - half), Math.min(1, center + half)];
}

/** Student-t 95% CI on independent pair clusters, not correlated legs/shots. */
export function meanConfidenceInterval(values: readonly number[]): MeanEstimate {
  if (values.some((value) => !Number.isFinite(value))) throw new Error('Mean samples must be finite');
  const n = values.length;
  const mean = n ? values.reduce((sum, value) => sum + value, 0) / n : null;
  if (n < 2) return { n, mean, ci95: null };
  const t95 = [12.706205, 4.302653, 3.182446, 2.776445, 2.570582, 2.446912, 2.364624, 2.306005, 2.262157, 2.228139, 2.200985, 2.178813, 2.160369, 2.144787, 2.13145, 2.119905, 2.109816, 2.100922, 2.093024, 2.085963, 2.079614, 2.073873, 2.068658, 2.063899, 2.059539, 2.055529, 2.051831, 2.048407, 2.04523, 2.042272];
  const df = n - 1;
  const z = 1.959963984540054;
  const t = df <= 30 ? t95[df - 1] : z + (z ** 3 + z) / (4 * df) + (5 * z ** 5 + 16 * z ** 3 + 3 * z) / (96 * df * df);
  const variance = values.reduce((sum, value) => sum + (value - mean!) ** 2, 0) / df;
  const half = t * Math.sqrt(variance / n);
  return { n, mean, ci95: [mean! - half, mean! + half] as [number, number] };
}

/** Distribution-free 95% Hoeffding bound for independent pair samples in [0,1].
 * Each sample contains both dependent legs. This remains uncertain at all-loss/all-win boundaries.
 */
export function boundedMeanConfidenceInterval(values: readonly number[]): MeanEstimate {
  if (values.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) throw new Error('Bounded mean samples must be in [0,1]');
  const n = values.length;
  if (!n) return { n, mean: null, ci95: null };
  const mean = values.reduce((sum, value) => sum + value, 0) / n;
  const half = Math.sqrt(Math.log(40) / (2 * n));
  return { n, mean, ci95: [Math.max(0, mean - half), Math.min(1, mean + half)] };
}

function outcomes(records: readonly MatchRecord[]): OutcomeSummary {
  const completed = records.filter((record) => record.status === 'completed');
  const wins = completed.filter((record) => record.winner === 'experimental').length;
  const losses = completed.filter((record) => record.winner === 'opponent').length;
  const draws = completed.filter((record) => record.winner === 'draw').length;
  return { attempted: records.length, completed: completed.length, failed: records.length - completed.length, wins, losses, draws, winPoints: completed.length ? (wins + draws / 2) / completed.length : null };
}

function shotSummary(shots: readonly ShotRecord[]): ShotSummary {
  const completed = shots.filter((shot) => shot.outcome !== null);
  const decisions = shots.flatMap((shot) => shot.decision ? [shot.decision] : []);
  const observationCount = completed.filter((shot) => shot.observation != null).length;
  const observed = (value: (observation: ExperimentalObservationReport) => number | null) => distribution(completed.map((shot) => shot.observation ? value(shot.observation) : null));
  const enemyHits = completed.filter((shot) => shot.hitRelation === 'enemy').length;
  const hitRelationMissing = completed.filter((shot) => shot.outcome === 'ship' && !shot.hitRelation).length;
  const recoveries = completed.flatMap((shot) => shot.observation?.recovery ? [shot.observation.recovery] : []);
  const recoveryDistribution = (value: (recovery: ExperimentalRecoveryDiagnostics) => number | null) => observed((observation) => observation.recovery ? value(observation.recovery) : null);
  return {
    fired: shots.length, completed: completed.length, unfinished: shots.length - completed.length,
    shipHits: completed.filter((shot) => shot.outcome === 'ship').length,
    shipHitRate: completed.length ? completed.filter((shot) => shot.outcome === 'ship').length / completed.length : null,
    enemyHits,
    friendlyHits: completed.filter((shot) => shot.hitRelation === 'friendly').length,
    selfHits: completed.filter((shot) => shot.hitRelation === 'self').length,
    hitRelationMissing,
    enemyHitRate: completed.length && !hitRelationMissing ? enemyHits / completed.length : null,
    outcomes: Object.fromEntries([...new Set(completed.map((shot) => shot.outcome!))].map((kind) => [kind, completed.filter((shot) => shot.outcome === kind).length])),
    decisionCount: decisions.length, missingDecisionCount: shots.length - decisions.length,
    decisions: Object.fromEntries([...new Set(decisions.map((decision) => decision.kind))].map((kind) => [kind, decisions.filter((decision) => decision.kind === kind).length])),
    offensiveKills: enemyHits, shotsPerKill: enemyHits ? shots.length / enemyHits : null,
    observationCount, missingObservationCount: completed.length - observationCount,
    elapsed: distribution(completed.map((shot) => shot.elapsed)),
    outcomeElapsed: Object.fromEntries([...new Set(completed.map((shot) => shot.outcome!))].map((kind) => [kind, distribution(completed.filter((shot) => shot.outcome === kind).map((shot) => shot.elapsed))])),
    predictionRms: observed((observation) => observation.predictionRms),
    predictionSamples: observed((observation) => observation.predictionSamples),
    observationFitMs: observed((observation) => observation.fitMs),
    fitMs: distribution(shots.map((shot) => shot.decision?.fitMs ?? null)),
    observedShots: observed((observation) => observation.observedShots),
    learnedShots: observed((observation) => observation.learnedShots),
    retainedShots: observed((observation) => observation.retainedShots),
    trajectorySamples: observed((observation) => observation.samples),
    relativeGravityMapRms: distribution(shots.map((shot) => shot.decision?.relativeGravityMapRms ?? null)),
    ...(recoveries.length ? { recovery: {
      observationCount: recoveries.length,
      missingObservationCount: completed.length - recoveries.length,
      optimizerInitialRms: recoveryDistribution((recovery) => recovery.optimizerInitialRms),
      optimizerFinalRms: recoveryDistribution((recovery) => recovery.optimizerFinalRms),
      beliefBeforeRms: recoveryDistribution((recovery) => recovery.beliefBeforeRms),
      beliefAfterRms: recoveryDistribution((recovery) => recovery.beliefAfterRms),
      candidateValidationRms: recoveryDistribution((recovery) => recovery.candidateValidationRms),
      previousValidationRms: recoveryDistribution((recovery) => recovery.previousValidationRms),
      validationSamples: recoveryDistribution((recovery) => recovery.validationSamples),
      proposedLearningRate: recoveryDistribution((recovery) => recovery.proposedLearningRate),
      effectiveLearningRate: recoveryDistribution((recovery) => recovery.effectiveLearningRate),
      matchedSources: recoveryDistribution((recovery) => recovery.matchedSources),
      stagnationCount: recoveryDistribution((recovery) => recovery.stagnationCount),
      recoveryStarts: recoveryDistribution((recovery) => recovery.recoveryStarts),
      stalled: recoveries.filter((recovery) => recovery.stalled).length,
      updateStatuses: Object.fromEntries([...new Set(recoveries.map((recovery) => recovery.updateStatus))].map((status) => [status, recoveries.filter((recovery) => recovery.updateStatus === status).length])),
    } } : {}),
  };
}

export function summarizeCell(records: readonly MatchRecord[]): CellSummary {
  const first = records[0];
  if (first && records.some((record) => record.mode !== first.mode || record.format !== first.format || record.opponent !== first.opponent || record.learningRate !== first.learningRate || record.startingKnowledge !== first.startingKnowledge)) throw new Error('Cannot summarize records from different matrix cells');
  const pairs = new Map<number, MatchRecord[]>();
  for (const record of records) pairs.set(record.pair, [...(pairs.get(record.pair) ?? []), record]);
  const completePairs = [...pairs.values()].filter((legs) => legs.length === 2 && new Set(legs.map((leg) => leg.leg)).size === 2 && legs.every((leg) => leg.status === 'completed'));
  const deltas = completePairs.map((legs) => legs.reduce((sum, leg) => sum + leg.experimentalScore - leg.opponentScore, 0));
  const pairPoints = completePairs.map((legs) => legs.reduce((sum, leg) => sum + (leg.winner === 'experimental' ? 1 : leg.winner === 'draw' ? 0.5 : 0), 0) / 2);
  const pairWins = deltas.filter((delta) => delta > 0).length;
  const pairLosses = deltas.filter((delta) => delta < 0).length;
  const shots = records.flatMap((record) => record.shots);
  const experimentalShots = shots.filter((shot) => shot.side === 'experimental');
  // Kill ownership is resolved per leg because the experimental side swaps.
  let offensiveKills = 0;
  let selfKills = 0;
  let friendlyKills = 0;
  let opponentOffensiveKills = 0;
  let opponentSelfKills = 0;
  let opponentFriendlyKills = 0;
  for (const record of records) {
    const ids = new Set(record.shots.filter((shot) => shot.side === 'experimental').map((shot) => shot.player));
    for (const kill of record.kills) {
      if (kill.killer === null) continue;
      if (ids.has(kill.killer)) {
        if (kill.self) selfKills++;
        else if (kill.friendly) friendlyKills++;
        else offensiveKills++;
      } else if (kill.self) opponentSelfKills++;
      else if (kill.friendly) opponentFriendlyKills++;
      else opponentOffensiveKills++;
    }
  }
  const stages = ['1', '2', '3+'] as const;
  const experimental = shotSummary(experimentalShots);
  experimental.offensiveKills = offensiveKills;
  experimental.shotsPerKill = offensiveKills ? experimentalShots.length / offensiveKills : null;
  const roundTitles = records.flatMap((record) => record.roundResults.map((round) => round.title));
  const completedLegs = records.filter((record) => record.status === 'completed');
  return {
    legs: outcomes(records), sides: { side0: outcomes(records.filter((record) => record.leg === 0)), side1: outcomes(records.filter((record) => record.leg === 1)) },
    pairs: { attempted: pairs.size, completed: completePairs.length, failed: pairs.size - completePairs.length, wins: pairWins, losses: pairLosses, draws: deltas.length - pairWins - pairLosses, winRate: deltas.length ? pairWins / deltas.length : null, winRateCi95: wilsonInterval(pairWins, deltas.length), scoreDelta: meanConfidenceInterval(deltas), winPoints: boundedMeanConfidenceInterval(pairPoints), scoreWinPoints: boundedMeanConfidenceInterval(deltas.map((delta) => delta > 0 ? 1 : delta < 0 ? 0 : 0.5)) },
    shots: { fired: shots.length, completed: shots.filter((shot) => shot.outcome !== null).length, unfinished: shots.filter((shot) => shot.outcome === null).length, perRound: distribution(records.flatMap((record) => record.roundResults.map((round) => round.shots))), perLeg: distribution(records.map((record) => record.shots.length)) },
    scores: { experimental: distribution(completedLegs.map((record) => record.experimentalScore)), opponent: distribution(completedLegs.map((record) => record.opponentScore)) },
    roundOutcomes: Object.fromEntries([...new Set(roundTitles)].map((title) => [title, roundTitles.filter((value) => value === title).length])),
    experimental, opponent: { ...shotSummary(shots.filter((shot) => shot.side === 'opponent')), offensiveKills: opponentOffensiveKills, shotsPerKill: opponentOffensiveKills ? shots.filter((shot) => shot.side === 'opponent').length / opponentOffensiveKills : null },
    kills: { experimentalOffensive: offensiveKills, experimentalSelf: selfKills, experimentalFriendly: friendlyKills,
      opponentOffensive: opponentOffensiveKills, opponentSelf: opponentSelfKills, opponentFriendly: opponentFriendlyKills,
      swallowed: records.flatMap((record) => record.kills).filter((kill) => kill.killer === null).length },
    stages: Object.fromEntries(stages.map((stage) => [stage, shotSummary(experimentalShots.filter((shot) => stage === '1' ? shot.shot === 1 : stage === '2' ? shot.shot === 2 : shot.shot >= 3))])),
    inference: 'Win points average the two leg outcomes within each complete world pair; scoreWinPoints instead uses the combined final-score outcome. Both use bounded distribution-free 95% Hoeffding intervals on independent world pairs, including constant samples. Strict paired score wins use Wilson; score deltas use Student-t (normal-mean approximation). Shot diagnostics are descriptive, not independent evidence of skill parity; prediction/evidence telemetry is matched to authoritative shot completion, while fitMs/map RMS describe launch planning.',
  };
}
