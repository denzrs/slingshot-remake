import { describe, expect, it } from 'vitest';
import { createMatch, type Match } from '../src/game';
import { PHYSICS } from '../src/config';
import { POWER_UP, previewPath, SPLIT_TURNS, spawnPickup, teleportSpot, touchedPickups, type Pickup } from '../src/powerups';
import { createRng } from '../src/rng';
import type { World } from '../src/physics';
import { DEFAULT_SETTINGS } from '../src/settings';
import { Volley } from '../src/volley';

const rules = { bounce: false, timeLimit: 20 };

function emptyWorld(ships: [number, number][] = [[300, 400], [900, 400]]): World {
  return { width: 1280, height: 800, planets: [], ships: ships.map(([x, y]) => ({ x, y, alive: true })), hole: null, version: 0 };
}

/** A human duel with power-ups on, no planets, so flights are straight and predictable. */
function duel(seed = 7): Match {
  const seats = ['human', 'human', 'off', 'off', 'off', 'off'] as const;
  return createMatch('classic', { ...DEFAULT_SETTINGS, powerUps: true, rounds: 1, maxPlanets: 0, seats: [...seats] }, { seats: [...seats], seed });
}

/** Lets the current volley fly until the match is back on aiming (or the round ends). */
function finishFlight(match: Match): void {
  for (let t = 0; t < 120 && match.phase === 'flying'; t += 1 / 30) match.update(1 / 30);
}

describe('power-up placement', () => {
  it('spawns pickups clear of planets, ships and each other, inside the edge margin', () => {
    const world = { ...emptyWorld(), planets: [{ x: 640, y: 400, radius: 60, mass: 1, seed: 1, style: 'rocky' as const, tint: '#fff' }] };
    const rng = createRng(3);
    const pickups: Pickup[] = [];
    for (let i = 0; i < POWER_UP.MAX_ON_FIELD; i++) {
      const p = spawnPickup(world, rng, pickups, 'teleport', i, 0);
      expect(p).not.toBeNull();
      pickups.push(p!);
    }
    for (const p of pickups) {
      expect(p.x).toBeGreaterThanOrEqual(POWER_UP.EDGE);
      expect(p.x).toBeLessThanOrEqual(world.width - POWER_UP.EDGE);
      expect(p.y).toBeGreaterThanOrEqual(POWER_UP.EDGE);
      expect(p.y).toBeLessThanOrEqual(world.height - POWER_UP.EDGE);
      expect(Math.hypot(p.x - 640, p.y - 400)).toBeGreaterThan(60 + POWER_UP.PLANET_GAP);
    }
    for (let i = 0; i < pickups.length; i++) {
      for (let j = i + 1; j < pickups.length; j++) {
        expect(Math.hypot(pickups[i].x - pickups[j].x, pickups[i].y - pickups[j].y)).toBeGreaterThanOrEqual(POWER_UP.PICKUP_GAP);
      }
    }
  });

  it('finds a teleport spot well away from planets and ships', () => {
    const world = { ...emptyWorld(), planets: [{ x: 640, y: 400, radius: 80, mass: 1, seed: 1, style: 'gas' as const, tint: '#fff' }] };
    const spot = teleportSpot(world, createRng(11));
    expect(spot).not.toBeNull();
    expect(Math.hypot(spot!.x - 640, spot!.y - 400)).toBeGreaterThan(80 + POWER_UP.TELEPORT_PLANET_GAP);
    for (const s of world.ships) expect(Math.hypot(spot!.x - s.x, spot!.y - s.y)).toBeGreaterThanOrEqual(POWER_UP.TELEPORT_SHIP_GAP);
  });
});

describe('preview path', () => {
  it('starts at the muzzle and stops after the preview time when nothing is hit', () => {
    const world = emptyWorld([[100, 400], [1200, 100]]);
    const path = previewPath(world, 0, 0, 40, rules);
    // Straight to the right from the muzzle.
    expect(path[0]).toBeCloseTo(100 + PHYSICS.MUZZLE, 5);
    expect(path[1]).toBeCloseTo(400, 5);
    const steps = POWER_UP.PREVIEW_SECONDS / PHYSICS.DT;
    expect(path.length / 2).toBeLessThanOrEqual(steps / 4 + 3);
    expect(path.length).toBeGreaterThan(4);
  });
});

describe('splitter', () => {
  it('forks a flying shot into three that share one fan group and never cancel each other', () => {
    const world = emptyWorld();
    const volley = new Volley(world, [{ player: 0, angle: 90, power: 50 }], rules, false);
    for (let i = 0; i < 20; i++) volley.step();
    expect(volley.split(0, SPLIT_TURNS, 7)).toBe(true);
    expect(volley.shots.length).toBe(3);
    expect(volley.snapshot().aims.every((a) => a.fan === 7)).toBe(true);
    const clashes = [];
    for (let i = 0; i < 40; i++) clashes.push(...volley.step().filter((e) => e.type === 'end' && e.end.kind === 'clash'));
    expect(clashes).toEqual([]);
    // The two copies leave the original's path on either side of it.
    const [a, b, c] = volley.shots.map((vs) => Math.atan2(vs.shot.vy, vs.shot.vx));
    expect(a).not.toBeCloseTo(b, 3);
    expect(c).not.toBeCloseTo(b, 3);
  });

  it('does not split a shot that has already ended', () => {
    const volley = new Volley(emptyWorld(), [{ player: 0, angle: 90, power: 50 }], rules, false);
    volley.shots[0].shot.terminate({ kind: 'lost' });
    expect(volley.split(0, SPLIT_TURNS, 1)).toBe(false);
  });

  it('two unfanned shots from the same muzzle still clash', () => {
    const plain = new Volley(emptyWorld(), [
      { player: 0, angle: 90, power: 50 },
      { player: 0, angle: 90.02, power: 50 },
    ], rules, false);
    expect(plain.step().filter((e) => e.type === 'end' && e.end.kind === 'clash').length).toBeGreaterThan(0);
  });
});

describe('pickups on the path of a shot', () => {
  it('reports the pickups within reach of a point', () => {
    const pickups: Pickup[] = [
      { id: 1, kind: 'preview', x: 100, y: 100, born: 0 },
      { id: 2, kind: 'splitter', x: 400, y: 400, born: 0 },
    ];
    expect(touchedPickups(pickups, 105, 100)).toEqual([0]);
    expect(touchedPickups(pickups, 250, 250)).toEqual([]);
  });
});

describe('power-ups in a match', () => {
  it('starts a round with pickups on the field when the setting is on', () => {
    expect(duel().pickups.length).toBe(POWER_UP.START_COUNT);
  });

  it('has no pickups when the setting is off', () => {
    const seats = ['human', 'human', 'off', 'off', 'off', 'off'] as const;
    const match = createMatch('classic', { ...DEFAULT_SETTINGS, rounds: 1, maxPlanets: 0, seats: [...seats] }, { seats: [...seats], seed: 7 });
    expect(match.pickups).toEqual([]);
  });

  it('gives a held power-up to the shooter whose shot takes a pickup', () => {
    const match = duel();
    const shooter = match.players[match.current];
    const ship = match.world.ships[shooter.id];
    match.pickups = [{ id: 99, kind: 'teleport', x: ship.x + Math.cos(0) * 40, y: ship.y, born: 0 }];
    shooter.angle = 0;
    shooter.power = 60;
    match.commit();
    expect(match.phase).toBe('flying');
    finishFlight(match);
    expect(shooter.powerUp).toBe('teleport');
    expect(match.pickups.find((p) => p.id === 99)).toBeUndefined();
  });

  it('swaps the held power-up when a shot takes another one', () => {
    const match = duel();
    const shooter = match.players[match.current];
    shooter.powerUp = 'preview';
    const ship = match.world.ships[shooter.id];
    match.pickups = [{ id: 98, kind: 'splitter', x: ship.x + 40, y: ship.y, born: 0 }];
    shooter.angle = 0;
    match.commit();
    finishFlight(match);
    expect(shooter.powerUp).toBe('splitter');
    expect(match.pickups.some((p) => p.id === 98)).toBe(false);
    expect(shooter.armed).toBe(true);
  });

  it('teleports the ship at once and spends the power-up', () => {
    const match = duel();
    const shooter = match.players[match.current];
    shooter.powerUp = 'teleport';
    const before = { x: match.world.ships[shooter.id].x, y: match.world.ships[shooter.id].y };
    match.usePowerUp();
    const after = match.world.ships[shooter.id];
    expect(shooter.powerUp).toBeNull();
    expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeGreaterThan(0);
  });

  it('keeps a splitter for the fire press during the flight, then forks the shot and uses it up', () => {
    const match = duel();
    const shooter = match.players[match.current];
    shooter.powerUp = 'splitter';
    shooter.armed = true;
    match.usePowerUp();
    expect(shooter.armed).toBe(true);
    match.commit();
    expect(match.phase).toBe('flying');
    expect(match.volley?.shots.length).toBe(1);
    expect(shooter.powerUp).toBe('splitter');
    match.commit();
    expect(match.volley?.shots.length).toBe(3);
    expect(shooter.powerUp).toBeNull();
    expect(shooter.armed).toBe(false);
  });

  it('lets a CPU shot take a pickup, held armed so the CPU can use it', () => {
    const seats = ['hard', 'human', 'off', 'off', 'off', 'off'] as const;
    const match = createMatch('classic', { ...DEFAULT_SETTINGS, powerUps: true, rounds: 1, maxPlanets: 0, seats: [...seats] }, { seats: [...seats], seed: 7 });
    const cpu = match.players[0];
    const ship = match.world.ships[0];
    match.pickups = [{ id: 97, kind: 'teleport', x: ship.x + 40, y: ship.y, born: 0 }];
    (match as unknown as { launch: (aims: unknown[], trackStyle: boolean) => void }).launch([{ player: 0, angle: 0, power: 60 }], true);
    for (let t = 0; t < 1 && match.phase === 'flying'; t += 1 / 240) match.update(1 / 240);
    expect(cpu.powerUp).toBe('teleport');
    expect(cpu.armed).toBe(true);
    expect(match.pickups.some((p) => p.id === 97)).toBe(false);
  });

  it('lets a CPU with a splitter fork its shot near an enemy', () => {
    const seats = ['hard', 'human', 'off', 'off', 'off', 'off'] as const;
    const match = createMatch('classic', { ...DEFAULT_SETTINGS, powerUps: true, rounds: 1, maxPlanets: 0, seats: [...seats] }, { seats: [...seats], seed: 7 });
    const cpu = match.players[0];
    cpu.powerUp = 'splitter';
    cpu.armed = true;
    match.current = 0;
    match.world.ships[1].x = match.world.ships[0].x + 300;
    match.world.ships[1].y = match.world.ships[0].y;
    (match as unknown as { launch: (aims: unknown[], trackStyle: boolean) => void }).launch([{ player: 0, angle: 0, power: 60 }], true);
    for (let t = 0; t < 3 && match.phase === 'flying'; t += 1 / 240) match.update(1 / 240);
    expect(cpu.powerUp).toBeNull();
    expect(match.volley?.shots.length ?? 0).toBeGreaterThan(1);
  });

  it('shows the armed preview while aiming and spends it on the shot', () => {
    const match = duel();
    const shooter = match.players[match.current];
    shooter.powerUp = 'preview';
    expect(match.scene().preview).toBeNull();
    match.usePowerUp();
    expect(match.scene().preview?.length).toBeGreaterThan(4);
    match.commit();
    expect(shooter.powerUp).toBeNull();
    expect(match.scene().preview).toBeNull();
  });

  it('ignores the power-up key when the setting is off', () => {
    const seats = ['human', 'human', 'off', 'off', 'off', 'off'] as const;
    const match = createMatch('classic', { ...DEFAULT_SETTINGS, rounds: 1, maxPlanets: 0, seats: [...seats] }, { seats: [...seats], seed: 7 });
    match.players[match.current].powerUp = 'teleport';
    match.usePowerUp();
    expect(match.players[match.current].powerUp).toBe('teleport');
  });
});

describe('power-ups: round 1 fixes', () => {
  const launch = (match: Match, aims: unknown[]): void => (match as unknown as { launch: (a: unknown[], t: boolean) => void }).launch(aims, true);

  it('counts a pass over the ships still in, not over everybody who started', () => {
    const seats = ['human', 'human', 'human', 'human', 'off', 'off'] as const;
    const match = createMatch('classic', { ...DEFAULT_SETTINGS, powerUps: true, rounds: 1, maxPlanets: 0, seats: [...seats] }, { seats: [...seats], seed: 7 });
    const passLength = () => (match as unknown as { volleysPerPass: number }).volleysPerPass;
    expect(passLength()).toBe(4);
    match.players[2].alive = false;
    match.players[3].alive = false;
    expect(passLength()).toBe(2);
  });

  it('leaves preview pickups to the humans', () => {
    const seats = ['hard', 'human', 'off', 'off', 'off', 'off'] as const;
    const match = createMatch('classic', { ...DEFAULT_SETTINGS, powerUps: true, rounds: 1, maxPlanets: 0, seats: [...seats] }, { seats: [...seats], seed: 7 });
    const ship = match.world.ships[0];
    match.pickups = [{ id: 96, kind: 'preview', x: ship.x + 40, y: ship.y, born: 0 }];
    launch(match, [{ player: 0, angle: 0, power: 60 }]);
    for (let t = 0; t < 1 && match.phase === 'flying'; t += 1 / 240) match.update(1 / 240);
    expect(match.players[0].powerUp).toBeNull();
    expect(match.pickups.some((p) => p.id === 96)).toBe(true);
  });

  it('keeps a teleport away from the pickups', () => {
    const world = emptyWorld();
    const pickups: Pickup[] = [
      { id: 1, kind: 'preview', x: 640, y: 200, born: 0 },
      { id: 2, kind: 'preview', x: 640, y: 600, born: 0 },
      { id: 3, kind: 'preview', x: 400, y: 400, born: 0 },
    ];
    for (let seed = 1; seed <= 60; seed++) {
      const spot = teleportSpot(world, createRng(seed), pickups);
      expect(spot).not.toBeNull();
      for (const p of pickups) expect(Math.hypot(spot!.x - p.x, spot!.y - p.y)).toBeGreaterThanOrEqual(POWER_UP.TELEPORT_PICKUP_GAP);
    }
  });

  it('lets a human split in a salvo, where nobody is on turn during the flight', () => {
    const seats = ['human', 'human', 'off', 'off', 'off', 'off'] as const;
    const match = createMatch('classic', { ...DEFAULT_SETTINGS, powerUps: true, simultaneousShots: true, rounds: 1, maxPlanets: 0, seats: [...seats] }, { seats: [...seats], seed: 7 });
    match.players[0].powerUp = 'splitter';
    match.players[0].armed = true;
    for (let i = 0; i < 4 && match.phase === 'aiming'; i++) {
      match.commit();
      for (let t = 0; t < 1 && match.phase === 'aiming'; t += 1 / 30) match.update(1 / 30);
    }
    for (let t = 0; t < 5 && match.phase !== 'flying'; t += 1 / 30) match.update(1 / 30);
    expect(match.phase).toBe('flying');
    expect(match.current).toBe(-1);
    // One shot per human in the air; the splitter turns the holder's into three.
    expect(match.volley!.shots.length).toBe(2);
    match.commit();
    expect(match.volley!.shots.length).toBe(4);
    expect(match.players[0].powerUp).toBeNull();
  });

  it('gives the trails of one split shot one fan id, so they draw as one flight', () => {
    const match = duel();
    const shooter = match.players[match.current];
    shooter.powerUp = 'splitter';
    shooter.armed = true;
    match.commit();
    match.commit();
    finishFlight(match);
    const fans = new Set(match.trails.map((t) => t.fan));
    expect(match.trails.length).toBe(3);
    expect(fans.size).toBe(1);
    expect(fans.has(undefined)).toBe(false);
  });

  it('has a CPU that found no hitting shot jump with its teleport', () => {
    const seats = ['hard', 'human', 'off', 'off', 'off', 'off'] as const;
    // One second of flight reaches nowhere near the other ship, so the CPU cannot plan a hit.
    const match = createMatch('classic', { ...DEFAULT_SETTINGS, powerUps: true, shotTime: 1, rounds: 1, maxPlanets: 0, seats: [...seats] }, { seats: [...seats], seed: 7, deterministicCpu: true });
    match.world.ships[0].x = 60;
    match.world.ships[0].y = 400;
    match.world.ships[1].x = 1220;
    match.world.ships[1].y = 400;
    match.players[0].powerUp = 'teleport';
    const events: string[] = [];
    match.on((e) => events.push(e.type));
    for (let t = 0; t < 4 && match.players[0].powerUp; t += 1 / 30) match.update(1 / 30);
    expect(match.players[0].powerUp).toBeNull();
    expect(events).toContain('teleport');
  });

  it('keeps a CPU with a hittable target from wasting its teleport', () => {
    const seats = ['hard', 'human', 'off', 'off', 'off', 'off'] as const;
    const match = createMatch('classic', { ...DEFAULT_SETTINGS, powerUps: true, rounds: 1, maxPlanets: 0, seats: [...seats] }, { seats: [...seats], seed: 7, deterministicCpu: true });
    match.world.ships[0].x = 300;
    match.world.ships[0].y = 400;
    match.world.ships[1].x = 700;
    match.world.ships[1].y = 400;
    match.players[0].powerUp = 'teleport';
    const events: string[] = [];
    match.on((e) => events.push(e.type));
    for (let t = 0; t < 3 && match.phase === 'aiming'; t += 1 / 30) match.update(1 / 30);
    expect(events).not.toContain('teleport');
  });
});

describe('power-up events', () => {
  it('announces teleports, splits and pickups for the screen to dress', () => {
    const match = duel();
    const shooter = match.players[match.current];
    const events: string[] = [];
    match.on((e) => events.push(e.type));
    shooter.powerUp = 'teleport';
    match.usePowerUp();
    expect(events).toContain('teleport');
    const ship = match.world.ships[shooter.id];
    shooter.angle = 0;
    match.pickups = [{ id: 95, kind: 'preview', x: ship.x + 40, y: ship.y, born: 0 }];
    shooter.powerUp = 'splitter';
    shooter.armed = true;
    match.commit();
    match.commit();
    expect(events).toContain('split');
    finishFlight(match);
    expect(events).toContain('pickup');
  });

  it('retires a pickup after its passes and sets a fresh one down', () => {
    const match = duel();
    const events: string[] = [];
    match.on((e) => events.push(e.type));
    const count = () => (match as unknown as { countVolley: () => void });
    const old = match.pickups[0];
    old.born = -POWER_UP.LIFETIME_PASSES;
    // Two ships: two volleys make a pass.
    count().countVolley();
    count().countVolley();
    expect(events).toContain('pickupFade');
    expect(events).toContain('pickupSpawn');
    expect(match.pickups.some((p) => p.id === old.id)).toBe(false);
  });
});

