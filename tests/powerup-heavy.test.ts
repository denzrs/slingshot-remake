import { describe, expect, it } from 'vitest';
import { createMatch, type Match } from '../src/game';
import { HEAVY, NEBULA } from '../src/config';
import { POWER_UP_KINDS, POWER_UP_WEIGHTS } from '../src/powerups';
import { Shot, simulateShot, type World } from '../src/physics';
import { Volley } from '../src/volley';
import { DEFAULT_SETTINGS } from '../src/settings';

const rules = { bounce: false, timeLimit: 20 };

const rock = { radius: 30, mass: 20_000, seed: 3, style: 'rocky', tint: '#fff' } as const;

/** Two ships on a line with room between and around them, and whatever the test puts in the way. */
const world = (extra: Partial<World> = {}): World => ({
  width: 1280,
  height: 800,
  planets: [],
  holes: [],
  nebulae: [], wormholes: [], defenses: [],
  version: 0,
  ships: [{ x: 100, y: 400, alive: true }, { x: 1180, y: 400, alive: true }],
  ...extra,
});

/** Flies a shot until it ends, or `steps` physics steps have gone by. */
function fly(shot: Shot, steps = 4000): void {
  for (let i = 0; i < steps && !shot.step(); i++);
}

function duel(seed = 13): Match {
  const seats = ['human', 'human', 'off', 'off', 'off', 'off'] as const;
  return createMatch('classic', { ...DEFAULT_SETTINGS, powerUps: true, rounds: 1, maxPlanets: 0, seats: [...seats] }, { seats: [...seats], seed });
}

describe('heavy shot power-up', () => {
  it('is a known kind', () => {
    expect(POWER_UP_KINDS).toContain('heavy');
    expect(POWER_UP_WEIGHTS.heavy).toBeGreaterThan(0);
  });

  describe('in the air', () => {
    it('is bent less by a planet than a plain shot is', () => {
      const w = world({ planets: [{ x: 640, y: 250, ...rock }] });
      const plain = new Shot(w, 0, 0, 60, rules);
      const heavy = new Shot(w, 0, 0, 60, rules, false, [], false, true);
      // Both are halfway across, above them the planet pulls them upwards.
      for (let i = 0; i < 300; i++) {
        plain.step();
        heavy.step();
      }
      const bent = (shot: Shot): number => Math.abs(shot.y - 400);
      expect(bent(plain)).toBeGreaterThan(0);
      expect(bent(heavy)).toBeLessThan(bent(plain));
      // About the share the config names, give or take what the bend itself changes along the way.
      expect(bent(heavy) / bent(plain)).toBeGreaterThan(HEAVY.GRAVITY * 0.7);
      expect(bent(heavy) / bent(plain)).toBeLessThan(HEAVY.GRAVITY * 1.3);
    });

    it('flies through a nebula at the speed it flew in, where a plain shot is slowed', () => {
      const cloud = { x: 640, y: 400, radius: NEBULA.RADIUS, seed: 0.37 };
      const clear = new Shot(world(), 0, 0, 60, rules, false, [], false, true);
      const cloudy = new Shot(world({ nebulae: [cloud] }), 0, 0, 60, rules, false, [], false, true);
      const plain = new Shot(world({ nebulae: [cloud] }), 0, 0, 60, rules);
      for (let i = 0; i < 400; i++) {
        clear.step();
        cloudy.step();
        plain.step();
      }
      // The same flight, bit for bit: the cloud means nothing to a heavy shot.
      expect([cloudy.x, cloudy.y, cloudy.vx, cloudy.vy]).toEqual([clear.x, clear.y, clear.vx, clear.vy]);
      expect(Math.hypot(plain.vx, plain.vy)).toBeLessThan(Math.hypot(cloudy.vx, cloudy.vy));
    });

    it('is still swallowed by a horizon it flies into', () => {
      const w = world({ holes: [{ x: 640, y: 400, radius: 30, mass: 220_000 }] });
      const outcome = simulateShot(w, 0, 0, 100, rules, [], [], false, true);
      expect(outcome.end.kind).toBe('hole');
    });

    it('still stops on a planet and on a ship, a shield included', () => {
      const blocked = world({ planets: [{ x: 640, y: 400, ...rock }] });
      expect(simulateShot(blocked, 0, 0, 80, rules, [], [], false, true).end.kind).toBe('planet');

      const open = world();
      expect(simulateShot(open, 0, 0, 80, rules, [], [], false, true).end).toEqual({ kind: 'ship', ship: 1 });

      const shielded = world();
      shielded.ships[1].shield = true;
      const shot = new Shot(shielded, 0, 0, 80, rules, false, [], false, true);
      fly(shot);
      expect(shot.reflects.map((r) => r.ship)).toEqual([1]);
    });

    it('keeps its weight when a splitter forks it', () => {
      const w = world({ planets: [{ x: 640, y: 250, ...rock }] });
      const heavy = new Shot(w, 0, 0, 60, rules, false, [], false, true);
      const fork = heavy.fork(0);
      for (let i = 0; i < 300; i++) {
        heavy.step();
        fork.step();
      }
      expect([fork.x, fork.y]).toEqual([heavy.x, heavy.y]);
    });
  });

  describe('in a volley', () => {
    it('is carried by the aim to the shot, and a replay of that aim flies the same flight', () => {
      const w = world({ planets: [{ x: 640, y: 250, ...rock }] });
      const live = new Volley(w, [{ player: 0, angle: 0, power: 60, heavy: true }], rules, false);
      expect(live.shots[0].heavy).toBe(true);
      while (!live.done) live.step();

      const replay = new Volley(structuredClone({ ...w, ships: w.ships.map((s) => ({ ...s, alive: true })) }), live.snapshot().aims, rules, false);
      expect(replay.shots[0].heavy).toBe(true);
      while (!replay.done) replay.step();
      expect(replay.shots.map((vs) => [vs.shot.x, vs.shot.y])).toEqual(live.shots.map((vs) => [vs.shot.x, vs.shot.y]));
    });
  });

  describe('as a held power-up', () => {
    it('needs P to arm: the key arms it, and the key again disarms it', () => {
      const match = duel();
      const shooter = match.players[0];
      shooter.powerUp = 'heavy';
      shooter.armed = false;
      match.usePowerUp(0);
      expect(shooter.armed).toBe(true);
      match.usePowerUp(0);
      expect(shooter.armed).toBe(false);
    });

    it('is not spent by a shot while it is not armed', () => {
      const match = duel();
      const shooter = match.players[0];
      shooter.powerUp = 'heavy';
      shooter.armed = false;
      shooter.angle = 270;
      shooter.power = 100;
      match.commit();
      expect(shooter.powerUp).toBe('heavy');
    });

    it('is spent by the next shot once armed, which launches heavy', () => {
      const match = duel();
      const shooter = match.players[0];
      shooter.powerUp = 'heavy';
      shooter.armed = true;
      const aims = (match as unknown as { aimsFor(p: unknown): { heavy?: boolean }[] }).aimsFor(shooter);
      expect(aims[0].heavy).toBe(true);
      expect(shooter.powerUp).toBeNull();
      expect(shooter.armed).toBe(false);
    });

    it('does not cost the shot: it rides the shot that would have been fired anyway', () => {
      const match = duel();
      const shooter = match.players[0];
      shooter.powerUp = 'heavy';
      shooter.armed = true;
      shooter.angle = 270;
      shooter.power = 100;
      match.commit();
      expect(match.phase).toBe('flying');
      expect(match.volley?.shots[0].heavy).toBe(true);
    });
  });

  describe('for a CPU', () => {
    function cpuMatch(seed = 11): Match {
      const seats = ['easy', 'human', 'off', 'off', 'off', 'off'] as const;
      return createMatch('classic', { ...DEFAULT_SETTINGS, powerUps: true, rounds: 1, maxPlanets: 0, seats: [...seats] }, { seats: [...seats], seed });
    }

    it('keeps it back when it picks it up: a plain shot comes first', () => {
      const match = cpuMatch();
      const cpu = match.players[0];
      const ship = match.world.ships[0];
      match.pickups = [{ id: 1, kind: 'heavy', x: ship.x + 250, y: ship.y, born: 0 }];
      (match as unknown as { launch(aims: unknown[], track: boolean): void }).launch([{ player: 0, angle: 0, power: 60 }], true);
      for (let t = 0; t < 120 && match.phase === 'flying'; t += 1 / 30) match.update(1 / 30);
      expect(cpu.powerUp).toBe('heavy');
      expect(cpu.armed).toBe(false);
    });

    it('arms it once, and plans again, when the plain plan finds nothing to hit', () => {
      const match = cpuMatch();
      const cpu = match.players[0];
      cpu.powerUp = 'heavy';
      cpu.armed = false;
      const rescue = match as unknown as { cpuRescueIfBlind(p: unknown, job: unknown): boolean };
      const blind = { planner: null, target: { angle: 0, power: 50 }, settle: 0, blind: true };
      expect(rescue.cpuRescueIfBlind(cpu, blind)).toBe(true);
      expect(cpu.armed).toBe(true);
      // Armed, a second blind plan has nothing left to try.
      expect(rescue.cpuRescueIfBlind(cpu, { ...blind })).toBe(false);
      expect(cpu.powerUp).toBe('heavy');
    });

    it('leaves it alone when the plain plan found a hit', () => {
      const match = cpuMatch();
      const cpu = match.players[0];
      cpu.powerUp = 'heavy';
      cpu.armed = false;
      const rescue = match as unknown as { cpuRescueIfBlind(p: unknown, job: unknown): boolean };
      expect(rescue.cpuRescueIfBlind(cpu, { planner: null, target: { angle: 0, power: 50 }, settle: 0, blind: false })).toBe(false);
      expect(cpu.armed).toBe(false);
    });
  });
});
