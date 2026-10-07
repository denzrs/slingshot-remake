import { createMatch } from '../src/game';
import { createRng, hashSeed } from '../src/rng';
import { DEFAULT_SETTINGS, type Seat } from '../src/settings';

const GAMES = 100;
const FRAME_TIME = 1 / 60;
const MAX_UPDATES = 120_000;
const DEFAULT_SEED = 0x5eedeed;
const EXPERIMENTAL_TEAM = 0;
const MEDIUM_TEAM = 1;

type Result = { winner: 'experimental' | 'medium' | null; experimentalScore: number; mediumScore: number; shots: number };

function benchmarkSeed(args: string[]): number {
  const argument = args.find((value) => value.startsWith('--seed='))?.slice('--seed='.length)
    ?? (args.includes('--seed') ? args[args.indexOf('--seed') + 1] : undefined);
  if (argument === undefined) return DEFAULT_SEED;
  const seed = Number(argument);
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('--seed must be an unsigned 32-bit integer');
  return seed;
}

function gameCount(args: string[]): number {
  const argument = args.find((value) => value.startsWith('--games='))?.slice('--games='.length)
    ?? (args.includes('--games') ? args[args.indexOf('--games') + 1] : undefined);
  if (argument === undefined) return GAMES;
  const games = Number(argument);
  if (!Number.isSafeInteger(games) || games < 2 || games > GAMES || games % 2 !== 0) throw new Error(`--games must be an even integer from 2 to ${GAMES}`);
  return games;
}

function runGame(game: number, seed: number): Result {
  const experimentalTeam = game % 2 === 0 ? EXPERIMENTAL_TEAM : MEDIUM_TEAM;
  const seats: Seat[] = experimentalTeam === EXPERIMENTAL_TEAM
    ? ['experimental', 'medium', 'experimental', 'medium', 'experimental', 'medium']
    : ['medium', 'experimental', 'medium', 'experimental', 'medium', 'experimental'];
  const seatTeams = experimentalTeam === EXPERIMENTAL_TEAM
    ? [EXPERIMENTAL_TEAM, MEDIUM_TEAM, EXPERIMENTAL_TEAM, MEDIUM_TEAM, EXPERIMENTAL_TEAM, MEDIUM_TEAM]
    : [MEDIUM_TEAM, EXPERIMENTAL_TEAM, MEDIUM_TEAM, EXPERIMENTAL_TEAM, MEDIUM_TEAM, EXPERIMENTAL_TEAM];
  const previousRandom = Math.random;
  Math.random = createRng(hashSeed('team-experimental-vs-medium-horizon-benchmark-world', seed, Math.floor(game / 2)));
  try {
    const match = createMatch('horizon', {
      ...DEFAULT_SETTINGS,
      seats,
      seatTeams,
      teamMode: 2,
      rounds: DEFAULT_SETTINGS.rounds,
      shotTime: 60,
      invisiblePlanets: false,
    });

    let updates = 0;
    while (match.phase !== 'gameOver' && updates < MAX_UPDATES) {
      match.update(FRAME_TIME);
      if ((match.phase === 'roundOver' && match.phaseTime >= 0.6) || match.phase === 'killcam') match.advance();
      updates++;
    }
    if (match.phase !== 'gameOver') throw new Error(`Game ${game + 1} did not finish after ${MAX_UPDATES} frames`);

    const [winner, runnerUp] = match.teamRanking();
    const winnerTeam = winner.score === runnerUp.score ? null : winner.team;
    return {
      winner: winnerTeam === null ? null : winnerTeam === experimentalTeam ? 'experimental' : 'medium',
      experimentalScore: match.players.filter((player) => player.team === experimentalTeam).reduce((total, player) => total + player.score, 0),
      mediumScore: match.players.filter((player) => player.team !== experimentalTeam).reduce((total, player) => total + player.score, 0),
      shots: match.players.reduce((total, player) => total + player.shots, 0),
    };
  } finally {
    Math.random = previousRandom;
  }
}

function main(): void {
  const args = process.argv.slice(2);
  const seed = benchmarkSeed(args);
  const games = gameCount(args);
  const worlds = games / 2;
  let experimentalLegWins = 0;
  let mediumLegWins = 0;
  let legDraws = 0;
  let experimentalScore = 0;
  let mediumScore = 0;
  let shots = 0;
  let experimentalTeamZeroWins = 0;
  let experimentalTeamOneWins = 0;
  let experimentalPairWins = 0;
  let mediumPairWins = 0;
  let pairDraws = 0;
  let firstLeg: Result | null = null;

  console.log(`Experimental (3) vs medium (3): ${games} paired Event Horizon team matches across ${worlds} worlds, seed ${seed}.`);
  console.log(`Rules: ${DEFAULT_SETTINGS.rounds} rounds, ${DEFAULT_SETTINGS.maxPlanets} planets maximum, 60-second shots, bounce off, fixed power off, neighbor grace off.`);
  for (let game = 0; game < games; game++) {
    const result = runGame(game, seed);
    if (result.winner === 'experimental') {
      experimentalLegWins++;
      if (game % 2 === 0) experimentalTeamZeroWins++;
      else experimentalTeamOneWins++;
    } else if (result.winner === 'medium') mediumLegWins++;
    else legDraws++;
    experimentalScore += result.experimentalScore;
    mediumScore += result.mediumScore;
    shots += result.shots;
    if (game % 2 === 0) firstLeg = result;
    else {
      const pairExperimentalScore = firstLeg!.experimentalScore + result.experimentalScore;
      const pairMediumScore = firstLeg!.mediumScore + result.mediumScore;
      if (pairExperimentalScore > pairMediumScore) experimentalPairWins++;
      else if (pairMediumScore > pairExperimentalScore) mediumPairWins++;
      else pairDraws++;
    }
    if ((game + 1) % 10 === 0 || game + 1 === games) console.log(`Completed ${game + 1}/${games} games.`);
  }

  console.log(`Leg results: experimental ${experimentalLegWins}, medium ${mediumLegWins}, draws ${legDraws}.`);
  console.log(`Experimental leg wins by side, team 0 / team 1: ${experimentalTeamZeroWins} / ${experimentalTeamOneWins}.`);
  console.log(`Paired score outcomes: experimental ${experimentalPairWins}, medium ${mediumPairWins}, draws ${pairDraws}.`);
  console.log(`Mean paired score, experimental / medium: ${(experimentalScore / worlds).toFixed(0)} / ${(mediumScore / worlds).toFixed(0)}.`);
  console.log(`Mean shots per leg: ${(shots / games).toFixed(1)}.`);
}

main();
