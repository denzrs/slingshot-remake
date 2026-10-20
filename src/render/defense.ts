import { COLORS, DEFENSE } from '../config';
import type { Defense, Planet } from '../physics';
import { rgba } from './color';

/**
 * The planet a defense stands on: the one whose rim it sits at. Null once the rock is gone (a planet
 * killer takes its defenses with it, so this only happens for a frame).
 */
export function defensePlanet(planets: readonly Planet[], d: { x: number; y: number }): Planet | null {
  return planets.find((p) => Math.abs(Math.hypot(d.x - p.x, d.y - p.y) - p.radius) < 1.5) ?? null;
}

/** A flying shot as the defense sees it: where it is, and how long it has been tracked (see `Shot.locks`). */
export interface DefenseTarget {
  x: number;
  y: number;
  lock: number;
}

/**
 * The enemy shots in flight that this defense is watching: the ones inside its dome, and the ones it has locked
 * on to that have since left it with the interceptor on the way.
 */
export function defenseTargets(
  shots: readonly { owner: number; shot: { x: number; y: number; end: unknown; locks: readonly number[] } }[],
  d: Defense,
  index: number,
): DefenseTarget[] {
  const out: DefenseTarget[] = [];
  for (const { owner, shot } of shots) {
    if (shot.end || d.protects.includes(owner)) continue;
    const lock = shot.locks[index] ?? 0;
    if (lock > 0 || Math.hypot(shot.x - d.x, shot.y - d.y) < d.radius) out.push({ x: shot.x, y: shot.y, lock });
  }
  return out;
}

/** The sprites are drawn at this multiple of their size, so they stay sharp on a high-density screen. */
const DETAIL = 2;
/** The hexagon cells of the dome's skin, in field units. */
const CELL = 11;

/**
 * The still part of a dome, drawn once per colour and size and reused every frame: a bubble of light brightening
 * towards its edge, a faint hexagon skin, and a glowing rim. It is drawn with the turret at the middle and the
 * outside of the planet towards +x, then the rock is cut out of it, so only the dome above the surface is left.
 */
const sprites = new Map<string, { image: HTMLCanvasElement; half: number }>();

function dome(color: string, radius: number, planetRadius: number): { image: HTMLCanvasElement; half: number } {
  const key = `${color}:${radius}:${planetRadius}`;
  const known = sprites.get(key);
  if (known) return known;
  const half = Math.ceil(radius + 8);
  const image = document.createElement('canvas');
  image.width = image.height = half * 2 * DETAIL;
  const ctx = image.getContext('2d')!;
  ctx.scale(DETAIL, DETAIL);
  ctx.translate(half, half);

  // The bubble: clear in the middle, bright at the edge, like glass seen from the side.
  const glass = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
  glass.addColorStop(0, rgba(color, 0.02));
  glass.addColorStop(0.6, rgba(color, 0.06));
  glass.addColorStop(0.92, rgba(color, 0.2));
  glass.addColorStop(1, rgba(color, 0.32));
  ctx.fillStyle = glass;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fill();

  // The skin: a hexagon lattice, kept inside the bubble.
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.clip();
  ctx.strokeStyle = rgba(color, 0.13);
  ctx.lineWidth = 0.7;
  const w = CELL * Math.sqrt(3);
  ctx.beginPath();
  for (let row = -Math.ceil(radius / (CELL * 1.5)) - 1; row <= Math.ceil(radius / (CELL * 1.5)) + 1; row++) {
    for (let col = -Math.ceil(radius / w) - 1; col <= Math.ceil(radius / w) + 1; col++) {
      const cx = col * w + (row & 1 ? w / 2 : 0);
      const cy = row * CELL * 1.5;
      for (let k = 0; k < 6; k++) {
        const a = Math.PI / 6 + (k * Math.PI) / 3;
        const px = cx + Math.cos(a) * CELL;
        const py = cy + Math.sin(a) * CELL;
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
    }
  }
  ctx.stroke();
  ctx.restore();

  // The rim: a glowing band with a thin white line just inside it.
  ctx.shadowColor = color;
  ctx.shadowBlur = 9;
  ctx.strokeStyle = rgba(color, 0.95);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.arc(0, 0, radius - 2.6, 0, Math.PI * 2);
  ctx.stroke();

  // Cut the rock out: the dome stands on the surface, it does not go through it.
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.arc(-planetRadius, 0, planetRadius, 0, Math.PI * 2);
  ctx.fill();

  const made = { image, half };
  sprites.set(key, made);
  return made;
}

/** Where the dome meets the ground, as an angle at the turret: the rock takes the sector of this half-angle facing it. */
const groundAngle = (radius: number, planetRadius: number): number => Math.acos(Math.min(1, radius / (2 * planetRadius)));

/**
 * A planetary defense: an energy dome standing on the planet, and the turret under it. The turret scans the dome
 * with a sweeping beam, and turns to the shot it is tracking; the dome brightens while an enemy is inside it.
 * `targets` are the shots it is watching (see `defenseTargets`); the lock-on and the interceptor are drawn by
 * `drawInterception`, over the shots.
 */
export function drawDefense(
  ctx: CanvasRenderingContext2D,
  d: Pick<Defense, 'x' | 'y' | 'radius'>,
  planet: Planet | null,
  color: string,
  time: number,
  alpha = 1,
  targets: readonly DefenseTarget[] = [],
): void {
  const out = planet ? Math.atan2(d.y - planet.y, d.x - planet.x) : -Math.PI / 2;
  const rock = planet?.radius ?? d.radius * 2;
  const { image, half } = dome(color, d.radius, rock);
  const open = groundAngle(d.radius, rock);
  // An enemy in the dome lights it up; a fresh firing kicks the barrel back.
  const alert = targets.length ? 1 : 0;
  const tracked = targets.reduce<DefenseTarget | null>((best, t) => (!best || t.lock > best.lock ? t : best), null);
  const fired = targets.reduce((kick, t) => Math.max(kick, t.lock >= DEFENSE.LOCK_TIME ? Math.max(0, 1 - (t.lock - DEFENSE.LOCK_TIME) / 0.12) : 0), 0);
  const aim = tracked ? Math.atan2(tracked.y - d.y, tracked.x - d.x) : out + Math.sin(time * 0.9) * 1.0;

  ctx.save();
  ctx.translate(d.x, d.y);
  ctx.save();
  ctx.rotate(out);
  ctx.globalAlpha = alpha * (0.85 + 0.15 * Math.sin(time * 2.4));
  ctx.drawImage(image, -half, -half, half * 2, half * 2);

  // The visible arc of the rim, from one foot on the ground round over the top to the other.
  const start = Math.PI + open;
  const span = Math.PI * 2 - open * 2;
  ctx.lineCap = 'round';
  ctx.strokeStyle = color;
  if (alert) {
    ctx.globalAlpha = alpha * (0.55 + 0.25 * Math.sin(time * 14));
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, d.radius, start, start + span);
    ctx.stroke();
  }
  // A glint running round the rim.
  const glint = start + ((time * 0.3) % 1) * (span - 0.4);
  ctx.globalAlpha = alpha * 0.9;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(0, 0, d.radius, glint, glint + 0.4);
  ctx.stroke();
  // The feet: where the dome meets the ground, a small bright spot each.
  ctx.fillStyle = color;
  ctx.globalAlpha = alpha;
  for (const sign of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(Math.cos(Math.PI + sign * open) * d.radius, Math.sin(Math.PI + sign * open) * d.radius, 2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // While nothing is tracked, a beam sweeps the dome with a fading wake behind it.
  if (!tracked) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    for (let k = 0; k < 4; k++) {
      const a = out + Math.sin(time * 0.9 - k * 0.09) * 1.0;
      ctx.globalAlpha = alpha * 0.4 * (1 - k / 4);
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * 7, Math.sin(a) * 7);
      ctx.lineTo(Math.cos(a) * d.radius * 0.97, Math.sin(a) * d.radius * 0.97);
      ctx.stroke();
    }
  }

  // The turret: a base plate on the surface, a round head, and the barrel pointing where it is looking.
  ctx.globalAlpha = alpha;
  ctx.save();
  ctx.rotate(out);
  ctx.fillStyle = COLORS.plate;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(-1, -8);
  ctx.lineTo(3, -5);
  ctx.lineTo(3, 5);
  ctx.lineTo(-1, 8);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  const headX = Math.cos(out) * 5.5;
  const headY = Math.sin(out) * 5.5;
  const kick = fired * 2.5;
  ctx.strokeStyle = color;
  ctx.lineWidth = 3.2;
  ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.moveTo(headX, headY);
  ctx.lineTo(headX + Math.cos(aim) * (13 - kick), headY + Math.sin(aim) * (13 - kick));
  ctx.stroke();
  ctx.fillStyle = COLORS.plate;
  ctx.beginPath();
  ctx.arc(headX, headY, 4.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.fillStyle = tracked ? '#ffffff' : color;
  ctx.beginPath();
  ctx.arc(headX, headY, 1.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * What a defense does to the shots it tracks, drawn over the shots: brackets closing on a shot while the turret
 * locks on, a dashed line to it, and, once the turret has fired, the interceptor racing along it.
 */
export function drawInterception(
  ctx: CanvasRenderingContext2D,
  d: Pick<Defense, 'x' | 'y'>,
  color: string,
  targets: readonly DefenseTarget[],
  time: number,
): void {
  if (!targets.length) return;
  ctx.save();
  ctx.lineCap = 'round';
  for (const t of targets) {
    const locking = Math.min(1, t.lock / DEFENSE.LOCK_TIME);
    const flight = t.lock >= DEFENSE.LOCK_TIME ? Math.min(1, (t.lock - DEFENSE.LOCK_TIME) / DEFENSE.TRAVEL_TIME) : 0;
    // The brackets: four corners that close in on the shot as the lock is made, then turn hot.
    const size = 18 - 10 * locking;
    const turn = time * 2.5 * (1 - locking);
    ctx.strokeStyle = locking >= 1 ? '#ff5c5c' : color;
    ctx.globalAlpha = 0.6 + 0.4 * locking;
    ctx.lineWidth = 1.8;
    for (let k = 0; k < 4; k++) {
      const a = turn + (k * Math.PI) / 2;
      ctx.beginPath();
      ctx.arc(t.x, t.y, size, a - 0.32, a + 0.32);
      ctx.stroke();
    }
    // The line the turret is tracking along.
    ctx.globalAlpha = 0.18 + 0.2 * locking;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 5]);
    ctx.beginPath();
    ctx.moveTo(d.x, d.y);
    ctx.lineTo(t.x, t.y);
    ctx.stroke();
    ctx.setLineDash([]);
    // The interceptor: a bright streak from where it was fired, its head running up to the shot.
    if (flight > 0) {
      const tail = Math.max(0, flight - 0.45);
      const head = { x: d.x + (t.x - d.x) * flight, y: d.y + (t.y - d.y) * flight };
      const back = { x: d.x + (t.x - d.x) * tail, y: d.y + (t.y - d.y) * tail };
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = color;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(back.x, back.y);
      ctx.lineTo(head.x, head.y);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(back.x, back.y);
      ctx.lineTo(head.x, head.y);
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(head.x, head.y, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}
