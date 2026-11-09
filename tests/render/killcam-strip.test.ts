import { describe, expect, it } from 'vitest';
import { Hud } from '../../src/render/hud';

function mockCtx(): CanvasRenderingContext2D {
  return new Proxy({} as CanvasRenderingContext2D, {
    get: (_, prop) => (prop === 'measureText' ? (text: string) => ({ width: (text?.length ?? 1) * 8 }) : () => {}),
    set: () => true,
  });
}

type Segment = [string, string];
const fit = (hud: Hud, segments: Segment[], width: number): Segment[] =>
  (hud as unknown as { fitSegments(s: Segment[], w: number): Segment[] }).fitSegments(segments, width);
const width = (segments: Segment[]): number => segments.reduce((s, [t]) => s + t.length * 8, 0);

describe('the killcam strip on a phone', () => {
  const kill: Segment[] = [['Player 1', '#fff'], [' ▸ ', '#888'], ['CPU 3', '#f00'], ['  +1410', '#fff'], ['  4× Bande · Streifschuss · Swing-by · Weitschuss', '#888'], [' ×1,88', '#ff0']];

  it('shortens the trick list to fit the field and keeps names and points whole', () => {
    const fitted = fit(new Hud(mockCtx()), kill, 330);
    expect(width(fitted)).toBeLessThanOrEqual(330);
    expect(fitted[0][0]).toBe('Player 1');
    expect(fitted[3][0]).toBe('  +1410');
    expect(fitted[4][0].endsWith('…')).toBe(true);
    expect(fitted[5][0]).toBe(' ×1,88');
  });

  it('leaves a strip that already fits alone', () => {
    expect(fit(new Hud(mockCtx()), kill, 2000)).toBe(kill);
  });
});
