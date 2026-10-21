import type { Plugin } from 'vite';
import { configDefaults, defineConfig } from 'vitest/config';

/**
 * The debug aim predictor (`/debug-aim.html`) answers 404 unless the server was
 * started with `DEBUG_AIM` set to any non-empty value. It gates the dev and preview
 * servers; `vite build` bundles only `index.html`, so the page never ships in a build.
 */
function debugAimGate(): Plugin {
  const enabled = !!process.env.DEBUG_AIM;
  return {
    name: 'debug-aim-gate',
    configureServer(server) {
      if (!enabled) blockDebugAim(server);
    },
    configurePreviewServer(server) {
      if (!enabled) blockDebugAim(server);
    },
  };
}

/** 404 every request below /debug-aim while the gate is off. */
function blockDebugAim(server: { middlewares: { use: (fn: (req: { url?: string }, res: { statusCode: number; end: (body: string) => void }, next: () => void) => void) => void } }): void {
  server.middlewares.use((req, res, next) => {
    if (req.url?.startsWith('/debug-aim')) {
      res.statusCode = 404;
      res.end('debug aim predictor disabled: start the server with DEBUG_AIM set');
      return;
    }
    next();
  });
}

// Relative base so the build works under any GitHub Pages sub-path
// (e.g. https://<user>.github.io/<repo>/).
export default defineConfig({
  base: './',
  // `DEBUG_AIM` (which serves /debug-aim.html) also reaches the client, so the in-game seed badge can follow it.
  envPrefix: ['VITE_', 'DEBUG_'],
  plugins: [debugAimGate()],
  // Sibling git worktrees live under .claude/; their tests are not this checkout's.
  test: { exclude: [...configDefaults.exclude, '.claude/**'] },
});
