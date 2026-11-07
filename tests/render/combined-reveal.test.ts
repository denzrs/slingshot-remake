import { describe, expect, it } from 'vitest';
import { createUiPreview } from '../../src/debug/devPreview';
import { Hud } from '../../src/render/hud';
import { MAYHEM } from '../../src/sim/config';
import { anomaliesOf } from '../../src/sim/anomalies';

function mockCtx(): CanvasRenderingContext2D {
  return new Proxy({} as CanvasRenderingContext2D, {
    get: (_, prop) => {
      if (prop === 'measureText') return (text: string) => ({ width: (text?.length ?? 1) * 8 });
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') {
        return () => ({ addColorStop: () => {} });
      }
      return () => {};
    },
    set: () => true,
  });
}

describe('combined Mayhem + Anomalies reveal', () => {
  it('creates the standard Mayhem + Anomaly preview with Pinball and Billiard', () => {
    const match = createUiPreview('mayhem-anomalies');
    expect(match.round).toBe(1);
    expect(match.revealing).toBe(true);
    expect(match.anomalyAlert).toBe(true);
    expect(match.mayhem?.twists).toEqual([{ id: 'billiard', n: 2 }]);
    expect(anomaliesOf(match.rules)).toEqual(['pinball']);
  });

  it('creates the extreme preview with 6 anomalies and 4 twists', () => {
    const match = createUiPreview('mayhem-extreme');
    expect(match.round).toBe(1);
    expect(match.revealing).toBe(true);
    expect(match.anomalyAlert).toBe(true);
    expect(match.mayhem?.twists.length).toBe(4);
    expect(match.mayhem?.finale).toBe(true);
    expect(match.mayhem?.jackpot).toBe(true);
    expect(anomaliesOf(match.rules)).toEqual(['trickShots', 'pinball', 'fuse', 'fusion', 'whiteHole', 'unstable']);
  });

  it('renders standard Mayhem + Anomaly reveal without throwing across ages', () => {
    const match = createUiPreview('mayhem-anomalies');
    const hud = new Hud(mockCtx());
    const view = { cssWidth: 1280, cssHeight: 800, scale: 1, offsetX: 0, offsetY: 0, dpr: 1 };
    const opts = { touch: false, fullScreen: false, recording: false, keyHints: true, aimCardDodge: false, hud: true };
    const shipPos = () => ({ x: 100, y: 100 });

    for (const age of [0.05, 0.4, 0.9, 1.3, MAYHEM.LANDED + 0.5, MAYHEM.REVEAL_TIME]) {
      match.clock = 0;
      match.revealEnd = MAYHEM.REVEAL_TIME - age;
      expect(() => hud.draw(match, view, opts, age, shipPos)).not.toThrow();
    }
  });

  it('renders extreme combo with 6 anomalies and 4 twists in wide layout without throwing', () => {
    const match = createUiPreview('mayhem-extreme');
    const hud = new Hud(mockCtx());
    const view = { cssWidth: 1280, cssHeight: 800, scale: 1, offsetX: 0, offsetY: 0, dpr: 1 };
    const opts = { touch: false, fullScreen: false, recording: false, keyHints: true, aimCardDodge: false, hud: true };
    const shipPos = () => ({ x: 100, y: 100 });

    for (const age of [0.05, 0.5, 1.0, MAYHEM.LANDED + 0.2, MAYHEM.REVEAL_TIME]) {
      match.clock = 0;
      match.revealEnd = MAYHEM.REVEAL_TIME - age;
      expect(() => hud.draw(match, view, opts, age, shipPos)).not.toThrow();
    }
  });

  it('renders extreme combo in portrait layout without throwing', () => {
    const match = createUiPreview('mayhem-extreme');
    const hud = new Hud(mockCtx());
    const view = {
      cssWidth: 390,
      cssHeight: 844,
      scale: 0.8,
      offsetX: 0,
      offsetY: 0,
      dpr: 2,
      stage: { x: 10, y: 50, w: 370, h: 700 },
    };
    const opts = { touch: true, fullScreen: false, recording: false, keyHints: false, aimCardDodge: false, hud: true };
    const shipPos = () => ({ x: 50, y: 50 });

    for (const age of [0.1, 0.8, MAYHEM.LANDED + 0.3]) {
      match.clock = 0;
      match.revealEnd = MAYHEM.REVEAL_TIME - age;
      expect(() => hud.draw(match, view, opts, age, shipPos)).not.toThrow();
    }
  });

  it('renders only anomalies (when Mayhem is off) using original drawAnomalyAlert without throwing', () => {
    const match = createUiPreview('mayhem-anomalies');
    match.mayhem = null; // Mayhem is OFF
    match.anomalyAlert = true;
    const hud = new Hud(mockCtx());
    const view = { cssWidth: 1280, cssHeight: 800, scale: 1, offsetX: 0, offsetY: 0, dpr: 1 };
    const opts = { touch: false, fullScreen: false, recording: false, keyHints: true, aimCardDodge: false, hud: true };
    const shipPos = () => ({ x: 100, y: 100 });

    for (const age of [0.1, 0.8, MAYHEM.LANDED + 0.3]) {
      match.clock = 0;
      match.revealEnd = MAYHEM.REVEAL_TIME - age;
      expect(() => hud.draw(match, view, opts, age, shipPos)).not.toThrow();
    }
  });

  it('renders only Mayhem (when Anomalies are off) using original drawReveal without throwing', () => {
    const match = createUiPreview('mayhem-anomalies');
    match.anomalyAlert = false; // Anomalies are OFF
    const hud = new Hud(mockCtx());
    const view = { cssWidth: 1280, cssHeight: 800, scale: 1, offsetX: 0, offsetY: 0, dpr: 1 };
    const opts = { touch: false, fullScreen: false, recording: false, keyHints: true, aimCardDodge: false, hud: true };
    const shipPos = () => ({ x: 100, y: 100 });

    for (const age of [0.1, 0.8, MAYHEM.LANDED + 0.3]) {
      match.clock = 0;
      match.revealEnd = MAYHEM.REVEAL_TIME - age;
      expect(() => hud.draw(match, view, opts, age, shipPos)).not.toThrow();
    }
  });

  it('fades in reveal smoothly over 0.4s without sudden snap', () => {
    const match = createUiPreview('mayhem-anomalies');
    match.mayhem = null;
    match.anomalyAlert = true;
    const hud = new Hud(mockCtx());
    const getAlpha = (age: number) => {
      match.clock = 0;
      match.revealEnd = MAYHEM.REVEAL_TIME - age;
      return (hud as unknown as { revealAlpha: (m: typeof match) => { alpha: number; age: number } }).revealAlpha(match).alpha;
    };

    // At age 0: alpha is exactly 0
    expect(getAlpha(0)).toBe(0);

    // At age 0.1s: gentle start (smoothstep < linear)
    expect(getAlpha(0.1)).toBeCloseTo(0.156, 2);

    // At age 0.2s (halfway): alpha is smoothly 0.5 (smoothstep at 0.5 is exactly 0.5)
    expect(getAlpha(0.2)).toBeCloseTo(0.5, 2);

    // At age 0.3s: gentle ease-out towards 1
    expect(getAlpha(0.3)).toBeCloseTo(0.844, 2);

    // At age 0.4s: alpha has reached 1.0
    expect(getAlpha(0.4)).toBeCloseTo(1.0, 2);

    // While held, it stays at 1.0
    expect(getAlpha(1.5)).toBe(1.0);
  });
});
