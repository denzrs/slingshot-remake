// What the statistics cost the client. The match is the same, seeded and played by CPUs to its end, in four
// ways that each add to the one before:
//
//   baseline  the shot log is switched off: the match does nothing for statistics
//   shot log  the match as it always runs (it logs every shot and placement)
//   reports   + what an online host does at the end of every turn and round: build the report and pack it
//   local     + what a game on one device does: keep the rounds and build the one message at the end
//
// and then flown again from its own recording (the replay), which has no CPUs to think. What is compared is
// the time of one `update` while a shot is in the air (the part a frame cannot spare: a frame is 16.7 ms at 60 Hz),
// the tail of the same (p99 and the worst) which is where a report built in the frame the flight ends shows up,
// and the time a whole match takes. CPU thinking is left out of the flight figures: it is done with a
// time budget per frame in the browser and does not belong to the statistics.
//
//   npm run bench:client
//
// Knobs (environment): MATCHES (4, per mode), ROUNDS (2), BENCH_JSON (a path: the figures as JSON).

import { writeFileSync } from 'node:fs';
import { createMatch, type Match } from '../src/game';
import type { GameMode } from '../src/modes';
import { RIDERS, type ReplayScript } from '../src/game/replay';
import { reportLocalGame, trackLocalGame } from '../src/localStats';
import { packWireMessage } from '../src/messagepack';
import { roundReport, turnReport, type TurnReport } from '../src/roundReport';
import { cloneSettings, DEFAULT_SETTINGS, type Seat, type Settings } from '../src/settings';
import { ShotLog } from '../src/shotLog';

const MATCHES = Number(process.env.MATCHES ?? 4);
const ROUNDS = Number(process.env.ROUNDS ?? 2);
const DT = 1 / 60;
const FRAME_MS = 1000 / 60;

const seats: Seat[] = ['hard', 'medium', 'medium', 'off', 'off', 'off'];
const settings = (mode: GameMode): Settings => ({ ...cloneSettings(DEFAULT_SETTINGS), rounds: ROUNDS, seats, powerUps: true, maxPlanets: 5, simultaneousShots: mode === 'classic' });

const pct = (sorted: number[], p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : NaN);
const fmt = (v: number, digits = 2) => (Number.isFinite(v) ? v.toLocaleString('en-US', { maximumFractionDigits: digits }) : 'n/a');

type Variant = 'baseline' | 'shot log' | 'reports' | 'local';
const VARIANTS: Variant[] = ['baseline', 'shot log', 'reports', 'local'];

/** The shot log's methods, to put back after the baseline has switched them off. */
const LOG_METHODS = ['launched', 'carry', 'ended', 'hit', 'bonus', 'placed', 'splits'] as const;
const originals = Object.fromEntries(LOG_METHODS.map((name) => [name, ShotLog.prototype[name]])) as Record<(typeof LOG_METHODS)[number], (...args: never[]) => unknown>;
function logging(on: boolean): void {
  for (const name of LOG_METHODS) (ShotLog.prototype as unknown as Record<string, unknown>)[name] = on ? originals[name] : () => undefined;
}

interface Figures {
  /** Seconds of `update` while a shot is in the air, one entry per call. */
  flight: number[];
  /** Milliseconds for the whole match. */
  wall: number;
  updates: number;
  reportsMs: number;
  reportBytes: number;
  recording: ReplayScript;
}

function play(mode: GameMode, seed: number, variant: Variant, script?: ReplayScript): Figures {
  logging(variant !== 'baseline' || !!script);
  const rules = settings(mode);
  const match: Match = createMatch(mode, rules, { seats, seed, deterministicCpu: true, simultaneous: mode === 'horizon' || rules.simultaneousShots, script });
  const figures: Figures = { flight: [], wall: 0, updates: 0, reportsMs: 0, reportBytes: 0, recording: { turns: [] } };
  const reports: TurnReport[] = [];
  if (!script && (variant === 'reports' || variant === 'local' || variant === 'shot log')) {
    // Every variant keeps the turn reports in the end, to record the match for the replay; only `reports` and `local` pay for them in the frame.
    match.onTurnEnd(() => {
      const t0 = performance.now();
      const report = turnReport(match);
      if (variant === 'reports' || variant === 'local') {
        const bytes = packWireMessage({ type: 'turn_stats', ...report });
        figures.reportBytes += bytes.byteLength;
        figures.reportsMs += performance.now() - t0;
      }
      reports.push(JSON.parse(JSON.stringify(report)));
    });
  }
  if (variant === 'reports') {
    match.on((event) => {
      if (event.type !== 'roundEnd') return;
      const t0 = performance.now();
      figures.reportBytes += packWireMessage({ type: 'round_stats', ...roundReport(match) }).byteLength;
      figures.reportsMs += performance.now() - t0;
    });
  }
  if (variant === 'local' && !script) {
    trackLocalGame(match, rules, (report) => {
      const t0 = performance.now();
      figures.reportBytes += packWireMessage({ type: 'local_game', ...report }).byteLength;
      figures.reportsMs += performance.now() - t0;
      void reportLocalGame;
    });
  }
  const start = performance.now();
  for (let i = 0; i < 400_000 && match.phase !== 'gameOver' && match.replayState === 'playing'; i++) {
    const flying = match.phase === 'flying';
    const t0 = performance.now();
    match.update(DT);
    const took = performance.now() - t0;
    if (flying) figures.flight.push(took);
    figures.updates++;
    if (match.phase === 'roundOver' && match.phaseTime > 1 && !script) match.advance();
  }
  figures.wall = performance.now() - start;
  figures.recording = {
    turns: reports.map((report) => ({
      round: report.round,
      turn: report.turn,
      placements: report.placements,
      shots: report.shots.filter((s) => !s.fork).map((s) => ({ player: s.player, angle: s.angle, power: s.power, rider: s.rider ?? RIDERS.find((r) => r === s.powerUp) ?? null, splitAt: s.splitAt })),
    })),
  };
  return figures;
}

interface Row {
  label: string;
  flightP50: number;
  flightP95: number;
  flightP99: number;
  flightMax: number;
  over: number;
  wall: number;
  reportsMs: number;
  reportKb: number;
}

function summarize(label: string, runs: Figures[]): Row {
  const flight = runs.flatMap((r) => r.flight).sort((a, b) => a - b);
  return {
    label,
    flightP50: pct(flight, 0.5),
    flightP95: pct(flight, 0.95),
    flightP99: pct(flight, 0.99),
    flightMax: flight.at(-1) ?? NaN,
    over: flight.filter((ms) => ms > FRAME_MS).length,
    wall: runs.reduce((sum, r) => sum + r.wall, 0) / runs.length,
    reportsMs: runs.reduce((sum, r) => sum + r.reportsMs, 0) / runs.length,
    reportKb: runs.reduce((sum, r) => sum + r.reportBytes, 0) / runs.length / 1024,
  };
}

const results: Record<string, Row[]> = {};

for (const mode of ['classic', 'horizon'] as GameMode[]) {
  console.log(`\n${mode}: ${MATCHES} seeded matches of ${ROUNDS} rounds, three CPUs${settings(mode).simultaneousShots ? ', everybody at once' : ''}, power-ups on`);
  // Warm up: the first matches pay for the engine's own start-up.
  for (const variant of VARIANTS) play(mode, 1, variant);
  const runs = new Map<string, Figures[]>(VARIANTS.map((v) => [v, []]));
  const replays: Figures[] = [];
  const recorded: Figures[] = [];
  // Interleaved, so a slow moment of the machine lands on every variant alike.
  for (let m = 0; m < MATCHES; m++) {
    for (const variant of VARIANTS) {
      const figures = play(mode, 100 + m, variant);
      runs.get(variant)!.push(figures);
      if (variant === 'local') recorded.push(figures);
    }
  }
  for (let m = 0; m < MATCHES; m++) replays.push(play(mode, 100 + m, 'shot log', recorded[m].recording));
  const rows = [...VARIANTS.map((v) => summarize(v, runs.get(v)!)), summarize('replay', replays)];
  results[mode] = rows;

  const base = rows[0];
  const line = (...cells: string[]) => console.log(cells[0].padEnd(10) + cells.slice(1).map((c) => c.padStart(15)).join(''));
  line('', 'flight p50 ms', 'flight p95 ms', 'flight p99 ms', 'flight max ms', `> ${fmt(FRAME_MS, 1)} ms`, 'match s', 'reports ms', 'reports KB');
  for (const r of rows) line(r.label, fmt(r.flightP50, 3), fmt(r.flightP95, 3), fmt(r.flightP99, 3), fmt(r.flightMax, 2), fmt(r.over, 0), fmt(r.wall / 1000, 2), fmt(r.reportsMs, 2), fmt(r.reportKb, 1));
  const local = rows[3];
  console.log(`vs baseline: flight p50 ${fmt(((rows[1].flightP50 - base.flightP50) / base.flightP50) * 100, 1)} % (shot log), ${fmt(((local.flightP50 - base.flightP50) / base.flightP50) * 100, 1)} % (everything); match time ${fmt(((local.wall - base.wall) / base.wall) * 100, 1)} %; replay takes ${fmt((rows[4].wall / rows[1].wall) * 100, 0)} % of the live match's time`);
}
if (process.env.BENCH_JSON) writeFileSync(process.env.BENCH_JSON, JSON.stringify(results, null, 2));
