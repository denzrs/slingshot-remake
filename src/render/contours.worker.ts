import { paintContours, type ContourBodies } from './contours';

/** Draws a gravity map off the main thread (`contour-layers.ts`) and hands it back as a bitmap. */
self.onmessage = (e: MessageEvent<{ id: number; world: ContourBodies; ps: number }>) => {
  const { id, world, ps } = e.data;
  const canvas = new OffscreenCanvas(1, 1);
  paintContours(canvas, world, ps);
  const bitmap = canvas.transferToImageBitmap();
  (self as unknown as Worker).postMessage({ id, bitmap }, [bitmap]);
};
