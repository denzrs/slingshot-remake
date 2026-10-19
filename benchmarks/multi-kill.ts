import { createMatch } from '../src/game';
import { DEFAULT_SETTINGS, type Seat } from '../src/settings';
import { SCORING } from '../src/config';

/**
 * Plays six-CPU rounds and counts how often the multi-kill chain actually fires: how many turns take two,
 * three, four or five ships, which the announcer calls DOUBLE / MULTI / MEGA / MONSTER KILL. Run it with:
 *
 *   npm run bench:multikill -- --matches 40 --rounds 3 --level medium --amount 4
 */
const args = new Map<string, number | string>();
process.argv.slice(2).forEach((arg, i, all) => {
  if (arg.startsWith('--')) args.set(arg.slice(2), /^[0-9.]+$/.test(all[i + 1] ?? '') ? Number(all[i + 1]) : (all[i + 1] ?? true));
});
const MATCHES = Number(args.get('matches') ?? 40);
const ROUNDS = Number(args.get('rounds') ?? 3);
const AMOUNT = Number(args.get('amount') ?? 4);
const LEVEL = String(args.get('level') ?? 'medium') as Seat;
const NAMES = ['', '', 'DOUBLE KILL', 'MULTI KILL', 'MEGA KILL', 'MONSTER KILL'];

const seats = Array<Seat>(6).fill(LEVEL);
const tiers = new Map<number, number>();
const sources = new Map<string, number>();
let rounds = 0;
let turns = 0;
let kills = 0;
let points = 0;
let matchesWithChain = 0;
let chains = 0;
let roundsWithChain = 0;

for (let seed = 1; seed <= MATCHES; seed++) {
  const match = createMatch('classic', { ...DEFAULT_SETTINGS, powerUps: true, powerUpAmount: AMOUNT, rounds: ROUNDS, maxPlanets: 4, seats }, { seats, seed, deterministicCpu: true });
  let seenInMatch = 0;
  const chainedRounds = new Set<number>();
  match.on((event) => {
    if (event.type === 'round') rounds++;
    if (event.type === 'fire') turns++;
    if (event.type === 'kill' && !event.record.self && !event.record.friendly) kills++;
    if (event.type === 'multiKill') {
      tiers.set(event.kills, (tiers.get(event.kills) ?? 0) + 1);
      // What made it a chain: a piercing round through hulls, a splitter's fan, or neither (a riddle).
      const shot = match.volley?.shots.find((vs) => vs.owner === event.player);
      const source = shot?.pierce ? 'armor piercing' : shot?.fan !== undefined ? 'splitter' : 'other';
      sources.set(source, (sources.get(source) ?? 0) + 1);
      points += event.points;
      chains++;
      seenInMatch++;
      chainedRounds.add(match.round);
    }
  });
  for (let time = 0; match.phase !== 'gameOver' && time < 6000; time += 1 / 30) {
    match.update(1 / 30);
    if (match.phase === 'roundOver' || match.phase === 'killcam') match.advance();
  }
  roundsWithChain += chainedRounds.size;
  if (seenInMatch) matchesWithChain++;
}

const share = (part: number, whole: number): string => (whole ? `${((100 * part) / whole).toFixed(1)}%` : 'n/a');
console.log(`\n=== multi-kill chain over ${MATCHES} matches x ${ROUNDS} rounds, six ${LEVEL} CPUs, ${AMOUNT} pickups`);
console.log(`turns fired ${turns}, enemies killed ${kills}, rounds played ${rounds}`);
console.log(`chain awards ${chains}: ${(chains / rounds).toFixed(3)} per round, ${(chains / MATCHES).toFixed(2)} per match`);
console.log(`matches with at least one chain ${share(matchesWithChain, MATCHES)}, rounds with one ${share(roundsWithChain, rounds)}`);
console.log(`bonus points paid ${points} (mean ${(points / Math.max(1, chains)).toFixed(0)} per award)`);
console.log(`chains by source: ${JSON.stringify(Object.fromEntries(sources))}`);
for (let kills = 2; kills <= 5; kills++) {
  const count = tiers.get(kills) ?? 0;
  console.log(
    `  ${String(kills)} in one turn — ${NAMES[kills].padEnd(12)} ${String(count).padStart(5)}  ${share(count, chains).padStart(6)} of awards, 1 in ${count ? Math.round(rounds / count) : '—'} rounds, pays ${SCORING.MULTI_KILL[kills]}`,
  );
}
