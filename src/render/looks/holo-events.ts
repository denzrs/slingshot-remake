import { COLORS } from '../../sim/config';
import { rgba } from '../color';
import { easeOut } from '../effects';
import { hullPath } from '../ship';
import type { EffectStyle } from './painter';
import { drawHoloShip, holoPolygon } from './holo-art';

/**
 * What the holo look draws for things that happen, and that are gone again a moment later: a burst of wire where something
 * exploded and the shards it throws, a ship that scans itself into the field, the packets that stream behind a shot.
 * Nothing here runs by itself; everything starts from an event, so the picture stays calm in between.
 */

const TAU = Math.PI * 2;

/** A number in [0, 1) for one slot of a seed: the same on every frame and every screen. */
const slot = (seed: number, i: number): number => {
  const s = Math.sin((seed * 1000 + i) * 12.9898) * 43758.5453;
  return s - Math.floor(s);
};

// -------------------------------------------------------------------- blast ----

/**
 * A fireball as a burst of wire: a hexagon that flashes and shrinks, two more turning against each other as they grow
 * (the outer one dashed), spokes between them and triangular shards flying out, all fading by the end. `t` runs 0 → 1.
 */
export const drawHoloBlast: NonNullable<EffectStyle['blast']> = (ctx, blast, t) => {
  const grow = easeOut(Math.min(1, t * 1.25));
  const fade = (1 - t) ** 1.5;
  const R = blast.size * 0.5;
  const spin = blast.seed * TAU;
  ctx.save();
  ctx.translate(blast.x, blast.y);
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineJoin = 'round';

  const flash = Math.max(0, 1 - t / 0.22);
  if (flash > 0) {
    holoPolygon(ctx, R * (0.12 + 0.2 * flash), 6, spin);
    ctx.fillStyle = rgba(COLORS.bone, 0.55 * flash);
    ctx.fill();
  }

  holoPolygon(ctx, R * 0.55 * grow + 3, 6, spin + t * 1.2);
  ctx.strokeStyle = rgba(blast.color, 0.12 * fade);
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.strokeStyle = rgba(COLORS.bone, 0.9 * fade);
  ctx.lineWidth = 1.1;
  ctx.stroke();

  ctx.setLineDash([6, 5]);
  holoPolygon(ctx, R * 0.9 * grow + 4, 6, spin - t * 0.9);
  ctx.strokeStyle = rgba(blast.color, 0.7 * fade);
  ctx.lineWidth = 0.9;
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.beginPath();
  for (let k = 0; k < 6; k++) {
    const a = spin + (k * Math.PI) / 3 + Math.PI / 6;
    ctx.moveTo(Math.cos(a) * R * 0.3 * grow, Math.sin(a) * R * 0.3 * grow);
    ctx.lineTo(Math.cos(a) * R * 0.75 * grow, Math.sin(a) * R * 0.75 * grow);
  }
  ctx.strokeStyle = rgba(blast.color, 0.55 * fade);
  ctx.lineWidth = 0.8;
  ctx.stroke();

  // Shards: the bigger the blast, the more of them, thrown out further and turning as they go.
  const shards = Math.min(12, 5 + Math.floor(blast.size / 40));
  ctx.strokeStyle = rgba(blast.color, 0.9 * fade);
  ctx.lineWidth = 0.9;
  for (let i = 0; i < shards; i++) {
    const a = spin + (i / shards) * TAU + (slot(blast.seed, i) - 0.5) * 0.5;
    const distance = R * grow * (0.7 + 0.55 * slot(blast.seed, i + 40));
    const size = (2.5 + 3 * slot(blast.seed, i + 80) + R * 0.03) * (1 - t * 0.7);
    ctx.save();
    ctx.translate(Math.cos(a) * distance, Math.sin(a) * distance);
    ctx.rotate(a + t * (2 + 4 * slot(blast.seed, i + 120)) * (i % 2 ? 1 : -1));
    ctx.beginPath();
    ctx.moveTo(size, 0);
    ctx.lineTo(-size * 0.6, -size * 0.8);
    ctx.lineTo(-size * 0.6, size * 0.8);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
};

/**
 * A spark: a thin streak while it flies fast, a tiny square at rest, and for a big one a shard of wire (three or four
 * corners at uneven distances) tumbling as it goes.
 */
export const drawHoloShard: NonNullable<EffectStyle['spark']> = (ctx, s, speed) => {
  if (s.large && s.size > 3.4) {
    const corners = 3 + Math.floor(slot(s.seed, 1) * 2);
    const turn = s.seed * TAU + (performance.now() / 1000) * (s.seed < 0.5 ? -1 : 1) * (1.5 + s.seed * 4);
    const radius = s.size * 0.95;
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(turn);
    ctx.beginPath();
    for (let k = 0; k < corners; k++) {
      const a = (k / corners) * TAU;
      const r = radius * (0.6 + 0.6 * slot(s.seed, k + 5));
      if (k) ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      else ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fillStyle = rgba(s.color, 0.14);
    ctx.fill();
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.restore();
    return;
  }
  if (speed > 8) {
    const length = Math.min(speed * 0.03, 8) + 1.2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(s.x - (s.vx / speed) * length, s.y - (s.vy / speed) * length);
    ctx.stroke();
    return;
  }
  ctx.fillStyle = s.color;
  ctx.fillRect(s.x - 0.8, s.y - 0.8, 1.6, 1.6);
};

// --------------------------------------------------------------------- ship ----

/** A ship scans itself in over this many seconds when it appears (at the start of a round, or after a gap). */
const SCAN_IN = 0.9;
/** A ship that was not drawn for this long has gone, and appears anew. */
const GONE = 0.25;

interface Seen {
  born: number;
  last: number;
}
/** When each ship (by its `phase`) appeared, per canvas: the gallery draws several fields at once, each on a clock of its own. */
const ships = new WeakMap<HTMLCanvasElement, Map<number, Seen>>();

function age(canvas: HTMLCanvasElement, phase: number, time: number): number {
  let map = ships.get(canvas);
  if (!map) ships.set(canvas, (map = new Map()));
  const seen = map.get(phase);
  if (!seen || time < seen.last || time - seen.last > GONE) {
    map.set(phase, { born: time, last: time });
    return 0;
  }
  seen.last = time;
  return time - seen.born;
}

/**
 * A ship as the holo look draws it, and while it is new, scanned in: a line sweeps across the hull and what it has passed
 * is the ship, what it has not is a faint outline.
 */
export function drawHoloShipScanned(ctx: CanvasRenderingContext2D, color: string, time: number, thrust: number, phase: number): void {
  const t = age(ctx.canvas, phase, time) / SCAN_IN;
  if (t >= 1) {
    drawHoloShip(ctx, color, time, thrust, phase);
    return;
  }
  const y = -13 + 26 * easeOut(t);
  ctx.save();
  hullPath(ctx);
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = rgba(color, 0.22 * (1 - t));
  ctx.lineWidth = 0.7;
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.rect(-40, -14, 60, y + 14);
  ctx.clip();
  drawHoloShip(ctx, color, time, thrust, phase);
  ctx.restore();

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = rgba(color, 0.2 * (1 - t));
  ctx.fillRect(-14, y - 2, 32, 4);
  ctx.fillStyle = rgba(COLORS.bone, 0.9 * (1 - 0.5 * t));
  ctx.fillRect(-14, y - 0.6, 32, 1.2);
  ctx.restore();
}

// ------------------------------------------------------------------- packets ----

/** A shot's track is this many packets long at most, one every `SPACING` units. */
const PACKETS = 16;
const SPACING = 9;

/**
 * The track of a shot as a stream of data packets: small squares along its flight, turned to the heading, smaller and
 * fainter the older they are, under a thin line.
 */
export function drawHoloPackets(ctx: CanvasRenderingContext2D, pts: readonly number[], color: string): void {
  let count = 0;
  // The first packet sits a little behind the shot's head, so it does not lie on it.
  let carried = 5;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineJoin = 'miter';
  for (let i = pts.length - 4; i >= 0 && count < PACKETS; i -= 2) {
    const x1 = pts[i + 2];
    const y1 = pts[i + 3];
    const dx = x1 - pts[i];
    const dy = y1 - pts[i + 1];
    const len = Math.hypot(dx, dy);
    // A jump between the mouths of a wormhole is no flight: the stream ends there.
    if (len > 60) break;
    for (; carried < len && count < PACKETS; carried += SPACING) {
      const f = 1 - carried / (len || 1);
      const x = pts[i] + dx * f;
      const y = pts[i + 1] + dy * f;
      const k = count / PACKETS;
      const half = 2.6 - 1.8 * k;
      const a = Math.atan2(dy, dx);
      const cos = Math.cos(a) * half;
      const sin = Math.sin(a) * half;
      ctx.beginPath();
      ctx.moveTo(x + cos - sin, y + sin + cos);
      ctx.lineTo(x - cos - sin, y - sin + cos);
      ctx.lineTo(x - cos + sin, y - sin - cos);
      ctx.lineTo(x + cos + sin, y + sin - cos);
      ctx.closePath();
      ctx.strokeStyle = rgba(color, 0.9 * (1 - k) ** 1.2);
      ctx.lineWidth = 0.9;
      ctx.stroke();
      count++;
    }
    carried -= len;
  }
  ctx.restore();
}
