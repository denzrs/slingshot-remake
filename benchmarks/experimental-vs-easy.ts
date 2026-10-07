import { createMatch } from '../src/game';
import type { CpuLevel } from '../src/ai';
import { createRng, hashSeed } from '../src/rng';
import { DEFAULT_SETTINGS, type Seat } from '../src/settings';

const SIM_SPEED = 5;
const MAX_UPDATES = 20_000;
const OPPONENTS: Exclude<CpuLevel, 'experimental'>[] = ['easy', 'medium', 'hard'];
const SHOW_AI_LOGS = process.env.EXPERIMENTAL_AI_LOGS === '1';
const DEFAULT_SEED = 0x5eedeed;

type FitStats = {
  relativeGravityRms: number;
  positionError: number;
  massError: number;
  samples: number;
  initialRms: number;
  finalRms: number;
  validationRms: number | null;
  fitMs: number;
  shot: number;
  hit: boolean;
  decision: 'exploit' | 'initialProbe' | 'probe' | 'fallback';
  hitRate: number;
};

type LengthBucket = { games: number; wins: number; draws: number; experimentalScore: number; opponentScore: number; mapRmsTotal: number; fitCount: number };
type Scenario = { mode: 'classic' | 'horizon'; bounce: boolean; fixedPower: boolean; maxPlanets: number };

type MatchupStats = {
  wins: number;
  draws: number;
  buckets: Map<number, LengthBucket>;
  fits: FitStats[];
};

function simulationCount(args: string[]): number {
  const argument = args.find((value) => value.startsWith('--sims='))?.slice('--sims='.length)
    ?? (args.includes('--sims') ? args[args.indexOf('--sims') + 1] : undefined);
  if (argument === undefined) return 100;
  const count = Number(argument);
  if (!Number.isSafeInteger(count) || count < 1) throw new Error('--sims must be a positive integer');
  return count;
}

function benchmarkSeed(args: string[]): number {
  const argument = args.find((value) => value.startsWith('--seed='))?.slice('--seed='.length)
    ?? (args.includes('--seed') ? args[args.indexOf('--seed') + 1] : undefined);
  if (argument === undefined) return DEFAULT_SEED;
  const seed = Number(argument);
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('--seed must be an unsigned 32-bit integer');
  return seed;
}

function scenarioFrom(args: string[]): Scenario {
  const mode = args.find((value) => value.startsWith('--mode='))?.slice('--mode='.length) ?? 'classic';
  if (mode !== 'classic' && mode !== 'horizon') throw new Error('--mode must be classic or horizon');
  const maxPlanets = Number(args.find((value) => value.startsWith('--planets='))?.slice('--planets='.length) ?? 4);
  if (!Number.isSafeInteger(maxPlanets) || maxPlanets < 1 || maxPlanets > 8) throw new Error('--planets must be an integer from 1 to 8');
  return { mode, bounce: args.includes('--bounce'), fixedPower: args.includes('--fixed-power'), maxPlanets };
}

function opponentsFrom(args: string[]): readonly Exclude<CpuLevel, 'experimental'>[] {
  const opponent = args.find((value) => value.startsWith('--opponent='))?.slice('--opponent='.length);
  if (opponent === undefined) return OPPONENTS;
  if (opponent !== 'easy' && opponent !== 'medium' && opponent !== 'hard') throw new Error('--opponent must be easy, medium, or hard');
  return [opponent];
}

function runMatchup(opponent: Exclude<CpuLevel, 'experimental'>, sims: number, seed: number, scenario: Scenario): MatchupStats {
  const stats: MatchupStats = { wins: 0, draws: 0, buckets: new Map(), fits: [] };
  const previousInfo = console.info;
  const previousLogSetting = process.env.EXPERIMENTAL_AI_LOGS;
  process.env.EXPERIMENTAL_AI_LOGS = '1';
  console.info = ((...args: unknown[]) => {
    const result = args[1] as {
      relativeGravityMapRms?: number;
      planetMatches?: { positionError: number; massError: number }[];
      samples?: number;
      initialRms?: number | null;
      rms?: number | null;
      validationRms?: number | null;
      fitMs?: number;
      shot?: number;
      decision?: { kind: FitStats['decision']; hitRate: number; worstMiss: number };
    } | undefined;
    if (result && typeof result.relativeGravityMapRms === 'number' && result.planetMatches && typeof result.samples === 'number' && result.decision) {
      stats.fits.push({
        relativeGravityRms: result.relativeGravityMapRms,
        positionError: result.planetMatches.reduce((sum, pair) => sum + pair.positionError, 0) / Math.max(1, result.planetMatches.length),
        massError: result.planetMatches.reduce((sum, pair) => sum + pair.massError, 0) / Math.max(1, result.planetMatches.length),
        samples: result.samples,
        initialRms: result.initialRms ?? 0,
        finalRms: result.rms ?? 0,
        validationRms: result.validationRms ?? null,
        fitMs: result.fitMs ?? 0,
        shot: result.shot ?? 0,
        hit: false,
        decision: result.decision.kind,
        hitRate: result.decision.hitRate,
      });
    }
    if (SHOW_AI_LOGS) previousInfo(...args);
  }) as typeof console.info;

  try {
    for (let sim = 0; sim < sims; sim++) {
      const experimentalFirst = sim % 2 === 0;
      const seats: Seat[] = experimentalFirst
        ? ['experimental', opponent, 'off', 'off', 'off', 'off']
        : [opponent, 'experimental', 'off', 'off', 'off', 'off'];
      const experimentalPlayer = experimentalFirst ? 0 : 1;
      const previousRandom = Math.random;
      Math.random = createRng(hashSeed('experimental-benchmark-world', seed, sim));
      let match;
      try {
        match = createMatch(scenario.mode, {
          ...DEFAULT_SETTINGS,
          seats,
          rounds: 1,
          teamMode: 0,
          maxPlanets: scenario.maxPlanets,
          invisiblePlanets: false,
          bounce: scenario.bounce,
          fixedPower: scenario.fixedPower,
        }, { seats });
      } finally {
        Math.random = previousRandom;
      }
      const fitsBefore = stats.fits.length;
      let updates = 0;
      while (match.phase !== 'roundOver' && updates < MAX_UPDATES) {
        match.update(SIM_SPEED);
        updates++;
      }
      if (match.phase !== 'roundOver') throw new Error(`Simulation ${sim + 1} vs ${opponent} did not finish after ${MAX_UPDATES} updates`);

      const shots = match.players.reduce((total, player) => total + player.shots, 0);
      const bucketStart = Math.floor((shots - 1) / 4) * 4 + 1;
      const bucket = stats.buckets.get(bucketStart) ?? { games: 0, wins: 0, draws: 0, experimentalScore: 0, opponentScore: 0, mapRmsTotal: 0, fitCount: 0 };
      bucket.games++;
      bucket.experimentalScore += match.players[experimentalPlayer].score;
      bucket.opponentScore += match.players[experimentalPlayer === 0 ? 1 : 0].score;
      const winner = match.summary?.survivor;
      if (winner === experimentalPlayer) {
        bucket.wins++;
        stats.wins++;
      } else if (winner === null) {
        bucket.draws++;
        stats.draws++;
      }
      const experimentalKills = new Set(match.killFeed.filter((kill) => kill.killer === experimentalPlayer && !kill.self && !kill.friendly).map((kill) => kill.shots));
      for (const fit of stats.fits.slice(fitsBefore)) fit.hit = experimentalKills.has(fit.shot);
      for (const fit of stats.fits.slice(fitsBefore)) {
        bucket.mapRmsTotal += fit.relativeGravityRms;
        bucket.fitCount++;
      }
      stats.buckets.set(bucketStart, bucket);
    }
  } finally {
    console.info = previousInfo;
    if (previousLogSetting === undefined) delete process.env.EXPERIMENTAL_AI_LOGS;
    else process.env.EXPERIMENTAL_AI_LOGS = previousLogSetting;
  }
  return stats;
}

function reportMatchup(opponent: Exclude<CpuLevel, 'experimental'>, sims: number, scenario: Scenario, stats: MatchupStats): void {
  console.log(`Experimental vs ${opponent}: ${sims} ${scenario.mode} matches, planets ${scenario.maxPlanets}, bounce ${scenario.bounce}, fixed power ${scenario.fixedPower}, first-shot power ${scenario.fixedPower ? '55 (fixed)' : '45'}`);
  console.log(`Experimental win rate: ${((stats.wins / sims) * 100).toFixed(1)}% (${stats.wins} wins, ${stats.draws} draws)`);
  console.log('Total shots | Matches | Experimental wins | Win rate | Map RMS | Score E/O');
  for (const [start, result] of [...stats.buckets].sort(([a], [b]) => a - b)) {
    const mapRms = result.fitCount === 0 ? '—' : `${((result.mapRmsTotal / result.fitCount) * 100).toFixed(1)}%`;
    const experimentalScore = result.experimentalScore / result.games;
    const opponentScore = result.opponentScore / result.games;
    console.log(`${start}-${start + 3}`.padEnd(12), String(result.games).padEnd(9), String(result.wins).padEnd(19), `${((result.wins / result.games) * 100).toFixed(1)}%`.padEnd(10), mapRms.padEnd(9), `${experimentalScore.toFixed(0)} / ${opponentScore.toFixed(0)}`);
  }

  const fitCount = stats.fits.length;
  let sampleTotal = 0;
  let positionTotal = 0;
  let massTotal = 0;
  let initialRmsTotal = 0;
  let finalRmsTotal = 0;
  let gravityErrorTotal = 0;
  let fitMsTotal = 0;
  let hitRateTotal = 0;
  let validationRmsTotal = 0;
  let validationCount = 0;
  const decisions: Record<FitStats['decision'], number> = { exploit: 0, initialProbe: 0, probe: 0, fallback: 0 };
  for (const fit of stats.fits) {
    sampleTotal += fit.samples;
    positionTotal += fit.positionError;
    massTotal += fit.massError;
    initialRmsTotal += fit.initialRms;
    finalRmsTotal += fit.finalRms;
    gravityErrorTotal += fit.relativeGravityRms;
    fitMsTotal += fit.fitMs;
    hitRateTotal += fit.hitRate;
    decisions[fit.decision]++;
    if (fit.validationRms !== null) {
      validationRmsTotal += fit.validationRms;
      validationCount++;
    }
  }
  console.log(`Gravity estimates: ${fitCount} (${(sampleTotal / Math.max(1, fitCount)).toFixed(0)} trajectory samples per fit)`);
  console.log(`Mean matched planet position error: ${(positionTotal / Math.max(1, fitCount)).toFixed(1)} units`);
  console.log(`Mean matched planet mass error: ${(massTotal / Math.max(1, fitCount)).toFixed(0)}`);
  console.log(`Mean relative gravity-map RMS: ${((gravityErrorTotal / Math.max(1, fitCount)) * 100).toFixed(1)}%`);
  console.log(`Mean trajectory-fit RMS: ${(initialRmsTotal / Math.max(1, fitCount)).toExponential(2)} → ${(finalRmsTotal / Math.max(1, fitCount)).toExponential(2)}`);
  console.log(`Mean held-out trajectory RMS: ${(validationRmsTotal / Math.max(1, validationCount)).toFixed(2)} (${validationCount} fits)`);
  console.log(`Mean fit time: ${(fitMsTotal / Math.max(1, fitCount)).toFixed(1)} ms.`);
  const experimentalScoreTotal = [...stats.buckets.values()].reduce((sum, bucket) => sum + bucket.experimentalScore, 0);
  const opponentScoreTotal = [...stats.buckets.values()].reduce((sum, bucket) => sum + bucket.opponentScore, 0);
  console.log(`Mean score, experimental / ${opponent}: ${(experimentalScoreTotal / sims).toFixed(0)} / ${(opponentScoreTotal / sims).toFixed(0)}`);
  console.log(`Mean robust hit rate: ${(hitRateTotal / Math.max(1, fitCount)).toFixed(2)}. Decisions: exploit ${decisions.exploit}, opening probe ${decisions.initialProbe}, probe ${decisions.probe}, fallback ${decisions.fallback}.`);
  const shotStages: Record<'1' | '2' | '3+', { fits: number; hits: number; validationTotal: number; validationCount: number; exploits: number }> = {
    1: { fits: 0, hits: 0, validationTotal: 0, validationCount: 0, exploits: 0 },
    2: { fits: 0, hits: 0, validationTotal: 0, validationCount: 0, exploits: 0 },
    '3+': { fits: 0, hits: 0, validationTotal: 0, validationCount: 0, exploits: 0 },
  };
  for (const fit of stats.fits) {
    const stage = fit.shot <= 1 ? shotStages[1] : fit.shot === 2 ? shotStages[2] : shotStages['3+'];
    stage.fits++;
    if (fit.hit) stage.hits++;
    if (fit.validationRms !== null) {
      stage.validationTotal += fit.validationRms;
      stage.validationCount++;
    }
    if (fit.decision === 'exploit') stage.exploits++;
  }
  console.log(`Experimental stages: shot 1 ${shotStages[1].fits} fits, shot 2 ${shotStages[2].fits} fits, shot 3+ ${shotStages['3+'].fits} fits.`);
  console.log(`Stage hit rate: 1 ${((shotStages[1].hits / Math.max(1, shotStages[1].fits)) * 100).toFixed(1)}%, 2 ${((shotStages[2].hits / Math.max(1, shotStages[2].fits)) * 100).toFixed(1)}%, 3+ ${((shotStages['3+'].hits / Math.max(1, shotStages['3+'].fits)) * 100).toFixed(1)}%.`);
  console.log(`Stage validation RMS: 1 ${(shotStages[1].validationTotal / Math.max(1, shotStages[1].validationCount)).toFixed(2)}, 2 ${(shotStages[2].validationTotal / Math.max(1, shotStages[2].validationCount)).toFixed(2)}, 3+ ${(shotStages['3+'].validationTotal / Math.max(1, shotStages['3+'].validationCount)).toFixed(2)}. Exploits: ${shotStages[1].exploits}/${shotStages[2].exploits}/${shotStages['3+'].exploits}.`);
}

function main(): void {
  const args = process.argv.slice(2);
  const sims = simulationCount(args);
  const seed = benchmarkSeed(args);
  const scenario = scenarioFrom(args);
  const opponents = opponentsFrom(args);
  console.log(`Experimental AI benchmark: ${sims} matches per opponent, seed ${seed}. Per-shot logs ${SHOW_AI_LOGS ? 'enabled' : 'disabled'}.`);
  for (const opponent of opponents) {
    const stats = runMatchup(opponent, sims, seed, scenario);
    reportMatchup(opponent, sims, scenario, stats);
  }
}

main();
