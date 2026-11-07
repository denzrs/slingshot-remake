// The frames of the forged black hole: `node scripts/forged/hole-frames.mjs <png dir>` writes `hole.png` there (a sheet of
// the disk turning, traced by `hole-trace.ts`) and `white.png` (the white hole's light in the shadow, on the same loop),
// for `pack.py` to turn into `src/render/looks/forged/hole.webp` and `white.webp`.
import { deflateSync, crc32 } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'vite';

const out = process.argv[2];
if (!out) throw new Error('usage: node scripts/forged/hole-frames.mjs <png dir>');
mkdirSync(out, { recursive: true });

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
const { bake, paint, paintWhite, shrink } = await server.ssrLoadModule('/scripts/forged/hole-trace.ts');
const { FRAME, FRAME_H, BAND_TOP, FRAMES, COLUMNS, LOOP, WHITE_FRAME, WHITE_COLUMNS } = await server.ssrLoadModule('/src/render/looks/forged-hole-sheet.ts');
await server.close();

// Traced at twice the width and shrunk, so the shadow's edge and the disk's rim come out smooth.
const SUPER = 2;
const hole = bake(FRAME * SUPER);
const rows = Math.ceil(FRAMES / COLUMNS);
const width = FRAME * COLUMNS;
const sheet = new Uint8Array(width * FRAME_H * rows * 4);
const whiteRows = Math.ceil(FRAMES / WHITE_COLUMNS);
const whiteWidth = WHITE_FRAME * WHITE_COLUMNS;
const white = new Uint8Array(whiteWidth * WHITE_FRAME * whiteRows * 4);
const cut = (FRAME - WHITE_FRAME) / 2;
for (let f = 0; f < FRAMES; f++) {
  const time = (f / FRAMES) * LOOP;
  const frame = shrink(paint(hole, time, LOOP), FRAME * SUPER, SUPER);
  const ox = (f % COLUMNS) * FRAME;
  const oy = Math.floor(f / COLUMNS) * FRAME_H;
  for (let y = 0; y < FRAME_H; y++) sheet.set(frame.subarray((BAND_TOP + y) * FRAME * 4, (BAND_TOP + y + 1) * FRAME * 4), ((oy + y) * width + ox) * 4);
  const light = shrink(paintWhite(hole, time, LOOP), FRAME * SUPER, SUPER);
  const wx = (f % WHITE_COLUMNS) * WHITE_FRAME;
  const wy = Math.floor(f / WHITE_COLUMNS) * WHITE_FRAME;
  for (let y = 0; y < WHITE_FRAME; y++) {
    const from = ((cut + y) * FRAME + cut) * 4;
    white.set(light.subarray(from, from + WHITE_FRAME * 4), ((wy + y) * whiteWidth + wx) * 4);
  }
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}
/** Writes `pixels` (RGBA, `w` × `h`) as `name`.png in the output folder. */
function png(name, pixels, w, h) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(w, 0);
  header.writeUInt32BE(h, 4);
  header.set([8, 6, 0, 0, 0], 8);
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) Buffer.from(pixels.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  writeFileSync(
    join(out, `${name}.png`),
    Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]),
  );
}
png('hole', sheet, width, FRAME_H * rows);
console.log(`hole.png: ${FRAMES} frames of ${FRAME}x${FRAME_H}px, ${LOOP}s loop`);
png('white', white, whiteWidth, WHITE_FRAME * whiteRows);
console.log(`white.png: ${FRAMES} frames of ${WHITE_FRAME}x${WHITE_FRAME}px, same loop`);
