/**
 * Builds the game from the working tree or from any commit, and serves the build to the scripts that look at it. A build
 * takes about a second and does not reload under a running page the way the dev server does, so the pages stay still.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';

const ROOT = join(import.meta.dirname, '..');

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.webp': 'image/webp',
  '.txt': 'text/plain; charset=utf-8',
};

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

/** The full commit a name (a branch, a tag, HEAD) stands for. */
export const resolveRef = (ref: string): string => git('rev-parse', '--verify', `${ref}^{commit}`);

function build(cwd: string, outDir: string): void {
  execFileSync(join(ROOT, 'node_modules', '.bin', 'vite'), ['build', '--outDir', outDir, '--emptyOutDir', '--logLevel', 'error'], { cwd, stdio: ['ignore', 'ignore', 'inherit'] });
}

/** Builds the working tree into a fresh folder and returns it. */
export function buildWorkingTree(): string {
  const out = mkdtempSync(join(tmpdir(), 'slingshot-build-'));
  build(ROOT, out);
  return out;
}

/** Builds a commit, in a throwaway checkout that borrows this one's node_modules, and returns the folder. */
export function buildCommit(sha: string): string {
  const checkout = mkdtempSync(join(tmpdir(), 'slingshot-checkout-'));
  const out = mkdtempSync(join(tmpdir(), 'slingshot-build-'));
  rmSync(checkout, { recursive: true });
  git('worktree', 'add', '--detach', checkout, sha);
  try {
    symlinkSync(join(ROOT, 'node_modules'), join(checkout, 'node_modules'));
    build(checkout, out);
  } finally {
    git('worktree', 'remove', '--force', checkout);
  }
  return out;
}

export interface Served {
  url: string;
  close(): Promise<void>;
}

/** Serves a built folder on a free port; the game is one page, so `/` is all that is asked for besides its files. */
export function serve(dir: string): Promise<Served> {
  const server: Server = createServer((req, res) => {
    const path = normalize(decodeURIComponent((req.url ?? '/').split('?')[0]));
    let file = join(dir, path === '/' ? 'index.html' : path);
    if (!file.startsWith(dir) || !existsSync(file) || statSync(file).isDirectory()) file = join(dir, 'index.html');
    res.setHeader('content-type', TYPES[extname(file)] ?? 'application/octet-stream');
    res.end(readFileSync(file));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      resolve({
        url: `http://127.0.0.1:${port}/`,
        close: () => new Promise((done) => {
          server.close(() => {
            rmSync(dir, { recursive: true, force: true });
            done();
          });
          server.closeAllConnections();
        }),
      });
    });
  });
}

export { ROOT };
