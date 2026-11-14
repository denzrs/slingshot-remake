import { describe, expect, it } from 'vitest';
import { visibleMarks } from '../../src/game/markLegend';
import { createMatch, type Bonus, type ClassicMatch, type Mark, type Match } from '../../src/game';
import { DEFAULT_SETTINGS, type Seat, type Settings } from '../../src/data/settings';
import type { KillLedger } from '../../src/game/kill-ledger';
import type { MarkState } from '../../src/game/match-types';
import { SCORING } from '../../src/sim/config';
import { bountyPoints, underdogPoints } from '../../src/sim/scoring';

function field(ships: number, teams = 0, rules: Partial<Settings> = {}): { m: Match; paid: Bonus[][] } {
  const seats = Array.from({ length: 6 }, (_, i): Seat => (i < ships ? 'human' : 'off'));
  const m = createMatch('classic', { ...DEFAULT_SETTINGS, rounds: 9, seats, styleBonuses: false, neighborGrace: 0, teamMode: teams, ...rules }, { seats });
  const paid: Bonus[][] = [];
  m.on((e) => {
    if (e.type === 'bonus') paid.push(e.bonuses);
  });
  return { m, paid };
}

/** Changes what the match's ledger has on record: the private grudges a played round would have left, the chain, the round's first blood and its starting scores. */
function record(m: Match, set: Partial<MarkState>): void {
  const ledger = (m as unknown as { ledger: KillLedger }).ledger;
  ledger.restore({ ...ledger.state(), ...set });
}

/** The private grudges a played round would have left: who shot whom in the rounds before, and who is on a spree. */
function grudges(m: Match, set: { before?: [number, number][][]; chain?: [number, number][] }): void {
  record(m, { ...(set.before ? { before: set.before } : {}), ...(set.chain ? { chain: set.chain } : {}) });
}

/** The scores the round began with are the ones on the table now. */
const roundBegan = (m: Match): void => record(m, { roundScores: m.players.map((p) => p.score) });

const kinds = (marks: Mark[] | undefined) => (marks ?? []).map((mark) => mark.kind);
const pointsOf = (marks: Mark[] | undefined, kind: Mark['kind']) => marks?.find((mark) => mark.kind === kind)?.points;

/** `shooter` takes `victim` with a slow straight shot (see kill-bonuses.test.ts). */
function shoot(m: Match, shooter: number, victim: number): void {
  m.world.planets = [];
  m.world.ships.forEach((ship, id) => Object.assign(ship, id === shooter ? { x: 400, y: 400 } : id === victim ? { x: 800, y: 400 } : { x: 1200, y: 100 + id * 120 }));
  m.current = shooter;
  m.setAim(0, 20);
  m.commit();
  for (let t = 0; t < 30 && m.phase === 'flying'; t += 1 / 30) m.update(1 / 30);
  expect(m.players[victim].alive).toBe(false);
}

describe('marks on the cards', () => {
  it('put the bounty on the leader and the underdog on everybody above the one in last place', () => {
    const { m } = field(4);
    m.players.forEach((p, i) => (p.score = [500, 3000, 1800, 1200][i]));
    m.viewer = 0;
    expect(m.phase).toBe('aiming');
    const marks = m.cardMarks;
    expect(pointsOf(marks[1], 'bounty')).toBe(bountyPoints(1200));
    expect(kinds(marks[2])).not.toContain('bounty');
    for (const id of [1, 2, 3]) expect(pointsOf(marks[id], 'underdog')).toBe(underdogPoints(m.players[id].score - 500));
  });

  it('keep revenge, domination and the underdog to the person they are for, and the bounty for everybody', () => {
    const { m } = field(4);
    m.players.forEach((p, i) => (p.score = [500, 3000, 1800, 1200][i]));
    // Ship 3 shot ship 0 down last round; ship 2 was shot down by ship 0 in the last two.
    grudges(m, { before: [[[0, 3], [2, 0]], [[2, 0]]] });
    m.viewer = 0;
    expect(pointsOf(m.cardMarks[3], 'revenge')).toBe(SCORING.REVENGE);
    expect(pointsOf(m.cardMarks[2], 'domination')).toBe(SCORING.DOMINATION);
    // Another seat sees neither, and not the underdog either: it is not in last place.
    m.viewer = 1;
    expect(kinds(m.cardMarks[3])).toEqual([]);
    expect(kinds(m.cardMarks[2])).toEqual([]);
    expect(kinds(m.cardMarks[0])).not.toContain('underdog');
    // The stands see what is true of a ship for everybody.
    m.viewer = null;
    m.spectatorId = 0;
    expect(kinds(m.cardMarks[1])).toEqual(['bounty']);
    expect(kinds(m.cardMarks[3])).toEqual([]);
  });

  it('mark a ship on a spree, and put a comeback on the one alone in last place', () => {
    const { m } = field(4);
    m.players.forEach((p, i) => (p.score = [500, 3000, 1800, 1200][i]));
    roundBegan(m);
    grudges(m, { chain: [[2, 3]] });
    m.viewer = 1;
    expect(pointsOf(m.cardMarks[2], 'shutdown')).toBe(SCORING.SHUTDOWN_PER_KILL * 3);
    expect(pointsOf(m.cardMarks[0], 'comeback')).toBe(SCORING.COMEBACK);
    // A tie in last place is nobody's comeback.
    m.players[3].score = 500;
    roundBegan(m);
    expect(kinds(m.cardMarks[0])).not.toContain('comeback');
  });

  it('show on your own card what any kill of yours pays now: first blood, an opener and, from the second kill, the next link of the chain', () => {
    const { m } = field(3);
    m.viewer = 0;
    // The first kill of a round starts no chain.
    expect(m.cardMarks[0]).toEqual([
      { kind: 'firstBlood', points: SCORING.FIRST_BLOOD },
      { kind: 'opener', points: SCORING.OPENER },
    ]);
    // A ship that has fired is no opener any more, and once the round has had its first blood that goes too: what is left is the chain.
    m.players[0].shots = 1;
    grudges(m, { chain: [[0, 1]] });
    record(m, { firstBlood: true });
    expect(m.cardMarks[0]).toEqual([{ kind: 'chain', points: SCORING.MULTI_KILL[2] }]);
  });

  it('leave out teammates, the fallen and ships that are away, and say nothing once the shots are away', () => {
    const { m } = field(4, 2);
    m.players.forEach((p, i) => (p.score = [500, 3000, 1800, 1200][i]));
    m.viewer = 0;
    const team = m.players[0].team;
    const mate = m.players.find((p) => p.id !== 0 && p.team === team)!.id;
    expect(m.cardMarks[mate]).toEqual([]);
    const leader = m.players[1];
    leader.alive = false;
    expect(m.cardMarks[1]).toEqual([]);
    leader.alive = true;
    m.phase = 'flying';
    expect(m.cardMarks.flat()).toEqual([]);
  });

  it('promise a kill exactly the extras it then pays', () => {
    const { m, paid } = field(4);
    m.players.forEach((p, i) => (p.score = [500, 3000, 1800, 1200][i]));
    grudges(m, { before: [[[0, 1], [1, 0]], [[1, 0]]], chain: [[1, 2]] });
    m.viewer = 0;
    const promised = m.cardMarks[1].filter((mark) => mark.kind !== 'comeback').map(({ kind, points }) => ({ kind, points }));
    // Bounty, underdog, revenge, domination and a shutdown: everything a card can promise at once.
    expect(promised.map((mark) => mark.kind).sort()).toEqual(['bounty', 'domination', 'revenge', 'shutdown', 'underdog']);
    shoot(m, 0, 1);
    const own = new Set(['firstBlood', 'opener']);
    expect(paid[0].filter((bonus) => !own.has(bonus.kind))).toEqual(expect.arrayContaining(promised));
    expect(paid[0].filter((bonus) => !own.has(bonus.kind))).toHaveLength(promised.length);
  });

  it('read on a guest as on the host: for every seat, and the stands', () => {
    const host = field(4).m as ClassicMatch;
    host.players.forEach((p, i) => (p.score = [500, 3000, 1800, 1200][i]));
    grudges(host, { before: [[[0, 3]]], chain: [[2, 2]] });
    record(host, { firstBlood: true, roundScores: host.players.map((p) => p.score) });
    const guest = field(4).m as ClassicMatch;
    guest.restoreSnapshot(host.snapshot());
    for (const viewer of [0, 1, 2, 3]) {
      host.viewer = guest.viewer = viewer;
      expect(guest.cardMarks).toEqual(host.cardMarks);
    }
    guest.viewer = null;
    guest.spectatorId = 0;
    expect(kinds(guest.cardMarks[1])).toEqual(['bounty']);
    expect(pointsOf(guest.cardMarks[3], 'revenge')).toBeUndefined();
  });

  it('list for the legend only what is on the cards, grouped by kind, with whose card has it', () => {
    const { m } = field(4);
    m.players.forEach((p, i) => (p.score = [500, 3000, 1800, 1200][i]));
    grudges(m, { before: [[[0, 3]]], chain: [[2, 2]] });
    roundBegan(m);
    m.viewer = 0;
    const legend = visibleMarks(m);
    expect(legend.map((entry) => entry.kind)).toEqual(['bounty', 'shutdown', 'comeback', 'revenge', 'underdog', 'firstBlood', 'opener']);
    expect(legend.find((entry) => entry.kind === 'bounty')!.on).toEqual([{ id: 1, name: m.players[1].name, points: bountyPoints(1200), own: false }]);
    expect(legend.find((entry) => entry.kind === 'underdog')!.on.map((card) => card.id)).toEqual([1, 2, 3]);
    expect(legend.find((entry) => entry.kind === 'opener')!.on[0]).toMatchObject({ id: 0, own: true });
    // Nothing on the cards once the shots are away.
    m.phase = 'flying';
    expect(visibleMarks(m)).toEqual([]);
  });

  it('mark what a duel has: a bounty on the leader, revenge, first blood and an opener, but no underdog or spree', () => {
    const { m } = field(2);
    m.players.forEach((p, i) => (p.score = [900, 2100][i]));
    grudges(m, { before: [[[0, 1]]] });
    roundBegan(m);
    m.viewer = 0;
    expect(kinds(m.cardMarks[1])).toEqual(['bounty', 'revenge']);
    expect(kinds(m.cardMarks[0])).toEqual(['firstBlood', 'opener', 'comeback']);
  });
});
