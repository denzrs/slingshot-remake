import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Who may import whom. Each folder of src/ stands on the ones below it and knows nothing of the ones above:
 *
 *   platform  language, sound, emoji: nothing of the game
 *   sim       the physics and the rules of a flight, no DOM
 *   data      what is configured and remembered: settings, rules of a room, stats
 *   game      a match, its modes and its records
 *   net       the relay, and everything that crosses the wire        render   the picture of the game
 *   debug     tools for developing                                   ui       menus, lobby, controls
 *
 * net and render do not know each other. A folder's own files may import each other freely.
 */
const RANK: Record<string, number> = { platform: 0, sim: 1, data: 2, game: 3, net: 4, render: 4, debug: 5, ui: 6 };

const src = fileURLToPath(new URL('../src', import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return name.endsWith('.ts') && !name.endsWith('.d.ts') ? [path] : [];
  });
}

const areaOf = (file: string): string => relative(src, file).split('/')[0];

/** The files a source file imports from inside src/. */
function importsOf(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  const specs = [...text.matchAll(/(?:import|export)\s[^;]*?from\s+'(\.[^']+)'/gs), ...text.matchAll(/^import\s+'(\.[^']+)'/gm)].map((m) => m[1]);
  return specs.flatMap((spec) => {
    const target = normalize(join(dirname(file), spec));
    return [target + '.ts', join(target, 'index.ts')].filter(existsSync).slice(0, 1);
  });
}

describe('layers of src/', () => {
  const files = sources(src).filter((file) => areaOf(file) in RANK);

  it('finds the sources', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('has no folder import one that stands above it, or beside it', () => {
    const bad: string[] = [];
    for (const file of files) {
      for (const target of importsOf(file)) {
        const from = areaOf(file);
        const to = areaOf(target);
        if (from === to || !(to in RANK)) continue;
        if (RANK[to] > RANK[from] || (RANK[to] === RANK[from])) bad.push(`${relative(src, file)} → ${relative(src, target)}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('keeps every folder of src/ in the list above', () => {
    const areas = new Set(readdirSync(src).filter((name) => statSync(join(src, name)).isDirectory() && name !== 'styles'));
    expect([...areas].filter((name) => !(name in RANK))).toEqual([]);
  });
});
