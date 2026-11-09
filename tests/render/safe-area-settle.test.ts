import { afterEach, describe, expect, it, vi } from 'vitest';

/** What the page's safe area reads right now: the test moves it the way iOS does. */
const page = { top: 0, bottom: 34 };

vi.mock('../../src/render/layout', async (original) => ({
  ...(await original<typeof import('../../src/render/layout')>()),
  safeArea: () => ({ ...page }),
  touchScale: () => 1,
  applyUpright: () => undefined,
}));

const { Renderer } = await import('../../src/render/renderer');

afterEach(() => vi.unstubAllGlobals());

describe('the phone layout and a safe area that settles late', () => {
  it('is made again when the top inset changes under a window that keeps its size', () => {
    vi.stubGlobal('window', { devicePixelRatio: 3, matchMedia: () => ({ matches: true }) });
    const canvas = { width: 0, height: 0, style: {}, getContext: () => ({}) } as unknown as HTMLCanvasElement;
    let size = { width: 402, height: 812 };
    page.top = 0;
    const renderer = new Renderer(canvas, () => size);
    const check = () => (renderer as unknown as { resizeIfNeeded(): void }).resizeIfNeeded();
    const top = () => renderer.view.stage!.y;
    expect(top()).toBe(12);

    // A phone turned to landscape and back, in the home-screen app (see `layoutInputs`): the window is as tall as the screen
    // with the inset at the status bar, then 62 px shorter with the inset still there, and then the inset drops to 0.
    page.top = 62;
    size = { width: 402, height: 874 };
    check();
    size = { width: 402, height: 812 };
    check();
    expect(top()).toBe(62);

    page.top = 0;
    check();
    expect(top()).toBe(12);

    // And it stays put once nothing changes.
    const settled = renderer.view;
    check();
    expect(renderer.view).toBe(settled);
  });
});

describe('a page that iOS left scrolled after a turn', () => {
  const canvas = () => ({ width: 0, height: 0, style: {}, getContext: () => ({}) }) as unknown as HTMLCanvasElement;

  it('is put back at the top, so the pause button is where it is drawn', () => {
    const scrollTo = vi.fn();
    vi.stubGlobal('window', {
      devicePixelRatio: 3, matchMedia: () => ({ matches: true }), scrollX: 0, scrollY: 62, visualViewport: { offsetTop: 62 }, scrollTo,
      innerWidth: 402, innerHeight: 812,
    });
    const renderer = new Renderer(canvas());
    (renderer as unknown as { resizeIfNeeded(): void }).resizeIfNeeded();
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it('is left alone when it is not scrolled, and when the renderer draws into a box of its own', () => {
    const scrollTo = vi.fn();
    vi.stubGlobal('window', {
      devicePixelRatio: 3, matchMedia: () => ({ matches: true }), scrollX: 0, scrollY: 0, visualViewport: { offsetTop: 0 }, scrollTo,
      innerWidth: 402, innerHeight: 812,
    });
    (new Renderer(canvas()) as unknown as { resizeIfNeeded(): void }).resizeIfNeeded();
    vi.stubGlobal('window', { devicePixelRatio: 3, matchMedia: () => ({ matches: true }), scrollX: 0, scrollY: 300, visualViewport: { offsetTop: 300 }, scrollTo });
    (new Renderer(canvas(), () => ({ width: 402, height: 812, rotated: false })) as unknown as { resizeIfNeeded(): void }).resizeIfNeeded();
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
