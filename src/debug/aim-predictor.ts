/**
 * Debug aim predictor — dev page (`debug-aim.html`), not part of the game.
 *
 * Sample a stratified angle × power grid through the production `Shot` integrator with the TRUE
 * world (real planet masses, no AI belief): 500 aim cells, three trajectories each ("3x"), so
 * 1500 flights total. Hits on the own ship show up in danger red, hits on each enemy in that
 * enemy's colour; everything else (planet, lost, timeout) is a dim dot. The chart renders
 * on a canvas and can be downloaded as a PNG.
 */
import '@fontsource/big-shoulders-stencil-display/800';
import '@fontsource/b612/400';
import '@fontsource/b612/700';
import '@fontsource/b612-mono/400';
import '@fontsource/b612-mono/700';

import { AIM, COLORS, FONTS, GRACE, HORIZON, SCORING } from '../config';
import { cloneWorld, Shot, type ShotEnd, type ShotRules, type StyleKind, type World } from '../physics';
import { scoreChallengeHit, scoreHorizonKill } from '../scoring';
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

const { plate, plateLift, line, bone, boneDim, sodium, danger } = COLORS;
const html = document.documentElement;
html.style.background = plate;
html.style.color = bone;
const style = document.createElement('style');
style.textContent = `
  :root { color-scheme: dark; --plate: ${plate}; --lift: ${plateLift}; --line: ${line}; --bone: ${bone};
    --muted: ${boneDim}; --accent: ${COLORS.players[0]}; --mint: ${COLORS.players[1]}; --gold: ${sodium};
    --body: ${FONTS.body}; --display: ${FONTS.display}; --mono: ${FONTS.mono}; }
  html { min-height: 100%; background: radial-gradient(ellipse at 50% -25%, #1c3967 0%, var(--plate) 58%); }
  body { min-height: 100vh; margin: 0; padding: 34px clamp(16px, 3vw, 48px) 48px; color: var(--bone);
    font: 14px/1.5 var(--body); }
  button, input, select { font: inherit; }
  button { min-height: 38px; padding: 8px 14px; border: 1px solid rgb(91 125 179 / .55); border-radius: 3px;
    background: rgb(19 39 70 / .72); color: var(--bone); font-weight: 700; letter-spacing: .02em; cursor: pointer;
    transition: border-color 140ms, background 140ms, color 140ms, transform 80ms; }
  button:hover:not(:disabled) { border-color: var(--line); background: rgb(91 125 179 / .25); }
  button:active:not(:disabled) { transform: translateY(1px); }
  button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  button:disabled { opacity: .4; cursor: wait; }
  .app { width: min(1560px, 100%); margin: 0 auto; }
  .hero { display: flex; align-items: end; justify-content: space-between; gap: 20px; margin-bottom: 24px; }
  .eyebrow { margin: 0 0 7px; color: var(--accent); font-size: 11px; font-weight: 700; letter-spacing: .24em; text-transform: uppercase; }
  h1 { margin: 0; font: 800 clamp(34px, 5vw, 54px)/.95 var(--display); letter-spacing: .035em; text-transform: uppercase; }
  .lede { max-width: 45ch; margin: 10px 0 0; color: var(--muted); font-size: 13px; }
  .debug-tag { flex: none; padding: 5px 9px; border: 1px solid rgb(255 210 122 / .45); color: var(--gold);
    font: 11px var(--mono); letter-spacing: .12em; text-transform: uppercase; }
  .panel { position: relative; padding: 18px; border: 1px solid rgb(91 125 179 / .42); border-radius: 2px;
    background: rgb(11 26 51 / .86); box-shadow: 0 18px 55px rgb(0 0 0 / .18); }
  .panel::before, .panel::after { position: absolute; width: 12px; height: 12px; border: 1px solid rgb(232 228 216 / .42); content: ''; }
  .panel::before { top: -4px; left: -4px; border-right: 0; border-bottom: 0; }
  .panel::after { right: -4px; bottom: -4px; border-top: 0; border-left: 0; }
  .panel__head { display: flex; align-items: baseline; justify-content: space-between; gap: 14px; margin-bottom: 13px; }
  .section-title { margin: 0; color: var(--accent); font-size: 11px; font-weight: 700; letter-spacing: .2em; text-transform: uppercase; }
  .bar { display: grid; grid-template-columns: repeat(6, minmax(110px, 1fr)); gap: 10px; }
  .field { display: grid; gap: 5px; min-width: 0; color: var(--muted); font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
  .field input:not([type=checkbox]), .field select { width: 100%; min-width: 0; height: 36px; padding: 6px 9px;
    border: 1px solid rgb(91 125 179 / .5); border-radius: 3px; background: rgb(6 15 31 / .8); color: var(--bone); font-size: 13px; }
  .field input[type=checkbox] { width: 17px; height: 17px; margin: 0; accent-color: var(--accent); }
  .field__hint { color: var(--muted); font-size: 9px; font-weight: 400; letter-spacing: 0; text-transform: none; }
  .field--check { display: flex; align-items: center; gap: 9px; min-height: 36px; padding-top: 18px; }
  .actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 14px; }
  .actions .button--primary { border-color: var(--accent); background: rgb(255 134 96 / .12); color: var(--accent); }
  .actions .button--primary:hover:not(:disabled) { background: rgb(255 134 96 / .24); }
  .status { flex: 1 1 360px; min-width: 0; margin-left: 6px; color: var(--muted); font: 11px/1.5 var(--mono); }
  .analysis { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 16px; align-items: center; margin: 14px 0; }
  .outcome-filters { display: flex; flex-wrap: wrap; gap: 7px; align-items: center; color: var(--muted); }
  .filter-title { margin-right: 4px; font-size: 11px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
  .outcome-filters label { display: inline-flex; align-items: center; gap: 6px; padding: 5px 8px; border: 1px solid rgb(91 125 179 / .25); border-radius: 3px; font-size: 11px; }
  .outcome-filters input { margin: 0; accent-color: var(--gold); }
  .stats { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
  .stat { display: grid; gap: 2px; min-width: 100px; padding: 6px 10px; border-left: 2px solid var(--mint); background: rgb(19 39 70 / .46); }
  .stat__label { color: var(--muted); font-size: 9px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; }
  .stat__value { color: var(--bone); font: 700 15px var(--mono); }
  .panes { display: grid; grid-template-columns: minmax(0, 1fr) minmax(480px, .9fr); gap: 14px; align-items: start; }
  .pane { min-width: 0; padding: 12px; border: 1px solid rgb(91 125 179 / .28); background: rgb(6 15 31 / .38); }
  .pane--map { position: sticky; top: 14px; }
  .pane__head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 9px; }
  .pane__title { margin: 0; font-size: 11px; font-weight: 700; letter-spacing: .16em; text-transform: uppercase; }
  .pane__meta { color: var(--muted); font: 10px var(--mono); }
  .pane--chart canvas { display: block; border: 1px solid rgb(91 125 179 / .45); background: var(--plate); }
  .aim-frame { position: relative; }
  .aim-viewport { width: 100%; height: min(520px, 64vw); min-height: 280px; overflow: auto; border: 1px solid rgb(91 125 179 / .45);
    background: var(--plate); scrollbar-color: var(--line) var(--lift); cursor: grab; overscroll-behavior: contain; }
  .aim-viewport.is-panning { cursor: grabbing; user-select: none; }
  .aim-viewport canvas { display: block; max-width: none; height: auto; }
  .aim-tools { display: flex; align-items: center; gap: 5px; margin: 8px 0; }
  .aim-tools button { min-width: 34px; min-height: 30px; padding: 4px 8px; font: 12px var(--mono); }
  .aim-zoom-label { min-width: 52px; color: var(--muted); font: 10px var(--mono); text-align: center; }
  .aim-tools__hint { margin-left: auto; color: var(--muted); font-size: 10px; }
  .pane--map .note { min-height: 2.8em; margin: 8px 0 0; color: var(--muted); font: 10px/1.5 var(--mono); }
  .legend { display: flex; flex-wrap: wrap; gap: 8px 14px; margin: 10px 0 0; }
  .legend span { display: inline-flex; align-items: center; gap: 6px; color: var(--muted); font-size: 11px; }
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; box-shadow: 0 0 8px currentColor; }
  .tooltip { position: fixed; z-index: 10; display: none; padding: 7px 10px; border: 1px solid var(--line); border-radius: 3px;
    background: var(--plate); color: var(--bone); font: 11px/1.5 var(--mono); white-space: pre; pointer-events: none; }
  .heat-legend { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 8px 0 12px; color: var(--muted); font-size: 10px; }
  .heat-ramp { width: 110px; height: 8px; border: 1px solid rgb(91 125 179 / .4); background: linear-gradient(90deg, ${danger}, ${plate}, ${COLORS.players[1]}); }
  .heat-note { color: var(--muted); font: 10px var(--mono); }
  .top-shots { margin-top: 14px; padding: 12px; border: 1px solid rgb(91 125 179 / .28); background: rgb(11 26 51 / .65); }
  .top-shots__title { margin: 0 0 8px; color: var(--accent); font-size: 10px; letter-spacing: .16em; text-transform: uppercase; }
  .top-shots ol { display: grid; gap: 4px; margin: 0; padding: 0; list-style: none; }
  .top-shot { display: grid; grid-template-columns: 24px minmax(0, 1fr) auto; gap: 8px; align-items: center; padding: 6px 8px;
    border: 1px solid transparent; color: var(--muted); font: 10px/1.45 var(--mono); cursor: pointer; }
  .top-shot:hover, .top-shot:focus-visible { outline: none; border-color: rgb(91 125 179 / .45); background: rgb(91 125 179 / .12); }
  .top-shot__rank { color: var(--gold); }
  .top-shot__aim { color: var(--bone); }
  .top-shot__score { color: var(--mint); font-size: 12px; font-weight: 700; white-space: nowrap; }
  .top-shot__styles { grid-column: 2 / -1; color: var(--gold); font: 9px var(--body); }
  .top-shots__empty, .top-shots__note { margin: 0; color: var(--muted); font-size: 10px; line-height: 1.5; }
  .top-shots__note { margin-top: 8px; }
  @media (max-width: 1180px) { .bar { grid-template-columns: repeat(3, minmax(110px, 1fr)); } .analysis { grid-template-columns: 1fr; }
    .stats { justify-content: flex-start; } .panes { grid-template-columns: minmax(0, 1fr); } .pane--map { position: static; } }
  @media (max-width: 560px) { body { padding: 22px 12px 30px; } .hero { align-items: flex-start; } .debug-tag { font-size: 9px; }
    .bar { grid-template-columns: repeat(2, minmax(0, 1fr)); } .panel { padding: 13px; } .pane { padding: 8px; } }
`;
document.head.append(style);

// ————————————————————————————— State —————————————————————————————

const elements = {
  seed: document.createElement('input'),
  horizon: document.createElement('input'),
  collapses: document.createElement('select'),
  shotTime: document.createElement('select'),
  bounce: document.createElement('input'),
  ships: document.createElement('select'),
  maxPlanets: document.createElement('select'),
  teams: document.createElement('select'),
  teamSeats: document.createElement('input'),
  fixedPower: document.createElement('input'),
  fixedPowerLevel: document.createElement('input'),
  maxPower: document.createElement('input'),
  exactAngle: document.createElement('input'),
  exactPower: document.createElement('input'),
  exactAim: document.createElement('button'),
  flights: document.createElement('input'),
  minPower: document.createElement('input'),
  grace: document.createElement('select'),
  styleBonuses: document.createElement('input'),
  shooter: document.createElement('select'),
  reroll: document.createElement('button'),
  run: document.createElement('button'),
  png: document.createElement('button'),
  canvas: document.createElement('canvas'),
  map: document.createElement('canvas'),
  aimViewport: document.createElement('div'),
  aimZoomIn: document.createElement('button'),
  aimZoomOut: document.createElement('button'),
  aimZoomReset: document.createElement('button'),
  aimZoomLabel: document.createElement('span'),
  note: document.createElement('p'),
  legend: document.createElement('div'),
  outcomeFilters: document.createElement('div'),
  stats: document.createElement('div'),
  topShots: document.createElement('div'),
  status: document.createElement('span'),
};

let world: World | null = null;
let shooter = 0;
let shipCount = 2;
let horizonMode = false;
let firstShotGrace = 0;
let styleBonuses = true;
let currentSpared: number[] = [];
let currentFixedPower = false;
let currentFixedPowerLevel: number = AIM.FIXED_POWER;
let lastSamples: readonly Sample[] = [];

type FilterableOutcome = Exclude<ShotEnd['kind'], 'ship'>;
const filterableOutcomes: readonly [FilterableOutcome, string][] = [
  ['lost', 'lost'],
  ['timeout', 'timeout'],
  ['planet', 'planet hit'],
  ['hole', 'black-hole hit'],
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

let rules: ShotRules = { bounce: false, timeLimit: 20 };

export interface Sample {
  angle: number;
  power: number;
  end: ShotEnd;
  styles: StyleKind[];
  points: number;
}

/**
 * Truth-based predictor: every sampled aim flies in the real world, no learned gravity.
 * The angle × power plane is cut into bins — aspect roughly kept, rescaled so the total
 * lands near `flights`; each bin is sampled FACTOR times, jittered within the bin, seeded
 * so the same world always yields the same chart.
 */
export function sampleAims(
  source: World,
  from: number,
  rng: Rng,
  flights = DEFAULT_FLIGHTS,
  minPower = 0,
  spare: readonly number[] = [],
  payStyle = true,
): Sample[] {
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
        const shot = new Shot(source, from, angle, power, rules, true, spare);
        let end: ShotEnd | null = null;
        while (!end) end = shot.step();
        const styles = shot.style?.map((event) => event.kind) ?? [];
        const paidStyles = payStyle ? styles : [];
        const points = end.kind === 'ship'
          ? end.ship === from
            ? -SCORING.SELF_HIT
            : horizonMode
              ? scoreHorizonKill(power, paidStyles, false).points
              : scoreChallengeHit(1, power, false, paidStyles).points
          : 0;
        out.push({ angle, power, end, styles, points });
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
  centerX: 0,
  centerY: 0,
  radius: 0,
  heatRadius: 0,
  heatAngleBins: 72,
  heatPowerBins: 20,
};

interface HeatCell {
  points: number;
  count: number;
}

function heatColor(value: number, scale: number): string {
  const t = Math.min(1, Math.abs(value) / scale);
  const from = value < 0 ? [11, 26, 51] : [11, 26, 51];
  const to = value < 0 ? [255, 90, 110] : [111, 227, 200];
  const eased = Math.sqrt(t) * 0.82;
  return `rgba(${Math.round(from[0] + (to[0] - from[0]) * eased)}, ${Math.round(from[1] + (to[1] - from[1]) * eased)}, ${Math.round(from[2] + (to[2] - from[2]) * eased)}, ${0.18 + eased * 0.72})`;
}

function drawHeatmap(ctx: CanvasRenderingContext2D, samples: readonly Sample[], centerX: number, centerY: number, radius: number): void {
  const angleBins = chart.heatAngleBins;
  const powerBins = chart.heatPowerBins;
  const bins: HeatCell[] = Array.from({ length: angleBins * powerBins }, () => ({ points: 0, count: 0 }));
  for (const sample of samples) {
    let a = Math.floor((((sample.angle + 180) % 360 + 360) % 360) / 360 * angleBins);
    a %= angleBins;
    const p = Math.min(powerBins - 1, Math.max(0, Math.floor((sample.power / AIM.MAX_POWER) * powerBins)));
    const cell = bins[p * angleBins + a];
    cell.points += sample.points;
    cell.count++;
  }
  const means = bins.map((cell) => cell.count ? cell.points / cell.count : 0);
  const positive = means.filter((v) => v > 0).sort((a, b) => a - b);
  const scale = Math.max(100, positive[Math.floor(positive.length * 0.9)] ?? 1000);
  const angleStep = (Math.PI * 2) / angleBins;
  for (let p = 0; p < powerBins; p++) {
    for (let a = 0; a < angleBins; a++) {
      const cell = bins[p * angleBins + a];
      if (!cell.count) continue;
      const mean = means[p * angleBins + a];
      // Screen canvas angles run clockwise; game aim angles run counter-clockwise.
      const angleStart = Math.PI - a * angleStep;
      const angleEnd = Math.PI - (a + 1) * angleStep;
      const inner = (p / powerBins) * radius;
      const outer = ((p + 1) / powerBins) * radius;
      ctx.beginPath();
      ctx.arc(centerX, centerY, outer, angleStart, angleEnd, true);
      ctx.arc(centerX, centerY, inner, angleEnd, angleStart);
      ctx.closePath();
      ctx.fillStyle = heatColor(mean, mean < 0 ? SCORING.SELF_HIT : scale);
      ctx.fill();
    }
  }
}

/** Game angles use 0° to the right and positive angles counter-clockwise. */
function polarPoint(angle: number, power: number, centerX: number, centerY: number, radius: number): { x: number; y: number } {
  const radians = (angle * Math.PI) / 180;
  const distance = (power / AIM.MAX_POWER) * radius;
  return { x: centerX + Math.cos(radians) * distance, y: centerY - Math.sin(radians) * distance };
}

const tooltip = document.createElement('div');
tooltip.className = 'tooltip';
document.body.append(tooltip);

function outcomeLabel(s: Sample): string {
  if (s.end.kind === 'ship') return s.end.ship === shooter ? 'SELF-HIT' : `hit ship ${s.end.ship}`;
  if (s.end.kind === 'planet') return `hit planet ${s.end.planet}`;
  return s.end.kind;
}

/** Match's displayed aim convention: normalized to [0°, 360°). */
function displayAngle(angle: number): number {
  return ((angle % 360) + 360) % 360;
}

function pick(event: MouseEvent): void {
  const rect = elements.canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const chartX = ((event.clientX - rect.left) / rect.width) * elements.canvas.width / dpr;
  const chartY = ((event.clientY - rect.top) / rect.height) * elements.canvas.height / dpr;
  // Nearest sample within a few pixels of the click.
  let best: { sample: Sample; dist: number } | null = null;
  for (const s of chart.samples) {
    const point = polarPoint(s.angle, s.power, chart.centerX, chart.centerY, chart.radius);
    const dist = Math.hypot(point.x - chartX, point.y - chartY);
    if (dist <= 8 && (!best || dist < best.dist)) best = { sample: s, dist };
  }
  if (!best) {
    tooltip.style.display = 'none';
    return;
  }
  const s = best.sample;
  tooltip.textContent = `angle  ${displayAngle(s.angle).toFixed(2)}°\npower  ${s.power.toFixed(1)}\n${outcomeLabel(s)}`;
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

function draw(samples: readonly Sample[], scoredSamples: readonly Sample[] = samples): void {
  const { canvas } = elements;
  const viewportWidth = elements.aimViewport.clientWidth || 840;
  const viewportHeight = elements.aimViewport.clientHeight || 520;
  const width = Math.round(Math.max(viewportWidth - 2, 720) * aimZoom);
  const height = Math.round(Math.max(viewportHeight - 2, 540) * aimZoom);
  const scale = window.devicePixelRatio || 1;
  canvas.width = width * scale;
  canvas.height = height * scale;
  canvas.style.width = `${width}px`;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);


  // Polar plot: angle wraps around the circumference; power is radial distance.
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.min(height * 0.39, width * 0.31);

  // Remember geometry so click-picking can map canvas pixels back to aims.
  chart.samples = [...samples];
  chart.centerX = centerX;
  chart.centerY = centerY;
  chart.radius = radius;
  chart.heatRadius = radius;
  chart.heatAngleBins = Math.max(12, Math.round(Math.sqrt(scoredSamples.length / 2)));
  chart.heatPowerBins = Math.max(8, Math.round(scoredSamples.length / chart.heatAngleBins / 2));
  ctx.fillStyle = plate;
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.fill();
  drawHeatmap(ctx, scoredSamples, centerX, centerY, radius);

  // Concentric power rings and angular spokes.
  ctx.strokeStyle = line;
  ctx.globalAlpha = 0.25;
  ctx.lineWidth = 1;
  for (let p = 20; p <= AIM.MAX_POWER; p += 20) {
    ctx.beginPath();
    ctx.arc(centerX, centerY, (p / AIM.MAX_POWER) * radius, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (let a = -180; a < 180; a += 45) {
    const end = polarPoint(a, AIM.MAX_POWER, centerX, centerY, radius);
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Angle labels sit just outside the rim; positive angles rise counter-clockwise.
  ctx.fillStyle = boneDim;
  ctx.font = '12px "B612 Mono", monospace';
  for (let a = -180; a < 180; a += 45) {
    const label = polarPoint(a, AIM.MAX_POWER, centerX, centerY, radius + 24);
    const cosine = Math.cos((a * Math.PI) / 180);
    const sine = Math.sin((a * Math.PI) / 180);
    ctx.textAlign = Math.abs(cosine) < 0.25 ? 'center' : cosine > 0 ? 'left' : 'right';
    ctx.textBaseline = Math.abs(sine) < 0.25 ? 'middle' : sine > 0 ? 'bottom' : 'top';
    ctx.fillText(`${a}°`, label.x, label.y);
  }
  // Power values label the rings along the left-hand radius.
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let p = 20; p <= AIM.MAX_POWER; p += 20) {
    const y = centerY - (p / AIM.MAX_POWER) * radius;
    ctx.fillText(String(p), centerX - radius - 12, y);
  }
  ctx.textAlign = 'center';
  ctx.fillStyle = bone;
  ctx.font = '700 14px "B612", sans-serif';
  ctx.fillText('POWER → RADIUS  ·  ANGLE → DIRECTION  ·  POSITIVE COUNTER-CLOCKWISE', centerX, height - 12);

  // Dots: self-hit danger, per-enemy colour, everything else dim.
  for (const s of samples) {
    let color: string = boneDim;
    let size = 1.8;
    if (s.end.kind === 'ship') {
      color = s.end.ship === shooter ? danger : COLORS.players[s.end.ship % COLORS.players.length];
      size = s.end.ship === shooter ? 3.4 : 3;
    }
    const { x, y } = polarPoint(s.angle, s.power, centerX, centerY, radius);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = bone;
  ctx.font = '700 14px "B612", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`Aim predictor — truth physics, ${samples.length} trajectories`, 32, 24);
}


// ————————————————————————————— Map —————————————————————————————

let aimZoom = 1;

/** Redraw the battlefield; `path` (field units, flat [x0,y0,x1,y1,…]) is drawn when given. */
function drawMap(path: readonly number[] | null, pathColor: string | null): void {
  if (!world) return;
  const { map } = elements;
  const scale = window.devicePixelRatio || 1;
  const mapScale = 0.5;
  map.width = Math.round(world.width * mapScale * scale);
  map.height = Math.round(world.height * mapScale * scale);
  map.style.width = `${world.width * mapScale}px`;
  map.style.height = `${world.height * mapScale}px`;
  const ctx = map.getContext('2d')!;
  ctx.scale(scale * mapScale, scale * mapScale);

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
    ctx.lineWidth = 2 / mapScale;
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
  const shot = new Shot(world!, shooter, s.angle, s.power, rules, true, currentSpared);
  const path: number[] = [shot.x, shot.y];
  let end: ShotEnd | null = null;
  while (!end) {
    end = shot.step();
    path.push(shot.x, shot.y);
  }
  const color =
    end.kind === 'ship' ? (end.ship === shooter ? danger : COLORS.players[end.ship % COLORS.players.length]) : boneDim;
  drawMap(path, color);
  const styleText = s.styles.length && styleBonuses ? ` · ${s.styles.join(', ')}` : '';
  elements.note.textContent = `${outcomeLabel(s)} · ${s.points > 0 ? `+${s.points}` : s.points} pts${styleText} — angle ${displayAngle(s.angle).toFixed(2)}°, power ${s.power.toFixed(1)}, ${shot.time.toFixed(2)}s`;
}

function testExactAim(): void {
  if (!world) return;
  const angle = displayAngle(Number(elements.exactAngle.value) || 0);
  let power = Math.min(AIM.MAX_POWER, Math.max(0, Number(elements.exactPower.value) || 0));
  if (currentFixedPower) power = currentFixedPowerLevel;
  const shot = new Shot(world, shooter, angle, power, rules, true, currentSpared);
  let end: ShotEnd | null = null;
  while (!end) end = shot.step();
  const styles = shot.style?.map((event) => event.kind) ?? [];
  const paidStyles = styleBonuses ? styles : [];
  const hitEnemy = end.kind === 'ship' && end.ship !== shooter;
  const points = end.kind === 'ship'
    ? hitEnemy
      ? horizonMode
        ? scoreHorizonKill(currentFixedPower ? currentFixedPowerLevel : power, paidStyles, currentFixedPower).points
        : scoreChallengeHit(1, currentFixedPower ? currentFixedPowerLevel : power, currentFixedPower, paidStyles).points
      : -SCORING.SELF_HIT
    : 0;
  const sample: Sample = { angle, power, end, styles, points };
  showTrajectory(sample);
  tooltip.textContent = `EXACT AIM · ${points > 0 ? '+' : ''}${points} points\nangle  ${angle.toFixed(2)}°\npower  ${power.toFixed(1)}\n${outcomeLabel(sample)}${styles.length && styleBonuses ? `\n${styles.join(' · ')}` : ''}`;
  tooltip.style.display = 'block';
  const rect = elements.exactAim.getBoundingClientRect();
  tooltip.style.left = `${Math.min(rect.left, window.innerWidth - tooltip.offsetWidth - 12)}px`;
  tooltip.style.top = `${Math.max(rect.bottom + 8, 12)}px`;
}

function updateAimZoomLabel(): void {
  elements.aimZoomLabel.textContent = `${Math.round(aimZoom * 100)}%`;
  elements.aimZoomOut.disabled = aimZoom <= 1;
  elements.aimZoomIn.disabled = aimZoom >= 3;
}

function setAimZoom(next: number, anchorX?: number, anchorY?: number): void {
  const viewport = elements.aimViewport;
  const oldWidth = elements.canvas.clientWidth;
  const oldHeight = elements.canvas.clientHeight;
  const x = anchorX ?? viewport.clientWidth / 2;
  const y = anchorY ?? viewport.clientHeight / 2;
  const contentX = oldWidth ? (viewport.scrollLeft + x) / oldWidth : 0.5;
  const contentY = oldHeight ? (viewport.scrollTop + y) / oldHeight : 0.5;
  aimZoom = Math.min(3, Math.max(1, next));
  draw(visibleSamples(lastSamples), visibleSamples(lastSamples));
  viewport.scrollLeft = contentX * elements.canvas.clientWidth - x;
  viewport.scrollTop = contentY * elements.canvas.clientHeight - y;
  updateAimZoomLabel();
}

elements.aimViewport.addEventListener('wheel', (event) => {
  event.preventDefault();
  const rect = elements.aimViewport.getBoundingClientRect();
  const factor = event.deltaY < 0 ? 1.2 : 1 / 1.2;
  setAimZoom(aimZoom * factor, event.clientX - rect.left, event.clientY - rect.top);
}, { passive: false });
elements.aimZoomIn.addEventListener('click', () => setAimZoom(aimZoom * 1.25));
elements.aimZoomOut.addEventListener('click', () => setAimZoom(aimZoom / 1.25));
elements.aimZoomReset.addEventListener('click', () => setAimZoom(1));

let aimDrag: { id: number; x: number; y: number; left: number; top: number; panning: boolean } | null = null;
elements.aimViewport.addEventListener('pointerdown', (event) => {
  if (event.pointerType === 'touch' || aimZoom <= 1 || event.button !== 0) return;
  aimDrag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: elements.aimViewport.scrollLeft, top: elements.aimViewport.scrollTop, panning: false };
});
elements.aimViewport.addEventListener('pointermove', (event) => {
  if (!aimDrag || event.pointerId !== aimDrag.id) return;
  const dx = event.clientX - aimDrag.x;
  const dy = event.clientY - aimDrag.y;
  if (!aimDrag.panning && Math.hypot(dx, dy) < 5) return;
  if (!aimDrag.panning) {
    aimDrag.panning = true;
    elements.aimViewport.classList.add('is-panning');
    elements.aimViewport.setPointerCapture(event.pointerId);
  }
  elements.aimViewport.scrollLeft = aimDrag.left - dx;
  elements.aimViewport.scrollTop = aimDrag.top - dy;
});
const endAimDrag = (event: PointerEvent): void => {
  if (!aimDrag || event.pointerId !== aimDrag.id) return;
  const wasPanning = aimDrag.panning;
  aimDrag = null;
  elements.aimViewport.classList.remove('is-panning');
  if (wasPanning && elements.aimViewport.hasPointerCapture(event.pointerId)) elements.aimViewport.releasePointerCapture(event.pointerId);
};
elements.aimViewport.addEventListener('pointerup', endAimDrag);
elements.aimViewport.addEventListener('pointercancel', endAimDrag);
window.addEventListener('resize', () => {
  if (!lastSamples.length) return;
  const viewport = elements.aimViewport;
  const horizontal = viewport.scrollLeft / Math.max(1, elements.canvas.clientWidth);
  const vertical = viewport.scrollTop / Math.max(1, elements.canvas.clientHeight);
  draw(visibleSamples(lastSamples), visibleSamples(lastSamples));
  viewport.scrollLeft = horizontal * elements.canvas.clientWidth;
  viewport.scrollTop = vertical * elements.canvas.clientHeight;
});

function legend(): void {
  const ships = world?.ships ?? [];
  const entries: [string, string][] = [
    ['self-hit', danger],
    ...ships
      .map((_, i): [string, string] | null => (i === shooter ? null : [`hit ship ${i}`, COLORS.players[i % COLORS.players.length]]))
      .filter((e): e is [string, string] => e !== null),
    ['planet / lost / timeout', boneDim],
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
  rules = { bounce: elements.bounce.checked, timeLimit: Number(elements.shotTime.value) };
  firstShotGrace = Number(elements.grace.value) || 0;
  styleBonuses = elements.styleBonuses.checked;
  const maxPlanets = Number(elements.maxPlanets.value) || 4;
  const fixedPower = elements.fixedPower.checked;
  const fixedPowerLevel = Math.min(AIM.MAX_POWER, Math.max(0, Number(elements.fixedPowerLevel.value) || 55));
  const powerCap = Math.min(AIM.MAX_POWER, Math.max(1, Number(elements.maxPower.value) || AIM.MAX_POWER));
  currentFixedPower = fixedPower;
  currentFixedPowerLevel = fixedPowerLevel;
  const teams = Number(elements.teams.value);
  const requestedTeams = elements.teamSeats.value.split(/[\s,;]+/).filter(Boolean).map(Number);
  const teamSeats = teams && shipCount >= 3
    ? Array.from({ length: shipCount }, (_, i) => Number.isInteger(requestedTeams[i]) ? ((requestedTeams[i] % teams) + teams) % teams : 0)
    : null;
  if (teamSeats) elements.teamSeats.value = teamSeats.join(', ');
  else elements.teamSeats.value = shipCount >= 3 ? Array.from({ length: shipCount }, (_, i) => i).join(', ') : '0, 1';
  const generated = generateWorld(seed, { players: shipCount, maxPlanets, blackHole: horizonMode, teams: teamSeats });
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
  const spared = firstShotGrace > 0 && shipCount >= GRACE.MIN_SHIPS
    ? [world.ships
        .map((ship, id) => ({ id, distance: id === from || !ship.alive ? Infinity : Math.hypot(ship.x - world!.ships[from].x, ship.y - world!.ships[from].y) }))
        .sort((a, b) => a.distance - b.distance)[0]?.id]
        .filter((id): id is number => id !== undefined && Number.isFinite(id))
    : [];
  const samples = sampleAims(world, from, createRng(seed ^ 0x61696d), flights, minPower, spared, styleBonuses);
  const scoringSamples = fixedPower
    ? samples.map((sample) => {
        if (sample.end.kind !== 'ship' || sample.end.ship === from) return sample;
        return { ...sample, points: horizonMode
          ? scoreHorizonKill(fixedPowerLevel, styleBonuses ? sample.styles : [], true).points
          : scoreChallengeHit(1, fixedPowerLevel, true, styleBonuses ? sample.styles : []).points };
      })
    : samples.map((sample) => sample.end.kind === 'ship' && sample.end.ship !== from
      ? { ...sample, points: horizonMode
        ? scoreHorizonKill(sample.power, styleBonuses ? sample.styles : [], false).points
        : scoreChallengeHit(1, sample.power, false, styleBonuses ? sample.styles : []).points }
      : sample);
  currentSpared = spared;
  lastSamples = scoringSamples;
  draw(visibleSamples(scoringSamples), visibleSamples(scoringSamples));
  drawMap(null, null);
  elements.note.textContent = 'Click a dot on the chart to replay its trajectory here.';
  legend();
  updateStats(scoringSamples);
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  const holeState = world.hole ? `, black hole r=${world.hole.radius.toFixed(1)} m=${Math.round(world.hole.mass)}` : '';
  elements.status.textContent = `${samples.length} trajectories in ${seconds}s (seed ${seed}, ${horizonMode ? 'Event Horizon snapshot' : 'classic'}, ship ${from}, ${shipCount} ships, max ${maxPlanets} planets${teamSeats ? `, team IDs ${teamSeats.join('-')}` : ''}, power ${fixedPower ? `fixed ${fixedPowerLevel}` : `0-${powerCap}`}${holeState}, ${rules.timeLimit}s shot timeout, edges ${rules.bounce ? 'reflective' : 'open'}, first-shot grace ${spared.length ? `through ship ${spared[0]}` : 'off'}, style bonuses ${styleBonuses ? 'on' : 'off'}, min power ${minPower})`;
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
  const stats: [string, string][] = [['included outcomes', `${total.toLocaleString()} / ${samples.length.toLocaleString()}`]];
  ships.forEach((_, i) => {
    stats.push(
      i === shooter
        ? ['self-hit risk', `${pct(hits[i], total)} · ${pct(hits[i], shipHits)} of hits`]
        : [`hit ship ${i}`, `${pct(hits[i], total)} · ${pct(hits[i], shipHits)} of hits`],
    );
  });
  elements.stats.replaceChildren(...stats.map(([name, value]) => {
    const card = document.createElement('div');
    card.className = 'stat';
    const label = document.createElement('span');
    label.className = 'stat__label';
    label.textContent = name;
    const result = document.createElement('strong');
    result.className = 'stat__value';
    result.textContent = value;
    card.append(label, result);
    return card;
  }));
  updateTopShots(samples);
}

function updateTopShots(samples: readonly Sample[]): void {
  const best = samples
    .filter((sample) => sample.end.kind === 'ship' && sample.end.ship !== shooter && sample.points > 0)
    .sort((a, b) => b.points - a.points || a.power - b.power || a.angle - b.angle)
    .slice(0, 5);
  const list = document.createElement('ol');
  if (!best.length) {
    const empty = document.createElement('p');
    empty.className = 'top-shots__empty';
    empty.textContent = 'No target hits in this sample. Try more trajectories or a different world.';
    elements.topShots.replaceChildren(empty);
    return;
  }
  best.forEach((sample, index) => {
    const item = document.createElement('li');
    item.className = 'top-shot';
    item.tabIndex = 0;
    item.setAttribute('role', 'button');
    const rank = document.createElement('span');
    rank.className = 'top-shot__rank';
    rank.textContent = `#${index + 1}`;
    const aim = document.createElement('span');
    aim.className = 'top-shot__aim';
    const target = sample.end.kind === 'ship' ? `P${sample.end.ship}` : '—';
    aim.textContent = `${target} · ${displayAngle(sample.angle).toFixed(1)}° · power ${sample.power.toFixed(1)}`;
    const score = document.createElement('strong');
    score.className = 'top-shot__score';
    score.textContent = `+${sample.points.toLocaleString()} pts`;
    item.append(rank, aim, score);
    if (sample.styles.length && styleBonuses) {
      const styles = document.createElement('span');
      styles.className = 'top-shot__styles';
      styles.textContent = `TRICK BONUS · ${sample.styles.join(' / ')}`;
      item.append(styles);
    }
    const replay = (): void => {
      showTrajectory(sample);
      tooltip.textContent = `FIRST SHOT · +${sample.points} points\nangle  ${displayAngle(sample.angle).toFixed(2)}°\npower  ${sample.power.toFixed(1)}\n${outcomeLabel(sample)}${sample.styles.length && styleBonuses ? `\n${sample.styles.join(' · ')}` : ''}`;
      tooltip.style.display = 'block';
      tooltip.style.left = `${Math.min(item.getBoundingClientRect().right + 10, window.innerWidth - tooltip.offsetWidth - 12)}px`;
      tooltip.style.top = `${Math.max(item.getBoundingClientRect().top, 12)}px`;
    };
    item.addEventListener('click', (event) => {
      event.stopPropagation();
      replay();
    });
    item.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        replay();
      }
    });
    list.append(item);
  });
  elements.topShots.replaceChildren(list);
}
function download(): void {
  const a = document.createElement('a');
  a.href = elements.canvas.toDataURL('image/png');
  a.download = `aim-predictor-seed${elements.seed.value}-ship${shooter}.png`;
  a.click();
}

// ————————————————————————————— Page —————————————————————————————

const app = document.createElement('main');
app.className = 'app';
const hero = document.createElement('header');
hero.className = 'hero';
const heading = document.createElement('div');
const eyebrow = document.createElement('p');
eyebrow.className = 'eyebrow';
eyebrow.textContent = 'Slingshot · trajectory lab';
const title = document.createElement('h1');
title.textContent = 'Aim predictor';
const lede = document.createElement('p');
lede.className = 'lede';
lede.textContent = 'Explore where sampled shots land across the full aim plane. For an exact match, use the same mode, ship count, planet limit and team IDs as the game.';
heading.append(eyebrow, title, lede);
const debugTag = document.createElement('span');
debugTag.className = 'debug-tag';
debugTag.textContent = 'Debug tool';
hero.append(heading, debugTag);

const controlsPanel = document.createElement('section');
controlsPanel.className = 'panel';
const controlsHead = document.createElement('div');
controlsHead.className = 'panel__head';
const controlsTitle = document.createElement('h2');
controlsTitle.className = 'section-title';
controlsTitle.textContent = 'World & sampling';
controlsHead.append(controlsTitle);
const params = new URLSearchParams(location.search);
const bar = document.createElement('div');
bar.className = 'bar';
elements.legend.className = 'legend';
elements.seed.type = 'number';
const requestedSeed = params.get('seed');
elements.seed.value = requestedSeed !== null && Number.isFinite(Number(requestedSeed)) ? String(Number(requestedSeed) >>> 0) : String(randomSeed());
elements.seed.title = 'World seed';
elements.seed.addEventListener('change', run);
elements.horizon.type = 'checkbox';
elements.horizon.checked = params.get('mode') === 'horizon';
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
elements.shotTime.replaceChildren(...[10, 20, 30, 60].map((seconds) => new Option(`${seconds}s`, String(seconds))));
elements.shotTime.value = params.get('shotTime') ?? '20';
elements.shotTime.title = 'Seconds before a shot fizzles out';
elements.shotTime.addEventListener('change', run);
elements.bounce.type = 'checkbox';
elements.bounce.checked = params.get('bounce') === 'true';
elements.bounce.title = 'Reflect shots off the field edges';
elements.bounce.addEventListener('change', run);
elements.styleBonuses.type = 'checkbox';
elements.styleBonuses.checked = params.has('style') ? params.get('style') === 'true' : true;
elements.styleBonuses.title = 'Include Classic trick-shot multipliers in first-shot point estimates';
elements.styleBonuses.addEventListener('change', () => void run());
elements.grace.replaceChildren(...GRACE.OPTIONS.map((shots) => new Option(shots ? `${shots} shot${shots === 1 ? '' : 's'}` : 'Off', String(shots))));
elements.grace.value = params.get('grace') ?? '0';
elements.grace.title = 'For 4+ ships, opening shots pass through the nearest enemy';
elements.grace.addEventListener('change', () => void run());
elements.ships.title = 'Ships in the world';
elements.ships.replaceChildren(...[2, 3, 4, 5, 6].map((n) => new Option(String(n), String(n))));
elements.ships.value = String(Math.min(6, Math.max(2, Number(params.get('ships')) || 2)));
elements.ships.addEventListener('change', run);
elements.maxPlanets.replaceChildren(...Array.from({ length: 8 }, (_, i) => new Option(String(i + 1), String(i + 1))));
elements.maxPlanets.value = String(Math.min(8, Math.max(1, Number(params.get('planets')) || 4)));
elements.maxPlanets.title = 'Maximum planets in the generated world (same option as match setup)';
elements.maxPlanets.addEventListener('change', () => void run());
elements.teams.replaceChildren(new Option('Free-for-all', '0'), new Option('2 teams', '2'), new Option('3 teams', '3'));
elements.teams.value = params.get('teams') ?? '0';
elements.teams.title = 'Team grouping affects ship placement during world generation';
elements.teams.addEventListener('change', () => void run());
elements.teamSeats.type = 'text';
elements.teamSeats.value = params.get('teamIds') ?? '0, 1, 0, 1, 0, 1';
elements.teamSeats.placeholder = '0, 1, 0, 1';
elements.teamSeats.title = 'Per-ship team IDs in match player order, comma-separated; controls the generated ship arrangement';
elements.teamSeats.addEventListener('change', () => void run());
elements.fixedPower.type = 'checkbox';
elements.fixedPower.checked = params.get('fixed') === 'true';
elements.fixedPower.title = 'Use the same fixed power setting as the game';
elements.fixedPower.addEventListener('change', () => void run());
elements.fixedPowerLevel.type = 'number';
elements.fixedPowerLevel.min = '0';
elements.fixedPowerLevel.max = '100';
elements.fixedPowerLevel.value = params.get('fixedPower') ?? '55';
elements.fixedPowerLevel.title = 'Fixed power level';
elements.fixedPowerLevel.addEventListener('change', () => void run());
elements.maxPower.type = 'number';
elements.maxPower.min = '1';
elements.maxPower.max = '100';
elements.maxPower.value = params.get('maxPower') ?? '100';
elements.maxPower.title = 'Maximum power cap used by the match';
elements.maxPower.addEventListener('change', () => void run());
elements.flights.type = 'number';
elements.flights.value = String(DEFAULT_FLIGHTS);
elements.flights.min = String(MIN_FLIGHTS);
elements.flights.max = String(MAX_FLIGHTS);
elements.flights.step = '150';
elements.flights.title = `Total trajectories (${MIN_FLIGHTS}–${MAX_FLIGHTS})`;
elements.flights.addEventListener('change', run);
elements.minPower.type = 'number';
elements.minPower.value = '0';
elements.minPower.min = '0';
elements.minPower.max = '99';
elements.minPower.title = 'Ignore sampled aims below this power';
elements.minPower.addEventListener('change', run);
elements.shooter.addEventListener('change', () => {
  shooter = Number(elements.shooter.value);
  void run();
});
const requestedShooter = Number(params.get('shooter'));
shooter = Number.isInteger(requestedShooter) ? Math.max(0, Math.min(5, requestedShooter)) : 0;
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
elements.exactAngle.type = 'number';
elements.exactAngle.min = '0';
elements.exactAngle.max = '359.99';
elements.exactAngle.step = '0.01';
elements.exactAngle.value = params.get('angle') ?? '0';
elements.exactPower.type = 'number';
elements.exactPower.min = '0';
elements.exactPower.max = '100';
elements.exactPower.step = '0.1';
  elements.exactPower.value = params.get('aimPower') ?? '50';
elements.exactAim.textContent = 'Test exact aim';
elements.exactAim.className = 'button--quiet';
elements.exactAim.addEventListener('click', testExactAim);
const field = (name: string, control: HTMLElement): HTMLElement => {
  const wrapper = document.createElement('label');
  wrapper.className = 'field';
  const caption = document.createElement('span');
  caption.textContent = name;
  wrapper.append(caption, control);
  return wrapper;
};
const checkField = (text: string, control: HTMLInputElement): HTMLElement => {
  const wrapper = document.createElement('label');
  wrapper.className = 'field field--check';
  wrapper.append(control, document.createTextNode(text));
  return wrapper;
};
bar.append(
  field('World seed', elements.seed),
  field('Ships', elements.ships),
  field('Max planets', elements.maxPlanets),
  field('Team mode', elements.teams),
  field('Team IDs', elements.teamSeats),
  checkField('Fixed power', elements.fixedPower),
  field('Fixed power level', elements.fixedPowerLevel),
  field('Max power', elements.maxPower),
  field('Exact angle (°)', elements.exactAngle),
  field('Exact power', elements.exactPower),
  field('Shooter', elements.shooter),
  field('Shot timeout', elements.shotTime),
  field('Sample count', elements.flights),
  field('Minimum power', elements.minPower),
  field('Event Horizon state', elements.collapses),
  field('First-round grace', elements.grace),
  checkField('Event Horizon', elements.horizon),
  checkField('Reflective edges', elements.bounce),
  checkField('Pay trick-shot bonuses', elements.styleBonuses),
);
const actions = document.createElement('div');
actions.className = 'actions';
elements.reroll.className = 'button--quiet';
elements.run.className = 'button--primary';
elements.png.className = 'button--quiet';
actions.append(elements.run, elements.reroll, elements.png, elements.exactAim, elements.status);
elements.status.className = 'status';
elements.stats.className = 'stats';
elements.outcomeFilters.className = 'outcome-filters';
const filterTitle = document.createElement('span');
filterTitle.className = 'filter-title';
filterTitle.textContent = 'Ignore outcomes:';
elements.outcomeFilters.append(filterTitle);
for (const [kind, labelText] of filterableOutcomes) {
  const labelElement = document.createElement('label');
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.addEventListener('change', () => {
    if (checkbox.checked) excludedOutcomes.add(kind);
    else excludedOutcomes.delete(kind);
    draw(visibleSamples(lastSamples), visibleSamples(lastSamples));
    updateStats(lastSamples);
  });
  const text = document.createElement('span');
  text.textContent = labelText;
  labelElement.append(checkbox, text);
  elements.outcomeFilters.append(labelElement);
}
controlsPanel.append(controlsHead, bar, actions);
const analysis = document.createElement('section');
analysis.className = 'analysis';
analysis.append(elements.outcomeFilters, elements.stats);
const panes = document.createElement('section');
panes.className = 'panes';
const chartPane = document.createElement('div');
chartPane.className = 'pane pane--chart';
const chartHead = document.createElement('div');
chartHead.className = 'pane__head';
const chartTitle = document.createElement('h2');
chartTitle.className = 'pane__title';
chartTitle.textContent = 'Aim outcome map';
const chartMeta = document.createElement('span');
chartMeta.className = 'pane__meta';
chartMeta.textContent = 'ANGLE × POWER';
chartHead.append(chartTitle, chartMeta);
const heatLegend = document.createElement('div');
heatLegend.className = 'heat-legend';
const heatLeft = document.createElement('span');
heatLeft.textContent = 'self-hit / penalty';
const heatRamp = document.createElement('i');
heatRamp.className = 'heat-ramp';
heatRamp.setAttribute('aria-label', 'Red low to mint high estimated points');
const heatRight = document.createElement('span');
heatRight.textContent = 'higher first-shot points';
const heatNote = document.createElement('span');
heatNote.className = 'heat-note';
heatNote.textContent = 'per-cell mean · first shot';
heatLegend.append(heatLeft, heatRamp, heatRight, heatNote);
const aimFrame = document.createElement('div');
aimFrame.className = 'aim-frame';
elements.aimViewport.className = 'aim-viewport';
elements.aimViewport.setAttribute('aria-label', 'Scrollable aim outcome map; use the mouse wheel to zoom and drag to pan');
elements.aimViewport.append(elements.canvas);
const aimTools = document.createElement('div');
aimTools.className = 'aim-tools';
elements.aimZoomOut.type = 'button';
elements.aimZoomOut.textContent = '−';
elements.aimZoomOut.setAttribute('aria-label', 'Zoom aim map out');
elements.aimZoomIn.type = 'button';
elements.aimZoomIn.textContent = '+';
elements.aimZoomIn.setAttribute('aria-label', 'Zoom aim map in');
elements.aimZoomReset.type = 'button';
elements.aimZoomReset.textContent = 'Fit';
elements.aimZoomReset.setAttribute('aria-label', 'Fit aim map to view');
elements.aimZoomLabel.className = 'aim-zoom-label';
const aimHint = document.createElement('span');
aimHint.className = 'aim-tools__hint';
aimHint.textContent = 'Scroll to zoom · drag to pan';
aimTools.append(elements.aimZoomOut, elements.aimZoomLabel, elements.aimZoomIn, elements.aimZoomReset, aimHint);
aimFrame.append(elements.aimViewport);
chartPane.append(chartHead, heatLegend, aimTools, aimFrame, elements.legend);
const mapPane = document.createElement('div');
mapPane.className = 'pane pane--map';
const mapHead = document.createElement('div');
mapHead.className = 'pane__head';
const mapTitle = document.createElement('h2');
mapTitle.className = 'pane__title';
mapTitle.textContent = 'Battlefield replay';
const mapMeta = document.createElement('span');
mapMeta.className = 'pane__meta';
mapMeta.textContent = 'FIELD VIEW';
mapHead.append(mapTitle, mapMeta);
elements.note.className = 'note';
const topShotsPanel = document.createElement('section');
topShotsPanel.className = 'top-shots';
const topShotsTitle = document.createElement('h3');
topShotsTitle.className = 'top-shots__title';
  topShotsTitle.textContent = `Top 5 · ${horizonMode ? 'kill points' : 'first-shot points'}`;
elements.topShots.className = 'top-shots__list';
const topShotsNote = document.createElement('p');
topShotsNote.className = 'top-shots__note';
topShotsNote.textContent = 'Classic uses shot 1 of the round (no repeat-shot penalty); Event Horizon uses kill scoring. Detected trick-shot bonuses are included when enabled. High-five points need another simultaneous shot, so they are not estimated.';
topShotsPanel.append(topShotsTitle, elements.topShots, topShotsNote);
mapPane.append(mapHead, elements.map, elements.note, topShotsPanel);
panes.append(chartPane, mapPane);
app.append(hero, controlsPanel, analysis, panes);
document.body.append(app);
updateAimZoomLabel();

void run();
