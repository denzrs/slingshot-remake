import { describe, expect, it } from 'vitest';
import { rowToRemember } from '../../src/ui/menu/menu-focus';

describe('the row a page is returned to', () => {
  it('is the one that has the focus', () => {
    expect(rowToRemember(3, 1)).toBe(3);
    expect(rowToRemember(0, 4)).toBe(0);
  });

  it('is the one that was pressed when none has the focus, as after a tap in Safari', () => {
    expect(rowToRemember(-1, 2)).toBe(2);
  });

  it('is none, not the first row, when neither is known', () => {
    expect(rowToRemember(-1, -1)).toBe(-1);
  });
});
