import { describe, expect, it } from 'vitest';
import { createMatch, type Match } from '../src/game';
import { POWER_UP_KINDS, POWER_UP_WEIGHTS } from '../src/powerups';
import { SCORING } from '../src/config';
import { simulateShot, type World } from '../src/physics';
import { Volley } from '../src/volley';
import { DEFAULT_SETTINGS } from '../src/settings';

const rules = { bounce: false, timeLimit: 20 };

const world3 = (shields = false): World => ({
  width: 1280,
  height: 800,
  planets: [],
  holes: [],
  nebulae: [],
  version: 0,
  ships: [
    { x: 200, y: 400, alive: true },
    { x: 500, y: 400, alive: true, shield: shields },
    { x: 800, y: 400, alive: true },
  ],
});

/** A classic duel-plus-one, three humans, no planets: shots fly straight and predictable. */
function triple(seed = 13): Match {
  const seats = ['human', 'human', 'human', 'off', 'off', 'off'] as const;
  return createMatch('classic', { ...DEFAULT_SETTINGS, powerUps: true, rounds: 1, maxPlanets: 0, seats: [...seats] }, { seats: [...seats], seed });
}

describe('armor piercing power-up', () => {
  it('is a known kind', () => {
    expect(POWER_UP_KINDS).toContain('piercing');
    expect(POWER_UP_WEIGHTS.piercing).toBeGreaterThan(0);
  });

  it('flies through ship after ship where a plain shot stops on the first', () => {
    const plain = new Volley(world3(), [{ player: 0, angle: 0, power: 100 }], rules, false);
    while (!plain.done) plain.step();
    expect(plain.world.ships[1].alive).toBe(false);
    expect(plain.world.ships[2].alive).toBe(true);

    const piercing = new Volley(world3(), [{ player: 0, angle: 0, power: 100, pierce: true }], rules, false);
    const kills: number[] = [];
    while (!piercing.done) for (const e of piercing.step()) if (e.type === 'pierce') kills.push(e.ship);
    expect(kills).toEqual([1, 2]);
    expect(piercing.world.ships[1].alive).toBe(false);
    expect(piercing.world.ships[2].alive).toBe(false);
  });

  it('ignores a shield: a shielded hull is taken, not bounced', () => {
    const volley = new Volley(world3(true), [{ player: 0, angle: 0, power: 100, pierce: true }], rules, false);
    const bounced: string[] = [];
    while (!volley.done) for (const e of volley.step()) if (e.type === 'reflect') bounced.push(e.type);
    expect(bounced).toEqual([]);
    expect(volley.world.ships[1].alive).toBe(false);
  });

  it('is still stopped by a planet and by a black hole', () => {
    const planet: World = { ...world3(), planets: [{ x: 500, y: 400, radius: 40, mass: 30_000, seed: 1, style: 'rocky', tint: '#fff' }] };
    const onPlanet = new Volley(planet, [{ player: 0, angle: 0, power: 100, pierce: true }], rules, false);
    while (!onPlanet.done) onPlanet.step();
    expect(onPlanet.shots[0].shot.end?.kind).toBe('planet');

    const hole: World = { ...world3(), holes: [{ x: 800, y: 400, radius: 30, mass: 220_000 }] };
    const onHole = new Volley(hole, [{ player: 0, angle: 0, power: 100, pierce: true }], rules, false);
    while (!onHole.done) onHole.step();
    expect(onHole.shots[0].shot.end?.kind).toBe('hole');
  });

  it('reports the hulls it would go through to the planner', () => {
    const outcome = simulateShot(world3(), 0, 0, 100, rules, [], 1, [], true);
    expect(outcome.pierced).toEqual([1, 2]);
    // Without armor piercing the same aim stops on the first hull, and reports no pass-through.
    expect(simulateShot(world3(), 0, 0, 100, rules, [], 1, [], false).pierced).toEqual([]);
  });
});

describe('the multi-kill chain', () => {
  it('pays and announces every enemy a single piercing shot takes', () => {
    const match = triple();
    const events: { kills: number; points: number }[] = [];
    match.on((e) => {
      if (e.type === 'multiKill') events.push({ kills: e.kills, points: e.points });
    });
    const shooter = match.players[0];
    // Three ships on one line, so one straight shot can go through both of the others.
    [[200, 400], [500, 400], [800, 400]].forEach(([x, y], i) => {
      match.world.ships[i].x = x;
      match.world.ships[i].y = y;
    });
    shooter.powerUp = 'piercing';
    shooter.armed = true;
    shooter.angle = 0;
    shooter.power = 100;
    const before = shooter.score;
    match.commit();
    for (let t = 0; t < 120 && match.phase === 'flying'; t += 1 / 30) match.update(1 / 30);

    expect(match.players[1].alive).toBe(false);
    expect(match.players[2].alive).toBe(false);
    expect(events).toEqual([{ kills: 2, points: SCORING.MULTI_KILL[2] }]);
    expect(shooter.score).toBeGreaterThanOrEqual(before + SCORING.MULTI_KILL[2]);
    expect(shooter.powerUp).toBeNull();
  });

  it('counts a round\'s kills: one per turn walks the whole chain, and the next round starts over', () => {
    const seats = ['human', 'human', 'human', 'human', 'human', 'human'] as const;
    const match = createMatch('classic', { ...DEFAULT_SETTINGS, powerUps: true, rounds: 2, maxPlanets: 0, seats: [...seats] }, { seats: [...seats], seed: 13 });
    const awarded: number[] = [];
    let kills = 0;
    match.on((e) => {
      if (e.type === 'multiKill') awarded.push(e.kills);
      if (e.type === 'kill') kills++;
    });
    /** One turn: the shooter on the left, its victim straight ahead, everybody else clear of the line. */
    const act = (who: number, victim: number | null): void => {
      match.world.ships.forEach((ship, i) => {
        ship.x = i === who ? 200 : victim === i ? 600 : 400;
        ship.y = i === who || victim === i ? 400 : 100;
      });
      const p = match.players[who];
      p.power = 100;
      p.angle = victim === null ? 270 : 0;
      p.powerUp = victim === null ? null : 'piercing';
      p.armed = victim !== null;
      match.commit();
      for (let t = 0; t < 4000 && match.phase === 'flying'; t += 1 / 30) match.update(1 / 30);
    };
    const nextVictim = (): number | null => match.players.find((q) => q.id !== 0 && q.alive)?.id ?? null;
    /** Play on until `stop` says the round is over. Player 0 kills whoever stands in front of it; the rest miss. */
    const play = (stop: () => boolean): void => {
      for (let turns = 0; turns < 60 && !stop(); turns++) {
        for (let t = 0; t < 4000 && !(match.phase === 'aiming' && match.current >= 0); t += 1 / 30) {
          match.update(1 / 30);
          if (match.phase === 'roundOver' || match.phase === 'killcam') match.advance();
        }
        if (match.current < 0) return;
        const who = match.current;
        act(who, who === 0 ? nextVictim() : null);
      }
    };
    // Round 1: one enemy per turn, five turns, so the chain walks 2, 3, 4, 5 without any power-up fan.
    play(() => match.alive.length <= 1);
    expect(awarded).toEqual([2, 3, 4, 5]);
    // Round 2: the same killer's first kill of the new round is just that — a fresh chain.
    while (match.round < 2) {
      match.update(1 / 30);
      if (match.phase === 'roundOver' || match.phase === 'killcam') match.advance();
    }
    const beforeRoundTwo = kills;
    play(() => kills > beforeRoundTwo);
    expect(kills).toBe(beforeRoundTwo + 1);
    expect(awarded).toEqual([2, 3, 4, 5]);
  });
});
