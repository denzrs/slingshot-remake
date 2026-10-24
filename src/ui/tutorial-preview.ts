import { COLORS, FIELD, HORIZON, NEBULA, WORMHOLE } from '../config';
import { Shot, type StyleEvent, type StyleKind, type World } from '../physics';
import type { PowerUpKind } from '../powerups';
import { drawBlackHole } from '../render/blackhole';
import { drawDefense } from '../render/defense';
import { drawNebula } from '../render/nebula';
import { drawPowerUpSymbol, POWER_UP_COLORS } from '../render/powerup-art';
import type { PlanetSprite } from '../render/planet-common';
import { renderPlanet } from '../render/planets';

export type TutorialPreviewKind = 'welcome' | 'aim' | 'gravity' | 'round' | 'horizon' | 'powerups' | 'powerupsField' | 'tricks' | 'daily' | 'keys';

interface Point {
  x: number;
  y: number;
}

interface Flight {
  shooter: number;
  color: string;
  points: Point[];
  breaks: number[];
  style: StyleEvent[];
  hits?: Point[];
  reflects?: Point[];
  missiles?: Point[][];
  ghost?: boolean;
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
  removedPlanet?: Point;
}

export interface TutorialPreviewController {
  replay(): void;
  seek(progress: number): void;
  dispose(): void;
}

const PLAY_SECONDS = 4.8;
const SHOT_RULES = { bounce: false, timeLimit: 6 } as const;

function planet(x: number, y: number, radius: number, style: 'rocky' | 'gas' | 'ice', tint: string, seed: number) {
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

interface TraceOptions { pierce?: boolean; plasma?: boolean; bounce?: boolean; timeLimit?: number; }

function trace(world: World, shooter: number, angle: number, power: number, ghost = false, options: TraceOptions = {}): Flight {
  const rules = { bounce: options.bounce ?? SHOT_RULES.bounce, timeLimit: options.timeLimit ?? SHOT_RULES.timeLimit };
  const shot = new Shot(world, shooter, angle, power, rules, true, [], options.pierce, options.plasma);
  const points: Point[] = [{ x: shot.x, y: shot.y }];
  const breaks: number[] = [];
  const missiles: Point[][] = [];
  let warpCount = 0;
  for (let step = 0; step < Math.ceil(rules.timeLimit * 240) + 4; step++) {
    if (shot.step()) break;
    if (shot.warps.length > warpCount) {
      warpCount = shot.warps.length;
      breaks.push(points.length);
    }
    if (step % 4 === 0 || shot.end) points.push({ x: shot.x, y: shot.y });
    for (const missile of shot.missiles) {
      const path = missiles[missile.defense] ?? (missiles[missile.defense] = []);
      if (step % 3 === 0) path.push({ x: missile.x, y: missile.y });
    }
  }
  return {
    shooter, color: COLORS.players[shooter], points, breaks, style: [...(shot.style ?? [])], ghost,
    hits: shot.hits.map(({ x, y }) => ({ x, y })),
    reflects: shot.reflects.map(({ x, y }) => ({ x, y })),
    missiles,
  };
}

function traceSplit(world: World, angle: number, power: number): Flight[] {
  const shot = new Shot(world, 0, angle, power, SHOT_RULES, true);
  const main: Point[] = [{ x: shot.x, y: shot.y }];
  const splitAt = Math.round(0.62 / (1 / 240));
  for (let step = 0; step < splitAt; step++) {
    if (shot.step()) break;
    if (step % 4 === 0) main.push({ x: shot.x, y: shot.y });
  }
  const branches = [-5, 5].map((turn) => {
    const fork = shot.fork((turn * Math.PI) / 180);
    const points: Point[] = [{ x: fork.x, y: fork.y }];
    for (let step = 0; step < 1100; step++) {
      if (fork.step()) break;
      if (step % 4 === 0 || fork.end) points.push({ x: fork.x, y: fork.y });
    }
    return { shooter: 0, color: COLORS.players[0], points, breaks: [], style: [...(fork.style ?? [])] } satisfies Flight;
  });
  for (let step = 0; step < 1100; step++) {
    if (shot.step()) break;
    if (step % 4 === 0 || shot.end) main.push({ x: shot.x, y: shot.y });
  }
  return [{ shooter: 0, color: COLORS.players[0], points: main, breaks: [], style: [...(shot.style ?? [])] }, ...branches];
}

interface TrickCandidate { angle: number; power: number; }

function findTrickFlight(world: World, kind: StyleKind, candidates: readonly TrickCandidate[], options: TraceOptions = {}): Flight | null {
  const timeLimit = options.timeLimit ?? SHOT_RULES.timeLimit;
  const rules = { bounce: options.bounce ?? false, timeLimit };
  const maxSteps = Math.ceil(timeLimit * 240) + 4;
  for (const candidate of candidates) {
    const shot = new Shot(world, 0, candidate.angle, candidate.power, rules, true, [], options.pierce, options.plasma);
    for (let step = 0; step < maxSteps; step++) if (shot.step()) break;
    if (shot.style?.some((event) => event.kind === kind)) return trace(world, 0, candidate.angle, candidate.power, false, options);
  }
  return null;
}

function buildTrickDemo(trick: StyleKind): Demo {
  const world = createWorld('tricks');
  const flights: Flight[] = [];
  world.planets = [];
  world.holes = [];
  world.ships[0] = { x: 130, y: 540, alive: true };
  world.ships[1] = { x: 1150, y: 540, alive: true };

  if (trick === 'bank') {
    world.ships[0] = { x: 130, y: 400, alive: true };
    world.ships[1] = { x: 1100, y: 400, alive: true };
    flights.push(trace(world, 0, 40, 50, false, { bounce: true }));
  } else if (trick === 'graze') {
    const p = planet(650, 400, 70, 'rocky', '#c78f6d', 672);
    p.mass = 1;
    world.planets = [p];
    world.ships[0] = { x: 130, y: 473, alive: true };
    world.ships[1] = { x: 1150, y: 473, alive: true };
    flights.push(trace(world, 0, 0, 50));
  } else if (trick === 'photon') {
    world.holes = [{ x: 650, y: 400, radius: 12, mass: 83_000 }];
    world.ships[0] = { x: 610, y: 500, alive: true };
    world.ships[1] = { x: 1100, y: 700, alive: true };
    const candidates: TrickCandidate[] = [];
    for (const power of [28, 29, 30, 31, 32, 33]) {
      for (const angle of [-13, -12, -11, -10, -9]) candidates.push({ angle, power });
    }
    flights.push(findTrickFlight(world, trick, candidates) ?? trace(world, 0, -11, 30));
  } else if (trick === 'airtime') {
    world.ships[0] = { x: 130, y: 550, alive: true };
    world.ships[1] = { x: 1150, y: 550, alive: true };
    flights.push(trace(world, 0, 0, 20, false, { timeLimit: 8 }));
  } else {
    const p = planet(700, 420, 82, 'gas', '#b99cff', 703);
    world.planets = [p];
    world.ships[0] = { x: 130, y: 540, alive: true };
    world.ships[1] = { x: 1150, y: 540, alive: true };
    const angles = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36, -2, -4, -6];
    const candidates: TrickCandidate[] = [];
    for (const power of [100, 90, 80, 70, 60, 50, 40, 30]) {
      for (const angle of angles) candidates.push({ angle, power });
    }
    let flight = findTrickFlight(world, trick, candidates);
    if (!flight) {
      p.mass *= 1.8;
      flight = findTrickFlight(world, trick, candidates);
    }
    flights.push(flight ?? trace(world, 0, 6, 70));
  }
  return { kind: 'tricks', world, flights, pickups: [], trick };
}

function buildDemo(kind: TutorialPreviewKind, powerUp?: PowerUpKind, trick?: StyleKind): Demo {
  if (kind === 'tricks' && trick) return buildTrickDemo(trick);
  const world = createWorld(kind, powerUp);
  const target = world.ships[1];
  const direct = angleTo(world.ships[0], target);
  const flights: Flight[] = [];
  const pickups: Demo['pickups'] = [];
  let teleport: Demo['teleport'];
  let removedPlanet: Demo['removedPlanet'];

  if (kind === 'powerups' && powerUp) {
    switch (powerUp) {
      case 'preview':
        flights.push(trace(world, 0, direct, 50));
        break;
      case 'teleport':
        teleport = { from: world.ships[0], to: { x: 1040, y: 530 } };
        break;
      case 'splitter':
        flights.push(...traceSplit(world, direct, 50));
        break;
      case 'antigravity':
        world.planets[0].reversed = true;
        flights.push(trace(world, 0, direct, 50));
        break;
      case 'piercing': {
        const route = trace(world, 0, direct + 6, 62, true, { pierce: true }).points;
        if (route.length > 20) {
          const sample = (share: number) => route[Math.floor((route.length - 1) * share)];
          Object.assign(world.ships[1], sample(0.47), { alive: true });
          world.ships[2] = { ...sample(0.72), alive: true };
        }
        flights.push(trace(world, 0, direct + 6, 62, false, { pierce: true }));
        break;
      }
      case 'plasma':
        flights.push(trace(world, 0, direct, 43, true), trace(world, 0, direct, 43, false, { plasma: true }));
        break;
    }
    pickups.push({ x: 440, y: 455, kind: powerUp });
  } else if (kind === 'powerupsField' && powerUp) {
    switch (powerUp) {
      case 'shield':
        {
          const route = trace(world, 0, direct + 6, 62, true, { pierce: true }).points;
          if (route.length > 20) Object.assign(world.ships[1], route[Math.floor((route.length - 1) * 0.72)]);
        }
        world.ships[1].shield = true;
        flights.push(trace(world, 0, direct + 6, 62));
        break;
      case 'blackhole':
        world.holes.push({ x: 815, y: 390, radius: 18, mass: 260_000 });
        flights.push(trace(world, 0, direct, 50));
        break;
      case 'planetkiller':
        removedPlanet = { x: world.planets[0].x, y: world.planets[0].y };
        world.planets.splice(0, 1);
        flights.push(trace(world, 0, direct, 50));
        break;
      case 'nebula':
        world.nebulae.push({ x: 695, y: 420, radius: NEBULA.RADIUS, seed: 0.314 });
        flights.push(trace(world, 0, direct, 50));
        break;
      case 'wormhole':
        flights.push(trace(world, 0, angleTo(world.ships[0], { x: 390, y: 470 }), 50));
        break;
      case 'defense': {
        const host = world.planets[0];
        world.defenses.push({ x: host.x - host.radius, y: host.y, radius: host.radius * 4, planet: host.seed, owner: 1, protects: [1] });
        flights.push(trace(world, 0, direct, 50));
        break;
      }
    }
    pickups.push({ x: 810, y: 555, kind: powerUp });
  }

  if (!powerUp || (kind !== 'powerups' && kind !== 'powerupsField')) switch (kind) {
    case 'aim':
      flights.push(trace(world, 0, direct - 9, 34, true), trace(world, 0, direct + 8, 68, true));
      flights.push(trace(world, 0, direct, 50));
      break;
    case 'horizon':
      for (let i = 0; i < world.ships.length; i++) flights.push(trace(world, i, angleTo(world.ships[i], world.holes[0]), 48));
      break;
    case 'powerups':
      flights.push(trace(world, 0, direct, 50));
      pickups.push({ x: 440, y: 455, kind: 'preview' }, { x: 550, y: 425, kind: 'teleport' }, { x: 760, y: 390, kind: 'splitter' });
      break;
    case 'powerupsField':
      flights.push(trace(world, 0, angleTo(world.ships[0], { x: 390, y: 470 }), 50));
      pickups.push({ x: 810, y: 555, kind: 'blackhole' }, { x: 1030, y: 440, kind: 'defense' });
      break;
    case 'tricks':
      flights.push(trace(world, 0, direct + 5, 52));
      break;
    case 'round':
      for (let i = 0; i < world.ships.length; i++) {
        flights.push(trace(world, i, angleTo(world.ships[i], world.ships[(i + 1) % world.ships.length]), 50));
      }
      break;
    case 'daily':
      flights.push(trace(world, 0, direct + 2, 47));
      break;
    case 'welcome':
    case 'gravity':
    case 'keys':
      flights.push(trace(world, 0, direct, kind === 'keys' ? 42 : 50));
      break;
  }
  return { kind, world, flights, pickups, target: kind === 'daily' ? target : undefined, powerUp, trick, teleport, removedPlanet };
}

function drawShip(ctx: CanvasRenderingContext2D, point: Point, angle: number, color: string, active: boolean, shield = false): void {
  ctx.save();
  ctx.translate(point.x, point.y);
  ctx.rotate((-angle * Math.PI) / 180);
  if (shield) {
    ctx.beginPath();
    ctx.arc(0, 0, 25, 0, Math.PI * 2);
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
    ctx.arc(0, 0, 28, 0, Math.PI * 2);
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

function drawTrack(ctx: CanvasRenderingContext2D, flight: Flight, progress: number, faint = false): void {
  const { points, breaks } = flight;
  if (!points.length) return;
  const visible = faint ? points.length : Math.max(1, Math.floor(progress * (points.length - 1)) + 1);
  if (!faint && visible < 2) return;
  ctx.save();
  ctx.globalAlpha = faint ? 0.25 : flight.ghost ? 0.43 : 0.96;
  ctx.strokeStyle = flight.color;
  ctx.lineWidth = faint ? 2 : flight.ghost ? 2 : 4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (faint) ctx.setLineDash([9, 13]);
  ctx.beginPath();
  for (let i = 0; i < visible; i++) {
    const p = points[i];
    if (i === 0 || breaks.includes(i)) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  if (!faint && !flight.ghost) {
    const p = points[Math.min(points.length - 1, visible - 1)];
    ctx.beginPath();
    ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
    ctx.fillStyle = flight.color;
    ctx.shadowColor = flight.color;
    ctx.shadowBlur = 18;
    ctx.fill();
  }
  ctx.restore();
}

function drawPortal(ctx: CanvasRenderingContext2D, x: number, y: number, time: number): void {
  ctx.save();
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

function drawWorld(ctx: CanvasRenderingContext2D, demo: Demo, progress: number, time: number, dpr: number, canvasWidth: number, canvasHeight: number, sprites: Map<number, PlanetSprite>): void {
  const scale = Math.min((canvasWidth - 28) / FIELD.width, (canvasHeight - 28) / FIELD.height);
  const ox = (canvasWidth - FIELD.width * scale) / 2;
  const oy = (canvasHeight - FIELD.height * scale) / 2;
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

  // Fixed, fine star coordinates keep the miniature field stable while its simulation plays.
  for (let i = 0; i < 74; i++) {
    const x = (i * 367 + 83) % FIELD.width;
    const y = (i * 191 + 47) % FIELD.height;
    ctx.globalAlpha = 0.2 + ((i * 17) % 7) * 0.07;
    ctx.fillStyle = i % 8 === 0 ? COLORS.sodium : COLORS.bone;
    ctx.fillRect(x, y, i % 9 === 0 ? 3 : 2, i % 9 === 0 ? 3 : 2);
  }
  ctx.globalAlpha = 1;

  for (const hole of demo.world.holes) drawBlackHole(ctx, hole, time);
  for (const cloud of demo.world.nebulae) drawNebula(ctx, cloud, POWER_UP_COLORS.nebula, time);
  for (const p of demo.world.planets) {
    let sprite = sprites.get(p.seed);
    if (!sprite) {
      sprite = renderPlanet(p, 1);
      sprites.set(p.seed, sprite);
    }
    sprite.draw(ctx, p.x, p.y, 1, time);
  }
  for (const defense of demo.world.defenses) {
    const host = demo.world.planets.find((p) => p.seed === defense.planet) ?? null;
    drawDefense(ctx, defense, host, POWER_UP_COLORS.defense, time, 0.9);
  }
  for (const portal of demo.world.wormholes) {
    drawPortal(ctx, portal.ax, portal.ay, time);
    drawPortal(ctx, portal.bx, portal.by, time + 0.7);
    ctx.save();
    ctx.setLineDash([8, 14]);
    ctx.strokeStyle = 'rgba(77,184,255,.3)';
    ctx.beginPath(); ctx.moveTo(portal.ax, portal.ay); ctx.quadraticCurveTo((portal.ax + portal.bx) / 2, Math.min(portal.ay, portal.by) - 100, portal.bx, portal.by); ctx.stroke();
    ctx.restore();
  }

  if (demo.kind === 'daily' && demo.target) {
    drawTarget(ctx, demo.target, time);
  }

  for (const flight of demo.flights) drawTrack(ctx, flight, progress, true);
  if (demo.kind === 'round') {
    const stage = progress * demo.flights.length;
    const current = Math.min(demo.flights.length - 1, Math.floor(stage));
    demo.flights.forEach((flight, i) => {
      if (i < current) drawTrack(ctx, flight, 1);
      else if (i === current) drawTrack(ctx, flight, stage - current);
    });
  } else {
    for (const flight of demo.flights) drawTrack(ctx, flight, progress);
  }

  if (demo.powerUp === 'preview' && demo.flights[0]) drawPreviewWindow(ctx, demo.flights[0], progress);
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
    ctx.save();
    ctx.strokeStyle = POWER_UP_COLORS.teleport;
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 8]);
    ctx.lineDashOffset = -time * 12;
    ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.quadraticCurveTo((from.x + to.x) / 2, Math.min(from.y, to.y) - 90, to.x, to.y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.5 + Math.sin(time * 4) * 0.12;
    drawShip(ctx, to, 0, POWER_UP_COLORS.teleport, true);
    ctx.restore();
  }
  for (const flight of demo.flights) {
    for (const hit of flight.hits ?? []) drawEvent(ctx, hit, POWER_UP_COLORS.piercing, time);
    for (const bounce of flight.reflects ?? []) drawEvent(ctx, bounce, POWER_UP_COLORS.shield, time);
    for (const path of flight.missiles ?? []) {
      if (path.length < 2) continue;
      ctx.save();
      ctx.strokeStyle = POWER_UP_COLORS.defense;
      ctx.fillStyle = '#f5ffb8';
      ctx.lineWidth = 2.5;
      ctx.shadowColor = POWER_UP_COLORS.defense;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      path.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
      ctx.stroke();
      const head = path[Math.min(path.length - 1, Math.floor(path.length * progress))];
      if (head) { ctx.beginPath(); ctx.arc(head.x, head.y, 4, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    }
  }
  if (demo.removedPlanet) {
    const p = demo.removedPlanet;
    ctx.save();
    ctx.strokeStyle = POWER_UP_COLORS.planetkiller;
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.8;
    ctx.setLineDash([6, 7]);
    ctx.beginPath(); ctx.arc(p.x, p.y, 74 + Math.sin(time * 3) * 4, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(p.x - 25, p.y - 25); ctx.lineTo(p.x + 25, p.y + 25); ctx.moveTo(p.x + 25, p.y - 25); ctx.lineTo(p.x - 25, p.y + 25); ctx.stroke();
    ctx.restore();
  }

  if (demo.kind === 'tricks') {
    for (const flight of demo.flights) {
      for (const moment of flight.style.filter((event) => !demo.trick || event.kind === demo.trick)) {
        const pulse = 18 + Math.sin(time * 5) * 4;
        ctx.beginPath();
        ctx.arc(moment.x, moment.y, pulse, 0, Math.PI * 2);
        ctx.strokeStyle = COLORS.sodium;
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(moment.x, moment.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = COLORS.sodium;
        ctx.fill();
      }
    }
  }

  demo.world.ships.forEach((ship, i) => {
    if (!ship.alive) return;
    if (demo.kind === 'daily' && i === 1) return;
    const flight = demo.flights.find((f) => f.shooter === i && !f.ghost) ?? demo.flights[demo.flights.length - 1];
    const angle = flight?.shooter === i && flight.points.length > 1
      ? angleTo(ship, flight.points[Math.min(flight.points.length - 1, 8)])
      : 0;
    const active = demo.kind === 'round'
      ? i === Math.min(demo.world.ships.length - 1, Math.floor(progress * demo.world.ships.length))
      : demo.kind === 'horizon';
    drawShip(ctx, ship, angle, COLORS.players[i], active, ship.shield);
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
