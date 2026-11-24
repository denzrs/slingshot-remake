/**
 * What a planet breaking (planet killer, Unstable) costs, in headless Chromium with the game's own code:
 *
 *   contour   drawing the gravity map at once (`renderContours`, what a round's first map costs), and the game's
 *             `ContourLayers` when a planet cracks (nothing to redraw) and breaks (drawn in its worker): the frame's cost,
 *             how late the new map is, and the longest frame while waiting
 *   sparks    the debris' physics: `Effects.update` against a tighter loop with the same physics (positions compared)
 *   draw      drawing the debris (and the first half second of the blast) in every look
 *
 *   npm run bench:explosion [-- --json out.json]
 *
 * It starts its own Vite dev server. `ps` is device pixels per field unit (about 2 on a 1440p screen, 3 on 4K).
 * Headless Chromium draws in software: read the draw times against each other, not as what a GPU canvas costs.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'vite';
import { launchChrome } from '../scripts/chrome';

const jsonAt = process.argv.indexOf('--json');
const jsonPath = jsonAt > 0 ? process.argv[jsonAt + 1] : null;

// The shell's nix library path breaks Chromium.
delete process.env.LD_LIBRARY_PATH;

const server = await createServer({ root: join(import.meta.dirname, '..'), server: { port: 0 }, logLevel: 'error' });
await server.listen();
const origin = server.resolvedUrls!.local[0].replace(/\/$/, '');
const browser = await launchChrome(1400, 900);
type Summary = { median: number; p95: number; max: number };
let result: Record<string, Summary | Record<string, Summary | number>>;
try {
  await browser.cdp.send('Page.navigate', { url: `${origin}/dev/` });
  result = await browser.cdp.evaluate(`import('/benchmarks/explosion/page.ts').then((m) => m.run())`);
} finally {
  await browser.close().catch(() => undefined);
  await server.close();
}

const row = (label: string, s: Summary, note = '') => console.log(`  ${label.padEnd(34)}${String(s.median).padStart(8)}${String(s.p95).padStart(8)}${String(s.max).padStart(8)}  ${note}`);
console.log(`  ${''.padEnd(34)}${'median'.padStart(8)}${'p95'.padStart(8)}${'max'.padStart(8)}  (ms)`);
for (const [key, value] of Object.entries(result)) {
  if ('median' in value) row(key, value as Summary);
  else {
    console.log(`  ${key}`);
    for (const [part, v] of Object.entries(value)) {
      if (typeof v === 'number') console.log(`    ${part.padEnd(32)}${String(v).padStart(8)}`);
      else row(`  ${part}`, v, part === 'sparks' ? '(count, not ms)' : '');
    }
  }
}
if (jsonPath) writeFileSync(jsonPath, JSON.stringify(result, null, 2));
