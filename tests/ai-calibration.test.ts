import { describe, expect, it, vi } from 'vitest';
import { calibrate, parseArguments, printReport, validateMatrix, type CalibrationInput } from '../benchmarks/ai-calibration';
import { summarizeCell, type MatchRecord, type Opponent } from '../benchmarks/ai-metrics';
import { experimentalLearnerFit } from '../src/experimental-ai';
import { trainLearner, validationWorld, visibleWorld } from '../benchmarks/learning-validation';

function matrix(seed = 100, pairs = 10, rates = [0, 0.2, 0.6, 1], opponents: Opponent[] = ['easy', 'medium', 'hard'], startingKnowledge = [1]): CalibrationInput {
  return {
    schemaVersion: 3,
    codeFingerprint: { algorithm: 'sha256', digest: 'a'.repeat(64), sources: ['src/ai-learning.ts'] },
    options: { modes: ['classic'], formats: ['1v1'], opponents, rates, startingKnowledge, pairs, rounds: 1, seed, deterministicCpu: true, json: null },
    rules: { shotTime: 60, bounce: false, fixedPower: false, visiblePlanets: true, fixedSeatTeams: [0, 1, 0, 1, 0, 1], classicTeamVolleys: true },
    records: [], rows: [],
  };
}
function addCell(report: CalibrationInput, opponent: Opponent, learningRate: number, points: number, final = true, format: '1v1' | '2v2' | '3v3' = '1v1', startingKnowledge = 1): void {
  const cell = { mode: 'classic' as const, format, opponent, learningRate, startingKnowledge };
  const records: MatchRecord[] = [];
  // Choose whole-leg wins, so requested multiples of 1/(2*pairs) are exact.
  for (let pair = 0; pair < report.options.pairs; pair++) for (const leg of [0, 1] as const) {
    const won = pair * 2 + leg < Math.round(points * report.options.pairs * 2);
    records.push({ ...cell, pair, leg, seed: report.options.seed * 1000 + pair, rounds: 1, status: 'completed', failure: null,
      experimentalScore: won ? 100 : 0, opponentScore: won ? 0 : 100, winner: won ? 'experimental' : 'opponent',
      shots: [], kills: [], roundResults: [{ round: 1, shots: 0, shotsByPlayer: [0, 0], scores: [won ? 100 : 0, won ? 0 : 100], survivor: null, winningTeam: null, title: 'noneLeft' }], updates: 1 });
  }
  report.records.push(...records);
  if (final) report.rows.push({ ...cell, summary: summarizeCell(records) });
}
function complete(report: CalibrationInput, points = 0.5): CalibrationInput {
  for (const opponent of report.options.opponents) for (const rate of report.options.rates) for (const knowledge of report.options.startingKnowledge) addCell(report, opponent, rate, points, true, '1v1', knowledge);
  return report;
}

// Importing the module above must not inspect argv, read matrix paths, or run matches.
describe('matrix calibration', () => {
  it('parses multiple inputs and protects raw evidence from output overwrite', () => {
    expect(parseArguments(['one.json', 'two.json', '--json=out.json'])).toEqual({ paths: ['one.json', 'two.json'], json: 'out.json' });
    expect(parseArguments(['one.json', '--json', 'out.json'])).toEqual({ paths: ['one.json'], json: 'out.json' });
    for (const args of [[], ['--seed=1'], ['one.json', '--json'], ['one.json', 'one.json'], ['one.json', '--json=one.json']]) expect(() => parseArguments(args)).toThrow();
  });

  it('rejects historical schemas and incompatible rules rather than inventing evidence or parameter identity', () => {
    expect(() => validateMatrix({ schemaVersion: 1 })).toThrow(/schemaVersion 3.*neither is normalized/);
    expect(() => validateMatrix({ schemaVersion: 2 })).toThrow(/historical schema 2 lacks startingKnowledge parameter identity/);
    const report = complete(matrix()); report.rules.shotTime = 30 as 60;
    expect(() => validateMatrix(report)).toThrow(/incompatible rule shotTime/);
    const missing = complete(matrix());
    missing.records[0].shots.push({ round: 1, player: 1, shot: 1, side: 'opponent', outcome: undefined as unknown as null, hitShip: null, elapsed: 1, decision: null });
    expect(() => validateMatrix(missing)).toThrow(/authoritative shot outcome/);
  });

  it('calibrates real fractional-rate observations and rejects malformed evidence diagnostics', () => {
    const world = validationWorld();
    const rate = 0.35;
    const fit = experimentalLearnerFit(trainLearner(world, rate, 2), visibleWorld(world));
    const report = complete(matrix(100, 1, [rate], ['easy']));
    report.records[0].shots.push({ round: 1, player: 0, shot: 1, side: 'experimental', outcome: 'lost', hitShip: null, elapsed: 1,
      decision: { kind: 'exploit', learningRate: rate, startingKnowledge: fit.startingKnowledge, observedShots: fit.observedShots, learnedShots: fit.learnedShots, retainedShots: fit.retainedShots,
        samples: fit.samples, predictionRms: fit.predictionRms, predictionSamples: fit.predictionSamples, fitMs: fit.fitMs, relativeGravityMapRms: null },
      observation: { learningRate: rate, startingKnowledge: fit.startingKnowledge, observedShots: fit.observedShots, learnedShots: fit.learnedShots, retainedShots: fit.retainedShots,
        samples: fit.samples, predictionRms: fit.predictionRms, predictionSamples: fit.predictionSamples, fitMs: fit.fitMs },
    });
    report.records[0].roundResults[0].shots = 1;
    report.records[0].roundResults[0].shotsByPlayer = [1, 0];
    expect(report.records[0].shots[0].observation!.learnedShots).toBeCloseTo(0.7, 12);
    expect(validateMatrix(report)).toBe(report);
    const result = calibrate([{ path: 'fractional-rate.json', report }]);
    expect(result.groups[0].cells[0].summary.experimental.learnedShots.mean).toBeCloseTo(0.7, 12);
    expect(result.groups[0].recommendations.find((entry) => entry.opponent === 'easy' && entry.scope === 'level')).toMatchObject({ selectedSetting: { learningRate: rate, startingKnowledge: 1 }, status: 'exploratory' });
    for (const evidence of ['decision', 'observation'] as const) {
      for (const learnedShots of [-0.1, fit.observedShots + 0.1]) {
        const invalid = structuredClone(report);
        invalid.records[0].shots[0][evidence]!.learnedShots = learnedShots;
        expect(() => validateMatrix(invalid)).toThrow(/learned evidence outside observed history/);
      }
      for (const learnedShots of [null, NaN, Infinity]) {
        const invalid = structuredClone(report);
        invalid.records[0].shots[0][evidence]!.learnedShots = learnedShots as number;
        expect(() => validateMatrix(invalid)).toThrow(new RegExp(`${evidence} learnedShots: expected finite number`));
      }
      const invalid = structuredClone(report);
      invalid.records[0].shots[0][evidence]!.startingKnowledge = 0;
      expect(() => validateMatrix(invalid)).toThrow(/setting mismatch/);
      const wrongRate = structuredClone(report);
      wrongRate.records[0].shots[0][evidence]!.learningRate = 1;
      expect(() => validateMatrix(wrongRate)).toThrow(/setting mismatch/);
    }
    for (const field of ['observedShots', 'retainedShots', 'samples', 'predictionSamples'] as const) {
      for (const value of [-1, 0.5, null, NaN, Infinity]) {
        const invalid = structuredClone(report);
        invalid.records[0].shots[0].observation![field] = value as number;
        expect(() => validateMatrix(invalid)).toThrow(new RegExp(`observation ${field}:`));
      }
    }
    for (const fitMs of [null, NaN, Infinity]) {
      const invalid = structuredClone(report);
      invalid.records[0].shots[0].observation!.fitMs = fitMs as number;
      expect(() => validateMatrix(invalid)).toThrow(/observation fitMs: expected finite number/);
    }
    const missingPrediction = structuredClone(report);
    missingPrediction.records[0].shots[0].observation!.predictionRms = null;
    expect(validateMatrix(missingPrediction)).toBe(missingPrediction);
    for (const predictionRms of [undefined, NaN, Infinity]) {
      const invalid = structuredClone(report);
      invalid.records[0].shots[0].observation!.predictionRms = predictionRms as number;
      expect(() => validateMatrix(invalid)).toThrow(/observation predictionRms: expected finite number/);
    }
  });

  it('maps distinct rates empirically to each existing level without selecting a universal rate', () => {
    const report = matrix();
    const outcomes = { easy: [0.5, 0.7, 0.8, 0.9], medium: [0.2, 0.5, 0.7, 0.8], hard: [0.1, 0.2, 0.5, 0.7] };
    for (const opponent of report.options.opponents) report.options.rates.forEach((rate, index) => addCell(report, opponent, rate, outcomes[opponent][index]));
    const group = calibrate([{ path: 'realistic.json', report }]).groups[0];
    expect(group.recommendations.filter((entry) => entry.scope === 'level').map((entry) => [entry.opponent, entry.selectedSetting, entry.status])).toEqual([
      ['easy', { learningRate: 0, startingKnowledge: 1 }, 'exploratory'], ['medium', { learningRate: 0.2, startingKnowledge: 1 }, 'exploratory'], ['hard', { learningRate: 0.6, startingKnowledge: 1 }, 'exploratory'],
    ]);
    const balanced = group.opponentBalanced.find((entry) => entry.learningRate === 0.2)!;
    expect(balanced.winPoints.n).toBe(10); // not 30 opponents or 40 rate repetitions
    expect(balanced.worstCell?.key).toContain('/hard/');
  });

  it('separates cross-format level presets from optional cell tuning and blocks partial level evidence', () => {
    const report = matrix(100, 10, [0, 0.2], ['easy']);
    report.options.formats = ['1v1', '3v3'];
    addCell(report, 'easy', 0, 0.5);
    addCell(report, 'easy', 0.2, 0.7);
    addCell(report, 'easy', 0, 0.2, true, '3v3');
    addCell(report, 'easy', 0.2, 0.5, true, '3v3');
    const group = calibrate([{ path: 'formats.json', report }]).groups[0];
    expect(group.recommendations.find((entry) => entry.opponent === 'easy' && entry.scope === 'level')).toMatchObject({ selectedSetting: { learningRate: 0.2, startingKnowledge: 1 }, status: 'outside-target' });
    expect(group.recommendations.filter((entry) => entry.opponent === 'easy' && entry.scope === 'cell').map((entry) => [entry.format, entry.selectedSetting, entry.status])).toEqual([
      ['1v1', { learningRate: 0, startingKnowledge: 1 }, 'exploratory'], ['3v3', { learningRate: 0.2, startingKnowledge: 1 }, 'exploratory'],
    ]);
    report.rows = report.rows.filter((row) => row.format !== '3v3');
    const partial = calibrate([{ path: 'formats-partial.json', report }]).groups[0];
    expect(partial.recommendations.find((entry) => entry.opponent === 'easy' && entry.scope === 'level')).toMatchObject({ selectedSetting: null, status: 'unmatched' });
    expect(partial.recommendations.find((entry) => entry.opponent === 'easy' && entry.scope === 'cell' && entry.format === '1v1')?.selectedSetting).toEqual({ learningRate: 0, startingKnowledge: 1 });
  });

  it('prints measured rows and compact presets while retaining unstarted cells in JSON', () => {
    const report = matrix(100, 2, [0, 1]);
    addCell(report, 'easy', 0, 0.5);
    addCell(report, 'easy', 1, 0.5, false);
    const result = calibrate([{ path: 'partial.json', report }]);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const table = vi.spyOn(console, 'table').mockImplementation(() => {});
    try {
      printReport(result);
      expect(table).toHaveBeenCalledTimes(2);
      expect(table.mock.calls[0][0]).toEqual(expect.arrayContaining([expect.objectContaining({ state: 'complete', pairs: '2/2' }), expect.objectContaining({ state: 'partial', pairs: '2/2' })]));
      expect((table.mock.calls[0][0] as unknown[])).toHaveLength(2);
      expect(log.mock.calls.some(([message]) => String(message).includes('4 unstarted'))).toBe(true);
      expect(result.groups[0].cells).toHaveLength(6);
      expect(result.groups[0].recommendations).toHaveLength(6);
    } finally {
      log.mockRestore(); table.mockRestore();
    }
  });

  it('chooses deterministic numeric tie break and never turns ten pairs into parity', () => {
    const group = calibrate([{ path: 'all-ties.json', report: complete(matrix()) }]).groups[0];
    expect(group.recommendations.every((entry) => entry.selectedSetting?.learningRate === 0 && entry.selectedSetting.startingKnowledge === 1 && entry.status === 'exploratory')).toBe(true);
    expect(group.pairedSettingDeltas.every((entry) => entry.matchedPairs === 10 && entry.winPointDelta.mean === 0)).toBe(true);
    expect(group.cells.every((entry) => entry.summary.pairs.winPoints.n === 10)).toBe(true);
  });

  it('marks raw-record cells without final rows incomplete and excludes them from recommendations', () => {
    const report = complete(matrix(100, 10, [0, 1]));
    report.rows = report.rows.filter((row) => !(row.opponent === 'hard' && row.learningRate === 0));
    const group = calibrate([{ path: 'partial.json', report }]).groups[0];
    const cell = group.cells.find((entry) => entry.opponent === 'hard' && entry.learningRate === 0)!;
    expect(cell).toMatchObject({ incomplete: true, finalRowPresent: false, missingLegs: 0 });
    expect(cell.summary.pairs.completed).toBe(10);
    expect(group.recommendations.find((entry) => entry.opponent === 'hard')?.selectedSetting).toEqual({ learningRate: 1, startingKnowledge: 1 });
    expect(group.recommendations.find((entry) => entry.opponent === 'hard')?.candidates[0].incompleteCells).toEqual([cell.key]);
  });

  it('reports missing cells, unmatched legs, and failures instead of narrowing acceptance', () => {
    const report = matrix(100, 2, [0, 1]);
    addCell(report, 'easy', 0, 0.5);
    addCell(report, 'easy', 1, 0.5, false);
    report.records.pop();
    const failed = report.records.find((record) => record.learningRate === 1 && record.pair === 0 && record.leg === 1)!;
    failed.status = 'failed'; failed.failure = 'simulation limit'; failed.winner = null;
    const group = calibrate([{ path: 'interrupted.json', report }]).groups[0];
    const cell = group.cells.find((entry) => entry.opponent === 'easy' && entry.learningRate === 1)!;
    expect(cell).toMatchObject({ missingLegs: 1, incomplete: true, finalRowPresent: false });
    expect(cell.unmatchedPairs).toHaveLength(2);
    expect(cell.failures).toEqual([{ pair: 0, leg: 1, reason: 'simulation limit' }]);
    expect(cell.summary.pairs.completed).toBe(0);
    expect(group.pairedSettingDeltas.find((entry) => entry.cell === 'classic/1v1/easy')).toMatchObject({ matchedPairs: 0, unmatchedBaselinePairs: ['100000/classic/1v1/0', '100001/classic/1v1/1'] });
    expect(group.recommendations.find((entry) => entry.opponent === 'medium')?.status).toBe('unmatched');
    expect(group.recommendations.filter((entry) => entry.opponent !== 'easy').every((entry) => entry.selectedSetting === null)).toBe(true);
  });

  it('keeps seeds separate and requires independent same-setting known-code confirmation at the exact 50 boundary', () => {
    const report = complete(matrix(100, 50, [0]));
    expect(calibrate([{ path: 'first.json', report }]).groups[0].recommendations[0].status).toBe('confirmation-required');
    const confirmation = complete(matrix(200, 50, [0]));
    const result = calibrate([{ path: 'first.json', report }, { path: 'confirm.json', report: confirmation }]);
    expect(result.groups).toHaveLength(2);
    expect(result.groups.every((group) => group.cells.every((cell) => cell.summary.pairs.completed === 50))).toBe(true);
    expect(result.groups.every((group) => group.recommendations.every((entry) => entry.status === 'confirmed-target'))).toBe(true);
    const below = complete(matrix(300, 49, [0]));
    expect(calibrate([{ path: 'first.json', report }, { path: 'below.json', report: below }]).groups.find((group) => group.seed === 100)?.recommendations[0].status).toBe('confirmation-required');
    const wrongRate = complete(matrix(400, 50, [1]));
    expect(calibrate([{ path: 'first.json', report }, { path: 'wrong-rate.json', report: wrongRate }]).groups.find((group) => group.seed === 100)?.recommendations[0].status).toBe('confirmation-required');
    const wrongKnowledge = complete(matrix(500, 50, [0], ['easy', 'medium', 'hard'], [0]));
    expect(calibrate([{ path: 'first.json', report }, { path: 'wrong-knowledge.json', report: wrongKnowledge }]).groups.find((group) => group.seed === 100)?.recommendations[0].status).toBe('confirmation-required');
  });

  it('does not let a single-format confirmation certify a cross-format level preset', () => {
    const first = matrix(100, 50, [0], ['easy']);
    first.options.formats = ['1v1', '3v3'];
    addCell(first, 'easy', 0, 0.5);
    addCell(first, 'easy', 0, 0.5, true, '3v3');
    const narrow = complete(matrix(200, 50, [0], ['easy']));
    const group = calibrate([{ path: 'full.json', report: first }, { path: 'narrow.json', report: narrow }]).groups.find((entry) => entry.seed === 100)!;
    expect(group.recommendations.find((entry) => entry.opponent === 'easy' && entry.scope === 'level')?.status).toBe('confirmation-required');
    expect(group.recommendations.find((entry) => entry.opponent === 'easy' && entry.scope === 'cell' && entry.format === '1v1')?.status).toBe('confirmed-target');
    expect(group.recommendations.find((entry) => entry.opponent === 'easy' && entry.scope === 'cell' && entry.format === '3v3')?.status).toBe('confirmation-required');
  });

  it('does not confirm reused worlds, nondeterministic runs, unknown labels or mixed code', () => {
    const first = complete(matrix(100, 50, [0]));
    const reused = structuredClone(first); reused.options.seed = 200;
    expect(calibrate([{ path: 'first.json', report: first }, { path: 'reused.json', report: reused }]).groups.every((group) => group.recommendations[0].status === 'confirmation-required')).toBe(true);
    const unknown = complete(matrix(200, 50, [0])); delete unknown.codeFingerprint;
    expect(calibrate([{ path: 'unknown.json', report: unknown }]).groups[0].recommendations[0].status).toBe('exploratory');
    const nondeterministic = complete(matrix(300, 50, [0])); nondeterministic.options.deterministicCpu = false;
    expect(calibrate([{ path: 'nondeterministic.json', report: nondeterministic }]).groups[0].recommendations[0].status).toBe('exploratory');
    const other = complete(matrix(400, 50, [0])); other.codeFingerprint = { algorithm: 'sha256', digest: 'b'.repeat(64), sources: ['src/ai-learning.ts'] };
    const result = calibrate([{ path: 'first.json', report: first }, { path: 'other.json', report: other }]);
    expect(result.groups.every((group) => group.recommendations.every((entry) => entry.selectedSetting === null && entry.status === 'mixed-code-blocked'))).toBe(true);
  });

  it('rejects duplicate snapshots and inconsistent shared world seeds', () => {
    const report = complete(matrix());
    expect(() => calibrate([{ path: 'one.json', report }, { path: 'copy.json', report }])).toThrow(/overlapping raw legs/);
    const wrongSeed = structuredClone(report); wrongSeed.records[1].seed++;
    expect(() => calibrate([{ path: 'bad.json', report: wrongSeed }])).toThrow(/inconsistent world seed/);
  });

  it('preserves completed-shot prediction and missing observation denominators', () => {
    const report = complete(matrix(100, 1, [0], ['easy']));
    const record = report.records[0];
    const decision = { kind: 'exploit', learningRate: 0, startingKnowledge: 1, observedShots: 0, learnedShots: 0, retainedShots: 0, samples: 0, predictionRms: null, predictionSamples: 0, fitMs: 0, relativeGravityMapRms: null };
    record.shots = [
      { round: 1, player: 0, shot: 1, side: 'experimental', outcome: 'lost', hitShip: null, elapsed: 1, decision, observation: { learningRate: 0, startingKnowledge: 1, observedShots: 1, learnedShots: 0, retainedShots: 0, samples: 0, predictionRms: 12, predictionSamples: 1, fitMs: 0 } },
      { round: 1, player: 0, shot: 2, side: 'experimental', outcome: 'hole', hitShip: null, elapsed: 2, decision, observation: null },
    ];
    record.roundResults[0].shots = 2; record.roundResults[0].shotsByPlayer = [2, 0];
    const group = calibrate([{ path: 'shots.json', report }]).groups[0];
    expect(group.cells[0].summary.experimental).toMatchObject({ fired: 2, completed: 2, observationCount: 1, missingObservationCount: 1, predictionRms: { n: 1, missing: 1, mean: 12 } });
    expect(group.opponentBalanced[0].missingOpponents).toEqual(['medium', 'hard']);
    expect(group.opponentBalanced[0].winPoints.n).toBe(0);
  });

  it('keeps knowledge cells separate and compares settings only on matched worlds', () => {
    const report = matrix(100, 10, [0.35], ['easy', 'medium', 'hard'], [0, 1]);
    for (const opponent of report.options.opponents) {
      addCell(report, opponent, 0.35, 0.5, true, '1v1', 0);
      addCell(report, opponent, 0.35, 0.9, true, '1v1', 1);
    }
    const group = calibrate([{ path: 'knowledge.json', report }]).groups[0];
    expect(group.cells).toHaveLength(6);
    expect(group.cells.every((cell) => cell.summary.pairs.winPoints.n === 10)).toBe(true);
    expect(group.opponentBalanced).toHaveLength(2);
    expect(group.opponentBalanced.every((aggregate) => aggregate.winPoints.n === 10)).toBe(true);
    expect(group.recommendations.every((entry) => entry.selectedSetting?.startingKnowledge === 0)).toBe(true);
    expect(group.pairedSettingDeltas).toHaveLength(3);
    for (const delta of group.pairedSettingDeltas) {
      expect(delta).toMatchObject({ baseline: { learningRate: 0.35, startingKnowledge: 0 }, setting: { learningRate: 0.35, startingKnowledge: 1 }, matchedPairs: 10 });
      expect(delta.winPointDelta.mean).toBeCloseTo(0.4);
    }
    const missingKnowledge = structuredClone(report);
    delete (missingKnowledge.records[0] as Partial<MatchRecord>).startingKnowledge;
    expect(() => validateMatrix(missingKnowledge)).toThrow(/startingKnowledge outside declared matrix options/);
    const inconsistent = structuredClone(report);
    inconsistent.records.find((record) => record.startingKnowledge === 1)!.seed++;
    expect(() => calibrate([{ path: 'inconsistent.json', report: inconsistent }])).toThrow(/inconsistent world seed/);
  });
});
