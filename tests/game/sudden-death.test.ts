import { describe, expect, it } from 'vitest';
import { ClassicMatch, createMatch, SolarMatch, type GameEvent } from '../../src/game';
import { FIELD, SOLAR, SUDDEN_DEATH, SUDDEN_DEATH_KINDS, type SuddenDeathKind } from '../../src/sim/config';
import { DEFAULT_SETTINGS, type Seat } from '../../src/data/settings';
import { simulateShot, type Ship, type World } from '../../src/sim/physics';
import { onOrbit } from '../../src/sim/world';
import { t } from '../../src/platform/i18n';

const cpus = (n: number): Seat[] => [...Array(n).fill('medium'), ...Array(6 - n).fill('off')];
const play = (mode: 'classic' | 'solar', seed: number, players = 3, suddenDeath = true) => {
  const seats = cpus(players);
  return createMatch(mode, { ...DEFAULT_SETTINGS, rounds: 1, seats, suddenDeath }, { seats, seed, deterministicCpu: true });
};

/** A Classic round that has drawn this kind of sudden death, whatever its seed would have given. */
const classic = (kind: SuddenDeathKind, seed = 3, players = 3, suddenDeath = true): ClassicMatch => {
  const match = play('classic', seed, players, suddenDeath) as ClassicMatch;
  match.debugSuddenDeath(kind);
  return match;
};

/** Ends the pass under way, as if every ship still in had just fired. */
const endPass = (match: ClassicMatch, passes: number): void => match.debugEndPass(passes);
/** Lets the system turn until it has. */
const turn = (match: ClassicMatch): void => {
  for (let t = 0; t < 10 && match.phase === 'orbit'; t += 1 / 30) match.update(1 / 30);
};

describe('a ship pulling shots in', () => {
  const world = (ships: Ship[]): World => ({ width: FIELD.width, height: FIELD.height, planets: [], ships, holes: [], nebulae: [], wormholes: [], defenses: [], version: 0 });
  const rules = { bounce: false, timeLimit: 20 };
  // A shot straight to the right, passing well above the second ship.
  const closest = (pull: number | undefined, teams: [number | null, number | null] = [null, null]): number =>
    simulateShot(world([
      { x: 100, y: 200, alive: true, pull, team: teams[0] },
      { x: 600, y: 330, alive: true, pull, team: teams[1] },
    ]), 0, 0, 50, rules).closest;

  it('bends an enemy\'s shot towards it', () => {
    expect(closest(SUDDEN_DEATH.PULL_STEP * SUDDEN_DEATH.PULL_STEPS)).toBeLessThan(closest(undefined) - 20);
  });

  it('leaves its teammates\' shots alone', () => {
    expect(closest(SUDDEN_DEATH.PULL_STEP * SUDDEN_DEATH.PULL_STEPS, [0, 0])).toBeCloseTo(closest(undefined), 6);
  });
});

describe('sudden death in Classic', () => {
  it('counts down, then has every ship pull a little harder each pass, up to a limit', () => {
    const match = classic('gravity');
    try {
      expect(match.suddenDeathIn).toBe(SUDDEN_DEATH.START_PASS);
      endPass(match, SUDDEN_DEATH.START_PASS - 1);
      expect(match.suddenDeathIn).toBe(1);
      expect(match.world.ships.some((s) => s.pull)).toBe(false);
      endPass(match, SUDDEN_DEATH.START_PASS);
      expect(match.suddenDeathIn).toBe(0);
      expect(match.world.ships.every((s) => s.pull === SUDDEN_DEATH.PULL_STEP)).toBe(true);
      endPass(match, SUDDEN_DEATH.START_PASS + 1);
      expect(match.world.ships.every((s) => s.pull === SUDDEN_DEATH.PULL_STEP * 2)).toBe(true);
      endPass(match, SUDDEN_DEATH.START_PASS + SUDDEN_DEATH.PULL_STEPS + 5);
      expect(match.world.ships.every((s) => s.pull === SUDDEN_DEATH.PULL_STEP * SUDDEN_DEATH.PULL_STEPS)).toBe(true);
    } finally {
      match.dispose();
    }
  });

  it('announces itself as a gravity well', () => {
    const match = classic('gravity');
    try {
      const events: GameEvent[] = [];
      match.on((e) => events.push(e));
      endPass(match, SUDDEN_DEATH.START_PASS);
      endPass(match, SUDDEN_DEATH.START_PASS + 1);
      expect(events.filter((e) => e.type === 'suddenDeath')).toEqual([{ type: 'suddenDeath', kind: 'gravity' }]);
      expect(match.notice?.text).toBe(t('notice.gravity'));
    } finally {
      match.dispose();
    }
  });

  it('carries the pass count and who has fired through a snapshot', () => {
    const match = classic('gravity');
    const copy = classic('gravity');
    try {
      endPass(match, SUDDEN_DEATH.START_PASS - 2);
      const snapshot = { ...match.snapshot(), fired: [1] };
      copy.restoreSnapshot(snapshot);
      expect(copy.suddenDeathIn).toBe(2);
      expect(copy.snapshot()).toMatchObject({ passes: SUDDEN_DEATH.START_PASS - 2, fired: [1], suddenDeathKind: 'gravity', environmentDecided: false });
    } finally {
      match.dispose();
      copy.dispose();
    }
  });

  it('never comes while the rule is off', () => {
    const match = classic('gravity', 3, 3, false);
    try {
      expect(match.suddenDeathIn).toBeNull();
      endPass(match, SUDDEN_DEATH.START_PASS + 3);
      expect(match.world.ships.some((s) => s.pull)).toBe(false);
    } finally {
      match.dispose();
    }
  });

  it('starts over with the next round', () => {
    const seats = cpus(2);
    const match = createMatch('classic', { ...DEFAULT_SETTINGS, rounds: 2, seats }, { seats, seed: 4, deterministicCpu: true }) as ClassicMatch;
    try {
      endPass(match, SUDDEN_DEATH.START_PASS);
      match.startRound();
      expect(match.suddenDeathIn).toBe(SUDDEN_DEATH.START_PASS);
      expect(match.world.ships.some((s) => s.pull)).toBe(false);
    } finally {
      match.dispose();
    }
  });
});

describe('sudden death as a collision course', () => {
  const gap = (match: ClassicMatch): number => {
    const ships = match.world.ships.filter((_, i) => match.players[i].alive);
    let nearest = Infinity;
    for (const a of ships) for (const b of ships) if (a !== b) nearest = Math.min(nearest, Math.hypot(a.x - b.x, a.y - b.y));
    return nearest;
  };

  it('announces itself, then has the ships drift together as the pass turns', () => {
    const match = classic('collision', 5);
    try {
      const events: GameEvent[] = [];
      match.on((e) => events.push(e));
      const before = gap(match);
      endPass(match, SUDDEN_DEATH.START_PASS);
      expect(events.filter((e) => e.type === 'suddenDeath')).toEqual([{ type: 'suddenDeath', kind: 'collision' }]);
      expect(match.notice?.text).toBe(t('notice.collision'));
      expect(match.phase).toBe('orbit');
      expect(match.adrift).toBe(true);
      turn(match);
      expect(match.adrift).toBe(false);
      expect(match.phase).toBe('aiming');
      expect(gap(match)).toBeLessThan(before);
      // Every gap shrinks by the same share, so the nearest does too.
      expect(gap(match)).toBeCloseTo(before * (1 - SUDDEN_DEATH.COLLISION.FRACTION), 0);
    } finally {
      match.dispose();
    }
  });

  it('pulls a little harder each pass, and never brings two ships closer than the minimum gap', () => {
    const match = classic('collision', 5, 4);
    try {
      let last = gap(match);
      for (let pass = SUDDEN_DEATH.START_PASS; pass < SUDDEN_DEATH.START_PASS + 25; pass++) {
        endPass(match, pass);
        turn(match);
        const now = gap(match);
        expect(now).toBeLessThanOrEqual(last + 1e-6);
        expect(now).toBeGreaterThanOrEqual(Math.min(last, SUDDEN_DEATH.COLLISION.MIN_GAP) - 1e-6);
        last = now;
      }
      // By then they have come together as far as they will.
      expect(last).toBeLessThan(SUDDEN_DEATH.COLLISION.MIN_GAP * 1.5);
    } finally {
      match.dispose();
    }
  });

  it('keeps every ship clear of the planets', () => {
    const match = classic('collision', 7, 3);
    try {
      for (let pass = SUDDEN_DEATH.START_PASS; pass < SUDDEN_DEATH.START_PASS + 12; pass++) {
        endPass(match, pass);
        turn(match);
        for (const ship of match.world.ships) for (const p of match.world.planets) expect(Math.hypot(ship.x - p.x, ship.y - p.y)).toBeGreaterThan(p.radius + 13);
      }
    } finally {
      match.dispose();
    }
  });

  it('never comes while the rule is off', () => {
    const match = classic('collision', 5, 3, false);
    try {
      const before = match.world.ships.map((s) => [s.x, s.y]);
      endPass(match, SUDDEN_DEATH.START_PASS + 2);
      expect(match.adrift).toBe(false);
      expect(match.world.ships.map((s) => [s.x, s.y])).toEqual(before);
    } finally {
      match.dispose();
    }
  });

  it('carries a drift under way through a snapshot', () => {
    const match = classic('collision', 5);
    const copy = classic('collision', 5);
    try {
      endPass(match, SUDDEN_DEATH.START_PASS);
      match.update(0.4);
      copy.restoreSnapshot(match.snapshot());
      expect(copy.adrift).toBe(true);
      expect(copy.phase).toBe('orbit');
      turn(match);
      turn(copy);
      expect(copy.adrift).toBe(false);
      expect(copy.world.ships.map((s) => [s.x, s.y])).toEqual(match.world.ships.map((s) => [s.x, s.y]));
    } finally {
      match.dispose();
      copy.dispose();
    }
  });
});

describe('sudden death as an overcharge', () => {
  const reaches = (match: ClassicMatch): (number | undefined)[] => match.world.ships.map((s) => s.reach);

  it('announces itself, then widens every ship\'s hit zone a little each pass, up to a limit', () => {
    const match = classic('overcharge', 5);
    try {
      const events: GameEvent[] = [];
      match.on((e) => events.push(e));
      const { REACH_STEP, STEPS } = SUDDEN_DEATH.OVERCHARGE;
      endPass(match, SUDDEN_DEATH.START_PASS - 1);
      expect(reaches(match).every((r) => r === undefined)).toBe(true);
      endPass(match, SUDDEN_DEATH.START_PASS);
      expect(events.filter((e) => e.type === 'suddenDeath')).toEqual([{ type: 'suddenDeath', kind: 'overcharge' }]);
      expect(match.notice?.text).toBe(t('notice.overcharge'));
      expect(reaches(match).every((r) => r === REACH_STEP)).toBe(true);
      endPass(match, SUDDEN_DEATH.START_PASS + 1);
      expect(reaches(match).every((r) => r === REACH_STEP * 2)).toBe(true);
      endPass(match, SUDDEN_DEATH.START_PASS + STEPS + 5);
      expect(reaches(match).every((r) => r === REACH_STEP * STEPS)).toBe(true);
      // It moves nothing and pulls nothing.
      expect(match.adrift).toBe(false);
      expect(match.world.ships.some((s) => s.pull)).toBe(false);
    } finally {
      match.dispose();
    }
  });

  it('never comes while the rule is off, and starts over with the next round', () => {
    const off = classic('overcharge', 5, 3, false);
    const on = classic('overcharge', 5);
    try {
      endPass(off, SUDDEN_DEATH.START_PASS + 2);
      expect(reaches(off).every((r) => r === undefined)).toBe(true);
      endPass(on, SUDDEN_DEATH.START_PASS);
      on.startRound();
      expect(reaches(on).every((r) => r === undefined)).toBe(true);
    } finally {
      off.dispose();
      on.dispose();
    }
  });

  it('carries the reach through a snapshot', () => {
    const match = classic('overcharge', 5);
    const copy = classic('overcharge', 5);
    try {
      endPass(match, SUDDEN_DEATH.START_PASS + 1);
      copy.restoreSnapshot(match.snapshot());
      expect(reaches(copy)).toEqual(reaches(match));
    } finally {
      match.dispose();
      copy.dispose();
    }
  });
});

describe('sudden death as a meteor shower', () => {
  it('announces itself, counts down to its finale, and plays it after the last pass', () => {
    const match = classic('meteors', 5);
    try {
      const shower: GameEvent[] = [];
      const kinds: GameEvent[] = [];
      match.on((e) => e.type === 'meteors' ? shower.push(e) : e.type === 'suddenDeath' && kinds.push(e));
      expect(match.finaleIn).toBeNull();
      endPass(match, SUDDEN_DEATH.START_PASS);
      expect(kinds).toEqual([{ type: 'suddenDeath', kind: 'meteors' }]);
      expect(match.notice?.text).toBe(t('notice.meteors'));
      expect(match.finaleIn).toBe(SUDDEN_DEATH.FINALE_STEP - 1);
      // Nothing happens to the ships in the passes before the last.
      endPass(match, SUDDEN_DEATH.START_PASS + SUDDEN_DEATH.FINALE_STEP - 2);
      expect(match.finaleIn).toBe(1);
      expect(match.alive).toHaveLength(3);
      expect(shower).toHaveLength(0);
      endPass(match, SUDDEN_DEATH.START_PASS + SUDDEN_DEATH.FINALE_STEP - 1);
      expect(shower).toHaveLength(1);
    } finally {
      match.dispose();
    }
  });

  it('takes every ship at once, ends the round without a winner or points once the last meteor has landed, and says so', () => {
    const match = classic('meteors', 6);
    try {
      const scores = match.players.map((p) => p.score);
      const showers: Extract<GameEvent, { type: 'meteors' }>[] = [];
      match.on((e) => e.type === 'meteors' && showers.push(e));
      endPass(match, SUDDEN_DEATH.START_PASS + SUDDEN_DEATH.FINALE_STEP - 1);
      expect(match.alive).toHaveLength(0);
      expect(match.blasting).toBe(true);
      expect(match.phase).toBe('orbit');
      expect(match.lastKill).toMatchObject({ killer: null, points: 0, source: 'meteor' });
      // One meteor for each ship, each ending on its ship, and some that hit nothing.
      const [{ paths }] = showers;
      const own = paths.filter((p) => p.ship !== null);
      expect(own.map((p) => p.ship).sort()).toEqual([0, 1, 2]);
      expect(paths.length).toBeGreaterThan(own.length);
      for (const p of own) {
        const ship = match.world.ships[p.ship!];
        expect(Math.hypot(p.points[p.points.length - 2] - ship.x, p.points[p.points.length - 1] - ship.y)).toBeLessThan(1);
      }
      // The banner waits until the last has landed.
      const last = Math.max(...paths.map((p) => p.delay + (p.points.length / 2 - 1) / SUDDEN_DEATH.METEORS.RATE));
      for (let time = 0; time < last; time += 1 / 30) match.update(1 / 30);
      expect(match.phase).toBe('orbit');
      turn(match);
      expect(match.phase).toBe('roundOver');
      expect(match.blasting).toBe(false);
      expect(match.summary).toMatchObject({ title: 'meteors', survivor: null, team: null, bonus: 0 });
      expect(match.decidedBySuddenDeath).toBe(true);
      expect(match.players.map((p) => p.score)).toEqual(scores);
    } finally {
      match.dispose();
    }
  });

  it('destroys every planet, each as its meteor lands, and the cannons on them', () => {
    const match = classic('meteors', 6);
    try {
      const showers: Extract<GameEvent, { type: 'meteors' }>[] = [];
      match.on((e) => e.type === 'meteors' && showers.push(e));
      const before = match.world.planets.length;
      expect(before).toBeGreaterThan(0);
      endPass(match, SUDDEN_DEATH.START_PASS + SUDDEN_DEATH.FINALE_STEP - 1);
      const [{ paths }] = showers;
      const rocks = paths.filter((p) => p.planet !== null);
      expect(rocks).toHaveLength(before);
      // Each meteor knows which planet it blows apart, and where it stood.
      for (const p of rocks) expect(match.world.planets.some((q) => q.x === p.planet!.x && q.y === p.planet!.y && q.radius === p.planet!.radius)).toBe(true);
      // They are all there at the blast, and go as the meteors land.
      expect(match.world.planets).toHaveLength(before);
      const lands = rocks.map((p) => p.delay + (p.points.length / 2 - 1) / SUDDEN_DEATH.METEORS.RATE).sort((a, b) => a - b);
      for (let time = 0; time < lands[0] + 0.1; time += 1 / 30) match.update(1 / 30);
      expect(match.world.planets.length).toBeLessThan(before);
      turn(match);
      expect(match.world.planets).toHaveLength(0);
      expect(match.world.defenses).toHaveLength(0);
      expect(match.phase).toBe('roundOver');
    } finally {
      match.dispose();
    }
  });

  it('draws the same paths from the same seed', () => {
    const shower = (): unknown => {
      const match = classic('meteors', 6);
      try {
        let paths: unknown;
        match.on((e) => e.type === 'meteors' && (paths = e.paths));
        endPass(match, SUDDEN_DEATH.START_PASS + SUDDEN_DEATH.FINALE_STEP - 1);
        return paths;
      } finally {
        match.dispose();
      }
    };
    expect(shower()).toEqual(shower());
  });

  it('keeps the blast going on a match restored from a snapshot mid-shower', () => {
    const match = classic('meteors', 6);
    const copy = classic('meteors', 6);
    try {
      endPass(match, SUDDEN_DEATH.START_PASS + SUDDEN_DEATH.FINALE_STEP - 1);
      match.update(0.5);
      copy.restoreSnapshot(match.snapshot());
      expect(copy.blasting).toBe(true);
      expect(copy.decidedBySuddenDeath).toBe(true);
      turn(copy);
      expect(copy.phase).toBe('roundOver');
      expect(copy.summary).toMatchObject({ title: 'meteors', survivor: null });
    } finally {
      match.dispose();
      copy.dispose();
    }
  });

  it('never comes while the rule is off', () => {
    const match = classic('meteors', 6, 3, false);
    try {
      endPass(match, SUDDEN_DEATH.START_PASS + SUDDEN_DEATH.FINALE_STEP);
      expect(match.alive).toHaveLength(3);
      expect(match.blasting).toBe(false);
    } finally {
      match.dispose();
    }
  });

  it('is drawn, and plays its finale, when the planets are invisible too (the round is over by then)', () => {
    const seats = cpus(3);
    const invisible = (seed: number) => createMatch('classic', { ...DEFAULT_SETTINGS, rounds: 1, seats, invisiblePlanets: true }, { seats, seed, deterministicCpu: true }) as ClassicMatch;
    const kinds = new Set<SuddenDeathKind>();
    for (let seed = 1; seed <= 80; seed++) {
      const match = invisible(seed);
      try {
        kinds.add(match.snapshot().suddenDeathKind!);
      } finally {
        match.dispose();
      }
    }
    expect(kinds.has('meteors')).toBe(true);
    expect(kinds.has('ufos')).toBe(true);
    const match = invisible(6);
    try {
      match.debugSuddenDeath('meteors');
      expect(match.hiddenPlanets).toBe(true);
      endPass(match, SUDDEN_DEATH.START_PASS + SUDDEN_DEATH.FINALE_STEP - 1);
      turn(match);
      expect(match.phase).toBe('roundOver');
      expect(match.summary).toMatchObject({ title: 'meteors', survivor: null });
      expect(match.world.planets).toHaveLength(0);
    } finally {
      match.dispose();
    }
  });
});

describe('sudden death as a UFO invasion', () => {
  const lastPass = SUDDEN_DEATH.START_PASS + SUDDEN_DEATH.FINALE_STEP - 1;

  it('announces itself, counts down to its finale, and plays it after the last pass', () => {
    const match = classic('ufos', 5);
    try {
      const invasions: GameEvent[] = [];
      const kinds: GameEvent[] = [];
      match.on((e) => e.type === 'ufos' ? invasions.push(e) : e.type === 'suddenDeath' && kinds.push(e));
      expect(match.finaleIn).toBeNull();
      endPass(match, SUDDEN_DEATH.START_PASS);
      expect(kinds).toEqual([{ type: 'suddenDeath', kind: 'ufos' }]);
      expect(match.notice?.text).toBe(t('notice.ufos'));
      expect(match.suddenDeathType).toBe('ufos');
      expect(match.finaleIn).toBe(SUDDEN_DEATH.FINALE_STEP - 1);
      endPass(match, lastPass - 1);
      expect(match.alive).toHaveLength(3);
      expect(invasions).toHaveLength(0);
      endPass(match, lastPass);
      expect(invasions).toHaveLength(1);
    } finally {
      match.dispose();
    }
  });

  it('takes every ship, ends the round without a winner or points after the last zap, and says so', () => {
    const match = classic('ufos', 6);
    try {
      const scores = match.players.map((p) => p.score);
      const invasions: Extract<GameEvent, { type: 'ufos' }>[] = [];
      match.on((e) => e.type === 'ufos' && invasions.push(e));
      endPass(match, lastPass);
      expect(match.alive).toHaveLength(0);
      expect(match.blasting).toBe(true);
      expect(match.lastKill).toMatchObject({ killer: null, points: 0, source: 'ufo' });
      const [{ paths }] = invasions;
      const own = paths.filter((p) => p.ship !== null);
      expect(own.map((p) => p.ship).sort()).toEqual([0, 1, 2]);
      // Each zaps its ship, from a saucer that has flown in from outside the field.
      for (const p of own) {
        const ship = match.world.ships[p.ship!];
        expect(p.target).toEqual([Math.round(ship.x), Math.round(ship.y)]);
        expect(p.points[0] < 0 || p.points[0] > FIELD.width || p.points[1] < 0 || p.points[1] > FIELD.height).toBe(true);
      }
      const last = Math.max(...paths.map((p) => p.delay + (p.points.length / 2 - 1) / SUDDEN_DEATH.UFOS.RATE + p.charge));
      for (let time = 0; time < last; time += 1 / 30) match.update(1 / 30);
      expect(match.phase).toBe('orbit');
      turn(match);
      expect(match.phase).toBe('roundOver');
      expect(match.summary).toMatchObject({ title: 'ufos', survivor: null, team: null, bonus: 0 });
      expect(match.decidedBySuddenDeath).toBe(true);
      expect(match.players.map((p) => p.score)).toEqual(scores);
    } finally {
      match.dispose();
    }
  });

  it('destroys every planet, each as its saucer zaps it', () => {
    const match = classic('ufos', 6);
    try {
      const invasions: Extract<GameEvent, { type: 'ufos' }>[] = [];
      match.on((e) => e.type === 'ufos' && invasions.push(e));
      const before = match.world.planets.length;
      expect(before).toBeGreaterThan(0);
      endPass(match, lastPass);
      const [{ paths }] = invasions;
      const rocks = paths.filter((p) => p.planet !== null);
      expect(rocks).toHaveLength(before);
      expect(match.world.planets).toHaveLength(before);
      const zaps = rocks.map((p) => p.delay + (p.points.length / 2 - 1) / SUDDEN_DEATH.UFOS.RATE + p.charge).sort((a, b) => a - b);
      for (let time = 0; time < zaps[0] + 0.1; time += 1 / 30) match.update(1 / 30);
      expect(match.world.planets.length).toBeLessThan(before);
      turn(match);
      expect(match.world.planets).toHaveLength(0);
      expect(match.phase).toBe('roundOver');
    } finally {
      match.dispose();
    }
  });

  it('draws the same invasion from the same seed', () => {
    const invasion = (): unknown => {
      const match = classic('ufos', 6);
      try {
        let paths: unknown;
        match.on((e) => e.type === 'ufos' && (paths = e.paths));
        endPass(match, lastPass);
        return paths;
      } finally {
        match.dispose();
      }
    };
    expect(invasion()).toEqual(invasion());
  });

  it('keeps the blast going on a match restored from a snapshot mid-invasion, and never comes while the rule is off', () => {
    const match = classic('ufos', 6);
    const copy = classic('ufos', 6);
    const off = classic('ufos', 6, 3, false);
    try {
      endPass(match, lastPass);
      match.update(0.5);
      copy.restoreSnapshot(match.snapshot());
      expect(copy.blasting).toBe(true);
      turn(copy);
      expect(copy.summary).toMatchObject({ title: 'ufos', survivor: null });
      endPass(off, SUDDEN_DEATH.START_PASS + SUDDEN_DEATH.FINALE_STEP);
      expect(off.alive).toHaveLength(3);
    } finally {
      match.dispose();
      copy.dispose();
      off.dispose();
    }
  });
});

describe('the kind of sudden death a round draws', () => {
  const kindOf = (mode: 'classic' | 'solar', seed: number): SuddenDeathKind => {
    const match = play(mode, seed, 2);
    try {
      return (match as ClassicMatch).snapshot().suddenDeathKind!;
    } finally {
      match.dispose();
    }
  };

  it('is drawn from the round\'s seed: the same each time, and Classic sees every one of its kinds', () => {
    const kinds = new Set<SuddenDeathKind>();
    for (let seed = 1; seed <= 60; seed++) {
      const kind = kindOf('classic', seed);
      expect(kindOf('classic', seed)).toBe(kind);
      kinds.add(kind);
    }
    expect([...kinds].sort()).toEqual(['collision', 'gravity', 'meteors', 'overcharge', 'ufos']);
  });

  it('is always the red giant in a Solar System', () => {
    for (let seed = 1; seed <= 10; seed++) expect(kindOf('solar', seed)).toBe('redGiant');
  });

  it('is one of the kinds the wire knows', () => {
    expect(SUDDEN_DEATH_KINDS).toContain(kindOf('classic', 1));
  });
});

describe('sudden death in a Solar System', () => {
  it('swells the sun to a red giant over its turns, swallowing what it reaches', () => {
    const match = play('solar', 5, 3) as SolarMatch;
    try {
      const sun = match.world.planets.find((p) => p.sun)!;
      // A ship riding close round the sun is inside the first size the giant swells to, wherever its orbit takes it.
      Object.assign(match.world.ships[2], onOrbit(50, 1));
      endPass(match, SUDDEN_DEATH.START_PASS);
      expect(match.phase).toBe('orbit');
      expect(match.notice?.text).toBe(t('notice.redGiant'));
      turn(match);
      expect(sun.radius).toBeCloseTo(SUDDEN_DEATH.GIANT_RADII[0], 6);
      expect(sun.mass).toBeCloseTo(SOLAR.SUN_MASS * SUDDEN_DEATH.GIANT_MASS, 3);
      expect(sun.giant).toBeCloseTo(1 / SUDDEN_DEATH.GIANT_RADII.length, 6);
      expect(match.players[2].alive).toBe(false);
      expect(match.lastKill).toMatchObject({ killer: null, victim: 2, points: 0, source: 'sun' });
      // Nothing else is left inside it.
      for (const p of match.world.planets) if (!p.sun) expect(Math.hypot(p.x - sun.x, p.y - sun.y)).toBeGreaterThanOrEqual(sun.radius + p.radius * 0.5);
    } finally {
      match.dispose();
    }
  });

  it('gives nobody the round when the sun swallows a ship and leaves one standing', () => {
    const match = play('solar', 5, 2) as SolarMatch;
    try {
      const scores = match.players.map((p) => p.score);
      Object.assign(match.world.ships[1], onOrbit(50, 1));
      endPass(match, SUDDEN_DEATH.START_PASS);
      turn(match);
      expect(match.phase).toBe('roundOver');
      expect(match.players[0].alive).toBe(true);
      expect(match.summary).toMatchObject({ title: 'swallowed', survivor: null, team: null, bonus: 0 });
      expect(match.players.map((p) => p.score)).toEqual(scores);
    } finally {
      match.dispose();
    }
  });

  it('goes supernova the pass after it has grown, and the round ends with nobody left and no points', () => {
    const match = play('solar', 6, 3) as SolarMatch;
    try {
      const scores = match.players.map((p) => p.score);
      const blasts: unknown[] = [];
      match.on((e) => e.type === 'supernova' && blasts.push(e));
      endPass(match, SUDDEN_DEATH.START_PASS + SUDDEN_DEATH.GIANT_RADII.length);
      // Every ship is out at once, and the screen is told where they stood, to blow each up as the wave gets there.
      expect(match.alive).toHaveLength(0);
      expect(blasts).toEqual([expect.objectContaining({ ships: [0, 1, 2].map((ship) => expect.objectContaining({ ship })) })]);
      // The banner waits until the shockwave has swept the field.
      expect(match.blasting).toBe(true);
      expect(match.phase).toBe('orbit');
      for (let t = 0; t < SUDDEN_DEATH.NOVA_HOLD - 0.2; t += 1 / 30) match.update(1 / 30);
      expect(match.phase).toBe('orbit');
      turn(match);
      expect(match.phase).toBe('roundOver');
      expect(match.summary).toMatchObject({ title: 'supernova', survivor: null, team: null, bonus: 0 });
      expect(match.players.map((p) => p.score)).toEqual(scores);
    } finally {
      match.dispose();
    }
  });

  it('keeps the blast going on a match restored from a snapshot mid-blast', () => {
    const match = play('solar', 6, 3) as SolarMatch;
    const copy = play('solar', 6, 3) as SolarMatch;
    try {
      endPass(match, SUDDEN_DEATH.START_PASS + SUDDEN_DEATH.GIANT_RADII.length);
      match.update(0.5);
      copy.restoreSnapshot(match.snapshot());
      expect(copy.blasting).toBe(true);
      expect(copy.decidedBySuddenDeath).toBe(true);
      turn(copy);
      expect(copy.phase).toBe('roundOver');
      expect(copy.summary).toMatchObject({ title: 'supernova', survivor: null, bonus: 0 });
    } finally {
      match.dispose();
      copy.dispose();
    }
  });

  it('never comes while the rule is off', () => {
    const match = play('solar', 6, 3, false) as SolarMatch;
    try {
      endPass(match, SUDDEN_DEATH.START_PASS + SUDDEN_DEATH.GIANT_RADII.length);
      turn(match);
      expect(match.phase).not.toBe('roundOver');
      expect(match.world.planets.find((p) => p.sun)!.radius).toBe(SOLAR.SUN_RADIUS);
      // Nor does the Classic pull, in a Solar System.
      expect(match.world.ships.some((s) => s.pull)).toBe(false);
    } finally {
      match.dispose();
    }
  });
});
