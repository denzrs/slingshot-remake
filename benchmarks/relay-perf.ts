// Load test for the Rust multiplayer relay. Start it with:
//
//   ALLOW_ALL_ORIGINS=1 npm run dev:server  # local benchmark only
//   npm run bench:relay -- ws://localhost:8080
//
// The client offers `slingshot-flate-v1`. The relay sends a capability ack before the client
// compresses payloads > 10 KiB. Every figure below is host-send → guest-received, including relay
// work and decompression.
//
// The relay caps inbound messages per connection at 300/s (the anti-flood limit), so all
// measurements here stay under that rate; aggregate load is created with several rooms instead.

import WebSocket from 'ws';
import zlib from 'node:zlib';
import { ClassicMatch } from '../src/game/classic';
import { HorizonMatch } from '../src/game/horizon';
import { createMatch, type GameEvent } from '../src/game';
import { SnapshotEncoder } from '../src/netsync';
import { DEFAULT_SETTINGS, type Seat } from '../src/settings';

const URL = process.argv[2] ?? 'ws://localhost:8080';
const SUB = 'slingshot-flate-v1';
const BENCH_ORIGIN = process.env.BENCH_ORIGIN;
const COMPRESS_THRESHOLD = 10 * 1024;

// The window of the wire message we actually read (never the raw client input).
interface WireState {
  type?: string;
  seq?: number;
  patch?: { t?: number };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pct = (sorted: number[], p: number) => sorted[Math.max(0, Math.min(sorted.length - 1, Math.floor(sorted.length * p)))];
const fmt = (v: number, digits = 0) => v.toLocaleString('en-US', { maximumFractionDigits: digits });
/** Format a percentile from a sorted sample, or "n/a" when nothing was delivered. */
const fmtLat = (lats: number[], p: number) => lats.length ? fmt(pct(lats, p), 2) : 'n/a';

interface Client {
  ws: WebSocket;
  negotiated: boolean;
}

interface FrameSize {
  jsonBytes: number;
  frameBytes: number;
  compressed: boolean;
}

/** Send the way the real frontend does: text, or flate when the peer negotiated it and payload > 10 KiB. */
function send(client: Client, message: unknown): FrameSize {
  const text = JSON.stringify(message);
  const jsonBytes = Buffer.byteLength(text);
  if (client.negotiated && jsonBytes > COMPRESS_THRESHOLD) {
    const frame = zlib.deflateSync(text);
    client.ws.send(frame, { binary: true });
    return { jsonBytes, frameBytes: frame.byteLength, compressed: true };
  }
  client.ws.send(text);
  return { jsonBytes, frameBytes: jsonBytes, compressed: false };
}

function connect(url: string): Promise<Client> {
  const { promise, resolve, reject } = Promise.withResolvers<Client>();
  const ws = new WebSocket(url, [SUB], BENCH_ORIGIN ? { origin: BENCH_ORIGIN } : {});
  const client: Client = { ws, negotiated: false };
  let probeTimer: NodeJS.Timeout;
  const onCapability = (d: WebSocket.RawData, binary: boolean) => {
    if (binary) return;
    try {
      const m = JSON.parse(d.toString());
      if (m.type === 'capabilities' && m.compression === 'flate') {
        client.negotiated = true;
        clearTimeout(probeTimer);
        ws.removeListener('message', onCapability);
      }
    } catch { /* ignore non-capability messages */ }
  };
  probeTimer = setTimeout(() => ws.removeListener('message', onCapability), 250);
  ws.on('message', onCapability);
  ws.on('open', () => resolve(client));
  ws.on('error', reject);
  ws.on('close', () => clearTimeout(probeTimer));
  return promise;
}

/** Connect just to learn whether this server supports flate. */
async function supportsFlate(url: string): Promise<boolean> {
  const c = await connect(url);
  await sleep(100);
  const value = c.negotiated;
  c.ws.close();
  return value;
}

// The relays cap fresh connections at 20/s per IP (anti-flood). The bench opens many sockets
// from one address, so space them out instead of blasting the limit.
let lastConnectAt = 0;
async function pacedConnect(url: string): Promise<Client> {
  const wait = 100 - (performance.now() - lastConnectAt);
  if (wait > 0) await sleep(wait);
  lastConnectAt = performance.now();
  return connect(url);
}

/** One parsed state message, typed at this single parse boundary. */
function decodeState(data: WebSocket.RawData, binary: boolean): WireState {
  if (binary) {
    // ws delivers binary frames as a Buffer.
    const buf = data as Buffer;
    return JSON.parse(zlib.inflateSync(buf).toString()) as WireState;
  }
  return JSON.parse(data.toString()) as WireState;
}

function wireBytes(data: WebSocket.RawData, binary: boolean): number {
  if (binary) {
    // ws delivers binary frames as a Buffer.
    const buf = data as Buffer;
    return buf.byteLength;
  }
  return Buffer.byteLength(data.toString());
}

/** Host + `count` guests in a started game. */
async function startRoom(url: string, count: number) {
  const host = await pacedConnect(url);
  const guests: Client[] = [];
  for (let i = 0; i < count; i++) guests.push(await pacedConnect(url));

  const { promise: roomReady, resolve: roomResolve, reject: roomReject } = Promise.withResolvers<string>();
  const timer = setTimeout(() => roomReject(new Error('no room_update')), 3000);
  host.ws.on('message', (d) => {
    const m = JSON.parse(d.toString());
    if (m.type === 'room_update') { clearTimeout(timer); roomResolve(m.room.id); }
  });
  host.ws.on('error', roomReject);
  send(host, { type: 'create_room', name: 'Host', mode: 'ffa', gameMode: 'classic', maxPlayers: 6 });
  const roomId = await roomReady;

  for (let i = 0; i < count; i++) {
    send(guests[i], { type: 'join_room', roomId, name: `G${i}` });
    await sleep(30);
    send(guests[i], { type: 'ready', ready: true });
  }
  await sleep(50);
  send(host, { type: 'start_game' });
  await sleep(80);
  return { host, guests, roomId };
}

async function closeRoom(host: Client, guests: Client[]) {
  for (const g of guests) g.ws.close();
  host.ws.close();
  await sleep(100);
}

/** Latency at a fixed rate: `count` states at `rate`/s; all guests' samples are pooled. */
async function latencyTest(host: Client, guests: Client[], patch: unknown, rate: number, count: number) {
  let seq = 1;
  const lats: number[] = [];
  let wireBytesTotal = 0;
  let stateCount = 0;
  const listeners = guests.map((g) => {
    const listener = (data: WebSocket.RawData, binary: boolean) => {
      const m = decodeState(data, binary);
      if (m.type === 'state') {
        const t = m.patch?.t;
        if (typeof t === 'number') lats.push(performance.now() - t);
        stateCount++;
        wireBytesTotal += wireBytes(data, binary);
      }
    };
    g.ws.on('message', listener);
    return listener;
  });
  const start = performance.now();
  const interval = 1000 / rate;
  for (let i = 0; i < count; i++) {
    send(host, { type: 'state', seq: seq++, patch: { ...(patch as object), t: performance.now() }, events: [] });
    const target = start + i * interval;
    const now = performance.now();
    if (now < target) await sleep(target - now);
  }
  await sleep(Math.max(250, count / rate * 1000) + 200);
  guests.forEach((g, i) => g.ws.removeListener('message', listeners[i]));
  const sorted = [...lats].sort((a, b) => a - b);
  return { sent: count * guests.length, n: sorted.length, lats: sorted, wireBytes: stateCount ? wireBytesTotal / stateCount : 0 };
}

/** Aggregate multi-room load: `rooms` games, every host streams small states at `rate`/s. */
async function aggregateLoad(rooms: number, guestsPerRoom: number, rate: number, durationMs: number) {
  const games = [];
  for (let i = 0; i < rooms; i++) games.push(await startRoom(URL, guestsPerRoom));

  let sent = 0;
  let received = 0;
  let bytes = 0;
  const lats: number[] = [];
  const removers: Array<() => void> = [];
  for (const { guests } of games) {
    for (const g of guests) {
      const listener = (data: WebSocket.RawData, binary: boolean) => {
        const m = decodeState(data, binary);
        if (m.type !== 'state') return;
        received++;
        bytes += wireBytes(data, binary);
        const t = m.patch?.t;
        if (typeof t === 'number') lats.push(performance.now() - t);
      };
      g.ws.on('message', listener);
      removers.push(() => g.ws.removeListener('message', listener));
    }
  }

  const t0 = performance.now();
  await Promise.all(games.map(async ({ host }) => {
    let seq = 1;
    const perBatch = Math.max(1, Math.round(rate / 20));
    while (performance.now() - t0 < durationMs) {
      for (let k = 0; k < perBatch; k++) {
        sent++;
        send(host, { type: 'state', seq: seq++, patch: { ...smallPatch, t: performance.now() }, events: [] });
      }
      await sleep(50);
    }
  }));
  const sendMs = performance.now() - t0;
  await sleep(800);
  for (const remove of removers) remove();
  return { sent, received, wall: sendMs, lats: [...lats].sort((a, b) => a - b) };
}
/** Run the real match engine and SnapshotEncoder, then send its actual 30 Hz patches over WS. */
async function realSnapshotRun(url: string, mode: 'classic' | 'horizon', durationMs: number) {
  const { host, guests } = await startRoom(url, 3);
  const seats: Seat[] = ['human', 'human', 'human', 'human', 'off', 'off'];
  const settings = {
    ...DEFAULT_SETTINGS,
    seats,
    rounds: 5,
    maxPlanets: 4,
    shotTime: 20,
    simultaneousShots: mode === 'horizon',
  };
  const created = createMatch(mode, settings, {
    seats,
    names: ['Host', 'G0', 'G1', 'G2'],
    simultaneous: mode === 'horizon',
    oracle: true,
    seed: 7139,
  });
  if (!(created instanceof ClassicMatch) && !(created instanceof HorizonMatch)) throw new Error('expected ship match');
  const match = created;
  const encoder = new SnapshotEncoder();
  const events: GameEvent[] = [];
  match.on((event) => events.push(event));

  const pending = new Map<number, number>();
  const latency: number[] = [];
  const deliveredFrameBytes: number[] = [];
  const listeners = guests.map((guest) => {
    const listener = (data: WebSocket.RawData, binary: boolean) => {
      const state = decodeState(data, binary);
      if (state.type !== 'state' || typeof state.seq !== 'number') return;
      const sentAt = pending.get(state.seq);
      if (sentAt !== undefined) latency.push(performance.now() - sentAt);
      deliveredFrameBytes.push(wireBytes(data, binary));
    };
    guest.ws.on('message', listener);
    return listener;
  });

  const frames: FrameSize[] = [];
  const dt = 1 / 30;
  const period = 1000 / 30;
  const startedAt = performance.now();
  let nextAt = startedAt;
  let lastShotTick = 0;
  let horizonLocked = false;
  let seq = 0;
  let tick = 0;
  while (performance.now() - startedAt < durationMs) {
    match.update(dt);
    if (mode === 'classic' && match.phase === 'aiming' && match.current >= 0 && tick - lastShotTick >= 45) {
      match.setPlayerAim(match.current, (tick * 37) % 360, 55);
      match.commitPlayer(match.current);
      lastShotTick = tick;
    } else if (mode === 'horizon' && match.phase === 'aiming' && !horizonLocked && tick >= 30) {
      for (const player of match.players) {
        if (match.canAim(player.id)) {
          match.setPlayerAim(player.id, (tick * 37 + player.id * 61) % 360, 55);
          match.commitPlayer(player.id);
        }
      }
      horizonLocked = true;
    } else if (mode === 'horizon' && match.phase !== 'aiming') {
      horizonLocked = false;
    }
    if ((match.phase === 'roundOver' || match.phase === 'gameOver' || match.phase === 'killcam') && match.phaseTime > 1.2) {
      match.advance();
    }

    const patch = encoder.encode(match.snapshot());
    const message = { type: 'state', seq: ++seq, patch, events: events.splice(0) };
    const sentAt = performance.now();
    const frame = send(host, message);
    pending.set(seq, sentAt);
    frames.push(frame);
    tick++;
    nextAt += period;
    const wait = nextAt - performance.now();
    if (wait > 0) await sleep(wait);
  }
  await sleep(500);
  for (let i = 0; i < guests.length; i++) guests[i].ws.removeListener('message', listeners[i]);
  const sort = (values: number[]) => [...values].sort((a, b) => a - b);
  const jsonSizes = sort(frames.map((frame) => frame.jsonBytes));
  const wireSizes = sort(frames.map((frame) => frame.frameBytes));
  const latencies = sort(latency);
  const result = {
    ticks: frames.length,
    delivered: latency.length,
    latency: latencies,
    firstJsonBytes: frames[0]?.jsonBytes ?? 0,
    firstWireBytes: frames[0]?.frameBytes ?? 0,
    jsonSizes,
    wireSizes,
    compressedFrames: frames.filter((frame) => frame.compressed).length,
    guestFrameBytes: deliveredFrameBytes.reduce((sum, size) => sum + size, 0),
  };
  await closeRoom(host, guests);
  match.dispose();
  return result;
}
async function reportRealSnapshots(url: string, mode: 'classic' | 'horizon') {
  const result = await realSnapshotRun(url, mode, 8000);
  const logicalMean = result.jsonSizes.reduce((sum, size) => sum + size, 0) / result.jsonSizes.length;
  const wireMean = result.wireSizes.reduce((sum, size) => sum + size, 0) / result.wireSizes.length;
  console.log(`\n### real ${mode} snapshots, 30 Hz (4 human players, 8 s)`);
  console.log(`  ticks ${result.ticks}, guest deliveries ${result.delivered}`);
  console.log(`  first/full frame ${fmt(result.firstJsonBytes)} B JSON → ${fmt(result.firstWireBytes)} B WebSocket payload`);
  console.log(`  all ticks mean ${fmt(logicalMean)} B JSON → ${fmt(wireMean)} B WebSocket payload`);
  console.log(`  largest patch ${fmt(result.jsonSizes.at(-1) ?? 0)} B JSON → ${fmt(result.wireSizes.at(-1) ?? 0)} B WebSocket payload; compressed ${result.compressedFrames}/${result.ticks} ticks`);
  console.log(`  host→guest latency p50 ${fmtLat(result.latency, 0.5)} ms, p95 ${fmtLat(result.latency, 0.95)} ms, max ${fmtLat(result.latency, 1)} ms`);
}

const smallPatch = { phase: 'aiming', shooter: 0, board: Array.from({ length: 40 }, (_, i) => ({ i, x: i * 3.75, y: 120 + i * 0.37, vx: 12.5, vy: -8 })) };
const largePatch = { phase: 'aiming', board: Array.from({ length: 8000 }, (_, i) => ({ i, x: i * 1.25, y: i * 0.7, vx: 1.5, vy: -0.75 })) };
const mediumPatch = { phase: 'aiming', board: Array.from({ length: 300 }, (_, i) => ({ i, x: i * 1.25, y: i * 0.7, vx: 1.5, vy: -0.75 })) };

async function lobbyThroughput(url: string, durationMs: number, rate: number) {
  const c = await connect(url);
  let replies = 0;
  let counting = false;
  c.ws.on('message', (d) => {
    if (counting && d.toString().includes('"lobby_update"')) replies++;
  });
  await sleep(50); // discard the initial lobby_update sent on connect
  counting = true;
  const t0 = performance.now();
  const interval = 1000 / rate;
  let sent = 0;
  while (performance.now() - t0 < durationMs) {
    c.ws.send('{"type":"lobby"}');
    sent++;
    const remaining = t0 + sent * interval - performance.now();
    if (remaining > 0) await sleep(remaining);
  }
  const activeMs = performance.now() - t0;
  await sleep(200);
  c.ws.close();
  return { sent, replies, repliesPerSec: replies / activeMs * 1000 };
}

async function run(url: string) {
  const negotiated = await supportsFlate(url);
  console.log(`\n## relay at ${url}${negotiated ? '  (Rust: compression negotiated)' : ''}`);
  const smallBytes = Buffer.byteLength(JSON.stringify({ type: 'state', seq: 1, patch: smallPatch, events: [] }));
  const largeBytes = Buffer.byteLength(JSON.stringify({ type: 'state', seq: 1, patch: largePatch, events: [] }));
  const mediumBytes = Buffer.byteLength(JSON.stringify({ type: 'state', seq: 1, patch: mediumPatch, events: [] }));

  const lobby = await lobbyThroughput(url, 2000, 200);
  console.log(`\n### lobby request/response (1 client, paced 200/s)`);
  console.log(`  replies: ${lobby.repliesPerSec.toFixed(0)}/s (sent ${lobby.sent}, got ${lobby.replies})`);

  console.log(`\n### 3 guests, small state (${fmt(smallBytes)} B, paced 200/s)`);
  {
    const { host, guests } = await startRoom(url, 3);
    const r = await latencyTest(host, guests, smallPatch, 200, 400);
    console.log(`  latency  p50 ${fmtLat(r.lats, 0.5)} ms  p95 ${fmtLat(r.lats, 0.95)} ms  max ${r.lats.length ? fmt(r.lats.at(-1)!, 2) : 'n/a'} ms  (${r.n}/${r.sent} delivered)`);
    await closeRoom(host, guests);
  }
  console.log(`\n### 3 guests, medium state (${fmt(mediumBytes)} B, paced 50/s)`);
  {
    const { host, guests } = await startRoom(url, 3);
    const r = await latencyTest(host, guests, mediumPatch, 50, 100);
    console.log(`  latency  p50 ${fmtLat(r.lats, 0.5)} ms  p95 ${fmtLat(r.lats, 0.95)} ms  (${r.n}/${r.sent} delivered)`);
    const savings = 1 - r.wireBytes / mediumBytes;
    console.log(`  WebSocket frame payload avg ${fmt(r.wireBytes)} B/state${savings > 0.01 ? ` (${fmt(savings * 100, 0)}% smaller)` : ' (no compression)'}`);
    await closeRoom(host, guests);
  }

  console.log(`\n### 3 guests, large state (${fmt(largeBytes)} B, paced 20/s) — compressed on the wire for the Rust server`);
  {
    const { host, guests } = await startRoom(url, 3);
    const r = await latencyTest(host, guests, largePatch, 20, 60);
    console.log(`  latency  p50 ${fmtLat(r.lats, 0.5)} ms  p95 ${fmtLat(r.lats, 0.95)} ms  max ${r.lats.length ? fmt(r.lats.at(-1)!, 2) : 'n/a'} ms  (${r.n}/${r.sent} delivered)`);
    const savings = 1 - r.wireBytes / largeBytes;
    console.log(`  WebSocket frame payload avg ${fmt(r.wireBytes)} B/state${savings > 0.01 ? ` (${fmt(savings * 100, 0)}% smaller)` : ' (no compression)'}`);
    await closeRoom(host, guests);
  }

  console.log(`\n### aggregate load: 4 games × 3 guests, small states at 280/s per host (2 s)`);
  {
    const result = await aggregateLoad(4, 3, 280, 2000);
    const guestDeliveriesPerSec = result.received / result.wall * 1000;
    console.log(`  ${fmt(result.sent)} host sends → ${fmt(result.received)} guest deliveries; ${fmt(guestDeliveriesPerSec)}/s, p95 ${fmtLat(result.lats, 0.95)} ms`);
  }

  console.log(`\n### real game snapshots at 30 Hz`);
  await reportRealSnapshots(url, 'classic');
  await reportRealSnapshots(url, 'horizon');
  console.log(`\n  node ${process.version}`);
}

run(URL).then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
