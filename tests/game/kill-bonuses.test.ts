import { describe, expect, it } from 'vitest';
import { createMatch, type Bonus, type Match } from '../../src/game';
import { DEFAULT_SETTINGS, type Seat } from '../../src/data/settings';
import { SCORING, type BonusKind } from '../../src/sim/config';
import { bountyPoints, underdogPoints } from '../../src/sim/scoring';

/** `ships` ships on an empty field, no grace period, no trick shots: a straight shot hits what it is aimed at. */
function field(ships: number, teams = 0): { m: Match; paid: Bonus[][] } {
  const seats = Array.from({ length: 6 }, (_, i): Seat => (i < ships ? 'human' : 'off'));
  const m = createMatch('classic', { ...DEFAULT_SETTINGS, rounds: 9, seats, styleBonuses: false, neighborGrace: 0, teamMode: teams }, { seats });
  const paid: Bonus[][] = [];
  m.on((e) => {
    if (e.type === 'bonus') paid.push(e.bonuses);
  });
  return { m, paid };
}

/** `shooter` takes `victim` with a slow straight shot; whoever else is in the round waits well out of the way. */
function shoot(m: Match, shooter: number, victim: number, beforeFlight?: () => void): void {
  m.world.planets = [];
  m.world.ships.forEach((ship, id) => Object.assign(ship, id === shooter ? { x: 400, y: 400 } : id === victim ? { x: 800, y: 400 } : { x: 1200, y: 100 + id * 120 }));
  m.current = shooter;
  m.setAim(0, 20);
  m.commit();
  beforeFlight?.();
  for (let t = 0; t < 30 && m.phase === 'flying'; t += 1 / 30) m.update(1 / 30);
  expect(m.players[victim].alive).toBe(false);
}

const kinds = (list: Bonus[] | undefined) => (list ?? []).map((b) => b.kind);
const pointsOf = (list: Bonus[] | undefined, kind: BonusKind) => list?.find((b) => b.kind === kind)?.points;

describe('extras', () => {
  it('pay first blood for the first enemy of a round only, and an opener for each first shot', () => {
    const { m, paid } = field(4);
    const before = m.players[0].score;
    shoot(m, 0, 1);
    expect(paid[0]).toEqual([
      { kind: 'firstBlood', points: SCORING.FIRST_BLOOD },
      { kind: 'opener', points: SCORING.OPENER },
    ]);
    expect(m.players[0].score - before).toBe(m.lastKill!.points + SCORING.FIRST_BLOOD + SCORING.OPENER);
    expect(m.roundStats.bonuses).toEqual([
      { player: 0, kind: 'firstBlood', points: SCORING.FIRST_BLOOD },
      { player: 0, kind: 'opener', points: SCORING.OPENER },
    ]);
    // Ship 0's second shot: neither the round's first kill nor its own first shot.
    shoot(m, 0, 2);
    expect(paid).toHaveLength(1);
    // Ship 3's first shot is an opener, though not first blood.
    shoot(m, 3, 0);
    expect(kinds(paid[1])).toContain('opener');
    expect(kinds(paid[1])).not.toContain('firstBlood');
  });

  it('pay a bounty on the leader by their lead over the second, as it stood at launch', () => {
    const { m, paid } = field(3);
    m.players[1].score = 2000;
    m.players[2].score = 1200;
    shoot(m, 0, 1);
    expect(pointsOf(paid[0], 'bounty')).toBe(bountyPoints(800));
  });

  it('pay no bounty on a tie at the top, nor for a small lead; cap a big one', () => {
    const { m, paid } = field(3);
    m.players[1].score = 1000;
    m.players[2].score = 1000;
    shoot(m, 0, 1);
    expect(kinds(paid[0])).not.toContain('bounty');
    expect(bountyPoints(SCORING.BOUNTY_MIN_LEAD - 1)).toBe(0);
    expect(bountyPoints(100_000)).toBe(SCORING.BOUNTY_MAX);
  });

  it('pay the underdog alone in last place a share of the gap to the ship it takes', () => {
    const { m, paid } = field(3);
    m.players[1].score = 1500;
    m.players[2].score = 1000;
    shoot(m, 0, 2);
    expect(pointsOf(paid[0], 'underdog')).toBe(underdogPoints(1000));
    expect(underdogPoints(100_000)).toBe(SCORING.UNDERDOG_MAX);
  });

  it('pay no underdog in a duel, nor to a ship that shares last place', () => {
    const duel = field(2);
    duel.m.players[1].score = 1000;
    shoot(duel.m, 0, 1);
    expect(kinds(duel.paid[0])).not.toContain('underdog');
    const { m, paid } = field(3);
    m.players[2].score = 1000;
    shoot(m, 0, 2);
    expect(kinds(paid[0])).not.toContain('underdog');
  });

  it('pay revenge on whoever shot you down the round before, and only then', () => {
    const { m, paid } = field(3);
    shoot(m, 0, 1);
    m.startRound();
    // Ship 2 was never shot down by ship 0: nothing to avenge.
    shoot(m, 2, 0);
    expect(kinds(paid.at(-1))).not.toContain('revenge');
    m.startRound();
    // Ship 0 shot ship 1 down two rounds ago, not in the last one.
    shoot(m, 1, 0);
    expect(kinds(paid.at(-1))).not.toContain('revenge');
    m.startRound();
    // Ship 1 shot ship 0 down in the round before.
    shoot(m, 0, 1);
    expect(pointsOf(paid.at(-1), 'revenge')).toBe(SCORING.REVENGE);
  });

  it('pay domination for the same enemy rounds running, and double revenge on a dominator', () => {
    const { m, paid } = field(3);
    for (let round = 1; round <= SCORING.DOMINATION_ROUNDS; round++) {
      if (round > 1) m.startRound();
      shoot(m, 0, 1);
      expect(kinds(paid.at(-1)).includes('domination')).toBe(round === SCORING.DOMINATION_ROUNDS);
    }
    expect(pointsOf(paid.at(-1), 'domination')).toBe(SCORING.DOMINATION);
    m.startRound();
    shoot(m, 1, 0);
    expect(pointsOf(paid.at(-1), 'revenge')).toBe(SCORING.REVENGE * 2);
  });

  it('pay a shutdown for a ship on a spree, by the enemies it took', () => {
    const { m, paid } = field(4);
    shoot(m, 0, 1);
    shoot(m, 0, 2);
    shoot(m, 3, 0);
    expect(pointsOf(paid.find((list) => kinds(list).includes('shutdown')), 'shutdown')).toBe(SCORING.SHUTDOWN_PER_KILL * 2);
  });

  it("pay an avenger who takes a teammate's killer", () => {
    const { m, paid } = field(4, 2);
    const [a, mate] = m.players.filter((p) => p.team === 0).map((p) => p.id);
    const [enemy] = m.players.filter((p) => p.team === 1).map((p) => p.id);
    shoot(m, enemy, mate);
    shoot(m, a, enemy);
    expect(pointsOf(paid.at(-1), 'avenger')).toBe(SCORING.AVENGER);
  });

  it('pay a kill that lands after its shooter is gone', () => {
    const { m, paid } = field(3);
    shoot(m, 0, 1, () => (m.players[0].alive = false));
    expect(pointsOf(paid[0], 'posthumous')).toBe(SCORING.POSTHUMOUS);
  });

  it('pay a comeback at the end of the round', () => {
    const { m, paid } = field(3);
    m.players[1].score = 500;
    m.players[2].score = 400;
    m.startRound();
    shoot(m, 0, 1);
    shoot(m, 0, 2);
    expect(m.phase).not.toBe('aiming');
    expect(paid.at(-1)).toEqual([{ kind: 'comeback', points: SCORING.COMEBACK }]);
  });
});
