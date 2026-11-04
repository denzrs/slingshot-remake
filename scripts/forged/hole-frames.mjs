// The frames of the forged black hole: `node scripts/forged/hole-frames.mjs <png dir>` writes `hole.png` there (a sheet of
// the disk turning, traced by `hole-trace.ts`), for `pack.py` to turn into `src/render/looks/forged/hole.webp`.
import { deflateSync, crc32 } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'vite';

const out = process.argv[2];
if (!out) throw new Error('usage: node scripts/forged/hole-frames.mjs <png dir>');
mkdirSync(out, { recursive: true });

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
const { bake, paint, shrink } = await server.ssrLoadModule('/scripts/forged/hole-trace.ts');
const { FRAME, FRAME_H, BAND_TOP, FRAMES, COLUMNS, LOOP } = await server.ssrLoadModule('/src/render/looks/forged-hole-sheet.ts');
await server.close();

// Traced at twice the width and shrunk, so the shadow's edge and the disk's rim come out smooth.
const SUPER = 2;
const hole = bake(FRAME * SUPER);
const rows = Math.ceil(FRAMES / COLUMNS);
const width = FRAME * COLUMNS;
const sheet = new Uint8Array(width * FRAME_H * rows * 4);
for (let f = 0; f < FRAMES; f++) {
  const frame = shrink(paint(hole, (f / FRAMES) * LOOP, LOOP), FRAME * SUPER, SUPER);
  const ox = (f % COLUMNS) * FRAME;
  const oy = Math.floor(f / COLUMNS) * FRAME_H;
  for (let y = 0; y < FRAME_H; y++) sheet.set(frame.subarray((BAND_TOP + y) * FRAME * 4, (BAND_TOP + y + 1) * FRAME * 4), ((oy + y) * width + ox) * 4);
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}
const header = Buffer.alloc(13);
header.writeUInt32BE(width, 0);
header.writeUInt32BE(FRAME_H * rows, 4);
header.set([8, 6, 0, 0, 0], 8);
const raw = Buffer.alloc((width * 4 + 1) * FRAME_H * rows);
for (let y = 0; y < FRAME_H * rows; y++) Buffer.from(sheet.buffer, y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
writeFileSync(
  join(out, 'hole.png'),
  Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]),
);
console.log(`hole.png: ${FRAMES} frames of ${FRAME}x${FRAME_H}px, ${LOOP}s loop`);
