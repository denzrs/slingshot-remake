// Compare JSON, plain MessagePack, and MessagePack+envelope on equivalent live relay workloads.
// Usage: npx tsx benchmarks/relay-matrix.ts ws://localhost:8080 json|msgpack|envelope

import WebSocket from 'ws';
import { packMessage, packWireMessage, unpackMessage, unpackWireMessage } from '../src/messagepack';
import { createMatch, type GameEvent } from '../src/game';
import { ClassicMatch } from '../src/game/classic';
import { HorizonMatch } from '../src/game/horizon';
import { SnapshotDecoder, SnapshotEncoder } from '../src/netsync';
import { DEFAULT_SETTINGS, type Seat } from '../src/settings';

type Format = 'json' | 'msgpack' | 'envelope';
const URL = process.argv[2] ?? 'ws://localhost:8080';
const FORMAT = (process.argv[3] ?? 'envelope') as Format;
const ORIGIN = process.env.BENCH_ORIGIN ?? 'http://localhost:5173';
const TICKS = 60;
const HZ = 30;

interface Client { ws: WebSocket }
interface Sample { seq: number; snapshotEncodeMs: number; wireEncodeMs: number; sentAt: number; clientDecodeMs: number[]; clientApplyMs: number[]; bytes: number[]; latencyMs: number[] }

const encode = (message: unknown): string | Uint8Array => FORMAT === 'json'
  ? JSON.stringify(message)
  : FORMAT === 'msgpack' ? packMessage(message) : packWireMessage(message);
const decode = (data: WebSocket.RawData, binary: boolean): unknown => {
  if (FORMAT === 'json') {
    if (binary) throw new Error('expected text JSON');
    return JSON.parse(data.toString());
  }
  if (!binary) throw new Error('expected binary MessagePack');
  return FORMAT === 'msgpack' ? unpackMessage(data as Buffer) : unpackWireMessage(data as Buffer);
};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const quantile = (input: number[], q: number) => {
  const values = [...input].sort((a, b) => a - b);
  return values.length ? values[Math.min(values.length - 1, Math.floor(values.length * q))] : 0;
};
const stats = (input: number[]) => ({
  mean: input.length ? input.reduce((a, b) => a + b, 0) / input.length : 0,
  p50: quantile(input, 0.5), p95: quantile(input, 0.95), max: Math.max(0, ...input),
});

function connect(): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL, { origin: ORIGIN });
    ws.once('open', () => resolve({ ws }));
    ws.once('error', reject);
  });
}

function send(client: Client, message: unknown): number {
  const data = encode(message);
  return sendEncoded(client, data);
}

function sendEncoded(client: Client, data: string | Uint8Array): number {
  client.ws.send(data);
  return typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength;
}

function waitMessage(client: Client, predicate: (message: any) => boolean, timeoutMs = 5000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { client.ws.off('message', listener); reject(new Error('timed out waiting for relay message')); }, timeoutMs);
    const listener = (data: WebSocket.RawData, binary: boolean) => {
      let message: any;
      try { message = decode(data, binary); } catch { return; }
      if (!predicate(message)) return;
      clearTimeout(timer);
      client.ws.off('message', listener);
      resolve(message);
    };
    client.ws.on('message', listener);
  });
}

async function setupRoom(playerCount: number, mode: 'classic' | 'horizon') {
  const clients = [await connect()];
  for (let i = 1; i < playerCount; i++) {
    await sleep(55); // admission guard is 20 new connections/s/IP
    clients.push(await connect());
  }
  const [host, ...guests] = clients;
  let update = waitMessage(host, (m) => m.type === 'room_update' && m.room?.players?.length === 1);
  send(host, { type: 'create_room', name: 'P0', mode: 'ffa', gameMode: mode, maxPlayers: playerCount });
  const room = await update;
  for (let i = 1; i < playerCount; i++) {
    update = waitMessage(host, (m) => m.type === 'room_update' && m.room?.players?.length === i + 1);
    send(clients[i], { type: 'join_room', roomId: room.room.id, name: `P${i}` });
    await update;
    const readyUpdate = waitMessage(host, (m) => m.type === 'room_update'
      && m.room?.players?.length === i + 1
      && m.room.players[i]?.ready === true);
    send(clients[i], { type: 'ready', ready: true });
    await readyUpdate;
  }
  const started = waitMessage(host, (m) => m.type === 'game_start');
  send(host, { type: 'start_game' });
  await started;
  await sleep(30);
  return { host, guests, clients };
}

function makeMatch(count: number, mode: 'classic' | 'horizon') {
  const seats: Seat[] = Array.from({ length: 6 }, (_, i) => i < count ? 'human' : 'off');
  const settings = { ...DEFAULT_SETTINGS, seats, rounds: 5, maxPlanets: 4, simultaneousShots: mode === 'horizon' };
  const match = createMatch(mode, settings, {
    seats, names: Array.from({ length: count }, (_, i) => `P${i}`), simultaneous: mode === 'horizon',
    oracle: true, seed: 98173,
  });
  if (!(match instanceof ClassicMatch || match instanceof HorizonMatch)) throw new Error(`unexpected ${mode} match`);
  return match;
}

function enterKillcam(match: ClassicMatch | HorizonMatch): void {
  if (!(match instanceof HorizonMatch)) throw new Error('Classic has no killcam phase');
  match.world.planets = [];
  const ships = match.world.ships;
  Object.assign(ships[0], { x: 100, y: 400 });
  Object.assign(ships[1], { x: 300, y: 400 });
  for (let i = 2; i < ships.length; i++) Object.assign(ships[i], { x: 520 + i * 30, y: 120 + i * 80 });
  for (let i = 0; i < match.players.length; i++) {
    match.setPlayerAim(i, i === 0 ? 0 : i === 1 ? 90 : 180, 30);
    match.commitPlayer(i);
  }
  for (let i = 0; i < 1800 && match.phase !== 'killcam'; i++) match.update(1 / 60);
  if (match.phase !== 'killcam') throw new Error(`could not enter killcam with ${match.players.length} players`);
}

async function runCase(count: number, mode: 'classic' | 'horizon', killcam: boolean, caseIndex: number) {
  if (killcam && mode !== 'horizon') return;
  const { host, guests, clients } = await setupRoom(count, mode);
  const match = makeMatch(count, mode);
  if (killcam) enterKillcam(match);
  const encoder = new SnapshotEncoder();
  const pending = new Map<number, number>();
  const samples: Sample[] = [];
  const guestListeners = guests.map((guest) => {
    const decoder = new SnapshotDecoder();
    const listener = (data: WebSocket.RawData, binary: boolean) => {
      const before = performance.now();
      let message: any;
      try { message = decode(data, binary); } catch { return; }
      const decodeMs = performance.now() - before;
      if (message.type !== 'state' || !pending.has(message.seq)) return;
      const sample = pending.get(message.seq)!;
      const result = samples[sample];
      const applyStart = performance.now();
      decoder.apply(message.patch);
      const applyMs = performance.now() - applyStart;
      result.clientDecodeMs.push(decodeMs);
      result.clientApplyMs.push(applyMs);
      result.bytes.push(binary ? (data as Buffer).byteLength : Buffer.byteLength(data.toString()));
      result.latencyMs.push(performance.now() - result.sentAt);
    };
    guest.ws.on('message', listener);
    return listener;
  });

  const baseSeq = caseIndex * 1000;
  const start = performance.now();
  for (let tick = 0; tick < TICKS; tick++) {
    if (killcam) match.update(1 / HZ);
    else {
      match.update(1 / HZ);
      if (tick % 24 === 12 && match.phase === 'aiming') {
        const id = match.current >= 0 ? match.current : 0;
        match.setPlayerAim(id, (tick * 19) % 360, 45);
        match.commitPlayer(id);
      }
    }
    const snapshotEncodeStart = performance.now();
    const snapshot = match.snapshot();
    const patch = encoder.encode(snapshot);
    const snapshotEncodeMs = performance.now() - snapshotEncodeStart;
    const seq = baseSeq + tick + 1;
    const targetAt = start + tick * 1000 / HZ;
    let remaining = targetAt - performance.now();
    while (remaining > 0) {
      await sleep(Math.min(2, remaining));
      remaining = targetAt - performance.now();
    }
    const message = { type: 'state', seq, patch, events: [] as GameEvent[] };
    const wireEncodeStart = performance.now();
    const encoded = encode(message);
    const wireEncodeMs = performance.now() - wireEncodeStart;
    const sampleIndex = samples.length;
    const sample: Sample = { seq, snapshotEncodeMs, wireEncodeMs, sentAt: 0, clientDecodeMs: [], clientApplyMs: [], bytes: [], latencyMs: [] };
    samples.push(sample);
    pending.set(seq, sampleIndex);
    const bytes = sendEncoded(host, encoded);
    sample.sentAt = performance.now();
    sample.bytes.push(bytes);
  }
  await sleep(300);
  guests.forEach((guest, i) => guest.ws.off('message', guestListeners[i]));
  await Promise.all(clients.map(({ ws }) => new Promise<void>((resolve) => { ws.once('close', resolve); ws.close(); })));
  match.dispose();
  const payloadSizes = samples.map((sample) => sample.bytes[0] ?? 0);
  const snapshotEncodeMs = samples.map((sample) => sample.snapshotEncodeMs);
  const wireEncodeMs = samples.map((sample) => sample.wireEncodeMs);
  const clientDecodeMs = samples.flatMap((sample) => sample.clientDecodeMs);
  const clientApplyMs = samples.flatMap((sample) => sample.clientApplyMs);
  const transitMs = samples.flatMap((sample) => sample.latencyMs);
  return {
    format: FORMAT, players: count, mode, killcam,
    framesSent: samples.length, guestFrames: clientDecodeMs.length,
    bytes: stats(payloadSizes), snapshotEncodeMs: stats(snapshotEncodeMs), wireEncodeMs: stats(wireEncodeMs), decodeMs: stats(clientDecodeMs), applyMs: stats(clientApplyMs),
    hostToGuestMs: stats(transitMs), serverSeqStart: baseSeq + 1, serverSeqEnd: baseSeq + TICKS,
  };
}

async function main() {
  if (!['json', 'msgpack', 'envelope'].includes(FORMAT)) throw new Error(`unknown wire format ${FORMAT}`);
  let caseIndex = 1;
  for (const mode of ['classic', 'horizon'] as const) {
    for (let players = 2; players <= 6; players++) {
      const result = await runCase(players, mode, false, caseIndex++);
      console.log(JSON.stringify(result));
    }
  }
  for (let players = 2; players <= 6; players++) {
    const result = await runCase(players, 'horizon', true, caseIndex++);
    console.log(JSON.stringify(result));
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
