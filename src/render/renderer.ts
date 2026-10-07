import { AIM, COLORS, FIELD, FONTS, HORIZON, PHYSICS } from '../config';
import type { Match, Scene } from '../game';
import { spotlight, SPOTLIGHT_EVERY } from '../scorecard';
import { aimDirection, type World } from '../physics';
import { renderBackdrop, type View } from './backdrop';
import { drawBlackHole, drawDangerRing, drawLens } from './blackhole';
import { rgba } from './color';
import { renderContours } from './contours';
import type { Effects } from './effects';
import { Hud } from './hud';
import { renderPlanet } from './planets';

export interface DrawOptions {
  hud: boolean;
  /** Touch device: hint at dragging instead of keys. */
  touch: boolean;
  /** A clip is being recorded right now. */
  recording: boolean;
}

const SHIP_HULL: [number, number][] = [
  [15, 0], [-2, -5], [-11, -11], [-7, -3.5], [-11, 0], [-7, 3.5], [-11, 11], [-2, 5],
];

export class Renderer {
  view!: View;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly hud: Hud;
  private backdrop: { canvas: HTMLCanvasElement; walls: boolean } | null = null;
  /** Per world (live or killcam replay), rebuilt when the world's version or the pixel scale changes. */
  private contours = new WeakMap<World, { version: number; ps: number; canvas: HTMLCanvasElement }>();
  /** Planet sprites by seed at `spritePs` device pixels per field unit. */
  private sprites = new Map<number, HTMLCanvasElement>();
  private spritePs = 0;
  private time = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.hud = new Hud(this.ctx);
    this.resize();
  }

  resize(): void {
    const cssWidth = window.innerWidth;
    const cssHeight = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const margin = Math.min(28, cssWidth * 0.03);
    const scale = Math.min((cssWidth - margin * 2) / FIELD.width, (cssHeight - margin * 2) / FIELD.height);
    this.view = {
      cssWidth,
      cssHeight,
      dpr,
      scale,
      offsetX: (cssWidth - FIELD.width * scale) / 2,
      offsetY: (cssHeight - FIELD.height * scale) / 2,
    };
    this.canvas.width = Math.round(cssWidth * dpr);
    this.canvas.height = Math.round(cssHeight * dpr);
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;
    this.backdrop = null;
    this.contours = new WeakMap();
  }

  /** Convert a pointer position (client px) into field coordinates. */
  toField(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const v = this.view;
    return { x: (clientX - rect.left - v.offsetX) / v.scale, y: (clientY - rect.top - v.offsetY) / v.scale };
  }

  draw(match: Match, effects: Effects, opts: DrawOptions, dt: number): void {
    // Catches window resizes, zoom and moving to a screen with another pixel ratio.
    const v = this.view;
    if (v.cssWidth !== window.innerWidth || v.cssHeight !== window.innerHeight || v.dpr !== Math.min(window.devicePixelRatio || 1, 2)) {
      this.resize();
    }
    this.time += dt;
    const { ctx, view } = this;
    const { dpr, scale, offsetX, offsetY } = view;
    const scene = match.scene();
    const walls = match.rules.bounce;

    if (!this.backdrop || this.backdrop.walls !== walls) {
      this.backdrop = { canvas: renderBackdrop(view, walls), walls };
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.backdrop.canvas, 0, 0);

    const base = dpr * scale;
    const cam = scene.camera;
    const P = base * (cam?.zoom ?? 1);
    let tx = dpr * offsetX;
    let ty = dpr * offsetY;
    if (cam) {
      tx = dpr * (offsetX + (FIELD.width * scale) / 2) - cam.x * P;
      ty = dpr * (offsetY + (FIELD.height * scale) / 2) - cam.y * P;
    }
    const shakeX = effects.shake ? (Math.random() - 0.5) * 2 * effects.shake : 0;
    const shakeY = effects.shake ? (Math.random() - 0.5) * 2 * effects.shake : 0;

    ctx.save();
    if (cam) {
      // Keep the zoomed killcam inside the plate.
      ctx.beginPath();
      ctx.rect(dpr * offsetX, dpr * offsetY, FIELD.width * base, FIELD.height * base);
      ctx.clip();
    }
    ctx.setTransform(P, 0, 0, P, tx + shakeX * P, ty + shakeY * P);
    this.drawWorld(match, scene, base);
    this.drawTrails(match, scene);
    this.drawSpotlight(match, scene);
    this.drawShips(match, scene);
    effects.draw(ctx);
    ctx.restore();

    if (effects.flash > 0) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = rgba(COLORS.sodium, effects.flash * 0.1);
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }

    if (opts.hud) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.hud.draw(match, view, opts, this.time, (i) => ({
        x: offsetX + match.world.ships[i].x * scale,
        y: offsetY + match.world.ships[i].y * scale,
      }));
    }
  }

  private drawWorld(match: Match, scene: Scene, ps: number): void {
    const { ctx } = this;
    const world = scene.world;
    const hole = world.hole;
    if (hole) drawLens(ctx, hole, this.backdrop!.canvas);

    let alpha = 1;
    if (match.hiddenPlanets) {
      if (!match.planetsVisible) return;
      alpha = Math.min(1, match.phaseTime / 0.8);
    }

    if (match.settings.contours) {
      let layer = this.contours.get(world);
      if (!layer || layer.version !== world.version || layer.ps !== ps) {
        layer = { version: world.version, ps, canvas: renderContours(world, ps) };
        this.contours.set(world, layer);
      }
      // While the hole collapses everything moves, so the stale map fades back.
      ctx.globalAlpha = alpha * (match.phase === 'collapse' ? 0.25 : 1);
      ctx.drawImage(layer.canvas, 0, 0, FIELD.width, FIELD.height);
    }

    if (this.spritePs !== ps || this.sprites.size > 64) {
      this.sprites.clear();
      this.spritePs = ps;
    }
    for (const p of world.planets) {
      let sprite = this.sprites.get(p.seed);
      if (!sprite) {
        sprite = renderPlanet(p, ps);
        this.sprites.set(p.seed, sprite);
      }
      const size = sprite.width / ps;
      const eaten = scene.camera ? 0 : match.devourProgress(p.seed);
      ctx.globalAlpha = alpha * (1 - eaten * 0.4);
      if (eaten > 0 && hole) {
        // Spaghettification: stretched towards the hole, squeezed across, shrinking.
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(Math.atan2(hole.y - p.y, hole.x - p.x));
        const shrink = 1 - eaten * 0.85;
        ctx.scale((1 + eaten * 1.8) * shrink, (1 - eaten * 0.6) * shrink);
        ctx.drawImage(sprite, -size / 2, -size / 2, size, size);
        ctx.restore();
      } else {
        ctx.drawImage(sprite, p.x - size / 2, p.y - size / 2, size, size);
      }
    }
    ctx.globalAlpha = 1;

    if (hole) {
      drawBlackHole(ctx, hole, this.time);
      const next = match.nextHoleRadius;
      if (next && !scene.camera) drawDangerRing(ctx, hole, next, this.time);
    }
  }

  /** Round over: the shot behind the scorecard's current award is drawn in bright, from muzzle to where it counted. */
  private drawSpotlight(match: Match, scene: Scene): void {
    if (scene.camera || match.phase !== 'roundOver' || match.mode === 'challenge') return;
    const lit = spotlight(match);
    if (!lit || !lit.award.trail) return;
    const { ctx } = this;
    const color = match.players[lit.award.players[0]].color;
    // The path draws itself in, then its marker pulses.
    const drawn = Math.min(1, lit.age / 0.9);
    const count = lit.award.trail.length / 2;
    const part = lit.award.trail.slice(0, Math.max(2, Math.ceil(count * drawn)) * 2);
    const fade = Math.min(1, (SPOTLIGHT_EVERY - lit.age) / 0.4);
    ctx.save();
    ctx.globalAlpha = Math.max(0, fade);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = rgba(color, 0.22);
    ctx.lineWidth = 8;
    strokePolyline(ctx, part);
    ctx.strokeStyle = rgba(COLORS.bone, 0.95);
    ctx.lineWidth = 2.4;
    strokePolyline(ctx, part);
    const at = lit.award.at;
    if (at && drawn >= 1) {
      const pulse = (lit.age * 1.6) % 1;
      ctx.strokeStyle = rgba(color, 1 - pulse);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(at.x, at.y, 8 + pulse * 18, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = rgba(COLORS.bone, 0.95);
      ctx.beginPath();
      ctx.arc(at.x, at.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawTrails(match: Match, scene: Scene): void {
    const { ctx } = this;
    const rank = new Map<number, number>();
    // While a whole volley is in the air, last volley's trails step back so the live ones read clearly.
    const firstRank = (scene.volley?.shots.length ?? 0) > 1 ? 1 : 0;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (let i = scene.trails.length - 1; i >= 0; i--) {
      const t = scene.trails[i];
      const fade = match.trailAlpha(t);
      if (fade <= 0) continue;
      const r = rank.get(t.owner) ?? firstRank;
      rank.set(t.owner, r + 1);
      const color = match.players[t.owner].color;
      ctx.strokeStyle = rgba(color, (r === 0 ? 0.75 : r === 1 ? 0.38 : 0.2) * fade);
      ctx.lineWidth = r === 0 ? 1.6 : 1;
      ctx.setLineDash(r === 0 ? [] : [1.5, 4]);
      strokePolyline(ctx, t.points);
    }
    ctx.setLineDash([]);

    for (const vs of scene.volley?.shots ?? []) {
      const color = match.players[vs.owner].color;
      const shot = vs.shot;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      strokePolyline(ctx, vs.trail);
      if (shot.end) continue;
      if (shot.inField) {
        const glow = ctx.createRadialGradient(shot.x, shot.y, 0, shot.x, shot.y, 9);
        glow.addColorStop(0, rgba(COLORS.bone, 0.95));
        glow.addColorStop(0.3, rgba(color, 0.6));
        glow.addColorStop(1, rgba(color, 0));
        ctx.fillStyle = glow;
        ctx.fillRect(shot.x - 9, shot.y - 9, 18, 18);
      } else {
        this.drawOffscreenMarker(shot.x, shot.y, color);
      }
    }
  }

  /**
   * Chevron on the field edge pointing at a shot that has left the plate, with how far outside the field it is (0 at the edge,
   * counting up until it counts as lost). The chevron flashes in the last stretch.
   */
  private drawOffscreenMarker(x: number, y: number, color: string): void {
    const { ctx } = this;
    const inset = 18;
    const cx = Math.min(FIELD.width - inset, Math.max(inset, x));
    const cy = Math.min(FIELD.height - inset, Math.max(inset, y));
    const a = Math.atan2(y - cy, x - cx);
    const beyond = Math.max(-x, x - FIELD.width, -y, y - FIELD.height, 0);
    const left = Math.max(0, 1 - beyond / PHYSICS.OUT_MARGIN);
    const pulse = 0.65 + 0.35 * Math.sin(this.time * (8 + 22 * (1 - left)));
    const danger = left < 0.25;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.save();
    ctx.rotate(a);
    ctx.scale(1.5, 1.5);
    ctx.beginPath();
    ctx.moveTo(8, 0);
    ctx.lineTo(-5, -6);
    ctx.lineTo(-5, 6);
    ctx.closePath();
    ctx.fillStyle = rgba(danger ? COLORS.bone : color, pulse);
    ctx.fill();
    ctx.restore();
    ctx.font = `600 15px ${FONTS.mono}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = rgba(danger ? COLORS.bone : color, 0.9);
    ctx.fillText(String(Math.round(beyond)), -Math.cos(a) * 30, -Math.sin(a) * 30);
    ctx.restore();
  }

  private drawShips(match: Match, scene: Scene): void {
    const { ctx } = this;
    const live = !scene.camera;
    const planning = live && match.phase === 'aiming';
    const hole = scene.world.hole;

    scene.world.ships.forEach((ship, i) => {
      if (!ship.alive) return;
      const player = match.players[i];
      const color = player.color;
      if (player.target) return this.drawTarget(ship.x, ship.y, color);
      const current = planning && match.focus === i;

      if (current) {
        ctx.save();
        ctx.translate(ship.x, ship.y);
        ctx.rotate(this.time * 0.8);
        ctx.setLineDash([3, 5]);
        ctx.strokeStyle = rgba(color, 0.7);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(0, 0, 25, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        const clock = match.shotClock;
        if (clock !== null) {
          // Shot clock: an arc around the ship that runs down.
          ctx.strokeStyle = clock < 4 ? COLORS.danger : rgba(color, 0.9);
          ctx.lineWidth = 2.2;
          ctx.beginPath();
          ctx.arc(ship.x, ship.y, 30, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * clock) / HORIZON.SHOT_CLOCK);
          ctx.stroke();
        }
      }

      const aimShown = match.aimVisible(i);
      if (planning && aimShown) {
        if (current) this.drawAimVector(ship.x, ship.y, player.angle, player.power, color, 'full');
        else if (match.salvo && player.locked) this.drawAimVector(ship.x, ship.y, player.angle, player.power, color, 'ghost');
        else if (match.salvo && player.cpu) this.drawAimVector(ship.x, ship.y, player.angle, player.power, color, 'thin');
      }
      if (planning && match.salvo && player.locked) {
        ctx.strokeStyle = rgba(color, 0.55);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(ship.x, ship.y, 21, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Neighbour grace period: the ship that the aiming player's shot flies through gets a shield.
      if (planning && match.focus >= 0 && match.sparedFor(match.focus).includes(i)) {
        ctx.save();
        ctx.translate(ship.x, ship.y);
        ctx.rotate(-this.time * 0.5);
        ctx.setLineDash([2, 4]);
        ctx.strokeStyle = rgba(COLORS.bone, 0.7);
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(0, 0, 19, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      const swallow = live ? match.swallowProgress(i) : 0;
      ctx.save();
      ctx.translate(ship.x, ship.y);
      if (swallow > 0 && hole) {
        ctx.rotate(Math.atan2(hole.y - ship.y, hole.x - ship.x));
        const shrink = 1 - swallow * 0.85;
        ctx.scale((1 + swallow * 2) * shrink, (1 - swallow * 0.6) * shrink);
        ctx.rotate(-Math.atan2(hole.y - ship.y, hole.x - ship.x));
      }
      // Hidden aim: a ship that is aiming must not give its heading away — it keeps pointing at the middle.
      const hideHeading = planning && !aimShown;
      const heading = hideHeading ? (Math.atan2(ship.y - scene.world.height / 2, scene.world.width / 2 - ship.x) * 180) / Math.PI : player.angle;
      ctx.rotate((-heading * Math.PI) / 180);
      if (current && aimShown) {
        const flicker = 0.6 + 0.4 * Math.sin(this.time * 31) * Math.sin(this.time * 17);
        ctx.fillStyle = rgba(COLORS.sodium, 0.55 * flicker);
        ctx.beginPath();
        ctx.moveTo(-10, -2.5);
        ctx.lineTo(-16 - 4 * flicker, 0);
        ctx.lineTo(-10, 2.5);
        ctx.fill();
      }
      ctx.beginPath();
      SHIP_HULL.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = COLORS.plate;
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.fillStyle = COLORS.plate;
      ctx.beginPath();
      ctx.ellipse(4, 0, 3.2, 1.8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  }

  /** Daily challenge target: a diamond inside a ring the size of the hit box, with slowly turning brackets. */
  private drawTarget(x: number, y: number, color: string): void {
    const { ctx } = this;
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 2.4 + x * 0.01);
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = rgba(color, 0.5 + 0.3 * pulse);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(0, 0, PHYSICS.SHIP_RADIUS, 0, Math.PI * 2);
    ctx.stroke();
    ctx.rotate(this.time * 0.5);
    ctx.setLineDash([7, 8]);
    ctx.strokeStyle = rgba(color, 0.45);
    ctx.beginPath();
    ctx.arc(0, 0, 21, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    ctx.setLineDash([]);

    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(7, 0);
    ctx.lineTo(0, 7);
    ctx.lineTo(-7, 0);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = COLORS.plate;
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.restore();
  }

  private drawAimVector(x: number, y: number, angle: number, power: number, color: string, style: 'full' | 'ghost' | 'thin'): void {
    const { ctx } = this;
    const d = aimDirection(angle);
    const start = PHYSICS.MUZZLE + 8;
    const len = start + 18 + (power / AIM.MAX_POWER) * 110;
    const ex = x + d.x * len;
    const ey = y + d.y * len;
    const alpha = style === 'full' ? 0.9 : style === 'ghost' ? 0.4 : 0.45;
    ctx.strokeStyle = rgba(color, alpha);
    ctx.lineWidth = style === 'full' ? 1.3 : 1;
    ctx.setLineDash(style === 'ghost' ? [] : [4, 4]);
    ctx.lineDashOffset = -this.time * 12;
    ctx.beginPath();
    ctx.moveTo(x + d.x * start, y + d.y * start);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
    // Arrowhead.
    const px = -d.y;
    const py = d.x;
    ctx.fillStyle = rgba(color, style === 'full' ? 1 : alpha);
    ctx.beginPath();
    ctx.moveTo(ex + d.x * 7, ey + d.y * 7);
    ctx.lineTo(ex + px * 4, ey + py * 4);
    ctx.lineTo(ex - px * 4, ey - py * 4);
    ctx.closePath();
    ctx.fill();
  }
}

function strokePolyline(ctx: CanvasRenderingContext2D, pts: number[]): void {
  if (pts.length < 4) return;
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  ctx.stroke();
}
