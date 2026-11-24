import type { World } from '../sim/physics';
import { contourKey, renderContours, type ContourBodies } from './contours';

interface Layer {
  /** The world the frames ask for now, and its version when they last asked. */
  world: World;
  version: number;
  /** Its planets, to know the same field in another World object (a guest gets a new one with every patch of it). */
  seeds: number[];
  key: string;
  ps: number;
  image: HTMLCanvasElement | ImageBitmap;
  /** The map the frames ask for now; it differs from `key` while the worker draws it. */
  want: { key: string; ps: number };
  /** One map in the worker at a time, so a field that changes quickly does not queue up maps nobody will see. */
  pending: boolean;
}

/** What the worker's maps go to, by job; null when the worker failed. */
const jobs = new Map<number, (bitmap: ImageBitmap | null) => void>();
let worker: Worker | null | undefined;
let nextJob = 0;

/** The one worker of the page, started when first asked for; null where there is none or it failed. */
function contourWorker(): Worker | null {
  if (worker !== undefined) return worker;
  worker = null;
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return null;
  try {
    const started = new Worker(new URL('./contours.worker.ts', import.meta.url), { type: 'module' });
    started.onmessage = (e: MessageEvent<{ id: number; bitmap: ImageBitmap }>) => finish(e.data.id, e.data.bitmap);
    // A worker that fails stays off: the maps waiting on it, and every one after, are drawn at once.
    started.onerror = () => {
      started.terminate();
      worker = null;
      for (const id of [...jobs.keys()]) finish(id, null);
    };
    worker = started;
  } catch {
    worker = null;
  }
  return worker;
}

function finish(id: number, bitmap: ImageBitmap | null): void {
  const done = jobs.get(id);
  jobs.delete(id);
  done?.(bitmap);
}

/**
 * The gravity map of the world on screen. A field's first map is drawn at once, so a round starts with its map; when what
 * pulls changes later (a planet broken or turned, a hole grown, a Solar System turned), the new map is drawn in a worker
 * and the old one stays up until it is ready, a few frames later, instead of stalling the frame. While everything moves
 * (a collapse, a Solar System turning) the map stays as it is, but for a change of `world.version`.
 * Without a worker (or OffscreenCanvas) every map is drawn at once.
 */
export class ContourLayers {
  private layer: Layer | null = null;
  private settling: (() => void)[] = [];

  /**
   * The map to draw for `world` at `ps` device pixels per field unit: the current one, or the last one while it is redrawn.
   * `moving`: the bodies are on their way, so a new World object alone (a guest's) is no reason to redraw.
   */
  get(world: World, ps: number, moving = false): HTMLCanvasElement | ImageBitmap {
    const layer = this.layer;
    if (!layer || !sameField(layer, world)) return this.start(world, ps);
    const replaced = layer.world !== world;
    if (world.version !== layer.version || (replaced && !moving)) layer.want.key = contourKey(world);
    if (replaced || world.version !== layer.version) layer.seeds = world.planets.map((p) => p.seed);
    layer.world = world;
    layer.version = world.version;
    layer.want.ps = ps;
    if (layer.pending || (layer.key === layer.want.key && layer.ps === ps)) return layer.image;
    // The bodies as they are now: they may have moved on since the version changed.
    const key = (layer.want.key = contourKey(world));
    const worker = contourWorker();
    if (!worker) {
      replace(layer, key, ps, renderContours(world, ps));
      return layer.image;
    }
    const bodies: ContourBodies = {
      width: world.width,
      height: world.height,
      planets: world.planets.map(({ x, y, radius, mass, reversed, seed, style, tint }) => ({ x, y, radius, mass, reversed, seed, style, tint })),
      holes: world.holes.map(({ x, y, radius, mass }) => ({ x, y, radius, mass })),
    };
    const id = nextJob++;
    layer.pending = true;
    jobs.set(id, (bitmap) => this.receive(layer, key, ps, bitmap));
    worker.postMessage({ id, world: bodies, ps });
    return layer.image;
  }

  /** Whether the worker is drawing the map the next frames will show. */
  get pending(): boolean {
    return this.layer?.pending ?? false;
  }

  /** Resolves when the worker's map is there (or the worker failed), to draw a frame that shows it. */
  settled(): Promise<void> {
    return this.pending ? new Promise((resolve) => this.settling.push(resolve)) : Promise.resolve();
  }

  /** Forgets the map (the canvas was resized): the next one is drawn at once. */
  clear(): void {
    this.layer = null;
    this.settle();
  }

  private start(world: World, ps: number): HTMLCanvasElement | ImageBitmap {
    // Started with the first map, so it is ready by the time a planet breaks.
    contourWorker();
    const key = contourKey(world);
    const image = renderContours(world, ps);
    this.layer = { world, version: world.version, seeds: world.planets.map((p) => p.seed), key, ps, image, want: { key, ps }, pending: false };
    this.settle();
    return image;
  }

  /** A map back from the worker. It goes up unless the frames have come back round to the one already shown; if they have moved on again, the next frame asks for theirs. */
  private receive(layer: Layer, key: string, ps: number, bitmap: ImageBitmap | null): void {
    layer.pending = false;
    if (layer !== this.layer) {
      bitmap?.close();
      return;
    }
    if (bitmap) {
      if (layer.want.key === layer.key && layer.want.ps === layer.ps) bitmap.close();
      else replace(layer, key, ps, bitmap);
    }
    this.settle();
  }

  private settle(): void {
    for (const resolve of this.settling.splice(0)) resolve();
  }
}

/** Whether `world` is the layer's field later on: the same object, or a copy with a planet of it that has not been set back. */
function sameField(layer: Layer, world: World): boolean {
  if (world === layer.world) return true;
  return world.version >= layer.version && world.planets.some((p) => layer.seeds.includes(p.seed));
}

function replace(layer: Layer, key: string, ps: number, image: HTMLCanvasElement | ImageBitmap): void {
  if (typeof ImageBitmap !== 'undefined' && layer.image instanceof ImageBitmap) layer.image.close();
  layer.key = key;
  layer.ps = ps;
  layer.image = image;
}
