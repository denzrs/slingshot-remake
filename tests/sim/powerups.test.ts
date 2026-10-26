import { describe, expect, it } from 'vitest';
import { createMatch, type Match } from '../../src/game';
import { PHYSICS } from '../../src/sim/config';
import { laneSpot, pickKind, POWER_UP, POWER_UP_KINDS, POWER_UP_WEIGHTS, PREVIEW_POINTS, previewPath, SPLIT_TURNS, spawnPickup, aimedSpot, teleportSpot, touchedPickups, type Pickup } from '../../src/sim/powerups';
import { awards, newStatBook } from '../../src/data/stats';
import { createRng } from '../../src/sim/rng';
import { Shot, type World } from '../../src/sim/physics';
import { DEFAULT_SETTINGS } from '../../src/data/settings';
import { Volley } from '../../src/sim/volley';

const rules = { bounce: false, timeLimit: 20 };

function emptyWorld(ships: [number, number][] = [[300, 400], [900, 400]]): World {
  return { width: 1280, height: 800, planets: [], ships: ships.map(([x, y]) => ({ x, y, alive: true })), holes: [], nebulae: [], wormholes: [], defenses: [], version: 0 };
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
    for (let i = 0; i < POWER_UP.DEFAULT_AMOUNT + 1; i++) {
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

  it('aims a teleport at the point the angle and power name, inside the field', () => {
    const bare = emptyWorld();
    const half = POWER_UP.TELEPORT_RANGE / 2;
    expect(aimedSpot(bare, { x: 300, y: 400 }, 0, 50)).toEqual({ x: 300 + half, y: 400 });
    // Full power from a corner would leave the field, so it stops at the edge margin.
    const out = aimedSpot(bare, { x: 1200, y: 400 }, 0, 100)!;
    expect(out!.x).toBeLessThanOrEqual(bare.width - POWER_UP.EDGE);
  });

  it('pulls the aimed spot back so it never lands inside a planet', () => {
    const world = { ...emptyWorld(), planets: [{ x: 700, y: 400, radius: 60, mass: 1, seed: 1, style: 'rocky' as const, tint: '#fff' }] };
    const aimed = aimedSpot(world, { x: 100, y: 400 }, 0, 50)!;
    expect(aimed).not.toBeNull();
    expect(aimed.y).toBeCloseTo(400, 3);
    expect(aimed.x).toBeLessThan(700 - 60);
    expect(Math.hypot(aimed.x - 700, aimed.y - 400)).toBeGreaterThanOrEqual(60 + POWER_UP.TELEPORT_PLANET_GAP);
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
    // A window that is flown out in full has exactly the count the fade is measured against.
    expect(path.length / 2).toBe(PREVIEW_POINTS);
  });

  it('samples every fourth step, which is what puts a fade on the clock and not on the path', () => {
    const world = emptyWorld([[100, 400], [1200, 100]]);
    const path = previewPath(world, 0, 0, 40, rules);
    const shot = new Shot(world, 0, 0, 40, rules);
    // Sample `i` is where the shot is after 4i steps, whether or not the path carries on that far.
    for (let i = 0; i < 4; i++) shot.step();
    expect(path[2]).toBeCloseTo(shot.x, 6);
    expect(path[3]).toBeCloseTo(shot.y, 6);
    for (let i = 4; i < 8; i++) shot.step();
    expect(path[4]).toBeCloseTo(shot.x, 6);
    expect(path[5]).toBeCloseTo(shot.y, 6);
  });

  it('hands back fewer samples when the shot ends early, so a fade cannot be measured by its length', () => {
    const clear = emptyWorld([[100, 400], [1200, 100]]);
    const blocked = { ...emptyWorld([[100, 400], [1200, 100]]), planets: [{ x: 260, y: 400, radius: 40, mass: 1, seed: 1, style: 'rocky' as const, tint: '#fff' }] };
    const full = previewPath(clear, 0, 0, 40, rules);
    const hit = previewPath(blocked, 0, 0, 40, rules);

    expect(hit.length).toBeLessThan(full.length);
    // Which is the tell this guards: a fade drawn along the path would be shorter for the shot that
    // connects, so the renderer fades against PREVIEW_POINTS — the window — instead.
    expect(hit.length / 2).toBeLessThan(PREVIEW_POINTS);
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
    expect(duel().pickups.length).toBe(POWER_UP.DEFAULT_AMOUNT);
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

  it('aims a teleport, and fire jumps to the spot the aim lands on', () => {
    const match = duel();
    const shooter = match.players[match.current];
    shooter.powerUp = 'teleport';
    const before = { x: match.world.ships[shooter.id].x, y: match.world.ships[shooter.id].y };
    match.usePowerUp();
    expect(match.placing).toBe(true);
    const aimed = match.scene().placement!.target!;
    // Nothing has moved yet, and the power-up is still in hand.
    expect(match.world.ships[shooter.id].x).toBe(before.x);
    expect(shooter.powerUp).toBe('teleport');
    match.commit();
    const after = match.world.ships[shooter.id];
    expect(after.x).toBeCloseTo(aimed.x, 5);
    expect(after.y).toBeCloseTo(aimed.y, 5);
    expect(shooter.powerUp).toBeNull();
    expect(match.placing).toBe(false);
    // Fire jumped; it did not also shoot.
    expect(match.phase).toBe('aiming');
  });

  it('puts the spot where the angle and the power point, and moves it as they change', () => {
    const match = duel();
    const shooter = match.players[match.current];
    shooter.powerUp = 'teleport';
    const ship = match.world.ships[shooter.id];
    match.usePowerUp();
    const half = POWER_UP.TELEPORT_RANGE / 2;
    // Due east at half power, then due north at a quarter: inside the field, so nothing pulls the spot back.
    shooter.angle = 0;
    shooter.power = 50;
    expect(match.scene().placement!.target!.x).toBeCloseTo(ship.x + half, 3);
    expect(match.scene().placement!.target!.y).toBeCloseTo(ship.y, 3);
    shooter.angle = 90;
    shooter.power = 25;
    expect(match.scene().placement!.target!.x).toBeCloseTo(ship.x, 3);
    expect(match.scene().placement!.target!.y).toBeCloseTo(ship.y - half / 2, 3);
  });

  it('lets a ship think again: the power key again closes the aim, and cancelling keeps the teleport and the position', () => {
    const match = duel();
    const shooter = match.players[match.current];
    shooter.powerUp = 'teleport';
    const before = { x: match.world.ships[shooter.id].x, y: match.world.ships[shooter.id].y };
    match.usePowerUp();
    expect(match.placing).toBe(true);
    match.usePowerUp();
    expect(match.placing).toBe(false);
    match.usePowerUp();
    expect(match.cancelPlacement()).toBe(true);
    expect(match.placing).toBe(false);
    expect(match.cancelPlacement()).toBe(false);
    expect(shooter.powerUp).toBe('teleport');
    expect(match.world.ships[shooter.id].x).toBe(before.x);
  });

  it('spends the shot: after the jump the ship fires nothing and the turn moves on', () => {
    const match = duel();
    const shooter = match.players[match.current];
    shooter.powerUp = 'teleport';
    match.usePowerUp();
    match.commit();
    expect(shooter.passed).toBe(true);
    const events: string[] = [];
    match.on((e) => events.push(e.type));
    // Let the spent turn play right out: no volley ever carries a shot from the teleporting ship.
    for (let t = 0; t < 300; t += 1 / 30) match.update(1 / 30);
    expect(events).not.toContain('fire');
    expect(shooter.shots).toBe(0);
    expect(match.current).not.toBe(shooter.id);
  });

  it('drops the aim when the turn moves on', () => {
    const match = duel();
    const shooter = match.players[match.current];
    shooter.powerUp = 'teleport';
    match.usePowerUp();
    expect(match.placing).toBe(true);
    shooter.powerUp = null;
    expect(match.placing).toBe(false);
    expect(match.scene().placement).toBeNull();
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

  it('writes down when a splitter went off, on the shot and on its forks', () => {
    const match = duel();
    const shooter = match.players[match.current];
    shooter.powerUp = 'splitter';
    shooter.armed = true;
    match.commit();
    for (let i = 0; i < 20; i++) match.update(1 / 60);
    match.commit();
    const at = match.volley!.script.find((entry) => entry.kind === 'split')!.at;
    expect(at).toBeGreaterThan(0);
    for (let t = 0; t < 60 && match.phase === 'flying'; t += 1 / 30) match.update(1 / 30);
    const shots = match.shotLog.shots;
    expect(shots).toHaveLength(3);
    expect(shots.filter((s) => s.fork)).toHaveLength(2);
    expect(new Set(shots.map((s) => s.fan)).size).toBe(1);
    expect(shots.every((s) => s.fan !== null && s.splitAt === at)).toBe(true);
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
    const events: string[] = [];
    match.on((e) => events.push(e.type));
    // A teleport: the jump is announced, and it spends the turn.
    const shooter = match.players[match.current];
    shooter.powerUp = 'teleport';
    match.usePowerUp();
    match.commit();
    expect(events).toContain('teleport');
    // The spent turn plays out; the other ship takes its turn with a splitter and a pickup on its path.
    for (let t = 0; t < 300 && match.current === shooter.id; t += 1 / 30) match.update(1 / 30);
    const other = match.players[match.current];
    const ship = match.world.ships[other.id];
    other.angle = 0;
    match.pickups = [{ id: 95, kind: 'preview', x: ship.x + 40, y: ship.y, born: 0 }];
    other.powerUp = 'splitter';
    other.armed = true;
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
    const old = match.pickups[0];
    old.born = -POWER_UP.LIFETIME_PASSES;
    // Two ships: two volleys make a pass.
    match.power.onVolleyEnd();
    match.power.onVolleyEnd();
    expect(events).toContain('pickupFade');
    expect(events).toContain('pickupSpawn');
    expect(match.pickups.some((p) => p.id === old.id)).toBe(false);
  });
});

describe('power-ups: round 2', () => {
  const planet = (x: number, y: number, radius = 40) => ({ x, y, radius, mass: 4000, seed: 1, style: 'rocky' as const, tint: '#fff' });

  it('puts a lane pickup on a shot path, clear of everything and well away from the ship it is for', () => {
    const world = { ...emptyWorld([[120, 400], [1160, 400]]), planets: [planet(640, 400), planet(640, 150, 30)] };
    for (let seed = 1; seed <= 40; seed++) {
      const spot = laneSpot(world, createRng(seed), rules, [0], []);
      expect(spot).not.toBeNull();
      expect(Math.hypot(spot!.x - 120, spot!.y - 400)).toBeGreaterThanOrEqual(POWER_UP.LANE_MIN_RANGE);
      for (const p of world.planets) expect(Math.hypot(spot!.x - p.x, spot!.y - p.y)).toBeGreaterThan(p.radius + POWER_UP.PLANET_GAP);
      for (const sh of world.ships) expect(Math.hypot(spot!.x - sh.x, spot!.y - sh.y)).toBeGreaterThanOrEqual(POWER_UP.SHIP_GAP);
      expect(spot!.x).toBeGreaterThanOrEqual(POWER_UP.EDGE);
      expect(spot!.x).toBeLessThanOrEqual(world.width - POWER_UP.EDGE);
    }
  });

  it('is reachable by construction: a shot from the ship passes through a lane pickup', () => {
    // Without planets a shot flies straight, so the spot is on a line the ship can fire along.
    const flat = { ...emptyWorld([[120, 400], [1160, 400]]) };
    for (let seed = 1; seed <= 20; seed++) {
      const spot = laneSpot(flat, createRng(seed), rules, [0], [])!;
      const angle = (Math.atan2(-(spot.y - 400), spot.x - 120) * 180) / Math.PI;
      const shot = new Shot(flat, 0, angle, 100, rules);
      let nearest = Infinity;
      while (!shot.end && shot.time < POWER_UP.LANE_SECONDS) {
        shot.step();
        nearest = Math.min(nearest, Math.hypot(shot.x - spot.x, shot.y - spot.y));
      }
      // The angle is only rebuilt from the spot, so the power may differ: the line, not the speed, must fit.
      expect(nearest).toBeLessThan(POWER_UP.PICKUP_RADIUS + 20);
    }
  });

  it('falls back to open space when no path offers a lane spot', () => {
    const world = emptyWorld([[640, 400], [700, 400]]);
    // Both ships sit so close together and the sources list is empty: no lane, but a pickup still appears.
    const pickup = spawnPickup(world, createRng(5), [], 'teleport', 1, 0, { rules, sources: [] });
    expect(pickup).not.toBeNull();
  });

  it('lays a replacement at once when the field runs short', () => {
    const match = duel();
    const events: string[] = [];
    match.on((e) => events.push(e.type));
    match.pickups = [];
    match.power.onVolleyEnd();
    expect(match.pickups.length).toBe(POWER_UP.DEFAULT_AMOUNT);
    expect(events.filter((e) => e === 'pickupSpawn').length).toBe(POWER_UP.DEFAULT_AMOUNT);
  });

  it('never lays more than the field holds', () => {
    const match = duel();
    for (let i = 0; i < 12; i++) match.power.onVolleyEnd();
    expect(match.pickups.length).toBeLessThanOrEqual(POWER_UP.DEFAULT_AMOUNT);
  });

  it('keeps the teleport in hand when the aim lands nowhere a ship may rest', () => {
    const match = duel();
    const shooter = match.players[match.current];
    shooter.powerUp = 'teleport';
    // A planet that swallows the field: no spot along the aim is safe to rest on.
    match.world.planets.push({ x: 640, y: 400, radius: 700, mass: 1, seed: 1, style: 'rocky', tint: '#fff' });
    match.usePowerUp();
    expect(match.placing).toBe(true);
    expect(match.scene().placement).toMatchObject({ owner: shooter.id, target: null });
    match.commit();
    expect(shooter.powerUp).toBe('teleport');
    expect(match.placing).toBe(true);
    expect(match.phase).toBe('aiming');
  });
});

describe('power-ups: round 3', () => {
  it('bounces a shot off a shield, spent by that one hit, and the ship lives', () => {
    const world = emptyWorld([[100, 400], [500, 400]]);
    world.ships[1].shield = true;
    const volley = new Volley(world, [{ player: 0, angle: 0, power: 100 }], rules, false);
    const bounced: number[] = [];
    while (!volley.done) bounced.push(...volley.step().flatMap((e) => (e.type === 'reflect' ? [e.ship] : [])));
    expect(bounced).toEqual([1]);
    expect(world.ships[1].alive).toBe(true);
    expect(world.ships[1].shield).toBe(false);
    // The second shot finds the ship bare.
    const next = new Volley(world, [{ player: 0, angle: 0, power: 100 }], rules, false);
    while (!next.done) next.step();
    expect(world.ships[1].alive).toBe(false);
  });

  it('puts the shield on the ship when taken, and takes it off when swapped away', () => {
    const match = duel();
    const shooter = match.players[match.current];
    const ship = match.world.ships[shooter.id];
    shooter.angle = 0;
    match.pickups = [{ id: 90, kind: 'shield', x: ship.x + 40, y: ship.y, born: 0 }];
    match.commit();
    finishFlight(match);
    expect(shooter.powerUp).toBe('shield');
    expect(ship.shield).toBe(true);
    expect(match.world.ships[shooter.id].shield).toBe(true);
    // Another pickup swaps it: the shield goes.
    match.pickups = [{ id: 91, kind: 'preview', x: ship.x + 40, y: ship.y, born: 0 }];
    (match as unknown as { launch: (a: unknown[], t: boolean) => void }).launch([{ player: shooter.id, angle: 0, power: 60 }], true);
    finishFlight(match);
    expect(shooter.powerUp).toBe('preview');
    expect(ship.shield).toBe(false);
  });

  it('announces a bounced shot, spends the shield, counts the save and plays on', () => {
    const match = duel();
    const holder = match.players[1 - match.current];
    const shooter = match.players[match.current];
    const events: string[] = [];
    match.on((e) => events.push(e.type));
    holder.powerUp = 'shield';
    holder.armed = true;
    match.world.ships[holder.id].shield = true;
    // Put the holder right in front of the shooter's aim.
    const from = match.world.ships[shooter.id];
    match.world.ships[holder.id].x = from.x + (shooter.id === 0 ? 300 : -300);
    match.world.ships[holder.id].y = from.y;
    shooter.angle = shooter.id === 0 ? 0 : 180;
    shooter.power = 100;
    match.commit();
    finishFlight(match);
    // The shot bounced off: it flies on and may still kill someone, but the holder lives and the shield is spent.
    expect(events).toContain('shield');
    expect(holder.alive).toBe(true);
    expect(holder.powerUp).toBeNull();
    expect(match.roundStats.saves[holder.id]).toBe(1);
    expect(match.matchStats.saves[holder.id]).toBe(1);
  });

  it('draws the kinds by their weights, and every kind turns up', () => {
    const rng = createRng(11);
    const counts = new Map<string, number>();
    for (let i = 0; i < 4000; i++) counts.set(pickKind(rng), (counts.get(pickKind(rng)) ?? 0) + 1);
    for (const kind of POWER_UP_KINDS) expect(counts.get(kind) ?? 0).toBeGreaterThan(0);

    // Each kind comes up its share of the time, which is what the weights are for: which ones are
    // scarcer is a matter of the weights themselves, not of this test.
    const draws = 20_000;
    const total = POWER_UP_KINDS.reduce((sum, kind) => sum + POWER_UP_WEIGHTS[kind], 0);
    const rng2 = createRng(12);
    const drawn: Record<string, number> = {};
    for (let i = 0; i < draws; i++) {
      const kind = pickKind(rng2);
      drawn[kind] = (drawn[kind] ?? 0) + 1;
    }
    for (const kind of POWER_UP_KINDS) {
      const expected = (draws * POWER_UP_WEIGHTS[kind]) / total;
      expect(Math.abs(drawn[kind] - expected)).toBeLessThan(expected * 0.1);
    }
  });

  it('counts the power-ups taken, for the scorecard', () => {
    const match = duel();
    const shooter = match.players[match.current];
    const ship = match.world.ships[shooter.id];
    shooter.angle = 0;
    match.pickups = [{ id: 70, kind: 'teleport', x: ship.x + 40, y: ship.y, born: 0 }];
    match.commit();
    finishFlight(match);
    expect(match.roundStats.pickups[shooter.id]).toBe(1);
    const earned = awards(match.matchStats).find((a) => a.kind === 'pickups');
    expect(earned?.players).toEqual([shooter.id]);
    expect(awards(newStatBook()).some((a) => a.kind === 'pickups' || a.kind === 'saves')).toBe(false);
  });
});

describe('power-up choices in a match', () => {
  const choose = (over: Partial<typeof DEFAULT_SETTINGS>): Match => {
    const seats = ['human', 'human', 'off', 'off', 'off', 'off'] as const;
    return createMatch('classic', { ...DEFAULT_SETTINGS, powerUps: true, rounds: 1, maxPlanets: 2, seats: [...seats], ...over }, { seats: [...seats], seed: 9 });
  };

  it('only lays the kinds that were left on', () => {
    for (const kinds of [['shield'], ['teleport', 'preview']] as const) {
      const match = choose({ powerUpKinds: [...kinds] });
      for (let i = 0; i < 10; i++) match.power.onVolleyEnd();
      expect(match.pickups.length).toBeGreaterThan(0);
      for (const p of match.pickups) expect(kinds).toContain(p.kind);
    }
  });

  it('lays as many pickups as the amount says, and never more', () => {
    for (const amount of POWER_UP.AMOUNTS) {
      const match = choose({ powerUpAmount: amount });
      expect(match.pickups.length).toBeLessThanOrEqual(amount);
      expect(match.pickups.length).toBeGreaterThan(0);
      match.pickups = [];
      match.power.onVolleyEnd();
      expect(match.pickups.length).toBeGreaterThanOrEqual(Math.min(amount, 1));
      for (let i = 0; i < 20; i++) {
        match.power.onVolleyEnd();
        expect(match.pickups.length).toBeLessThanOrEqual(amount);
      }
    }
  });

  it('with one pickup on the field, the next one is laid only after the old one has faded', () => {
    const match = choose({ powerUpAmount: 1 });
    const events: string[] = [];
    match.on((e) => events.push(e.type));
    const first = match.pickups[0];
    for (let volley = 0; volley < 20; volley++) {
      match.power.onVolleyEnd();
      expect(match.pickups.length).toBeLessThanOrEqual(1);
    }
    expect(match.pickups.some((p) => p.id === first.id)).toBe(false);
    expect(events.indexOf('pickupFade')).toBeGreaterThanOrEqual(0);
    expect(events.indexOf('pickupFade')).toBeLessThan(events.indexOf('pickupSpawn'));
  });

  it('refills a taken pickup up to the amount', () => {
    const match = choose({ powerUpAmount: 3 });
    match.pickups = [];
    match.power.onVolleyEnd();
    expect(match.pickups.length).toBe(3);
  });

  it('falls back to every kind when the list is empty', () => {
    const match = choose({ powerUpKinds: [] });
    expect(match.pickups.length).toBeGreaterThan(0);
  });
});

describe('power-ups: teleport aiming', () => {
  it('jumps nowhere and keeps the power-up when fire is pressed with nobody aiming', () => {
    const match = duel();
    const before = { ...match.world.ships[match.current] };
    expect(match.confirmPlacement()).toBe(false);
    expect(match.world.ships[match.current]).toMatchObject({ x: before.x, y: before.y });
  });
});

