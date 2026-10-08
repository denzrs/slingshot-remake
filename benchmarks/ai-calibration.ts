import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { boundedMeanConfidenceInterval, meanConfidenceInterval, summarizeCell, type CellSummary, type MatchRecord, type MeanEstimate, type Opponent } from './ai-metrics';
import type { MatrixCell, MatrixReport } from './ai-matrix';

interface Fingerprint { algorithm: 'sha256'; digest: string; sources: readonly string[] }
export type CalibrationInput = Omit<MatrixReport, 'codeFingerprint'> & { codeFingerprint?: Fingerprint | null };
interface CalibrationOptions { paths: string[]; json: string | null }
interface CalibrationCell extends MatrixCell {
  key: string;
  expectedPairs: number;
  missingLegs: number;
  unmatchedPairs: string[];
  finalRowPresent: boolean;
  incomplete: boolean;
  failures: { pair: number; leg: number; reason: string | null }[];
  targetDistance: number | null;
  summary: CellSummary;
}
interface Aggregate {
  startingKnowledge: number;
  learningRate: number;
  mode: string;
  format: string;
  opponents: Opponent[];
  missingOpponents: Opponent[];
  winPoints: MeanEstimate;
  worstCell: { key: string; mean: number; targetDistance: number } | null;
  complete: boolean;
  unmatchedWorlds: { opponent: Opponent; keys: string[] }[];
}
interface Candidate {
  startingKnowledge: number;
  learningRate: number;
  opponentBalancedMean: number | null;
  targetDistance: number | null;
  worstCellDistance: number | null;
  worstCell: string | null;
  minimumPairs: number;
  missingCells: string[];
  incompleteCells: string[];
  eligible: boolean;
  allCellsInTarget: boolean;
}
interface Recommendation {
  opponent: Opponent;
  scope: 'level' | 'cell';
  mode?: string;
  format?: string;
  candidates: Candidate[];
  selectedSetting: { learningRate: number; startingKnowledge: number } | null;
  status: 'unmatched' | 'exploratory' | 'outside-target' | 'confirmation-required' | 'confirmed-target' | 'mixed-code-blocked';
  confirmationSeeds: number[];
}
interface CalibrationGroup {
  id: string;
  codeFingerprint: Fingerprint | null;
  seed: number;
  rounds: number;
  deterministicCpu: boolean;
  paths: string[];
  cells: CalibrationCell[];
  opponentBalanced: Aggregate[];
  pairedSettingDeltas: { cell: string; baseline: { learningRate: number; startingKnowledge: number }; setting: { learningRate: number; startingKnowledge: number }; matchedPairs: number; unmatchedBaselinePairs: string[]; unmatchedCandidatePairs: string[]; winPointDelta: MeanEstimate; scoreDelta: MeanEstimate }[];
  recommendations: Recommendation[];
}
interface CalibrationReport {
  schemaVersion: 1;
  target: [number, number];
  minimumConfirmationPairs: 50;
  notes: string[];
  groups: CalibrationGroup[];
}
const MODES = ['classic', 'horizon'];
const FORMATS = ['1v1', '2v2', '3v3'];
const OPPONENTS: Opponent[] = ['easy', 'medium', 'hard'];
const RULES = { shotTime: 60, bounce: false, fixedPower: false, visiblePlanets: true, fixedSeatTeams: [0, 1, 0, 1, 0, 1], classicTeamVolleys: true };
const cellKey = (cell: MatrixCell) => `${cell.mode}/${cell.format}/${cell.opponent}/rate=${cell.learningRate}/knowledge=${cell.startingKnowledge}`;
const worldKey = (record: MatchRecord) => `${record.seed}/${record.mode}/${record.format}/${record.pair}`;
const distance = (value: number) => Math.max(0, 0.4 - value, value - 0.6);
const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
function object(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${context}: expected object`);
  return value as Record<string, unknown>;
}
function finite(value: unknown, context: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${context}: expected finite number`);
}
function integer(value: unknown, context: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): asserts value is number {
  finite(value, context);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`${context}: invalid integer`);
}
function choices(value: unknown, allowed: readonly (string | number)[], context: string): asserts value is (string | number)[] {
  if (!Array.isArray(value) || !value.length || value.some((entry) => !allowed.includes(entry)) || new Set(value).size !== value.length) throw new Error(`${context}: invalid or duplicate choices`);
}

/** Historical schemas cannot recover missing evidence or parameter identity by guessing. */
export function validateMatrix(value: unknown, path = 'matrix'): CalibrationInput {
  const report = object(value, path);
  if (report.schemaVersion !== 3) throw new Error(`${path}: requires matrix schemaVersion 3; historical schema 2 lacks startingKnowledge parameter identity, schema 1 lacks authoritative outcomes; neither is normalized`);
  const options = object(report.options, `${path}.options`);
  choices(options.modes, MODES, 'modes'); choices(options.formats, FORMATS, 'formats'); choices(options.opponents, OPPONENTS, 'opponents');
  if (!Array.isArray(options.rates) || !options.rates.length || new Set(options.rates).size !== options.rates.length) throw new Error(`${path}: invalid rates`);
  for (const rate of options.rates) { finite(rate, 'rate'); if (rate < 0 || rate > 1) throw new Error(`${path}: rate outside [0,1]`); }
  if (!Array.isArray(options.startingKnowledge) || !options.startingKnowledge.length || new Set(options.startingKnowledge).size !== options.startingKnowledge.length) throw new Error(`${path}: invalid startingKnowledge`);
  for (const knowledge of options.startingKnowledge) { finite(knowledge, 'startingKnowledge'); if (knowledge < 0 || knowledge > 1) throw new Error(`${path}: startingKnowledge outside [0,1]`); }
  integer(options.pairs, 'pairs', 1, 10000); integer(options.rounds, 'rounds', 1, 100); integer(options.seed, 'seed', 0, 0xffffffff);
  if (typeof options.deterministicCpu !== 'boolean') throw new Error(`${path}: deterministicCpu must be boolean`);
  const rules = object(report.rules, `${path}.rules`);
  for (const [key, expected] of Object.entries(RULES)) if (JSON.stringify(rules[key]) !== JSON.stringify(expected)) throw new Error(`${path}: incompatible rule ${key}`);
  const unknownRules = Object.keys(rules).filter((key) => !Object.hasOwn(RULES, key));
  if (unknownRules.length) throw new Error(`${path}: unsupported rules ${unknownRules.join(',')}`);
  if (report.codeFingerprint != null) {
    const fingerprint = object(report.codeFingerprint, 'codeFingerprint');
    if (fingerprint.algorithm !== 'sha256' || typeof fingerprint.digest !== 'string' || !/^[a-f0-9]{64}$/.test(fingerprint.digest) || !Array.isArray(fingerprint.sources) || !fingerprint.sources.length || fingerprint.sources.some((source) => typeof source !== 'string' || !source.length) || new Set(fingerprint.sources).size !== fingerprint.sources.length) throw new Error(`${path}: invalid codeFingerprint`);
  }
  if (!Array.isArray(report.records) || !Array.isArray(report.rows)) throw new Error(`${path}: records and rows must be arrays`);
  function validateCell(entry: Record<string, unknown>): void {
    for (const [field, list] of [['mode', options.modes], ['format', options.formats], ['opponent', options.opponents], ['learningRate', options.rates], ['startingKnowledge', options.startingKnowledge]] as const) {
      if (!(list as unknown[]).includes(entry[field])) throw new Error(`${path}: ${field} outside declared matrix options`);
    }
  }
  const seen = new Set<string>();
  for (const value of report.records) {
    const record = object(value, 'record'); validateCell(record);
    integer(record.pair, 'pair', 0, options.pairs - 1); integer(record.leg, 'leg', 0, 1); integer(record.seed, 'world seed', 0, 0xffffffff);
    if (record.rounds !== options.rounds) throw new Error(`${path}: record rounds mismatch`);
    if (record.status !== 'completed' && record.status !== 'failed') throw new Error(`${path}: invalid match status`);
    if (record.failure !== null && typeof record.failure !== 'string') throw new Error(`${path}: invalid failure`);
    finite(record.experimentalScore, 'experimentalScore'); finite(record.opponentScore, 'opponentScore'); integer(record.updates, 'updates');
    const expectedWinner = record.experimentalScore > record.opponentScore ? 'experimental' : record.experimentalScore < record.opponentScore ? 'opponent' : 'draw';
    if (record.status === 'completed' && (record.winner !== expectedWinner || record.failure !== null)) throw new Error(`${path}: completed match outcome mismatch`);
    if (record.status === 'failed' && record.winner !== null) throw new Error(`${path}: failed match must not have a winner`);
    if (!Array.isArray(record.shots) || !Array.isArray(record.kills) || !Array.isArray(record.roundResults)) throw new Error(`${path}: missing raw evidence arrays`);
    if (record.status === 'completed' && record.roundResults.length !== options.rounds) throw new Error(`${path}: completed match missing final rounds`);
    const shotKeys = new Set<string>();
    for (const value of record.shots) {
      const shot = object(value, 'shot');
      integer(shot.round, 'shot round', 1, options.rounds); integer(shot.player, 'shot player', 0, Number(String(record.format)[0]) * 2 - 1); integer(shot.shot, 'shot index', 1);
      const shotKey = `${shot.round}/${shot.player}/${shot.shot}`;
      if (shotKeys.has(shotKey)) throw new Error(`${path}: duplicate raw shot ${shotKey}`);
      shotKeys.add(shotKey);
      if (!['experimental', 'opponent'].includes(shot.side as string)) throw new Error(`${path}: invalid shot side`);
      if ((shot.player % 2 === record.leg ? 'experimental' : 'opponent') !== shot.side) throw new Error(`${path}: shot side does not match swapped seat ownership`);
      if (shot.outcome !== null && !['ship', 'planet', 'hole', 'clash', 'lost', 'timeout'].includes(shot.outcome as string)) throw new Error(`${path}: missing or invalid authoritative shot outcome`);
      if (record.status === 'completed' && shot.outcome === null) throw new Error(`${path}: completed match has unfinished shot`);
      if (shot.elapsed !== null) finite(shot.elapsed, 'shot elapsed');
      if (shot.outcome !== null && (shot.elapsed === null || (shot.elapsed as number) < 0)) throw new Error(`${path}: completed shot missing elapsed evidence`);
      if (shot.hitShip !== null) integer(shot.hitShip, 'hitShip');
      if (shot.hitRelation != null && !['enemy', 'friendly', 'self'].includes(shot.hitRelation as string)) throw new Error(`${path}: invalid hit relation`);
      if (record.status === 'completed' && shot.side === 'experimental' && shot.decision === null) throw new Error(`${path}: experimental shot missing decision`);
      if (shot.decision !== null) {
        const decision = object(shot.decision, 'shot decision');
        if (decision.learningRate !== record.learningRate || decision.startingKnowledge !== record.startingKnowledge) throw new Error(`${path}: decision setting mismatch`);
        if (typeof decision.kind !== 'string') throw new Error(`${path}: missing decision kind`);
        finite(decision.fitMs, 'decision fitMs');
        for (const field of ['observedShots', 'retainedShots', 'samples', 'predictionSamples']) integer(decision[field], `decision ${field}`);
        finite(decision.learnedShots, 'decision learnedShots');
        if (decision.learnedShots < 0 || decision.learnedShots > (decision.observedShots as number)) throw new Error(`${path}: learned evidence outside observed history`);
        for (const field of ['predictionRms', 'relativeGravityMapRms']) if (decision[field] !== null) finite(decision[field], `decision ${field}`);
      }
      if (shot.observation != null) {
        const observation = object(shot.observation, 'shot observation');
        if (observation.learningRate !== record.learningRate || observation.startingKnowledge !== record.startingKnowledge) throw new Error(`${path}: observation setting mismatch`);
        for (const field of ['observedShots', 'retainedShots', 'samples', 'predictionSamples']) integer(observation[field], `observation ${field}`);
        finite(observation.learnedShots, 'observation learnedShots');
        if (observation.learnedShots < 0 || observation.learnedShots > (observation.observedShots as number)) throw new Error(`${path}: learned evidence outside observed history`);
        finite(observation.fitMs, 'observation fitMs');
        if (observation.predictionRms !== null) finite(observation.predictionRms, 'observation predictionRms');
      }
    }
    for (const value of record.kills) {
      const kill = object(value, 'kill');
      if (kill.killer !== null) integer(kill.killer, 'kill killer');
      if (typeof kill.self !== 'boolean' || typeof kill.friendly !== 'boolean') throw new Error(`${path}: missing kill ownership evidence`);
    }
    const roundNumbers = new Set<number>();
    for (const value of record.roundResults) {
      const round = object(value, 'round'); integer(round.round, 'round number', 1, options.rounds); integer(round.shots, 'round shots');
      if (roundNumbers.has(round.round)) throw new Error(`${path}: duplicate round ${round.round}`);
      roundNumbers.add(round.round);
      if (typeof round.title !== 'string' || !Array.isArray(round.shotsByPlayer) || !Array.isArray(round.scores)) throw new Error(`${path}: incomplete round evidence`);
      for (const shots of round.shotsByPlayer) integer(shots, 'round player shots');
      for (const score of round.scores) finite(score, 'round score');
      if (round.shots !== record.shots.filter((shot) => object(shot, 'shot').round === round.round).length || round.shotsByPlayer.reduce((sum: number, count: number) => sum + count, 0) !== round.shots) throw new Error(`${path}: round shot denominator mismatch`);
    }
    const key = `${record.mode}/${record.format}/${record.opponent}/${record.learningRate}/${record.startingKnowledge}/${record.pair}/${record.leg}`;
    if (seen.has(key)) throw new Error(`${path}: duplicate raw leg ${key}`);
    seen.add(key);
  }
  const rowKeys = new Set<string>();
  for (const value of report.rows) {
    const row = object(value, 'row'); validateCell(row); object(row.summary, 'row summary');
    const key = cellKey(row as unknown as MatrixCell);
    if (rowKeys.has(key)) throw new Error(`${path}: duplicate final row ${key}`);
    rowKeys.add(key);
  }
  return value as CalibrationInput;
}

function completePairs(records: MatchRecord[]): Map<string, MatchRecord[]> {
  const pairs = new Map<string, MatchRecord[]>();
  for (const record of records) { const key = worldKey(record); pairs.set(key, [...(pairs.get(key) ?? []), record]); }
  return new Map([...pairs].filter(([, legs]) => legs.length === 2 && new Set(legs.map((leg) => leg.leg)).size === 2 && legs.every((leg) => leg.status === 'completed')));
}
const pairPoints = (legs: MatchRecord[]) => legs.reduce((sum, leg) => sum + (leg.winner === 'experimental' ? 1 : leg.winner === 'draw' ? 0.5 : 0), 0) / 2;
const pairScore = (legs: MatchRecord[]) => legs.reduce((sum, leg) => sum + leg.experimentalScore - leg.opponentScore, 0);

/** Seeds and learner identities remain separate cohorts; rate repetitions never enlarge n. */
export function calibrate(inputs: { path: string; report: CalibrationInput }[]): CalibrationReport {
  const cohorts = new Map<string, typeof inputs>();
  for (const input of inputs) {
    validateMatrix(input.report, input.path);
    const { options, codeFingerprint } = input.report;
    const id = JSON.stringify([codeFingerprint?.digest ?? 'unknown', codeFingerprint?.sources ?? [], options.seed, options.rounds, options.deterministicCpu]);
    cohorts.set(id, [...(cohorts.get(id) ?? []), input]);
  }
  const knownCodes = new Set(inputs.map((input) => JSON.stringify([input.report.codeFingerprint?.digest ?? 'unknown', input.report.codeFingerprint?.sources ?? []])));
  const mixedCode = knownCodes.size > 1;
  const groups: CalibrationGroup[] = [];
  const groupWorlds = new Map<string, Map<string, Set<string>>>();
  for (const [id, cohort] of [...cohorts].sort(([a], [b]) => a.localeCompare(b))) {
    const first = cohort[0].report;
    const declared = new Map<string, { cell: MatrixCell; pairs: number; final: boolean }>();
    const records = new Map<string, MatchRecord[]>();
    const legKeys = new Set<string>();
    const worldSeeds = new Map<string, number>();
    const seedWorlds = new Map<string, number>();
    for (const { path, report } of cohort) {
      for (const mode of report.options.modes) for (const format of report.options.formats) for (const opponent of report.options.opponents) for (const learningRate of report.options.rates) for (const startingKnowledge of report.options.startingKnowledge) {
        const cell = { mode, format, opponent, learningRate, startingKnowledge }; const key = cellKey(cell);
        const previous = declared.get(key);
        declared.set(key, { cell, pairs: Math.max(previous?.pairs ?? 0, report.options.pairs), final: (previous?.final ?? false) || report.rows.some((row) => cellKey(row) === key) });
      }
      for (const record of report.records) {
        const key = cellKey(record); const legKey = `${key}/${record.pair}/${record.leg}`;
        if (legKeys.has(legKey)) throw new Error(`${path}: overlapping raw legs across inputs (${legKey}); choose one snapshot, do not count duplicates`);
        legKeys.add(legKey);
        const sharedWorld = `${record.mode}/${record.format}/${record.pair}`;
        const previousSeed = worldSeeds.get(sharedWorld);
        if (previousSeed !== undefined && previousSeed !== record.seed) throw new Error(`${path}: inconsistent world seed for ${sharedWorld} across legs/settings/opponents`);
        const seedKey = `${record.mode}/${record.format}/${record.seed}`;
        const previousPair = seedWorlds.get(seedKey);
        if (previousPair !== undefined && previousPair !== record.pair) throw new Error(`${path}: repeated world seed across distinct pairs in ${record.mode}/${record.format}`);
        seedWorlds.set(seedKey, record.pair);
        worldSeeds.set(sharedWorld, record.seed);
        records.set(key, [...(records.get(key) ?? []), record]);
      }
    }
    groupWorlds.set(id, new Map([...records].map(([key, raw]) => [key, new Set(raw.map((record) => `${record.seed}/${record.mode}/${record.format}`))])));
    const cells: CalibrationCell[] = [];
    for (const [key, entry] of [...declared].sort(([a], [b]) => a.localeCompare(b))) {
      const raw = records.get(key) ?? []; const pairs = completePairs(raw); const summary = summarizeCell(raw);
      const unmatchedPairs = [...new Set(raw.map(worldKey))].filter((world) => !pairs.has(world)).sort();
      const missingLegs = entry.pairs * 2 - raw.length;
      cells.push({ ...entry.cell, key, expectedPairs: entry.pairs, missingLegs, unmatchedPairs, finalRowPresent: entry.final,
        incomplete: !entry.final || missingLegs > 0 || pairs.size !== entry.pairs,
        failures: raw.filter((leg) => leg.status === 'failed').map((leg) => ({ pair: leg.pair, leg: leg.leg, reason: leg.failure })),
        targetDistance: summary.pairs.winPoints.mean === null ? null : distance(summary.pairs.winPoints.mean), summary });
    }
    const pairedSettingDeltas: CalibrationGroup['pairedSettingDeltas'] = [];
    const domains = [...new Set(cells.map((cell) => `${cell.mode}/${cell.format}/${cell.opponent}`))].sort();
    for (const domain of domains) {
      const settings = cells.filter((cell) => `${cell.mode}/${cell.format}/${cell.opponent}` === domain).sort((a, b) => a.learningRate - b.learningRate || a.startingKnowledge - b.startingKnowledge);
      for (let baselineIndex = 0; baselineIndex < settings.length; baselineIndex++) {
        const baseline = settings[baselineIndex];
        const baselinePairs = completePairs(records.get(baseline.key) ?? []);
        for (const candidate of settings.slice(baselineIndex + 1)) {
          const candidatePairs = completePairs(records.get(candidate.key) ?? []);
          const matched = [...baselinePairs.keys()].filter((key) => candidatePairs.has(key)).sort();
          pairedSettingDeltas.push({ cell: domain, baseline: { learningRate: baseline.learningRate, startingKnowledge: baseline.startingKnowledge }, setting: { learningRate: candidate.learningRate, startingKnowledge: candidate.startingKnowledge }, matchedPairs: matched.length,
            unmatchedBaselinePairs: [...baselinePairs.keys()].filter((key) => !candidatePairs.has(key)).sort(), unmatchedCandidatePairs: [...candidatePairs.keys()].filter((key) => !baselinePairs.has(key)).sort(),
            winPointDelta: meanConfidenceInterval(matched.map((key) => pairPoints(candidatePairs.get(key)!) - pairPoints(baselinePairs.get(key)!))),
            scoreDelta: meanConfidenceInterval(matched.map((key) => pairScore(candidatePairs.get(key)!) - pairScore(baselinePairs.get(key)!))) });
        }
      }
    }
    const opponentBalanced: Aggregate[] = [];
    for (const domain of [...new Set(cells.map((cell) => `${cell.mode}/${cell.format}/${cell.learningRate}/${cell.startingKnowledge}`))].sort()) {
      const members = cells.filter((cell) => `${cell.mode}/${cell.format}/${cell.learningRate}/${cell.startingKnowledge}` === domain);
      const pairMaps = members.map((cell) => completePairs(records.get(cell.key) ?? []));
      const shared = [...pairMaps[0].keys()].filter((key) => pairMaps.every((pairs) => pairs.has(key)));
      const missingOpponents = OPPONENTS.filter((opponent) => !members.some((cell) => cell.opponent === opponent));
      const worst = members.filter((cell) => cell.targetDistance !== null).sort((a, b) => b.targetDistance! - a.targetDistance! || a.key.localeCompare(b.key))[0];
      opponentBalanced.push({ mode: members[0].mode, format: members[0].format, learningRate: members[0].learningRate, startingKnowledge: members[0].startingKnowledge, opponents: members.map((cell) => cell.opponent), missingOpponents,
        winPoints: boundedMeanConfidenceInterval(missingOpponents.length ? [] : shared.map((key) => average(pairMaps.map((pairs) => pairPoints(pairs.get(key)!)))!)),
        unmatchedWorlds: members.map((cell, index) => ({ opponent: cell.opponent, keys: [...pairMaps[index].keys()].filter((key) => !shared.includes(key)).sort() })),
        worstCell: worst ? { key: worst.key, mean: worst.summary.pairs.winPoints.mean!, targetDistance: worst.targetDistance! } : null,
        complete: !missingOpponents.length && members.every((cell) => !cell.incomplete) });
    }
    const recommendations: Recommendation[] = [];
    const modesFormats = [...new Set(cells.map((cell) => `${cell.mode}/${cell.format}`))].sort();
    const settings = [...new Map(cells.map(({ learningRate, startingKnowledge }) => [`${learningRate}/${startingKnowledge}`, { learningRate, startingKnowledge }])).values()].sort((a, b) => a.learningRate - b.learningRate || a.startingKnowledge - b.startingKnowledge);
    const scopes = [{ scope: 'level' as const, domains: modesFormats }, ...modesFormats.map((domain) => ({ scope: 'cell' as const, domains: [domain] }))];
    for (const opponent of OPPONENTS) for (const { scope, domains } of scopes) {
      const candidates: Candidate[] = settings.map(({ learningRate, startingKnowledge }) => {
        const expected = domains.map((domain) => `${domain}/${opponent}/rate=${learningRate}/knowledge=${startingKnowledge}`);
        const members = cells.filter((cell) => expected.includes(cell.key));
        const missingCells = expected.filter((key) => !members.some((cell) => cell.key === key));
        const incompleteCells = members.filter((cell) => cell.incomplete).map((cell) => cell.key);
        // Equal cell weighting, not pooled legs: plentiful/easy cells cannot conceal a weak hard cell.
        const means = members.map((cell) => cell.summary.pairs.winPoints.mean);
        const balanced = missingCells.length || means.some((mean) => mean === null) ? null : average(means as number[]);
        const worst = members.filter((cell) => cell.targetDistance !== null).sort((a, b) => b.targetDistance! - a.targetDistance! || a.key.localeCompare(b.key))[0];
        return { learningRate, startingKnowledge, opponentBalancedMean: balanced, targetDistance: balanced === null ? null : distance(balanced), worstCellDistance: worst?.targetDistance ?? null, worstCell: worst?.key ?? null,
          minimumPairs: members.length ? Math.min(...members.map((cell) => cell.summary.pairs.completed)) : 0, missingCells, incompleteCells,
          eligible: !missingCells.length && !incompleteCells.length && balanced !== null,
          allCellsInTarget: !missingCells.length && members.length > 0 && members.every((cell) => cell.targetDistance === 0) };
      });
      const best = candidates.filter((candidate) => candidate.eligible).sort((a, b) => a.worstCellDistance! - b.worstCellDistance! || a.targetDistance! - b.targetDistance! || Math.abs(a.opponentBalancedMean! - 0.5) - Math.abs(b.opponentBalancedMean! - 0.5) || a.learningRate - b.learningRate || a.startingKnowledge - b.startingKnowledge)[0];
      const [mode, format] = domains[0].split('/');
      recommendations.push({ opponent, scope, ...(scope === 'cell' ? { mode, format } : {}), candidates, selectedSetting: mixedCode || !best ? null : { learningRate: best.learningRate, startingKnowledge: best.startingKnowledge },
        status: mixedCode ? 'mixed-code-blocked' : !best ? 'unmatched' : !best.allCellsInTarget ? 'outside-target' : best.minimumPairs < 50 || !first.codeFingerprint || !first.options.deterministicCpu ? 'exploratory' : 'confirmation-required', confirmationSeeds: [] });
    }
    groups.push({ id, codeFingerprint: first.codeFingerprint ?? null, seed: first.options.seed, rounds: first.options.rounds, deterministicCpu: first.options.deterministicCpu, paths: cohort.map((input) => input.path).sort(), cells, opponentBalanced, pairedSettingDeltas, recommendations });
  }
  for (const group of groups) for (const recommendation of group.recommendations) {
    if (recommendation.status !== 'confirmation-required') continue;
    const selected = recommendation.selectedSetting!;
    const expectedKeys = group.cells.filter((cell) => cell.learningRate === selected.learningRate && cell.startingKnowledge === selected.startingKnowledge && cell.opponent === recommendation.opponent && (recommendation.scope === 'level' || cell.mode === recommendation.mode && cell.format === recommendation.format)).map((cell) => cell.key);
    const confirmations = groups.filter((other) => other.seed !== group.seed && other.codeFingerprint?.digest === group.codeFingerprint?.digest && JSON.stringify(other.codeFingerprint?.sources) === JSON.stringify(group.codeFingerprint?.sources) && other.rounds === group.rounds && other.deterministicCpu === group.deterministicCpu && expectedKeys.every((key) => {
      const cell = other.cells.find((cell) => cell.key === key);
      const originalWorlds = groupWorlds.get(group.id)?.get(key) ?? new Set<string>();
      const confirmationWorlds = groupWorlds.get(other.id)?.get(key) ?? new Set<string>();
      return cell && !cell.incomplete && cell.summary.pairs.completed >= 50 && cell.targetDistance === 0 && [...confirmationWorlds].every((world) => !originalWorlds.has(world));
    }));
    recommendation.confirmationSeeds = [...new Set(confirmations.map((other) => other.seed))].sort((a, b) => a - b);
    if (confirmations.length) recommendation.status = 'confirmed-target';
  }
  return { schemaVersion: 1, target: [0.4, 0.6], minimumConfirmationPairs: 50, groups, notes: [
    'Win points = mean of the two leg outcomes (win=1, draw=0.5). Pair key is world seed/mode/format/pair; both completed legs are required.',
    'Seeds and code identities are separate cohorts. Settings/opponents reuse worlds and are not independent repetitions. Overlapping input snapshots are rejected.',
    'Cell win-point CI95 is bounded Hoeffding; paired setting and score delta CI95 is Student-t across matched worlds. Opponent-balanced CI clusters all three opponents within each shared world at exactly one rate and startingKnowledge.',
    'Easy, medium and hard each receive a separate {learningRate, startingKnowledge} preset across measured modes/formats, plus optional cell tuning. Candidates use equal cell weights; selection minimizes worst-cell target distance, aggregate target distance, distance to 50%, then rate and knowledge. Partial or unmatched candidates are ineligible.',
    'confirmed-target is a 40–60% point-target screen, not proof of parity or an adjusted multiple-comparison confidence claim. It requires >=50 complete pairs in every selected cell and an independent seed with the same known fingerprint/settings at BOTH the same rate and startingKnowledge.',
    'Unknown legacy code identity may be analyzed but is never release proof. Mixed identities block recommendations; no source-code label is guessed.',
    'Raw records determine all statistics; final rows are completion markers only. Prediction n/missing denominators are completed experimental shots; shot/observation/decision evidence is descriptive, not independent match samples.',
  ] };
}

export function parseArguments(args: readonly string[]): CalibrationOptions {
  const paths: string[] = []; let json: string | null = null;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--json' || arg.startsWith('--json=')) {
      if (json !== null) throw new Error('Duplicate --json');
      json = arg === '--json' ? args[++index] : arg.slice(7);
      if (!json?.trim() || json.startsWith('--')) throw new Error('--json requires an output path');
    } else if (arg.startsWith('--')) throw new Error(`Unknown option: ${arg}`);
    else paths.push(arg);
  }
  if (!paths.length) throw new Error('Provide one or more schema 3 matrix JSON paths');
  if (new Set(paths.map((path) => resolve(path))).size !== paths.length) throw new Error('Duplicate input path');
  if (json && paths.some((path) => resolve(path) === resolve(json!))) throw new Error('Output must not overwrite an input matrix');
  return { paths, json };
}
export function printReport(report: CalibrationReport): void {
  const number = (value: number | null) => value === null ? '—' : value.toFixed(3);
  for (const group of report.groups) {
    console.log(`Calibration seed=${group.seed} code=${group.codeFingerprint?.digest ?? 'UNKNOWN'} rounds=${group.rounds} deterministic=${group.deterministicCpu}`);
    const measured = group.cells.filter((cell) => cell.summary.legs.attempted > 0 || cell.finalRowPresent);
    console.log(`Coverage: ${group.cells.filter((cell) => !cell.incomplete).length}/${group.cells.length} complete cells; ${measured.filter((cell) => cell.incomplete).length} partial; ${group.cells.length - measured.length} unstarted; ${group.cells.reduce((total, cell) => total + cell.summary.legs.failed, 0)} failed legs. Unstarted cells omitted below, retained in JSON.`);
    if (measured.length) console.table(measured.map((cell) => ({
      cell: cell.key, state: cell.incomplete ? 'partial' : 'complete', pairs: `${cell.summary.pairs.completed}/${cell.expectedPairs}`,
      'win points [95%]': `${number(cell.summary.pairs.winPoints.mean)} [${cell.summary.pairs.winPoints.ci95?.map(number).join(', ') ?? '—'}]`,
      'score Δ [95%]': `${number(cell.summary.pairs.scoreDelta.mean)} [${cell.summary.pairs.scoreDelta.ci95?.map(number).join(', ') ?? '—'}]`,
      'missing legs': cell.missingLegs, failures: cell.summary.legs.failed, 'final row': cell.finalRowPresent,
      shots: `${cell.summary.shots.completed}/${cell.summary.shots.fired}`, observations: `${cell.summary.experimental.observationCount}/${cell.summary.experimental.completed}`,
      'prediction n/missing': `${cell.summary.experimental.predictionRms.n}/${cell.summary.experimental.predictionRms.missing}`,
    })));
    console.log('Separate candidate presets for easy / medium / hard; level scope covers all measured modes/formats. Cell scope is optional local tuning, not a universal setting.');
    console.table(group.recommendations.map((recommendation) => ({
      opponent: recommendation.opponent, scope: recommendation.scope === 'level' ? 'all measured formats' : `${recommendation.mode}/${recommendation.format}`,
      'candidate setting': recommendation.selectedSetting ? `rate=${recommendation.selectedSetting.learningRate},knowledge=${recommendation.selectedSetting.startingKnowledge}` : 'NONE', status: recommendation.status,
      candidates: recommendation.candidates.map((candidate) => `${candidate.learningRate}/${candidate.startingKnowledge}:${candidate.eligible ? candidate.allCellsInTarget ? 'in-target' : 'outside-target' : `blocked(missing=${candidate.missingCells.length},partial=${candidate.incompleteCells.length})`}`).join(' '),
      'confirmation seeds': recommendation.confirmationSeeds.join(',') || 'none',
    })));
    const failures = measured.flatMap((cell) => cell.failures.map((failure) => `${cell.key} pair=${failure.pair} leg=${failure.leg}: ${failure.reason ?? 'unknown failure'}`));
    if (failures.length) console.log(`Failures: ${failures.join('; ')}`);
  }
  console.log('40–60% is a point-target screen, not parity. Partial/unmatched candidates are blocked; confirmation needs ≥50 complete pairs per selected cell and independent same-rate, same-knowledge, same-code/settings worlds. JSON retains all cells, uncertainty, paired deltas, diagnostics and candidates.');
}
export async function main(args = process.argv.slice(2)): Promise<void> {
  if (args.includes('--help')) { console.log('npm run bench:calibration -- matrix1.json matrix2.json [--json=calibration.json]\nReads existing schema 3 raw matrix evidence without rerunning matches. Historical schema 2 lacks startingKnowledge identity and is rejected. Separate seed/code cohorts; partial evidence is explicit.'); return; }
  const options = parseArguments(args);
  const inputs = await Promise.all(options.paths.map(async (path) => ({ path, report: validateMatrix(JSON.parse(await readFile(path, 'utf8')), path) })));
  const report = calibrate(inputs); printReport(report);
  if (options.json) { await mkdir(dirname(resolve(options.json)), { recursive: true }); await writeFile(options.json, JSON.stringify(report, null, 2) + '\n'); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
