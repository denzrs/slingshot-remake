import { describe, expect, it } from 'vitest';
import { boundedMeanConfidenceInterval, distribution, meanConfidenceInterval, scoreOutcome, summarizeCell, wilsonInterval, type DecisionRecord, type MatchRecord, type ShotRecord } from '../benchmarks/ai-metrics';
import { formatCell, parseArguments, runLeg, runMatrix } from '../benchmarks/ai-matrix';
import { PHYSICS } from '../src/config';
import { aimDirection } from '../src/physics';

function record(pair: number, leg: 0 | 1, experimentalScore: number, opponentScore: number): MatchRecord {
  return {
    mode: 'classic', format: '1v1', opponent: 'easy', learningRate: 1, startingKnowledge: 1, pair, leg, seed: 100 + pair,
    rounds: 2, status: 'completed', failure: null, experimentalScore, opponentScore,
    winner: experimentalScore > opponentScore ? 'experimental' : experimentalScore < opponentScore ? 'opponent' : 'draw',
    shots: [], kills: [], roundResults: [], updates: 0,
  };
}
function shot(round: number, player: number, index: number, outcome: string | null, decision: DecisionRecord | null = null): ShotRecord {
  return { round, player, shot: index, side: player === 0 ? 'experimental' : 'opponent', outcome, hitShip: outcome === 'ship' ? 1 : null, elapsed: outcome === null ? null : 1, decision };
}

describe('matched AI benchmark metrics', () => {
  it('validates both parameter grids and keeps the full default cross-product', () => {
    const defaults = parseArguments([]);
    expect(defaults.modes.length * defaults.formats.length * defaults.opponents.length * defaults.rates.length * defaults.startingKnowledge.length).toBe(162);
    expect(defaults.rates).toEqual([0.1, 0.35, 1]);
    expect(defaults.startingKnowledge).toEqual([0, 0.5, 1]);
    expect(defaults.rounds).toBe(5);
    expect(parseArguments(['--mode=horizon', '--format=3v3', '--opponent=hard', '--rate=0.35', '--starting-knowledge=0.5', '--pairs=1', '--rounds=2'])).toMatchObject({ rates: [0.35], startingKnowledge: [0.5] });
    expect(parseArguments(['--rates=0,1', '--knowledge=0,0.5,1'])).toMatchObject({ rates: [0, 1], startingKnowledge: [0, 0.5, 1] });
    for (const key of ['rates', 'knowledge']) {
      for (const value of ['-0.01', '1.01', 'NaN', 'Infinity', '0,0', '0,0.0', ',0.5', '0.5,', ' ']) {
        expect(() => parseArguments([`--${key}=${value}`]), `${key}=${value}`).toThrow();
      }
    }
    for (const args of [['--pairs=0'], ['--mode=unknown'], ['--mode=classic', '--modes=horizon'], ['--knowledge=0', '--starting-knowledge=1'], ['--knowledge']]) {
      expect(() => parseArguments(args)).toThrow();
    }
  });

  it('executes separate rate/knowledge cells on paired worlds and preserves both knobs in JSON', async () => {
    const options = parseArguments(['--mode=horizon', '--format=1v1', '--opponent=easy', '--rates=0,1', '--knowledge=0,1', '--pairs=1', '--rounds=1', '--seed=99540717']);
    const report = await runMatrix(options);
    expect(report.schemaVersion).toBe(3);
    expect(report.codeFingerprint).toMatchObject({ algorithm: 'sha256', digest: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(report.rules).toMatchObject({ shotTime: 60, bounce: false, fixedPower: false, visiblePlanets: true, classicTeamVolleys: true });
    expect(report.rows).toHaveLength(4);
    expect(report.records).toHaveLength(8);
    expect(new Set(report.rows.map(formatCell)).size).toBe(4);
    expect(report.rows.map((row) => [row.learningRate, row.startingKnowledge])).toEqual([[0, 0], [0, 1], [1, 0], [1, 1]]);
    expect(new Set(report.records.map((entry) => entry.seed)).size).toBe(1);
    const json = JSON.parse(JSON.stringify(report));
    expect(json.options).toMatchObject({ rates: [0, 1], startingKnowledge: [0, 1] });
    for (const row of report.rows) {
      const legs = report.records.filter((entry) => entry.learningRate === row.learningRate && entry.startingKnowledge === row.startingKnowledge);
      expect(legs.map((entry) => entry.leg)).toEqual([0, 1]);
      expect(row.summary.pairs.completed).toBe(1);
      expect(row.summary.pairs.winPoints.n).toBe(1);
      expect(row.summary.pairs.winPoints.ci95).not.toBeNull();
      for (const leg of legs) {
        expect(leg.status, leg.failure ?? 'match failed').toBe('completed');
        expect(leg.roundResults).toHaveLength(1);
        const own = leg.shots.filter((entry) => entry.side === 'experimental');
        expect(own.length).toBeGreaterThan(0);
        for (const entry of own) {
          const identity = { learningRate: row.learningRate, startingKnowledge: row.startingKnowledge };
          expect(entry.decision).toMatchObject(identity);
          expect(entry.decision!.details).toMatchObject(identity);
          expect(entry.observation).toMatchObject(identity);
          expect(entry.observation!.learnedShots).toBeLessThanOrEqual(entry.observation!.observedShots * row.learningRate);
          if (row.learningRate === 0) expect(entry.observation!.learnedShots).toBe(0);
        }
        const raw = json.records.find((entry: MatchRecord) => entry.learningRate === row.learningRate && entry.startingKnowledge === row.startingKnowledge && entry.leg === leg.leg);
        expect(raw).toMatchObject({ learningRate: row.learningRate, startingKnowledge: row.startingKnowledge, seed: leg.seed });
      }
    }
    for (const leg of [0, 1] as const) {
      const low = report.records.find((entry) => entry.leg === leg && entry.learningRate === 0 && entry.startingKnowledge === 0)!;
      const high = report.records.find((entry) => entry.leg === leg && entry.learningRate === 0 && entry.startingKnowledge === 1)!;
      const lowOpening = low.shots.find((entry) => entry.side === 'experimental')!;
      const highOpening = high.shots.find((entry) => entry.side === 'experimental')!;
      const lowDirection = aimDirection(lowOpening.launch!.angle);
      const highDirection = aimDirection(highOpening.launch!.angle);
      expect(lowOpening.launch!.x - lowDirection.x * PHYSICS.MUZZLE).toBeCloseTo(highOpening.launch!.x - highDirection.x * PHYSICS.MUZZLE, 8);
      expect(lowOpening.launch!.y - lowDirection.y * PHYSICS.MUZZLE).toBeCloseTo(highOpening.launch!.y - highDirection.y * PHYSICS.MUZZLE, 8);
      expect(lowOpening.observation!.predictionSamples).toBeGreaterThan(0);
      expect(highOpening.observation!.predictionSamples).toBeGreaterThan(0);
      expect(lowOpening.observation!.predictionRms).not.toBeCloseTo(highOpening.observation!.predictionRms!, 6);
    }
    expect(report.records.filter((entry) => entry.learningRate === 1).some((entry) => entry.shots.some((shot) => (shot.observation?.learnedShots ?? 0) > 0))).toBe(true);
  }, 300_000);

  it('rejects mixed cells instead of pooling paired outcomes across either parameter', () => {
    const baseline = record(0, 0, 100, 0);
    const swapped = record(0, 1, 0, 100);
    expect(summarizeCell([baseline, swapped]).pairs.completed).toBe(1);
    expect(() => summarizeCell([baseline, { ...swapped, startingKnowledge: 0 }])).toThrow('different matrix cells');
    expect(() => summarizeCell([baseline, { ...swapped, learningRate: 0 }])).toThrow('different matrix cells');
  });

  it('accounts for real authoritative shots across complete Horizon rounds', async () => {
    const options = parseArguments(['--mode=horizon', '--format=1v1', '--opponent=easy', '--rate=1', '--pairs=1', '--rounds=2', '--seed=99540717']);
    const result = await runLeg({ mode: 'horizon', format: '1v1', opponent: 'easy', learningRate: 1, startingKnowledge: 1 }, options, 0, 0);
    expect(result.status, result.failure ?? 'match failed').toBe('completed');
    expect(result.roundResults).toHaveLength(2);
    expect(result.shots.length).toBeGreaterThan(0);
    expect(new Set(result.shots.map((entry) => `${entry.round}/${entry.player}/${entry.shot}`)).size).toBe(result.shots.length);
    for (const round of result.roundResults) {
      const shots = result.shots.filter((entry) => entry.round === round.round);
      expect(round.shots).toBe(shots.length);
      expect(round.shotsByPlayer.reduce((sum, count) => sum + count, 0)).toBe(shots.length);
      expect(shots.every((entry) => entry.outcome !== null && entry.elapsed !== null)).toBe(true);
      expect(shots.some((entry) => entry.shot === 1)).toBe(true);
    }
    const experimental = result.shots.filter((entry) => entry.side === 'experimental');
    expect(experimental.every((entry) => entry.decision !== null)).toBe(true);
    expect(experimental.filter((entry) => entry.shot === 1).every((entry) => entry.decision!.observedShots === 0)).toBe(true);
    expect(experimental.every((entry) => entry.observation != null)).toBe(true);
    for (const round of result.roundResults) {
      const own = experimental.filter((entry) => entry.round === round.round);
      for (const entry of own) expect(entry.observation!.observedShots).toBe(entry.shot);
      const last = own.at(-1);
      if (last) expect(last.observation!.observedShots).toBe(own.length);
    }
    expect(result.shots.filter((entry) => entry.side === 'opponent').every((entry) => entry.observation === null)).toBe(true);
    const summary = summarizeCell([result]);
    expect(summary.shots.fired).toBe(result.roundResults.reduce((sum, round) => sum + round.shots, 0));
    expect(summary.shots.unfinished).toBe(0);
    expect(summary.experimental.observationCount).toBe(experimental.length);
    expect(summary.experimental.missingObservationCount).toBe(0);
    expect(summary.experimental.predictionRms.n + summary.experimental.predictionRms.missing).toBe(experimental.length);
  }, 120_000);

  it('distinguishes enemy, self, friendly, and unavailable hit attribution', () => {
    const leg = record(0, 0, 1000, 0);
    leg.shots = [shot(1, 0, 1, 'ship'), shot(1, 0, 2, 'ship'), shot(1, 0, 3, 'ship'), shot(1, 0, 4, 'lost')];
    leg.shots[0].hitRelation = 'enemy';
    leg.shots[1].hitRelation = 'self';
    leg.shots[2].hitRelation = 'friendly';
    expect(summarizeCell([leg]).experimental).toMatchObject({ shipHits: 3, enemyHits: 1, selfHits: 1, friendlyHits: 1, enemyHitRate: 0.25, hitRelationMissing: 0 });
    delete leg.shots[0].hitRelation;
    expect(summarizeCell([leg]).experimental).toMatchObject({ shipHits: 3, enemyHits: 0, enemyHitRate: null, hitRelationMissing: 1 });
  });

  it('attributes the final scoreboard to CPU ownership after a side swap', () => {
    expect(scoreOutcome([120, 900, -300, 700, 250, 200], new Set([0, 2, 4]))).toEqual({ experimentalScore: 70, opponentScore: 1800, winner: 'opponent' });
    expect(scoreOutcome([120, 900, -300, 700, 250, 200], new Set([1, 3, 5]))).toEqual({ experimentalScore: 1800, opponentScore: 70, winner: 'experimental' });
    expect(scoreOutcome([100, 100], new Set([1])).winner).toBe('draw');
  });

  it('uses independent pair clusters rather than correlated legs for score and win-point intervals', () => {
    const summary = summarizeCell([record(0, 0, 200, 0), record(0, 1, 0, 100), record(1, 0, 50, 0), record(1, 1, 0, 150)]);
    expect(summary.legs).toMatchObject({ wins: 2, losses: 2, draws: 0 });
    expect(summary.pairs.scoreDelta).toEqual(meanConfidenceInterval([100, -100]));
    expect(summary.pairs.scoreDelta.n).toBe(2);
    expect(summary.pairs.scoreDelta.ci95![1]).toBeCloseTo(1270.6205, 4);
    expect(summary.pairs.winPoints).toEqual(boundedMeanConfidenceInterval([0.5, 0.5]));
    expect(summary.pairs.winPoints.ci95).toEqual([0, 1]);
    expect(summary.pairs.scoreWinPoints).toEqual(boundedMeanConfidenceInterval([1, 0]));
    expect(summary.pairs.winRateCi95).toEqual(wilsonInterval(1, 2));
    expect(summary.sides.side0.wins).toBe(2);
    expect(summary.sides.side1.losses).toBe(2);
  });

  it('keeps all-loss and all-win uncertainty bounded and nonzero with pair-sized denominators', () => {
    const losses = Array.from({ length: 10 }, (_, pair) => [record(pair, 0, 0, 100), record(pair, 1, 0, 100)]).flat();
    const wins = Array.from({ length: 10 }, (_, pair) => [record(pair, 0, 100, 0), record(pair, 1, 100, 0)]).flat();
    const loss = summarizeCell(losses).pairs.winPoints;
    const win = summarizeCell(wins).pairs.winPoints;
    const half = Math.sqrt(Math.log(40) / 20);
    expect(loss).toEqual({ n: 10, mean: 0, ci95: [0, half] });
    expect(win).toEqual({ n: 10, mean: 1, ci95: [1 - half, 1] });
    expect(loss.ci95![1]).toBeGreaterThan(boundedMeanConfidenceInterval(Array(20).fill(0)).ci95![1]);
    expect(boundedMeanConfidenceInterval(Array(10).fill(0.5))).toEqual({ n: 10, mean: 0.5, ci95: [0.5 - half, 0.5 + half] });
    expect(boundedMeanConfidenceInterval([0, 1]).ci95).toEqual([0, 1]);
    expect(boundedMeanConfidenceInterval([])).toEqual({ n: 0, mean: null, ci95: null });
    expect(() => boundedMeanConfidenceInterval([-0.1])).toThrow();
    expect(() => boundedMeanConfidenceInterval([1.1])).toThrow();
    expect(() => boundedMeanConfidenceInterval([Number.NaN])).toThrow();
  });

  it('separates average leg outcomes from combined final-score pair outcomes', () => {
    const summary = summarizeCell([record(0, 0, 1000, 0), record(0, 1, 0, 10)]);
    expect(summary.pairs.winPoints.mean).toBe(0.5);
    expect(summary.pairs.scoreWinPoints.mean).toBe(1);
    expect(summary.pairs).toMatchObject({ wins: 1, losses: 0, draws: 0, winRate: 1 });
  });

  it('does not report missing or failed pairs as draws or independent complete samples', () => {
    const failed = record(1, 1, 500, 0);
    failed.status = 'failed';
    failed.winner = null;
    failed.failure = 'unfinished match';
    const summary = summarizeCell([record(0, 0, 100, 100), record(0, 1, 100, 100), record(1, 0, 100, 0), failed, record(2, 0, 100, 0)]);
    expect(summary.legs).toMatchObject({ attempted: 5, completed: 4, failed: 1, draws: 2 });
    expect(summary.pairs).toMatchObject({ attempted: 3, completed: 1, failed: 2, draws: 1 });
    expect(summary.pairs.scoreDelta).toEqual({ n: 1, mean: 0, ci95: null });
    expect(summary.pairs.winPoints).toEqual({ n: 1, mean: 0.5, ci95: [0, 1] });
  });

  it('preserves zero metrics while reporting absent metrics and empty intervals as unavailable', () => {
    expect(distribution([null, 0, 10, Number.NaN])).toMatchObject({ n: 2, missing: 2, mean: 5, p50: 5, min: 0, max: 10 });
    expect(distribution([null])).toEqual({ n: 0, missing: 1, mean: null, p50: null, p90: null, p95: null, min: null, max: null });
    expect(meanConfidenceInterval([])).toEqual({ n: 0, mean: null, ci95: null });
    expect(meanConfidenceInterval([0])).toEqual({ n: 1, mean: 0, ci95: null });
    expect(wilsonInterval(0, 0)).toBeNull();
    expect(wilsonInterval(0, 10)![1]).toBeCloseTo(0.2775328, 6);
    expect(() => wilsonInterval(11, 10)).toThrow();
  });

  it('counts all rounds, resets shot-stage indices each round, and separates hits from kills', () => {
    const leg = record(0, 0, 1000, 0);
    const diagnostic: DecisionRecord = { kind: 'attack', learningRate: 1, startingKnowledge: 1, observedShots: 0, learnedShots: 0, retainedShots: 0, samples: 0, predictionRms: 0, predictionSamples: 20, fitMs: 0, relativeGravityMapRms: null };
    leg.shots = [shot(1, 0, 1, 'ship', diagnostic), shot(1, 1, 1, 'lost'), shot(1, 0, 2, 'planet'), shot(2, 0, 1, 'lost'), shot(2, 1, 1, 'ship'), shot(2, 0, 2, null), shot(2, 0, 3, 'timeout')];
    leg.shots[0].observation = { learningRate: 1, startingKnowledge: 1, observedShots: 1, learnedShots: 1, retainedShots: 1, samples: 20, predictionRms: 0, predictionSamples: 20, fitMs: 0 };
    leg.roundResults = [1, 2].map((round) => ({ round, shots: round === 1 ? 3 : 4, shotsByPlayer: round === 1 ? [2, 1] : [3, 1], scores: [1000, 0], survivor: 1, winningTeam: null, title: 'hit' }));
    leg.kills = [
      { killer: 0, victim: 1, points: 1000, self: false, friendly: false, combo: [], multiplier: 1, shots: 1, power: 50, at: 1 },
      { killer: 0, victim: 0, points: -300, self: true, friendly: false, combo: [], multiplier: 1, shots: 2, power: 50, at: 2 },
      { killer: 0, victim: 2, points: -300, self: false, friendly: true, combo: [], multiplier: 1, shots: 3, power: 50, at: 3 },
      { killer: null, victim: 1, points: 0, self: false, friendly: false, combo: [], multiplier: 1, shots: 0, power: 0, at: 4 },
    ];
    const summary = summarizeCell([leg]);
    expect(summary.legs.wins).toBe(1); // Final score wins despite the recorded survivor being the opponent.
    expect(summary.shots).toMatchObject({ fired: 7, completed: 6, unfinished: 1 });
    expect(summary.shots.perRound).toMatchObject({ n: 2, mean: 3.5 });
    expect(summary.experimental).toMatchObject({ fired: 5, completed: 4, unfinished: 1, shipHits: 1, shipHitRate: 0.25, offensiveKills: 1, shotsPerKill: 5, decisionCount: 1, missingDecisionCount: 4 });
    expect(summary.kills).toMatchObject({ experimentalOffensive: 1, experimentalSelf: 1, experimentalFriendly: 1, swallowed: 1 });
    expect(summary.stages['1'].fired).toBe(2);
    expect(summary.stages['2'].fired).toBe(2);
    expect(summary.stages['3+'].fired).toBe(1);
    expect(summary.experimental.predictionRms).toMatchObject({ n: 1, missing: 3, mean: 0 });
    expect(summary.experimental.observationFitMs).toMatchObject({ n: 1, missing: 3, mean: 0 });
    expect(summary.experimental.relativeGravityMapRms).toMatchObject({ n: 0, missing: 5, mean: null });
  });

  it('uses completed-shot diagnostics including the final shot, not stale next-launch predictions', () => {
    const leg = record(0, 0, 0, 100);
    const launch: DecisionRecord = { kind: 'attack', learningRate: 1, startingKnowledge: 1, observedShots: 1, learnedShots: 1, retainedShots: 1, samples: 10, predictionRms: 999, predictionSamples: 10, fitMs: 0, relativeGravityMapRms: 0 };
    leg.shots = [shot(1, 0, 1, 'lost', launch), shot(1, 0, 2, 'ship'), shot(1, 0, 3, null), shot(1, 0, 4, 'planet')];
    leg.shots[0].observation = { learningRate: 1, startingKnowledge: 1, observedShots: 1, learnedShots: 0, retainedShots: 0, samples: 0, predictionRms: null, predictionSamples: 0, fitMs: 0 };
    leg.shots[1].elapsed = 0;
    leg.shots[1].observation = { learningRate: 1, startingKnowledge: 1, observedShots: 2, learnedShots: 1, retainedShots: 1, samples: 20, predictionRms: 0, predictionSamples: 20, fitMs: 0 };
    leg.shots[3].elapsed = null;
    const stats = summarizeCell([leg]).experimental;
    expect(stats).toMatchObject({ completed: 3, unfinished: 1, observationCount: 2, missingObservationCount: 1 });
    expect(stats.predictionRms).toMatchObject({ n: 1, missing: 2, mean: 0, p50: 0, p95: 0 });
    expect(stats.predictionSamples).toMatchObject({ n: 2, missing: 1, mean: 10, min: 0 });
    expect(stats.learnedShots).toMatchObject({ n: 2, missing: 1, mean: 0.5, min: 0 });
    expect(stats.fitMs).toMatchObject({ n: 1, missing: 3, mean: 0 });
    expect(stats.elapsed).toMatchObject({ n: 2, missing: 1, mean: 0.5, p50: 0.5, p95: 0.95 });
    expect(stats.outcomeElapsed.ship).toMatchObject({ n: 1, missing: 0, mean: 0 });
    expect(stats.outcomeElapsed.planet).toMatchObject({ n: 0, missing: 1, mean: null, p50: null, p95: null });
  });
});
