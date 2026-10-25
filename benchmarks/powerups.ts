import { createMatch } from '../src/game';
import { Shot } from '../src/sim/physics';
import { POWER_UP } from '../src/sim/powerups';
import { DEFAULT_SETTINGS, type Seat } from '../src/data/settings';
import { Volley } from '../src/sim/volley';

/**
 * Measures the power-ups: how many pickups a round sees, how many get taken and used by CPUs,
 * and how easy a pickup is to reach compared with hitting a ship. Run it before and after tuning the
 * constants in `src/powerups.ts`:
 *
 *   npm run bench:powerups -- --matches 30 --rounds 3 --worlds 80
 */
const args = new Map<string, number>();
process.argv.slice(2).forEach((arg, i, all) => {
  if (arg.startsWith('--') && /^[0-9.]+$/.test(all[i + 1] ?? '')) args.set(arg.slice(2), Number(all[i + 1]));
});
const MATCHES = args.get('matches') ?? 30;
const ROUNDS = args.get('rounds') ?? 3;
const WORLDS = args.get('worlds') ?? 80;

let splitCalls = 0;
const originalSplit = Volley.prototype.split;
Volley.prototype.split = function (...splitArgs) {
  const done = originalSplit.apply(this, splitArgs);
  if (done) splitCalls++;
  return done;
};

const pad = (seats: Seat[]): Seat[] => [...seats, ...Array<Seat>(6 - seats.length).fill('off')];
const average = (values: number[]): number => (values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : 0);
const percent = (part: number, whole: number): string => (whole ? `${((100 * part) / whole).toFixed(0)} %` : 'n/a');

function supply(label: string, seats: Seat[]): void {
  let rounds = 0;
  let shots = 0;
  let spawned = 0;
  let collected = 0;
  let leftover = 0;
  let teleports = 0;
  let roundsWithPickup = 0;
  const shotsPerRound: number[] = [];
  const by: Record<string, number> = {};
  splitCalls = 0;
  for (let seed = 1; seed <= MATCHES; seed++) {
    const full = pad(seats);
    const match = createMatch('classic', { ...DEFAULT_SETTINGS, powerUps: true, rounds: ROUNDS, maxPlanets: 3, seats: full }, { seats: full, seed, deterministicCpu: true });
    const original = (match as unknown as { power: { teleport: (id: number) => boolean } }).power;
    const teleport = original.teleport.bind(original);
    original.teleport = (id: number) => {
      const done = teleport(id);
      if (done) teleports++;
      return done;
    };
    let seen = new Set(match.pickups.map((p) => p.id));
    let taken = 0;
    let fired = 0;
    let over = false;
    spawned += seen.size;
    rounds++;
    match.on((event) => {
      if (event.type === 'round') {
        seen = new Set(match.pickups.map((p) => p.id));
        spawned += seen.size;
        rounds++;
        taken = 0;
        fired = 0;
        over = false;
      } else if (event.type === 'fire') {
        shots++;
        fired++;
      } else if (event.type === 'pickup') {
        collected++;
        taken++;
        const key = `${match.players[event.player].cpu ? 'cpu' : 'human'}:${event.kind}`;
        by[key] = (by[key] ?? 0) + 1;
      }
    });
    for (let time = 0; match.phase !== 'gameOver' && time < 4000; time += 1 / 30) {
      match.update(1 / 30);
      for (const pickup of match.pickups) {
        if (!seen.has(pickup.id)) {
          seen.add(pickup.id);
          spawned++;
        }
      }
      if (match.phase === 'roundOver') {
        if (!over) {
          over = true;
          leftover += match.pickups.length;
          if (taken) roundsWithPickup++;
          shotsPerRound.push(fired);
        }
        match.advance();
      }
    }
  }
  const sorted = [...shotsPerRound].sort((a, b) => a - b);
  console.log(`\n=== ${label}: ${MATCHES} matches x ${ROUNDS} rounds`);
  console.log(`shots per round: mean ${average(shotsPerRound).toFixed(2)}, median ${sorted[Math.floor(sorted.length / 2)]}, rounds over within 2 shots ${percent(sorted.filter((n) => n <= 2).length, sorted.length)}`);
  console.log(`pickups: ${(spawned / rounds).toFixed(2)} laid per round, ${percent(collected, spawned)} taken (${(collected / rounds).toFixed(2)} per round), ${percent(spawned - collected - leftover, spawned)} faded, ${percent(leftover, spawned)} left at round end`);
  console.log(`rounds in which a pickup was taken: ${percent(roundsWithPickup, rounds)}`);
  console.log(`taken by: ${JSON.stringify(by)}`);
  console.log(`CPU use: teleports ${teleports}, splits ${splitCalls}`);
}

/** How many sampled shots from ship 0 touch each pickup, against how many touch the enemy ship. */
function reach(): void {
  const rules = { bounce: false, timeLimit: 20 };
  const powers = [20, 35, 50, 65, 80, 100];
  const pickupShare: number[] = [];
  const enemyShare: number[] = [];
  let pickups = 0;
  let unreachable = 0;
  for (let seed = 1; seed <= WORLDS; seed++) {
    const seats = pad(['human', 'human']);
    const match = createMatch('classic', { ...DEFAULT_SETTINGS, powerUps: true, rounds: 1, maxPlanets: 3, seats }, { seats, seed });
    const world = match.world;
    const targets = [...match.pickups.map((p) => ({ x: p.x, y: p.y, r: POWER_UP.PICKUP_RADIUS, pickup: true })), { x: world.ships[1].x, y: world.ships[1].y, r: 13, pickup: false }];
    const hits = targets.map(() => 0);
    let combos = 0;
    for (let angle = 0; angle < 360; angle += 2) {
      for (const power of powers) {
        combos++;
        const shot = new Shot(world, 0, angle, power, rules);
        const touched = targets.map(() => false);
        while (!shot.end) {
          shot.step();
          targets.forEach((t, i) => {
            if (!touched[i] && Math.hypot(shot.x - t.x, shot.y - t.y) < t.r) touched[i] = true;
          });
        }
        touched.forEach((hit, i) => {
          if (hit) hits[i]++;
        });
      }
    }
    targets.forEach((t, i) => {
      if (!t.pickup) return enemyShare.push(hits[i] / combos);
      pickups++;
      if (!hits[i]) unreachable++;
      pickupShare.push(hits[i] / combos);
    });
  }
  console.log(`\n=== Reach: ${WORLDS} duel worlds, ${pickups} pickups at round start (shots from ship 0)`);
  console.log(`pickups no sampled shot reaches: ${unreachable}`);
  console.log(`sampled shots touching a pickup ${(100 * average(pickupShare)).toFixed(2)} %, touching the enemy ship ${(100 * average(enemyShare)).toFixed(2)} %`);
}

supply('Duel (Einstein vs Einstein)', ['hard', 'hard']);
supply('Four CPUs (Newton)', ['medium', 'medium', 'medium', 'medium']);
reach();
