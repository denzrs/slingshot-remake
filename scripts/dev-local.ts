/**
 * The whole game on this machine in one command (`npm run dev:local`): the relay with demo data, then the dev server already
 * pointed at it, opened at the title menu with the DEV panel. The relay's demo mode fills its own database
 * (`slingshot-stats-demo.db`) with sample statistics and leaderboard rows, never the real one. Ctrl+C stops both.
 *
 * `--phone` (`npm run dev:phone`) serves both to the local network and prints the address as a QR code, to play on a phone in
 * the same Wi-Fi; whoever is on that network can open them. `LAN_HOST` names the address when the wrong one is found.
 *
 * `--no-open` leaves the browser closed. `RELAY_PORT` moves the relay (default 8080); `VITE_PORT` moves the page (default 5173).
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { connect } from 'node:net';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const RELAY_PORT = Number(process.env.RELAY_PORT ?? 8080);
const PAGE_PORT = Number(process.env.VITE_PORT ?? 5173);
const PHONE = process.argv.includes('--phone');
const HOST = PHONE ? lanAddress() : 'localhost';
const RELAY = `ws://${HOST}:${RELAY_PORT}`;
const PAGE = `/?nointro&debug${PHONE ? '&perf' : ''}`;

const children: ChildProcess[] = [];
let stopping = false;
/** `--no-open` leaves the browser closed, for a preview pane that opens the page itself. */
const OPEN = !PHONE && !process.argv.includes('--no-open');

/** This machine's address on the local network. A VPN's tunnel or Docker's bridge has an address too, but no phone gets to it. */
function lanAddress(): string {
  if (process.env.LAN_HOST) return process.env.LAN_HOST;
  for (const [name, addresses] of Object.entries(networkInterfaces())) {
    if (/^(docker|br-|veth|virbr|vmnet|vbox|tun|tap|wg|utun|zcctun|tailscale)/.test(name)) continue;
    const lan = addresses?.find((a) => a.family === 'IPv4' && !a.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address));
    if (lan) return lan.address;
  }
  console.error('No local network address found: set LAN_HOST to this machine\'s address.');
  process.exit(1);
}

/** Run a command with its output prefixed, so the relay's lines and the page's can be told apart. */
function run(label: string, command: string, args: string[], env: NodeJS.ProcessEnv): ChildProcess {
  const child = spawn(command, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  const prefix = (chunk: Buffer) => chunk.toString().split('\n').filter(Boolean).map((line) => `[${label}] ${line}\n`).join('');
  child.stdout!.on('data', (chunk: Buffer) => process.stdout.write(prefix(chunk)));
  child.stderr!.on('data', (chunk: Buffer) => process.stderr.write(prefix(chunk)));
  child.on('exit', (code) => {
    if (stopping) return;
    console.error(`[${label}] stopped (${code ?? 'signal'}); stopping the rest.`);
    stop(code ?? 1);
  });
  children.push(child);
  return child;
}

/** Wait until something listens on the port: the relay's first build can take a minute. */
async function listening(port: number): Promise<void> {
  for (;;) {
    const open = await new Promise<boolean>((resolve) => {
      const socket = connect(port, '127.0.0.1');
      socket.once('connect', () => { socket.destroy(); resolve(true); });
      socket.once('error', () => resolve(false));
    });
    if (open) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

function stop(code = 0): void {
  stopping = true;
  for (const child of children) child.kill('SIGINT');
  process.exit(code);
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());

console.log(`Relay with demo data on ${RELAY} (building first, if needed)…`);
run('relay', 'cargo', ['run', '--release', '--manifest-path', 'server/Cargo.toml', '--', '--stats-demo'], {
  DEV_SERVER: '1',
  PORT: String(RELAY_PORT),
  // The relay only answers pages it knows.
  ...(PHONE ? { ALLOWED_ORIGINS: `http://${HOST}:${PAGE_PORT}` } : {}),
});
await listening(RELAY_PORT);
console.log(`Relay is up. Page: http://${HOST}:${PAGE_PORT}${PAGE}`);
// Without qrencode the address above is there to type.
if (PHONE) console.log(`Frame times: http://${HOST}:${PAGE_PORT}/dev/perf.html (they land in perf-reports.jsonl)`);
if (PHONE) spawnSync('qrencode', ['-t', 'ansiutf8', `http://${HOST}:${PAGE_PORT}${PAGE}`], { stdio: ['ignore', 'inherit', 'ignore'] });
run('page', 'npx', ['vite', '--port', String(PAGE_PORT), '--strictPort', ...(PHONE ? ['--host', HOST] : []), ...(OPEN ? ['--open', PAGE] : [])], {
  VITE_MULTIPLAYER_SERVER: RELAY,
});
