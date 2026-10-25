import { createMatch, type Match } from '../src/game';
import { PowerUpField } from '../src/game/powerup-field';
import { DEFAULT_SETTINGS, type Seat } from '../src/data/settings';

/**
 * Armor piercing against the planetary defense cannon (PDK): free-for-all classic games of six Einsteins whose
 * only power-ups are those two. Prints one JSON line of totals for the seeds `--from` to `--to`; merge shards with
 * any script that sums the fields (shard the seeds across processes).
 *
 *   npx tsx benchmarks/ap-vs-pdk.ts --from 1 --to 250
 */
const args = new Map<string, number>();
process.argv.slice(2).forEach((arg, i, all) => {
  if (arg.startsWith('--') && /^[0-9.]+$/.test(all[i + 1] ?? '')) args.set(arg.slice(2), Number(all[i + 1]));
});
const FROM = args.get('from') ?? 1;
const TO = args.get('to') ?? 1000;

const t = { games: 0, planted: 0, apPicked: 0, apShots: 0, apShotsVsCannon: 0, wrecks: 0, shotdowns: 0, gamesWithCannon: 0, gamesWithAp: 0, gamesWithBoth: 0, gamesWithWreck: 0 };

const originalAims = PowerUpField.prototype.aimsFor;
PowerUpField.prototype.aimsFor = function (p) {
  const pierce = !!p.armed && p.powerUp === 'piercing';
  const host = (this as unknown as { host: { world(): Match['world'] } }).host;
  const cannon = host.world().defenses.some((d) => !d.wrecked && !d.protects.includes(p.id));
  const aims = originalAims.call(this, p);
  if (pierce) {
    t.apShots++;
    if (cannon) t.apShotsVsCannon++;
  }
  return aims;
};

const seats: Seat[] = Array<Seat>(6).fill('hard');
for (let seed = FROM; seed <= TO; seed++) {
  const match = createMatch(
    'classic',
    { ...DEFAULT_SETTINGS, powerUps: true, powerUpKinds: ['defense', 'piercing'], powerUpAmount: 4, rounds: 1, shotTime: 30, teamMode: 0, seats },
    { seats, seed, deterministicCpu: true },
  );
  let planted = 0;
  let ap = 0;
  let wrecks = 0;
  match.on((e) => {
    if (e.type === 'defense') planted++;
    else if (e.type === 'pickup' && e.kind === 'piercing') ap++;
    else if (e.type === 'defenseWrecked') wrecks++;
    else if (e.type === 'shotdown') t.shotdowns++;
  });
  for (let time = 0; match.phase !== 'gameOver' && time < 4000; time += 1 / 30) {
    match.update(1 / 30);
    if (match.phase === 'roundOver') match.advance();
  }
  t.games++;
  t.planted += planted;
  t.apPicked += ap;
  t.wrecks += wrecks;
  if (planted) t.gamesWithCannon++;
  if (ap) t.gamesWithAp++;
  if (planted && ap) t.gamesWithBoth++;
  if (wrecks) t.gamesWithWreck++;
}
console.log(JSON.stringify(t));
