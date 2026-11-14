import { beforeEach, describe, expect, it, vi } from 'vitest';
import { shadeKept, place } from '../../src/render/looks/forged-gl';
import { drawNeutronStar } from '../../src/render/sun';
import { drawForgedNeutronStar, pulsarBeams } from '../../src/render/looks/forged-remnant';
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
    save: vi.fn(), restore: vi.fn(), translate: vi.fn(), rotate: vi.fn(),
    createLinearGradient: vi.fn(gradient), createRadialGradient: vi.fn(gradient),
    beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(), arc: vi.fn(), fill: vi.fn(), fillRect: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
}

const star: Planet = { x: 500, y: 350, radius: 6, mass: 1, seed: 9, style: 'star', tint: '#fff', sun: true, neutron: true };

beforeEach(() => vi.clearAllMocks());

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
    // The pulsar's two beams sweep round it (a soft cone and a core each), besides the two lines of the star's cross.
    expect(ctx.createLinearGradient).toHaveBeenCalledTimes(2 * 2 + 2);
    expect(ctx.rotate).toHaveBeenCalledTimes(4);
  });

  it('sweeps its beams in depth: opposite each other, foreshortened as they swing towards or away from us', () => {
    const lengths: number[] = [];
    for (let time = 0; time < 3; time += .05) {
      const [a, b] = pulsarBeams(9, time);
      expect(Math.hypot(...a)).toBeCloseTo(1);
      a.forEach((x, k) => expect(b[k]).toBeCloseTo(-x));
      lengths.push(Math.hypot(a[0], a[1]));
    }
    // Not a flat spinning bar: how long a beam looks on the screen changes as it turns.
    expect(Math.max(...lengths) - Math.min(...lengths)).toBeGreaterThan(.3);
  });

  it('turns the pulsar beams with time', () => {
    vi.mocked(shadeKept).mockReturnValue({ canvas: {} as HTMLCanvasElement, w: 512, h: 512 });
    const beams = (time: number) => {
      const ctx = context();
      drawForgedNeutronStar(ctx, star, time, 40, 1);
      return vi.mocked(ctx.rotate).mock.calls[0][0];
    };
    expect(beams(40.2)).not.toBeCloseTo(beams(40));
  });

  it('leaves it to the shared remnant when there are no shaders', () => {
    vi.mocked(shadeKept).mockReturnValue(null);
    const ctx = context();
    drawForgedNeutronStar(ctx, star, 40, 40, 1);
    expect(drawNeutronStar).toHaveBeenCalledWith(ctx, star, 40, 40, 1);
    expect(place).not.toHaveBeenCalled();
  });
});
