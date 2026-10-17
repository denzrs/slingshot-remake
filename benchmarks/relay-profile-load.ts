// Sustained state-frame workload for profiling the Rust relay.
// Usage: npx tsx benchmarks/relay-profile-load.ts ws://localhost:8080 msgpack|envelope [seconds]

import WebSocket from 'ws';
import { packMessage, packWireMessage, unpackMessage, unpackWireMessage } from '../src/messagepack';

const url = process.argv[2] ?? 'ws://localhost:8080';
const format = process.argv[3] ?? 'envelope';
const seconds = Number(process.argv[4] ?? 25);
const origin = process.env.BENCH_ORIGIN ?? 'http://localhost:5173';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const encode = (value: unknown) => format === 'msgpack' ? packMessage(value) : packWireMessage(value);
const decode = (data: WebSocket.RawData) => format === 'msgpack'
  ? unpackMessage(data as Buffer)
  : unpackWireMessage(data as Buffer);

function connect(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { origin });
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
    ws.on('message', (data) => { try { decode(data); } catch { /* ignore non-protocol frames */ } });
  });
}

function waitFor(ws: WebSocket, predicate: (message: any) => boolean): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.off('message', listener); reject(new Error('relay setup timeout')); }, 5000);
    const listener = (data: WebSocket.RawData) => {
      let value: any;
      try { value = decode(data); } catch { return; }
      if (!predicate(value)) return;
      clearTimeout(timer);
      ws.off('message', listener);
      resolve(value);
    };
    ws.on('message', listener);
  });
}

async function createGame(index: number) {
  const clients: WebSocket[] = [];
  for (let player = 0; player < 4; player++) {
    if (clients.length) await sleep(55);
    clients.push(await connect());
  }
  const [host, ...guests] = clients;
  const roomUpdate = waitFor(host, (m) => m.type === 'room_update' && m.room?.players.length === 1);
  host.send(encode({ type: 'create_room', name: `H${index}`, mode: 'ffa', gameMode: 'classic', maxPlayers: 4 }));
  const room = await roomUpdate;
  for (let player = 1; player < 4; player++) {
    const joined = waitFor(host, (m) => m.type === 'room_update' && m.room?.players.length === player + 1);
    guests[player - 1]!.send(encode({ type: 'join_room', roomId: room.room.id, name: `G${index}-${player}` }));
    await joined;
    const ready = waitFor(host, (m) => m.type === 'room_update' && m.room?.players[player]?.ready);
    guests[player - 1]!.send(encode({ type: 'ready', ready: true }));
    await ready;
  }
  const started = waitFor(host, (m) => m.type === 'game_start');
  host.send(encode({ type: 'start_game' }));
  await started;
  return { host, clients };
}

async function main() {
  if (!['msgpack', 'envelope'].includes(format)) throw new Error(`unsupported profile format: ${format}`);
  const games = [];
  for (let i = 0; i < 4; i++) games.push(await createGame(i));
  const patch = {
    phase: 'aiming', shooter: 0,
    board: Array.from({ length: 40 }, (_, i) => ({ i, x: i * 3.75, y: 120 + i * 0.37, vx: 12.5, vy: -8 })),
  };
  const framesPerBatch = 14; // 280/s/host, below the 300/s inbound guard
  const intervalMs = 50;
  const end = performance.now() + seconds * 1000;
  let frames = 0;
  const sequences = games.map(() => 0);
  while (performance.now() < end) {
    const batchAt = performance.now();
    for (let game = 0; game < games.length; game++) {
      for (let i = 0; i < framesPerBatch; i++) {
        const message = { type: 'state', seq: ++sequences[game]!, patch, events: [] };
        games[game]!.host.send(encode(message));
        frames++;
      }
    }
    const wait = batchAt + intervalMs - performance.now();
    if (wait > 0) await sleep(wait);
  }
  await sleep(500);
  console.log(`${format}: sent ${frames} state frames across four 4-player rooms`);
  await Promise.all(games.flatMap(({ clients }) => clients).map((ws) => new Promise<void>((resolve) => {
    ws.once('close', resolve);
    ws.close();
  })));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
