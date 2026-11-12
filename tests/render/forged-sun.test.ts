import { beforeEach, describe, expect, it, vi } from 'vitest';
import { image } from '../../src/render/looks/forged-assets';
import { ARCH_LEAVES, ARCH_LIFE, archAt, archOf, drawForgedProminences, drawForgedProminencesFront, drawForgedStormBurst, moteOf } from '../../src/render/looks/forged-sun';
import { drawSun } from '../../src/render/sun';

vi.mock('../../src/render/looks/forged-assets', () => ({ image: vi.fn() }));

function context() {
  const stack: number[] = [];
  const ctx = {
    canvas: { width: 1000, height: 700 },
    globalAlpha: .6,
    globalCompositeOperation: 'source-over',
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 500, f: 350 }),
    save() { stack.push(this.globalAlpha); },
    restore() { this.globalAlpha = stack.pop()!; },
    rotate: vi.fn(), translate: vi.fn(), transform: vi.fn(), drawImage: vi.fn(),
    createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(),
    fillRect: vi.fn(), clip: vi.fn(),
    moveTo: vi.fn(), bezierCurveTo: vi.fn(), stroke: vi.fn(), setLineDash: vi.fn(), closePath: vi.fn(),
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls: ctx };
}


beforeEach(() => {
  vi.mocked(image).mockReturnValue({} as HTMLImageElement);
  // The puff sprites are drawn once on a canvas of their own.
  vi.stubGlobal('document', {
    createElement: () => ({ getContext: () => ({ globalCompositeOperation: '', createRadialGradient: () => ({ addColorStop: () => {} }), fillRect: () => {} }) }),
  });
});

describe('Forged prominences', () => {
  it('rise out of the limb, hang, then lift away and fade without sinking back', () => {
    expect(archAt(0)).toEqual({ lift: 0, glow: 0, away: 0 });
    expect(archAt(.5).lift).toBeLessThan(archAt(1.5).lift);
    expect(archAt(.4).glow).toBeCloseTo(1);
    for (let age = 1.6; age < ARCH_LIFE; age += .2) expect(archAt(age).lift).toBeGreaterThan(.9);
    expect(archAt(ARCH_LIFE - .3).lift).toBeGreaterThan(archAt(4).lift);
    expect(archAt(ARCH_LIFE - .01).glow).toBeLessThan(.01);
    expect(archAt(ARCH_LIFE)).toEqual({ lift: 0, glow: 0, away: 0 });
  });

  it('come back somewhere else on the limb', () => {
    const places = new Set<number>();
    for (let time = 0; time < 200; time += .5) {
      const arch = archOf(1, 0, time, 0);
      if (arch.glow > .5) places.add(Math.round(((arch.from + arch.to) / 2) % (Math.PI * 2) * 10));
    }
    expect(places.size).toBeGreaterThan(5);
  });

  it('break into plasma only once they lift away, which drifts outwards, cools and thins away', () => {
    const motes = (age: number) => Array.from({ length: 48 }, (_, k) => moteOf(1, 0, k, 100, age));
    expect(motes(ARCH_LEAVES).every(m => m === null)).toBe(true);
    expect(motes(ARCH_LEAVES - 2).every(m => m === null)).toBe(true);
    expect(motes(ARCH_LEAVES + 2).filter(Boolean).length).toBeGreaterThan(10);
    expect(motes(ARCH_LEAVES + 7.7).every(m => m === null)).toBe(true);
    for (let k = 0; k < 48; k++) {
      const path = [5.5, 6.5, 7.5, 8.5, 9.5].map(age => moteOf(1, 0, k, 100 + age, age)).filter(m => m !== null);
      if (path.length < 2) continue;
      const first = path[0], last = path[path.length - 1];
      expect(Math.hypot(last.x, last.y)).toBeGreaterThan(Math.hypot(first.x, first.y));
      expect(last.heat).toBeLessThan(first.heat);
      expect(last.size).toBeGreaterThan(first.size * .99);
    }
  });

  it('grow more dramatic towards a red giant: taller, more of them, and more plasma thrown further', () => {
    const tallest = (giant: number) => Math.max(...Array.from({ length: 400 }, (_, n) => archOf(1, 0, n * .1, 0, giant).height));
    expect(tallest(1)).toBeGreaterThan(tallest(0) * 1.5);
    const standing = (giant: number) => Array.from({ length: 5 }, (_, i) => archOf(1, i, 0, 1, giant)).filter(a => a.glow > .5).length;
    expect(standing(0)).toBe(3);
    expect(standing(.5)).toBe(4);
    expect(standing(1)).toBe(5);
    const reach = (giant: number) => Math.max(...Array.from({ length: 48 }, (_, k) => {
      const m = moteOf(1, 0, k, 110, ARCH_LEAVES + 5, giant);
      return m ? Math.hypot(m.x, m.y) : 0;
    }));
    expect(reach(1)).toBeGreaterThan(reach(0) + .2);
    const { ctx, calls } = context();
    drawForgedProminences(ctx, 1, 36, 14, 1, 0);
    const calm = calls.drawImage.mock.calls.length;
    calls.drawImage.mockClear();
    drawForgedProminences(ctx, 1, 36, 14, 1, 1);
    expect(calls.drawImage.mock.calls.length).toBe(calm * 5 / 3);
  });

  it('stand up at full height in a storm, never bright and flat', () => {
    for (let time = 0; time < 60; time += .25) {
      for (let i = 0; i < 3; i++) {
        const arch = archOf(7, i, time, 1);
        expect(arch.glow).toBeGreaterThan(.75);
        expect(arch.height).toBeGreaterThan(.22 * .9);
      }
    }
  });

  it('are puffs behind the ball and keep its opacity, with a knot over the limb for each leg', () => {
    const { ctx, calls } = context();
    expect(drawForgedProminences(ctx, 1, 36, 14, 1, 0)).toBe(true);
    // In a storm all three stand: 25 puffs and 14 knots each, and two threads.
    expect(calls.drawImage).toHaveBeenCalledTimes(3 * (25 + 14));
    expect(calls.stroke).toHaveBeenCalledTimes(3 * 2);
    expect(ctx.globalAlpha).toBe(.6);
    calls.drawImage.mockClear();
    drawForgedProminencesFront(ctx, 1, 36, 14, 1, 0);
    // Two stamps a knot, and two a mote of any arch that is leaving.
    const motes = [0, 1, 2].flatMap(i => Array.from({ length: 48 }, (_, k) => moteOf(1, i, k, 14, archOf(1, i, 14, 1).age))).filter(Boolean).length;
    expect(motes).toBeGreaterThan(0);
    expect(calls.drawImage).toHaveBeenCalledTimes(3 * 2 * 2 + motes * 2);
    expect(calls.createRadialGradient).not.toHaveBeenCalled();
    expect(ctx.globalAlpha).toBe(.6);
  });

  it('skip a sun that is off screen', () => {
    const { ctx, calls } = context();
    calls.getTransform = () => ({ a: 1, b: 0, c: 0, d: 1, e: -5000, f: 350 });
    expect(drawForgedProminences(ctx, 1, 36, 14, 1, 0)).toBe(true);
    drawForgedProminencesFront(ctx, 1, 36, 14, 1, 0);
    expect(calls.stroke).not.toHaveBeenCalled();
    expect(calls.drawImage).not.toHaveBeenCalled();
  });

  it('draws the arches behind the ball and the knots after it', () => {
    const { ctx } = context();
    const layers: string[] = [];
    drawSun(ctx, { x: 500, y: 350, radius: 36, mass: 1, seed: 1, style: 'star', tint: '#fff', sun: true }, 14, 1, 1, {
      corona: () => true,
      prominences: () => { layers.push('back'); return true; },
      surface: () => { layers.push('sphere'); return true; },
      prominencesFront: () => { layers.push('front'); },
    });
    expect(layers).toEqual(['back', 'sphere', 'front']);
  });

  it('draws the storm front in at most two stamps and stops when it has faded', () => {
    const { ctx, calls } = context();
    const sun = { x: 500, y: 350, radius: 36 };
    drawForgedStormBurst(ctx, sun, .4);
    expect(calls.drawImage).toHaveBeenCalledTimes(2);
    expect(calls.createRadialGradient).not.toHaveBeenCalled();
    expect(ctx.globalAlpha).toBe(.6);
    calls.drawImage.mockClear();
    for (const age of [-1, 0, 1.8, 3]) drawForgedStormBurst(ctx, sun, age);
    expect(calls.drawImage).not.toHaveBeenCalled();
  });

  it('keeps the shared storm front until its texture is available', () => {
    const { ctx, calls } = context();
    vi.mocked(image).mockReturnValue(null);
    drawForgedStormBurst(ctx, { x: 500, y: 350, radius: 36 }, .4);
    expect(calls.createRadialGradient).toHaveBeenCalledTimes(2);
    expect(calls.drawImage).not.toHaveBeenCalled();
  });
});
