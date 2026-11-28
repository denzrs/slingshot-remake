/**
 * Sprites for the small things drawn many times a frame (escape pods, the stands' UFOs): what stays the same from frame
 * to frame is drawn once into a canvas and stamped with one `drawImage`, and only what moves is drawn live.
 */

/** A sprite `half` units each way of its middle, `px` pixels to a unit; `draw` paints it in those units, centred on 0. */
export interface SpriteSpec {
  half: number;
  px: number;
}

/**
 * The sprite under `key` in `cache`, drawn by `draw` the first time it is asked for; null where there is no document to
 * draw one in (tests), and then the caller draws as it did. A cache that grows past `limit` starts over.
 */
export function cachedSprite(cache: Map<string, HTMLCanvasElement | null>, key: string, spec: SpriteSpec, draw: (ctx: CanvasRenderingContext2D) => void, limit = 96): HTMLCanvasElement | null {
  const known = cache.get(key);
  if (known !== undefined) return known;
  let sprite: HTMLCanvasElement | null = null;
  if (typeof document !== 'undefined') {
    const size = Math.ceil(spec.half * 2 * spec.px);
    sprite = Object.assign(document.createElement('canvas'), { width: size, height: size });
    const c = sprite.getContext('2d');
    if (c) {
      c.setTransform(spec.px, 0, 0, spec.px, size / 2, size / 2);
      draw(c);
    } else sprite = null;
  }
  if (cache.size >= limit) cache.clear();
  cache.set(key, sprite);
  return sprite;
}

/** Stamps a sprite made with `spec` centred on the current frame's origin. */
export function stamp(ctx: CanvasRenderingContext2D, sprite: HTMLCanvasElement, spec: SpriteSpec): void {
  ctx.drawImage(sprite, -spec.half, -spec.half, spec.half * 2, spec.half * 2);
}
