import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { Leaderboard, BoardRejected, type BoardConnection } from '../src/leaderboard';
import { packWireMessage, unpackWireMessage } from '../src/messagepack';
import type { ServerMessage } from '../src/net';

/**
 * The daily leaderboard against the real relay: a run posted over the wire, the board read back,
 * and what the relay refuses to take. The relay is the same binary the deployment ships, with its
 * board file pointed at a throwaway directory.
 */
let serverProcess: ChildProcess;
let serverUrl: string;
let dataDir: string;

/** One connection to the relay, as the leaderboard client needs it. */
class RelayConnection implements BoardConnection {
  private socket: WebSocket | null = null;
  private listener: ((message: ServerMessage) => void) | null = null;
  private opened = false;

  constructor(private readonly url: string) {}

  onMessage(listener: (message: ServerMessage) => void): void {
    this.listener = listener;
  }

  async connect(): Promise<void> {
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    const socket = new WebSocket(this.url);
    this.socket = socket;
    socket.on('open', () => {
      this.opened = true;
      resolve();
    });
    socket.on('error', (error) => {
      if (!this.opened) reject(error);
    });
    socket.on('message', (data) => {
      try {
        this.listener?.(unpackWireMessage(data as Buffer) as ServerMessage);
      } catch {
        this.listener?.({ type: 'error', message: 'Malformed relay response' });
      }
    });
    socket.on('close', () => {
      if (this.opened) this.listener?.({ type: 'closed', message: 'Relay connection closed' });
    });
    await promise;
  }

  send(message: Parameters<BoardConnection['send']>[0]): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) throw new Error('WebSocket is not open');
    this.socket.send(packWireMessage(JSON.parse(JSON.stringify(message))));
  }

  close(): void {
    const socket = this.socket;
    this.socket = null;
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) socket.close();
  }
}

/** The client the app uses, on a connection to the test relay. */
const onRelay = (): Leaderboard => new Leaderboard(() => new RelayConnection(serverUrl));

async function freePort(): Promise<number> {
  const listener = createServer();
  const { promise, resolve, reject } = Promise.withResolvers<number>();
  listener.once('error', reject);
  listener.listen(0, '127.0.0.1', () => {
    const address = listener.address();
    if (!address || typeof address === 'string') {
      reject(new Error('Could not get test port'));
      return;
    }
    listener.close((error) => (error ? reject(error) : resolve(address.port)));
  });
  return promise;
}

async function waitForServer(url: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (serverProcess.exitCode === null && Date.now() < deadline) {
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    const socket = new WebSocket(url);
    socket.once('open', () => {
      socket.close();
      resolve();
    });
    socket.once('error', reject);
    try {
      await promise;
      return;
    } catch {
      // The process has been spawned but its listener may not be up yet; there is no event to
      // await for that, and retrying without a breath would trip the relay's per-IP connect limit.
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw new Error(serverProcess.exitCode === null ? 'Rust relay did not become ready within 15 seconds' : 'Rust relay exited before becoming ready');
}

beforeAll(async () => {
  const port = await freePort();
  serverUrl = `ws://127.0.0.1:${port}`;
  dataDir = await mkdtemp(join(tmpdir(), 'slingshot-board-'));
  const binary = fileURLToPath(new URL('../server/target/debug/slingshot-server', import.meta.url));
  serverProcess = spawn(binary, [], {
    env: {
      ...process.env,
      PORT: String(port),
      ALLOW_ALL_ORIGINS: '1',
      CONNECTIONS_PER_IP_PER_SECOND: '1000',
      MAX_MESSAGES_PER_SECOND: '100000',
      DATABASE: join(dataDir, 'slingshot.db'),
      RUST_LOG: process.env.RELAY_LOG ?? 'info',
    },
    stdio: process.env.RELAY_LOG ? 'inherit' : 'ignore',
  });
  await waitForServer(serverUrl);
});

afterAll(async () => {
  if (serverProcess && serverProcess.exitCode === null) {
    const exited = once(serverProcess, 'exit');
    serverProcess.kill('SIGTERM');
    await exited;
  }
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
});

const DAY = '2026-10-19';
const OTHER_DAY = '2026-10-18';

describe('daily leaderboard', () => {
  it('posts a run and hands the board back with the run on it', async () => {
    const boards = onRelay();
    const board = await boards.submit(DAY, 'Ada', 4200);
    expect(board.day).toBe(DAY);
    expect(board.entries).toContainEqual({ rank: 1, name: 'Ada', score: 4200 });
    expect(board.you).toEqual({ rank: 1, name: 'Ada', score: 4200 });

    // A second look at the board needs no posting, and shows the same run.
    const seen = await boards.top(DAY);
    expect(seen.entries).toContainEqual({ rank: 1, name: 'Ada', score: 4200 });
  });

  it('keeps a player to one run a day, their best', async () => {
    const boards = onRelay();
    await boards.submit(OTHER_DAY, 'Ada', 900);
    const worse = await boards.submit(OTHER_DAY, 'Ada', 300);
    expect(worse.entries).toEqual([{ rank: 1, name: 'Ada', score: 900 }]);

    const better = await boards.submit(OTHER_DAY, 'Ada L.', 1500);
    expect(better.entries).toEqual([{ rank: 1, name: 'Ada L.', score: 1500 }]);
    expect(better.you).toEqual({ rank: 1, name: 'Ada L.', score: 1500 });
  });

  it('keeps each day its own board', async () => {
    const boards = onRelay();
    await boards.submit('2026-10-17', 'Cy', 7000);
    const seen = await boards.top('2026-10-17');
    expect(seen.entries).toEqual([{ rank: 1, name: 'Cy', score: 7000 }]);
    expect(seen.you).toEqual({ rank: 1, name: 'Cy', score: 7000 });

    const today = await boards.top('2026-10-16');
    expect(today.entries).toEqual([]);
    expect(today.you).toBeNull();
  });

  it('refuses a run that is not a run', async () => {
    const boards = onRelay();
    await expect(boards.submit('today', 'Ada', 100)).rejects.toThrow(/Invalid daily run/);
    await expect(boards.submit('2026-02-30', 'Ada', 100)).rejects.toThrow(/Invalid daily run/);
    await expect(boards.submit(DAY, '   ', 100)).rejects.toThrow(/Invalid daily run/);
    await expect(boards.submit(DAY, 'Ada', -1)).rejects.toThrow(/Invalid daily run/);
    await expect(boards.submit(DAY, 'Ada', 10_000_001)).rejects.toThrow(/Invalid daily run/);
    await expect(boards.top('nope')).rejects.toThrow(/Invalid day/);

    // Nothing of that reached the board.
    const seen = await boards.top('2026-10-15');
    expect(seen.entries).toEqual([]);
  });

  it('takes a name down to what the rest of the game shows', async () => {
    const boards = onRelay();
    const long = 'Bartholomew Featherstonehaugh';
    const board = await boards.submit('2026-10-14', `  ${long}  `, 5);
    expect(board.you?.name).toBe(long.slice(0, 24));
  });

  it('refuses a name the board will not carry, and says so', async () => {
    const boards = onRelay();
    const rejected = await boards.submit('2026-10-13', 'fuck', 9999).catch((error: unknown) => error);
    expect(rejected).toBeInstanceOf(BoardRejected);
    expect((rejected as Error).message).toBe('That name is not allowed');

    // Nothing of it reached the board.
    expect((await boards.top('2026-10-13')).entries).toEqual([]);
  });
});
