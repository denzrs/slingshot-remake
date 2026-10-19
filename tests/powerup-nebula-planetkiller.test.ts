import { describe, expect, it } from 'vitest';
import { createMatch, type Match } from '../src/game';
import { CPU_IGNORES, POWER_UP_KINDS, POWER_UP_WEIGHTS, aimedPlanet, nebulaSpot } from '../src/powerups';
import { NEBULA } from '../src/config';
import { cloneWorld, Shot, type World } from '../src/physics';
import { Volley } from '../src/volley';
import { DEFAULT_SETTINGS } from '../src/settings';

const rules = { bounce: false, timeLimit: 20 };

/** A human duel with power-ups on and no planets, so flights are straight and predictable. */
function duel(seed = 7, maxPlanets = 0): Match {
  const seats = ['human', 'human', 'off', 'off', 'off', 'off'] as const;
  return createMatch('classic', { ...DEFAULT_SETTINGS, powerUps: true, rounds: 1, maxPlanets, seats: [...seats] }, { seats: [...seats], seed });
}

const planet = (x: number, y: number) => ({ x, y, radius: 40, mass: 30_000, seed: 9, style: 'rocky' as const, tint: '#fff' });

describe('planet killer power-up', () => {
  it('is a known kind, and the rarest of them: a CPU takes it up and lays it', () => {
    expect(POWER_UP_KINDS).toContain('planetkiller');
    expect(POWER_UP_WEIGHTS.planetkiller).toBe(0.1);
    expect(CPU_IGNORES.planetkiller).toBeUndefined();
  });

  it('removes the planet the aim ray meets, and spends the shot', () => {
    const match = duel();
    const shooter = match.players[match.current];
    const ship = match.world.ships[shooter.id];
    const rock = planet(ship.x + 400, ship.y);
    match.world.planets = [rock];
    const events: string[] = [];
    match.on((e) => events.push(e.type));

    shooter.powerUp = 'planetkiller';
    shooter.angle = 0;
    shooter.power = 100;
    match.usePowerUp();
    expect(match.placing).toBe(true);
    expect(match.scene().placement!.kind).toBe('planetkiller');
    expect(match.scene().placement!.target).toMatchObject({ x: rock.x, y: rock.y });

    match.commit();
    expect(match.world.planets).toHaveLength(0);
    expect(events).toContain('planetKiller');
    expect(shooter.powerUp).toBeNull();
    // Removing a planet spends the shot: the ship fires nothing.
    expect(shooter.passed).toBe(true);
  });

  it('keeps the power-up when the ray meets no planet', () => {
    const match = duel();
    const shooter = match.players[match.current];
    shooter.powerUp = 'planetkiller';
    shooter.angle = 0;
    shooter.power = 100;
    match.usePowerUp();
    expect(match.scene().placement!.target).toBeNull();
    match.commit();
    expect(shooter.powerUp).toBe('planetkiller');
    expect(match.placing).toBe(true);
  });

  it('aims at the first planet on the ray, not one behind it', () => {
    const near = planet(500, 400);
    const far = planet(900, 400);
    const world: World = {
      width: 1280, height: 800, planets: [near, far],
      ships: [{ x: 200, y: 400, alive: true }], holes: [], nebulae: [], version: 0,
    };
    expect(aimedPlanet(world, { x: 200, y: 400 }, 0, 100)).toEqual({ index: 0, x: near.x, y: near.y });
  });
});

describe('nebula power-up', () => {
  it('is a known kind, and a CPU takes it up and lays it', () => {
    expect(POWER_UP_KINDS).toContain('nebula');
    expect(CPU_IGNORES.nebula).toBeUndefined();
    // The preview is the only kind left lying: a planner already knows the path it shows.
    expect(CPU_IGNORES.preview).toBe(true);
  });

  it('is aimed like a teleport, and fire lays a cloud on the spot and spends the shot', () => {
    const match = duel();
    const shooter = match.players[match.current];
    const events: string[] = [];
    match.on((e) => events.push(e.type));

    shooter.powerUp = 'nebula';
    match.usePowerUp();
    expect(match.placing).toBe(true);
    expect(match.scene().placement!.kind).toBe('nebula');
    const aimed = match.scene().placement!.target!;
    expect(match.world.nebulae).toHaveLength(0);

    match.commit();
    expect(match.world.nebulae).toHaveLength(1);
    expect(match.world.nebulae[0].x).toBeCloseTo(aimed.x, 5);
    expect(match.world.nebulae[0].y).toBeCloseTo(aimed.y, 5);
    expect(match.world.nebulae[0].radius).toBe(NEBULA.RADIUS);
    expect(Number.isFinite(match.world.nebulae[0].seed)).toBe(true);
    expect(events).toContain('nebula');
    expect(shooter.powerUp).toBeNull();
    expect(shooter.passed).toBe(true);
  });

  it('keeps the cloud whole inside the field, never off an edge', () => {
    const world: World = {
      width: 1280, height: 800, planets: [], ships: [{ x: 200, y: 400, alive: true }], holes: [], nebulae: [], version: 0,
    };
    // Full power due east would put the spot past the right edge; the aim walks it back inside.
    const spot = nebulaSpot(world, { x: 200, y: 400 }, 0, 100)!;
    expect(spot.x).toBeLessThanOrEqual(world.width - NEBULA.RADIUS);
    expect(spot.x).toBeGreaterThanOrEqual(NEBULA.RADIUS);
  });

  it('never lets a cloud trap a shot: the speed floor keeps it crawling until it is out', () => {
    // A cloud that swallows the whole field, and a slow shot: without the floor the drag would stall it.
    const world: World = {
      width: 1280, height: 800, planets: [],
      ships: [{ x: 200, y: 400, alive: true }], holes: [], version: 0,
      nebulae: [{ x: 640, y: 400, radius: 4000, seed: 0.37 }],
    };
    const roomy = { bounce: false, timeLimit: 60 };
    const shot = new Shot(world, 0, 0, 40, roomy);
    let slowest = Infinity;
    let end = null;
    while (!(end = shot.step())) slowest = Math.min(slowest, Math.hypot(shot.vx, shot.vy));
    // The drag takes it down to the floor and no further, and it still leaves the field inside the clock.
    expect(slowest).toBeGreaterThanOrEqual(NEBULA.MIN_SPEED - 1e-6);
    expect(slowest).toBeLessThan(NEBULA.MIN_SPEED * 1.05);
    expect(end.kind).toBe('lost');
    expect(shot.time).toBeLessThan(roomy.timeLimit);
  });

  it('slows a shot flying through it and deepens the pull it feels', () => {
    // A planet above the flight path bends the shot up; an unclouded shot and a clouded one start alike.
    const base: World = {
      width: 1280, height: 800,
      planets: [{ x: 640, y: 300, radius: 40, mass: 60_000, seed: 1, style: 'rocky', tint: '#fff' }],
      ships: [{ x: 200, y: 400, alive: true }], holes: [], nebulae: [], version: 0,
    };
    const clear = new Shot(base, 0, 0, 60, rules);
    const cloudy = new Shot({ ...base, nebulae: [{ x: 600, y: 400, radius: NEBULA.RADIUS, seed: 0.37 }] }, 0, 0, 60, rules);
    for (let i = 0; i < 200; i++) {
      clear.step();
      cloudy.step();
    }
    expect(Math.hypot(cloudy.vx, cloudy.vy)).toBeLessThan(Math.hypot(clear.vx, clear.vy));
    // Pulled harder towards the planet above it, the clouded shot has climbed further.
    expect(cloudy.y).toBeLessThan(clear.y);
  });
});

describe('a CPU and the placements', () => {
  function cpuMatch(seed = 11): Match {
    const seats = ['easy', 'human', 'off', 'off', 'off', 'off'] as const;
    return createMatch('classic', { ...DEFAULT_SETTINGS, powerUps: true, rounds: 1, maxPlanets: 0, seats: [...seats] }, { seats: [...seats], seed });
  }

  /** The CPU-side placement steps, reached without going through a turn. */
  type Placer = { cpuPlacementAim(p: unknown): { angle: number; power: number } | null; placeForCpu(id: number): boolean };
  type Launcher = { launch(aims: unknown[], track: boolean): void };

  it('takes a placement its own shot flies past, where it used to leave it lying', () => {
    const match = cpuMatch();
    const cpu = match.players[0];
    const ship = match.world.ships[0];
    match.pickups = [{ id: 1, kind: 'nebula', x: ship.x + 250, y: ship.y, born: 0 }];
    cpu.angle = 0;
    cpu.power = 60;
    // Fire its shot straight, without waiting on its own turn logic.
    const launcher = match as unknown as Launcher;
    launcher.launch([{ player: 0, angle: 0, power: 60 }], true);
    for (let t = 0; t < 120 && match.phase === 'flying'; t += 1 / 30) match.update(1 / 30);
    expect(cpu.powerUp).toBe('nebula');
  });

  it('lays each placement it holds at a rough spot of its own, and spends it', () => {
    const match = cpuMatch();
    const cpu = match.players[0];
    const placer = match as unknown as Placer;
    const own = match.world.ships[0];
    const enemy = match.world.ships[1];
    // One rock between the two ships, inside the aim's reach: the planet killer has something to shoot.
    match.world.planets = [{ x: (own.x + enemy.x) / 2, y: (own.y + enemy.y) / 2, radius: 30, mass: 20_000, seed: 3, style: 'rocky', tint: '#fff' }];

    for (const kind of ['blackhole', 'nebula', 'planetkiller'] as const) {
      cpu.powerUp = kind;
      const aim = placer.cpuPlacementAim(cpu);
      expect(aim).not.toBeNull();
      cpu.angle = aim!.angle;
      cpu.power = aim!.power;
      expect(placer.placeForCpu(0)).toBe(true);
      expect(cpu.powerUp).toBeNull();
    }
    expect(match.world.holes).toHaveLength(1);
    expect(match.world.nebulae).toHaveLength(1);
    expect(match.world.planets).toHaveLength(0);
  });

  it('lays the placement it holds on its own turn, and fires nothing that turn', () => {
    const match = cpuMatch();
    const cpu = match.players[0];
    cpu.powerUp = 'nebula';
    for (let t = 0; t < 12 && !match.world.nebulae.length; t += 1 / 30) match.update(1 / 30);
    expect(match.world.nebulae).toHaveLength(1);
    expect(cpu.powerUp).toBeNull();
    expect(cpu.passed).toBe(true);
  });
});

describe('a shield bounce on the wire', () => {
  it('replays the same bounce from the volley script', () => {
    const world: World = {
      width: 1280, height: 800, planets: [],
      ships: [{ x: 100, y: 400, alive: true }, { x: 500, y: 400, alive: true }], holes: [], nebulae: [], version: 0,
    };
    world.ships[1].shield = true;
    const live = new Volley(world, [{ player: 0, angle: 0, power: 100 }], rules, true);
    while (!live.done) live.step();
    const snapshot = live.snapshot();
    expect((snapshot.script ?? []).some((entry) => entry.kind === 'shield')).toBe(true);

    const replay = new Volley(cloneWorld(world), snapshot.aims, rules, true, snapshot.script ?? []);
    replay.restore(snapshot);
    while (!replay.done) replay.step();
    expect(replay.shots.map((vs) => [vs.shot.x, vs.shot.y])).toEqual(live.shots.map((vs) => [vs.shot.x, vs.shot.y]));
  });
});
