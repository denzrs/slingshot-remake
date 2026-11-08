import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildWorker } from '../scripts/pwa/worker';

const template = readFileSync(new URL('../scripts/pwa/sw.js', import.meta.url), 'utf8');
const names = ['index.html', 'stats/index.html', 'assets/index-Ab12.js', 'manifest.webmanifest'];
const content = (suffix = ''): Record<string, string> => Object.fromEntries(names.map((name) => [name, `content of ${name}${suffix}`]));
const files = content();

describe('the service worker build', () => {
  it('lists the files sorted, and never itself', () => {
    const { source } = buildWorker(template, { 'sw.js': 'x', ...Object.fromEntries([...names].reverse().map((name) => [name, '.'])) });
    const listed = JSON.parse(/const FILES = (\[[\s\S]*?\]);/.exec(source)![1]) as string[];
    expect(listed).toEqual([...names].sort());
  });

  it('names the cache after the list: the same for the same build, another for another', () => {
    const a = buildWorker(template, files);
    expect(buildWorker(template, Object.fromEntries(Object.entries(files).reverse())).cache).toBe(a.cache);
    expect(buildWorker(template, Object.fromEntries(Object.entries(files).map(([name, text]) => [name.replace('Ab12', 'Cd34'), text]))).cache).not.toBe(a.cache);
    // A file that keeps its name (the page, the manifest) still changes the cache when its content changes.
    expect(buildWorker(template, { ...files, 'index.html': 'another page' }).cache).not.toBe(a.cache);
    expect(a.cache).toMatch(/^slingshot-[0-9a-f]{12}$/);
    expect(a.source).toContain(`const CACHE = '${a.cache}';`);
  });

  it('fills every placeholder', () => {
    expect(buildWorker(template, files).source).not.toMatch(/__CACHE__|__FILES__/);
  });

  it('refuses a path that would not stay under the scope', () => {
    expect(() => buildWorker(template, { '/index.html': '' })).toThrow();
    expect(() => buildWorker(template, { 'https://example.com/a.js': '' })).toThrow();
    expect(() => buildWorker(template, {})).toThrow();
  });

  it('does not fetch or answer for anything outside its scope', () => {
    expect(template).toContain('self.registration.scope');
    expect(template).not.toMatch(/new URL\('\//);
  });
});
