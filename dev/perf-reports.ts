import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';

/** Where the dev server keeps what the pages measured, a JSON object a line. */
export const PERF_FILE = 'perf-reports.jsonl';
const MAX_BODY = 512 * 1024;

/**
 * Takes the frame times a page measured (`src/debug/perf-report.ts`), so a phone's can be read on the machine that serves it
 * (`npm run dev:phone`). Only the dev server has it. A page of another site cannot post: JSON needs a preflight, which gets no leave.
 */
export function perfReports(): Plugin {
  return {
    name: 'perf-reports',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__perf', (req, res) => {
        const refuse = (status: number): void => {
          res.statusCode = status;
          res.end();
        };
        if (req.method !== 'POST' || !req.headers['content-type']?.startsWith('application/json')) return refuse(405);
        const chunks: Buffer[] = [];
        let size = 0;
        req.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size <= MAX_BODY) chunks.push(chunk);
        });
        req.on('end', () => {
          if (size > MAX_BODY) return refuse(413);
          let report: { name?: unknown; summary?: unknown };
          try {
            report = JSON.parse(Buffer.concat(chunks).toString());
          } catch {
            return refuse(400);
          }
          appendFileSync(join(server.config.root, PERF_FILE), `${JSON.stringify({ at: new Date().toISOString(), ...report })}\n`);
          server.config.logger.info(`perf ${JSON.stringify(report.name)} ${JSON.stringify(report.summary)}`);
          refuse(204);
        });
      });
    },
  };
}
