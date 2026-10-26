/**
 * A headless Chrome driven over the DevTools protocol, shared by the scripts that look at the running game
 * (`shot.ts`, `screens.ts`). It needs Chrome installed; set CHROME_PATH if it isn't where this file looks.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
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

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

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
export class Cdp {
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

export interface Browser {
  cdp: Cdp;
  /** Sets the viewport the page is laid out in. */
  resize(width: number, height: number, mobile?: boolean): Promise<void>;
  /** Plays the page's CSS animations and transitions this many times faster (the setting goes with the loaded page, so ask again after a navigation). */
  playbackRate(rate: number): Promise<void>;
  close(): Promise<void>;
}

/** Starts a headless Chrome with one page, ready for DevTools commands. */
export async function launchChrome(width: number, height: number): Promise<Browser> {
  const chrome = CHROME_CANDIDATES.find((path) => existsSync(path));
  if (!chrome) throw new Error('No Chrome found: set CHROME_PATH');
  const port = await freePort();
  const profile = mkdtempSync(join(tmpdir(), 'slingshot-chrome-'));
  const proc: ChildProcess = spawn(chrome, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    `--window-size=${width},${height}`,
    '--hide-scrollbars',
    '--no-first-run',
    '--disable-gpu-vsync',
    // A window nobody looks at (a locked screen, another desktop) must not run slower: the pages wait for animation frames.
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--disable-background-timer-throttling',
    '--disable-features=CalculateNativeWinOcclusion',
    'about:blank',
  ], { stdio: 'ignore' });
  const cdp = await Cdp.connect(await waitForDebugger(port));
  await cdp.send('Page.enable');
  const resize = (w: number, h: number, mobile = false) => cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile }).then(() => undefined);
  await resize(width, height);
  await cdp.send('Animation.enable');
  return {
    cdp,
    resize,
    playbackRate: (rate) => cdp.send('Animation.setPlaybackRate', { playbackRate: rate }).then(() => undefined),
    async close() {
      cdp.close();
      proc.kill();
      await new Promise((resolve) => (proc.exitCode === null ? proc.once('exit', resolve) : resolve(null)));
      // Chrome may still be flushing its profile for a moment after it exits.
      rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    },
  };
}
