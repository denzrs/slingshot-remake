import { describe, expect, it } from 'vitest';
import { createMatch, type Match } from '../src/game';
import { CPU_IGNORES, POWER_UP_KINDS } from '../src/powerups';
import { cloneWorld, Shot, type Planet, type World } from '../src/physics';
import { Volley } from '../src/volley';
import { DEFAULT_SETTINGS } from '../src/settings';

const rules = { bounce: false, timeLimit: 20 };

function emptyWorld(ships: [number, number][]): World {
  return { width: 1280, height: 800, planets: [], ships: ships.map(([x, y]) => ({ x, y, alive: true })), holes: [], nebulae: [], wormholes: [], defenses: [], version: 0 };
}

function duel(seed = 7): Match {
  const seats = ['human', 'human', 'off', 'off', 'off', 'off'] as const;
  return createMatch('classic', { ...DEFAULT_SETTINGS, powerUps: true, rounds: 1, maxPlanets: 0, seats: [...seats] }, { seats: [...seats], seed });
}

const planet = (x: number, y: number, extra: Partial<Planet> = {}): Planet => ({ x, y, radius: 30, mass: 6000, seed: 1, style: 'rocky', tint: '#fff', ...extra });

/** Straight along y = 400 with the planet above: pulled, a shot bends up towards it; pushed, it bends down. */
const flyPast = (reversed: boolean, shooter = 0): number => {
  const world = { ...emptyWorld([[100, 400], [1200, 400]]), planets: [planet(500, 300, { reversed })] };
  const shot = new Shot(world, shooter, shooter ? 180 : 0, 60, rules);
  for (let i = 0; i < 600; i++) shot.step();
  return shot.y - 400;
};

describe('polarity power-up', () => {
  it('is a known kind, which a CPU takes up like the other placements', () => {
    expect(POWER_UP_KINDS).toContain('polarity');
    expect(POWER_UP_KINDS).not.toContain('repulse');
    expect(CPU_IGNORES.polarity).toBeUndefined();
  });

  it('makes a planet push a shot away instead of pulling it in', () => {
    expect(flyPast(false)).toBeLessThan(0);
    expect(flyPast(true)).toBeGreaterThan(0);
  });

  it('pushes the shots of every player alike', () => {
    expect(flyPast(true, 0)).toBeGreaterThan(0);
    expect(flyPast(true, 1)).toBeGreaterThan(0);
  });

  it('turns only the planet it was set on', () => {
    const world = { ...emptyWorld([[100, 400], [1200, 400]]), planets: [planet(500, 300, { reversed: true }), planet(900, 300, { seed: 2 })] };
    const shot = new Shot(world, 0, 0, 60, rules);
    for (let i = 0; i < 20; i++) shot.step();
    expect(shot.vy).toBeGreaterThan(0);
  });

  it('is kept by cloneWorld and by a fork, so planners and replays see it', () => {
    const world = { ...emptyWorld([[100, 400], [1200, 400]]), planets: [planet(500, 300, { reversed: true })] };
    expect(cloneWorld(world).planets[0].reversed).toBe(true);
    const volley = new Volley(world, [{ player: 0, angle: 0, power: 60 }], rules, false);
    for (let i = 0; i < 30; i++) volley.step();
    expect(volley.split(0, [0.1], 3)).toBe(true);
    expect(volley.world.planets[0].reversed).toBe(true);
  });

  it('is aimed with the power-up key, fire turns the planet, and it spends the shot', () => {
    const match = duel();
    const shooter = match.players[match.current];
    const ship = match.world.ships[shooter.id];
    const rock = planet(ship.x + 400, ship.y);
    match.world.planets = [rock];
    const events: string[] = [];
    match.on((e) => events.push(e.type));

    shooter.powerUp = 'polarity';
    shooter.angle = 0;
    shooter.power = 50;
    match.usePowerUp();
    expect(match.placing).toBe(true);
    expect(match.scene().placement!.kind).toBe('polarity');
    expect(match.scene().placement!.target).toEqual({ x: rock.x, y: rock.y });

    const before = match.world.version;
    match.commit();
    expect(match.world.planets[0].reversed).toBe(true);
    expect(match.world.version).toBeGreaterThan(before);
    expect(events).toContain('polarity');
    expect(shooter.powerUp).toBeNull();
    expect(shooter.passed).toBe(true);
  });

  it('turns a turned planet back, whoever turned it', () => {
    const match = duel();
    const ship = match.world.ships[match.current];
    match.world.planets = [planet(ship.x + 400, ship.y, { reversed: true })];
    const shooter = match.players[match.current];
    shooter.powerUp = 'polarity';
    shooter.angle = 0;
    match.usePowerUp();
    const reversed: boolean[] = [];
    match.on((e) => {
      if (e.type === 'polarity') reversed.push(e.reversed);
    });
    match.commit();
    expect(match.world.planets[0].reversed).toBe(false);
    expect(reversed).toEqual([false]);
  });

  it('keeps the power-up when the ray meets no planet', () => {
    const match = duel();
    match.world.planets = [];
    const shooter = match.players[match.current];
    shooter.powerUp = 'polarity';
    match.usePowerUp();
    match.commit();
    expect(shooter.powerUp).toBe('polarity');
    expect(shooter.passed).toBe(false);
  });

  describe('for a CPU', () => {
    type Placer = { cpuPlacementAim(p: unknown): { angle: number; power: number } | null; placeForCpu(id: number): boolean };

    function cpuMatch(seed = 11): Match {
      const seats = ['easy', 'human', 'off', 'off', 'off', 'off'] as const;
      return createMatch('classic', { ...DEFAULT_SETTINGS, powerUps: true, rounds: 1, maxPlanets: 0, seats: [...seats] }, { seats: [...seats], seed });
    }

    it('turns the nearest planet that still pulls, and spends the power-up', () => {
      const match = cpuMatch();
      const cpu = match.players[0];
      const placer = match as unknown as Placer;
      const own = match.world.ships[0];
      // Two planets on the same side: the nearer one is turned already, so the CPU goes for the other.
      match.world.planets = [
        planet(own.x + 150, own.y - 120, { seed: 1, reversed: true }),
        planet(own.x + 250, own.y + 150, { seed: 2 }),
      ];
      cpu.powerUp = 'polarity';
      const aim = placer.cpuPlacementAim(cpu)!;
      expect(aim).not.toBeNull();
      cpu.angle = aim.angle;
      cpu.power = aim.power;
      expect(placer.placeForCpu(0)).toBe(true);
      expect(match.world.planets.map((p) => !!p.reversed)).toEqual([true, true]);
      expect(cpu.powerUp).toBeNull();
    });

    it('never turns a planet back, and keeps the power-up when every planet is turned', () => {
      const match = cpuMatch();
      const cpu = match.players[0];
      const placer = match as unknown as Placer;
      const own = match.world.ships[0];
      match.world.planets = [planet(own.x + 200, own.y, { reversed: true })];
      cpu.powerUp = 'polarity';
      expect(placer.cpuPlacementAim(cpu)).toBeNull();
      expect(cpu.powerUp).toBe('polarity');
    });
  });
});
