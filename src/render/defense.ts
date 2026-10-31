import { COLORS, DEFENSE, FONTS } from '../sim/config';
import type { Defense, Missile, Planet } from '../sim/physics';
import { rgba } from './color';
import { fillTextUpright } from './orientation';

/**
 * The planet a defense stands on: the one whose rim it sits at. Null once the rock is gone (a planet
 * killer takes its defenses with it, so this only happens for a frame).
 */
export function defensePlanet(planets: readonly Planet[], d: { x: number; y: number }): Planet | null {
  return planets.find((p) => Math.abs(Math.hypot(d.x - p.x, d.y - p.y) - p.radius) < 1.5) ?? null;
}

/** What a defense is up to, as the renderer needs it: whether an enemy is in its area, and the missiles it has in the air. */
export interface DefenseView {
  /** An enemy shot is inside the area. */
  alert: boolean;
  /** The missiles after a shot, each with the shot it chases. */
  chases: { missile: Missile; shot: { x: number; y: number } }[];
  /** All its missiles in flight: those still chasing, and those that lost their shot and fly on. */
  missiles: Missile[];
}

type FlyingShot = { owner: number; shot: { x: number; y: number; end: unknown; missiles: readonly Missile[] } };

/** The enemy shots in flight that this defense is watching, and the missiles it has sent after them. */
export function defenseView(shots: readonly FlyingShot[], d: Defense, index: number): DefenseView {
  const view: DefenseView = { alert: false, chases: [], missiles: [] };
  for (const { owner, shot } of shots) {
    if (shot.end || d.protects.includes(owner)) continue;
    if (Math.hypot(shot.x - d.x, shot.y - d.y) < d.radius) view.alert = true;
    for (const missile of shot.missiles) {
      if (missile.defense !== index) continue;
      view.missiles.push(missile);
      if (missile.chasing) view.chases.push({ missile, shot });
    }
  }
  return view;
}

/** The sprites are drawn at this multiple of their size, so they stay sharp on a high-density screen. */
const DETAIL = 2;
/** The hexagon cells of the inner zone's skin, in field units. */
const CELL = 11;

const sprites = new Map<string, { image: HTMLCanvasElement; half: number }>();

/**
 * The still part of the area, drawn once per colour and size and reused every frame: the three zones, each
 * brighter than the one outside it, with a hexagon skin and a glowing rim on the inner one and dashed rims on
 * the others. It is drawn with the turret at the middle and the outside of the planet towards +x, then the rock
 * is cut out of it.
 */
function area(color: string, radius: number, planetRadius: number): { image: HTMLCanvasElement; half: number } {
  const key = `${color}:${radius}:${planetRadius}`;
  const known = sprites.get(key);
  if (known) return known;
  const [inner, middle] = DEFENSE.ZONES.map((zone) => radius * zone.reach);
  const half = Math.ceil(radius + 8);
  const image = document.createElement('canvas');
  image.width = image.height = half * 2 * DETAIL;
  const ctx = image.getContext('2d')!;
  ctx.scale(DETAIL, DETAIL);
  ctx.translate(half, half);
  const disc = (r: number): void => {
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
  };

  // The zones: each disc on top of the last, so the middle is the brightest and the edge the faintest.
  ctx.fillStyle = rgba(color, 0.035);
  disc(radius);
  ctx.fill();
  ctx.fillStyle = rgba(color, 0.05);
  disc(middle);
  ctx.fill();
  // The inner zone is glass: clear in the middle, bright at its edge.
  const glass = ctx.createRadialGradient(0, 0, 0, 0, 0, inner);
  glass.addColorStop(0, rgba(color, 0.04));
  glass.addColorStop(0.6, rgba(color, 0.09));
  glass.addColorStop(0.92, rgba(color, 0.2));
  glass.addColorStop(1, rgba(color, 0.32));
  ctx.fillStyle = glass;
  disc(inner);
  ctx.fill();

  // The inner zone's skin: a hexagon lattice.
  ctx.save();
  disc(inner);
  ctx.clip();
  ctx.strokeStyle = rgba(color, 0.14);
  ctx.lineWidth = 0.7;
  const w = CELL * Math.sqrt(3);
  const rows = Math.ceil(inner / (CELL * 1.5)) + 1;
  const cols = Math.ceil(inner / w) + 1;
  ctx.beginPath();
  for (let row = -rows; row <= rows; row++) {
    for (let col = -cols; col <= cols; col++) {
      const cx = col * w + (row & 1 ? w / 2 : 0);
      const cy = row * CELL * 1.5;
      for (let k = 0; k < 6; k++) {
        const a = Math.PI / 6 + (k * Math.PI) / 3;
        if (k === 0) ctx.moveTo(cx + Math.cos(a) * CELL, cy + Math.sin(a) * CELL);
        else ctx.lineTo(cx + Math.cos(a) * CELL, cy + Math.sin(a) * CELL);
      }
      ctx.closePath();
    }
  }
  ctx.stroke();
  ctx.restore();

  // The rims: dashed and faint on the outer zones, a glowing band with a white line on the inner one.
  ctx.strokeStyle = rgba(color, 0.4);
  ctx.lineWidth = 1.2;
  ctx.setLineDash([3, 8]);
  disc(radius);
  ctx.stroke();
  ctx.strokeStyle = rgba(color, 0.55);
  ctx.lineWidth = 1.4;
  ctx.setLineDash([7, 6]);
  disc(middle);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.shadowColor = color;
  ctx.shadowBlur = 9;
  ctx.strokeStyle = rgba(color, 0.95);
  ctx.lineWidth = 2;
  disc(inner);
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
  ctx.lineWidth = 0.8;
  disc(inner - 2.6);
  ctx.stroke();

  // Cut the rock out: the area stands on the surface, it does not go through it.
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.arc(-planetRadius, 0, planetRadius, 0, Math.PI * 2);
  ctx.fill();

  const made = { image, half };
  sprites.set(key, made);
  return made;
}

/** The chance of a hit in each zone, written along the line out from the planet. In the turret's frame. */
function drawDefenseLabels(ctx: CanvasRenderingContext2D, d: Pick<Defense, 'radius'>, out: number, color: string): void {
  // The chance of a hit in each zone, written along the line out from the planet.
  ctx.font = `700 11px ${FONTS.mono}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.9;
  let from = 0;
  for (const zone of DEFENSE.ZONES) {
    const to = d.radius * zone.reach;
    const r = from === 0 ? Math.max(to * 0.62, 16) : (from + to) / 2;
    fillTextUpright(ctx, `${Math.round(zone.chance * 100)}%`, Math.cos(out) * r + 14 * Math.cos(out + Math.PI / 2), Math.sin(out) * r + 14 * Math.sin(out + Math.PI / 2));
    from = to;
  }
}

/** What a look that draws a defense's body itself is given: the colour, the radii of the three zones and where the turret points. */
export interface DefenseFrame {
  color: string;
  radius: number;
  inner: number;
  middle: number;
  /** Half the angle, at the turret, of the sector the rock takes out of the inner zone. */
  open: number;
  /** The way out from the planet's middle, and where the turret is looking. */
  out: number;
  aim: number;
  alert: boolean;
  chasing: boolean;
  /** How far a fresh launch kicks the barrel back (0 → 1). */
  kick: number;
  time: number;
}

/** How a look changes a defense. All of it is optional: with none, the engraved one is drawn. */
export interface DefenseStyle {
  /** The whole body, in the defense's frame (the turret at the origin) and clipped by the rock, in place of the engraved one. The chances are written after. */
  body?(ctx: CanvasRenderingContext2D, frame: DefenseFrame): void;
  /** Light over the area, in the frame turned so the planet's outside lies towards +x. */
  glow?(ctx: CanvasRenderingContext2D, color: string, radius: number, inner: number, middle: number, open: number, time: number): void;
  /** The turret in place of the engraved one, drawn in the defense's frame. False when it cannot be drawn (an image that has not loaded). */
  turret?(ctx: CanvasRenderingContext2D, color: string, out: number, aim: number, kick: number, chasing: boolean, time: number): boolean;
}

/**
 * A planetary defense: its area in three zones with the turret on the planet's surface. The turret scans the area
 * with a sweeping beam, and turns to the shot its missile is after; the rims flare while an enemy is inside.
 * `view` is what it is up to (see `defenseView`); its missiles are drawn by `drawInterception`, over the shots.
 * `labels` writes the chance of a hit in each zone, for the aim. `hideRock` draws the rings whole, without the gap
 * where the planet is.
 */
export function drawDefense(
  ctx: CanvasRenderingContext2D,
  d: Pick<Defense, 'x' | 'y' | 'radius'>,
  planet: Planet | null,
  color: string,
  time: number,
  alpha = 1,
  view?: DefenseView,
  labels = false,
  hideRock = false,
  style: DefenseStyle = {},
): void {
  const out = planet ? Math.atan2(d.y - planet.y, d.x - planet.x) : -Math.PI / 2;
  // A hidden planet leaves no gap in the area, so the rings do not tell where it is.
  const rock = hideRock ? 0 : (planet?.radius ?? d.radius / 3);
  const { image, half } = area(color, d.radius, rock);
  const [inner, middle] = DEFENSE.ZONES.map((zone) => d.radius * zone.reach);
  // Where the inner zone meets the ground, as an angle at the turret: the rock takes the sector of this half-angle facing it.
  const open = Math.acos(Math.min(1, inner / (2 * rock || 1e-9)));
  const chasing = view?.chases[0];
  const aim = chasing ? Math.atan2(chasing.shot.y - d.y, chasing.shot.x - d.x) : out + Math.sin(time * 0.9) * 1.0;

  // A kick: a fresh launch pushes the barrel back.
  const kick = view?.chases.reduce((k, c) => Math.max(k, Math.max(0, 1 - c.missile.age / 0.12)), 0) ?? 0;

  if (style.body) {
    ctx.save();
    ctx.translate(d.x, d.y);
    ctx.globalAlpha = alpha;
    // The rock takes its share out of the area.
    if (planet && rock > 0) {
      ctx.beginPath();
      ctx.rect(-1e5, -1e5, 2e5, 2e5);
      ctx.moveTo(planet.x - d.x + rock, planet.y - d.y);
      ctx.arc(planet.x - d.x, planet.y - d.y, rock, 0, Math.PI * 2);
      ctx.clip('evenodd');
    }
    style.body(ctx, { color, radius: d.radius, inner, middle, open, out, aim, alert: !!view?.alert, chasing: !!chasing, kick, time });
    ctx.restore();
    if (labels) {
      ctx.save();
      ctx.translate(d.x, d.y);
      drawDefenseLabels(ctx, d, out, color);
      ctx.restore();
    }
    return;
  }
  ctx.save();
  ctx.translate(d.x, d.y);
  ctx.save();
  ctx.rotate(out);
  ctx.globalAlpha = alpha * (0.85 + 0.15 * Math.sin(time * 2.4));
  ctx.drawImage(image, -half, -half, half * 2, half * 2);
  style.glow?.(ctx, color, d.radius, inner, middle, open, time);

  ctx.lineCap = 'round';
  if (view?.alert) {
    // An enemy in the area: every rim flares.
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha * (0.4 + 0.25 * Math.sin(time * 14));
    ctx.lineWidth = 2;
    for (const r of [d.radius, middle]) {
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, inner, Math.PI + open, Math.PI * 3 - open);
    ctx.stroke();
  }
  // A glint running round the inner rim.
  const span = Math.PI * 2 - open * 2;
  const glint = Math.PI + open + ((time * 0.3) % 1) * (span - 0.4);
  ctx.globalAlpha = alpha * 0.9;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(0, 0, inner, glint, glint + 0.4);
  ctx.stroke();
  // The feet: where the inner zone meets the ground, a small bright spot each.
  ctx.fillStyle = color;
  ctx.globalAlpha = alpha;
  for (const sign of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(Math.cos(Math.PI + sign * open) * inner, Math.sin(Math.PI + sign * open) * inner, 2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // While no missile is out, a beam sweeps the inner zone with a fading wake behind it.
  if (!chasing) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    for (let k = 0; k < 4; k++) {
      const a = out + Math.sin(time * 0.9 - k * 0.09) * 1.0;
      ctx.globalAlpha = alpha * 0.4 * (1 - k / 4);
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * 7, Math.sin(a) * 7);
      ctx.lineTo(Math.cos(a) * inner * 0.97, Math.sin(a) * inner * 0.97);
      ctx.stroke();
    }
  }

  // The turret: a base plate on the surface, a round head, and the barrel pointing where it is looking.
  ctx.globalAlpha = alpha;
  if (style.turret?.(ctx, color, out, aim, kick, !!chasing, time)) {
    if (labels) drawDefenseLabels(ctx, d, out, color);
    ctx.restore();
    return;
  }
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
  ctx.strokeStyle = color;
  ctx.lineWidth = 3.2;
  ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.moveTo(headX, headY);
  ctx.lineTo(headX + Math.cos(aim) * (13 - kick * 2.5), headY + Math.sin(aim) * (13 - kick * 2.5));
  ctx.stroke();
  ctx.fillStyle = COLORS.plate;
  ctx.beginPath();
  ctx.arc(headX, headY, 4.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.fillStyle = chasing ? '#ffffff' : color;
  ctx.beginPath();
  ctx.arc(headX, headY, 1.5, 0, Math.PI * 2);
  ctx.fill();

  if (labels) drawDefenseLabels(ctx, d, out, color);
  ctx.restore();
}

/** How a look changes the missiles and the brackets on their target. */
export interface InterceptionStyle {
  /** The missiles are drawn in light that adds up. */
  additive?: boolean;
  /** How wide the exhaust track is at `t` (0 at its tail, 1 at the head). */
  trailWidth?(t: number): number;
  /** The missile itself, pointing along +x, with its flame behind it. */
  missile?(ctx: CanvasRenderingContext2D, color: string, time: number): void;
  /** The brackets closing on a shot, `size` from it and turned by `turn`; draws with the stroke already set. */
  brackets?(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, turn: number): void;
}

/**
 * The defense's missiles, drawn over the shots: each with its exhaust and a glowing head, and brackets closing
 * on the shot it is chasing, which turn hot when the missile is close. A missile flies straight through the rock
 * from the far side of its planet, so it and its exhaust are cut out of every planet in `rocks` (none while they are hidden).
 */
export function drawInterception(ctx: CanvasRenderingContext2D, color: string, view: DefenseView, time: number, rocks: readonly Planet[], style: InterceptionStyle = {}): void {
  if (!view.missiles.length) return;
  ctx.save();
  if (style.additive) ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (rocks.length) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(-1e5, -1e5, 2e5, 2e5);
    for (const p of rocks) {
      ctx.moveTo(p.x + p.radius, p.y);
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
    }
    ctx.clip('evenodd');
  }
  for (const m of view.missiles) {
    const fade = m.chasing ? 1 : Math.max(0, 1 - (m.age - DEFENSE.MISSILE_LIFE) / 0.4);
    // The exhaust: the track it has flown, brighter towards the head.
    const pts = m.trail;
    for (let i = 2; i < pts.length; i += 2) {
      const t = i / pts.length;
      ctx.globalAlpha = fade * t * 0.8;
      ctx.strokeStyle = t > 0.7 ? '#ffffff' : color;
      ctx.lineWidth = style.trailWidth ? style.trailWidth(t) : 1 + t * 2.2;
      ctx.beginPath();
      ctx.moveTo(pts[i - 2], pts[i - 1]);
      ctx.lineTo(pts[i], pts[i + 1]);
      ctx.stroke();
    }
    // The missile itself: a small dart pointing the way it flies, with a flickering flame behind.
    ctx.save();
    ctx.translate(m.x, m.y);
    ctx.rotate(m.heading);
    ctx.globalAlpha = fade;
    if (style.missile) {
      style.missile(ctx, color, time);
    } else {
      ctx.fillStyle = COLORS.sodium;
      ctx.beginPath();
      ctx.arc(-6, 0, 1.8 + 1.2 * Math.abs(Math.sin(time * 50 + m.age * 40)), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(7, 0);
      ctx.lineTo(-4, -2.8);
      ctx.lineTo(-2, 0);
      ctx.lineTo(-4, 2.8);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }
  if (rocks.length) ctx.restore();
  // Brackets round each shot a missile is after, closing in as it comes.
  for (const { missile, shot } of view.chases) {
    const gap = Math.hypot(shot.x - missile.x, shot.y - missile.y);
    const near = Math.max(0, Math.min(1, 1 - gap / 260));
    const size = 20 - 11 * near;
    ctx.strokeStyle = near > 0.75 ? '#ff5c5c' : color;
    ctx.globalAlpha = 0.55 + 0.45 * near;
    ctx.lineWidth = 1.8;
    const turn = time * 2.5 * (1 - near);
    if (style.brackets) {
      style.brackets(ctx, shot.x, shot.y, size, turn);
      continue;
    }
    for (let k = 0; k < 4; k++) {
      const a = turn + (k * Math.PI) / 2;
      ctx.beginPath();
      ctx.arc(shot.x, shot.y, size, a - 0.32, a + 0.32);
      ctx.stroke();
    }
  }
  ctx.restore();
}
