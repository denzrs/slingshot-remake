import type { Plugin } from 'vite';
import { configDefaults, defineConfig } from 'vitest/config';
import { devRoute } from './dev/routes';

/** The dev hub and its tools never resolve through the production SPA fallback. */
function devPagesGate(): Plugin {
  const gate = (development: boolean) => (req: { url?: string }, res: { statusCode: number; setHeader: (name: string, value: string) => void; end: (body?: string) => void }, next: () => void) => {
    const route = devRoute(req.url ?? '/', development, !!process.env.DEBUG_AIM);
    if (!route) return next();
    res.statusCode = route.status;
    if ('location' in route) res.setHeader('Location', route.location);
    res.end('message' in route ? route.message : undefined);
  };
  return {
    name: 'dev-pages-gate',
    configureServer(server) { server.middlewares.use(gate(true)); },
    configurePreviewServer(server) { server.middlewares.use(gate(false)); },
  };
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
  // `DEBUG_AIM` (which serves /dev/aim.html) also reaches the client, so the in-game seed badge can follow it.
  envPrefix: ['VITE_', 'DEBUG_'],
  plugins: [devPagesGate(), statsRoute()],
  optimizeDeps: {
    include: ['msgpackr'],
  },
  test: {
    // Sibling git worktrees live under .claude/; their tests are not this checkout's.
    exclude: [...configDefaults.exclude, '.claude/**'],
    // Only a ceiling, so a run that passes is not slower for it. Whole simulated games and relay round trips take a few
    // seconds when the workers share a small CI runner, which is longer than the 5 s default.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
