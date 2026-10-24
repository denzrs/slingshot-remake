import { COLORS, FIELD, HORIZON, NEBULA, SOLAR, WORMHOLE } from '../config';
import { t } from '../i18n';
import { cloneWorld, Shot, type ShotEnd, type StyleEvent, type StyleKind, type World } from '../physics';
import type { PowerUpKind } from '../powerups';
import { drawBlackHole } from '../render/blackhole';
import { drawDefense } from '../render/defense';
import { drawNebula } from '../render/nebula';
import { drawStormCloud } from '../render/storm';
import { drawSun } from '../render/sun';
import { drawPowerUpSymbol, POWER_UP_COLORS } from '../render/powerup-art';
import type { PlanetSprite } from '../render/planet-common';
import { renderPlanet } from '../render/planets';

export type TutorialPreviewKind = 'welcome' | 'aim' | 'gravity' | 'round' | 'horizon' | 'solar' | 'powerups' | 'powerupsField' | 'tricks' | 'daily' | 'keys';

interface Point {
  x: number;
  y: number;
}

interface Flight {
  shooter: number;
  color: string;
  points: Point[];
  times: number[];
  breaks: number[];
  style: (StyleEvent & { time: number })[];
  hits: ({ ship: number } & Point & { time: number })[];
  reflects: ({ ship: number } & Point & { time: number })[];
  warps: { from: Point; to: Point; time: number }[];
  missiles: { points: Point[]; times: number[] }[];
  end: ShotEnd | null;
  duration: number;
  startTime: number;
  ghost?: boolean;
  dashed?: boolean;
}

interface Demo {
  kind: TutorialPreviewKind;
  world: World;
  flights: Flight[];
  pickups: { x: number; y: number; kind: PowerUpKind }[];
  target?: Point;
  powerUp?: PowerUpKind;
  trick?: StyleKind;
  teleport?: { from: Point; to: Point };
  removedPlanet?: World['planets'][number];
  split?: { point: Point; time: number };
  duration: number;
}

export interface TutorialPreviewController {
  replay(): void;
  seek(progress: number): void;
  dispose(): void;
}

const PLAY_SECONDS = 4.8;
const SHOT_RULES = { bounce: false, timeLimit: 6 } as const;

function planet(x: number, y: number, radius: number, style: 'rocky' | 'gas' | 'ice', tint: string, seed: number): World['planets'][number] {
  return { x, y, radius, mass: radius ** 3, style, tint, seed };
}

function createWorld(kind: TutorialPreviewKind, powerUp?: PowerUpKind): World {
  const players = kind === 'round' || kind === 'horizon' ? 4 : 2;
  const ships = [
    { x: 130, y: 550, alive: true },
    { x: 1150, y: 245, alive: true },
    { x: 1120, y: 620, alive: players > 2 },
    { x: 150, y: 205, alive: players > 3 },
  ];
  const eventHorizon = kind === 'horizon';
  if (kind === 'solar') {
    const c = { x: FIELD.width / 2, y: FIELD.height / 2 + SOLAR.CENTER_Y_SHIFT };
    return {
      width: FIELD.width, height: FIELD.height,
      ships: [ship(330, 245), ship(950, 245)],
      planets: [
        { x: c.x, y: c.y, radius: SOLAR.SUN_RADIUS, mass: SOLAR.SUN_MASS, seed: 1701, style: 'star', tint: '#f2c46d', sun: true },
        planet(c.x, c.y - 142, 29, 'rocky', '#c78f6d', 1702),
        planet(c.x + 282, c.y + 8, 40, 'gas', '#b99cff', 1703),
      ],
      holes: [], nebulae: [{ x: c.x + 85, y: 245, radius: 70, seed: 0.521, storm: true }], wormholes: [], defenses: [], version: 0,
    };
  }
  const wormholes = kind === 'powerupsField' && powerUp === 'wormhole'
    ? [{ id: 0, ax: 390, ay: 470, bx: 935, by: 345, radius: WORMHOLE.RADIUS }]
    : [];
  return {
    width: FIELD.width,
    height: FIELD.height,
    ships,
    planets: [
      planet(650, 465, 68, 'gas', '#b99cff', 171),
      planet(405, 275, 38, 'ice', '#8fb3b0', 291),
      planet(920, 605, 46, 'rocky', '#c78f6d', 391),
    ],
    holes: eventHorizon ? [{ x: 640, y: 400, radius: HORIZON.START_RADIUS, mass: HORIZON.START_MASS }] : [],
    nebulae: [],
    wormholes,
    defenses: [],
    version: 0,
  };
}

function angleTo(from: Point, to: Point): number {
  return (Math.atan2(from.y - to.y, to.x - from.x) * 180) / Math.PI;
}

function ship(x: number, y: number, alive = true, shield = false): World['ships'][number] {
  return { x, y, alive, ...(shield ? { shield: true } : {}) };
}

function duel(world: World, ships: World['ships'], planets: World['planets'] = []): void {
  world.ships = ships;
  world.planets = planets;
  world.holes = [];
  world.nebulae = [];
  world.wormholes = [];
  world.defenses = [];
}

function completedDemo(demo: Omit<Demo, 'duration'>): Demo {
  const duration = Math.max(0.8, ...demo.flights.map((flight) => flight.startTime + flight.duration));
  return { ...demo, duration };
}

function atX(flight: Flight, x: number): Point | undefined {
  return flight.points.find((point, index) => index > 8 && point.x >= x && point.x <= FIELD.width - 18 && point.y > 18 && point.y < FIELD.height - 18);
}

interface TraceOptions {
  pierce?: boolean;
  plasma?: boolean;
  bounce?: boolean;
  timeLimit?: number;
  spare?: readonly number[];
  color?: string;
  dashed?: boolean;
}

function startFlight(shot: Shot, shooter: number, options: TraceOptions = {}): Flight {
  return {
    shooter,
    color: options.color ?? COLORS.players[shooter],
    points: [{ x: shot.x, y: shot.y }],
    times: [shot.time],
    breaks: [],
    style: [],
    hits: [],
    reflects: [],
    warps: [],
    missiles: [],
    end: null,
    duration: shot.time,
    startTime: 0,
    ghost: false,
    dashed: options.dashed,
  };
}

function recordStep(flight: Flight, shot: Shot, step: number, counts: { hits: number; reflects: number; warps: number; style: number }): ShotEnd | null {
  const end = shot.step();
  const time = shot.time;
  while (counts.hits < shot.hits.length) {
    flight.hits.push({ ...shot.hits[counts.hits], time });
    counts.hits++;
  }
  while (counts.reflects < shot.reflects.length) {
    flight.reflects.push({ ...shot.reflects[counts.reflects], time });
    counts.reflects++;
  }
  while (counts.warps < shot.warps.length) {
    const warp = shot.warps[counts.warps];
    flight.warps.push({ from: { x: warp.fromX, y: warp.fromY }, to: { x: warp.toX, y: warp.toY }, time });
    flight.breaks.push(flight.points.length);
    counts.warps++;
  }
  while (shot.style && counts.style < shot.style.length) {
    flight.style.push({ ...shot.style[counts.style], time });
    counts.style++;
  }
  for (const missile of shot.missiles) {
    const path = flight.missiles[missile.defense] ?? (flight.missiles[missile.defense] = { points: [], times: [] });
    if (step % 3 === 0) {
      path.points.push({ x: missile.x, y: missile.y });
      path.times.push(time);
    }
  }
  if (step % 4 === 0 || end) {
    flight.points.push({ x: shot.x, y: shot.y });
    flight.times.push(time);
  }
  return end;
}

function finishFlight(flight: Flight, shot: Shot): Flight {
  const end = shot.end;
  flight.end = end;
  flight.duration = shot.time;
  if (end?.kind === 'ship' && !flight.hits.some((hit) => hit.ship === end.ship)) {
    flight.hits.push({ ship: end.ship, x: shot.x, y: shot.y, time: shot.time });
  }
  return flight;
}

function trace(world: World, shooter: number, angle: number, power: number, ghost = false, options: TraceOptions = {}): Flight {
  const rules = { bounce: options.bounce ?? SHOT_RULES.bounce, timeLimit: options.timeLimit ?? SHOT_RULES.timeLimit };
  const shot = new Shot(world, shooter, angle, power, rules, true, options.spare ?? [], options.pierce, options.plasma);
  const flight = startFlight(shot, shooter, options);
  const counts = { hits: 0, reflects: 0, warps: 0, style: 0 };
  for (let step = 0; step < Math.ceil(rules.timeLimit * 240) + 4; step++) {
    if (recordStep(flight, shot, step, counts)) break;
  }
  flight.ghost = ghost;
  return finishFlight(flight, shot);
}

function traceSplit(world: World, angle: number, power: number): { flights: Flight[]; split: { point: Point; time: number } } {
  const shot = new Shot(world, 0, angle, power, SHOT_RULES, true);
  const main = startFlight(shot, 0);
  const mainCounts = { hits: 0, reflects: 0, warps: 0, style: 0 };
  const splitAt = Math.round(0.62 / (1 / 240));
  for (let step = 0; step < splitAt; step++) {
    if (recordStep(main, shot, step, mainCounts)) break;
  }
  const split = { point: { x: shot.x, y: shot.y }, time: shot.time };
  const branches = [-5, 5].map((turn) => {
    const fork = shot.fork((turn * Math.PI) / 180);
    const branch = startFlight(fork, 0);
    const counts = { hits: 0, reflects: 0, warps: 0, style: fork.style?.length ?? 0 };
    for (let step = 0; step < 1100; step++) {
      if (recordStep(branch, fork, step, counts)) break;
    }
    return finishFlight(branch, fork);
  });
  for (let step = 0; step < 1100; step++) {
    if (recordStep(main, shot, step + splitAt, mainCounts)) break;
  }
  return { flights: [finishFlight(main, shot), ...branches], split };
}

interface TrickCandidate { angle: number; power: number; }

function findTrickFlight(world: World, kind: StyleKind, candidates: readonly TrickCandidate[], options: TraceOptions = {}, hitShip?: number): Flight | null {
  const timeLimit = options.timeLimit ?? SHOT_RULES.timeLimit;
  const rules = { bounce: options.bounce ?? false, timeLimit };
  const maxSteps = Math.ceil(timeLimit * 240) + 4;
  for (const candidate of candidates) {
    const shot = new Shot(world, 0, candidate.angle, candidate.power, rules, true, options.spare ?? [], options.pierce, options.plasma);
    for (let step = 0; step < maxSteps; step++) if (shot.step()) break;
    if (!shot.style?.some((event) => event.kind === kind)) continue;
    if (hitShip !== undefined && (shot.end?.kind !== 'ship' || shot.end.ship !== hitShip)) continue;
    return trace(world, 0, candidate.angle, candidate.power, false, options);
  }
  return null;
}

function buildTrickDemo(trick: StyleKind): Demo {
  const world = createWorld('tricks');
  const flights: Flight[] = [];
  world.planets = [];
  world.holes = [];
  world.ships = [ship(130, 540), ship(1150, 540), ship(0, 0, false), ship(0, 0, false)];

  if (trick === 'bank') {
    world.ships[0] = ship(130, 400);
    world.ships[1] = ship(1100, 400);
    flights.push(trace(world, 0, 40, 100, false, { bounce: true }));
  } else if (trick === 'graze') {
    const p = planet(650, 400, 70, 'rocky', '#c78f6d', 672);
    p.mass = 1;
    world.planets = [p];
    world.ships[0] = ship(130, 473);
    world.ships[1] = ship(1150, 473);
    flights.push(trace(world, 0, 0, 50));
  } else if (trick === 'photon') {
    world.holes = [{ x: 650, y: 400, radius: 12, mass: 83_000 }];
    world.ships[0] = ship(550, 420);
    world.ships[1] = ship(1150, 700);
    flights.push(trace(world, 0, 80, 15, false, { timeLimit: 6, spare: [0] }));
  } else if (trick === 'airtime') {
    world.ships[0] = ship(130, 550);
    world.ships[1] = ship(1150, 550);
    flights.push(trace(world, 0, 0, 18, false, { timeLimit: 8 }));
  } else {
    const p = planet(700, 420, 82, 'gas', '#b99cff', 703);
    world.planets = [p];
    world.ships[0] = ship(130, 540);
    world.ships[1] = ship(1150, 540);
    const angles = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36, -2, -4, -6];
    const candidates: TrickCandidate[] = [];
    for (const power of [100, 90, 80, 70, 60, 50, 40, 30]) {
      for (const angle of angles) candidates.push({ angle, power });
    }
    let flight = findTrickFlight(world, trick, candidates, {}, 1);
    if (!flight) {
      p.mass *= 1.8;
      flight = findTrickFlight(world, trick, candidates, {}, 1);
    }
    flights.push(flight ?? trace(world, 0, 32, 70));
  }
  return completedDemo({ kind: 'tricks', world, flights, pickups: [], trick });
}

function buildDemo(kind: TutorialPreviewKind, powerUp?: PowerUpKind, trick?: StyleKind): Demo {
  if (kind === 'tricks' && trick) return buildTrickDemo(trick);
  const world = createWorld(kind, powerUp);
  const flights: Flight[] = [];
  const pickups: Demo['pickups'] = [];
  let teleport: Demo['teleport'];
  let removedPlanet: Demo['removedPlanet'];
  let split: Demo['split'];

  if (kind === 'powerups' && powerUp) {
    switch (powerUp) {
      case 'preview':
        duel(world, [ship(130, 400), ship(1150, 400)]);
        flights.push(trace(world, 0, 0, 50));
        break;
      case 'teleport':
        duel(world, [ship(130, 400), ship(1150, 400)]);
        teleport = { from: world.ships[0], to: { x: 1040, y: 530 } };
        break;
      case 'splitter': {
        duel(world, [ship(130, 400), ship(0, 0, false), ship(0, 0, false), ship(0, 0, false)]);
        const route = traceSplit(world, 0, 50);
        const targets = route.flights.map((flight) => atX(flight, 1100));
        targets.forEach((point, index) => {
          if (point) world.ships[index + 1] = ship(point.x, point.y);
        });
        const active = traceSplit(world, 0, 50);
        flights.push(...active.flights);
        split = active.split;
        break;
      }
      case 'antigravity':
        duel(world, [ship(130, 320), ship(1150, 320)], [planet(650, 400, 55, 'rocky', '#c78f6d', 707)]);
        {
          const normal = cloneWorld(world);
          normal.ships[1].alive = false;
          flights.push(trace(normal, 0, 0, 50, false, { color: '#b8c7dc', dashed: true }));
        }
        world.ships[1].alive = false;
        world.planets[0].reversed = true;
        flights.push(trace(world, 0, 0, 50, false, { color: POWER_UP_COLORS.antigravity }));
        break;
      case 'piercing': {
        duel(world, [ship(130, 400), ship(0, 0, false), ship(0, 0, false)]);
        const route = trace(world, 0, 0, 62, false, { pierce: true }).points;
        const sample = (share: number) => route[Math.floor((route.length - 1) * share)];
        world.ships[1] = ship(sample(0.37).x, sample(0.37).y);
        world.ships[2] = ship(sample(0.57).x, sample(0.57).y);
        flights.push(trace(world, 0, 0, 62, false, { pierce: true, color: POWER_UP_COLORS.piercing }));
        break;
      }
      case 'plasma': {
        duel(world, [ship(130, 400), ship(900, 400)]);
        world.nebulae.push({ x: 650, y: 400, radius: NEBULA.RADIUS, seed: 0.314 });
        const normal = cloneWorld(world);
        normal.ships[1].alive = false;
        flights.push(trace(normal, 0, 0, 50, false, { color: '#b8c7dc', dashed: true }));
        flights.push(trace(world, 0, 0, 50, false, { plasma: true, color: POWER_UP_COLORS.plasma }));
        break;
      }
    }
  } else if (kind === 'powerupsField' && powerUp) {
    switch (powerUp) {
      case 'shield':
        duel(world, [ship(130, 400), ship(1100, 400, true, true)]);
        flights.push(trace(world, 0, 0, 50));
        flights[0].startTime = 0.45;
        break;
      case 'blackhole':
        duel(world, [ship(130, 500), ship(1150, 500)]);
        world.holes.push({ x: 650, y: 400, radius: 26, mass: 260_000 });
        flights.push(trace(world, 0, 5, 50));
        flights[0].startTime = 0.45;
        break;
      case 'planetkiller':
        removedPlanet = planet(650, 400, 68, 'gas', '#b99cff', 171);
        duel(world, [ship(130, 400), ship(1150, 400)]);
        flights.push(trace(world, 0, 0, 50));
        flights[0].startTime = 0.45;
        break;
      case 'nebula':
        duel(world, [ship(130, 400), ship(900, 400)]);
        world.nebulae.push({ x: 650, y: 400, radius: NEBULA.RADIUS, seed: 0.314 });
        {
          const clear = cloneWorld(world);
          clear.ships[1].alive = false;
          clear.nebulae = [];
          const reference = trace(clear, 0, 0, 50, false, { color: '#b8c7dc', dashed: true });
          reference.hits = [];
          flights.push(reference, trace(world, 0, 0, 50, false, { color: POWER_UP_COLORS.nebula }));
        }
        break;
      case 'wormhole':
        duel(world, [ship(130, 400), ship(1150, 400)]);
        world.wormholes = [{ id: 0, ax: 500, ay: 400, bx: 900, by: 400, radius: WORMHOLE.RADIUS }];
        flights.push(trace(world, 0, 0, 50));
        flights[0].startTime = 0.8;
        break;
      case 'defense': {
        const host = planet(650, 300, 60, 'gas', '#b99cff', 171);
        duel(world, [ship(130, 360), ship(1150, 360)], [host]);
        world.defenses.push({ x: host.x - host.radius, y: host.y, radius: host.radius * 4, planet: host.seed, owner: 1, protects: [1] });
        flights.push(trace(world, 0, 0, 50));
        flights[0].startTime = 0.55;
        break;
      }
    }
  } else {
    switch (kind) {
      case 'welcome':
      case 'aim':
      case 'daily': {
        duel(world, [ship(130, 400), ship(1150, 400)]);
        if (kind === 'aim') {
          flights.push(trace(world, 0, -9, 34, true), trace(world, 0, 8, 68, true), trace(world, 0, 0, 50));
        } else {
          flights.push(trace(world, 0, 0, 50));
        }
        break;
      }
      case 'gravity': {
        duel(world, [ship(130, 600), ship(0, 0, false)], [planet(650, 250, 55, 'gas', '#b99cff', 703)]);
        const route = trace(cloneWorld(world), 0, 0, 50);
        const targetPoint = atX(route, 1050) ?? route.points[Math.floor(route.points.length * 0.7)];
        world.ships[1] = ship(targetPoint.x, targetPoint.y);
        flights.push(trace(world, 0, 0, 50));
        break;
      }
      case 'round': {
        duel(world, [ship(130, 400), ship(1150, 400), ship(1150, 700), ship(130, 700)]);
        const turns: [number, number][] = [[0, 1], [2, 3], [0, 2]];
        let start = 0;
        for (const [shooter, victim] of turns) {
          const shot = trace(world, shooter, angleTo(world.ships[shooter], world.ships[victim]), 50);
          shot.startTime = start;
          flights.push(shot);
          start += shot.duration;
          world.ships[victim].alive = false;
        }
        world.ships.forEach((player) => { player.alive = true; });
        break;
      }
      case 'horizon':
        world.planets = [];
        for (let i = 0; i < world.ships.length; i++) flights.push(trace(world, i, angleTo(world.ships[i], world.holes[0]), 48));
        break;
      case 'solar': {
        flights.push(trace(world, 0, angleTo(world.ships[0], world.ships[1]), 48));
        flights[0].startTime = 0.35;
        break;
      }
      case 'powerups':
        duel(world, [ship(130, 400), ship(1150, 400)]);
        flights.push(trace(world, 0, 0, 50));
        pickups.push({ x: 440, y: 455, kind: 'preview' }, { x: 550, y: 425, kind: 'teleport' }, { x: 760, y: 390, kind: 'splitter' });
        break;
      case 'powerupsField':
        duel(world, [ship(130, 400), ship(1150, 400)]);
        flights.push(trace(world, 0, 0, 50));
        pickups.push({ x: 810, y: 555, kind: 'blackhole' }, { x: 1030, y: 440, kind: 'defense' });
        break;
      case 'tricks':
        flights.push(trace(world, 0, angleTo(world.ships[0], world.ships[1]), 52));
        break;
      case 'keys':
        duel(world, [ship(130, 400), ship(1150, 400)]);
        flights.push(trace(world, 0, 0, 42));
        break;
    }
  }
  return completedDemo({
    kind, world, flights, pickups,
    target: kind === 'daily' ? world.ships[1] : undefined,
    powerUp, trick, teleport, removedPlanet, split,
  });
}

function drawShip(ctx: CanvasRenderingContext2D, point: Point, angle: number, color: string, active: boolean, shield = false, opacity = 1): void {
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.translate(point.x, point.y);
  ctx.rotate((-angle * Math.PI) / 180);
  ctx.scale(1.25, 1.25);
  if (shield) {
    ctx.beginPath();
    ctx.arc(0, 0, 28, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(105,205,255,.12)';
    ctx.fill();
    ctx.strokeStyle = '#79d6ff';
    ctx.lineWidth = 2.5;
    ctx.shadowColor = '#79d6ff';
    ctx.shadowBlur = 12;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
  if (active) {
    ctx.beginPath();
    ctx.arc(0, 0, 32, 0, Math.PI * 2);
    ctx.strokeStyle = `${color}66`;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(17, 0);
  ctx.lineTo(-8, -8);
  ctx.lineTo(-5, -2);
  ctx.lineTo(-13, 0);
  ctx.lineTo(-5, 2);
  ctx.lineTo(-8, 8);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = COLORS.bone;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
}

function drawPreviewWindow(ctx: CanvasRenderingContext2D, flight: Flight, progress: number): void {
  const count = Math.min(flight.points.length, Math.max(2, Math.floor(flight.points.length * 0.3)));
  if (flight.points.length < 2) return;
  const current = Math.min(count, Math.max(2, Math.floor(progress * count) + 1));
  ctx.save();
  ctx.beginPath();
  for (let i = 0; i < current; i++) {
    const p = flight.points[i];
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.strokeStyle = '#b7e7ff';
  ctx.lineWidth = 9;
  ctx.globalAlpha = 0.22;
  ctx.shadowColor = '#b7e7ff';
  ctx.shadowBlur = 20;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.restore();
}

function drawEvent(ctx: CanvasRenderingContext2D, point: Point, color: string, time: number): void {
  const radius = 10 + Math.sin(time * 7) * 2;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.shadowColor = color;
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawTrack(ctx: CanvasRenderingContext2D, flight: Flight, localTime: number, faint = false): void {
  const { points, breaks } = flight;
  if (!points.length) return;
  let visible = 0;
  if (faint || flight.ghost) visible = points.length;
  else while (visible < points.length && flight.times[visible] <= localTime) visible++;
  if (!visible) return;
  ctx.save();
  ctx.globalAlpha = faint ? 0.22 : flight.ghost ? 0.42 : flight.dashed ? 0.78 : 0.96;
  ctx.strokeStyle = flight.color;
  ctx.lineWidth = faint ? 2 : flight.ghost || flight.dashed ? 2.7 : 4.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (faint || flight.ghost || flight.dashed) ctx.setLineDash([9, 13]);
  ctx.beginPath();
  for (let i = 0; i < visible; i++) {
    const p = points[i];
    if (i === 0 || breaks.includes(i)) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  if (!faint && !flight.ghost) {
    const p = points[visible - 1];
    ctx.beginPath();
    ctx.arc(p.x, p.y, flight.dashed ? 6 : 8, 0, Math.PI * 2);
    ctx.fillStyle = flight.color;
    ctx.shadowColor = flight.color;
    ctx.shadowBlur = 18;
    ctx.fill();
  }
  ctx.restore();
}

function drawPortal(ctx: CanvasRenderingContext2D, x: number, y: number, time: number, opacity = 1): void {
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.translate(x, y);
  ctx.rotate(time * 1.5);
  ctx.strokeStyle = '#4db8ff';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.ellipse(0, 0, 31, 17, 0.3, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = '#b7e7ff';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(0, 0, 20, 10, -0.3, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawTarget(ctx: CanvasRenderingContext2D, point: Point, time: number): void {
  const r = 17 + Math.sin(time * 4) * 2;
  ctx.save();
  ctx.strokeStyle = COLORS.sodium;
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 6]);
  ctx.beginPath(); ctx.arc(point.x, point.y, 34, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath(); ctx.arc(point.x, point.y, r, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(point.x - 44, point.y); ctx.lineTo(point.x - 27, point.y); ctx.moveTo(point.x + 27, point.y); ctx.lineTo(point.x + 44, point.y); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(point.x, point.y - 44); ctx.lineTo(point.x, point.y - 27); ctx.moveTo(point.x, point.y + 27); ctx.lineTo(point.x, point.y + 44); ctx.stroke();
  ctx.restore();
}

function drawImpact(ctx: CanvasRenderingContext2D, point: Point, color: string, age: number): void {
  if (age < 0 || age > 0.42) return;
  const life = 1 - age / 0.42;
  ctx.save();
  ctx.globalAlpha = life;
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 16;
  ctx.lineWidth = 4 * life + 1;
  ctx.beginPath();
  ctx.arc(point.x, point.y, 8 + age * 130, 0, Math.PI * 2);
  ctx.stroke();
  for (let i = 0; i < 8; i++) {
    const angle = (i * Math.PI) / 4 + age * 4;
    const start = 9 + age * 24;
    const end = start + 11 + (i % 3) * 5;
    ctx.beginPath();
    ctx.moveTo(point.x + Math.cos(angle) * start, point.y + Math.sin(angle) * start);
    ctx.lineTo(point.x + Math.cos(angle) * end, point.y + Math.sin(angle) * end);
    ctx.stroke();
  }
  ctx.restore();
}

function drawAftermath(ctx: CanvasRenderingContext2D, point: Point, color: string): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.72;
  ctx.lineWidth = 3;
  ctx.shadowColor = color;
  ctx.shadowBlur = 10;
  ctx.setLineDash([7, 6]);
  ctx.beginPath();
  ctx.arc(point.x, point.y, 22, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(point.x - 7, point.y - 7);
  ctx.lineTo(point.x + 7, point.y + 7);
  ctx.moveTo(point.x + 7, point.y - 7);
  ctx.lineTo(point.x - 7, point.y + 7);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(point.x, point.y, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function atTime(flight: Flight, time: number): number {
  return flight.startTime + time;
}

function shipIsHit(demo: Demo, index: number, time: number): boolean {
  return demo.flights.some((flight) => !flight.ghost && flight.hits.some((hit) => hit.ship === index && atTime(flight, hit.time) <= time));
}

function drawWorld(ctx: CanvasRenderingContext2D, demo: Demo, progress: number, time: number, dpr: number, canvasWidth: number, canvasHeight: number, sprites: Map<number, PlanetSprite>): void {
  const scale = Math.min((canvasWidth - 28) / FIELD.width, (canvasHeight - 28) / FIELD.height);
  const ox = (canvasWidth - FIELD.width * scale) / 2;
  const oy = (canvasHeight - FIELD.height * scale) / 2;
  const simTime = progress * demo.duration;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#071326';
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  ctx.save();
  ctx.translate(ox, oy);
  ctx.scale(scale, scale);
  ctx.fillStyle = '#09182c';
  ctx.fillRect(0, 0, FIELD.width, FIELD.height);
  ctx.strokeStyle = 'rgba(91,125,179,.18)';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, FIELD.width - 1, FIELD.height - 1);
  ctx.strokeStyle = 'rgba(91,125,179,.08)';
  ctx.setLineDash([2, 15]);
  for (let x = 160; x < FIELD.width; x += 160) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, FIELD.height); ctx.stroke();
  }
  for (let y = 160; y < FIELD.height; y += 160) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(FIELD.width, y); ctx.stroke();
  }
  ctx.setLineDash([]);

  if (demo.kind === 'solar') {
    const cx = FIELD.width / 2;
    const cy = FIELD.height / 2 + SOLAR.CENTER_Y_SHIFT;
    ctx.save();
    ctx.strokeStyle = 'rgba(242,196,109,.2)';
    ctx.lineWidth = 1.5;
    for (const radius of [142, 282]) {
      ctx.beginPath();
      ctx.ellipse(cx, cy, radius * SOLAR.STRETCH, radius, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Fixed, fine star coordinates keep the miniature field stable while its simulation plays.
  for (let i = 0; i < 74; i++) {
    const x = (i * 367 + 83) % FIELD.width;
    const y = (i * 191 + 47) % FIELD.height;
    ctx.globalAlpha = 0.2 + ((i * 17) % 7) * 0.07;
    ctx.fillStyle = i % 8 === 0 ? COLORS.sodium : COLORS.bone;
    ctx.fillRect(x, y, i % 9 === 0 ? 3 : 2, i % 9 === 0 ? 3 : 2);
  }
  ctx.globalAlpha = 1;

  for (const hole of demo.world.holes) {
    ctx.save();
    if (demo.powerUp === 'blackhole') ctx.globalAlpha = Math.min(1, simTime / 0.45);
    drawBlackHole(ctx, hole, time);
    ctx.restore();
  }
  for (const cloud of demo.world.nebulae) {
    ctx.save();
    if (demo.powerUp === 'nebula' || demo.powerUp === 'plasma') ctx.globalAlpha = Math.min(1, simTime / 0.45);
    if (cloud.storm) {
      const sun = demo.world.planets.find((p) => p.sun);
      if (sun) drawStormCloud(ctx, cloud, sun, simTime, time);
    } else {
      drawNebula(ctx, cloud, POWER_UP_COLORS.nebula, time);
    }
    ctx.restore();
  }
  for (const p of demo.world.planets) {
    if (p.sun) {
      drawSun(ctx, p, time);
      continue;
    }
    let sprite = sprites.get(p.seed);
    if (!sprite) {
      sprite = renderPlanet(p, 1);
      sprites.set(p.seed, sprite);
    }
    sprite.draw(ctx, p.x, p.y, 1, time);
  }
  if (demo.removedPlanet) {
    const p = demo.removedPlanet;
    const phase = Math.max(0, Math.min(1, (simTime - 0.1) / 0.45));
    if (phase < 1) {
      let sprite = sprites.get(p.seed);
      if (!sprite) {
        sprite = renderPlanet(p, 1);
        sprites.set(p.seed, sprite);
      }
      ctx.save();
      const scaleDown = 1 - phase * 0.64;
      ctx.globalAlpha = 1 - phase;
      sprite.draw(ctx, p.x, p.y, scaleDown, time);
      ctx.restore();
      if (phase > 0.1) drawImpact(ctx, p, POWER_UP_COLORS.planetkiller, (phase - 0.1) * 0.42);
    }
  }
  for (const defense of demo.world.defenses) {
    const host = demo.world.planets.find((p) => p.seed === defense.planet) ?? null;
    ctx.save();
    if (demo.powerUp === 'defense') ctx.globalAlpha = Math.min(1, simTime / 0.55);
    drawDefense(ctx, defense, host, POWER_UP_COLORS.defense, time, 0.9);
    ctx.restore();
  }
  for (const portal of demo.world.wormholes) {
    const first = demo.powerUp === 'wormhole' ? Math.min(1, simTime / 0.32) : 1;
    const second = demo.powerUp === 'wormhole' ? Math.min(1, Math.max(0, (simTime - 0.34) / 0.32)) : 1;
    drawPortal(ctx, portal.ax, portal.ay, time, first);
    drawPortal(ctx, portal.bx, portal.by, time + 0.7, second);
    ctx.save();
    ctx.globalAlpha = Math.min(first, second) * 0.75;
    ctx.setLineDash([8, 14]);
    ctx.strokeStyle = 'rgba(77,184,255,.3)';
    ctx.beginPath(); ctx.moveTo(portal.ax, portal.ay); ctx.quadraticCurveTo((portal.ax + portal.bx) / 2, Math.min(portal.ay, portal.by) - 100, portal.bx, portal.by); ctx.stroke();
    ctx.restore();
  }

  if (demo.kind === 'daily' && demo.target) {
    drawTarget(ctx, demo.target, time);
  }

  for (const flight of demo.flights) drawTrack(ctx, flight, simTime - flight.startTime);

  if (demo.powerUp === 'preview' && demo.flights[0]) {
    const flight = demo.flights[0];
    const flightProgress = Math.max(0, Math.min(1, (simTime - flight.startTime) / Math.max(flight.duration, 0.001)));
    drawPreviewWindow(ctx, flight, flightProgress);
  }
  if (demo.split && simTime >= demo.split.time) {
    const age = simTime - demo.split.time;
    if (age < 0.55) {
      ctx.save();
      ctx.globalAlpha = 1 - age / 0.55;
      ctx.strokeStyle = POWER_UP_COLORS.splitter;
      ctx.lineWidth = 4;
      ctx.shadowColor = POWER_UP_COLORS.splitter;
      ctx.shadowBlur = 18;
      ctx.beginPath();
      ctx.arc(demo.split.point.x, demo.split.point.y, 12 + age * 95, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }
  if (demo.powerUp === 'antigravity') {
    const p = demo.world.planets.find((planet) => planet.reversed);
    if (p) {
      ctx.save();
      ctx.strokeStyle = POWER_UP_COLORS.antigravity;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.8;
      for (let i = 0; i < 8; i++) {
        const angle = (i * Math.PI) / 4 + time * 0.08;
        const inner = p.radius + 5;
        const outer = p.radius + 27;
        const x1 = p.x + Math.cos(angle) * inner;
        const y1 = p.y + Math.sin(angle) * inner;
        const x2 = p.x + Math.cos(angle) * outer;
        const y2 = p.y + Math.sin(angle) * outer;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        ctx.beginPath(); ctx.arc(x2, y2, 2.5, 0, Math.PI * 2); ctx.fillStyle = POWER_UP_COLORS.antigravity; ctx.fill();
      }
      ctx.restore();
    }
  }
  if (demo.powerUp === 'teleport' && demo.teleport) {
    const { from, to } = demo.teleport;
    const phase = Math.max(0, Math.min(1, (simTime - 0.18) / 0.5));
    ctx.save();
    ctx.strokeStyle = POWER_UP_COLORS.teleport;
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 8]);
    ctx.lineDashOffset = -time * 12;
    ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.quadraticCurveTo((from.x + to.x) / 2, Math.min(from.y, to.y) - 90, to.x, to.y); ctx.stroke();
    ctx.setLineDash([]);
    drawEvent(ctx, from, POWER_UP_COLORS.teleport, time);
    drawShip(ctx, from, 0, COLORS.players[0], false, false, 1 - phase);
    drawShip(ctx, to, 0, POWER_UP_COLORS.teleport, true, false, phase);
    ctx.restore();
  }
  for (const flight of demo.flights) {
    const localTime = simTime - flight.startTime;
    for (const hit of flight.hits) {
      const age = simTime - atTime(flight, hit.time);
      drawImpact(ctx, hit, flight.color, age);
      if (age > 0.42) drawAftermath(ctx, hit, flight.color);
    }
    for (const bounce of flight.reflects) {
      const age = simTime - atTime(flight, bounce.time);
      drawImpact(ctx, bounce, POWER_UP_COLORS.shield, age);
      if (age > 0.42) drawAftermath(ctx, bounce, POWER_UP_COLORS.shield);
    }
    for (const warp of flight.warps) {
      const age = simTime - atTime(flight, warp.time);
      drawImpact(ctx, warp.from, POWER_UP_COLORS.wormhole, age);
      drawImpact(ctx, warp.to, POWER_UP_COLORS.wormhole, age);
    }
    for (const path of flight.missiles) {
      let visible = 0;
      while (visible < path.points.length && path.times[visible] <= localTime) visible++;
      if (visible < 2) continue;
      ctx.save();
      ctx.strokeStyle = POWER_UP_COLORS.defense;
      ctx.fillStyle = '#f5ffb8';
      ctx.lineWidth = 3;
      ctx.shadowColor = POWER_UP_COLORS.defense;
      ctx.shadowBlur = 9;
      ctx.beginPath();
      for (let i = 0; i < visible; i++) {
        const point = path.points[i];
        if (i) ctx.lineTo(point.x, point.y);
        else ctx.moveTo(point.x, point.y);
      }
      ctx.stroke();
      const head = path.points[visible - 1];
      ctx.beginPath(); ctx.arc(head.x, head.y, 6, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    if (demo.kind === 'tricks') {
      for (const moment of flight.style.filter((event) => !demo.trick || event.kind === demo.trick)) {
        const age = simTime - atTime(flight, moment.time);
        if (age >= 0 && age < 0.6) drawImpact(ctx, moment, COLORS.sodium, age);
        else if (age >= 0.6) drawAftermath(ctx, moment, COLORS.sodium);
      }
    }
  }
  if (demo.removedPlanet) {
    const p = demo.removedPlanet;
    if (simTime < 0.55) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - simTime / 0.55);
      ctx.strokeStyle = POWER_UP_COLORS.planetkiller;
      ctx.lineWidth = 3;
      ctx.setLineDash([7, 8]);
      ctx.beginPath(); ctx.arc(p.x, p.y, p.radius + 18 + Math.sin(time * 3) * 3, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    if (simTime >= 0.1 && simTime < 0.65) drawImpact(ctx, p, POWER_UP_COLORS.planetkiller, Math.max(0, simTime - 0.1));
  }

  demo.world.ships.forEach((ship, i) => {
    if (!ship.alive) return;
    if (demo.kind === 'daily' && i === 1) return;
    if (demo.powerUp === 'teleport' && demo.teleport && i === 0) return;
    if (shipIsHit(demo, i, simTime)) return;
    const flight = demo.flights.find((candidate) => candidate.shooter === i && !candidate.ghost && simTime >= candidate.startTime);
    const localTime = flight ? simTime - flight.startTime : -1;
    let pointIndex = 0;
    if (flight) while (pointIndex + 1 < flight.times.length && flight.times[pointIndex + 1] <= localTime) pointIndex++;
    const next = flight?.points[Math.min(pointIndex + 1, flight.points.length - 1)];
    const angle = flight && next ? angleTo(ship, next) : 0;
    const active = demo.kind === 'round'
      ? Boolean(flight && localTime <= flight.duration)
      : demo.kind === 'horizon';
    const shieldSpent = demo.flights.some((candidate) => candidate.reflects.some((event) => event.ship === i && atTime(candidate, event.time) <= simTime));
    drawShip(ctx, ship, angle, COLORS.players[i], active, Boolean(ship.shield && !shieldSpent));
  });

  for (const pickup of demo.pickups) {
    const r = 24 + Math.sin(time * 4 + pickup.x) * 3;
    ctx.save();
    ctx.beginPath(); ctx.arc(pickup.x, pickup.y, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(7,19,38,.88)'; ctx.fill();
    ctx.strokeStyle = POWER_UP_COLORS[pickup.kind]; ctx.lineWidth = 2; ctx.stroke();
    ctx.translate(pickup.x, pickup.y);
    drawPowerUpSymbol(ctx, pickup.kind, 0, 0, 13);
    ctx.restore();
  }

  if (demo.kind === 'horizon') {
    ctx.save();
    const hole = demo.world.holes[0];
    ctx.strokeStyle = 'rgba(255,90,110,.55)';
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 10]);
    ctx.beginPath(); ctx.arc(hole.x, hole.y, 110 + Math.sin(time * 2) * 3, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
  ctx.restore();

  // Keep a fine instrument-frame line outside the world plate, where it remains crisp at any size.
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.strokeStyle = 'rgba(91,125,179,.34)';
  ctx.strokeRect(0.5, 0.5, canvasWidth - 1, canvasHeight - 1);
  if (demo.kind === 'aim') {
    ctx.fillStyle = COLORS.boneDim;
    ctx.font = '9px "B612 Mono", monospace';
    ctx.fillText('ANGLE  /  POWER', 13, 20);
    ctx.fillStyle = 'rgba(91,125,179,.55)'; ctx.fillRect(13, 27, 92, 2);
    ctx.fillStyle = COLORS.players[0]; ctx.fillRect(13, 27, 92 * (0.5 + Math.sin(progress * Math.PI * 2) * 0.35), 2);
  } else if (demo.kind === 'keys') {
    const key = progress < 0.33 ? '←  →' : progress < 0.66 ? '↑  ↓' : 'ENTER';
    ctx.textAlign = 'right';
    ctx.font = 'bold 12px "B612 Mono", monospace';
    ctx.fillStyle = COLORS.bone;
    ctx.fillText(key, canvasWidth - 13, 20);
    ctx.textAlign = 'left';
  }
  if (demo.powerUp === 'antigravity' || demo.powerUp === 'plasma' || demo.powerUp === 'nebula') {
    const labels = demo.powerUp === 'antigravity'
      ? [{ color: '#b8c7dc', label: t('tutorial.preview.gravityPull') }, { color: POWER_UP_COLORS.antigravity, label: t('tutorial.preview.gravityPush') }]
      : [{ color: '#b8c7dc', label: t('tutorial.preview.clearPath') }, { color: demo.powerUp === 'plasma' ? POWER_UP_COLORS.plasma : POWER_UP_COLORS.nebula, label: demo.powerUp === 'plasma' ? t('tutorial.preview.plasma') : t('tutorial.preview.inCloud') }];
    ctx.font = '8px "B612 Mono", monospace';
    let x = 13;
    for (const item of labels) {
      ctx.fillStyle = item.color;
      ctx.fillRect(x, canvasHeight - 17, 15, 2);
      ctx.fillStyle = COLORS.boneDim;
      ctx.fillText(item.label.toUpperCase(), x + 20, canvasHeight - 13);
      x += 26 + ctx.measureText(item.label.toUpperCase()).width;
    }
  }
}

/** Mounts a deterministic miniature scene that uses the same projectile physics as a match. */
export function mountTutorialPreview(canvas: HTMLCanvasElement, kind: TutorialPreviewKind, onProgress: (progress: number) => void, powerUp?: PowerUpKind, trick?: StyleKind): TutorialPreviewController {
  const demo = buildDemo(kind, powerUp, trick);
  const sprites = new Map<number, PlanetSprite>();
  const ctx = canvas.getContext('2d');
  let observer: ResizeObserver | null = null;
  let frame = 0;
  let started = 0;
  let progress = 0;
  let time = 0;
  let disposed = false;

  const draw = (): void => {
    if (!ctx || disposed) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.round(rect.width * dpr);
    const height = Math.round(rect.height * dpr);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    drawWorld(ctx, demo, progress, time, dpr, rect.width, rect.height, sprites);
  };

  const replay = (): void => {
    if (disposed) return;
    cancelAnimationFrame(frame);
    started = performance.now();
    progress = 0;
    time = 0;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      progress = 1;
      onProgress(progress);
      draw();
      return;
    }
    const tick = (now: number): void => {
      if (disposed) return;
      const elapsed = Math.min(PLAY_SECONDS, (now - started) / 1000);
      progress = elapsed / PLAY_SECONDS;
      onProgress(progress);
      time = elapsed;
      draw();
      if (progress < 1) frame = requestAnimationFrame(tick);
      else frame = 0;
    };
    frame = requestAnimationFrame(tick);
  };

  observer = new ResizeObserver(draw);
  observer.observe(canvas);
  replay();

  return {
    replay,
    seek: (value) => {
      if (disposed) return;
      cancelAnimationFrame(frame);
      frame = 0;
      progress = Math.max(0, Math.min(1, value));
      onProgress(progress);
      time = progress * PLAY_SECONDS;
      draw();
    },
    dispose: () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer?.disconnect();
      observer = null;
    },
  };
}
