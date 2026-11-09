import { afterEach, describe, expect, it, vi } from 'vitest';
import { Renderer } from '../../src/render/renderer';

afterEach(() => vi.unstubAllGlobals());

describe('canvas resolution', () => {
  it.each([1, 1.25, 2, 3, 4])('renders at the display density of %s', (dpr) => {
    vi.stubGlobal('window', {
      devicePixelRatio: dpr,
      matchMedia: () => ({ matches: true }),
    });
    const canvas = {
      width: 0, height: 0, style: {}, getContext: () => ({}),
    } as unknown as HTMLCanvasElement;
    // A fixed turn avoids page layout; backing pixels still follow the real renderer's resize path.
    const renderer = new Renderer(canvas, () => ({ width: 430, height: 932, rotated: false }));
    expect([canvas.width, canvas.height]).toEqual([Math.round(430 * dpr), Math.round(932 * dpr)]);
    expect(renderer.view.dpr).toBe(dpr);
    expect(canvas.style).toEqual({ width: '430px', height: '932px' });
  });

  it('lays the field out again when the pointer changes without the window resizing', () => {
    let coarse = false;
    vi.stubGlobal('window', {
      devicePixelRatio: 2,
      matchMedia: () => ({ matches: coarse }),
    });
    const canvas = {
      width: 0, height: 0, style: {}, getContext: () => ({}),
    } as unknown as HTMLCanvasElement;
    const renderer = new Renderer(canvas, () => ({ width: 430, height: 932, rotated: false }));
    const first = renderer.view;
    const check = () => (renderer as unknown as { resizeIfNeeded(): void }).resizeIfNeeded();
    check();
    expect(renderer.view).toBe(first);
    coarse = true;
    check();
    expect(renderer.view).not.toBe(first);
    const second = renderer.view;
    check();
    expect(renderer.view).toBe(second);
  });
});
