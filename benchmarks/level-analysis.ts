import { readFileSync } from 'node:fs';
import type { MatrixReport } from '../benchmarks/level-matrix';

/** Reads persisted level-matrix JSON slice files and prints head-to-head win-rate tables. */
const LABELS = ['Kepler', 'Newton', 'Einstein', 'Hawking', 'X-Kepler', 'X-Newton', 'X-Einstein'];

/** Slice reports share seed/rounds/pairs; merge rows/records for one coherent view. */
function loadAll(paths: string[]): MatrixReport {
  const reports = paths.map((path) => JSON.parse(readFileSync(path, 'utf8')) as MatrixReport);
  const first = reports[0];
  if (reports.some((report) => report.options.seed !== first.options.seed || report.options.rounds !== first.options.rounds || report.options.pairs !== first.options.pairs)) {
    throw new Error('Slices differ in seed/rounds/pairs — cannot merge');
  }
  return {
    ...first,
    options: { ...first.options, challengers: reports.flatMap((report) => report.options.challengers) },
    rows: reports.flatMap((report) => report.rows),
    records: reports.flatMap((report) => report.records),
  };
}

function winPoints(report: MatrixReport, mode: string, format: string, challenger: string, opponent: string): { mean: number | null; n: number } {
  const row = report.rows.find((row) => row.mode === mode && row.format === format && row.challenger === challenger && row.opponent === opponent);
  if (!row) return { mean: null, n: 0 };
  return { mean: row.summary.pairs.winPoints.mean, n: row.summary.pairs.winPoints.n };
}

function cell(mean: number | null): string {
  if (mean === null) return '   -- ';
  return `${(mean * 100).toFixed(0).padStart(4)}%`;
}

const SLICES: Record<string, string[]> = {
  classic: ['results/lm-c-Kepler.json', 'results/lm-c-Newton.json', 'results/lm-c-Einstein.json', 'results/lm-c-Hawking.json', 'results/lm-c-X.json'],
  horizon: ['results/lm-h-normal.json', 'results/lm-h-Hawking.json', 'results/lm-h-X.json'],
};

for (const [mode, paths] of Object.entries(SLICES)) {
  const report = loadAll(paths);
  console.log(`\n=== ${mode.toUpperCase()} — pair win points (challenger row vs opponent column), n=${report.options.pairs} pairs/cell, ${report.options.rounds} rounds/leg ===`);
  for (const format of report.options.formats) {
    console.log(`\n${format} (rows = challenger, cols = opponent):`);
    console.log(`          ${LABELS.map((l) => l.padEnd(9)).join('')}`);
    for (const challenger of LABELS) {
      const cells = LABELS.map((opponent) => {
        if (opponent === challenger) return '  same ';
        return cell(winPoints(report, mode, format, challenger, opponent).mean).padEnd(7);
      });
      console.log(`${challenger.padEnd(9)}${cells.join('')}`);
    }
  }
  console.log(`\n${mode} mean win points across all formats and opponents:`);
  const strength = LABELS.map((challenger) => {
    const points = LABELS.filter((opponent) => opponent !== challenger)
      .flatMap((opponent) => report.options.formats.map((format) => winPoints(report, mode, format, challenger, opponent).mean))
      .filter((mean): mean is number => mean !== null);
    return { label: challenger, mean: points.length ? points.reduce((sum, value) => sum + value, 0) / points.length : null };
  });
  for (const entry of strength.sort((a, b) => (b.mean ?? -1) - (a.mean ?? -1))) {
    console.log(`  ${entry.label.padEnd(10)} ${entry.mean === null ? 'N/A' : (entry.mean * 100).toFixed(1) + '%'}`);
  }
  const failed = report.records.filter((record) => record.status === 'failed');
  if (failed.length) console.log(`  FAILED legs: ${failed.length} — first: ${failed[0].failure}`);
}
