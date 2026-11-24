import type { World } from '../sim/physics';
import { contourKey, renderContours, type ContourBodies } from './contours';

interface Layer {
  key: string;
  ps: number;
  image: HTMLCanvasElement | ImageBitmap;
  /** The map the frames ask for now; it differs from `key` while the worker draws it. */
  want: { key: string; ps: number };
  /** The map in the worker: one at a time, so a field that changes every frame (a Solar System turning) does not queue up maps nobody will see. */
  pending: { id: number; key: string; ps: number } | null;
}

/**
 * The gravity map of each world (live or killcam replay). A world's first map is drawn at once, so a round starts with
 * its map; when what pulls changes later (a planet broken or turned, a hole growing, a Solar System turning), the new
 * map is drawn in a worker and the old one stays up until it is ready, a few frames later, instead of stalling the frame.
 * Without a worker (or OffscreenCanvas) every map is drawn at once.
 */
export class ContourLayers {
  private layers = new WeakMap<World, Layer>();
  private readonly waiting = new Map<number, Layer>();
  private worker: Worker | null | undefined;
  private nextId = 0;

  /** The map to draw for `world` at `ps` device pixels per field unit: the current one, or the last one while it is redrawn. */
  get(world: World, ps: number): HTMLCanvasElement | ImageBitmap {
    const key = contourKey(world);
    const layer = this.layers.get(world);
    if (!layer) {
      const image = renderContours(world, ps);
      this.layers.set(world, { key, ps, image, want: { key, ps }, pending: null });
      return image;
    }
    layer.want = { key, ps };
    if ((layer.key === key && layer.ps === ps) || layer.pending) return layer.image;
    const worker = this.ensureWorker();
    if (!worker) {
      this.replace(layer, key, ps, renderContours(world, ps));
      return layer.image;
    }
    const id = this.nextId++;
    layer.pending = { id, key, ps };
    this.waiting.set(id, layer);
    const bodies: ContourBodies = {
      width: world.width,
      height: world.height,
      planets: world.planets.map(({ x, y, radius, mass, reversed, seed, style, tint }) => ({ x, y, radius, mass, reversed, seed, style, tint })),
      holes: world.holes.map(({ x, y, radius, mass }) => ({ x, y, radius, mass })),
    };
    worker.postMessage({ id, world: bodies, ps });
    return layer.image;
  }

  /** Forgets every map (the canvas was resized): the next ones are drawn at once. */
  clear(): void {
    this.layers = new WeakMap();
    for (const layer of this.waiting.values()) layer.pending = null;
    this.waiting.clear();
  }

  private ensureWorker(): Worker | null {
    if (this.worker !== undefined) return this.worker;
    this.worker = null;
    if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return null;
    try {
      const worker = new Worker(new URL('./contours.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent<{ id: number; bitmap: ImageBitmap }>) => this.receive(e.data.id, e.data.bitmap);
      // A worker that fails stays off: the maps waiting on it, and every one after, are drawn at once.
      worker.onerror = () => {
        worker.terminate();
        this.worker = null;
        for (const layer of this.waiting.values()) layer.pending = null;
        this.waiting.clear();
      };
      this.worker = worker;
    } catch {
      this.worker = null;
    }
    return this.worker;
  }

  /** A map back from the worker. It goes up unless the frames have come back round to the one already shown; if they have moved on again, the next frame asks for theirs. */
  private receive(id: number, bitmap: ImageBitmap): void {
    const layer = this.waiting.get(id);
    this.waiting.delete(id);
    const pending = layer?.pending;
    if (!layer || pending?.id !== id) {
      bitmap.close();
      return;
    }
    layer.pending = null;
    if (layer.want.key === layer.key && layer.want.ps === layer.ps) bitmap.close();
    else this.replace(layer, pending.key, pending.ps, bitmap);
  }

  private replace(layer: Layer, key: string, ps: number, image: HTMLCanvasElement | ImageBitmap): void {
    if (typeof ImageBitmap !== 'undefined' && layer.image instanceof ImageBitmap) layer.image.close();
    layer.key = key;
    layer.ps = ps;
    layer.image = image;
  }
}
