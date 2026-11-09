/**
 * Walks the game as it looks on an iPhone 16 and an iPhone 16 Pro Max, held upright and on its side, and writes a
 * screenshot of every screen with a list of what looks wrong in it: things cut off or past the screen's edge, under
 * the notch or the home bar, text that is shortened, tap targets that are small. It also turns the phone several
 * times in a running match and checks that the layout follows (see "turning" below).
 *
 *   npm run mobile:audit                      # build the game, visit everything on both phones in both ways held
 *   npm run mobile:audit -- --only game       # just the screens whose name contains this
 *   npm run mobile:audit -- --devices iphone-16 --orientations portrait
 *   npm run mobile:audit -- --url http://localhost:5173/   # a game that is running already (`npm run dev` has the handle the match screens need)
 *
 * It leaves <out>/index.html (every screenshot, with its findings beside it), <out>/report.md and <out>/report.json.
 * Exit code 1 when a screen has a failure; warnings (shortened text, small targets) are for a person to judge.
 *
 *   --out <dir>            default output/mobile-audit
 *   --devices <a,b>        iphone-16, iphone-16-pro-max (default both)
 *   --orientations <a,b>   portrait, landscape (default both)
 *   --only <text>          only the screens whose name contains this
 *   --relay <url>          the relay the online screens connect to, default ws://localhost:8080; without one they are left out
 *   --dpr <n>              screenshot pixel ratio, default 2 (the phones are 3: it changes file sizes, not the layout)
 *   --lang <en|de>         the game's language, default en
 *   --jobs <n>             browsers at once, default 4
 *
 * What it is not: real iOS Safari. It is Chrome's phone emulation with the phones' CSS sizes, touch input and safe-area
 * insets, so the browser's own bars, the keyboard and Safari's quirks are not in it.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { connect as tcp } from 'node:net';
import { join } from 'node:path';
import { launchChrome, sleep, type Browser } from './chrome';
import { DAY, MEASURE_PHONE, PAGES, perform, press, SETTINGS, SETTLE, until, type Page } from './screens-pages';
import { buildWorkingTree, ROOT, serve } from './serve';

// ————————————————————————————— The phones —————————————————————————————

interface Insets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}
interface Device {
  id: string;
  name: string;
  /** CSS pixels, held upright. */
  width: number;
  height: number;
  dpr: number;
  portrait: Insets;
  landscape: Insets;
}

/** Sizes and safe areas as Apple lists them for the Dynamic Island phones. */
const DEVICES: Device[] = [
  {
    id: 'iphone-16', name: 'iPhone 16', width: 393, height: 852, dpr: 3,
    portrait: { top: 59, bottom: 34, left: 0, right: 0 }, landscape: { top: 0, bottom: 21, left: 59, right: 59 },
  },
  {
    id: 'iphone-16-pro-max', name: 'iPhone 16 Pro Max', width: 440, height: 956, dpr: 3,
    portrait: { top: 62, bottom: 34, left: 0, right: 0 }, landscape: { top: 0, bottom: 21, left: 62, right: 62 },
  },
];
type Orientation = 'portrait' | 'landscape';

interface Options {
  url: string | null;
  out: string;
  devices: string[];
  orientations: Orientation[];
  only: string | null;
  relay: string;
  dpr: number;
  lang: string;
  jobs: number;
}

function parseArgs(argv: string[]): Options {
  const o: Options = {
    url: null, out: join(ROOT, 'output', 'mobile-audit'), devices: DEVICES.map((d) => d.id), orientations: ['portrait', 'landscape'],
    only: null, relay: 'ws://localhost:8080', dpr: 2, lang: 'en', jobs: 4,
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${flag} needs a value`);
      return v;
    };
    if (flag === '--url') o.url = value();
    else if (flag === '--out') o.out = join(process.cwd(), value());
    else if (flag === '--devices') o.devices = value().split(',');
    else if (flag === '--orientations') o.orientations = value().split(',') as Orientation[];
    else if (flag === '--only') o.only = value();
    else if (flag === '--relay') o.relay = value();
    else if (flag === '--dpr') o.dpr = Number(value());
    else if (flag === '--lang') o.lang = value();
    else if (flag === '--jobs') o.jobs = Math.max(1, Number(value()));
    else throw new Error(`unknown flag ${flag}`);
  }
  for (const id of o.devices) if (!DEVICES.some((d) => d.id === id)) throw new Error(`no device ${id} (${DEVICES.map((d) => d.id).join(', ')})`);
  for (const orientation of o.orientations) if (orientation !== 'portrait' && orientation !== 'landscape') throw new Error(`no orientation ${orientation}`);
  return o;
}

// ————————————————————————————— Findings —————————————————————————————

type Severity = 'fail' | 'warn';
interface Finding {
  severity: Severity;
  kind: string;
  detail: string;
}
interface Shot {
  config: string;
  name: string;
  file: string | null;
  findings: Finding[];
}

/** What `MEASURE_PHONE` reports, turned into findings. */
interface Measured {
  viewport: [number, number];
  envInsets: Insets;
  cutOff: string[];
  unsafe: string[];
  cornerUnsafe: string[];
  shortened: string[];
  overflowing: string[];
  smallTargets: string[];
}

function findingsOf(m: Measured, insets: Insets): Finding[] {
  const out: Finding[] = [];
  for (const d of m.cutOff) out.push({ severity: 'fail', kind: 'cut off', detail: d });
  for (const d of m.unsafe) out.push({ severity: 'fail', kind: 'under the notch or home bar', detail: d });
  for (const d of m.cornerUnsafe) out.push({ severity: 'warn', kind: 'in the side safe area (a corner)', detail: d });
  for (const d of m.overflowing) out.push({ severity: 'warn', kind: 'text runs out of its box', detail: d });
  for (const d of m.shortened) out.push({ severity: 'warn', kind: 'text shortened', detail: d });
  for (const d of m.smallTargets) out.push({ severity: 'warn', kind: 'small tap target (< 44 px)', detail: d });
  const seen = m.envInsets;
  if (seen.top !== insets.top || seen.bottom !== insets.bottom || seen.left !== insets.left || seen.right !== insets.right) {
    out.push({ severity: 'warn', kind: 'safe area not seen by the page', detail: `emulated ${JSON.stringify(insets)}, the page reads ${JSON.stringify(seen)}` });
  }
  return out;
}

// ————————————————————————————— One phone, held one way —————————————————————————————

interface Config {
  device: Device;
  orientation: Orientation;
  id: string;
  width: number;
  height: number;
  insets: Insets;
}

const configOf = (device: Device, orientation: Orientation): Config => {
  const landscape = orientation === 'landscape';
  return {
    device, orientation, id: `${device.id}-${orientation}`, width: landscape ? device.height : device.width, height: landscape ? device.width : device.height,
    insets: landscape ? device.landscape : device.portrait,
  };
};

/** Puts the browser on the phone: its size, pixel ratio, touch screen and safe area. */
async function hold(browser: Browser, config: Config, dpr: number): Promise<void> {
  const { cdp } = browser;
  const landscape = config.orientation === 'landscape';
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: config.width, height: config.height, deviceScaleFactor: dpr, mobile: true,
    screenOrientation: { type: landscape ? 'landscapePrimary' : 'portraitPrimary', angle: landscape ? 90 : 0 },
  });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  try {
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: config.insets });
  } catch {
    // An older Chrome: the page reads no insets, and the findings say so.
  }
}

const SPEED = 20;

interface Context {
  browser: Browser;
  config: Config;
  base: string;
  opts: Options;
  shots: Shot[];
  /** Whether the build has `window.slingshot`. */
  handle: boolean;
}

async function screenshot(ctx: Context, name: string): Promise<string> {
  const { data } = await ctx.browser.cdp.send<{ data: string }>('Page.captureScreenshot', { format: 'png' });
  const dir = join(ctx.opts.out, ctx.config.id);
  mkdirSync(dir, { recursive: true });
  const file = `${ctx.config.id}/${name}.png`;
  writeFileSync(join(ctx.opts.out, file), Buffer.from(data, 'base64'));
  return file;
}

/** Looks at the page as it is: a screenshot, and what is wrong with it. */
async function snap(ctx: Context, name: string, extra: Finding[] = []): Promise<void> {
  const { cdp } = ctx.browser;
  await cdp.evaluate(SETTLE);
  const measured = await cdp.evaluate<Measured>(`(${MEASURE_PHONE})(${JSON.stringify(ctx.config.insets)})`);
  const file = await screenshot(ctx, name);
  ctx.shots.push({ config: ctx.config.id, name, file, findings: [...findingsOf(measured, ctx.config.insets), ...extra] });
}

function fail(ctx: Context, name: string, kind: string, detail: string): void {
  ctx.shots.push({ config: ctx.config.id, name, file: null, findings: [{ severity: 'fail', kind, detail }] });
}

/** A fresh page on the phone, with the game's settings in the browser's storage before its own code runs. */
async function open(ctx: Context, settings: Record<string, unknown>, lobby: Record<string, unknown> = {}, fixedDay = false): Promise<boolean> {
  const { cdp } = ctx.browser;
  await hold(ctx.browser, ctx.config, ctx.opts.dpr);
  const { identifier } = await cdp.send<{ identifier: string }>('Page.addScriptToEvaluateOnNewDocument', {
    source: `localStorage.clear(); localStorage.setItem('slingshot.settings.v1', ${JSON.stringify(JSON.stringify({ ...SETTINGS, language: ctx.opts.lang, ...settings }))}); localStorage.setItem('slingshot.lobby.v1', ${JSON.stringify(JSON.stringify(lobby))});`,
  });
  try {
    // A game that names a day opens that day's daily challenge over the title: "today's pick" is then the same on every run, and Back reaches the title.
    await cdp.send('Page.navigate', { url: fixedDay ? `${ctx.base}?daily=${DAY}` : ctx.base });
    if (!(await cdp.evaluate<boolean>(until(`!!document.querySelector('#overlay .item')`)))) return false;
  } finally {
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
  }
  await ctx.browser.playbackRate(SPEED);
  await cdp.evaluate(SETTLE);
  if (fixedDay) {
    if (!(await cdp.evaluate<boolean>(press({ sel: 'button, a, [role=button]', text: 'Back' })))) return false;
    await cdp.evaluate(SETTLE);
  }
  return true;
}

// ————————————————————————————— The menu pages —————————————————————————————

/** The pages of the menu that matter on a phone: every mode's setup, one mode's rules, crew and rule maker, the rest once. */
const MENU_PAGES: Page[] = PAGES.filter((p) => {
  if (p.name === 'game-pause' || /^cards-/.test(p.name) || /^online-(cards|creator)-/.test(p.name)) return false;
  if (/^(rules|crew|creator)-/.test(p.name)) return p.name.endsWith('-classic');
  if (/^online-room-/.test(p.name)) return p.name.endsWith('-classic');
  return true;
});

async function visitMenuPage(ctx: Context, page: Page, relay: string): Promise<void> {
  const { cdp } = ctx.browser;
  if (!(await open(ctx, {}, { server: relay, ...page.lobby }, true))) return fail(ctx, page.name, 'did not load', 'the menu did not come up, or the daily screen had no Back');
  let snapped = false;
  for (const step of page.steps) {
    if ('snap' in step) {
      await snap(ctx, `${page.name}__${step.snap}`);
      snapped = true;
      continue;
    }
    const problem = await perform(cdp, step);
    if (problem) return fail(ctx, page.name, 'script could not follow', problem);
  }
  if (!snapped || !('snap' in page.steps[page.steps.length - 1])) await snap(ctx, page.name);
}

// ————————————————————————————— A running match —————————————————————————————

const PHASE = `(() => { const s = window.slingshot; const m = s && s.match; return m ? m.phase + (m.revealing ? '+reveal' : '') + (m.isHumanTurn ? '+you' : '') : 'none'; })()`;

/** Plays a one-round match as the person would, taking a screenshot the first time each part of it is on screen. */
async function playMatch(ctx: Context, controls: 'wheel' | 'stick'): Promise<void> {
  const { cdp } = ctx.browser;
  const tag = controls === 'wheel' ? 'game' : 'game-stick';
  if (!(await open(ctx, { touchControls: controls }))) return fail(ctx, tag, 'did not load', 'the menu did not come up');
  if (!ctx.handle || !(await cdp.evaluate<boolean>(`!!window.slingshot`))) return fail(ctx, tag, 'no game handle', 'the match screens need a build made with VITE_BENCH=1 or `npm run dev`');
  await cdp.evaluate(`(() => { const s = window.slingshot; Object.assign(s.settings, { seats: ['human', 'hard', 'medium', 'medium', 'off', 'off'], rounds: 1, maxPlanets: 4 }); s.app.start('classic'); return true; })()`);
  const seen = new Set<string>();
  let paused = false;
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    await sleep(150);
    const state = await cdp.evaluate<string>(PHASE);
    const [phase, ...flags] = state.split('+');
    const key = phase + (flags.includes('reveal') ? '-reveal' : '');
    if (phase === 'none') continue;
    if (flags.includes('you')) {
      if (!seen.has('aiming')) {
        seen.add('aiming');
        await sleep(900);
        await snap(ctx, `${tag}__aiming`);
        if (controls === 'wheel') {
          // The other end of the power bar and the wheel, where the readouts are widest.
          await cdp.evaluate(`document.querySelector('#touch-power') && document.querySelector('#touch-power').click()`);
        }
      }
      await cdp.evaluate(`(() => { const b = document.querySelector('#touch-fire'); if (b && !b.hidden && !b.disabled) b.click(); else window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return true; })()`);
      continue;
    }
    if (phase === 'flying' && !paused) {
      paused = true;
      await sleep(250);
      await snap(ctx, `${tag}__flying`);
      // The pause button, as a finger would press it; the menu it opens is then closed by its own Resume.
      await cdp.evaluate(`(() => { const b = document.querySelector('#pause-button'); if (b && !b.hidden) b.click(); return true; })()`);
      await cdp.evaluate(until(`!!document.querySelector('#overlay .item')`, 3000));
      await sleep(400);
      await snap(ctx, `${tag}__pause`);
      if (!(await cdp.evaluate<boolean>(press({ sel: 'button, [role=button], .item', text: 'Resume' })))) fail(ctx, `${tag}__pause`, 'script could not follow', 'the pause menu has no Resume');
      await sleep(300);
      continue;
    }
    if ((phase === 'killcam' || phase === 'roundOver') && !seen.has(key)) {
      seen.add(key);
      await sleep(phase === 'killcam' ? 700 : 400);
      await snap(ctx, `${tag}__${phase === 'killcam' ? 'killcam' : 'round-over'}`);
    }
    if (phase === 'roundOver' || phase === 'killcam') {
      await cdp.evaluate(`(() => { const m = window.slingshot.match; if (m && (m.phase === 'roundOver' || m.phase === 'killcam')) m.advance(); return true; })()`);
      continue;
    }
    if (phase === 'gameOver') {
      await cdp.evaluate(until(`!!document.querySelector('#overlay .item, #overlay button')`, 6000));
      await sleep(1200);
      await snap(ctx, `${tag}__game-over`);
      return;
    }
  }
  fail(ctx, tag, 'match did not finish', `reached: ${[...seen].join(', ') || 'nothing'}`);
}

// ————————————————————————————— Turning the phone —————————————————————————————

const LAYOUT = `(() => {
  const c = document.querySelector('#stage');
  const r = c.getBoundingClientRect();
  return {
    w: innerWidth, h: innerHeight, dpr: devicePixelRatio,
    coarse: matchMedia('(pointer: coarse)').matches,
    upright: document.documentElement.classList.contains('upright'),
    canvasCss: [Math.round(r.width), Math.round(r.height)],
    canvasBitmap: [c.width, c.height],
  };
})()`;
interface Layout {
  w: number;
  h: number;
  dpr: number;
  coarse: boolean;
  upright: boolean;
  canvasCss: [number, number];
  canvasBitmap: [number, number];
}

/** What the page should look like on a phone of this size: the canvas as big as the window, sharp, and the upright layout whenever the window is tall. */
function layoutProblem(l: Layout): string | null {
  if (!l.coarse) return null;
  if (l.canvasCss[0] !== l.w || l.canvasCss[1] !== l.h) return `canvas is ${l.canvasCss.join('×')} in a window of ${l.w}×${l.h}`;
  if (l.canvasBitmap[0] !== Math.round(l.w * l.dpr) || l.canvasBitmap[1] !== Math.round(l.h * l.dpr)) return `canvas has ${l.canvasBitmap.join('×')} pixels, ${Math.round(l.w * l.dpr)}×${Math.round(l.h * l.dpr)} wanted`;
  const tall = l.h >= l.w * 1.3;
  if (l.upright !== tall) return `the ${tall ? 'upright' : 'wide'} layout is ${tall ? 'missing' : 'still on'} in a window of ${l.w}×${l.h}`;
  return null;
}

/**
 * Turns the phone portrait → landscape → portrait … in a running match and checks, after every turn, that the layout
 * followed: how long it took and what it looked like. Once with the window changing size alone, once with the browser
 * also switching its pointer off and on around the turn, which is what an emulator does (and what once left the upright
 * layout missing: issue 214).
 */
async function turning(ctx: Context): Promise<void> {
  const { cdp } = ctx.browser;
  const { device } = ctx.config;
  for (const flip of [false, true]) {
    const tag = `turning${flip ? '-pointer-flip' : ''}`;
    if (!(await open(ctx, {}))) return fail(ctx, tag, 'did not load', 'the menu did not come up');
    if (ctx.handle && (await cdp.evaluate<boolean>(`!!window.slingshot`))) {
      await cdp.evaluate(`(() => { const s = window.slingshot; Object.assign(s.settings, { seats: ['human', 'medium', 'medium', 'medium', 'off', 'off'], rounds: 3 }); s.app.start('classic'); return true; })()`);
      await cdp.evaluate(until(`window.slingshot.match && window.slingshot.match.isHumanTurn`, 15_000));
    }
    const problems: string[] = [];
    for (let turn = 1; turn <= 6; turn++) {
      const landscape = turn % 2 === 1;
      const width = landscape ? device.height : device.width;
      const height = landscape ? device.width : device.height;
      const insets = landscape ? device.landscape : device.portrait;
      if (flip) await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width, height, deviceScaleFactor: ctx.opts.dpr, mobile: true,
        screenOrientation: { type: landscape ? 'landscapePrimary' : 'portraitPrimary', angle: landscape ? 90 : 0 },
      });
      try {
        await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets });
      } catch {
        // see `hold`
      }
      if (flip) {
        await sleep(240);
        await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      }
      const t0 = Date.now();
      let last: Layout = await cdp.evaluate<Layout>(LAYOUT);
      let problem = layoutProblem(last);
      while (problem && Date.now() - t0 < 4000) {
        await sleep(100);
        last = await cdp.evaluate<Layout>(LAYOUT);
        problem = layoutProblem(last);
      }
      const took = Date.now() - t0;
      if (problem) problems.push(`turn ${turn} (${landscape ? 'landscape' : 'portrait'}): ${problem}, still after ${took} ms`);
      else if (took > 1500) problems.push(`turn ${turn} (${landscape ? 'landscape' : 'portrait'}): took ${took} ms to follow`);
      // Landscape first, then back: look at both ends of the last pair.
      if (turn >= 5) {
        const ctxHere: Context = { ...ctx, config: { ...ctx.config, id: ctx.config.id, width, height, insets } };
        await snap(ctxHere, `${tag}__turn-${turn}-${landscape ? 'landscape' : 'portrait'}`, problem ? [{ severity: 'fail', kind: 'layout did not follow the turn', detail: problem }] : []);
      }
    }
    ctx.shots.push({
      config: ctx.config.id, name: `${tag}__summary`, file: null,
      findings: problems.map((detail) => ({ severity: 'fail', kind: 'layout did not follow the turn', detail })),
    });
    console.log(`${ctx.config.id} ${tag}: ${problems.length ? problems.join('; ') : 'six turns, the layout followed each'}`);
  }
}

// ————————————————————————————— Running it —————————————————————————————

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

async function visitConfig(config: Config, opts: Options, base: string, relayUp: boolean, handle: boolean, shots: Shot[]): Promise<void> {
  const browser = await launchChrome(config.width, config.height);
  const ctx: Context = { browser, config, base, opts, shots, handle };
  const wanted = (name: string): boolean => !opts.only || name.includes(opts.only);
  try {
    for (const page of MENU_PAGES) {
      if (page.online && !relayUp) continue;
      if (!wanted(page.name)) continue;
      try {
        await visitMenuPage(ctx, page, opts.relay);
      } catch (error) {
        fail(ctx, page.name, 'the page broke the script', error instanceof Error ? error.message : String(error));
      }
    }
    for (const controls of ['wheel', 'stick'] as const) {
      const name = controls === 'wheel' ? 'game' : 'game-stick';
      if (!wanted(name)) continue;
      try {
        await playMatch(ctx, controls);
      } catch (error) {
        fail(ctx, name, 'the match broke the script', error instanceof Error ? error.message : String(error));
      }
    }
    // Turning is the same on both ends: do it once per phone.
    if (config.orientation === opts.orientations[0] && wanted('turning')) {
      try {
        await turning(ctx);
      } catch (error) {
        fail(ctx, 'turning', 'turning broke the script', error instanceof Error ? error.message : String(error));
      }
    }
  } finally {
    await browser.close();
  }
}

// ————————————————————————————— The report —————————————————————————————

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function writeReport(opts: Options, configs: Config[], shots: Shot[]): { fails: number; warns: number } {
  const count = (list: Shot[], s: Severity): number => list.reduce((n, shot) => n + shot.findings.filter((f) => f.severity === s).length, 0);
  const fails = count(shots, 'fail');
  const warns = count(shots, 'warn');
  const byConfig = (id: string): Shot[] => shots.filter((s) => s.config === id).sort((a, b) => a.name.localeCompare(b.name));
  const md: string[] = [`# Mobile audit`, '', `${shots.length} screens on ${configs.length} phone setups: **${fails} failures**, ${warns} warnings.`, ''];
  const html: string[] = [];
  for (const config of configs) {
    const list = byConfig(config.id);
    md.push(`## ${config.device.name}, ${config.orientation} (${config.width}×${config.height})`, '');
    html.push(`<section><h2>${esc(config.device.name)}, ${config.orientation} <small>${config.width}×${config.height} · ${count(list, 'fail')} failures · ${count(list, 'warn')} warnings</small></h2><div class="grid">`);
    for (const shot of list) {
      const bad = shot.findings.filter((f) => f.severity === 'fail').length;
      md.push(`- \`${shot.name}\`${shot.file ? ` ([png](${shot.file}))` : ''}${shot.findings.length ? '' : ' — clean'}`);
      for (const f of shot.findings) md.push(`  - ${f.severity === 'fail' ? '**FAIL**' : 'warn'} ${f.kind}: ${f.detail}`);
      html.push(`<figure class="${bad ? 'bad' : shot.findings.length ? 'warn' : 'ok'}">${shot.file ? `<a href="${shot.file}"><img loading="lazy" src="${shot.file}" alt="${esc(shot.name)}"></a>` : ''}<figcaption><b>${esc(shot.name)}</b><ul>${shot.findings.map((f) => `<li class="${f.severity}">${esc(f.kind)}: ${esc(f.detail)}</li>`).join('')}</ul></figcaption></figure>`);
    }
    md.push('');
    html.push('</div></section>');
  }
  mkdirSync(opts.out, { recursive: true });
  writeFileSync(join(opts.out, 'report.md'), md.join('\n') + '\n');
  writeFileSync(join(opts.out, 'report.json'), JSON.stringify({ fails, warns, shots }, null, 2));
  writeFileSync(join(opts.out, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Mobile audit</title><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font:14px system-ui;margin:16px;background:#10141c;color:#dde}h2 small{font-weight:400;color:#9ab}.grid{display:flex;flex-wrap:wrap;gap:12px}figure{margin:0;width:260px;border:2px solid #345;border-radius:6px;padding:6px;background:#161c28}figure.bad{border-color:#e55}figure.warn{border-color:#ca4}img{width:100%;display:block}figcaption{font-size:12px;word-break:break-word}ul{padding-left:16px;margin:4px 0}li.fail{color:#f88}li.warn{color:#eb6}</style>
<h1>Mobile audit</h1><p>${shots.length} screens: ${fails} failures, ${warns} warnings. Red border: a failure; amber: warnings only.</p>${html.join('')}`);
  return { fails, warns };
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const relayUp = await reachable(opts.relay);
  if (!relayUp) console.log(`no relay at ${opts.relay}: the online screens are left out (npm run dev:server starts one)`);
  const configs = opts.devices.flatMap((id) => opts.orientations.map((o) => configOf(DEVICES.find((d) => d.id === id)!, o)));
  rmSync(opts.out, { recursive: true, force: true });
  mkdirSync(opts.out, { recursive: true });
  const started = Date.now();
  const server = opts.url ? null : await serve(buildWorkingTree({ VITE_BENCH: '1' }));
  const base = opts.url ? new URL(opts.url).href : server!.url;
  const shots: Shot[] = [];
  try {
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(opts.jobs, configs.length) }, async () => {
      while (next < configs.length) await visitConfig(configs[next++], opts, base, relayUp, true, shots);
    }));
  } finally {
    await server?.close();
  }
  const { fails, warns } = writeReport(opts, configs, shots);
  for (const config of configs) {
    const list = shots.filter((s) => s.config === config.id);
    console.log(`${config.id}: ${list.length} screens, ${list.filter((s) => s.findings.some((f) => f.severity === 'fail')).length} with failures, ${list.filter((s) => s.findings.length && !s.findings.some((f) => f.severity === 'fail')).length} with warnings only`);
  }
  console.log(`${fails} failures, ${warns} warnings · ${Math.round((Date.now() - started) / 1000)} s · ${join(opts.out, 'index.html')}`);
  if (fails) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
