import { rgbaAt } from '../color';
import { SHARD_FROM, stampedSparks } from './spark-stamps';

/** The dark body of a piece of shrapnel. */
const darkened = rgbaAt(0.55);
/** The faint halo round an ember. */
const emberHalo = rgbaAt(0.18);

const CORNERS = 5;

/**
 * Forged's sparks: a streak of heat while it flies fast, with a white-hot head; a bigger one is a ragged piece of metal or rock
 * tumbling as it goes, dark with a glowing edge, the way it is caught by the light of the blast; one nearly at rest is an ember.
 */
export const drawShrapnel = stampedSparks({
  length: (speed, size) => Math.min(speed * 0.04, 11) + size * 0.5,
  width: (size) => Math.max(0.9, size * 0.75),
  lengths: { from: 0.7, to: 13.2, count: 16 },
  sizes: { from: 0.8, to: 4.4, count: 8 },
  streak(c, length, size, color) {
    c.lineCap = 'round';
    c.strokeStyle = color;
    c.lineWidth = Math.max(0.9, size * 0.75);
    c.beginPath();
    c.moveTo(0, 0);
    c.lineTo(-length, 0);
    c.stroke();
    // The head is white-hot.
    c.strokeStyle = 'rgba(255,250,235,0.85)';
    c.lineWidth = Math.max(0.5, size * 0.32);
    c.beginPath();
    c.moveTo(0, 0);
    c.lineTo(-length * 0.35, 0);
    c.stroke();
  },
  shapes: 16,
  shards: { from: SHARD_FROM, to: 4.4, count: 2 },
  reach: (size) => size * 0.95 * 1.15 + 1.2,
  // Points at uneven distances.
  outline(size, seed) {
    const path = new Path2D();
    for (let k = 0; k < CORNERS; k++) {
      const a = (k / CORNERS) * Math.PI * 2;
      const r = size * 0.95 * (0.55 + 0.6 * (((seed * 997 + k * 0.37) * 7.13) % 1));
      if (k) path.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      else path.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    path.closePath();
    return path;
  },
  body(c, outline, color) {
    c.fillStyle = darkened(color);
    c.fill(outline);
  },
  edge(c, outline, color) {
    c.strokeStyle = color;
    c.lineWidth = 0.7;
    c.stroke(outline);
  },
  spin: (seed) => (seed < 0.5 ? -1 : 1) * (1.5 + seed * 5),
  ember(ctx, size, color) {
    ctx.fillStyle = color;
    ctx.fillRect(-size / 2, -size / 2, size, size);
    ctx.fillStyle = emberHalo(color);
    ctx.fillRect(-size * 1.2, -size * 1.2, size * 2.4, size * 2.4);
  },
});
