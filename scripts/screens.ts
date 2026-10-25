/**
 * Walks the menu pages at several window sizes and checks that they fit: nothing cut off at the bottom or sides of the
 * window (the page itself never scrolls), only the places that scroll on purpose. With --compare it also tells what a
 * change did to every page, by setting the working tree against an earlier commit.
 *
 *   npm run screens                      # build the game, check every page at every size, exit 1 if one doesn't fit
 *   npm run screens:quick                # three sizes: about a minute, for after every change
 *   npm run screens -- --compare         # what the working tree changed on each page since HEAD (exit 1 if anything moved)
 *   npm run screens -- --compare main    # … since that branch, tag or commit
 *
 * The online pages need the relay (`npm run dev:server`); without one they are left out.
 *
 *   --url <url>         look at a game that is already running instead of building one
 *   --relay <url>       the relay the online pages connect to, default ws://localhost:8080
 *   --out <dir>         write <dir>/<size>/<page>.html, .json and .layout.txt (diff two dumps to see what a change did)
 *   --sizes <WxH,..>    window sizes to try
 *   --only <text>       only the pages whose name contains this
 *   --local             leave out the pages that need the relay
 *   --quick             three sizes
 *   --png               also write a screenshot of each page
 *   --jobs <n>          browsers at once, default one for every two cores up to six
 *   --compare [ref]     see above; the other run is kept in .screens-baseline/ and reused until the commit or this script changes
 *   --refresh           with --compare: make the other run again
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { connect as tcp } from 'node:net';
import { availableParallelism } from 'node:os';
import { join, relative } from 'node:path';
import { launchChrome, type Browser } from './chrome';
import { DAY, MEASURE, PAGES, press, QUICK_SIZES, SETTINGS, SIZES, steady, steadyStorage, type Page } from './screens-pages';
import { buildCommit, buildWorkingTree, resolveRef, ROOT, serve } from './serve';

interface Options {
  url: string | null;
  relay: string;
  out: string | null;
  sizes: string[];
  only: string | null;
  localOnly: boolean;
  png: boolean;
  jobs: number;
  compare: string | null;
  refresh: boolean;
}

function parseArgs(argv: string[]): Options {
  const o: Options = {
    url: null, relay: 'ws://localhost:8080', out: null, sizes: SIZES, only: null, localOnly: false, png: false,
    jobs: Math.max(1, Math.min(6, Math.floor(availableParallelism() / 2))), compare: null, refresh: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${flag} needs a value`);
      return v;
    };
    if (flag === '--url') o.url = value();
    else if (flag === '--relay') o.relay = value();
    else if (flag === '--out') o.out = value();
    else if (flag === '--sizes') o.sizes = value().split(',');
    else if (flag === '--only') o.only = value();
    else if (flag === '--local') o.localOnly = true;
    else if (flag === '--quick') o.sizes = QUICK_SIZES;
    else if (flag === '--png') o.png = true;
    else if (flag === '--jobs') o.jobs = Math.max(1, Number(value()));
    else if (flag === '--compare') o.compare = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'HEAD';
    else if (flag === '--refresh') o.refresh = true;
    else throw new Error(`unknown flag ${flag}`);
  }
  return o;
}

interface Result {
  size: string;
  page: string;
  problems: string[];
}

/** Resolves once nothing on the page moves any more: its animations are over and its markup and size have held still for a few frames. */
const SETTLE = `new Promise((done) => {
  const root = document.getElementById('overlay');
  const t0 = performance.now();
  let last = '', still = 0;
  const tick = () => {
    const busy = document.getAnimations().some((a) => a.playState === 'running' && a.effect && a.effect.getTiming().iterations !== Infinity);
    const sig = root.innerHTML.length + ':' + root.scrollHeight + ':' + Math.round(root.getBoundingClientRect().height);
    if (!busy && sig === last) still++; else { still = 0; last = sig; }
    if (still >= 6 || performance.now() - t0 > 3000) return done(still >= 6);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})`;

/** Resolves true once the expression holds, false if it does not within the time. */
const until = (expression: string, ms = 8000): string => `new Promise((done) => {
  const t0 = performance.now();
  const tick = () => {
    if (${expression}) return done(true);
    if (performance.now() - t0 > ${ms}) return done(false);
    setTimeout(tick, 20);
  };
  tick();
})`;

/** Speed of the page's animations while it is looked at: they still end, and fire what waits for them, only sooner. */
const ANIMATION_RATE = 20;

async function visit(browser: Browser, opts: Options, base: string, size: string, page: Page, results: Result[]): Promise<void> {
  const { cdp } = browser;
  const [width, height] = size.split('x').map(Number);
  await browser.resize(width, height, width < 768);
  const fail = (problem: string): void => {
    results.push({ size, page: page.name, problems: [problem] });
  };
  // The settings are in the browser's storage before the game's own code runs.
  const lobby = JSON.stringify({ server: opts.relay, ...page.lobby });
  const { identifier } = await cdp.send<{ identifier: string }>('Page.addScriptToEvaluateOnNewDocument', {
    source: `localStorage.clear(); localStorage.setItem('slingshot.settings.v1', ${JSON.stringify(JSON.stringify(SETTINGS))}); localStorage.setItem('slingshot.lobby.v1', ${JSON.stringify(lobby)});`,
  });
  try {
    await cdp.send('Page.navigate', { url: `${base}?daily=${DAY}` });
    if (!(await cdp.evaluate<boolean>(until(`!!document.querySelector('#overlay .item')`)))) return fail('the menu did not come up');
  } finally {
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
  }
  await browser.playbackRate(ANIMATION_RATE);
  await cdp.evaluate(SETTLE);

  const snap = async (label: string): Promise<void> => {
    await cdp.evaluate(SETTLE);
    const measured = await cdp.evaluate<{ viewport: number[]; scrollers: string[]; cutBottom: string[]; cutSide: string[]; layout: string[] }>(MEASURE);
    const name = label ? `${page.name}__${label}` : page.name;
    const problems = [...measured.cutBottom.map((p) => `cut off below: ${p}`), ...measured.cutSide.map((p) => `cut off at the side: ${p}`)];
    results.push({ size, page: name, problems });
    if (!opts.out) return;
    const dir = join(opts.out, size);
    mkdirSync(dir, { recursive: true });
    const markup = await cdp.evaluate<string>(`document.getElementById('overlay').innerHTML`);
    const storage = await cdp.evaluate<string>(`JSON.stringify(Object.fromEntries(Object.entries(localStorage).sort()))`);
    const { layout, ...rest } = measured;
    writeFileSync(join(dir, `${name}.html`), steady(markup));
    writeFileSync(join(dir, `${name}.json`), JSON.stringify({ ...rest, storage: steadyStorage(JSON.parse(storage) as Record<string, string>) }, null, 2));
    writeFileSync(join(dir, `${name}.layout.txt`), layout.join('\n') + '\n');
    if (opts.png) {
      const { data } = await cdp.send<{ data: string }>('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(dir, `${name}.png`), Buffer.from(data, 'base64'));
    }
  };

  let snapped = false;
  for (const step of page.steps) {
    if ('click' in step) {
      if (!(await cdp.evaluate<boolean>(press(step.click)))) return fail(`nothing to press for ${JSON.stringify(step.click)}`);
      await cdp.evaluate(SETTLE);
    } else if ('type' in step) {
      const typed = await cdp.evaluate<boolean>(`(() => {
        const el = [...document.querySelectorAll(${JSON.stringify(step.type.sel)})].find((e) => e.getClientRects().length > 0);
        if (!el) return false;
        el.focus();
        el.value = ${JSON.stringify(step.type.text)};
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      })()`);
      if (!typed) return fail(`no field for ${step.type.sel}`);
    } else if ('key' in step) {
      await cdp.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(step.key)}, bubbles: true }))`);
      await cdp.evaluate(SETTLE);
    } else if ('until' in step) {
      if (!(await cdp.evaluate<boolean>(until(step.until)))) return fail(`never became true: ${step.until}`);
      await cdp.evaluate(SETTLE);
    } else if ('wait' in step) {
      await new Promise((r) => setTimeout(r, step.wait));
    } else {
      await snap(step.snap);
      snapped = true;
    }
  }
  if (!snapped || !('snap' in page.steps[page.steps.length - 1])) await snap('');
}

/** Visits every page at every size, a few browsers at a time. */
async function visitAll(opts: Options, base: string, pages: Page[], out: string | null): Promise<Result[]> {
  const run = { ...opts, out };
  const queue = opts.sizes.flatMap((size) => pages.map((page) => ({ size, page })));
  const results: Result[] = [];
  const browsers = await Promise.all(Array.from({ length: Math.min(opts.jobs, queue.length) }, () => launchChrome(1280, 800)));
  let next = 0;
  try {
    await Promise.all(browsers.map(async (browser) => {
      while (next < queue.length) {
        const { size, page } = queue[next++];
        try {
          await visit(browser, run, base, size, page, results);
        } catch (error) {
          results.push({ size, page: page.name, problems: [`the page broke the script: ${error instanceof Error ? error.message : String(error)}`] });
        }
      }
    }));
  } finally {
    await Promise.all(browsers.map((browser) => browser.close()));
  }
  return results;
}

function report(opts: Options, results: Result[]): boolean {
  for (const size of opts.sizes) {
    const here = results.filter((r) => r.size === size);
    console.log(`${size}: ${here.filter((r) => r.problems.length === 0).length}/${here.length} pages fit`);
  }
  const failed = results.filter((r) => r.problems.length > 0).sort((a, b) => a.size.localeCompare(b.size) || a.page.localeCompare(b.page));
  for (const r of failed) console.log(`✗ ${r.size} ${r.page}\n    ${r.problems.join('\n    ')}`);
  console.log(failed.length ? `${failed.length} of ${results.length} pages have a problem` : `all ${results.length} pages fit`);
  return failed.length === 0;
}

/** Whether something answers at the relay's address. */
function reachable(address: string): Promise<boolean> {
  return new Promise((resolve) => {
    let url: URL;
    try {
      url = new URL(address);
    } catch {
      return resolve(false);
    }
    const socket = tcp({ host: url.hostname, port: Number(url.port) || (url.protocol === 'wss:' ? 443 : 80) });
    socket.setTimeout(1500);
    socket.on('connect', () => (socket.destroy(), resolve(true)));
    socket.on('timeout', () => (socket.destroy(), resolve(false)));
    socket.on('error', () => resolve(false));
  });
}

/** The files of a dump, as paths below it. */
function filesOf(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((p) => statSync(join(dir, p)).isFile() && !p.endsWith('.png')).sort();
}

/** What differs between two dumps: the files that are not the same, with the first lines that are not. */
function compareDumps(before: string, after: string): boolean {
  const a = new Set(filesOf(before));
  const b = new Set(filesOf(after));
  const changed: { file: string; lines: string[] }[] = [];
  let same = 0;
  for (const file of a) {
    if (!b.has(file)) continue;
    const x = readFileSync(join(before, file), 'utf8');
    const y = readFileSync(join(after, file), 'utf8');
    if (x === y) {
      same++;
      continue;
    }
    const xs = x.split('\n');
    const ys = y.split('\n');
    const lines: string[] = [];
    for (let i = 0; i < Math.max(xs.length, ys.length) && lines.length < 6; i++) {
      if (xs[i] !== ys[i]) lines.push(`${i + 1}: ${(xs[i] ?? '(none)').slice(0, 160)}\n      → ${(ys[i] ?? '(none)').slice(0, 160)}`);
    }
    changed.push({ file, lines });
  }
  const missing = [...a].filter((f) => !b.has(f));
  const added = [...b].filter((f) => !a.has(f));
  // Where it moved first (which sizes, which pages), then what moved in the first few files.
  const sizes = new Map<string, Set<string>>();
  for (const { file } of changed) {
    const [size, name] = file.split('/');
    sizes.set(size, (sizes.get(size) ?? new Set()).add(name.split('__')[0].replace(/\.(html|json|layout\.txt)$/, '')));
  }
  for (const [size, pagesHere] of sizes) console.log(`≠ ${size}: ${pagesHere.size} pages (${[...pagesHere].slice(0, 6).join(', ')}${pagesHere.size > 6 ? ', …' : ''})`);
  for (const { file, lines } of changed.slice(0, 6)) console.log(`  ${file}\n    ${lines.slice(0, 3).join('\n    ')}`);
  for (const f of missing.slice(0, 10)) console.log(`− only before: ${f}`);
  for (const f of added.slice(0, 10)) console.log(`+ only after: ${f}`);
  console.log(`same ${same}, different ${changed.length}, only before ${missing.length}, only after ${added.length}`);
  return changed.length === 0 && missing.length === 0 && added.length === 0;
}

/** Names the run, so the one kept from an earlier commit is not taken for another set of pages, sizes or another version of this script. */
function runKey(opts: Options, pages: Page[]): string {
  const scripts = readdirSync(join(ROOT, 'scripts')).filter((f) => f.startsWith('screens') || f === 'chrome.ts' || f === 'serve.ts');
  const hash = createHash('sha1');
  for (const file of scripts.sort()) hash.update(readFileSync(join(ROOT, 'scripts', file)));
  hash.update(JSON.stringify([opts.sizes, pages.map((p) => p.name)]));
  return hash.digest('hex').slice(0, 8);
}

async function compareRun(opts: Options, pages: Page[]): Promise<boolean> {
  const sha = resolveRef(opts.compare ?? 'HEAD');
  const before = join(ROOT, '.screens-baseline', `${sha.slice(0, 10)}-${runKey(opts, pages)}`);
  if (opts.refresh) rmSync(before, { recursive: true, force: true });
  if (existsSync(before)) {
    console.log(`before: ${relative(ROOT, before)} (kept from an earlier run)`);
  } else {
    console.log(`before: building ${sha.slice(0, 10)} and visiting the pages…`);
    const server = await serve(buildCommit(sha));
    const partial = `${before}.partial`;
    rmSync(partial, { recursive: true, force: true });
    try {
      const results = await visitAll(opts, server.url, pages, partial);
      if (results.some((r) => r.problems.some((p) => !p.startsWith('cut off')))) throw new Error('the script could not get through every page of the earlier version');
    } finally {
      await server.close();
    }
    renameSync(partial, before);
  }
  console.log('after: building the working tree and visiting the pages…');
  const after = join(ROOT, '.screens-current');
  rmSync(after, { recursive: true, force: true });
  const server = await serve(buildWorkingTree());
  let results: Result[];
  try {
    results = await visitAll(opts, server.url, pages, after);
  } finally {
    await server.close();
  }
  const fits = report(opts, results);
  const unchanged = compareDumps(before, after);
  console.log(unchanged ? 'nothing moved' : 'something moved: see above');
  return fits && unchanged;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const online = !opts.localOnly && (await reachable(opts.relay));
  if (!opts.localOnly && !online) console.log(`no relay at ${opts.relay}: the online pages are left out (npm run dev:server starts one)`);
  const pages = PAGES.filter((p) => (online || !p.online) && (!opts.only || p.name.includes(opts.only)));
  if (!pages.length) throw new Error('no page matches');
  if (opts.compare !== null) {
    process.exit((await compareRun(opts, pages)) ? 0 : 1);
  }
  const started = Date.now();
  const server = opts.url ? null : await serve(buildWorkingTree());
  let ok: boolean;
  try {
    ok = report(opts, await visitAll(opts, opts.url ? new URL(opts.url).href : server!.url, pages, opts.out));
  } finally {
    await server?.close();
  }
  console.log(`${Math.round((Date.now() - started) / 1000)} s`);
  if (!ok) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
