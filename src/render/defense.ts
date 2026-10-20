import type { Defense, Planet } from '../physics';

/**
 * The planet a defense stands on: the one whose rim it sits at. Null once the rock is gone (a planet
 * killer takes its defenses with it, so this only happens for a frame).
 */
export function defensePlanet(planets: readonly Planet[], d: { x: number; y: number }): Planet | null {
  return planets.find((p) => Math.abs(Math.hypot(d.x - p.x, d.y - p.y) - p.radius) < 1.5) ?? null;
}

/**
 * A planetary defense: a small turret on the rim, and the ring it guards. Half of the ring lies inside the
 * rock and does nothing, so only the part above the surface is drawn — the side it keeps.
 */
export function drawDefense(
  ctx: CanvasRenderingContext2D,
  d: Pick<Defense, 'x' | 'y' | 'radius'>,
  planet: Planet | null,
  color: string,
  time: number,
  alpha = 1,
): void {
  const out = planet ? Math.atan2(d.y - planet.y, d.x - planet.x) : -Math.PI / 2;
  const pulse = 0.5 + 0.5 * Math.sin(time * 2.4);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  // The ring over the surface. Where it crosses the rock's edge the rim is at distance r / 2R from the turret.
  const open = planet ? Math.acos(Math.min(1, d.radius / (2 * planet.radius))) : Math.PI / 2;
  const from = out + Math.PI + open;
  const to = out + Math.PI - open + Math.PI * 2;
  ctx.globalAlpha = alpha * (0.07 + 0.05 * pulse);
  ctx.beginPath();
  ctx.moveTo(d.x, d.y);
  ctx.arc(d.x, d.y, d.radius, from, to);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = alpha * (0.55 + 0.2 * pulse);
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 4]);
  ctx.lineDashOffset = -time * 14;
  ctx.beginPath();
  ctx.arc(d.x, d.y, d.radius, from, to);
  ctx.stroke();
  ctx.setLineDash([]);
  // The turret: a base on the rim and a barrel pointing straight out.
  ctx.globalAlpha = alpha;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(d.x, d.y);
  ctx.lineTo(d.x + Math.cos(out) * 9, d.y + Math.sin(out) * 9);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(d.x, d.y, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
