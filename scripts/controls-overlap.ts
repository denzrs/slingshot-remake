/**
 * How often a ship (or, in the daily challenge, a target drone) ends up under the touch controls on a phone: plays many fresh
 * boards at the iPhone 16 and 16 Pro Max sizes, upright and sideways, and for each one tests every ship's position on the
 * screen against what covers it (the wheel, the power bar, the fire button, the stick, the pause button).
 *
 *   npx tsx scripts/controls-overlap.ts                 # 40 boards per mode, wheel and stick
 *   npx tsx scripts/controls-overlap.ts --boards 100 --png    # more boards, and a screenshot of the worst one per setup
 *   npx tsx scripts/controls-overlap.ts --url http://localhost:5173/
 *
 * A ship counts as hidden when its centre is under a control, or within `MARGIN` px of one (the ship is about as big). It
 * needs a build with `window.slingshot` (it makes one with VITE_BENCH=1 unless given a --url of `npm run dev`).
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchChrome, sleep } from './chrome';
import { SETTINGS, until } from './screens-pages';
import { buildWorkingTree, ROOT, serve } from './serve';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const BOARDS = Number(flag('--boards') ?? 40);
const PNG = args.includes('--png');
const OUT = join(ROOT, 'output', 'controls-overlap');
const MARGIN = 10;

const PHONES = [
  { id: 'iphone-16', w: 393, h: 852, portrait: { top: 59, bottom: 34, left: 0, right: 0 }, landscape: { top: 0, bottom: 21, left: 59, right: 59 } },
  { id: 'iphone-16-pro-max', w: 440, h: 956, portrait: { top: 62, bottom: 34, left: 0, right: 0 }, landscape: { top: 0, bottom: 21, left: 62, right: 62 } },
];
const MODES = ['classic', 'horizon', 'solar', 'daily'] as const;

/** Run in the page: where every ship is on the screen, and the shapes of what covers the screen. */
const MEASURE = `(() => {
  const s = window.slingshot;
  const m = s.match;
  if (!m) return null;
  const ships = m.world.ships.map((ship, i) => ({ i, alive: ship.alive, target: !!m.players[i]?.target, ...s.renderer.project(ship.x, ship.y, null, false) }));
  const box = (sel) => [...document.querySelectorAll(sel)].filter((el) => !el.hidden && !el.closest('[hidden]') && el.getClientRects().length).map((el) => { const r = el.getBoundingClientRect(); return { sel, left: r.left, top: r.top, right: r.right, bottom: r.bottom, faded: el.classList.contains('over-ship') }; });
  const wheel = box('.twheel').map((r) => ({ ...r, quarter: true, side: r.left < innerWidth / 2 ? 'left' : 'right' }));
  const rects = [...box('#touch-power'), ...box('#touch-fire'), ...box('.pbar'), ...box('#touch-stick'), ...box('#pause-button')];
  return { w: innerWidth, h: innerHeight, ships, shapes: [...wheel, ...rects], human: m.isHumanTurn };
})()`;

interface Shape { faded: boolean; sel: string; left: number; top: number; right: number; bottom: number; quarter?: boolean; side?: 'left' | 'right' }
interface Measured { w: number; h: number; ships: { i: number; alive: boolean; target: boolean; x: number; y: number }[]; shapes: Shape[]; human: boolean }

const under = (x: number, y: number, sh: Shape): boolean => {
  if (sh.quarter) {
    // A quarter circle in the screen's corner, as wide as its box.
    const cx = sh.side === 'left' ? sh.left : sh.right;
    const cy = sh.bottom;
    return Math.hypot(x - cx, y - cy) <= sh.right - sh.left + MARGIN;
  }
  return x >= sh.left - MARGIN && x <= sh.right + MARGIN && y >= sh.top - MARGIN && y <= sh.bottom + MARGIN;
};

interface Tally { boards: number; hiddenBoards: number; ships: number; hiddenShips: number; byControl: Record<string, number>; worst: { hidden: number; seed: number } }

const results = new Map<string, Tally>();
const server = process.argv.includes('--url') ? null : await serve(buildWorkingTree({ VITE_BENCH: '1' }));
const base = flag('--url') ?? server!.url;
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

try {
  for (const phone of PHONES) {
    for (const orientation of ['portrait', 'landscape'] as const) {
      const landscape = orientation === 'landscape';
      const width = landscape ? phone.h : phone.w;
      const height = landscape ? phone.w : phone.h;
      const browser = await launchChrome(width, height);
      const { cdp } = browser;
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: landscape ? 'landscapePrimary' : 'portraitPrimary', angle: landscape ? 90 : 0 } });
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      try { await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: landscape ? phone.landscape : phone.portrait }); } catch { /* older Chrome */ }
      for (const controls of ['wheel', 'stick'] as const) {
        await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.clear(); localStorage.setItem('slingshot.settings.v1', ${JSON.stringify(JSON.stringify({ ...SETTINGS, touchControls: controls }))});` });
        await cdp.send('Page.navigate', { url: `${base}?daily=2026-10-25` });
        await cdp.evaluate(until(`!!window.slingshot`, 15000));
        await sleep(300);
        for (const mode of MODES) {
          const key = `${phone.id} ${orientation} ${controls} ${mode}`;
          const tally: Tally = { boards: 0, hiddenBoards: 0, ships: 0, hiddenShips: 0, byControl: {}, worst: { hidden: -1, seed: 0 } };
          results.set(key, tally);
          for (let board = 0; board < BOARDS; board++) {
            if (mode === 'daily') {
              // Each day has its own board: a page of its own for each.
              const day = `2026-${String(1 + (board % 12)).padStart(2, '0')}-${String(1 + Math.floor(board / 12) % 28).padStart(2, '0')}`;
              await cdp.send('Page.navigate', { url: `${base}?daily=${day}&start` });
              await cdp.evaluate(until(`!!window.slingshot && !!window.slingshot.match`, 8000));
            } else {
              await cdp.evaluate(`(() => { const s = window.slingshot; Object.assign(s.settings, { seats: ['human', 'medium', 'medium', 'medium', 'off', 'off'], rounds: 1 }); s.app.start(${JSON.stringify(mode)}); return true; })()`);
            }
            const ready = await cdp.evaluate<boolean>(until(`window.slingshot.match && window.slingshot.match.isHumanTurn && !window.slingshot.match.revealing`, 6000));
            if (!ready) { await cdp.evaluate(`window.slingshot.app.toTitle()`); continue; }
            await sleep(400);
            const m = await cdp.evaluate<Measured | null>(MEASURE);
            if (!m) continue;
            tally.boards++;
            let hiddenHere = 0;
            let seenThrough = 0;
            for (const ship of m.ships) {
              if (!ship.alive) continue;
              tally.ships++;
              // Under a control that has faded the ship shows through: it counts as seen.
              const covering = m.shapes.filter((sh) => !sh.faded && under(ship.x, ship.y, sh));
              if (m.shapes.some((sh) => sh.faded && under(ship.x, ship.y, sh))) seenThrough++;
              if (covering.length) {
                tally.hiddenShips++;
                hiddenHere++;
                for (const sh of covering) tally.byControl[sh.sel] = (tally.byControl[sh.sel] ?? 0) + 1;
              }
            }
            if (hiddenHere) tally.hiddenBoards++;
            if (hiddenHere + seenThrough > tally.worst.hidden) {
              tally.worst = { hidden: hiddenHere + seenThrough, seed: board };
              if (PNG) {
                const { data } = await cdp.send<{ data: string }>('Page.captureScreenshot', { format: 'png' });
                writeFileSync(join(OUT, `${key.replace(/ /g, '_')}.png`), Buffer.from(data, 'base64'));
              }
            }
          }
          await cdp.send('Page.navigate', { url: `${base}?daily=2026-10-25` });
          await cdp.evaluate(until(`!!window.slingshot`, 15000));
        }
      }
      await browser.close();
    }
  }
} finally {
  await server?.close();
}

const rows = [...results.entries()].map(([key, t]) => ({ key, ...t }));
const lines = ['| setup | boards | boards with a ship hidden | ships hidden | worst board | by |', '| --- | ---: | ---: | ---: | ---: | --- |'];
for (const r of rows) {
  const pct = (a: number, b: number): string => (b ? `${Math.round((100 * a) / b)}%` : '–');
  lines.push(`| ${r.key} | ${r.boards} | ${r.hiddenBoards} (${pct(r.hiddenBoards, r.boards)}) | ${r.hiddenShips}/${r.ships} (${pct(r.hiddenShips, r.ships)}) | ${Math.max(0, r.worst.hidden)} | ${Object.entries(r.byControl).map(([k, v]) => `${k} ${v}`).join(', ')} |`);
}
writeFileSync(join(OUT, 'report.md'), lines.join('\n') + '\n');
console.log(lines.join('\n'));
