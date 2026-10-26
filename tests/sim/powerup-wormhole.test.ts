import { describe, expect, it } from 'vitest';
import { FIELD, WORMHOLE } from '../../src/sim/config';
import { createMatch, type Match } from '../../src/game';
import { isWormholeJump, portalFits, Shot, type World } from '../../src/sim/physics';
import { DEFAULT_SETTINGS } from '../../src/data/settings';
import { portalColor } from '../../src/render/powerup-art';
import { CPU_IGNORES, cpuWormholeSpots } from '../../src/sim/powerups';

const rules = { bounce: false, timeLimit: 20 };

const world = (): World => ({
  width: FIELD.width,
  height: FIELD.height,
  planets: [],
  ships: [{ x: 100, y: 400, alive: true }, { x: 1180, y: 700, alive: true }],
  holes: [],
  nebulae: [],
  wormholes: [{ id: 0, ax: 400, ay: 400, bx: 900, by: 700, radius: WORMHOLE.RADIUS }],
  defenses: [],
  version: 0,
});

describe('wormhole', () => {
  it('carries a shot from one mouth to the other, keeping its velocity', () => {
    const shot = new Shot(world(), 0, 0, 50, rules);
    const vx = shot.vx;
    let jumped = false;
    for (let i = 0; i < 4000 && !shot.end && !jumped; i++) {
      const x = shot.x;
      shot.step();
      if (shot.x - x > 100) jumped = true;
    }
    expect(jumped).toBe(true);
    expect(shot.vx).toBe(vx);
    expect(shot.y).toBeCloseTo(700, -1);
  });

  it('works in both directions, and is not carried straight back', () => {
    const w = world();
    w.ships = [{ x: 1180, y: 700, alive: true }, { x: 100, y: 400, alive: true }];
    const shot = new Shot(w, 0, 180, 50, rules);
    while (!shot.end) shot.step();
    expect(shot.end).toEqual({ kind: 'ship', ship: 1 });
  });

  it('does not trip over the mouth it last left when that wormhole is gone', () => {
    const w = world();
    w.wormholes.push({ id: 1, ax: 400, ay: 100, bx: 700, by: 100, radius: WORMHOLE.RADIUS });
    w.wormholes = [w.wormholes[1], w.wormholes[0]];
    const shot = new Shot(w, 0, 0, 50, rules);
    for (let i = 0; i < 4000 && !shot.end && !shot.warps.length; i++) shot.step();
    expect(shot.warps.length).toBe(1);
    // The pair the shot just left by is removed while the other stays: the stale mouth must not be read.
    w.wormholes.shift();
    expect(() => { for (let i = 0; i < 50 && !shot.end; i++) shot.step(); }).not.toThrow();
  });
});

describe('wormhole trail jump', () => {
  const wormholes = [{ id: 0, ax: 401.23, ay: 399.87, bx: 902.46, by: 700.04, radius: WORMHOLE.RADIUS }];
  const rounded = (n: number): number => Math.round(n * 10) / 10;

  it('is found in a trail the wire has rounded to a tenth', () => {
    const exact = [380, 395, 401.23, 399.87, 902.46, 700.04, 920, 702];
    const wire = exact.map(rounded);
    expect(isWormholeJump(wire, 4, wormholes)).toBe(true);
    expect(isWormholeJump(wire, 2, wormholes)).toBe(false);
    expect(isWormholeJump(wire, 6, wormholes)).toBe(false);
  });

  it('is found in both directions, and not for flight that merely passes a mouth', () => {
    expect(isWormholeJump([902.46, 700.04, 401.23, 399.87], 2, wormholes)).toBe(true);
    expect(isWormholeJump([400, 400, 403, 401], 2, wormholes)).toBe(false);
  });
});

describe('wormhole portal colours', () => {
  it('gives every wormhole on the field a colour of its own, until the palette is used up', () => {
    const colours = WORMHOLE.COLORS.map((_, id) => portalColor(id));
    expect(new Set(colours).size).toBe(WORMHOLE.COLORS.length);
  });

  it('starts over with the first colour after the last', () => {
    expect(portalColor(WORMHOLE.COLORS.length)).toBe(portalColor(0));
    expect(portalColor(WORMHOLE.COLORS.length + 2)).toBe(portalColor(2));
  });
});

/** A human duel with power-ups on and no planets: the aim lands where the angle and power say. */
function duel(seed = 7): Match {
  const seats = ['human', 'human', 'off', 'off', 'off', 'off'] as const;
  return createMatch('classic', { ...DEFAULT_SETTINGS, powerUps: true, rounds: 1, maxPlanets: 0, seats: [...seats] }, { seats: [...seats], seed });
}

describe('wormhole placement', () => {
  it('replays a recorded pair even when a living ship is now inside the placement gap', () => {
    const match = duel();
    match.players[0].powerUp = 'wormhole';
    match.world.ships[1].x = 308.5;
    match.world.ships[1].y = 611;

    expect(match.power.placeLogged({ player: 0, kind: 'wormhole', x: 308.57588601721625, y: 611.05741618765046, x2: 329.18325751788302, y2: 717.07315199999812 })).toBe(true);
    expect(match.world.wormholes).toHaveLength(1);
    expect(match.players[0].powerUp).toBeNull();
  });

  it('lets two portals sit at any distance, as long as they do not overlap', () => {
    const w = world();
    expect(portalFits(w, { x: 400 + WORMHOLE.GAP - 1, y: 400 })).toBe(false);
    expect(portalFits(w, { x: 400 + WORMHOLE.GAP, y: 400 })).toBe(true);
    expect(portalFits(w, { x: 900, y: 700 + 10 })).toBe(false);
    // The first portal of the pair being set counts as well.
    expect(portalFits(w, { x: 200, y: 200 }, [{ x: 200 + WORMHOLE.GAP - 1, y: 200 }])).toBe(false);
    expect(portalFits(w, { x: 200, y: 200 }, [{ x: 200 + WORMHOLE.GAP, y: 200 }])).toBe(true);
  });

  it('does not take a second click on top of the first portal, but takes one a little way off it', () => {
    const match = duel();
    const shooter = match.players[match.current];
    shooter.powerUp = 'wormhole';
    shooter.angle = 0;
    shooter.power = 30;
    match.usePowerUp();
    match.commit();
    const first = match.scene().placement!.first!;
    expect(first).toBeTruthy();

    // The aim has not moved, so it sits on the first portal: blocked, and the click plants nothing.
    expect(match.scene().placement!.blocked).toBe(true);
    match.commit();
    expect(match.world.wormholes).toHaveLength(0);

    shooter.power = 70;
    const aim = match.scene().placement!;
    expect(Math.hypot(aim.target!.x - first.x, aim.target!.y - first.y)).toBeGreaterThanOrEqual(WORMHOLE.GAP);
    expect(aim.blocked).toBe(false);
    match.commit();
    expect(match.world.wormholes).toHaveLength(1);
    expect(match.world.wormholes[0].id).toBe(0);
    expect(shooter.powerUp).toBeNull();
  });

  it('does not set the first portal on one already on the field', () => {
    const match = duel();
    const shooter = match.players[match.current];
    shooter.powerUp = 'wormhole';
    shooter.angle = 0;
    shooter.power = 100;
    match.usePowerUp();
    const target = match.scene().placement!.target!;
    match.world.wormholes.push({ id: 0, ax: target.x + 10, ay: target.y, bx: 50, by: 50, radius: WORMHOLE.RADIUS });
    expect(match.scene().placement!.blocked).toBe(true);
    match.commit();
    expect(match.scene().placement!.first).toBeNull();
  });

  it('shows a guest the first portal the host has set', () => {
    const host = duel();
    const shooter = host.players[host.current];
    shooter.powerUp = 'wormhole';
    shooter.angle = 0;
    shooter.power = 100;
    host.usePowerUp();
    host.commit();

    const guest = duel();
    guest.players[host.current].powerUp = 'wormhole';
    guest.power.restoreState(host.power.state());
    const first = guest.scene().placement?.first;
    expect(first).toMatchObject(host.scene().placement!.first!);
  });
});

describe('wormhole for a CPU', () => {
  type Placer = { cpuPlacementAim(p: unknown): { angle: number; power: number } | null; placeForCpu(id: number): boolean };

  function cpuMatch(seed = 11): Match {
    const seats = ['easy', 'human', 'off', 'off', 'off', 'off'] as const;
    return createMatch('classic', { ...DEFAULT_SETTINGS, powerUps: true, rounds: 1, maxPlanets: 0, seats: [...seats] }, { seats: [...seats], seed });
  }

  it('is a kind a CPU takes up: only the preview is left lying', () => {
    expect(CPU_IGNORES.wormhole).toBeUndefined();
    expect(CPU_IGNORES.preview).toBe(true);
  });

  it('picks one portal out from its ship and one near the enemy, clear of each other', () => {
    const w = { ...world(), wormholes: [] };
    const spots = cpuWormholeSpots(w, w.ships[0], w.ships[1])!;
    expect(spots).not.toBeNull();
    const [a, b] = spots;
    expect(Math.hypot(a.x - w.ships[0].x, a.y - w.ships[0].y)).toBeLessThan(Math.hypot(b.x - w.ships[0].x, b.y - w.ships[0].y));
    expect(Math.hypot(b.x - w.ships[1].x, b.y - w.ships[1].y)).toBeLessThan(Math.hypot(a.x - w.ships[1].x, a.y - w.ships[1].y));
    expect(portalFits(w, a, [b])).toBe(true);
  });

  it('keeps clear of a planet on the line, and of the portals already there', () => {
    const w = { ...world(), wormholes: [{ id: 0, ax: 400, ay: 455, bx: 900, by: 700, radius: WORMHOLE.RADIUS }] };
    w.planets = [{ x: 400, y: 480, radius: 40, mass: 20_000, seed: 3, style: 'rocky', tint: '#fff' }];
    const spots = cpuWormholeSpots(w, w.ships[0], w.ships[1]);
    expect(spots).not.toBeNull();
    for (const s of spots!) {
      expect(Math.hypot(s.x - 400, s.y - 480)).toBeGreaterThan(40);
      expect(portalFits(w, s)).toBe(true);
    }
  });

  it('sets the pair, spends the power-up, and the match has a new wormhole', () => {
    const match = cpuMatch();
    const cpu = match.players[0];
    const placer = match as unknown as Placer;
    cpu.powerUp = 'wormhole';
    const aim = placer.cpuPlacementAim(cpu);
    expect(aim).not.toBeNull();
    cpu.angle = aim!.angle;
    cpu.power = aim!.power;
    expect(placer.placeForCpu(0)).toBe(true);
    expect(match.world.wormholes).toHaveLength(1);
    expect(cpu.powerUp).toBeNull();
  });
});


describe('wormhole placement near players', () => {
  it('refuses a portal closer than the gap to another ship, but not to its owner or a dead one', () => {
    const w = { ...world(), wormholes: [], ships: [{ x: 100, y: 100, alive: true }, { x: 600, y: 100, alive: true }, { x: 900, y: 100, alive: false }] } as World;
    expect(portalFits(w, { x: 600 + WORMHOLE.PLAYER_GAP - 1, y: 100 }, [], 0)).toBe(false);
    expect(portalFits(w, { x: 600 + WORMHOLE.PLAYER_GAP, y: 100 }, [], 0)).toBe(true);
    expect(portalFits(w, { x: 110, y: 100 }, [], 0)).toBe(true);
    expect(portalFits(w, { x: 900, y: 100 }, [], 0)).toBe(true);
  });
});
