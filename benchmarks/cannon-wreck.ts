import { createMatch, type Match } from '../src/game';
import { PowerUpField } from '../src/game/powerup-field';
import { DEFAULT_SETTINGS, type Seat } from '../src/data/settings';

/**
 * How often an armor-piercing shot wrecks a planetary defense. Two runs:
 *  - natural: full CPU matches with power-ups on, counting how often AP and a cannon meet and what comes of it;
 *  - staged: a world with an enemy cannon and an Einstein holding armor piercing, to see how often it goes for the cannon.
 *
 *   npx tsx benchmarks/cannon-wreck.ts --matches 200 --trials 300
 */
const args = new Map<string, number>();
process.argv.slice(2).forEach((arg, i, all) => {
  if (arg.startsWith('--') && /^[0-9.]+$/.test(all[i + 1] ?? '')) args.set(arg.slice(2), Number(all[i + 1]));
});
const MATCHES = args.get('matches') ?? 200;
const TRIALS = args.get('trials') ?? 300;
const pad = (seats: Seat[]): Seat[] => [...seats, ...Array<Seat>(6 - seats.length).fill('off')];
const pct = (a: number, b: number): string => (b ? `${((100 * a) / b).toFixed(1)} %` : 'n/a');

let apShots = 0;
let apShotsVsCannon = 0;
const originalAims = PowerUpField.prototype.aimsFor;
PowerUpField.prototype.aimsFor = function (p) {
  const pierce = !!p.armed && p.powerUp === 'piercing';
  const host = (this as unknown as { host: { world(): Match['world'] } }).host;
  const cannon = host.world().defenses.some((d) => !d.wrecked && !d.protects.includes(p.id));
  const aims = originalAims.call(this, p);
  if (pierce) {
    apShots++;
    if (cannon) apShotsVsCannon++;
  }
  return aims;
};

function play(match: Match, seconds = 4000): void {
  for (let time = 0; match.phase !== 'gameOver' && time < seconds; time += 1 / 30) {
    match.update(1 / 30);
    if (match.phase === 'roundOver') match.advance();
  }
}

function natural(label: string, level: Seat): void {
  apShots = apShotsVsCannon = 0;
  let planted = 0;
  let apPicked = 0;
  let wrecks = 0;
  let matchesWithWreck = 0;
  let rounds = 0;
  for (let seed = 1; seed <= MATCHES; seed++) {
    const seats = pad([level, level, level, level]);
    const match = createMatch('classic', { ...DEFAULT_SETTINGS, powerUps: true, rounds: 3, maxPlanets: 3, seats }, { seats, seed, deterministicCpu: true });
    let w = 0;
    match.on((e) => {
      if (e.type === 'defense') planted++;
      else if (e.type === 'pickup' && e.kind === 'piercing') apPicked++;
      else if (e.type === 'defenseWrecked') w++;
      else if (e.type === 'round') rounds++;
    });
    play(match);
    wrecks += w;
    if (w) matchesWithWreck++;
  }
  console.log(`\n=== natural, 4x ${label}: ${MATCHES} matches`);
  console.log(`cannons planted ${planted}, AP picked up ${apPicked}, AP shots ${apShots} (${apShotsVsCannon} with an enemy cannon standing)`);
  console.log(`cannons wrecked ${wrecks} in ${matchesWithWreck} matches (${pct(wrecks, apShotsVsCannon)} of AP shots at a standing cannon)`);
}

/** Einstein holds AP; player 1 owns a cannon on a planet. Does player 0 go for it, and does it work? */
function staged(label: string, level: Seat): void {
  let trials = 0;
  let fired = 0;
  let wrecked = 0;
  let killed = 0;
  let shotsToWreck = 0;
  for (let seed = 1; seed <= TRIALS; seed++) {
    const seats = pad([level, level]);
    const match = createMatch('classic', { ...DEFAULT_SETTINGS, powerUps: true, rounds: 1, maxPlanets: 3, seats }, { seats, seed, deterministicCpu: true });
    const world = match.world;
    const near = [...world.planets].sort((a, b) => Math.hypot(a.x - world.ships[1].x, a.y - world.ships[1].y) - Math.hypot(b.x - world.ships[1].x, b.y - world.ships[1].y))[0];
    if (!near) continue;
    // The cannon faces player 0, as a CPU lays it.
    const to = Math.atan2(world.ships[0].y - near.y, world.ships[0].x - near.x);
    world.defenses.push({ x: near.x + Math.cos(to) * near.radius, y: near.y + Math.sin(to) * near.radius, radius: near.radius * 4, planet: near.seed, owner: 1, protects: [1] });
    match.players[0].powerUp = 'piercing';
    trials++;
    let p0Shots = 0;
    let done = false;
    match.on((e) => {
      if (e.type === 'fire' && e.player === 0 && !done) p0Shots++;
      if (e.type === 'defenseWrecked' && !done) { wrecked++; shotsToWreck += p0Shots; done = true; }
      if (e.type === 'kill' && e.record.killer === 0 && p0Shots === 1 && !done) killed++;
    });
    apShots = apShotsVsCannon = 0;
    for (let t = 0; match.phase !== 'roundOver' && match.phase !== 'gameOver' && t < 300 && p0Shots < 1; t += 1 / 30) match.update(1 / 30);
    // Let the first volley play out.
    for (let t = 0; t < 40 && match.phase !== 'roundOver'; t += 1 / 30) match.update(1 / 30);
    if (apShots) fired++;
  }
  console.log(`\n=== staged, ${label}: ${trials} worlds with an enemy cannon, player 0 holds AP`);
  console.log(`armed and fired AP: ${pct(fired, trials)}; wrecked the cannon with it: ${pct(wrecked, trials)}; killed the enemy with it: ${pct(killed, trials)}`);
}

natural('Einstein', 'hard');
natural('Medium', 'medium');
staged('Einstein', 'hard');
staged('Medium', 'medium');
