/**
 * The whole game on this machine in one command (`npm run dev:local`): the relay with demo data, then the dev server already
 * pointed at it, opened at the title menu with the DEV panel. The relay's demo mode fills its own database
 * (`slingshot-stats-demo.db`) with sample statistics and leaderboard rows, never the real one. Ctrl+C stops both.
 *
 * `--no-open` leaves the browser closed. `RELAY_PORT` moves the relay (default 8080); `VITE_PORT` moves the page (default 5173).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { connect } from 'node:net';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const RELAY_PORT = Number(process.env.RELAY_PORT ?? 8080);
const PAGE_PORT = Number(process.env.VITE_PORT ?? 5173);
const RELAY = `ws://localhost:${RELAY_PORT}`;
const PAGE = `/?nointro&debug`;

const children: ChildProcess[] = [];
let stopping = false;
/** `--no-open` leaves the browser closed, for a preview pane that opens the page itself. */
const OPEN = !process.argv.includes('--no-open');

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
});
await listening(RELAY_PORT);
console.log(`Relay is up. Page: http://localhost:${PAGE_PORT}${PAGE}`);
run('page', 'npx', ['vite', '--port', String(PAGE_PORT), '--strictPort', ...(OPEN ? ['--open', PAGE] : [])], {
  VITE_MULTIPLAYER_SERVER: RELAY,
});
