import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The window sizes the stylesheets change layout at. A narrow window is `max-width: N`, a wide one `min-width: N + 1`, so
 * every pixel belongs to exactly one side; the same goes for heights. A new size belongs in this list on purpose.
 */
const WIDTHS = [380, 460, 520, 560, 640, 700, 720, 760, 900, 1000, 1100];
const HEIGHTS = [620, 740, 780, 800, 820, 860, 960, 1000];

const root = fileURLToPath(new URL('../src', import.meta.url));

function stylesheets(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return stylesheets(path);
    return name.endsWith('.css') ? [path] : [];
  });
}

/** Every window-size condition in the `@media` rules, with where it was written. */
function conditions(): { where: string; feature: 'width' | 'height'; edge: 'min' | 'max'; px: number }[] {
  const found: { where: string; feature: 'width' | 'height'; edge: 'min' | 'max'; px: number }[] = [];
  for (const file of stylesheets(root)) {
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      if (!/^\s*@media\b/.test(line)) return;
      for (const [, edge, feature, px] of line.matchAll(/\((min|max)-(width|height):\s*(\d+)px\)/g)) {
        found.push({ where: `${file.slice(root.length + 1)}:${i + 1}`, feature: feature as 'width' | 'height', edge: edge as 'min' | 'max', px: Number(px) });
      }
    });
  }
  return found;
}

describe('stylesheet breakpoints', () => {
  const all = conditions();

  it('finds the media queries', () => {
    expect(all.length).toBeGreaterThan(50);
  });

  it('only uses the agreed window sizes, a wide side starting one pixel after its narrow side', () => {
    const odd = all.filter(({ feature, edge, px }) => {
      const sizes = feature === 'width' ? WIDTHS : HEIGHTS;
      return !sizes.includes(edge === 'max' ? px : px - 1);
    });
    expect(odd.map(({ where, edge, feature, px }) => `${where} ${edge}-${feature}: ${px}px`)).toEqual([]);
  });

  it('has no agreed size that nothing uses', () => {
    const used = (feature: 'width' | 'height') => new Set(all.filter((c) => c.feature === feature).map(({ edge, px }) => (edge === 'max' ? px : px - 1)));
    expect(WIDTHS.filter((px) => !used('width').has(px))).toEqual([]);
    expect(HEIGHTS.filter((px) => !used('height').has(px))).toEqual([]);
  });
});
