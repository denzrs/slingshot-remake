import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { perfReports } from '../dev/perf-reports';

const source = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

describe('frame time reports', () => {
  it('are taken by the dev server only: neither a build nor its preview has the endpoint', () => {
    const plugin = perfReports();
    expect(plugin.apply).toBe('serve');
    expect(plugin.configureServer).toBeDefined();
    expect(plugin.configurePreviewServer).toBeUndefined();
  });

  it('are recorded and sent by a dev build only, and by the game only when asked for', () => {
    expect(source('src/main.ts')).toContain("const perf = import.meta.env.DEV && new URLSearchParams(location.search).has('perf') ? new PerfRecorder() : null;");
    expect(source('src/debug/perf-report.ts')).toMatch(/function sendPerf\([^)]*\)[^{]*\{\n {2}if \(!import\.meta\.env\.DEV\) return false;/);
  });
});
