/**
 * Screenshots of the running game for the What's New dialog (and anything else that wants a picture).
 *
 *   npm run dev                      # in another terminal
 *   npm run shot -- --out src/news/images/refined-look.webp --settings '{"look":"refined"}' \
 *     --click "Einstellungen" --mark "Refined Look"
 *
 * Drives a headless Chrome over the DevTools protocol, so it needs Chrome installed
 * (set CHROME_PATH if it isn't where this script looks).
 *
 *   --out <file>        where to write it; the format follows the extension (.webp, .png, .jpg)
 *   --url <url>         default http://localhost:5173/ (`?news=off` is added, so the What's New dialog stays out of the shot; pass `?news` to shoot it)
 *   --size <WxH>        viewport, default 1280x720 (keep 16:9 for the dialog)
 *   --settings <json>   merged into the saved settings before the page loads; a German UI unless it says otherwise
 *   --click <text>      press the button with this text, once per flag, in order
 *   --mark <text>       draw a ring around the smallest element showing this text, once per flag
 *   --wait <ms>         how long to let the page settle before the shot, default 1500
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter((p): p is string => !!p);

interface Options {
  out: string;
  url: string;
  width: number;
  height: number;
  settings: Record<string, unknown>;
  clicks: string[];
  marks: string[];
  wait: number;
}

function parseArgs(argv: string[]): Options {
  const o: Options = { out: '', url: 'http://localhost:5173/', width: 1280, height: 720, settings: {}, clicks: [], marks: [], wait: 1500 };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${flag} needs a value`);
      return v;
    };
    if (flag === '--out') o.out = value();
    else if (flag === '--url') o.url = value();
    else if (flag === '--size') {
      const [w, h] = value().split('x').map(Number);
      if (!w || !h) throw new Error('--size wants WIDTHxHEIGHT, e.g. 1280x720');
      o.width = w;
      o.height = h;
    } else if (flag === '--settings') o.settings = JSON.parse(value()) as Record<string, unknown>;
    else if (flag === '--click') o.clicks.push(value());
    else if (flag === '--mark') o.marks.push(value());
    else if (flag === '--wait') o.wait = Number(value());
    else throw new Error(`unknown flag ${flag}`);
  }
  if (!o.out) throw new Error('--out <file> is required');
  return o;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

/** A tiny DevTools-protocol client: one socket, numbered requests. */
class Cdp {
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private constructor(private readonly ws: WebSocket) {
    ws.on('message', (data) => {
      const msg = JSON.parse(String(data)) as { id?: number; result?: unknown; error?: { message: string } };
      if (msg.id === undefined) return;
      const waiting = this.pending.get(msg.id);
      if (!waiting) return;
      this.pending.delete(msg.id);
      if (msg.error) waiting.reject(new Error(msg.error.message));
      else waiting.resolve(msg.result);
    });
  }

  static connect(url: string): Promise<Cdp> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.on('open', () => resolve(new Cdp(ws)));
      ws.on('error', reject);
    });
  }

  send<T = unknown>(method: string, params: object = {}): Promise<T> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate<T = unknown>(expression: string): Promise<T> {
    const r = await this.send<{ result: { value: T }; exceptionDetails?: { text: string; exception?: { description?: string } } }>('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  }

  close(): void {
    this.ws.close();
  }
}

async function waitForDebugger(port: number): Promise<string> {
  for (let i = 0; i < 100; i++) {
    try {
      const targets = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as { type: string; webSocketDebuggerUrl: string }[];
      const page = targets.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      // Chrome is still starting.
    }
    await sleep(100);
  }
  throw new Error('Chrome did not come up');
}

const MARK_STYLE = 'outline: 3px solid #ffd27a; outline-offset: 4px; border-radius: 4px; box-shadow: 0 0 24px rgb(255 210 122 / 0.55);';

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const chrome = CHROME_CANDIDATES.find((path) => existsSync(path));
  if (!chrome) throw new Error('No Chrome found: set CHROME_PATH');
  const port = await freePort();
  const profile = mkdtempSync(join(tmpdir(), 'slingshot-shot-'));
  const proc: ChildProcess = spawn(chrome, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    `--window-size=${opts.width},${opts.height}`,
    '--hide-scrollbars',
    '--no-first-run',
    '--disable-gpu-vsync',
    'about:blank',
  ], { stdio: 'ignore' });
  try {
    const cdp = await Cdp.connect(await waitForDebugger(port));
    await cdp.send('Page.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: opts.width, height: opts.height, deviceScaleFactor: 1, mobile: false });
    // Seed the storage on the game's own origin, then load it for real.
    const origin = new URL(opts.url).origin;
    await cdp.send('Page.navigate', { url: `${origin}/favicon.svg` });
    await sleep(500);
    const settings = JSON.stringify({ language: 'de', ...opts.settings });
    await cdp.evaluate(`localStorage.setItem('slingshot.settings.v1', ${JSON.stringify(settings)}); true`);
    const target = new URL(opts.url);
    if (!target.searchParams.has('news')) target.searchParams.set('news', 'off');
    await cdp.send('Page.navigate', { url: target.href });
    await sleep(opts.wait);
    for (const text of opts.clicks) {
      const clicked = await cdp.evaluate<boolean>(`(() => {
        const norm = (s) => s.replace(/\\s+/g, ' ').trim().toLowerCase();
        const want = norm(${JSON.stringify(text)});
        const button = [...document.querySelectorAll('button, a, [role=button]')].find((el) => el.offsetParent !== null && norm(el.textContent).includes(want));
        if (!button) return false;
        button.click();
        return true;
      })()`);
      if (!clicked) throw new Error(`No button showing "${text}"`);
      await sleep(700);
    }
    for (const text of opts.marks) {
      const marked = await cdp.evaluate<boolean>(`(() => {
        const norm = (s) => s.replace(/\\s+/g, ' ').trim().toLowerCase();
        const want = norm(${JSON.stringify(text)});
        const hits = [...document.querySelectorAll('body *')].filter((el) => el.offsetParent !== null && norm(el.textContent).includes(want));
        // The smallest one that still holds the text is the thing itself, not a container around it.
        const target = hits.filter((el) => !hits.some((other) => other !== el && el.contains(other)))[0];
        if (!target) return false;
        const row = target.closest('.item, .setup__row, button, label') ?? target;
        row.style.cssText += ${JSON.stringify(MARK_STYLE)};
        return true;
      })()`);
      if (!marked) throw new Error(`Nothing on screen shows "${text}"`);
    }
    await sleep(500);
    const format = opts.out.endsWith('.png') ? 'png' : opts.out.endsWith('.webp') ? 'webp' : 'jpeg';
    const { data } = await cdp.send<{ data: string }>('Page.captureScreenshot', { format, quality: 86 });
    writeFileSync(opts.out, Buffer.from(data, 'base64'));
    console.log(`Wrote ${opts.out} (${Math.round(Buffer.from(data, 'base64').length / 1024)} KB)`);
    cdp.close();
  } finally {
    proc.kill();
    await new Promise((resolve) => (proc.exitCode === null ? proc.once('exit', resolve) : resolve(null)));
    // Chrome may still be flushing its profile for a moment after it exits.
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
