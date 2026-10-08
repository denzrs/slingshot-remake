import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setImmediate as yieldToEventLoop } from 'node:timers/promises';
import { createMatch, type VersusMode } from '../src/game';
import { hashSeed } from '../src/rng';
import { DEFAULT_SETTINGS, type Seat } from '../src/settings';
import { summarizeCell, type CellSummary, type Format, type RoundRecord, type ShotRecord } from './ai-metrics';
import type { KillRecord } from '../src/game/match';
import type { CpuLevel } from '../src/ai';

/** One leg of a matched world pair: challenger level against opponent level, seat parity decides the side. */
export interface LevelMatchRecord {
  mode: VersusMode;
  format: Format;
  challenger: string;
  opponent: string;
  pair: number;
  leg: 0 | 1;
  seed: number;
  rounds: number;
  status: 'completed' | 'failed';
  failure: string | null;
  winner: 'experimental' | 'opponent' | 'draw' | null;
  experimentalScore: number;
  opponentScore: number;
  shots: ShotRecord[];
  kills: KillRecord[];
  roundResults: RoundRecord[];
  updates: number;
}
export interface LevelSpec {
  level: CpuLevel;
  /** Short label for tables. */
  label: string;
}

export const LEVELS: readonly LevelSpec[] = [
  { level: 'easy', label: 'Kepler' },
  { level: 'medium', label: 'Newton' },
  { level: 'hard', label: 'Einstein' },
  { level: 'hawking', label: 'Hawking' },
  { level: 'experimental-easy', label: 'X-Kepler' },
  { level: 'experimental-medium', label: 'X-Newton' },
  { level: 'experimental-hard', label: 'X-Einstein' },
];

export interface MatrixOptions {
  modes: VersusMode[];
  formats: Format[];
  /** Level labels (from LEVELS) that fly as the measured "challenger" side. */
  challengers: string[];
  /** Level labels that fly as the opposing side. */
  opponents: string[];
  pairs: number;
  rounds: number;
  seed: number;
  deterministicCpu: boolean;
  json: string | null;
}
export interface MatrixCell { mode: VersusMode; format: Format; challenger: string; opponent: string }
export interface MatrixRow extends MatrixCell { summary: CellSummary }
export interface MatrixReport {
  schemaVersion: 4;
  options: MatrixOptions;
  rules: { shotTime: 60; bounce: false; fixedPower: false; visiblePlanets: true; fixedSeatTeams: number[]; classicTeamVolleys: true };
  rows: MatrixRow[];
  records: LevelMatchRecord[];
}

const MODES: VersusMode[] = ['classic', 'horizon'];
const FORMATS: Format[] = ['1v1', '2v2', '3v3'];
const LABELS = LEVELS.map((spec) => spec.label);
const SEAT_TEAMS = [0, 1, 0, 1, 0, 1];
const FRAME_TIME = 1 / 60;
const HELP = `Seeded level-vs-level CPU matrix (matched side swaps, complete final-score matches).
  --modes=classic,horizon --formats=1v1,2v2,3v3 --challengers=easy,medium,hard --opponents=easy,medium,hard
  --pairs=10 --rounds=5 --seed=99540717 --json=results/level-matrix.json --deterministic=true
Level labels: ${LABELS.join(',')}
Singular --mode, --format, --challenger, --opponent are also accepted.
60-second PHYSICS shot limit; bounce/fixed power/grace off; visible planets.
Classic team volleys and Horizon volleys; deterministic per-seat planner streams.
Every challenger/opponent pairing runs on matched worlds with both seat assignments.
Smoke: npm run bench:levels -- --mode=classic --format=1v1 --challengers=hard --opponents=easy --pairs=1 --rounds=1 --json=results/level-smoke.json`;

function levelOf(label: string): LevelSpec {
  const spec = LEVELS.find((entry) => entry.label === label);
  if (!spec) throw new Error(`Unknown level label: ${label}`);
  return spec;
}

export function parseArguments(args: readonly string[]): MatrixOptions {
  const values: Record<string, string> = {};
  const aliases: Record<string, string> = { mode: 'modes', format: 'formats', challenger: 'challengers', opponent: 'opponents' };
  const allowed: Record<string, true> = { modes: true, formats: true, challengers: true, opponents: true, pairs: true, rounds: true, seed: true, json: true, deterministic: true };
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
  const challengers = list('challengers', LABELS);
  const opponents = list('opponents', LABELS);
  if (values.deterministic !== undefined && values.deterministic !== 'true' && values.deterministic !== 'false') throw new Error('--deterministic must be true or false');
  if (values.json !== undefined && !values.json.trim()) throw new Error('--json must be a file path');
  return {
    modes: list('modes', MODES), formats: list('formats', FORMATS), challengers, opponents,
    pairs: integer('pairs', 10, 1, 10000), rounds: integer('rounds', DEFAULT_SETTINGS.rounds, 1, 100),
    seed: integer('seed', 0x5eedeed, 0, 0xffffffff), deterministicCpu: values.deterministic !== 'false', json: values.json ?? null,
  };
}

/** Real fixed-step match; limit guards unfinished matches, never changes shot physics. */
export async function runLeg(cell: MatrixCell, options: MatrixOptions, pair: number, leg: 0 | 1): Promise<LevelMatchRecord> {
  const players = Number(cell.format[0]) * 2;
  const challengerLevel = levelOf(cell.challenger).level;
  const opponentLevel = levelOf(cell.opponent).level;
  // Both seat assignments on the same world: seat parity decides the side.
  const challengerPlayers = new Set(Array.from({ length: players }, (_, player) => player).filter((player) => player % 2 === leg));
  const seats: Seat[] = Array.from({ length: 6 }, (_, player) => player >= players ? 'off' : challengerPlayers.has(player) ? challengerLevel : opponentLevel);
  const seed = hashSeed('level-matrix-world', options.seed, cell.mode, cell.format, cell.challenger, cell.opponent, pair);
  const record: LevelMatchRecord = {
    ...cell, pair, leg, seed, rounds: options.rounds, status: 'failed', failure: null,
    experimentalScore: 0, opponentScore: 0, winner: null, shots: [], kills: [], roundResults: [], updates: 0,
  };
  const fired = new Map<string, ShotRecord>();
  const shotKey = (round: number, player: number, shot: number) => `${round}/${player}/${shot}`;
  try {
    const match = createMatch(cell.mode, {
      ...DEFAULT_SETTINGS, seats, seatTeams: [...SEAT_TEAMS], teamMode: players > 2 ? 2 : 0,
      rounds: options.rounds, shotTime: 60, bounce: false, fixedPower: false, invisiblePlanets: false,
      simultaneousShots: players > 2, styleBonuses: false, neighborGrace: 0,
      contours: false, particles: false, sound: false,
    }, {
      seed, deterministicCpu: options.deterministicCpu,
      onShotComplete(report) {
        const shot = fired.get(shotKey(report.round, report.player, report.shot));
        if (!shot) throw new Error(`Completed shot without fire ${shotKey(report.round, report.player, report.shot)}`);
        if (shot.outcome !== null) throw new Error(`Duplicate completed shot ${shotKey(report.round, report.player, report.shot)}`);
        shot.outcome = report.outcome;
        shot.hitShip = report.hitShip;
        shot.elapsed = report.elapsed;
        shot.end = { ...report.end };
        shot.hitRelation = report.hitRelation;
      },
    });
    match.on((event) => {
      if (event.type === 'fire') {
        const player = match.players[event.player];
        const key = shotKey(match.round, event.player, player.shots);
        if (fired.has(key)) throw new Error(`Duplicate fire ${key}`);
        const shot: ShotRecord = {
          round: match.round, player: event.player, shot: player.shots,
          side: challengerPlayers.has(event.player) ? 'experimental' : 'opponent',
          outcome: null, hitShip: null, elapsed: null, decision: null,
          end: null, hitRelation: null,
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
      if (record.updates % 256 === 0) await yieldToEventLoop();
    }
    const scores = match.players.map((player) => player.score);
    record.experimentalScore = scores.reduce((sum, score, player) => sum + (challengerPlayers.has(player) ? score : 0), 0);
    record.opponentScore = scores.reduce((sum, score, player) => sum + (challengerPlayers.has(player) ? 0 : score), 0);
    if (match.phase !== 'gameOver') throw new Error(`Unfinished match after ${maxUpdates} simulation frames`);
    if (record.roundResults.length !== options.rounds) throw new Error(`Only ${record.roundResults.length}/${options.rounds} rounds recorded`);
    if (record.shots.some((shot) => shot.outcome === null)) throw new Error('Unfinished real shots at gameOver');
    record.status = 'completed';
    record.winner = record.experimentalScore > record.opponentScore ? 'experimental' : record.experimentalScore < record.opponentScore ? 'opponent' : 'draw';
  } catch (error) {
    record.failure = error instanceof Error ? error.message : String(error);
  }
  return record;
}

export function formatCell(cell: MatrixCell): string {
  return `${cell.mode}/${cell.format}/${cell.challenger}-vs-${cell.opponent}`;
}

function number(value: number | null): string { return value === null ? 'N/A' : value.toFixed(3); }
function interval(value: [number, number] | null): string { return value ? `[${number(value[0])}, ${number(value[1])}]` : 'N/A'; }

function printRow(row: MatrixRow): void {
  const s = row.summary;
  console.log(`${formatCell(row)}: legs W/L/D ${s.legs.wins}/${s.legs.losses}/${s.legs.draws}; failures ${s.legs.failed}; complete pairs ${s.pairs.completed}/${s.pairs.attempted}`);
  console.log(`  pair win points ${number(s.pairs.winPoints.mean)} CI95 ${interval(s.pairs.winPoints.ci95)} n=${s.pairs.winPoints.n}; strict pair wins ${s.pairs.wins}/${s.pairs.completed} Wilson ${interval(s.pairs.winRateCi95)}; score delta ${number(s.pairs.scoreDelta.mean)} CI95 ${interval(s.pairs.scoreDelta.ci95)}`);
  console.log(`  shots ${s.shots.fired} (challenger ${s.experimental.shipHits}/${s.experimental.completed} hits, opponent ${s.opponent.shipHits}/${s.opponent.completed}); kills offensive/self/friendly challenger ${s.kills.experimentalOffensive}/${s.kills.experimentalSelf}/${s.kills.experimentalFriendly}, opponent ${s.kills.opponentOffensive}/${s.kills.opponentSelf}/${s.kills.opponentFriendly}`);
}

async function persist(report: MatrixReport): Promise<void> {
  if (!report.options.json) return;
  await mkdir(dirname(resolve(report.options.json)), { recursive: true });
  await writeFile(report.options.json, JSON.stringify(report, null, 2) + '\n');
}

export async function runMatrix(options: MatrixOptions): Promise<MatrixReport> {
  const report: MatrixReport = {
    schemaVersion: 4, options,
    rules: { shotTime: 60, bounce: false, fixedPower: false, visiblePlanets: true, fixedSeatTeams: [...SEAT_TEAMS], classicTeamVolleys: true },
    rows: [], records: [],
  };
  const cells = options.modes.length * options.formats.length * options.challengers.length * options.opponents.length;
  console.log(`Level matrix: ${cells} cells, ${options.pairs} paired worlds/cell, ${options.rounds} rounds/leg, seed=${options.seed}, deterministicCpu=${options.deterministicCpu}`);
  console.log(`Levels: ${LEVELS.map((spec) => `${spec.label}=${spec.level}`).join(', ')}`);
  for (const mode of options.modes) for (const format of options.formats) for (const challenger of options.challengers) for (const opponent of options.opponents) {
    const cell = { mode, format, challenger, opponent };
    const records: LevelMatchRecord[] = [];
    for (let pair = 0; pair < options.pairs; pair++) {
      for (const leg of [0, 1] as const) {
        const record = await runLeg(cell, options, pair, leg);
        records.push(record);
        report.records.push(record);
        if (record.status === 'failed') console.error(`${formatCell(cell)} pair=${pair} leg=${leg}: FAILED ${record.failure}`);
        await yieldToEventLoop();
      }
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
