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

/**
 * `/stats` opens the statistics page (the game reads the path itself). A static host only answers for files that exist, so
 * the build also carries the page as `stats/index.html` – the same page, its relative links stepping up one level. The dev
 * and preview servers already answer any path with the page.
 */
function statsRoute(): Plugin {
  return {
    name: 'stats-route',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const page = bundle['index.html'];
      if (page?.type !== 'asset' || typeof page.source !== 'string') return;
      this.emitFile({ type: 'asset', fileName: 'stats/index.html', source: page.source.replaceAll('="./', '="../') });
    },
  };
}

// Relative base so the build works under any GitHub Pages sub-path
// (e.g. https://<user>.github.io/<repo>/).
export default defineConfig({
  base: './',
  // `DEBUG_AIM` (which serves /debug-aim.html) also reaches the client, so the in-game seed badge can follow it.
  envPrefix: ['VITE_', 'DEBUG_'],
  plugins: [debugAimGate(), statsRoute()],
  test: {
    // Sibling git worktrees live under .claude/; their tests are not this checkout's.
    exclude: [...configDefaults.exclude, '.claude/**'],
    // Only a ceiling, so a run that passes is not slower for it. Whole simulated games and relay round trips take a few
    // seconds when the workers share a small CI runner, which is longer than the 5 s default.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
