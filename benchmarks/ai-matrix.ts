import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setImmediate as yieldToEventLoop } from 'node:timers/promises';
import { createMatch, type ExperimentalReport, type VersusMode } from '../src/game';
import { hashSeed } from '../src/rng';
import { DEFAULT_SETTINGS, type Seat } from '../src/settings';
import { scoreOutcome, summarizeCell, type CellSummary, type DecisionRecord, type Format, type MatchRecord, type Opponent, type ShotRecord } from './ai-metrics';

export interface MatrixOptions {
  modes: VersusMode[];
  formats: Format[];
  opponents: Opponent[];
  rates: number[];
  startingKnowledge: number[];
  pairs: number;
  rounds: number;
  seed: number;
  deterministicCpu: boolean;
  json: string | null;
}
export interface MatrixCell { mode: VersusMode; format: Format; opponent: Opponent; learningRate: number; startingKnowledge: number }
export interface MatrixRow extends MatrixCell { summary: CellSummary }
export interface CodeFingerprint { algorithm: 'sha256'; digest: string; sources: readonly string[] }
// Fixed production and experiment sources. Tests and package metadata do not define execution.
const FINGERPRINT_SOURCES = [
  'src/ai.ts', 'src/config.ts', 'src/experimental-ai.ts',
  'src/game/classic.ts', 'src/game/horizon.ts', 'src/game/index.ts', 'src/game/match.ts',
  'src/physics.ts', 'src/rng.ts', 'src/scoring.ts', 'src/settings.ts', 'src/volley.ts', 'src/world.ts',
  'benchmarks/ai-matrix.ts', 'benchmarks/ai-metrics.ts',
] as const;

export function codeFingerprint(): CodeFingerprint {
  const hash = createHash('sha256').update('slingshot-learner-source-v1\0');
  for (const source of FINGERPRINT_SOURCES) {
    const bytes = readFileSync(new URL(`../${source}`, import.meta.url));
    hash.update(source).update('\0').update(`${bytes.length}:`).update(bytes).update('\0');
  }
  return { algorithm: 'sha256', digest: hash.digest('hex'), sources: [...FINGERPRINT_SOURCES] };
}

export interface MatrixReport {
  schemaVersion: 3;
  codeFingerprint: CodeFingerprint;
  options: MatrixOptions;
  rules: { shotTime: 60; bounce: false; fixedPower: false; visiblePlanets: true; fixedSeatTeams: number[]; classicTeamVolleys: true };
  rows: MatrixRow[];
  records: MatchRecord[];
}
const MODES: VersusMode[] = ['classic', 'horizon'];
const FORMATS: Format[] = ['1v1', '2v2', '3v3'];
const OPPONENTS: Opponent[] = ['easy', 'medium', 'hard'];
const SEAT_TEAMS = [0, 1, 0, 1, 0, 1];
const FRAME_TIME = 1 / 60;
const HELP = `Seeded experimental AI matrix (matched side swaps, complete final-score matches).
  --modes=classic,horizon --formats=1v1,2v2,3v3 --opponents=easy,medium,hard
  --rates=0.1,0.35,1 --knowledge=0,0.5,1 --pairs=10 --rounds=5 --seed=99540717
  --json=results/matrix.json --deterministic=true
Singular --mode, --format, --opponent, --rate, --starting-knowledge are also accepted.
60-second PHYSICS shot limit; bounce/fixed power/grace off; visible planets.
Classic team volleys and Horizon volleys; deterministic per-seat planner streams.
Default 10 matched worlds per cell is exploratory, not proof of parity.
Smoke: npm run bench:experimental -- --mode=classic --format=1v1 --opponent=easy --rate=1 --pairs=1 --rounds=1 --json=results/smoke.json
Confirmation: npm run bench:experimental -- --pairs=50 --seed=271828 --json=results/matrix-confirmation.json`;

export function parseArguments(args: readonly string[]): MatrixOptions {
  const values: Record<string, string> = {};
  const aliases: Record<string, string> = { mode: 'modes', format: 'formats', opponent: 'opponents', rate: 'rates', 'starting-knowledge': 'knowledge' };
  const allowed: Record<string, true> = { modes: true, formats: true, opponents: true, rates: true, knowledge: true, pairs: true, rounds: true, seed: true, json: true, deterministic: true };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg.startsWith('--')) throw new Error(`Unexpected argument: ${arg}`);
    const equal = arg.indexOf('=');
    const rawKey = arg.slice(2, equal < 0 ? undefined : equal);
    const key = aliases[rawKey] ?? rawKey;
    if (!Object.hasOwn(allowed, key)) throw new Error(`Unknown option: --${rawKey}`);
    if (Object.hasOwn(values, key)) throw new Error(`Duplicate option: --${key}`);
    const value = equal < 0 ? args[++index] : arg.slice(equal + 1);
    if (!value || value.startsWith('--')) throw new Error(`Missing value: --${rawKey}`);
    values[key] = value;
  }
  function list<T extends string>(key: string, choices: readonly T[]): T[] {
    if (values[key] === undefined) return [...choices];
    const items = values[key].split(',');
    if (!items.length || items.some((item) => !choices.includes(item as T)) || new Set(items).size !== items.length) throw new Error(`--${key} must contain unique values from ${choices.join(',')}`);
    return items as T[];
  }
  function integer(key: string, fallback: number, min: number, max: number): number {
    const value = values[key] === undefined ? fallback : Number(values[key]);
    if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`--${key} must be an integer from ${min} to ${max}`);
    return value;
  }
  function parameters(key: string, fallback: string): number[] {
    const strings = (values[key] ?? fallback).split(',');
    const numbers = strings.map(Number);
    if (strings.some((value) => !value.trim()) || numbers.some((value) => !Number.isFinite(value) || value < 0 || value > 1) || new Set(numbers).size !== numbers.length) throw new Error(`--${key} must contain unique numbers in [0,1]`);
    return numbers;
  }
  const rates = parameters('rates', '0.1,0.35,1');
  const startingKnowledge = parameters('knowledge', '0,0.5,1');
  if (values.deterministic !== undefined && values.deterministic !== 'true' && values.deterministic !== 'false') throw new Error('--deterministic must be true or false');
  if (values.json !== undefined && !values.json.trim()) throw new Error('--json must be a file path');
  return {
    modes: list('modes', MODES), formats: list('formats', FORMATS), opponents: list('opponents', OPPONENTS), rates, startingKnowledge,
    pairs: integer('pairs', 10, 1, 10000), rounds: integer('rounds', DEFAULT_SETTINGS.rounds, 1, 100),
    seed: integer('seed', 0x5eedeed, 0, 0xffffffff), deterministicCpu: values.deterministic !== 'false', json: values.json ?? null,
  };
}

function decisionRecord(report: ExperimentalReport): DecisionRecord {
  return {
    startingKnowledge: report.startingKnowledge,
    learningRate: report.learningRate,
    kind: report.decision.kind, observedShots: report.observedShots, learnedShots: report.learnedShots,
    retainedShots: report.retainedShots, samples: report.samples, predictionRms: report.predictionRms,
    predictionSamples: report.predictionSamples, fitMs: report.fitMs,
    relativeGravityMapRms: Number.isFinite(report.relativeGravityMapRms) ? report.relativeGravityMapRms : null,
    details: { ...report.decision },
  };
}

/** Real fixed-step match; limit guards unfinished matches, never changes shot physics. */
export async function runLeg(cell: MatrixCell, options: MatrixOptions, pair: number, leg: 0 | 1): Promise<MatchRecord> {
  const players = Number(cell.format[0]) * 2;
  const experimentalPlayers = new Set(Array.from({ length: players }, (_, player) => player).filter((player) => player % 2 === leg));
  const seats: Seat[] = Array.from({ length: 6 }, (_, player) => player >= players ? 'off' : experimentalPlayers.has(player) ? 'experimental' : cell.opponent);
  // Same world sequence for both legs, all rates, knowledge settings and opponents. Planning has separate seat RNGs.
  const seed = hashSeed('ai-matrix-world', options.seed, cell.mode, cell.format, pair);
  const record: MatchRecord = {
    ...cell, pair, leg, seed, rounds: options.rounds, status: 'failed', failure: null,
    experimentalScore: 0, opponentScore: 0, winner: null, shots: [], kills: [], roundResults: [], updates: 0,
  };
  const decisions = new Map<string, DecisionRecord>();
  const fired = new Map<string, ShotRecord>();
  const shotKey = (round: number, player: number, shot: number) => `${round}/${player}/${shot}`;
  try {
    const match = createMatch(cell.mode, {
      ...DEFAULT_SETTINGS, seats, seatTeams: [...SEAT_TEAMS], teamMode: players > 2 ? 2 : 0,
      rounds: options.rounds, shotTime: 60, bounce: false, fixedPower: false, invisiblePlanets: false,
      simultaneousShots: players > 2, styleBonuses: false, neighborGrace: 0,
      contours: false, particles: false, sound: false,
    }, {
      seed, experimentalLearningRate: cell.learningRate, experimentalStartingKnowledge: cell.startingKnowledge, deterministicCpu: options.deterministicCpu,
      onExperimentalDecision(report) {
        const key = shotKey(report.round, report.player, report.shot);
        if (decisions.has(key)) throw new Error(`Duplicate decision ${key}`);
        decisions.set(key, decisionRecord(report));
      },
      onShotComplete(report) {
        const key = shotKey(report.round, report.player, report.shot);
        const shot = fired.get(key);
        if (!shot) throw new Error(`Completed shot without fire ${key}`);
        if (shot.outcome !== null) throw new Error(`Duplicate completed shot ${key}`);
        shot.outcome = report.outcome;
        shot.hitShip = report.hitShip;
        shot.elapsed = report.elapsed;
        shot.end = { ...report.end };
        shot.hitRelation = report.hitRelation;
        shot.observation = report.experimentalObservation ? { ...report.experimentalObservation } : null;
      },
    });
    match.on((event) => {
      if (event.type === 'fire') {
        const player = match.players[event.player];
        const key = shotKey(match.round, event.player, player.shots);
        if (fired.has(key)) throw new Error(`Duplicate fire ${key}`);
        const shot: ShotRecord = {
          round: match.round, player: event.player, shot: player.shots,
          side: experimentalPlayers.has(event.player) ? 'experimental' : 'opponent',
          outcome: null, hitShip: null, elapsed: null, decision: decisions.get(key) ?? null,
          end: null, hitRelation: null, observation: null,
          launch: { x: event.x, y: event.y, angle: event.angle, power: event.power },
        };
        fired.set(key, shot);
        record.shots.push(shot);
      } else if (event.type === 'kill') record.kills.push({ ...event.record, combo: [...event.record.combo] });
      else if (event.type === 'roundEnd') {
        const roundShots = record.shots.filter((shot) => shot.round === match.round);
        record.roundResults.push({
          round: match.round, shots: roundShots.length,
          shotsByPlayer: match.players.map((player) => roundShots.filter((shot) => shot.player === player.id).length),
          scores: match.players.map((player) => player.score), survivor: match.summary?.survivor ?? null,
          winningTeam: match.summary?.team ?? null, title: match.summary?.title ?? 'noneLeft',
        });
      }
    });
    const maxUpdates = 120000 * options.rounds;
    while (match.phase !== 'gameOver' && record.updates < maxUpdates) {
      match.update(FRAME_TIME);
      record.updates++;
      if ((match.phase === 'roundOver' && match.phaseTime >= 0.6) || match.phase === 'killcam') match.advance();
      // Keep signals, IO and other processes responsive without changing simulated time.
      if (record.updates % 256 === 0) await yieldToEventLoop();
    }
    const score = scoreOutcome(match.players.map((player) => player.score), experimentalPlayers);
    record.experimentalScore = score.experimentalScore;
    record.opponentScore = score.opponentScore;
    if (match.phase !== 'gameOver') throw new Error(`Unfinished match after ${maxUpdates} simulation frames (shot physics still limited to 60s)`);
    if (record.roundResults.length !== options.rounds) throw new Error(`Only ${record.roundResults.length}/${options.rounds} rounds recorded`);
    if (record.shots.some((shot) => shot.outcome === null)) throw new Error('Unfinished real shots at gameOver');
    if (record.shots.some((shot) => shot.side === 'experimental' && shot.decision === null)) throw new Error('Experimental shot missing typed decision');
    record.status = 'completed';
    record.winner = score.winner;
  } catch (error) {
    record.failure = error instanceof Error ? error.message : String(error);
  }
  return record;
}

export function formatCell(cell: MatrixCell): string {
  return `${cell.mode}/${cell.format}/${cell.opponent}/rate=${cell.learningRate}/knowledge=${cell.startingKnowledge}`;
}
function number(value: number | null): string { return value === null ? 'N/A' : value.toFixed(3); }
function interval(value: [number, number] | null): string { return value ? `[${number(value[0])}, ${number(value[1])}]` : 'N/A'; }
function printRow(row: MatrixRow): void {
  const s = row.summary;
  console.log(`${formatCell(row)}: legs W/L/D ${s.legs.wins}/${s.legs.losses}/${s.legs.draws}; failures ${s.legs.failed}; complete pairs ${s.pairs.completed}/${s.pairs.attempted}`);
  console.log(`  average leg win points ${number(s.pairs.winPoints.mean)} bounded Hoeffding CI95 ${interval(s.pairs.winPoints.ci95)} n=${s.pairs.winPoints.n} pairs; combined-score win points ${number(s.pairs.scoreWinPoints.mean)} CI95 ${interval(s.pairs.scoreWinPoints.ci95)}; paired score delta ${number(s.pairs.scoreDelta.mean)} Student-t CI95 ${interval(s.pairs.scoreDelta.ci95)}; strict combined-score pair wins ${s.pairs.wins}/${s.pairs.completed} Wilson ${interval(s.pairs.winRateCi95)}`);
  console.log(`  side0 W/L/D ${s.sides.side0.wins}/${s.sides.side0.losses}/${s.sides.side0.draws}; side1 ${s.sides.side1.wins}/${s.sides.side1.losses}/${s.sides.side1.draws}; real shots fired/completed ${s.shots.fired}/${s.shots.completed}; E ship hits ${s.experimental.shipHits}/${s.experimental.completed} (enemy/friendly/self ${s.experimental.enemyHits}/${s.experimental.friendlyHits}/${s.experimental.selfHits}); kills offensive/self/friendly ${s.kills.experimentalOffensive}/${s.kills.experimentalSelf}/${s.kills.experimentalFriendly}; shots/kill ${number(s.experimental.shotsPerKill)}`);
  console.log(`  completed-shot prediction RMS n=${s.experimental.predictionRms.n}, missing=${s.experimental.predictionRms.missing}, p50/p95 ${number(s.experimental.predictionRms.p50)}/${number(s.experimental.predictionRms.p95)}; observations ${s.experimental.observationCount}/${s.experimental.completed}; launch fit ms n=${s.experimental.fitMs.n}, missing=${s.experimental.fitMs.missing}, p50/p95 ${number(s.experimental.fitMs.p50)}/${number(s.experimental.fitMs.p95)}; observation fit ms n=${s.experimental.observationFitMs.n}, missing=${s.experimental.observationFitMs.missing}, p50/p95 ${number(s.experimental.observationFitMs.p50)}/${number(s.experimental.observationFitMs.p95)}`);
  for (const [side, stats] of Object.entries({ experimental: s.experimental, opponent: s.opponent })) {
    console.log(`  ${side} outcomes ${JSON.stringify(stats.outcomes)}; completed flight seconds n=${stats.elapsed.n}, missing=${stats.elapsed.missing}, p50/p95 ${number(stats.elapsed.p50)}/${number(stats.elapsed.p95)}`);
    for (const [outcome, elapsed] of Object.entries(stats.outcomeElapsed)) console.log(`    ${outcome} seconds n=${elapsed.n}, missing=${elapsed.missing}, p50/p95 ${number(elapsed.p50)}/${number(elapsed.p95)}`);
  }
  for (const [stage, stats] of Object.entries(s.stages)) console.log(`  shot ${stage}: fired/completed ${stats.fired}/${stats.completed}; ship hits ${stats.shipHits}/${stats.completed}; decisions ${stats.decisionCount}/${stats.fired}; observations ${stats.observationCount}/${stats.completed}; post-completion evidence observed/learned/retained ${number(stats.observedShots.mean)}/${number(stats.learnedShots.mean)}/${number(stats.retainedShots.mean)}; prediction n=${stats.predictionRms.n}, missing=${stats.predictionRms.missing}, p50/p95=${number(stats.predictionRms.p50)}/${number(stats.predictionRms.p95)}`);
}

async function persist(report: MatrixReport): Promise<void> {
  if (!report.options.json) return;
  await mkdir(dirname(resolve(report.options.json)), { recursive: true });
  await writeFile(report.options.json, JSON.stringify(report, null, 2) + '\n');
}

export async function runMatrix(options: MatrixOptions): Promise<MatrixReport> {
  const fingerprint = codeFingerprint();
  const report: MatrixReport = {
    schemaVersion: 3, options, rules: { shotTime: 60, bounce: false, fixedPower: false, visiblePlanets: true, fixedSeatTeams: [...SEAT_TEAMS], classicTeamVolleys: true }, rows: [], records: [],
    codeFingerprint: fingerprint,
  };
  const count = options.modes.length * options.formats.length * options.opponents.length * options.rates.length * options.startingKnowledge.length;
  console.log(`Matrix: ${count} cells, ${options.pairs} paired worlds/cell, ${options.rounds} rounds/leg, seed=${options.seed}, deterministicCpu=${options.deterministicCpu}`);
  console.log(`Code identity: ${fingerprint.algorithm}:${fingerprint.digest}; exact sources: ${fingerprint.sources.join(', ')}`);
  console.log('Win-point CIs use bounded 95% Hoeffding uncertainty across independent paired worlds, not independent legs. Average leg outcomes differ from combined final-score pair outcomes. A 40–60% point estimate plus independent confirmation is the balancing target; a wide CI spanning 50% is NOT evidence of parity. Shot predictions use completion observations; fit timing is wall-clock diagnostic, not deterministic output.');
  for (const mode of options.modes) for (const format of options.formats) for (const opponent of options.opponents) for (const learningRate of options.rates) for (const startingKnowledge of options.startingKnowledge) {
    const cell = { mode, format, opponent, learningRate, startingKnowledge };
    const records: MatchRecord[] = [];
    for (let pair = 0; pair < options.pairs; pair++) {
      for (const leg of [0, 1] as const) {
        const record = await runLeg(cell, options, pair, leg);
        records.push(record);
        report.records.push(record);
        if (record.status === 'failed') console.error(`${formatCell(cell)} pair=${pair} leg=${leg}: FAILED ${record.failure}`);
        await yieldToEventLoop();
      }
      // Raw records survive subsequent cell failures and long-running matrix interruption.
      await persist(report);
    }
    const row = { ...cell, summary: summarizeCell(records) };
    report.rows.push(row);
    printRow(row);
    await persist(report);
  }
  return report;
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  if (args.includes('--help')) { console.log(HELP); return; }
  const report = await runMatrix(parseArguments(args));
  if (report.records.some((record) => record.status === 'failed')) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
