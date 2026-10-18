import { describe, expect, it } from 'vitest';
import { createMatch, type Match } from '../src/game';
import type { HorizonMatch } from '../src/game/horizon';
import { POWER_UP, SPLIT_TURNS, spawnPickup, teleportCandidates } from '../src/powerups';
import { createRng } from '../src/rng';
import { cloneWorld, type World } from '../src/physics';
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

  it('keeps pickups and teleport spots away from the black hole', () => {
    const match = duel();
    const world = match.world;
    expect(world.hole).not.toBeNull();
    const hole = world.hole!;
    for (const p of match.pickups) expect(Math.hypot(p.x - hole.x, p.y - hole.y)).toBeGreaterThanOrEqual(hole.radius + POWER_UP.HOLE_GAP);
    const rng = createRng(5);
    for (const spot of teleportCandidates(world, rng, [], 3, world.ships[0])) {
      expect(Math.hypot(spot.x - hole.x, spot.y - hole.y)).toBeGreaterThanOrEqual(hole.radius + POWER_UP.HOLE_GAP);
    }
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

  it('jumps to a teleport spot while aiming, and fire confirms instead of locking in', () => {
    const match = duel();
    const who = match.players[match.current];
    who.powerUp = 'teleport';
    const before = { ...match.world.ships[who.id] };
    match.usePowerUp();
    expect(match.teleporting).toBe(true);
    match.commit();
    expect(match.teleporting).toBe(false);
    expect(who.locked).toBe(false);
    const after = match.world.ships[who.id];
    expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeGreaterThan(0);
    expect(who.powerUp).toBeNull();
  });

  it('clears pickups the grown hole has swallowed and fills the field again', () => {
    const match = duel();
    const hole = match.world.hole!;
    match.pickups = [{ id: 70, kind: 'preview', x: hole.x + hole.radius * 0.5, y: hole.y, born: 0 }];
    const faded: string[] = [];
    match.on((e) => e.type === 'pickupFade' && faded.push(e.kind));
    match.power.sweep();
    expect(match.pickups.some((p) => p.id === 70)).toBe(false);
    expect(faded).toEqual(['preview']);
    expect(match.pickups.length).toBe(POWER_UP.DEFAULT_AMOUNT);
  });
});

describe('a flight that was changed on the way', () => {
  function straight(): World {
    return { width: 1280, height: 800, planets: [], ships: [{ x: 300, y: 400, alive: true }, { x: 900, y: 420, alive: true }], hole: null, version: 0 };
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
