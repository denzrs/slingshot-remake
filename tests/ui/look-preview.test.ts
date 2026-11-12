import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lookPreview, PREVIEW_SCENES } from '../../src/ui/onboarding/look-preview';
import { cloneSettings, DEFAULT_SETTINGS } from '../../src/data/settings';

afterEach(() => vi.unstubAllGlobals());

describe('onboarding look preview scenes', () => {
  let canvas: HTMLCanvasElement;

  class MockDOMPoint {
    x = 0; y = 0; z = 0; w = 1;
    constructor(x = 0, y = 0, z = 0, w = 1) {
      this.x = x; this.y = y; this.z = z; this.w = w;
    }
  }

  class MockDOMMatrix {
    a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
    constructor(init?: number[]) {
      if (init) [this.a, this.b, this.c, this.d, this.e, this.f] = init;
    }
    transformPoint(p: { x: number; y: number }) {
      return { x: p.x * this.a + p.y * this.c + this.e, y: p.x * this.b + p.y * this.d + this.f };
    }
  }

  class MockImageData {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    constructor(w: number, h: number) {
      this.width = w;
      this.height = h;
      this.data = new Uint8ClampedArray(w * h * 4);
    }
  }

  class MockPath2D {
    moveTo() {}
    lineTo() {}
    arc() {}
    closePath() {}
    rect() {}
    ellipse() {}
    bezierCurveTo() {}
    quadraticCurveTo() {}
  }

  class MockImage {
    src = '';
    complete = false;
    width = 0;
    height = 0;
  }

  const createMockCanvas = () => {
    const c: any = {
      width: 640,
      height: 400,
      style: {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
      parentElement: {
        getBoundingClientRect: () => ({ width: 640, height: 400 }),
      },
    };
    const mockCtx: any = new Proxy({
      canvas: c,
      measureText: () => ({ width: 50 }),
      createImageData: (w: number, h: number) => new MockImageData(w, h),
      getImageData: (_x: number, _y: number, w: number, h: number) => new MockImageData(w, h),
      getTransform: () => new MockDOMMatrix(),
      createRadialGradient: () => ({ addColorStop: () => {} }),
      createLinearGradient: () => ({ addColorStop: () => {} }),
      createPattern: () => null,
    }, {
      get(target: any, prop: string | symbol) {
        if (prop in target) return target[prop];
        return () => {};
      },
      set() { return true; },
    });
    c.getContext = (type: string) => {
      if (type === '2d') return mockCtx;
      return null;
    };
    return c;
  };

  beforeEach(() => {
    vi.stubGlobal('DOMPoint', MockDOMPoint);
    vi.stubGlobal('DOMMatrix', MockDOMMatrix);
    vi.stubGlobal('ImageData', MockImageData);
    vi.stubGlobal('Path2D', MockPath2D);
    vi.stubGlobal('Image', MockImage);
    vi.stubGlobal('window', {
      devicePixelRatio: 2,
      matchMedia: () => ({ matches: false }),
    });
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    vi.stubGlobal('document', {
      hidden: false,
      createElement: () => createMockCanvas(),
    });
    canvas = createMockCanvas() as unknown as HTMLCanvasElement;
  });

  it('declares the three preview scenes in order: gravity, solar, horizon', () => {
    expect(PREVIEW_SCENES).toEqual(['gravity', 'solar', 'horizon']);
  });

  it('draws still frames for all three looks without advancing flight', () => {
    const preview = lookPreview(canvas, cloneSettings(DEFAULT_SETTINGS));
    expect(() => {
      preview.draw(0, 'classic', true);
      preview.draw(0, 'forged', true);
      preview.draw(0, 'holo', true);
    }).not.toThrow();
    preview.dispose();
  });

  it('plays the gravity scene and resets after the kill', () => {
    const preview = lookPreview(canvas, cloneSettings(DEFAULT_SETTINGS));
    for (let i = 0; i < 300; i++) {
      preview.draw(1 / 60, 'classic');
    }
    preview.dispose();
  });

  it('switches between scenes and updates the field contents', () => {
    const preview = lookPreview(canvas, cloneSettings(DEFAULT_SETTINGS));
    preview.setScene('solar');
    expect(() => preview.draw(0, 'classic', true)).not.toThrow();
    preview.setScene('horizon');
    expect(() => preview.draw(0, 'classic', true)).not.toThrow();
    preview.setScene('gravity');
    expect(() => preview.draw(0, 'classic', true)).not.toThrow();
    preview.dispose();
  });

  it('plays the solar scene through the pass and counter-attack', () => {
    const preview = lookPreview(canvas, cloneSettings(DEFAULT_SETTINGS));
    preview.setScene('solar');
    for (let i = 0; i < 100; i++) {
      preview.draw(0.1, 'forged');
    }
    preview.dispose();
  });

  it('plays the horizon scene through volley and black hole collapse', () => {
    const preview = lookPreview(canvas, cloneSettings(DEFAULT_SETTINGS));
    preview.setScene('horizon');
    for (let i = 0; i < 110; i++) {
      preview.draw(0.1, 'holo');
    }
    preview.dispose();
  });

  it('safely handles disposal while drawing or switching scenes', () => {
    const preview = lookPreview(canvas, cloneSettings(DEFAULT_SETTINGS));
    preview.dispose();
    expect(() => preview.draw(1 / 60, 'classic')).not.toThrow();
    expect(() => preview.setScene('solar')).not.toThrow();
  });

  it('automatically signals scene completion via onSceneEnd callback', () => {
    let completed: string | null = null;
    const preview = lookPreview(canvas, cloneSettings(DEFAULT_SETTINGS), {
      onSceneEnd: (ended) => { completed = ended; },
    });
    for (let i = 0; i < 110; i++) {
      preview.draw(0.1, 'classic');
      if (completed) break;
    }
    expect(completed).toBe('gravity');
    preview.dispose();
  });
});
