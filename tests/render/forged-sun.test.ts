import { beforeEach, describe, expect, it, vi } from 'vitest';
import { image } from '../../src/render/looks/forged-assets';
import { DISSOLVES, ERUPTS, archAt, archOf, drawForgedProminences, drawForgedProminencesFront, drawForgedStormBurst, moteOf } from '../../src/render/looks/forged-sun';
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


/** A canvas the prominences make for themselves (a puff sprite, a layer of soft light), recording what is painted on it. */
function layerContext() {
  return {
    globalAlpha: 1, globalCompositeOperation: '', lineCap: '', strokeStyle: '', lineWidth: 0,
    setTransform: vi.fn(), clearRect: vi.fn(), drawImage: vi.fn(), fillRect: vi.fn(),
    createRadialGradient: () => ({ addColorStop: () => {} }),
    beginPath: vi.fn(), moveTo: vi.fn(), bezierCurveTo: vi.fn(), stroke: vi.fn(),
  };
}
type Painted = ReturnType<typeof layerContext>;

/** What was painted on the canvas the `n`th stamp on `ctx` laid down. */
const paintedOn = (calls: { drawImage: { mock: { calls: unknown[][] } } }, n = 0): Painted =>
  (calls.drawImage.mock.calls[n][0] as { getContext(): Painted }).getContext();

beforeEach(() => {
  vi.mocked(image).mockReturnValue({} as HTMLImageElement);
  vi.stubGlobal('document', {
    createElement: () => {
      const painted = layerContext();
      return { width: 0, height: 0, getContext: () => painted };
    },
  });
});

describe('Forged prominences', () => {
  it('rise out of the limb, hang, then thin away without sinking back', () => {
    const { life } = DISSOLVES;
    expect(archAt(0)).toEqual({ lift: 0, glow: 0, away: 0 });
    expect(archAt(.5).lift).toBeLessThan(archAt(1.5).lift);
    expect(archAt(.4).glow).toBeCloseTo(1);
    for (let age = 1.6; age < life; age += .2) expect(archAt(age).lift).toBeGreaterThan(.9);
    expect(archAt(life - .3).lift).toBeGreaterThan(archAt(3).lift);
    expect(archAt(life - .01).glow).toBeLessThan(.01);
    expect(archAt(life)).toEqual({ lift: 0, glow: 0, away: 0 });
  });

  it('never stand a while and then blow up, nor come up and pop: an eruption is one motion, a slow arch only dissolves', () => {
    // An eruption is already going while it still rises, carried out and fraying as it goes.
    expect(ERUPTS.leaves).toBeLessThan(ERUPTS.rise);
    expect(ERUPTS.flung).toBeGreaterThan(0);
    // It frays evenly: never more than a little of it gone in any tenth of a second.
    for (let age = 0; age < ERUPTS.life; age += .1) expect(archAt(age + .1, ERUPTS).away - archAt(age, ERUPTS).away).toBeLessThan(.12);
    // A slow arch is not thrown; its sparks come off over seconds, slowly.
    expect(DISSOLVES.flung).toBe(0);
    expect(DISSOLVES.shedding).toBeGreaterThan(2);
    expect(DISSOLVES.speed).toBeLessThan(ERUPTS.speed / 2);
    // Both tempers come up, arch after arch.
    const tempers = new Set(Array.from({ length: 400 }, (_, n) => archOf(1, 0, n * 1.7, 0).temper));
    expect(tempers).toEqual(new Set([ERUPTS, DISSOLVES]));
  });

  it('come back somewhere else on the limb', () => {
    const places = new Set<number>();
    for (let time = 0; time < 200; time += .5) {
      const arch = archOf(1, 0, time, 0);
      if (arch.glow > .5) places.add(Math.round(((arch.from + arch.to) / 2) % (Math.PI * 2) * 10));
    }
    expect(places.size).toBeGreaterThan(5);
  });

  it('dissolve into sparks only once they start to go, a few at a time, which drift outwards, cool and thin away', () => {
    const { leaves, shedding, sparkLife } = DISSOLVES;
    const motes = (age: number) => Array.from({ length: 48 }, (_, k) => moteOf(1, 0, k, 100, age, 0, DISSOLVES));
    expect(motes(leaves).every(m => m === null)).toBe(true);
    expect(motes(leaves - 2).every(m => m === null)).toBe(true);
    // Not all at once: early on only some have come off.
    expect(motes(leaves + .5).filter(Boolean).length).toBeLessThan(motes(leaves + 2.5).filter(Boolean).length);
    expect(motes(leaves + 2).filter(Boolean).length).toBeGreaterThan(10);
    expect(motes(leaves + shedding + sparkLife + .1).every(m => m === null)).toBe(true);
    for (let k = 0; k < 48; k++) {
      const path = [.5, 1.5, 2.5, 3.5, 4.5].map(t => moteOf(1, 0, k, 100 + t, leaves + t, 0, DISSOLVES)).filter(m => m !== null);
      if (path.length < 2) continue;
      const first = path[0], last = path[path.length - 1];
      expect(Math.hypot(last.x, last.y)).toBeGreaterThan(Math.hypot(first.x, first.y));
      expect(last.heat).toBeLessThan(first.heat);
      expect(last.size).toBeGreaterThan(first.size * .99);
    }
  });

  it('erupt as one motion: carried out while rising, its sparks coming off all the way and flying on with it', () => {
    const { leaves } = ERUPTS;
    const at = (age: number) => {
      // An erupting arch at `age`: the time it reaches that age on its beat.
      for (let time = 0; time < 400; time += .01) {
        const arch = archOf(1, 0, time, 0);
        if (arch.temper === ERUPTS && Math.abs(arch.age - age) < .006) return arch;
      }
      throw new Error('no such moment');
    };
    expect(at(leaves - .1).out).toBe(0);
    expect(at(.8).out).toBeGreaterThan(.3);
    expect(at(1.6).out).toBeGreaterThan(at(.8).out);
    // The sparks come off a few at a time, not in one burst, and those out go on outwards.
    const sparks = (age: number, time: number) => Array.from({ length: 72 }, (_, k) => moteOf(1, 0, k, time, age, 0, ERUPTS)).filter(m => m !== null);
    const early = sparks(leaves + .3, 100), later = sparks(leaves + 1.3, 101);
    expect(early.length).toBeGreaterThan(0);
    expect(early.length).toBeLessThan(later.length / 2);
    const mean = (ms: typeof later) => ms.reduce((sum, m) => sum + Math.hypot(m!.x, m!.y), 0) / ms.length;
    expect(mean(later)).toBeGreaterThan(mean(early));
  });

  it('grow more dramatic towards a red giant: taller, more of them, and more plasma thrown further', () => {
    const tallest = (giant: number) => Math.max(...Array.from({ length: 400 }, (_, n) => archOf(1, 0, n * .1, 0, giant).height));
    expect(tallest(1)).toBeGreaterThan(tallest(0) * 1.5);
    const standing = (giant: number) => Array.from({ length: 5 }, (_, i) => archOf(1, i, 0, 1, giant)).filter(a => a.glow > .5).length;
    expect(standing(0)).toBe(3);
    expect(standing(.5)).toBe(4);
    expect(standing(1)).toBe(5);
    const reach = (giant: number) => Math.max(...Array.from({ length: 48 }, (_, k) => {
      const m = moteOf(1, 0, k, 110, ERUPTS.leaves + 1.5, giant, ERUPTS);
      return m ? Math.hypot(m.x, m.y) : 0;
    }));
    expect(reach(1)).toBeGreaterThan(reach(0) + .2);
    // In a storm every arch stands, and a full giant has five of them where a star has three.
    const { ctx, calls } = context();
    drawForgedProminences(ctx, 2, 36, 14, 1, 0);
    const calm = paintedOn(calls).drawImage.mock.calls.length;
    paintedOn(calls).drawImage.mockClear();
    drawForgedProminences(ctx, 2, 36, 14, 1, 1);
    expect(paintedOn(calls).drawImage.mock.calls.length).toBe(calm * 5 / 3);
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

  it('are puffs on a layer of their own, laid behind the ball in one stamp that keeps its opacity', () => {
    const { ctx, calls } = context();
    expect(drawForgedProminences(ctx, 3, 36, 14, 1, 0)).toBe(true);
    // In a storm all three stand: 29 puffs and 14 knots each, and two threads, all on the layer.
    expect(calls.drawImage).toHaveBeenCalledTimes(1);
    expect(paintedOn(calls).drawImage).toHaveBeenCalledTimes(3 * (29 + 14));
    expect(paintedOn(calls).stroke).toHaveBeenCalledTimes(3 * 2);
    expect(calls.stroke).not.toHaveBeenCalled();
    expect(ctx.globalAlpha).toBe(.6);
  });

  it('lay the knots and sparks over the ball: their glow in one stamp, each spark’s hot head on its own', () => {
    const { ctx, calls } = context();
    drawForgedProminences(ctx, 4, 36, 14, 1, 0);
    calls.drawImage.mockClear();
    drawForgedProminencesFront(ctx, 4, 36, 14, 1, 0);
    // Only a spark still hot and fast has a head of its own; a cooled one is all in the layer's glow.
    const hot = [0, 1, 2].flatMap(i => Array.from({ length: 72 }, (_, k) => moteOf(4, i, k, 14, archOf(4, i, 14, 1).age))).filter(m => m && m.fade >= .01 && m.heat > .45).length;
    expect(hot).toBeGreaterThan(0);
    expect(calls.drawImage).toHaveBeenCalledTimes(1 + hot);
    expect(calls.createRadialGradient).not.toHaveBeenCalled();
    expect(ctx.globalAlpha).toBe(.6);
  });

  it('paint their soft light again only a few dozen times a second, however often the screen is drawn', () => {
    const { ctx, calls } = context();
    for (let frame = 0; frame < 120; frame++) {
      drawForgedProminences(ctx, 5, 36, 20 + frame / 120, 0, 0);
      drawForgedProminencesFront(ctx, 5, 36, 20 + frame / 120, 0, 0);
    }
    // The layer is cleared each time it is painted: 24 times in that second, not 120; it is laid every frame.
    expect(paintedOn(calls).clearRect.mock.calls.length).toBeLessThanOrEqual(25);
    expect(calls.drawImage.mock.calls.length).toBeGreaterThanOrEqual(240);
    // A clock that goes back (a replay) starts the beat again rather than painting every frame.
    paintedOn(calls).clearRect.mockClear();
    for (let frame = 0; frame < 120; frame++) drawForgedProminences(ctx, 5, 36, 10 + frame / 120, 0, 0);
    expect(paintedOn(calls).clearRect.mock.calls.length).toBeLessThanOrEqual(25);
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
