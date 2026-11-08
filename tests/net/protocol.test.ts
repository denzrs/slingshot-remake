import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { PROTOCOL_VERSION, withProtocol } from '../../src/net/net';
import { unpackWireMessage } from '../../src/net/messagepack';

/**
 * The version of the wire protocol: the client says which one it was built for, and a relay that speaks a newer one tells it to
 * reload and lets go, against the real relay binary. A client that says nothing (a tool, an older build) is let in as before.
 */
const contract = JSON.parse(readFileSync(fileURLToPath(new URL('../../server/protocol-contract.json', import.meta.url)), 'utf8')) as { protocolVersion: number };

describe('the protocol version', () => {
  it('is the same in the client and in the relay contract', () => {
    expect(PROTOCOL_VERSION).toBe(contract.protocolVersion);
  });

  it('goes with every address the client connects to', () => {
    expect(new URL(withProtocol('ws://relay.example:8080')).searchParams.get('v')).toBe(String(PROTOCOL_VERSION));
    expect(new URL(withProtocol('wss://relay.example/play?b=abc')).searchParams.get('b')).toBe('abc');
    expect(new URL(withProtocol('wss://relay.example/play?v=0')).searchParams.get('v')).toBe(String(PROTOCOL_VERSION));
    expect(withProtocol('not an address')).toBe('not an address');
  });
});

let serverProcess: ChildProcess;
let serverUrl: string;
let dataDir: string;

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
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw new Error('Rust relay did not become ready');
}

beforeAll(async () => {
  const port = await freePort();
  serverUrl = `ws://127.0.0.1:${port}`;
  dataDir = await mkdtemp(join(tmpdir(), 'slingshot-protocol-'));
  const binary = fileURLToPath(new URL('../../server/target/debug/slingshot-server', import.meta.url));
  serverProcess = spawn(binary, [], {
    env: {
      ...process.env,
      PORT: String(port),
      ALLOW_ALL_ORIGINS: '1',
      CONNECTIONS_PER_IP_PER_SECOND: '1000',
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

/** Opens a socket and collects what the relay says until it closes, or until `ms` have passed. */
async function listen(url: string, ms: number): Promise<{ messages: { type?: string; protocol?: number }[]; closeCode: number | null }> {
  const messages: { type?: string; protocol?: number }[] = [];
  const socket = new WebSocket(url);
  let closeCode: number | null = null;
  socket.on('message', (data) => messages.push(unpackWireMessage(data as Buffer) as { type?: string }));
  socket.on('close', (code) => (closeCode = code));
  socket.on('error', () => {});
  await Promise.race([once(socket, 'close').catch(() => {}), new Promise((resolve) => setTimeout(resolve, ms))]);
  if (socket.readyState === WebSocket.OPEN) socket.close();
  return { messages, closeCode };
}

describe('against the relay', () => {
  it('tells a client built for an older protocol to reload, and lets go of it', async () => {
    const { messages, closeCode } = await listen(`${serverUrl}?v=0`, 3000);
    expect(messages).toEqual([{ type: 'outdated', protocol: PROTOCOL_VERSION }]);
    expect(closeCode).toBe(4001);
  });

  it('keeps a client built for this protocol, and a tool that says nothing', async () => {
    for (const query of [`?v=${PROTOCOL_VERSION}`, `?v=${PROTOCOL_VERSION + 1}`, '']) {
      const { messages, closeCode } = await listen(`${serverUrl}${query}`, 400);
      expect(messages.filter((message) => message.type === 'outdated'), query).toEqual([]);
      expect(closeCode, query).toBeNull();
    }
  });

  it('takes a browser that names no version for a build from before versions: protocol 1', async () => {
    const { messages, closeCode } = await listen(`${serverUrl}?b=AAECAwQFBgcICQoLDA0ODw`, PROTOCOL_VERSION > 1 ? 3000 : 400);
    if (PROTOCOL_VERSION > 1) {
      expect(messages).toEqual([{ type: 'outdated', protocol: PROTOCOL_VERSION }]);
      expect(closeCode).toBe(4001);
    } else {
      expect(messages.filter((message) => message.type === 'outdated')).toEqual([]);
      expect(closeCode).toBeNull();
    }
  });
});
