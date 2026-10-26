import { describe, expect, it } from 'vitest';
import { roundReport, turnReport, type ReportSource, type TurnSource } from '../../src/game/roundReport';
import type { ShotRecord } from '../../src/game/shotLog';
import { bump, newStatBook } from '../../src/data/stats';

describe('round report', () => {
  const source = (): ReportSource => ({
    round: 2,
    roundSeconds: 41.26,
    roundStats: newStatBook(),
    summary: { title: 'hit', survivor: 1, team: null },
    players: [
      { score: 120.4, shots: 3, alive: false },
      { score: 800, shots: 2, alive: true },
    ],
    world: { planets: [{}, {}, {}] },
    shotLog: { turn: 4 },
  });

  it('counts per seat, with zero for a seat the book never heard of', () => {
    const match = source();
    bump(match.roundStats.kills, 1);
    bump(match.roundStats.kills, 1);
    bump(match.roundStats.grazes, 0);
    const report = roundReport(match);
    expect(report.players[0]).toMatchObject({ score: 120, shots: 3, kills: 0, grazes: 1, alive: false });
    expect(report.players[1]).toMatchObject({ score: 800, kills: 2, grazes: 0, alive: true });
    expect(report).toMatchObject({ round: 2, title: 'hit', survivor: 1, team: null, seconds: 41.3, planets: 3, turns: 4 });
  });

  it("counts a seat's defense: missiles fired, shots brought down, ships hit by a stray", () => {
    const match = source();
    bump(match.roundStats.missiles, 1);
    bump(match.roundStats.missiles, 1);
    bump(match.roundStats.intercepts, 1);
    bump(match.roundStats.strayKills, 1);
    const report = roundReport(match);
    expect(report.players[0]).toMatchObject({ missiles: 0, intercepts: 0, strayKills: 0 });
    expect(report.players[1]).toMatchObject({ missiles: 2, intercepts: 1, strayKills: 1 });
  });

  it('lists the judged tips of both tipping games, and leaves the field out when nobody tipped', () => {
    const match = source();
    expect(roundReport(match)).not.toHaveProperty('tips');
    const tip = (stands: boolean) => ({ kind: 'round' as const, right: true, stake: 100, payout: 250, underdog: false, stands });
    match.oracle = { judged: [tip(false)] };
    match.stands = { judged: [tip(true)] };
    expect(roundReport(match).tips).toEqual([tip(false), tip(true)]);
  });

  it('carries the records without the shots behind them', () => {
    const match = source();
    match.roundStats.bestHit = { player: 1, value: 250, trail: [0, 0, 1, 1], at: { x: 1, y: 1 } };
    const report = roundReport(match);
    expect(report.records).toEqual({ bestHit: { player: 1, value: 250 } });
  });
});

describe('turn report', () => {
  const shot: ShotRecord = { n: 1, turn: 3, player: 0, angle: 33.3333, power: 61.26, powerUp: 'plasma', rider: 'plasma', fork: false, fan: null, splitAt: null, resolution: 'ship', hits: 1, hitSeat: 1, hitKind: 'enemy', points: 249.6 };
  const source = (): TurnSource => ({
    round: 2,
    players: [
      { score: 120.4, alive: false },
      { score: 800, alive: true },
    ],
    shotLog: { turn: 3, ofTurn: () => [shot], placementsOfTurn: () => [{ player: 1, kind: 'blackhole', x: 410.5, y: 220.25 }] },
  });

  it('names the turn and where the scores stand after it', () => {
    expect(turnReport(source())).toMatchObject({ round: 2, turn: 3, players: [{ score: 120, alive: false }, { score: 800, alive: true }] });
  });

  it('lists each shot of the turn with its aim exactly as aimed and its points rounded', () => {
    const [first] = turnReport(source()).shots;
    expect(first).toMatchObject({ player: 0, turn: 3, angle: 33.3333, power: 61.26, powerUp: 'plasma', resolution: 'ship', hitSeat: 1, hitKind: 'enemy', points: 250 });
  });

  it('lists the placements made before the turn', () => {
    expect(turnReport(source()).placements).toEqual([{ player: 1, kind: 'blackhole', x: 410.5, y: 220.25 }]);
  });
});
