import { describe, expect, it } from 'vitest';
import { wrapParts } from '../../src/render/text';

/** Eight pixels a character. */
const ctx = { measureText: (text: string) => ({ width: text.length * 8 }) } as unknown as CanvasRenderingContext2D;

describe('wrapParts', () => {
  it('keeps what fits on one line', () => {
    expect(wrapParts(ctx, ['MOST', 'KILLS'], ' ', 100, 2)).toEqual(['MOST KILLS']);
  });

  it('goes on to a second line instead of cutting a word', () => {
    expect(wrapParts(ctx, ['LONGEST', 'SHOT'], ' ', 70, 2)).toEqual(['LONGEST', 'SHOT']);
    expect(wrapParts(ctx, ['MOST', 'SWING-BYS'], ' ', 80, 2)).toEqual(['MOST', 'SWING-BYS']);
  });

  it('puts one name on each line when two do not fit together', () => {
    expect(wrapParts(ctx, ['CPU 2', 'CPU 4'], ' · ', 80, 2)).toEqual(['CPU 2', 'CPU 4']);
  });

  it('cuts the last line with an ellipsis past the number of lines allowed, and never goes over the width', () => {
    const lines = wrapParts(ctx, ['A LONG', 'WORD', 'AFTER', 'WORD'], ' ', 64, 2);
    expect(lines).toHaveLength(2);
    expect(lines[1].endsWith('…')).toBe(true);
    for (const line of lines) expect(line.length * 8).toBeLessThanOrEqual(64);
  });

  it('cuts a single part wider than the line', () => {
    const [line] = wrapParts(ctx, ['SUPERCALIFRAGILISTIC'], ' ', 64, 2);
    expect(line.endsWith('…')).toBe(true);
    expect(line.length * 8).toBeLessThanOrEqual(64);
  });
});
