import { describe, expect, it } from 'vitest';
import { createMatch, type GameEvent, type Match } from '../src/game';
import type { ClassicMatch } from '../src/game/classic';
import type { Planet } from '../src/physics';
import { awards, bump, improve, newStatBook, pathLength } from '../src/stats';
import { DEFAULT_SETTINGS, type Seat } from '../src/settings';

describe('stat book', () => {
  it('measures a polyline', () => {
    expect(pathLength([0, 0, 3, 4, 3, 10])).toBe(11);
    expect(pathLength([5, 5])).toBe(0);
  });

  it('keeps the first holder of a tied record', () => {
    expect(improve(null, 1, 10, true)).toEqual({ player: 1, value: 10 });
    expect(improve({ player: 1, value: 10 }, 2, 10, true)).toEqual({ player: 1, value: 10 });
    expect(improve({ player: 1, value: 10 }, 2, 11, true)).toEqual({ player: 2, value: 11 });
    expect(improve({ player: 1, value: 10 }, 2, 9, false)).toEqual({ player: 2, value: 9 });
  });

  it('hands out nothing for nothing', () => {
    expect(awards(newStatBook())).toEqual([]);
    const book = newStatBook();
    bump(book.kills, 1);
    // One kill is just winning the round.
    expect(awards(book)).toEqual([]);
    bump(book.kills, 1);
    expect(awards(book)).toEqual([{ kind: 'kills', players: [1], value: 2 }]);
  });

  it('shares an award among everybody tied at the top', () => {
    const book = newStatBook();
    bump(book.swingbys, 0);
    bump(book.swingbys, 2);
    bump(book.swingbys, 1);
    bump(book.swingbys, 1);
    expect(awards(book)).toEqual([{ kind: 'swingbys', players: [1], value: 2 }]);
    bump(book.swingbys, 0);
    expect(awards(book)[0]).toEqual({ kind: 'swingbys', players: [0, 1], value: 2 });
  });
});

describe('scorecard in a match', () => {
  const seats: Seat[] = ['human', 'human', 'off', 'off', 'off', 'off'];
  /** A tiny planet just under the straight line from ship 0 to ship 1 — the shot grazes it on its way. */
  const pebble: Planet = { x: 600, y: 407, radius: 4, mass: 64, seed: 1, style: 'rocky', tint: '#fff' };

  function duel(styleBonuses: boolean): { m: ClassicMatch; events: GameEvent[] } {
    const m = createMatch('classic', { ...DEFAULT_SETTINGS, rounds: 1, seats, styleBonuses, fixedPower: true }, { seats }) as ClassicMatch;
    m.world.planets = [pebble];
    Object.assign(m.world.ships[0], { x: 100, y: 400 });
    Object.assign(m.world.ships[1], { x: 1100, y: 400 });
    const events: GameEvent[] = [];
    m.on((e) => events.push(e));
    return { m, events };
  }

  function shoot(m: Match): void {
    m.setAim(0, 55);
    m.commit();
    for (let t = 0; t < 30 && m.phase === 'flying'; t += 1 / 30) m.update(1 / 30);
  }

  it('records the longest shot, the fastest kill, the best hit and the grazes', () => {
    const { m } = duel(false);
    shoot(m);
    const book = m.roundStats;
    expect(m.lastKill).toMatchObject({ killer: 0, victim: 1 });
    expect(book.longestShot!.player).toBe(0);
    expect(book.longestShot!.value).toBeGreaterThan(900);
    expect(book.longestShot!.value).toBeLessThan(1100);
    expect(book.kills).toEqual([1]);
    expect(book.grazes).toEqual([1]);
    expect(book.fastestKill).toEqual({ player: 0, value: expect.any(Number) });
    expect(book.bestHit).toEqual({ player: 0, value: m.lastKill!.points });
    expect(awards(book).map((a) => a.kind)).toEqual(['longestShot', 'fastestKill', 'grazes', 'bestHit']);
    // The match keeps the same record (one round).
    expect(m.matchStats).toEqual(book);
  });

  it('counts trick shots without paying for them — and without calling them out — unless the option is on', () => {
    const plain = duel(false);
    shoot(plain.m);
    expect(plain.m.lastKill).toMatchObject({ multiplier: 1, combo: [] });
    expect(plain.events.some((e) => e.type === 'style')).toBe(false);

    const paid = duel(true);
    shoot(paid.m);
    expect(paid.m.lastKill!.multiplier).toBeGreaterThan(1);
    expect(paid.events.some((e) => e.type === 'style')).toBe(true);
    expect(paid.m.roundStats.grazes).toEqual([1]);
  });

  it('start over with every round, and with every match', () => {
    const { m } = duel(false);
    shoot(m);
    expect(m.roundStats.kills).toEqual([1]);
    m.startRound();
    expect(m.roundStats).toEqual(newStatBook());
    expect(m.matchStats.kills).toEqual([1]);
    m.newMatch();
    expect(m.matchStats).toEqual(newStatBook());
  });

  it('are what the guests see: they travel with the snapshot', () => {
    const { m } = duel(false);
    shoot(m);
    const guest = createMatch('classic', { ...DEFAULT_SETTINGS, seats }, { seats }) as ClassicMatch;
    guest.restoreSnapshot(JSON.parse(JSON.stringify(m.snapshot())));
    expect(guest.roundStats).toEqual(m.roundStats);
    expect(guest.matchStats).toEqual(m.matchStats);
  });

  it('keep self-hits out of the kill records', () => {
    const m = createMatch('classic', { ...DEFAULT_SETTINGS, rounds: 1, seats, bounce: true, fixedPower: true }, { seats }) as ClassicMatch;
    m.world.planets = [];
    Object.assign(m.world.ships[0], { x: 100, y: 400 });
    Object.assign(m.world.ships[1], { x: 1100, y: 700 });
    // Straight up, off the top edge and back down onto the shooter's own ship.
    m.setAim(90, 55);
    m.commit();
    for (let t = 0; t < 30 && m.phase === 'flying'; t += 1 / 30) m.update(1 / 30);
    expect(m.lastKill).toMatchObject({ killer: 0, victim: 0, self: true });
    expect(m.roundStats.kills).toEqual([]);
    expect(m.roundStats.fastestKill).toBeNull();
    expect(m.roundStats.bestHit).toBeNull();
    // The shot still counts as a long one.
    expect(m.roundStats.longestShot!.value).toBeGreaterThan(700);
  });
});
