// The page half of `explosion.ts`, loaded into a dev page by the runner: what a planet breaking costs, measured with the
// game's own code: the contour map as the game keeps it, and the debris' physics and drawing in every look.
import { generateWorld } from '../../src/sim/world';
import { FIELD } from '../../src/sim/config';
import type { World } from '../../src/sim/physics';
import { contourKey, renderContours } from '../../src/render/contours';
import { ContourLayers } from '../../src/render/contour-layers';
import { Effects } from '../../src/render/effects';
import { painterFor } from '../../src/render/looks';


const out: Record<string, unknown> = {};
const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const p95 = (a: number[]) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * 0.95))];
const frame = () => new Promise<number>((r) => requestAnimationFrame(r));

function worlds(): World[] {
  const list: World[] = [];
  for (let seed = 1; list.length < 8; seed++) {
    const w = generateWorld(seed * 7919, { players: 4, maxPlanets: 7, minPlanets: 6, blackHole: seed % 2 === 0 });
    list.push(w);
  }
  return list;
}

// ———————————— 1. Contours: the synchronous rebuild ————————————
function contourSync(ws: World[], ps: number): number[] {
  const times: number[] = [];
  for (let r = 0; r < 4; r++) for (const w of ws) {
    const t = performance.now();
    const c = renderContours(w, ps);
    c.getContext('2d')!.getImageData(0, 0, 1, 1); // make the stroke really happen
    times.push(performance.now() - t);
  }
  return times;
}

// ———————————— 2. Cache key: rebuilds an Unstable round asks for vs what it needs ————————————
function cacheKeyCost(ws: World[]): number[] {
  const times: number[] = [];
  for (let r = 0; r < 200; r++) for (const w of ws) {
    const t = performance.now();
    contourKey(w);
    times.push(performance.now() - t);
  }
  return times;
}

// ———————————— 3. The game's ContourLayers: a crack, then a planet broken ————————————
async function contourLayers(ws: World[], ps: number) {
  const layers = new ContourLayers();
  const crack: number[] = [];
  const brk: number[] = [];
  const latency: number[] = [];
  const maxFrame: number[] = [];
  // The first round warms the worker up (its module loads); it is not counted.
  for (let r = -1; r < 4; r++) for (const w of ws) {
    const world = { ...w, planets: w.planets.map((p) => ({ ...p })), holes: w.holes.map((h) => ({ ...h })) } as World;
    const first = layers.get(world, ps);
    // An Unstable crack: the world's version goes up, what pulls stays.
    (world.planets[0].fractures ??= []).push(1);
    world.version++;
    let t = performance.now();
    layers.get(world, ps);
    const crackMs = performance.now() - t;
    // The planet breaks.
    world.planets.splice(0, 1);
    world.version++;
    await frame();
    const start = performance.now();
    t = performance.now();
    let image = layers.get(world, ps);
    const breakMs = performance.now() - t;
    let worst = 0;
    let last = performance.now();
    while (image === first) {
      const now = await frame();
      worst = Math.max(worst, now - last);
      last = now;
      image = layers.get(world, ps);
    }
    if (r < 0) continue;
    crack.push(crackMs);
    brk.push(breakMs);
    latency.push(performance.now() - start);
    maxFrame.push(worst);
  }
  return { crack, brk, latency, maxFrame };
}

// ———————————— 4. Debris: the real update and draw ————————————
/** A field of debris as two shatters leave it, a second into the blast (so sparks have spread and started to orbit). */
function explode(world: World): Effects {
  const fx = new Effects(true, true, 'medium');
  const [a, b] = world.planets;
  fx.shatter(a.x, a.y, a.tint, a.radius);
  fx.shatter(b.x, b.y, b.tint, b.radius);
  return fx;
}

function sparkUpdate(ws: World[], dt: number) {
  const times: number[] = [];
  const counts: number[] = [];
  for (const w of ws) {
    const world = { ...w, planets: w.planets.slice(2) } as World;
    const fx = explode(w);
    for (let f = 0; f < 120; f++) {
      counts.push((fx as unknown as { sparks: unknown[] }).sparks.length);
      const t = performance.now();
      fx.update(dt, world);
      times.push(performance.now() - t);
    }
  }
  return { times, counts };
}

function sparkDraw(ws: World[], ps: number, from = 30, to = 90) {
  const canvas = document.createElement('canvas');
  canvas.width = FIELD.width * ps;
  canvas.height = FIELD.height * ps;
  const ctx = canvas.getContext('2d')!;
  const res: Record<string, number[]> = {};
  for (const look of ['classic', 'forged', 'holo'] as const) {
    const style = painterFor(look).effects;
    const times: number[] = [];
    for (const w of ws.slice(0, 4)) {
      const world = { ...w, planets: w.planets.slice(2) } as World;
      const fx = explode(w);
      for (let f = 0; f < to; f++) {
        fx.update(1 / 60, world);
        if (f < from || f >= to) continue;
        ctx.setTransform(ps, 0, 0, ps, 0, 0);
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, FIELD.width, FIELD.height);
        const t = performance.now();
        fx.draw(ctx, style, 1);
        ctx.getImageData(0, 0, 1, 1);
        times.push(performance.now() - t);
      }
    }
    res[look] = times;
  }
  return res;
}

export async function run(): Promise<Record<string, unknown>> {
  const ws = worlds();
  const summary = (a: number[]) => ({ median: +median(a).toFixed(2), p95: +p95(a).toFixed(2), max: +Math.max(...a).toFixed(2) });
  contourSync(ws, 1); // warm up
  for (const ps of [1, 2, 3]) {
    out[`contour.sync.ps${ps}`] = summary(contourSync(ws, ps));
    const game = await contourLayers(ws, ps);
    out[`contour.game.ps${ps}`] = { crack: summary(game.crack), break: summary(game.brk), newMapAfter: summary(game.latency), worstFrameWhileWaiting: summary(game.maxFrame) };
  }
  out['contour.cacheKey'] = summary(cacheKeyCost(ws));
  sparkUpdate(ws, 1 / 60); // warm up
  for (const dt of [1 / 60, 1 / 30]) {
    const r = sparkUpdate(ws, dt);
    out[`sparks.update.dt${Math.round(1 / dt)}`] = { sparks: summary(r.counts), update: summary(r.times) };
  }
  sparkDraw(ws, 1);
  for (const ps of [1, 2]) {
    const d = sparkDraw(ws, ps);
    for (const k in d) out[`sparks.draw.${k}.ps${ps}`] = summary(d[k]);
    const blast = sparkDraw(ws, ps, 0, 30);
    for (const k in blast) out[`blast.draw.${k}.ps${ps}`] = summary(blast[k]);
  }
  const spawn: number[] = [];
  for (let r = 0; r < 10; r++) for (const w of ws) { const t = performance.now(); explode(w); spawn.push((performance.now() - t) / 2); }
  out['sparks.spawnPerShatter'] = summary(spawn);
  return out;
}
