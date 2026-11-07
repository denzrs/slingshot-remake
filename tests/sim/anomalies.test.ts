import { describe, expect, it } from 'vitest';
import { ANOMALY, FIELD, type Anomaly } from '../../src/sim/config';
import { anomalyRules, fuseSeconds } from '../../src/sim/anomalies';
import { t } from '../../src/platform/i18n';
import { Shot, simulateShot, cloneWorld, planetDurability, hasTrickShotSources, type Planet, type ShotRules, type World } from '../../src/sim/physics';
import { Volley } from '../../src/sim/volley';
import { roomRulesFrom } from '../../src/data/roomRules';
import { createMatch } from '../../src/game';
import { ClassicMatch } from '../../src/game/classic';
import { cloneSettings, DEFAULT_SETTINGS, type Seat, type Settings } from '../../src/data/settings';

function emptyWorld(ships: [number, number][] = [[100, 400], [1180, 400]]): World {
  return {
    width: FIELD.width,
    height: FIELD.height,
    planets: [],
    ships: ships.map(([x, y]) => ({ x, y, alive: true })),
    holes: [],
    nebulae: [], wormholes: [], defenses: [],
    version: 0,
  };
}

const planet = (x: number, y: number, radius: number, mass = radius ** 3): Planet => ({ x, y, radius, mass, seed: x * 31 + y, style: 'rocky', tint: '#fff' });

const open: ShotRules = { edges: 'void', timeLimit: 20 };

/** Flies a shot to its end and gives it back, with every ship it warned on the way. */
function fly(world: World, shooter: number, angle: number, power: number, rules: ShotRules): { shot: Shot; warned: number[]; armedAt: { x: number; y: number }[] } {
  const shot = new Shot(world, shooter, angle, power, rules);
  const warned: number[] = [];
  const armedAt: { x: number; y: number }[] = [];
  while (!shot.step()) {
    warned.push(...shot.warnings.map((w) => w.ship));
    armedAt.push(...shot.arms);
    shot.warnings.length = 0;
    shot.arms.length = 0;
  }
  warned.push(...shot.warnings.map((w) => w.ship));
  armedAt.push(...shot.arms);
  return { shot, warned, armedAt };
}

describe('Trick Shots Only', () => {
  it('lets a straight shot fly through the enemy, with a warning and no kill', () => {
    const { shot, warned } = fly(emptyWorld(), 0, 0, 50, { ...open, trickShots: true });
    expect(shot.end?.kind).toBe('lost');
    expect(warned).toEqual([1]);
    expect(shot.armed).toBe(false);
  });

  it('arms a shot that comes off a wall, which then kills whoever it meets: its own shooter too', () => {
    // Fired away from the enemy, the shot comes back off the left wall, armed, and meets its own ship first.
    const world = emptyWorld([[300, 400], [1180, 400]]);
    const { shot, armedAt } = fly(world, 0, 180, 50, { edges: 'wall', timeLimit: 20, trickShots: true });
    expect(armedAt).toHaveLength(1);
    expect(armedAt[0].x).toBeLessThan(10);
    expect(shot.end).toEqual({ kind: 'ship', ship: 0 });
    // A little above the line, it passes its shooter and takes the enemy.
    const past = fly(emptyWorld([[300, 400], [1180, 322]]), 0, 177, 50, { edges: 'wall', timeLimit: 20, trickShots: true });
    expect(past.shot.end).toEqual({ kind: 'ship', ship: 1 });
  });

  it('arms a shot that crosses a loop\'s edge', () => {
    const world = emptyWorld([[300, 400], [1180, 400]]);
    const { shot, armedAt } = fly(world, 0, 180, 50, { edges: 'loop', timeLimit: 20, trickShots: true });
    expect(armedAt).toHaveLength(1);
    expect(shot.end).toEqual({ kind: 'ship', ship: 1 });
  });

  it('arms a shot that swings round a planet', () => {
    const world = emptyWorld([[100, 400], [1180, 700]]);
    world.planets.push(planet(640, 520, 40));
    const armed = new Shot(world, 0, 5, 45, { ...open, trickShots: true });
    let swung = false;
    while (!armed.step()) if (armed.swingbys > 0) swung = true;
    expect(swung || armed.swingbys > 0).toBe(armed.armed);
  });

  it('is armed from the start without the anomaly', () => {
    expect(new Shot(emptyWorld(), 0, 0, 50, open).armed).toBe(true);
    expect(simulateShot(emptyWorld(), 0, 0, 50, open).end).toEqual({ kind: 'ship', ship: 1 });
  });
});

describe('Pinball', () => {
  it('throws a shot back off a planet instead of stopping it', () => {
    const world = emptyWorld([[100, 400], [1180, 100]]);
    world.planets.push(planet(640, 400, 40, 1));
    const shot = new Shot(world, 0, 0, 50, { ...open, pinball: true });
    let bumped = 0;
    while (!shot.step()) {
      bumped += shot.bumps.length;
      shot.bumps.length = 0;
    }
    expect(bumped).toBeGreaterThan(0);
    expect(shot.end?.kind).not.toBe('planet');
    // Head on, it comes straight back.
    expect(shot.vx).toBeLessThan(0);
  });

  it('sets a shot off that rattles on one planet, however slowly it flies', () => {
    const world = emptyWorld([[100, 400], [1180, 100]]);
    world.planets.push(planet(640, 400, 40, 400000));
    // Hardly any power: gravity pulls the shot back onto the rock again and again, every few tenths of a second.
    const shot = new Shot(world, 0, 0, 1, { ...open, pinball: true });
    shot.x = 640 - 60;
    shot.y = 400;
    shot.vx = 0;
    shot.vy = 0;
    let bumped = 0;
    while (!shot.step()) {
      bumped += shot.bumps.length;
      shot.bumps.length = 0;
    }
    bumped += shot.bumps.length;
    expect(shot.end?.kind).toBe('blast');
    expect(bumped).toBe(ANOMALY.BUMP_LIMIT + 1);
    expect(shot.time).toBeLessThan(ANOMALY.BUMP_WINDOW);
  });

  it('lets a shot that bounces off a planet now and then fly on', () => {
    const world = emptyWorld([[100, 400], [1180, 100]]);
    world.planets.push(planet(640, 400, 40, 4000));
    const shot = new Shot(world, 0, 0, 1, { ...open, pinball: true });
    shot.x = 640 - 60;
    shot.y = 400;
    shot.vx = 0;
    shot.vy = 0;
    while (!shot.step());
    expect(shot.end?.kind).toBe('timeout');
  });

  it('stops a shot on a planet without the anomaly', () => {
    const world = emptyWorld([[100, 400], [1180, 100]]);
    world.planets.push(planet(640, 400, 40, 1));
    expect(simulateShot(world, 0, 0, 50, open).end).toEqual({ kind: 'planet', planet: 0 });
  });
});

describe('Time Fuse', () => {
  it('burns between a quarter and a half of the shot time, the same for the same round', () => {
    for (let seed = 1; seed < 200; seed += 7) {
      const fuse = fuseSeconds(20, seed);
      expect(fuse).toBeGreaterThanOrEqual(20 * ANOMALY.FUSE_MIN - 0.05);
      expect(fuse).toBeLessThanOrEqual(20 * ANOMALY.FUSE_MAX + 0.05);
      expect(fuseSeconds(20, seed)).toBe(fuse);
    }
    expect(fuseSeconds(5, 3)).toBeGreaterThanOrEqual(ANOMALY.FUSE_FLOOR);
    expect(new Set(Array.from({ length: 30 }, (_, i) => fuseSeconds(20, i * 977))).size).toBeGreaterThan(5);
  });

  it('sets off a shot where it is, and takes the ships in reach with it', () => {
    // The enemy sits a little off the line, so the shot passes it; the fuse goes off right beside it.
    const world = emptyWorld([[100, 400], [600, 430]]);
    const shot = new Shot(world, 0, 0, 25, { ...open, fuse: 2.5 });
    while (!shot.step());
    expect(shot.end).toEqual({ kind: 'blast' });
    expect(shot.time).toBeCloseTo(2.5, 1);
    expect(shot.hits.map((hit) => hit.ship)).toEqual([1]);
  });

  it('lets a shield soak the blast up instead', () => {
    const world = emptyWorld([[100, 400], [600, 430]]);
    world.ships[1].shield = true;
    const shot = new Shot(world, 0, 0, 25, { ...open, fuse: 2.5 });
    while (!shot.step());
    expect(shot.hits).toEqual([]);
    expect(shot.reflects.map((r) => r.ship)).toEqual([1]);
  });

  it('arms the shot and hits ships in reach when the fuse goes off under Trick Shots Only (timed blast is a trick hit)', () => {
    const world = emptyWorld([[100, 400], [600, 430]]);
    const shot = new Shot(world, 0, 0, 25, { ...open, fuse: 2.5, trickShots: true });
    while (!shot.step());
    expect(shot.end).toEqual({ kind: 'blast' });
    expect(shot.hits.map((h) => h.ship)).toEqual([1]);
    expect(shot.armed).toBe(true);
  });

  it('extends the fuse when power is capped or fixed to ensure the blast can reach the enemy', () => {
    // With power capped at 15 (speed 120 px/s), traversing ~850px takes ~7.1s.
    // A standard 10s shot time would otherwise produce a fuse between 2.5s and 5.0s, detonating far too early.
    const standardFuse = fuseSeconds(10, 42);
    expect(standardFuse).toBeLessThanOrEqual(5.0);
    const extendedFuse = fuseSeconds(10, 42, 15);
    expect(extendedFuse).toBeGreaterThanOrEqual(7.0);
    expect(extendedFuse).toBeLessThanOrEqual(9.5);
  });

  it('counts for the CPU as a kill', () => {
    const outcome = simulateShot(emptyWorld([[100, 400], [600, 430]]), 0, 0, 25, { ...open, fuse: 2.5 });
    expect(outcome.pierced).toEqual([1]);
  });
});

describe('Fusion', () => {
  /** Two ships fire at each other head on, slightly off the line, so their shots meet in the middle at an angle. */
  function headOn(rules: ShotRules): Volley {
    const world = emptyWorld([[100, 400], [1180, 400], [640, 100]]);
    return new Volley(world, [{ player: 0, angle: 10, power: 50 }, { player: 1, angle: 170, power: 50 }], rules, false);
  }

  it('melts two shots that meet into one both shooters own', () => {
    const volley = headOn({ ...open, fusion: true });
    const fused: number[] = [];
    while (!volley.done && volley.steps < 20_000) {
      for (const e of volley.step()) if (e.type === 'fusion') fused.push(e.index);
    }
    expect(fused).toEqual([2]);
    expect(volley.shots[0].shot.end).toEqual({ kind: 'fused', into: 2 });
    expect(volley.shots[1].shot.end).toEqual({ kind: 'fused', into: 2 });
    const melted = volley.shots[2];
    expect(melted.owner).toBe(0);
    expect(melted.partner).toBe(1);
    expect(melted.shot.fused).toBe(true);
  });

  it('flies on with both shots\' momentum: head on, the sideways parts cancel and the rest adds up', () => {
    const volley = headOn({ ...open, fusion: true });
    let at: { vx: number; vy: number } | null = null;
    while (!volley.done && !at) {
      for (const e of volley.step()) if (e.type === 'fusion') at = { vx: volley.shots[e.index].shot.vx, vy: volley.shots[e.index].shot.vy };
    }
    expect(at).not.toBeNull();
    expect(Math.abs(at!.vx)).toBeLessThan(1);
    // Both were fired upward (angles 10° and 170°): the melted shot keeps going up.
    expect(at!.vy).toBeLessThan(0);
  });

  it('lets the shots cancel each other out without the anomaly, as ever', () => {
    const volley = headOn(open);
    while (!volley.done) volley.step();
    expect(volley.shots).toHaveLength(2);
    expect(volley.shots[0].shot.end?.kind).toBe('clash');
  });

  it('flies the same melted shot again in a replay', () => {
    const fly = (): number[] => {
      const volley = headOn({ ...open, fusion: true });
      while (!volley.done) volley.step();
      return volley.shots.flatMap((vs) => [vs.shot.x, vs.shot.y]);
    };
    expect(fly()).toEqual(fly());
  });
});

describe('anomaly rules', () => {
  it('turn the room\'s list into flight rules, and nothing without any', () => {
    expect(anomalyRules([], 20, 1)).toEqual({});
    expect(anomalyRules(['pinball', 'fusion'], 20, 1)).toEqual({ trickShots: false, pinball: true, fuse: 0, fusion: true, whiteHole: false, unstable: false });
    expect(anomalyRules(['fuse'], 20, 1).fuse).toBe(fuseSeconds(20, 1));
  });

  it('keep only known anomalies from saved rules, each once and in order', () => {
    expect(roomRulesFrom({ anomalies: ['fusion', 'gravityStrike', 'trickShots', 'fusion'] } as never).anomalies).toEqual(['trickShots', 'fusion']);
    expect(roomRulesFrom({}).anomalies).toEqual([]);
    expect(roomRulesFrom({ anomalies: 'fuse' } as never).anomalies).toEqual([]);
  });
});

describe('the anomalies\' alarm', () => {
  const seats: Seat[] = ['human', 'easy', 'off', 'off', 'off', 'off'];
  const make = (anomalies: Settings['anomalies'], mode: 'classic' | 'horizon' = 'classic') =>
    createMatch(mode, { ...cloneSettings(DEFAULT_SETTINGS), rounds: 3, anomalies, seats: [...seats] }, { seats: [...seats], seed: 7 });

  it('opens the first round of a match that plays by anomalies, and holds the ships until it is dismissed', () => {
    for (const mode of ['classic', 'horizon'] as const) {
      const match = make(['fuse', 'fusion'], mode);
      expect(match.anomalyAlert).toBe(true);
      expect(match.revealing).toBe(true);
      // Long after its time it still waits for the human, as Mayhem's announcement does.
      for (let i = 0; i < 50; i++) match.update(0.1);
      expect(match.revealing).toBe(true);
      expect(match.skipReveal()).toBe(true);
      expect(match.revealing).toBe(false);
    }
  });

  it('is not raised again in later rounds, nor in a match without anomalies', () => {
    const match = make(['pinball']);
    match.skipReveal();
    match.startRound();
    expect(match.round).toBe(2);
    expect(match.anomalyAlert).toBe(false);
    expect(match.revealing).toBe(false);
    const plain = make([]);
    expect(plain.anomalyAlert).toBe(false);
    expect(plain.revealing).toBe(false);
  });

  it('is raised in every round of a Mayhem match that plays by anomalies', () => {
    const match = createMatch(
      'classic',
      { ...cloneSettings(DEFAULT_SETTINGS), mayhem: 1, rounds: 3, anomalies: ['pinball'], seats: [...seats] },
      { seats: [...seats], seed: 7 },
    );
    expect(match.round).toBe(1);
    expect(match.anomalyAlert).toBe(true);
    expect(match.revealing).toBe(true);

    match.skipReveal();
    match.startRound();
    expect(match.round).toBe(2);
    expect(match.anomalyAlert).toBe(true);
    expect(match.revealing).toBe(true);
  });

  it('travels with a snapshot, so a guest sees it too', () => {
    const host = make(['trickShots']) as ClassicMatch;
    const guest = make([]) as ClassicMatch;
    guest.restoreSnapshot(host.snapshot());
    expect(guest.anomalyAlert).toBe(true);
    expect(guest.revealing).toBe(true);
  });
});


describe('Unstable', () => {
  const contact = (world: World, pinball = false) => {
    const volley = new Volley(world, [{ player: 0, angle: 0, power: 50 }], { ...open, unstable: true, pinball }, true);
    const p = world.planets[0];
    Object.assign(volley.shots[0].shot, { x: p.x - p.radius + .1, y: p.y, vx: 400, vy: 0 });
    return { volley, events: volley.step() };
  };

  it('keeps damage from normal hits and Pinball bounces, then removes the rock and its gravity', () => {
    for (const pinball of [false, true]) {
      const world = emptyWorld();
      world.planets.push(planet(640, 400, 24, 0));
      world.defenses.push({ x: 640, y: 376, radius: 70, planet: world.planets[0].seed, owner: 0, protects: [0] });
      const first = contact(world, pinball);
      expect(world.planets[0].fractures).toHaveLength(1);
      expect(first.volley.shots[0].shot.end?.kind).toBe(pinball ? undefined : 'planet');
      const second = contact(world, pinball);
      expect(world.planets).toHaveLength(0);
      expect(world.defenses[0].wrecked).toBe(true);
      expect(second.events.some((e) => e.type === 'planetShatter')).toBe(true);
      if (!pinball) expect(second.volley.shots[0].shot.end).toMatchObject({ surface: { x: 640, y: 400, radius: 24 } });
    }
  });

  it('makes larger planets last longer, and leaves the sun intact', () => {
    expect(planetDurability({ radius: 60 })).toBeGreaterThan(planetDurability({ radius: 20 }));
    const world = emptyWorld(); world.planets.push({ ...planet(640, 400, 24, 0), sun: true });
    for (let i = 0; i < 8; i++) contact(world, true);
    expect(world.planets).toHaveLength(1); expect(world.planets[0].fractures).toBeUndefined();
  });

  it('does not mutate the world while planning, and deep-clones persistent fractures', () => {
    const world = emptyWorld(); world.planets.push({ ...planet(640, 400, 24, 0), fractures: [0] });
    const copy = cloneWorld(world); copy.planets[0].fractures!.push(1);
    expect(world.planets[0].fractures).toEqual([0]);
    simulateShot(world, 0, 0, 50, { ...open, unstable: true, pinball: true });
    expect(world.planets[0].fractures).toEqual([0]); expect(world.version).toBe(0);
  });

  it('lets a planning shot fly on through a planet it has broken, without its pull, and leaves the world as it was', () => {
    const world = emptyWorld(); world.planets.push(planet(640, 400, 24));
    const rock = world.planets[0];
    const shot = new Shot(world, 0, 0, 50, { ...open, unstable: true, pinball: true }, true);
    for (let hit = 0; hit < planetDurability(rock); hit++) {
      Object.assign(shot, { x: rock.x - rock.radius + .1, y: rock.y, vx: 400, vy: 0 });
      expect(shot.step()).toBeNull();
    }
    expect(shot.planetHits).toHaveLength(planetDurability(rock));
    // Where the rock was: no stop, and no pull sideways.
    Object.assign(shot, { x: rock.x, y: rock.y - 30, vx: 0, vy: 0 });
    expect(shot.step()).toBeNull();
    expect(Math.abs(shot.vy) + Math.abs(shot.vx)).toBeLessThan(1e-9);
    Object.assign(shot, { x: rock.x, y: rock.y, vx: 100, vy: 0 });
    expect(shot.step()).toBeNull();
    expect(Number.isFinite(shot.x + shot.y + shot.vx + shot.vy)).toBe(true);
    // A fork keeps the view, and a live volley taking the rock out gives the world back.
    const fork = shot.fork(0);
    Object.assign(fork, { x: rock.x, y: rock.y, vx: 100, vy: 0 });
    expect(fork.step()).toBeNull();
    shot.forgetPlanet(0);
    expect(world.planets).toHaveLength(1);
    expect(world.planets[0].fractures).toBeUndefined();
    expect(world.version).toBe(0);
  });

  it('replays the same terrain damage and restores an ongoing volley', () => {
    const world = emptyWorld(); world.planets.push(planet(640, 400, 36, 0));
    const rules = { ...open, unstable: true, pinball: true };
    const original = new Volley(world, [{ player: 0, angle: 0, power: 50 }], rules, true);
    while (!world.planets[0].fractures?.length) original.step();
    const restoredWorld = cloneWorld(world);
    const restored = new Volley(restoredWorld, original.snapshot().aims, rules, true); restored.restore(original.snapshot());
    for (let i = 0; i < 100; i++) { expect(restored.step()).toEqual(original.step()); }
    expect(restoredWorld).toEqual(world);
  });
});

describe('White Hole and solar Pinball', () => {
  it('returns shots from either kind of black hole at a seeded edge, with inward velocity', () => {
    const exits = [];
    for (const radius of [22, 65]) {
      const world = emptyWorld(); world.holes.push({ x: 640, y: 400, radius, mass: 0 });
      const run = () => {
        const shot = new Shot(world, 0, 0, 50, { ...open, whiteHole: true });
        Object.assign(shot, { x: 639, y: 400, vx: 400, vy: 0 });
        shot.step();
        expect(shot.end).toBeNull(); expect(shot.whiteExit).toBeDefined();
        expect(shot.x > 0 && shot.x < FIELD.width && shot.y > 0 && shot.y < FIELD.height).toBe(true);
        expect((FIELD.width / 2 - shot.x) * shot.vx + (FIELD.height / 2 - shot.y) * shot.vy).toBeGreaterThan(0);
        return shot.whiteExit;
      };
      exits.push(run()); expect(run()).toEqual(exits.at(-1));
    }
    expect(exits[0]).toEqual(exits[1]);
  });

  it('gives a sun bounce a storm kick and sparks, while a normal planet reflects plainly', () => {
    const run = (sun: boolean) => {
      const world = emptyWorld(); world.planets.push({ ...planet(640, 400, 40, 0), sun });
      const shot = new Shot(world, 0, 0, 50, { ...open, pinball: true });
      Object.assign(shot, { x: 601, y: 400, vx: 400, vy: 0 }); shot.step(); return shot;
    };
    const plain = run(false), sun = run(true);
    expect(plain.vy).toBe(0); expect(sun.vy).not.toBe(0); expect(sun.stormUntil).toBeGreaterThan(sun.time);
    expect(sun.vx).toBeLessThan(0); expect(run(true).vy).toBe(sun.vy);
  });
});

describe('Free Fire Showdown in Vacuum', () => {
  const seats: Seat[] = ['human', 'easy', 'off', 'off', 'off', 'off'];
  const make = (anomalies: Settings['anomalies'], mode: 'classic' | 'horizon' = 'classic') =>
    createMatch(mode, { ...cloneSettings(DEFAULT_SETTINGS), rounds: 3, anomalies, seats: [...seats] }, { seats: [...seats], seed: 7 });

  it('detects when trick-shot sources are present or absent', () => {
    const world = emptyWorld();
    expect(hasTrickShotSources(world, open)).toBe(false);
    expect(hasTrickShotSources(world, { ...open, edges: 'wall' })).toBe(true);
    expect(hasTrickShotSources(world, { ...open, edges: 'loop' })).toBe(true);

    world.planets.push(planet(640, 400, 20));
    expect(hasTrickShotSources(world, open)).toBe(true);
    world.planets.length = 0;

    world.holes.push({ x: 640, y: 400, radius: 20, mass: 1000 });
    expect(hasTrickShotSources(world, open)).toBe(true);
    world.holes.length = 0;

    world.wormholes.push({ id: 0, ax: 100, ay: 100, bx: 200, by: 200, radius: 20 });
    expect(hasTrickShotSources(world, open)).toBe(true);
  });

  it('lifts trickShots and announces Free Fire when all planets are destroyed in Classic', () => {
    const match = make(['trickShots', 'unstable']) as ClassicMatch;
    expect(match.rules.trickShots).toBe(true);

    // Shatter/remove all planets from the battlefield
    match.world.planets.length = 0;

    // Rules dynamically lift trickShots on open field with no trick-shot sources
    expect(match.rules.trickShots).toBe(false);

    // checkFreeFire triggers notice and event
    let eventEmitted = false;
    match.on((e) => {
      if (e.type === 'freeFire') eventEmitted = true;
    });
    match.checkFreeFire();

    expect(match.notice?.text).toBe(t('notice.freeFire'));
    expect(eventEmitted).toBe(true);

    // A direct shot is now armed and eliminates an enemy
    const volley = new Volley(match.world, [{ player: 0, angle: 0, power: 50 }], match.rules, true);
    expect(volley.shots[0].shot.armed).toBe(true);
  });

  it('keeps trickShots required if walls provide trick-shot opportunities even without planets', () => {
    const settings = { ...DEFAULT_SETTINGS, edges: 'wall' as const, anomalies: ['trickShots', 'unstable'] as Anomaly[] };
    const match = createMatch('classic', settings, { seats: ['human', 'human'] }) as ClassicMatch;
    expect(match.rules.edges).toBe('wall');

    match.world.planets.length = 0;
    // Walls still allow banks, so trickShots remains active
    expect(match.rules.trickShots).toBe(true);
  });
});
