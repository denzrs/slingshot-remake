// What the statistics cost in a real browser: frame times of the game with and without them.
//
//   npm run build:server && npm run bench:browser
//
// The game is built twice – `off`, as a build without a relay is (nothing is ever sent), and `on`, pointed at a
// relay that keeps statistics – and each is driven in headless Chromium through the DevTools protocol while the page
// measures its own frames (`requestAnimationFrame` intervals), long tasks (over 50 ms) and heap. The scenarios:
//
//   title    the title screen's attract match: the game's rendering with nothing going on
//   match    a match between four CPUs, played to its end (the `on` build reports it to the relay as a local game)
//   replay   a recorded match, flown again from its recording
//   panel    the settings screen, idle: any dialog over the animated field, for the statistics page to be read against
//   stats    (`on` only) the statistics page: a year of days and fifty games, and switching what the heatmap shows
//
// Headless Chromium draws in software, so the absolute frame times say little; what to read is `on` against `off`.
//
// Knobs (environment): SECONDS (12, per scenario that is not played to its end), MATCH_SECONDS (60, at most, for the match),
// SCENARIOS (a comma-separated subset of title,match,replay,panel,stats; default all), CHROME (the browser binary; default `chromium`), BENCH_BIN (the relay binary), BENCH_JSON (a path: the figures as JSON).

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { createMatch, type VersusMode } from '../src/game';
import { RIDERS } from '../src/game/replay';
import { rulesOf } from '../src/lobbyPrefs';
import { turnReport } from '../src/roundReport';
import { cloneSettings, DEFAULT_SETTINGS, type Seat } from '../src/settings';

const SECONDS = Number(process.env.SECONDS ?? 12);
const MATCH_SECONDS = Number(process.env.MATCH_SECONDS ?? 60);
const CHROME = process.env.CHROME ?? 'chromium';
const SCENARIOS = new Set((process.env.SCENARIOS ?? 'title,match,replay,panel,stats').split(','));
const RELAY_PORT = 18090;
const root = join(import.meta.dirname, '..');
const BIN = process.env.BENCH_BIN ?? [join(root, 'server', 'target', 'release', 'slingshot-server'), join(root, 'server', 'target', 'debug', 'slingshot-server')].find(existsSync);

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const pct = (sorted: number[], p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : NaN);
const fmt = (v: number, digits = 1) => (Number.isFinite(v) ? v.toLocaleString('en-US', { maximumFractionDigits: digits }) : 'n/a');

const cleanups: (() => void)[] = [];
process.on('exit', () => cleanups.forEach((fn) => fn()));

function launch(command: string, args: string[], env: Record<string, string> = {}): ChildProcess {
  // In a group of its own, so that what `npx` started goes with it.
  const child = spawn(command, args, { env: { ...process.env, ...env }, stdio: 'ignore', cwd: root, detached: true });
  cleanups.push(() => {
    try {
      process.kill(-child.pid!, 'SIGKILL');
    } catch {
      /* already gone */
    }
  });
  return child;
}

async function waitForHttp(url: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(100);
  }
  throw new Error(`${url} did not come up`);
}

// ————————————————————————————— The game, built twice —————————————————————————————

const work = mkdtempSync(join(tmpdir(), 'slingshot-browser-bench-'));
cleanups.push(() => rmSync(work, { recursive: true, force: true }));

function build(variant: 'off' | 'on'): string {
  const outDir = join(work, `dist-${variant}`);
  const env = { ...process.env, VITE_MULTIPLAYER_SERVER: variant === 'on' ? `ws://localhost:${RELAY_PORT}` : '', VITE_APP_VERSION: `bench-${variant}`, VITE_BENCH: '1' };
  const built = spawnSync('npx', ['vite', 'build', '--outDir', outDir, '--emptyOutDir'], { cwd: root, env, encoding: 'utf8' });
  if (built.status !== 0) throw new Error(`vite build failed:\n${built.stdout}\n${built.stderr}`);
  return outDir;
}

// ————————————————————————————— A relay with a year of statistics —————————————————————————————

/** Starts the relay on a database that already holds a year of days and fifty games, as a relay that has been up for a while does. */
async function startRelay(): Promise<void> {
  const db = join(work, 'slingshot.db');
  const env = { PORT: String(RELAY_PORT), ALLOW_ALL_ORIGINS: '1', ALLOWED_ORIGINS: '', STATS: '1', DATABASE: db, RUST_LOG: 'warn', CONNECTIONS_PER_IP_PER_SECOND: '1000', MAX_MESSAGES_PER_SECOND: '100000', MAX_BYTES_PER_SECOND: '1000000000' };
  // The first start only makes the tables.
  const first = launch(BIN!, [], env);
  await sleep(1000);
  first.kill('SIGTERM');
  await new Promise((r) => first.once('exit', r));
  const seed = `
import datetime, random, sqlite3, time
random.seed(7)
db = sqlite3.connect("${db}", timeout=5)
today = datetime.datetime.now(datetime.timezone.utc).date()
for i in range(365):
    d = today - datetime.timedelta(days=i)
    if random.random() < 0.4: continue
    r = random.choice([1, 2, 3, 5, 8, 13, 21])
    db.execute("insert or replace into stat_days values (?,?,?)", (d.isoformat(), r, r * random.randint(200, 900)))
    for p in range(random.randint(1, 6)): db.execute("insert or ignore into stat_day_players values (?,?)", (d.isoformat(), "p%d-%d" % (i, p)))
now = int(time.time())
for g in range(50):
    mid = "%016x" % g
    db.execute("insert into stat_matches (match_id,at,seed,game_mode,mode,rules,seats,replayable,source) values (?,?,?,?,?,?,?,?,?)", (mid, now - g * 7000, g, "classic", "ffa", "{}", "[]", 0, "online"))
    for rd in (1, 2, 3):
        db.execute("insert into stat_rounds (match_id,room_id,round,at,day,game_mode,mode,rules,humans,cpus,spectators,title,survivor,team,seconds,planets) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (mid, "r", rd, now - g * 7000 - rd * 100, today.isoformat(), "classic", "ffa", "{}", 2, 1, 0, "hit", 0, None, 30.0, 3))
        db.execute("insert into stat_shots (match_id,round,turn,n,at,seat,angle,power,fork,hits,points) values (?,?,?,?,?,?,?,?,?,?,?)", (mid, rd, 1, 1, now, 0, 10.0, 50.0, 0, 1, random.randint(100, 900)))
db.commit()
`;
  const seeded = spawnSync('python3', ['-I', '-c', seed], { encoding: 'utf8' });
  if (seeded.status !== 0) throw new Error(`could not seed the statistics: ${seeded.stderr}`);
  launch(BIN!, [], env);
  const deadline = Date.now() + 10_000;
  for (;;) {
    try {
      await new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(`ws://localhost:${RELAY_PORT}`);
        ws.once('open', () => (ws.close(), resolve()));
        ws.once('error', reject);
      });
      return;
    } catch {
      if (Date.now() > deadline) throw new Error('the relay did not come up');
      await sleep(100);
    }
  }
}

// ————————————————————————————— Driving the browser —————————————————————————————

interface Page {
  eval<T = unknown>(expression: string): Promise<T>;
  close(): void;
}

async function openPage(url: string, port: number): Promise<Page> {
  const profile = mkdtempSync(join(work, 'profile-'));
  const chrome = launch(CHROME, ['--headless=new', '--no-sandbox', `--remote-debugging-port=${port}`, '--window-size=1280,800', `--user-data-dir=${profile}`, 'about:blank']);
  let page: { webSocketDebuggerUrl: string } | undefined;
  for (let i = 0; i < 80 && !page; i++) {
    try {
      page = ((await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as { type: string; webSocketDebuggerUrl: string }[]).find((t) => t.type === 'page');
    } catch {
      /* not up yet */
    }
    if (!page) await sleep(200);
  }
  if (!page) throw new Error('the browser did not start');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.once('open', r));
  let id = 0;
  const pending = new Map<number, (message: { result?: { result?: { value?: unknown; description?: string }; exceptionDetails?: unknown } }) => void>();
  ws.on('message', (data) => {
    const message = JSON.parse(String(data));
    pending.get(message.id)?.(message);
  });
  const call = (method: string, params = {}) => new Promise<{ result?: { result?: { value?: unknown; description?: string }; exceptionDetails?: unknown } }>((resolve) => {
    const n = ++id;
    pending.set(n, resolve);
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await call('Page.enable');
  await call('Page.navigate', { url });
  await sleep(2500);
  return {
    async eval<T>(expression: string): Promise<T> {
      const reply = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (reply.result?.exceptionDetails) throw new Error(`in the page: ${JSON.stringify(reply.result.exceptionDetails)}`);
      return reply.result?.result?.value as T;
    },
    close() {
      ws.close();
      try {
        process.kill(-chrome.pid!, 'SIGKILL');
      } catch {
        /* already gone */
      }
    },
  };
}

/** Starts the page's own frame meter; `stopMeter` hands back what it saw. */
const START_METER = `(() => {
  const m = (window.__meter = { frames: [], long: [], last: performance.now(), on: true });
  const tick = (now) => { if (!m.on) return; m.frames.push(now - m.last); m.last = now; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  try { new PerformanceObserver((list) => list.getEntries().forEach((e) => m.long.push(e.duration))).observe({ entryTypes: ['longtask'] }); } catch {}
  return true;
})()`;
const STOP_METER = `(() => { const m = window.__meter; m.on = false; return { frames: m.frames.slice(1), long: m.long, heap: performance.memory ? performance.memory.usedJSHeapSize : null }; })()`;

interface Measured {
  frames: number;
  fps: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  slow: number;
  longTasks: number;
  longMs: number;
  heapMb: number;
  seconds: number;
}

async function measure(page: Page, run: () => Promise<void>): Promise<Measured> {
  await page.eval(START_METER);
  const t0 = performance.now();
  await run();
  const seconds = (performance.now() - t0) / 1000;
  const got = await page.eval<{ frames: number[]; long: number[]; heap: number | null }>(STOP_METER);
  const frames = [...got.frames].sort((a, b) => a - b);
  return {
    frames: frames.length,
    fps: frames.length / seconds,
    p50: pct(frames, 0.5),
    p95: pct(frames, 0.95),
    p99: pct(frames, 0.99),
    max: frames.at(-1) ?? NaN,
    slow: frames.filter((ms) => ms > 1000 / 30).length,
    longTasks: got.long.length,
    longMs: got.long.reduce((sum, ms) => sum + ms, 0),
    heapMb: got.heap === null ? NaN : got.heap / 1024 / 1024,
    seconds,
  };
}

// ————————————————————————————— A recorded match to fly again —————————————————————————————

/** A seeded match played in Node, as the host's reports hold it: what the page is given to replay. */
function recordedMatch() {
  const seats: Seat[] = ['hard', 'medium', 'medium', 'hard', 'off', 'off'];
  const mode: VersusMode = 'horizon';
  const settings = { ...cloneSettings(DEFAULT_SETTINGS), rounds: 2, seats, powerUps: true, maxPlanets: 5 };
  const match = createMatch(mode, settings, { seats, seed: 21, deterministicCpu: true, simultaneous: true });
  const reports: ReturnType<typeof turnReport>[] = [];
  match.onTurnEnd(() => reports.push(JSON.parse(JSON.stringify(turnReport(match)))));
  for (let i = 0; i < 400_000 && match.phase !== 'gameOver'; i++) {
    match.update(1 / 60);
    if (match.phase === 'roundOver' && match.phaseTime > 1) match.advance();
  }
  return {
    gameMode: mode,
    mode: 'ffa',
    rules: rulesOf(settings),
    seed: 21,
    seats: seats.filter((s) => s !== 'off').map((cpu) => ({ cpu, team: null })),
    turns: reports.map((r) => ({
      round: r.round,
      turn: r.turn,
      placements: r.placements,
      shots: r.shots.filter((s) => !s.fork).map((s) => ({ player: s.player, angle: s.angle, power: s.power, rider: s.rider ?? RIDERS.find((x) => x === s.powerUp) ?? null, splitAt: s.splitAt })),
    })),
  };
}

// ————————————————————————————— The scenarios —————————————————————————————

type Scenario = 'title' | 'match' | 'replay' | 'panel' | 'stats';
const results: Record<string, Partial<Record<Scenario, Measured>>> = { off: {}, on: {} };

async function runVariant(variant: 'off' | 'on', url: string, port: number, replay: unknown): Promise<void> {
  console.log(`\n— ${variant} build (${variant === 'on' ? 'a relay is set: games are told to it' : 'no relay: nothing is sent'})`);
  const page = await openPage(url, port);
  try {
    if (SCENARIOS.has('title')) results[variant].title = await measure(page, () => sleep(SECONDS * 1000));

    // A match between four CPUs, played to its end (or to the time allowed).
    if (SCENARIOS.has('match')) await page.eval(`(() => { const s = window.slingshot; Object.assign(s.settings, { seats: ['hard', 'medium', 'medium', 'hard', 'off', 'off'], rounds: 1, maxPlanets: 4 }); s.app.start('classic'); return true; })()`);
    if (SCENARIOS.has('match')) results[variant].match = await measure(page, async () => {
      const deadline = performance.now() + MATCH_SECONDS * 1000;
      while (performance.now() < deadline) {
        await sleep(500);
        // Rounds and the end of the game wait for a person: press continue for them.
        const phase = await page.eval<string>(`(() => { const m = window.slingshot.match; if (m && (m.phase === 'roundOver' || m.phase === 'killcam')) m.advance(); return m ? m.phase : 'none'; })()`);
        if (phase === 'gameOver') return;
      }
    });
    await sleep(500);

    if (SCENARIOS.has('replay')) await page.eval(`(() => { window.slingshot.app.toTitle(); window.slingshot.app.watchReplay(${JSON.stringify(replay)}); return true; })()`);
    if (SCENARIOS.has('replay')) results[variant].replay = await measure(page, async () => {
      const deadline = performance.now() + MATCH_SECONDS * 1000;
      while (performance.now() < deadline) {
        await sleep(500);
        const state = await page.eval<string>(`(() => { const m = window.slingshot.match; if (m && (m.phase === 'roundOver' || m.phase === 'killcam')) m.advance(); return m ? m.replayState + ':' + m.phase : 'none'; })()`);
        if (state.startsWith('finished') || state.endsWith('gameOver')) return;
      }
    });

    if (SCENARIOS.has('panel')) {
      await page.eval(`(() => { window.slingshot.app.toTitle(); return true; })()`);
      await sleep(500);
      await page.eval(`[...document.querySelectorAll('.item')].find((e) => /Einstellungen|Settings/.test(e.textContent))?.click() ?? false`);
      await sleep(1000);
      results[variant].panel = await measure(page, () => sleep(5000));
    }

    if (variant === 'on' && SCENARIOS.has('stats')) {
      await page.eval(`(() => { window.slingshot.app.toTitle(); return true; })()`);
      await sleep(500);
      await page.eval(`[...document.querySelectorAll('.item')].find((e) => /Statist/.test(e.textContent))?.click() ?? false`);
      results[variant].stats = await measure(page, async () => {
        await sleep(2500);
        // What the heatmap shows, switched a few times: each is a repaint of a year of squares.
        for (const label of ['Players', 'Spieler', 'Points', 'Punkte', 'Rounds', 'Runden', 'Players', 'Spieler']) {
          await page.eval(`[...document.querySelectorAll('.segmented__option')].find((e) => e.textContent.trim() === ${JSON.stringify(label)})?.click()`);
          await sleep(500);
        }
      });
    }
  } finally {
    page.close();
  }
}

// ————————————————————————————— Main —————————————————————————————

if (!BIN || !existsSync(BIN)) {
  console.error('No relay binary: run `npm run build:server` first (or set BENCH_BIN).');
  process.exit(1);
}
if (spawnSync(CHROME, ['--version']).status !== 0) {
  console.error(`No browser: ${CHROME} did not run (set CHROME).`);
  process.exit(1);
}
if (BIN.includes(join('target', 'debug'))) console.warn('Using the debug relay: the figures for the relay say little about production.');

const replay = recordedMatch();
console.log(`recorded match: ${replay.turns.length} turns of ${replay.seats.length} CPUs`);
await startRelay();
const dirs = { off: build('off'), on: build('on') };
const previews = (['off', 'on'] as const).map((variant, i) => {
  const port = 18091 + i;
  launch('npx', ['vite', 'preview', '--outDir', dirs[variant], '--port', String(port), '--strictPort']);
  return { variant, port };
});
for (const { port } of previews) await waitForHttp(`http://localhost:${port}/`);
for (const [i, { variant, port }] of previews.entries()) await runVariant(variant, `http://localhost:${port}/`, 19300 + i, replay);

const line = (...cells: string[]) => console.log(cells[0].padEnd(18) + cells.slice(1).map((c) => c.padStart(11)).join(''));
for (const scenario of ['title', 'match', 'replay', 'panel', 'stats'] as Scenario[]) {
  console.log(`\n${scenario}`);
  line('', 'fps', 'p50 ms', 'p95 ms', 'p99 ms', 'max ms', '> 33 ms', 'long tasks', 'long ms', 'heap MB', 'seconds');
  for (const variant of ['off', 'on'] as const) {
    const m = results[variant][scenario];
    if (!m) continue;
    line(`${variant} build`, fmt(m.fps), fmt(m.p50), fmt(m.p95), fmt(m.p99), fmt(m.max), fmt(m.slow, 0), fmt(m.longTasks, 0), fmt(m.longMs, 0), fmt(m.heapMb), fmt(m.seconds));
  }
}
if (process.env.BENCH_JSON) writeFileSync(process.env.BENCH_JSON, JSON.stringify(results, null, 2));
process.exit(0);
