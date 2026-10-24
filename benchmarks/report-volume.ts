// How much a host reports to the relay's statistics per round: turns, shots and placements, and the
// simulated seconds they take. Sizes the relay's per-client write budget.
//
//   npx tsx benchmarks/report-volume.ts
//
// Knobs (environment): MATCHES (6, per mode and table size), ROUNDS (5).

import { createMatch, type VersusMode } from '../src/game';
import { turnReport } from '../src/roundReport';
import { cloneSettings, DEFAULT_SETTINGS, type Seat, type Settings } from '../src/settings';

const MATCHES = Number(process.env.MATCHES ?? 6);
const ROUNDS = Number(process.env.ROUNDS ?? 5);
const DT = 1 / 60;

const TABLES: Record<string, Seat[]> = {
  '2 ships': ['hard', 'hard', 'off', 'off', 'off', 'off'],
  '6 ships': ['hard', 'hard', 'medium', 'medium', 'easy', 'easy'],
};

const settings = (mode: VersusMode, seats: Seat[]): Settings => ({
  ...cloneSettings(DEFAULT_SETTINGS), rounds: ROUNDS, seats, powerUps: true, maxPlanets: 5, simultaneousShots: mode === 'classic',
});

for (const mode of ['classic', 'horizon'] as VersusMode[]) {
  for (const [table, seats] of Object.entries(TABLES)) {
    let turns = 0;
    let shots = 0;
    let placements = 0;
    let maxShots = 0;
    let seconds = 0;
    for (let seed = 1; seed <= MATCHES; seed++) {
      const rules = settings(mode, seats);
      const match = createMatch(mode, rules, { seats, seed, deterministicCpu: true, simultaneous: mode === 'horizon' || rules.simultaneousShots });
      match.onTurnEnd(() => {
        const report = turnReport(match);
        turns++;
        shots += report.shots.length;
        placements += report.placements?.length ?? 0;
        maxShots = Math.max(maxShots, report.shots.length);
      });
      for (let i = 0; i < 400_000 && match.phase !== 'gameOver'; i++) {
        match.update(DT);
        seconds += DT;
        if (match.phase === 'roundOver' && match.phaseTime > 1) match.advance();
      }
    }
    const rounds = MATCHES * ROUNDS;
    console.log(`${mode.padEnd(8)} ${table}: ${(turns / rounds).toFixed(1)} turns/round, ${(shots / turns).toFixed(2)} shots/turn (max ${maxShots}), `
      + `${(placements / turns).toFixed(2)} placements/turn, ${(seconds / turns).toFixed(1)} simulated s/turn`);
  }
}
