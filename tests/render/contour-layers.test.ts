import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { World } from '../../src/sim/physics';
import { generateWorld } from '../../src/sim/world';

vi.mock('../../src/render/contours', async (original) => ({
  ...(await original<typeof import('../../src/render/contours')>()),
  renderContours: vi.fn(() => ({ drawn: 'at once' })),
}));

class FakeWorker {
  static all: FakeWorker[] = [];
  jobs: { id: number }[] = [];
  onmessage: ((e: { data: { id: number; bitmap: unknown } }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    FakeWorker.all.push(this);
  }
  postMessage(job: { id: number }): void {
    this.jobs.push(job);
  }
  terminate(): void {}
  answer(): unknown {
    const bitmap = { drawn: 'in the worker', close: vi.fn() };
    this.onmessage!({ data: { id: this.jobs.at(-1)!.id, bitmap } });
    return bitmap;
  }
}

async function load(withWorker = true) {
  vi.stubGlobal('Worker', withWorker ? FakeWorker : undefined);
  vi.stubGlobal('OffscreenCanvas', withWorker ? class {} : undefined);
  const { ContourLayers } = await import('../../src/render/contour-layers');
  const { renderContours } = await import('../../src/render/contours');
  const drawnAtOnce = vi.mocked(renderContours);
  drawnAtOnce.mockClear();
  return { ContourLayers, drawnAtOnce };
}

const field = (seed = 4242): World => generateWorld(seed, { players: 2, maxPlanets: 5, minPlanets: 4, blackHole: true });
const breakPlanet = (world: World): void => {
  world.planets.splice(1, 1);
  world.version++;
};

beforeEach(() => {
  vi.resetModules();
  FakeWorker.all = [];
});
afterEach(() => vi.unstubAllGlobals());

describe('ContourLayers', () => {
  it('draws a first map at once, and a later one in the worker while the old one stays up', async () => {
    const { ContourLayers, drawnAtOnce } = await load();
    const layers = new ContourLayers();
    const world = field();
    const first = layers.get(world, 1);
    breakPlanet(world);
    expect(layers.get(world, 1)).toBe(first);
    const settled = layers.settled();
    const bitmap = FakeWorker.all[0].answer();
    await settled;
    expect(layers.get(world, 1)).toBe(bitmap);
    expect(drawnAtOnce).toHaveBeenCalledTimes(1);
    expect(FakeWorker.all[0].jobs).toHaveLength(1);
  });

  it.each([true, false])('leaves the map while the bodies move, until the version changes (worker: %s)', async (withWorker) => {
    const { ContourLayers, drawnAtOnce } = await load(withWorker);
    const layers = new ContourLayers();
    const world = field();
    layers.get(world, 1, true);
    for (let i = 0; i < 10; i++) {
      world.planets[0].x += 3;
      layers.get(world, 1, true);
    }
    const redrawn = () => drawnAtOnce.mock.calls.length - 1 + (FakeWorker.all[0]?.jobs.length ?? 0);
    expect(redrawn()).toBe(0);
    world.version++;
    layers.get(world, 1);
    expect(redrawn()).toBe(1);
  });

  it("keeps a guest's map across its new World objects", async () => {
    const { ContourLayers, drawnAtOnce } = await load();
    const layers = new ContourLayers();
    let world = field();
    const first = layers.get(world, 1);
    // A patch that leaves what pulls alone, then one with a crack: nothing to redraw.
    world = structuredClone(world);
    expect(layers.get(world, 1)).toBe(first);
    world = structuredClone(world);
    (world.planets[0].fractures ??= []).push(1);
    world.version++;
    layers.get(world, 1);
    expect(FakeWorker.all[0].jobs).toHaveLength(0);
    // Patches while the system turns: the map stays.
    world = structuredClone(world);
    world.planets[0].x += 3;
    layers.get(world, 1, true);
    expect(FakeWorker.all[0].jobs).toHaveLength(0);
    // A planet broken: the worker's.
    world = structuredClone(world);
    breakPlanet(world);
    layers.get(world, 1);
    expect(FakeWorker.all[0].jobs).toHaveLength(1);
    expect(drawnAtOnce).toHaveBeenCalledTimes(1);
  });

  it('draws the map of a new round, and of a field set back to its start, at once', async () => {
    const { ContourLayers, drawnAtOnce } = await load();
    const layers = new ContourLayers();
    const world = field();
    layers.get(world, 1);
    breakPlanet(world);
    layers.get(world, 1);
    layers.get(field(), 1);
    layers.get(field(99), 1);
    expect(drawnAtOnce).toHaveBeenCalledTimes(3);
    // The map of the field that is gone does not go up any more.
    FakeWorker.all[0].answer();
    expect(layers.pending).toBe(false);
  });

  it('shares one worker, and draws at once when it fails', async () => {
    const { ContourLayers, drawnAtOnce } = await load();
    const [a, b] = [new ContourLayers(), new ContourLayers()];
    const world = field();
    a.get(world, 1);
    b.get(world, 1);
    expect(FakeWorker.all).toHaveLength(1);
    breakPlanet(world);
    a.get(world, 1);
    const settled = a.settled();
    FakeWorker.all[0].onerror!();
    await settled;
    a.get(world, 1);
    b.get(world, 1);
    expect(drawnAtOnce).toHaveBeenCalledTimes(4);
    expect(FakeWorker.all).toHaveLength(1);
  });
});
