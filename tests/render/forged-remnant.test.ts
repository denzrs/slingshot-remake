import { beforeEach, describe, expect, it, vi } from 'vitest';
import { shadeKept, place } from '../../src/render/looks/forged-gl';
import { drawNeutronStar } from '../../src/render/sun';
import { drawForgedNeutronStar, pulsarBeams, pulsarDazzle } from '../../src/render/looks/forged-remnant';
import type { Planet } from '../../src/sim/physics';

vi.mock('../../src/render/looks/forged-gl', async (actual) => ({
  ...(await actual<typeof import('../../src/render/looks/forged-gl')>()),
  shadeKept: vi.fn(),
  place: vi.fn(),
}));
vi.mock('../../src/render/sun', async (actual) => ({
  ...(await actual<typeof import('../../src/render/sun')>()),
  drawNeutronStar: vi.fn(),
}));

function context() {
  const gradient = () => ({ addColorStop: vi.fn() });
  return {
    canvas: { width: 1000, height: 700 },
    globalAlpha: .6,
    globalCompositeOperation: 'source-over',
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    save: vi.fn(), restore: vi.fn(), translate: vi.fn(), rotate: vi.fn(), scale: vi.fn(), drawImage: vi.fn(),
    createLinearGradient: vi.fn(gradient), createRadialGradient: vi.fn(gradient),
    beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(), arc: vi.fn(), fill: vi.fn(), fillRect: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
}

const star: Planet = { x: 500, y: 350, radius: 6, mass: 1, seed: 9, style: 'star', tint: '#fff', sun: true, neutron: true };

beforeEach(() => {
  vi.clearAllMocks();
  // The beam's picture is painted once on a canvas of its own.
  vi.stubGlobal('document', {
    createElement: () => ({ width: 0, height: 0, getContext: () => ({ createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData: vi.fn() }) }),
  });
});

describe('Forged supernova remnant', () => {
  it('paints its own shaded remnant, as big as the shared one, with the star over it', () => {
    vi.mocked(shadeKept).mockReturnValue({ canvas: {} as HTMLCanvasElement, w: 512, h: 512 });
    const ctx = context();
    drawForgedNeutronStar(ctx, star, 40, 40, 1);
    expect(drawNeutronStar).not.toHaveBeenCalled();
    expect(place).toHaveBeenCalledTimes(1);
    // Grown out: the shared remnant's reach.
    expect(vi.mocked(place).mock.calls[0][4]).toBeGreaterThan(270 * 2 * .97);
    expect(vi.mocked(place).mock.calls[0][4]).toBeLessThan(270 * 2 * 1.03);
    // The pulsar's two beams are one stamp each of the beam's picture; the only gradients drawn as lines are the star's cross.
    expect(ctx.drawImage).toHaveBeenCalledTimes(2);
    expect(ctx.createLinearGradient).toHaveBeenCalledTimes(2);
  });

  it('turns its beams like a lighthouse seen from the side: shortening as one swings to us, then out the other side', () => {
    const across: number[] = [];
    for (let time = 40; time < 44; time += .05) {
      const [a, b] = pulsarBeams(9, time);
      // Opposite each other, one turned to us as the other turns away.
      expect(b.across).toBeCloseTo(-a.across);
      expect(b.z).toBeCloseTo(-a.z);
      across.push(a.across);
    }
    // A beam reaches out to one side, shortens to nothing as it points at us or away, and reaches out to the other.
    expect(Math.max(...across)).toBeGreaterThan(.95);
    expect(Math.min(...across)).toBeLessThan(-.95);
    expect(Math.min(...across.map(Math.abs))).toBeLessThan(.1);
  });

  it('dazzles as a beam points at us, swelling and ebbing softly rather than flashing', () => {
    // Half a turn: one beam or the other points at us once.
    const half = Math.PI / 1.6;
    const step = 1 / 60;
    const dazzle = Array.from({ length: Math.round(half / step) }, (_, n) => pulsarDazzle(9, 40 + n * step));
    expect(Math.max(...dazzle)).toBeGreaterThan(.99);
    const rises = dazzle.filter((d, n) => d > .5 && (n === 0 || dazzle[n - 1] <= .5)).length;
    expect(rises).toBeGreaterThanOrEqual(1);
    expect(rises).toBeLessThanOrEqual(2);
    expect(dazzle.filter(d => d < .05).length).toBeGreaterThan(dazzle.length * .4);
    // It lasts a moment, not a frame, and never jumps much from frame to frame.
    expect(dazzle.filter(d => d > .5).length * step).toBeGreaterThan(.25);
    for (let n = 1; n < dazzle.length; n++) expect(Math.abs(dazzle[n] - dazzle[n - 1])).toBeLessThan(.1);
  });

  it('paints the beam ahead of time without failing when the document is gone by then', async () => {
    // A fresh module, with no beam painted yet.
    vi.resetModules();
    const { warmPulsarBeam: warm } = await import('../../src/render/looks/forged-remnant');
    vi.useFakeTimers();
    try {
      vi.stubGlobal('requestIdleCallback', undefined);
      warm();
      vi.unstubAllGlobals();
      expect(() => vi.runAllTimers()).not.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves it to the shared remnant when there are no shaders', () => {
    vi.mocked(shadeKept).mockReturnValue(null);
    const ctx = context();
    drawForgedNeutronStar(ctx, star, 40, 40, 1);
    expect(drawNeutronStar).toHaveBeenCalledWith(ctx, star, 40, 40, 1);
    expect(place).not.toHaveBeenCalled();
  });
});
