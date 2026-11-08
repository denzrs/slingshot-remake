import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ANOMALIES } from '../../src/sim/config';
import { getLang, setLang, t } from '../../src/platform/i18n';
import { mountTutorialPreview } from '../../src/ui/screens/tutorial-preview';
import { TUTORIAL } from '../../src/ui/screens/tutorial';

describe('flight training tutorial', () => {
  const ctx = {
    save: vi.fn(),
    restore: vi.fn(),
    setTransform: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    rotate: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    ellipse: vi.fn(),
    quadraticCurveTo: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 40 })),
    setLineDash: vi.fn(),
    createImageData: vi.fn((w, h) => ({ data: new Uint8ClampedArray(w * h * 4) })),
    putImageData: vi.fn(),
    drawImage: vi.fn(),
    createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
  } as unknown as CanvasRenderingContext2D;

  beforeEach(() => {
    globalThis.document = {
      createElement: vi.fn(() => ({
        getContext: vi.fn(() => ctx),
        width: 0,
        height: 0,
        className: '',
        setAttribute: vi.fn(),
        append: vi.fn(),
        children: [],
      })),
    } as unknown as Document;
  });

  it('has German and English translations for anomalies tutorial and preview legends', () => {
    const originalLang = getLang();
    for (const lang of ['de', 'en'] as const) {
      setLang(lang);
      expect(t('tutorial.anomalies.title')).toBeTruthy();
      expect(t('tutorial.anomalies.1')).toBeTruthy();
      expect(t('tutorial.anomalies.choose')).toBeTruthy();
      expect(t('tutorial.preview.unarmed')).toBeTruthy();
      expect(t('tutorial.preview.armedShot')).toBeTruthy();
      expect(t('tutorial.preview.normalShot')).toBeTruthy();
      expect(t('tutorial.preview.bouncedShot')).toBeTruthy();
      expect(t('tutorial.preview.shot1')).toBeTruthy();
      expect(t('tutorial.preview.shot2')).toBeTruthy();
      expect(t('tutorial.preview.fused')).toBeTruthy();

      for (const anomaly of ANOMALIES) {
        expect(t(`anomaly.${anomaly}`)).toBeTruthy();
        expect(t(`anomaly.${anomaly}.hint`)).toBeTruthy();
      }
    }
    setLang(originalLang);
  });

  it('builds miniature preview scenes for all 6 anomalies without errors', () => {
    // Mock minimal canvas and 2D context
    const canvas = {
      getContext: vi.fn(() => ctx),
      getBoundingClientRect: vi.fn(() => ({ width: 640, height: 360 })),
      width: 640,
      height: 360,
    } as unknown as HTMLCanvasElement;

    // Polyfill ResizeObserver & matchMedia if needed in node
    const originalResizeObserver = globalThis.ResizeObserver;
    const originalMatchMedia = globalThis.matchMedia;
    const originalRAF = globalThis.requestAnimationFrame;
    const originalCAF = globalThis.cancelAnimationFrame;

    class MockResizeObserver {
      observe = vi.fn();
      disconnect = vi.fn();
    }
    globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
    globalThis.matchMedia = vi.fn(() => ({ matches: false })) as unknown as typeof matchMedia;
    globalThis.requestAnimationFrame = vi.fn(() => 1);
    globalThis.cancelAnimationFrame = vi.fn();

    try {
      for (const anomaly of ANOMALIES) {
        const onProgress = vi.fn();
        const controller = mountTutorialPreview(canvas, 'anomalies', onProgress, undefined, undefined, anomaly);

        expect(controller).toBeDefined();
        controller.seek(0.5);
        expect(onProgress).toHaveBeenCalledWith(0.5);

        controller.replay();
        controller.dispose();
      }
    } finally {
      globalThis.ResizeObserver = originalResizeObserver;
      globalThis.matchMedia = originalMatchMedia;
      globalThis.requestAnimationFrame = originalRAF;
      globalThis.cancelAnimationFrame = originalCAF;
    }
  });

  it('removes Eine Runde Spielen and adds Anomalies as the last lesson', () => {
    const lessons = TUTORIAL.map((lesson) => lesson(false, false));
    const titles = lessons.map((l) => l.title);

    // Verify "Eine Runde spielen" / "Play a round" is not present
    expect(titles).not.toContain('Eine Runde spielen');
    expect(titles).not.toContain('Play a round');
    expect(titles).not.toContain(t('tutorial.round.title'));

    // Verify Anomalies is the last lesson
    const lastLesson = lessons[lessons.length - 1];
    expect(lastLesson.title).toBe(t('tutorial.anomalies.title'));
    expect(lastLesson.demo).toBe('anomalies');
    expect(lastLesson.anomalies).toEqual(ANOMALIES);
  });

  it('explains the controller on the aiming page only while one is connected', () => {
    const aim = TUTORIAL[1];
    expect(aim(false, false).body).toHaveLength(aim(false, false, false).body.length);
    for (const touch of [false, true]) {
      const without = aim(touch, false, false).body.length;
      const withPad = aim(touch, false, true).body;
      // The intro and the table of buttons come on top, and nothing else on the page changes.
      expect(withPad.length).toBe(without + 2);
    }
    for (const [i, lesson] of TUTORIAL.entries()) {
      if (i !== 1) expect(lesson(false, false, true).body.length).toBe(lesson(false, false, false).body.length);
    }
  });
});
