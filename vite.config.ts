import { defineConfig } from 'vite';

// Relative base so the build works under any GitHub Pages sub-path
// (e.g. https://<user>.github.io/<repo>/).
export default defineConfig({
  base: './',
  server: {
    allowedHosts: ['ok-broker.sit.unite.services'],
  },
});
