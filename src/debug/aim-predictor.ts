/**
 * Debug aim predictor — dev page (`debug-aim.html`), not part of the game.
 *
 * Sample a stratified angle × power grid through the production `Shot` integrator with the TRUE
 * world (real planet masses, no AI belief): 500 aim cells, three trajectories each ("3x"), so
 * 1500 flights total. Hits on the own ship show up in danger red, hits on each enemy in that
 * enemy's colour; everything else (planet, lost, timeout, clash) is a dim dot. The chart renders
 * on a canvas and can be downloaded as a PNG.
 */
import { AIM, COLORS, HORIZON } from '../config';
import { cloneWorld, Shot, type ShotEnd, type ShotRules, type World } from '../physics';
import { generateWorld } from '../world';
import { createRng, randomSeed, type Rng } from '../rng';

// ————————————————————————————— Setup —————————————————————————————

/** Aim cells across the angle × power plane: 25 × 20 bins = 500 cells. */
const ANGLE_BINS = 25;
const POWER_BINS = 20;
/** Trajectories per aim cell ("3x"): 500 cells × 3 = 1500 flights. */
const FACTOR = 3;
/** Default total trajectories; the flights input rescales the bin grid to match. */
const DEFAULT_FLIGHTS = ANGLE_BINS * POWER_BINS * FACTOR;
const MIN_FLIGHTS = 150;
const MAX_FLIGHTS = 15000;
const MAX_PLANETS = 4;
const FLIGHT_TIME = 60;

const { plate, plateLift, line, bone, boneDim, sodium, danger } = COLORS;
const html = document.documentElement;
html.style.background = plate;
html.style.color = bone;
const style = document.createElement('style');
style.textContent = `
  body { margin: 0 24px 24px; font: 13px/1.5 "B612", system-ui, sans-serif; }
  h1 { font-size: 16px; margin: 16px 0 4px; letter-spacing: 0.08em; text-transform: uppercase; }
  .bar { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin: 8px 0 12px; color: ${boneDim}; }
  .bar code { color: ${bone}; }
  .bar input, .bar select { background: ${plateLift}; color: ${bone}; border: 1px solid ${line};
    border-radius: 3px; padding: 3px 6px; font: inherit; }
  button { background: ${sodium}; color: #1c1207; border: none; border-radius: 3px; padding: 5px 12px;
    font: 700 13px/1.4 "B612", system-ui, sans-serif; cursor: pointer; }
  button:disabled { opacity: 0.4; cursor: wait; }
  .panes { display: flex; gap: 16px; align-items: flex-start; }
  .pane--chart canvas { background: ${plateLift}; border: 1px solid ${line}; border-radius: 4px; display: block; }
  .pane--map { position: sticky; top: 16px; }
  .pane--map canvas { background: ${plate}; border: 1px solid ${line}; border-radius: 4px; display: block; }
  .pane--map .note { color: ${boneDim}; font: 11px/1.4 "B612 Mono", monospace; margin: 6px 0 0; }
  .legend { display: flex; flex-wrap: wrap; gap: 14px; margin: 10px 0 0; }
  .legend span { display: inline-flex; align-items: center; gap: 6px; color: ${boneDim}; }
  .dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
  .stats { margin: 0 0 14px; color: ${bone}; font: 12px/1.7 "B612 Mono", monospace; }
  .stats span { color: ${boneDim}; }
  .outcome-filters { display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center; margin: 4px 0 10px; color: ${boneDim}; }
  .outcome-filters label { display: inline-flex; align-items: center; gap: 4px; }
  .outcome-filters input { accent-color: ${sodium}; margin: 0; }
`;
document.head.append(style);

// ————————————————————————————— State —————————————————————————————

const elements = {
  seed: document.createElement('input'),
  horizon: document.createElement('input'),
  collapses: document.createElement('select'),
  ships: document.createElement('select'),
  flights: document.createElement('input'),
  minPower: document.createElement('input'),
  shooter: document.createElement('select'),
  reroll: document.createElement('button'),
  run: document.createElement('button'),
  png: document.createElement('button'),
  canvas: document.createElement('canvas'),
  map: document.createElement('canvas'),
  note: document.createElement('p'),
  legend: document.createElement('div'),
  outcomeFilters: document.createElement('div'),
  stats: document.createElement('div'),
  status: document.createElement('span'),
};

let world: World | null = null;
let shooter = 0;
let shipCount = 2;
let horizonMode = false;
let lastSamples: readonly Sample[] = [];

type FilterableOutcome = Exclude<ShotEnd['kind'], 'ship'>;
const filterableOutcomes: readonly [FilterableOutcome, string][] = [
  ['lost', 'lost'],
  ['timeout', 'timeout'],
  ['planet', 'planet hit'],
  ['hole', 'black-hole hit'],
  ['clash', 'clash'],
];
const excludedOutcomes = new Set<FilterableOutcome>();

function visibleSamples(samples: readonly Sample[]): Sample[] {
  return samples.filter((s) => s.end.kind === 'ship' || !excludedOutcomes.has(s.end.kind));
}

function refreshShips(): void {
  const ships = world?.ships ?? [];
  if (!ships[shooter]?.alive) shooter = ships.findIndex((ship) => ship.alive);
  if (shooter < 0) shooter = 0;
  elements.shooter.replaceChildren(
    ...ships.map((ship, i) => {
      const option = new Option(`Ship ${i}${i === shooter ? ' (self)' : ''}${ship.alive ? '' : ' (swallowed)'}`, String(i));
      option.disabled = !ship.alive;
      return option;
    }),
  );
  elements.shooter.value = String(shooter);
}

// ————————————————————————————— Sampling —————————————————————————————

let rules: ShotRules = { bounce: false, timeLimit: FLIGHT_TIME };

export interface Sample {
  angle: number;
  power: number;
  end: ShotEnd;
}

/**
 * Truth-based predictor: every sampled aim flies in the real world, no learned gravity.
 * The angle × power plane is cut into bins — aspect roughly kept, rescaled so the total
 * lands near `flights`; each bin is sampled FACTOR times, jittered within the bin, seeded
 * so the same world always yields the same chart.
 */
export function sampleAims(source: World, from: number, rng: Rng, flights = DEFAULT_FLIGHTS, minPower = 0): Sample[] {
  const out: Sample[] = [];
  const cells = Math.max(1, Math.round(flights / FACTOR));
  const angleBins = Math.max(1, Math.round(Math.sqrt(cells * 1.25)));
  const powerBins = Math.max(1, Math.round(cells / angleBins));
  const angleWidth = 360 / angleBins;
  const powerWidth = AIM.MAX_POWER / powerBins;
  for (let angleBin = 0; angleBin < angleBins; angleBin++) {
    for (let powerBin = 0; powerBin < powerBins; powerBin++) {
      for (let sub = 0; sub < FACTOR; sub++) {
        const angle = -180 + (angleBin + rng()) * angleWidth;
        const power = (powerBin + rng()) * powerWidth;
        if (power < minPower) continue;
        const shot = new Shot(source, from, angle, power, rules);
        let end: ShotEnd | null = null;
        while (!end) end = shot.step();
        out.push({ angle, power, end });
      }
    }
  }
  return out;
}

/** Project consecutive EH collapses from the initial generated world, assuming no shot kills. */
function projectHorizonWorld(initial: World, collapses: number): World {
  const projected = cloneWorld(initial);
  const hole = projected.hole;
  if (!hole) return projected;
  for (let volleyNo = 1; volleyNo <= collapses; volleyNo++) {
    const toRadius = hole.radius + HORIZON.GROWTH + HORIZON.GROWTH_ACCEL * volleyNo;
    let toMass = hole.mass + HORIZON.MASS_PER_VOLLEY;
    const pull = (x: number, y: number, factor: number, margin: number): { x: number; y: number; lost: boolean } => {
      const d = Math.hypot(x - hole.x, y - hole.y);
      const drift = Math.min(HORIZON.MAX_DRIFT, Math.max(HORIZON.MIN_DRIFT, (HORIZON.DRIFT * hole.mass) / (d * d))) * factor;
      const lost = d - drift < toRadius + margin;
      const k = lost ? 1 : drift / d;
      return { x: x + (hole.x - x) * k, y: y + (hole.y - y) * k, lost };
    };
    const planetLosses = new Set<number>();
    projected.planets.forEach((planet, i) => {
      const drift = pull(planet.x, planet.y, 0.6, planet.radius * 0.6);
      planet.x = drift.x;
      planet.y = drift.y;
      if (drift.lost) {
        planetLosses.add(i);
        toMass += planet.mass * HORIZON.FEED;
      }
    });
    projected.planets = projected.planets.filter((_, i) => !planetLosses.has(i));
    for (const ship of projected.ships) {
      if (!ship.alive) continue;
      const drift = pull(ship.x, ship.y, 1, 14);
      ship.x = drift.x;
      ship.y = drift.y;
      if (drift.lost) ship.alive = false;
    }
    hole.radius = toRadius;
    hole.mass = toMass;
    projected.version++;
  }
  return projected;
}

// ————————————————————————————— Chart —————————————————————————————

/** Geometry and samples of the last drawn chart, so clicks can be mapped back to aims. */
const chart = {
  samples: [] as Sample[],
  left: 0,
  top: 0,
  width: 0,
  height: 0,
  /** Logical chart width in px (canvas may be displayed smaller). */
  logicalWidth: 0,
  displayedWidth: 0,
};

const tooltip = document.createElement('div');
tooltip.style.cssText = `position: fixed; pointer-events: none; z-index: 10; display: none;
  background: ${COLORS.plate}; color: ${COLORS.bone}; border: 1px solid ${COLORS.line};
  border-radius: 4px; padding: 6px 9px; font: 12px/1.5 "B612 Mono", monospace; white-space: pre;`;
document.body.append(tooltip);

function outcomeLabel(s: Sample): string {
  if (s.end.kind === 'ship') return s.end.ship === shooter ? 'SELF-HIT' : `hit ship ${s.end.ship}`;
  if (s.end.kind === 'planet') return `hit planet ${s.end.planet}`;
  return s.end.kind;
}

function pick(event: MouseEvent): void {
  const rect = elements.canvas.getBoundingClientRect();
  // The canvas draws at 1280×720 logical px but may display smaller; scale click to logical.
  const logical = 720;
  const chartX = ((event.clientX - rect.left) / rect.width) * 1280;
  const chartY = ((event.clientY - rect.top) / rect.height) * logical;
  // Nearest sample within a few pixels of the click.
  let best: { sample: Sample; dist: number } | null = null;
  for (const s of chart.samples) {
    const x = chart.left + ((s.angle + 180) / 360) * chart.width;
    const y = chart.top + chart.height - (s.power / 100) * chart.height;
    const dist = Math.hypot(x - chartX, y - chartY);
    if (dist <= 8 && (!best || dist < best.dist)) best = { sample: s, dist };
  }
  if (!best) {
    tooltip.style.display = 'none';
    return;
  }
  const s = best.sample;
  tooltip.textContent = `angle  ${s.angle.toFixed(2)}°\npower  ${s.power.toFixed(1)}\n${outcomeLabel(s)}`;
  tooltip.style.display = 'block';
  const pad = 12;
  tooltip.style.left = `${Math.min(event.clientX + pad, window.innerWidth - tooltip.offsetWidth - pad)}px`;
  tooltip.style.top = `${Math.max(event.clientY - tooltip.offsetHeight - pad, pad)}px`;
  showTrajectory(s);
}

elements.canvas.addEventListener('click', pick);
document.addEventListener('click', (event) => {
  if (event.target !== elements.canvas) tooltip.style.display = 'none';
});

function draw(samples: readonly Sample[]): void {
  const { canvas } = elements;
  const width = 1280;
  const height = 720;
  const scale = window.devicePixelRatio || 1;
  canvas.width = width * scale;
  canvas.height = height * scale;
  canvas.style.width = `${Math.min(width, window.innerWidth - 48)}px`;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);


  // Plot area
  const left = 64;
  const top = 40;
  const plotWidth = width - left - 32;
  const plotHeight = height - top - 64;

  // Remember geometry so click-picking can map canvas pixels back to aims.
  chart.samples = [...samples];
  chart.left = left;
  chart.top = top;
  chart.width = plotWidth;
  chart.height = plotHeight;
  chart.logicalWidth = width;
  ctx.fillStyle = plate;
  ctx.fillRect(left, top, plotWidth, plotHeight);

  // Grid + axes
  ctx.strokeStyle = line;
  ctx.globalAlpha = 0.25;
  ctx.lineWidth = 1;
  for (let a = -180; a <= 180; a += 45) {
    const x = left + ((a + 180) / 360) * plotWidth;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, top + plotHeight);
    ctx.stroke();
  }
  for (let p = 0; p <= 100; p += 20) {
    const y = top + plotHeight - (p / 100) * plotHeight;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(left + plotWidth, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  ctx.fillStyle = boneDim;
  ctx.font = '12px "B612 Mono", monospace';
  ctx.textAlign = 'center';
  for (let a = -180; a <= 180; a += 45) {
    const x = left + ((a + 180) / 360) * plotWidth;
    ctx.fillText(`${a}°`, x, top + plotHeight + 18);
  }
  ctx.textAlign = 'right';
  for (let p = 0; p <= 100; p += 20) {
    const y = top + plotHeight - (p / 100) * plotHeight;
    ctx.fillText(String(p), left - 8, y + 4);
  }
  ctx.textAlign = 'center';
  ctx.fillStyle = bone;
  ctx.font = '700 14px "B612", sans-serif';
  ctx.fillText('Angle (°)', left + plotWidth / 2, height - 12);
  ctx.save();
  ctx.translate(16, top + plotHeight / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText('Power', 0, 0);
  ctx.restore();

  // Dots: self-hit danger, per-enemy colour, everything else dim.
  for (const s of samples) {
    let color: string = boneDim;
    let size = 1.8;
    if (s.end.kind === 'ship') {
      color = s.end.ship === shooter ? danger : COLORS.players[s.end.ship % COLORS.players.length];
      size = s.end.ship === shooter ? 3.4 : 3;
    }
    const x = left + ((s.angle + 180) / 360) * plotWidth;
    const y = top + plotHeight - (s.power / 100) * plotHeight;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = bone;
  ctx.font = '700 14px "B612", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`Aim predictor — truth physics, ${samples.length} trajectories`, left, 24);
}


// ————————————————————————————— Map —————————————————————————————

/** Field units → map px. The map is half-size (640×400) to sit beside the chart. */
const MAP_SCALE = 0.5;

/** Redraw the battlefield; `path` (field units, flat [x0,y0,x1,y1,…]) is drawn when given. */
function drawMap(path: readonly number[] | null, pathColor: string | null): void {
  if (!world) return;
  const { map } = elements;
  const scale = window.devicePixelRatio || 1;
  map.width = world.width * MAP_SCALE * scale;
  map.height = world.height * MAP_SCALE * scale;
  map.style.width = `${world.width * MAP_SCALE}px`;
  map.style.height = `${world.height * MAP_SCALE}px`;
  const ctx = map.getContext('2d')!;
  ctx.scale(scale * MAP_SCALE, scale * MAP_SCALE);

  ctx.fillStyle = plate;
  ctx.fillRect(0, 0, world.width, world.height);
  ctx.strokeStyle = line;
  ctx.globalAlpha = 0.3;
  ctx.strokeRect(0, 0, world.width, world.height);
  ctx.globalAlpha = 1;

  for (const p of world.planets) {
    ctx.fillStyle = p.tint;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = COLORS.boneDim;
    ctx.globalAlpha = 0.4;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  if (world.hole) {
    const hole = world.hole;
    const glow = ctx.createRadialGradient(hole.x, hole.y, Math.max(1, hole.radius * 0.35), hole.x, hole.y, hole.radius * 2.6);
    glow.addColorStop(0, 'rgba(185, 156, 255, 0.55)');
    glow.addColorStop(0.42, 'rgba(98, 182, 255, 0.2)');
    glow.addColorStop(1, 'rgba(98, 182, 255, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(hole.x, hole.y, hole.radius * 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#030711';
    ctx.beginPath();
    ctx.arc(hole.x, hole.y, hole.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = COLORS.sodium;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(hole.x, hole.y, hole.radius, 0, Math.PI * 2);
    ctx.stroke();
  }

  for (const [i, s] of world.ships.entries()) {
    const own = i === shooter;
    ctx.fillStyle = own ? bone : COLORS.players[i % COLORS.players.length];
    ctx.beginPath();
    ctx.arc(s.x, s.y, own ? 14 : 11, 0, Math.PI * 2);
    ctx.fill();
    if (own) {
      ctx.strokeStyle = sodium;
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    ctx.fillStyle = COLORS.plate;
    ctx.font = '700 13px "B612", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(i), s.x, s.y + 1);
  }

  if (path && path.length >= 4 && pathColor) {
    ctx.strokeStyle = pathColor;
    ctx.lineWidth = 2 / MAP_SCALE;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.moveTo(path[0], path[1]);
    for (let i = 2; i < path.length; i += 2) ctx.lineTo(path[i], path[i + 1]);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

/** Fly a sample again through the real world and draw its full path on the map. */
function showTrajectory(s: Sample): void {
  const shot = new Shot(world!, shooter, s.angle, s.power, rules);
  const path: number[] = [shot.x, shot.y];
  let end: ShotEnd | null = null;
  while (!end) {
    end = shot.step();
    path.push(shot.x, shot.y);
  }
  const color =
    end.kind === 'ship' ? (end.ship === shooter ? danger : COLORS.players[end.ship % COLORS.players.length]) : boneDim;
  drawMap(path, color);
  elements.note.textContent = `${outcomeLabel(s)} — angle ${s.angle.toFixed(2)}°, power ${s.power.toFixed(1)}, ${shot.time.toFixed(2)}s flight`;
}
function legend(): void {
  const ships = world?.ships ?? [];
  const entries: [string, string][] = [
    ['self-hit', danger],
    ...ships
      .map((_, i): [string, string] | null => (i === shooter ? null : [`hit ship ${i}`, COLORS.players[i % COLORS.players.length]]))
      .filter((e): e is [string, string] => e !== null),
    ['planet / lost / timeout / clash', boneDim],
  ];
  elements.legend.replaceChildren(
    ...entries.map(([label, color]) => {
      const span = document.createElement('span');
      const dot = document.createElement('i');
      dot.className = 'dot';
      dot.style.background = color;
      span.append(dot, label);
      return span;
    }),
  );
}

// ————————————————————————————— Run —————————————————————————————

async function run(): Promise<void> {
  const seed = Number(elements.seed.value) >>> 0;
  shipCount = Number(elements.ships.value) || 2;
  const flights = Math.min(MAX_FLIGHTS, Math.max(MIN_FLIGHTS, Math.round(Number(elements.flights.value) || DEFAULT_FLIGHTS)));
  elements.flights.value = String(flights);
  const minPower = Math.min(AIM.MAX_POWER - 1, Math.max(0, Math.round(Number(elements.minPower.value) || 0)));
  elements.minPower.value = String(minPower);
  horizonMode = elements.horizon.checked;
  rules = { bounce: false, timeLimit: horizonMode ? HORIZON.SHOT_TIME : FLIGHT_TIME };
  const generated = generateWorld(seed, { players: shipCount, maxPlanets: MAX_PLANETS, blackHole: horizonMode });
  const collapses = Math.max(0, Math.round(Number(elements.collapses.value) || 0));
  elements.collapses.value = String(collapses);
  world = horizonMode ? projectHorizonWorld(generated, collapses) : generated;
  refreshShips();
  const from = shooter;
  elements.run.disabled = true;
  elements.png.disabled = true;
  elements.status.textContent = 'sampling…';
  // Let the browser paint the status before the synchronous sampling burst.
  const { promise: painted, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, 20);
  await painted;
  const started = performance.now();
  const samples = sampleAims(world, from, createRng(seed ^ 0x61696d), flights, minPower);
  lastSamples = samples;
  draw(visibleSamples(samples));
  drawMap(null, null);
  elements.note.textContent = 'Click a dot on the chart to replay its trajectory here.';
  legend();
  updateStats(samples);
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  const holeState = world.hole ? `, black hole r=${world.hole.radius.toFixed(1)} m=${Math.round(world.hole.mass)}` : '';
  elements.status.textContent = `${samples.length} trajectories in ${seconds}s (seed ${seed}, ${horizonMode ? 'Event Horizon snapshot' : 'classic'}, ship ${from}, ${shipCount} ships, ${world.planets.length} planets${holeState}, ${rules.timeLimit}s flight limit, min power ${minPower})`;
  elements.run.disabled = false;
  elements.png.disabled = false;
}


/** Hit probability per enemy and self-hit risk over the sampled flights. */
function updateStats(samples: readonly Sample[]): void {
  const ships = world?.ships ?? [];
  const included = visibleSamples(samples);
  const total = included.length;
  const hits = new Array(ships.length).fill(0);
  for (const s of included) if (s.end.kind === 'ship') hits[s.end.ship]++;
  const shipHits = hits.reduce((sum, count) => sum + count, 0);
  const pct = (n: number, denominator: number) => (denominator ? `${((100 * n) / denominator).toFixed(1)}%` : 'n/a');
  const rows: string[] = [`<span>included outcomes</span> ${total.toLocaleString()} / ${samples.length.toLocaleString()}`];
  ships.forEach((_, i) => {
    rows.push(
      i === shooter
        ? `<span>self-hit risk</span> ${pct(hits[i], total)} (${pct(hits[i], shipHits)})`
        : `<span>P(hit ship ${i})</span> ${pct(hits[i], total)} (${pct(hits[i], shipHits)})`,
    );
  });
  elements.stats.innerHTML = rows.join('<br>');
}
function download(): void {
  const a = document.createElement('a');
  a.href = elements.canvas.toDataURL('image/png');
  a.download = `aim-predictor-seed${elements.seed.value}-ship${shooter}.png`;
  a.click();
}

// ————————————————————————————— Page —————————————————————————————

const title = document.createElement('h1');
title.textContent = 'Slingshot — Aim Predictor (debug)';
document.body.append(title);

const bar = document.createElement('div');
bar.className = 'bar';
elements.legend.className = 'legend';
elements.seed.type = 'number';
elements.seed.value = String(randomSeed());
elements.seed.title = 'World seed';
elements.seed.addEventListener('change', run);
elements.horizon.type = 'checkbox';
elements.horizon.title = 'Analyze one fixed Event Horizon volley state';
elements.horizon.addEventListener('change', () => {
  if (elements.horizon.checked) {
    elements.collapses.value = '0';
  }
  elements.collapses.disabled = !elements.horizon.checked;
  void run();
});
elements.collapses.replaceChildren(
  ...Array.from({ length: 11 }, (_, collapses) => {
    const radius = HORIZON.START_RADIUS + collapses * HORIZON.GROWTH + HORIZON.GROWTH_ACCEL * (collapses * (collapses + 1)) / 2;
    return new Option(`${collapses === 0 ? 'Initial' : `After ${collapses} collapses`} (r ${radius.toFixed(1)})`, String(collapses));
  }),
);
elements.collapses.value = '0';
elements.collapses.title = 'Select the number of completed Event Horizon collapses';
elements.collapses.disabled = true;
elements.collapses.addEventListener('change', run);
elements.ships.title = 'Ships in the world';
elements.ships.replaceChildren(...[2, 3, 4, 5, 6].map((n) => new Option(String(n), String(n))));
elements.ships.value = '2';
elements.ships.addEventListener('change', run);
elements.flights.type = 'number';
elements.flights.value = String(DEFAULT_FLIGHTS);
elements.flights.min = String(MIN_FLIGHTS);
elements.flights.max = String(MAX_FLIGHTS);
elements.flights.step = '150';
elements.flights.title = `Total trajectories (${MIN_FLIGHTS}–${MAX_FLIGHTS})`;
elements.flights.addEventListener('change', run);
elements.minPower.type = 'number';
elements.minPower.value = '10';
elements.minPower.min = '0';
elements.minPower.max = '99';
elements.minPower.title = 'Ignore sampled aims below this power';
elements.minPower.addEventListener('change', run);
elements.shooter.addEventListener('change', () => {
  shooter = Number(elements.shooter.value);
  void run();
});
elements.reroll.textContent = 'Reroll world';
elements.reroll.addEventListener('click', () => {
  elements.seed.value = String(randomSeed());
  void run();
});
elements.run.textContent = 'Resample';
elements.run.addEventListener('click', () => void run());
elements.png.textContent = 'Download PNG';
elements.png.disabled = true;
elements.png.addEventListener('click', download);
const label = (text: string): HTMLElement => {
  const code = document.createElement('code');
  code.textContent = text;
  return code;
};
bar.append(
  label('seed'), elements.seed,
  (() => {
    const wrapper = document.createElement('label');
    wrapper.append(elements.horizon, document.createTextNode('Event Horizon'));
    return wrapper;
  })(),
  label('BH size'), elements.collapses,
  label('ships'), elements.ships,
  label('flights'), elements.flights,
  label('min power'), elements.minPower,
  label('shooter'), elements.shooter,
  elements.reroll, elements.run, elements.png, elements.status,
);
elements.stats.className = 'stats';
elements.outcomeFilters.className = 'outcome-filters';
const filterTitle = document.createElement('span');
filterTitle.textContent = 'Ignore outcomes:';
elements.outcomeFilters.append(filterTitle);
for (const [kind, labelText] of filterableOutcomes) {
  const labelElement = document.createElement('label');
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.addEventListener('change', () => {
    if (checkbox.checked) excludedOutcomes.add(kind);
    else excludedOutcomes.delete(kind);
    draw(visibleSamples(lastSamples));
    updateStats(lastSamples);
  });
  const text = document.createElement('span');
  text.textContent = labelText;
  labelElement.append(checkbox, text);
  elements.outcomeFilters.append(labelElement);
}
document.body.append(bar, elements.outcomeFilters, elements.stats);

document.body.append(
  (() => {
    const panes = document.createElement('div');
    panes.className = 'panes';
    const chartPane = document.createElement('div');
    chartPane.className = 'pane--chart';
    chartPane.append(elements.canvas, elements.legend);
    const mapPane = document.createElement('div');
    mapPane.className = 'pane--map';
    elements.note.className = 'note';
    mapPane.append(elements.map, elements.note);
    panes.append(chartPane, mapPane);
    return panes;
  })(),
);

void run();
