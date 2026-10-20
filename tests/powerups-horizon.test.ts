import { describe, expect, it } from 'vitest';
import { createMatch, type Match } from '../src/game';
import type { HorizonMatch } from '../src/game/horizon';
import { POWER_UP, SPLIT_TURNS, spawnPickup, aimedSpot } from '../src/powerups';
import { createRng } from '../src/rng';
import { cloneWorld, nextWormholeId, type World } from '../src/physics';
import { DEFAULT_SETTINGS } from '../src/settings';
import { shotSource, Volley, type VolleyScript } from '../src/volley';

const rules = { bounce: false, timeLimit: 20 };

/** A human duel in Event Horizon with power-ups on and no planets, so flights are straight. */
function duel(seed = 7): HorizonMatch {
  const seats = ['human', 'human', 'off', 'off', 'off', 'off'] as const;
  return createMatch('horizon', { ...DEFAULT_SETTINGS, powerUps: true, rounds: 1, maxPlanets: 0, seats: [...seats] }, { seats: [...seats], seed }) as HorizonMatch;
}

/** Both humans lock in; the salvo takes off once the match lets it. */
function lockAll(match: Match): void {
  for (let i = 0; i < 4 && match.isHumanTurn; i++) match.commit();
  for (let t = 0; t < 5 && match.phase === 'aiming'; t += 1 / 30) match.update(1 / 30);
}

function finishFlight(match: Match): void {
  for (let t = 0; t < 120 && match.phase === 'flying'; t += 1 / 30) match.update(1 / 30);
}

describe('power-ups in Event Horizon', () => {
  it('lays pickups when the setting is on, and none when it is off', () => {
    expect(duel().pickups.length).toBe(POWER_UP.DEFAULT_AMOUNT);
    const seats = ['human', 'human', 'off', 'off', 'off', 'off'] as const;
    const off = createMatch('horizon', { ...DEFAULT_SETTINGS, powerUps: false, seats: [...seats] }, { seats: [...seats], seed: 7 });
    expect(off.pickups.length).toBe(0);
  });

  it('keeps pickups and an aimed teleport away from the black hole', () => {
    const match = duel();
    const world = match.world;
    expect(world.holes.length).toBeGreaterThan(0);
    const hole = world.holes[0];
    for (const p of match.pickups) expect(Math.hypot(p.x - hole.x, p.y - hole.y)).toBeGreaterThanOrEqual(hole.radius + POWER_UP.HOLE_GAP);
    // Aiming straight at the hole: the landing stops short of the event horizon, or lands beyond it.
    const from = world.ships[0];
    const atHole = (Math.atan2(-(hole.y - from.y), hole.x - from.x) * 180) / Math.PI;
    const aimed = aimedSpot(world, from, atHole, 100);
    expect(aimed).not.toBeNull();
    expect(Math.hypot(aimed!.x - hole.x, aimed!.y - hole.y)).toBeGreaterThanOrEqual(hole.radius + POWER_UP.HOLE_GAP);
    const rng = createRng(5);
    for (let i = 0; i < 20; i++) {
      const p = spawnPickup(world, rng, [], 'shield', i, 0);
      expect(Math.hypot(p!.x - hole.x, p!.y - hole.y)).toBeGreaterThanOrEqual(hole.radius + POWER_UP.HOLE_GAP);
    }
  });

  it('hands a pickup to the shot that flies past it, and counts a salvo as one pass', () => {
    const match = duel();
    const [a, b] = match.players;
    const ship = match.world.ships[a.id];
    match.pickups = [{ id: 90, kind: 'shield', x: ship.x + 40, y: ship.y, born: 0 }];
    a.angle = 0;
    b.angle = 180;
    lockAll(match);
    expect(match.phase).toBe('flying');
    finishFlight(match);
    expect(a.powerUp).toBe('shield');
    expect(match.world.ships[a.id].shield).toBe(true);
    // One salvo is one pass: it has been counted, and the taken pickup is already replaced.
    expect(match.power.scene().pass).toBe(1);
    expect(match.pickups.length).toBeGreaterThanOrEqual(POWER_UP.DEFAULT_AMOUNT);
  });

  it('splits a shot in a salvo when fire is pressed during the flight', () => {
    const match = duel();
    const [a, b] = match.players;
    a.powerUp = 'splitter';
    a.armed = true;
    a.angle = 90;
    b.angle = 270;
    lockAll(match);
    expect(match.phase).toBe('flying');
    expect(match.volley?.shots.length).toBe(2);
    match.commit();
    expect(match.volley?.shots.length).toBe(4);
    expect(a.powerUp).toBeNull();
  });

  it('jumps to the aimed spot, and the jump spends the shot instead of locking in for it', () => {
    const match = duel();
    const who = match.players[match.current];
    who.powerUp = 'teleport';
    const before = { ...match.world.ships[who.id] };
    match.usePowerUp();
    expect(match.placing).toBe(true);
    match.commit();
    expect(match.placing).toBe(false);
    // The jump spent the shot: the ship is in for the volley, but fires nothing.
    expect(who.locked).toBe(true);
    expect(who.passed).toBe(true);
    const after = match.world.ships[who.id];
    expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeGreaterThan(0);
    expect(who.powerUp).toBeNull();
  });

  it('takes a defense along with its planet: it drifts with a planet the hole pulls in, and is gone when the planet is', () => {
    const match = duel();
    const hole = match.world.holes[0];
    const rock = (seed: number, x: number, y: number) => ({ x, y, radius: 20, mass: 8_000, seed, style: 'rocky' as const, tint: '#fff' });
    const eaten = rock(1, hole.x + hole.radius + 20, hole.y);
    const drifting = rock(2, hole.x - 330, hole.y + 20);
    match.world.planets = [eaten, drifting];
    match.world.defenses = [
      { x: eaten.x + 20, y: eaten.y, radius: 30, planet: 1, owner: 0, protects: [0] },
      { x: drifting.x, y: drifting.y - 20, radius: 30, planet: 2, owner: 0, protects: [0] },
    ];
    const [a, b] = match.players;
    const [shipA, shipB] = match.world.ships;
    a.angle = shipA.y < hole.y ? 270 : 90;
    b.angle = shipB.y < hole.y ? 270 : 90;
    lockAll(match);
    finishFlight(match);
    expect(match.phase).toBe('collapse');
    for (let t = 0; t < 5 && match.phase === 'collapse'; t += 1 / 30) match.update(1 / 30);
    expect(match.world.planets.map((p) => p.seed)).toEqual([2]);
    expect(match.world.defenses).toHaveLength(1);
    const [d] = match.world.defenses;
    // Still standing on the rim of the planet it came with.
    expect(Math.hypot(d.x - drifting.x, d.y - drifting.y)).toBeCloseTo(20, 3);
    expect(drifting.x).not.toBe(hole.x - 330);
  });

  it('leaves a ship that spent its shot on a teleport out of the volley', () => {
    const match = duel();
    const who = match.players[match.current];
    who.powerUp = 'teleport';
    match.usePowerUp();
    match.commit();
    lockAll(match);
    expect(match.phase).toBe('flying');
    expect(match.volley!.shots.some((vs) => vs.owner === who.id)).toBe(false);
  });

  it('pulls the pickups towards the hole as it grows, and eats the ones too close to it', () => {
    const match = duel();
    const hole = match.world.holes[0];
    // Keep the pickups out of the way of the shots: both ships shoot straight away from the middle.
    const far = { id: 71, kind: 'splitter' as const, x: hole.x + 260, y: hole.y + 20, born: 0 };
    const near = { id: 72, kind: 'preview' as const, x: hole.x + hole.radius + 12, y: hole.y, born: 0 };
    match.pickups = [far, near];
    const farStart = Math.hypot(far.x - hole.x, far.y - hole.y);
    const faded: string[] = [];
    match.on((e) => e.type === 'pickupFade' && faded.push(e.kind));
    const [a, b] = match.players;
    const [shipA, shipB] = match.world.ships;
    a.angle = shipA.y < hole.y ? 270 : 90;
    b.angle = shipB.y < hole.y ? 270 : 90;
    lockAll(match);
    finishFlight(match);
    expect(match.phase).toBe('collapse');
    for (let t = 0; t < 5 && match.phase === 'collapse'; t += 1 / 30) match.update(1 / 30);
    expect(match.phase).not.toBe('collapse');
    const kept = match.pickups.find((p) => p.id === 71);
    expect(kept).toBeDefined();
    expect(Math.hypot(kept!.x - hole.x, kept!.y - hole.y)).toBeLessThan(farStart);
    expect(match.pickups.some((p) => p.id === 72)).toBe(false);
    expect(faded).toContain('preview');
    // The field is filled up again.
    expect(match.pickups.length).toBeGreaterThanOrEqual(POWER_UP.DEFAULT_AMOUNT);
  });

  it('clears pickups the grown hole has swallowed and fills the field again', () => {
    const match = duel();
    const hole = match.world.holes[0];
    match.pickups = [{ id: 70, kind: 'preview', x: hole.x + hole.radius * 0.5, y: hole.y, born: 0 }];
    const faded: string[] = [];
    match.on((e) => e.type === 'pickupFade' && faded.push(e.kind));
    match.power.sweep();
    expect(match.pickups.some((p) => p.id === 70)).toBe(false);
    expect(faded).toEqual(['preview']);
    expect(match.pickups.length).toBe(POWER_UP.DEFAULT_AMOUNT);
  });
});

describe('wormholes in Event Horizon', () => {
  /** Both ships fire straight away from the hole's row, so no shot meets a portal laid on it. */
  function collapseOnce(match: HorizonMatch): void {
    const hole = match.world.holes[0];
    const [a, b] = match.players;
    const [shipA, shipB] = match.world.ships;
    a.angle = shipA.y < hole.y ? 270 : 90;
    b.angle = shipB.y < hole.y ? 270 : 90;
    lockAll(match);
    finishFlight(match);
    expect(match.phase).toBe('collapse');
  }

  it('takes both portals when one ends up inside the grown hole, and leaves the others standing', () => {
    const match = duel();
    const hole = match.world.holes[0];
    const radius = 22;
    // Wormhole 0 has one mouth just outside the hole, within what the growth covers; wormhole 1 is far away.
    match.world.wormholes.push(
      { id: 0, ax: hole.x + hole.radius + 8, ay: hole.y, bx: hole.x - 300, by: hole.y, radius },
      { id: 1, ax: hole.x + 280, ay: hole.y, bx: hole.x + 330, by: hole.y + 60, radius },
    );
    const far = match.world.wormholes[1];
    const farBefore = { ax: far.ax, ay: far.ay, bx: far.bx, by: far.by };
    const eaten: [number, number][] = [];
    match.on((e) => e.type === 'devour' && eaten.push([e.x, e.y]));
    collapseOnce(match);
    expect(eaten.length).toBeGreaterThanOrEqual(2);
    match.update(1 / 30);
    expect(match.devourWormhole(0)).toBeGreaterThan(0);
    expect(match.devourWormhole(1)).toBe(0);
    for (let t = 0; t < 5 && match.phase === 'collapse'; t += 1 / 30) match.update(1 / 30);
    expect(match.phase).not.toBe('collapse');
    expect(match.world.wormholes.map((w) => w.id)).toEqual([1]);
    // The survivor did not drift with the planets and pickups.
    expect(match.world.wormholes[0]).toMatchObject(farBefore);
  });

  it('keeps the ids of the others, so a swallowed wormhole does not renumber or recolour them', () => {
    const match = duel();
    const hole = match.world.holes[0];
    match.world.wormholes.push(
      { id: 0, ax: hole.x + hole.radius + 8, ay: hole.y, bx: hole.x - 300, by: hole.y, radius: 22 },
      { id: 1, ax: hole.x + 280, ay: hole.y, bx: hole.x + 330, by: hole.y + 60, radius: 22 },
    );
    collapseOnce(match);
    for (let t = 0; t < 5 && match.phase === 'collapse'; t += 1 / 30) match.update(1 / 30);
    expect(nextWormholeId(match.world)).toBe(2);
  });

  it('takes nothing when every portal is clear of the hole', () => {
    const match = duel();
    const hole = match.world.holes[0];
    match.world.wormholes.push({ id: 0, ax: hole.x + 300, ay: hole.y, bx: hole.x - 300, by: hole.y, radius: 22 });
    collapseOnce(match);
    expect(match.devourWormhole(0)).toBe(0);
    for (let t = 0; t < 5 && match.phase === 'collapse'; t += 1 / 30) match.update(1 / 30);
    expect(match.world.wormholes.length).toBe(1);
  });
});

describe('a flight that was changed on the way', () => {
  function straight(): World {
    return { width: 1280, height: 800, planets: [], ships: [{ x: 300, y: 400, alive: true }, { x: 900, y: 420, alive: true }], holes: [], nebulae: [], wormholes: [], defenses: [], version: 0 };
  }

  it('replays the same flight from its script: the split and the shield happen at the same step', () => {
    const world = straight();
    const start = cloneWorld(world);
    const aims = [{ player: 0, angle: 3, power: 60 }];
    const live = new Volley(world, aims, rules, true);
    for (let i = 0; i < 200; i++) live.step();
    live.setShield(1, true);
    live.split(0, SPLIT_TURNS, 4);
    while (!live.done) live.step();
    expect(live.script.map((e) => e.kind)).toEqual(['shield', 'split']);

    const replay = new Volley(cloneWorld(start), aims, rules, true, live.script);
    while (!replay.done) replay.step();
    expect(replay.shots.length).toBe(live.shots.length);
    replay.shots.forEach((vs, i) => {
      expect(vs.shot.end).toEqual(live.shots[i].shot.end);
      expect(vs.shot.x).toBeCloseTo(live.shots[i].shot.x, 9);
      expect(vs.shot.y).toBeCloseTo(live.shots[i].shot.y, 9);
    });
    expect(replay.world.ships[1]).toEqual(live.world.ships[1]);
    // A replay does not write a script of its own.
    expect(replay.script).toEqual(live.script);
  });
});

describe('which shot a forked one branched off from', () => {
  const script: VolleyScript[] = [
    { at: 100, kind: 'split', index: 1, fan: 1, turns: [-0.1, 0.1] },
    { at: 140, kind: 'shield', ship: 0, on: true },
    { at: 200, kind: 'split', index: 3, fan: 2, turns: [-0.1, 0.1] },
  ];

  it('is the shot itself for one of the original aims', () => {
    expect(shotSource(2, script, 0)).toBe(0);
    expect(shotSource(2, script, 1)).toBe(1);
  });

  it('is the parent for a fork, however many splits deep', () => {
    // Shots 2 and 3 forked off shot 1; shots 4 and 5 forked off shot 3, which is itself a fork of shot 1.
    expect(shotSource(2, script, 2)).toBe(1);
    expect(shotSource(2, script, 3)).toBe(1);
    expect(shotSource(2, script, 4)).toBe(1);
    expect(shotSource(2, script, 5)).toBe(1);
  });
});
