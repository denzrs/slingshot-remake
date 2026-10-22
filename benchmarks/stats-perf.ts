// What the opt-in match statistics cost the relay. It starts the relay twice from the same binary —
// once as it runs by default, once with `--stats` — puts the same load on each and compares them:
//
//   npm run build:server && npm run bench:stats
//
// Every room streams 30 Hz states from its host, as a real game does, and the host also reports each
// turn (`turn_stats`: its shots and the scores after them) and, every few turns, the round
// (`round_stats`) — far more often than a real game plays them, so the database is written to hard.
// What is compared is the host → guest latency of the states, the relay's
// CPU time and memory, and how many rows landed.
//
// Knobs (environment): ROOMS (10), SECONDS (10), TURN_MS (250, between two turns of a room),
// TURNS (8, per round), SHOTS (2, per turn), BENCH_BIN (the relay binary; default: the release build, else the debug one).

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { packWireMessage, unpackWireMessage } from '../src/messagepack';

const ROOMS = Number(process.env.ROOMS ?? 10);
const SECONDS = Number(process.env.SECONDS ?? 10);
const TURN_MS = Number(process.env.TURN_MS ?? 250);
const TURNS = Number(process.env.TURNS ?? 8);
const SHOTS = Number(process.env.SHOTS ?? 2);
const GUESTS = 3;
const PORT = 18080;
const ORIGIN = 'http://localhost:5173';

const root = join(import.meta.dirname, '..', 'server', 'target');
const BIN = process.env.BENCH_BIN ?? [join(root, 'release', 'slingshot-server'), join(root, 'debug', 'slingshot-server')].find(existsSync);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pct = (sorted: number[], p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : NaN);
const fmt = (v: number, digits = 2) => (Number.isFinite(v) ? v.toLocaleString('en-US', { maximumFractionDigits: digits }) : 'n/a');

interface Client {
  ws: WebSocket;
}

const send = (client: Client, message: unknown) => client.ws.send(packWireMessage(message));

let lastConnectAt = 0;
async function connect(): Promise<Client> {
  const wait = 60 - (performance.now() - lastConnectAt);
  if (wait > 0) await sleep(wait);
  lastConnectAt = performance.now();
  const { promise, resolve, reject } = Promise.withResolvers<Client>();
  const ws = new WebSocket(`ws://localhost:${PORT}`, { origin: ORIGIN });
  ws.on('open', () => resolve({ ws }));
  ws.on('error', reject);
  return promise;
}

async function startRoom() {
  const host = await connect();
  const guests: Client[] = [];
  for (let i = 0; i < GUESTS; i++) guests.push(await connect());
  const { promise, resolve } = Promise.withResolvers<string>();
  const found = (data: WebSocket.RawData) => {
    const m = unpackWireMessage(data as Buffer) as { type?: string; room?: { id: string } };
    if (m.type === 'room_update' && m.room) resolve(m.room.id);
  };
  host.ws.on('message', found);
  send(host, { type: 'create_room', name: 'Host', mode: 'ffa', gameMode: 'classic', maxPlayers: 6 });
  const roomId = await promise;
  for (let i = 0; i < GUESTS; i++) {
    send(guests[i], { type: 'join_room', roomId, name: `G${i}` });
    await sleep(20);
    send(guests[i], { type: 'ready', ready: true });
  }
  await sleep(50);
  send(host, { type: 'start_game' });
  await sleep(80);
  return { host, guests };
}

const resolutions = ['ship', 'planet', 'hole', 'shotdown', 'clash', 'lost', 'timeout'];
const seat = { score: 120, shots: 4, kills: 1, swingbys: 1, grazes: 0, ownGoals: 0, pickups: 0, saves: 0, alive: true };

function roundReport(round: number) {
  return {
    type: 'round_stats',
    round,
    title: 'hit',
    survivor: 0,
    team: null,
    seconds: 41.3,
    planets: 4,
    players: Array.from({ length: GUESTS + 1 }, () => seat),
    records: { bestHit: { player: 0, value: 250 } },
  };
}

/** A turn of `SHOTS` shots; `first` numbers them on from the round's earlier shots. */
function turnReport(round: number, turn: number, first: number) {
  return {
    type: 'turn_stats',
    round,
    turn,
    players: Array.from({ length: GUESTS + 1 }, () => ({ score: 120, alive: true })),
    shots: Array.from({ length: SHOTS }, (_, i) => ({
      n: first + i,
      turn,
      player: i % (GUESTS + 1),
      angle: ((first + i) * 37) % 360,
      power: 40 + (i % 50),
      powerUp: i % 7 === 0 ? 'plasma' : null,
      fork: false,
      resolution: resolutions[(first + i) % resolutions.length],
      hits: i % 5 === 0 ? 1 : 0,
      hitSeat: i % 5 === 0 ? (i + 1) % (GUESTS + 1) : null,
      hitKind: i % 5 === 0 ? 'enemy' : null,
      points: i % 5 === 0 ? 250 : 0,
    })),
  };
}

/** CPU seconds and resident memory of a process, from /proc. */
function usage(pid: number) {
  const stat = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ');
  const ticks = Number(stat[11]) + Number(stat[12]);
  const rss = /VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${pid}/status`, 'utf8'));
  return { cpu: ticks / 100, rssMb: rss ? Number(rss[1]) / 1024 : NaN };
}

/** Rows in a table of the stats file, read with Python's sqlite3 (the file is plain SQLite). */
function rows(db: string, table: string): number {
  const script = `import sqlite3,sys;print(sqlite3.connect(sys.argv[1]).execute("SELECT COUNT(*) FROM " + sys.argv[2]).fetchone()[0])`;
  const out = spawnSync('python3', ['-I', '-c', script, db, table], { encoding: 'utf8' });
  return out.status === 0 ? Number(out.stdout.trim()) : NaN;
}

async function run(withStats: boolean) {
  const dir = mkdtempSync(join(tmpdir(), 'slingshot-stats-bench-'));
  const statsDb = join(dir, 'stats.db');
  const relay: ChildProcess = spawn(BIN!, withStats ? ['--stats'] : [], {
    env: {
      ...process.env,
      PORT: String(PORT),
      ALLOW_ALL_ORIGINS: '1',
      ALLOWED_ORIGINS: '',
      CONNECTIONS_PER_IP_PER_SECOND: '1000',
      MAX_CONNECTIONS_PER_IP: '1000',
      MAX_MESSAGES_PER_SECOND: '100000',
      LEADERBOARD_DB: join(dir, 'leaderboard.db'),
      STATS_DB: statsDb,
      RUST_LOG: 'warn',
    },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  await sleep(800);
  try {
    const rooms = [];
    for (let i = 0; i < ROOMS; i++) rooms.push(await startRoom());

    const latency: number[] = [];
    let delivered = 0;
    let errors = 0;
    for (const { host, guests } of rooms) {
      host.ws.on('message', (d) => {
        if ((unpackWireMessage(d as Buffer) as { type?: string }).type === 'error') errors++;
      });
      for (const g of guests) {
        g.ws.on('message', (d) => {
          const m = unpackWireMessage(d as Buffer) as { type?: string; patch?: { t?: number } };
          if (m.type !== 'state') return;
          delivered++;
          if (typeof m.patch?.t === 'number') latency.push(performance.now() - m.patch.t);
        });
      }
    }

    const before = usage(relay.pid!);
    const start = performance.now();
    let reports = 0;
    await Promise.all(
      rooms.map(async ({ host }, index) => {
        let seq = 1;
        let round = 1;
        let turn = 0;
        let shots = 0;
        let lastReport = start + (index * TURN_MS) / ROOMS;
        for (let tick = 0; performance.now() - start < SECONDS * 1000; tick++) {
          send(host, { type: 'state', seq: seq++, patch: { t: performance.now() }, events: [] });
          if (performance.now() - lastReport >= TURN_MS && round < 1000) {
            send(host, turnReport(round, ++turn, shots + 1));
            shots += SHOTS;
            reports++;
            if (turn % TURNS === 0) {
              send(host, roundReport(round++));
              reports++;
              turn = 0;
              shots = 0;
            }
            lastReport = performance.now();
          }
          await sleep(Math.max(0, start + (tick + 1) * (1000 / 30) - performance.now()));
        }
      }),
    );
    const wall = (performance.now() - start) / 1000;
    await sleep(1500);
    const after = usage(relay.pid!);
    for (const { host, guests } of rooms) [host, ...guests].forEach((c) => c.ws.close());
    await sleep(200);
    relay.kill('SIGTERM');
    await new Promise((r) => relay.once('exit', r));
    latency.sort((a, b) => a - b);
    return {
      withStats,
      reports,
      errors,
      delivered,
      wall,
      p50: pct(latency, 0.5),
      p95: pct(latency, 0.95),
      p99: pct(latency, 0.99),
      max: latency.at(-1) ?? NaN,
      cpu: after.cpu - before.cpu,
      rssMb: after.rssMb,
      rounds: withStats ? rows(statsDb, 'stat_rounds') : NaN,
      turns: withStats ? rows(statsDb, 'stat_turns') : NaN,
      seats: withStats ? rows(statsDb, 'stat_seats') : NaN,
      shots: withStats ? rows(statsDb, 'stat_shots') : NaN,
    };
  } finally {
    relay.kill('SIGKILL');
    rmSync(dir, { recursive: true, force: true });
  }
}

if (!BIN || !existsSync(BIN)) {
  console.error('No relay binary: run `npm run build:server` first (or set BENCH_BIN).');
  process.exit(1);
}
if (BIN.includes(`${join('target', 'debug')}`)) console.warn('Using the debug build: the figures say little about production. Run `npm run build:server`.');
console.log(`${ROOMS} rooms × ${GUESTS + 1} players, ${SECONDS} s, a turn report of ${SHOTS} shots per room every ${TURN_MS} ms, a round report every ${TURNS} turns\n`);

const off = await run(false);
const on = await run(true);

const line = (label: string, a: string, b: string) => console.log(`${label.padEnd(34)}${a.padStart(14)}${b.padStart(14)}`);
line('', 'stats off', 'stats on');
line('reports sent (turns + rounds)', fmt(off.reports, 0), fmt(on.reports, 0));
line('relay errors sent back to hosts', fmt(off.errors, 0), fmt(on.errors, 0));
line('states delivered to guests', fmt(off.delivered, 0), fmt(on.delivered, 0));
line('state latency p50 (ms)', fmt(off.p50), fmt(on.p50));
line('state latency p95 (ms)', fmt(off.p95), fmt(on.p95));
line('state latency p99 (ms)', fmt(off.p99), fmt(on.p99));
line('state latency max (ms)', fmt(off.max), fmt(on.max));
line('relay CPU time (s)', fmt(off.cpu), fmt(on.cpu));
line('relay memory (MB)', fmt(off.rssMb, 1), fmt(on.rssMb, 1));
line('rows written (rounds)', '-', fmt(on.rounds, 0));
line('rows written (seats)', '-', fmt(on.seats, 0));
line('rows written (turns)', '-', fmt(on.turns, 0));
line('rows written (shots)', '-', fmt(on.shots, 0));
console.log(`\nwrite rate with stats on: ${fmt(on.reports / on.wall, 1)} reports/s, ${fmt((on.shots + on.seats + on.rounds + on.turns) / on.wall, 0)} rows/s`);
