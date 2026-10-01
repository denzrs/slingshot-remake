import { AIM, COLORS, FIELD, FONTS, PHYSICS } from '../config';
import type { Game, PlayerId } from '../game';
import { aimDirection, type World } from '../physics';
import { renderBackdrop, type View } from './backdrop';
import { rgba } from './color';
import { renderContours } from './contours';
import type { Effects } from './effects';
import { renderPlanet } from './planets';

export interface DrawOptions {
  hud: boolean;
  /** Player labels, e.g. "Spieler 1" / "CPU". */
  names: string[];
  /** Touch device: hint at dragging instead of keys. */
  touch: boolean;
}

interface WorldLayers {
  world: World;
  ps: number;
  planets: HTMLCanvasElement[];
  contours: HTMLCanvasElement;
}

const SHIP_HULL: [number, number][] = [
  [15, 0], [-2, -5], [-11, -11], [-7, -3.5], [-11, 0], [-7, 3.5], [-11, 11], [-2, 5],
];

export class Renderer {
  view!: View;
  private readonly ctx: CanvasRenderingContext2D;
  private backdrop: { canvas: HTMLCanvasElement; walls: boolean } | null = null;
  private layers: WorldLayers | null = null;
  private trailRank: number[] = [];
  private time = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
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
    this.layers = null;
  }

  /** Convert a pointer position (client px) into field coordinates. */
  toField(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const v = this.view;
    return { x: (clientX - rect.left - v.offsetX) / v.scale, y: (clientY - rect.top - v.offsetY) / v.scale };
  }

  draw(game: Game, effects: Effects, opts: DrawOptions, dt: number): void {
    // Catches window resizes, zoom and moving to a screen with another pixel ratio.
    const v = this.view;
    if (v.cssWidth !== window.innerWidth || v.cssHeight !== window.innerHeight || v.dpr !== Math.min(window.devicePixelRatio || 1, 2)) {
      this.resize();
    }
    this.time += dt;
    const { ctx, view } = this;
    const { dpr, scale, offsetX, offsetY } = view;
    const walls = game.settings.bounce;

    if (!this.backdrop || this.backdrop.walls !== walls) {
      this.backdrop = { canvas: renderBackdrop(view, walls), walls };
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.backdrop.canvas, 0, 0);

    const shakeX = effects.shake ? (Math.random() - 0.5) * 2 * effects.shake : 0;
    const shakeY = effects.shake ? (Math.random() - 0.5) * 2 * effects.shake : 0;
    const ps = dpr * scale;
    ctx.setTransform(ps, 0, 0, ps, dpr * offsetX + shakeX * ps, dpr * offsetY + shakeY * ps);

    this.drawWorld(game);
    this.drawTrails(game);
    this.drawShips(game);
    effects.draw(ctx);

    if (effects.flash > 0) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = rgba(COLORS.sodium, effects.flash * 0.1);
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }

    if (opts.hud) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.drawHud(game, opts);
    }
  }

  private drawWorld(game: Game): void {
    const { ctx, view } = this;
    const ps = view.dpr * view.scale;
    if (!this.layers || this.layers.world !== game.world || this.layers.ps !== ps) {
      this.layers = {
        world: game.world,
        ps,
        planets: game.world.planets.map((p) => renderPlanet(p, ps)),
        contours: renderContours(game.world, ps),
      };
    }
    let alpha = 1;
    if (game.hiddenPlanets) {
      if (!game.planetsVisible) return;
      alpha = Math.min(1, game.phaseTime / 0.8);
    }
    ctx.globalAlpha = alpha;
    if (game.settings.contours) ctx.drawImage(this.layers.contours, 0, 0, FIELD.width, FIELD.height);
    game.world.planets.forEach((p, i) => {
      const sprite = this.layers!.planets[i];
      const size = sprite.width / ps;
      ctx.drawImage(sprite, p.x - size / 2, p.y - size / 2, size, size);
    });
    ctx.globalAlpha = 1;
  }

  private drawTrails(game: Game): void {
    const { ctx } = this;
    this.trailRank.length = game.players.length;
    this.trailRank.fill(0);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (let i = game.trails.length - 1; i >= 0; i--) {
      const t = game.trails[i];
      const r = this.trailRank[t.owner]++;
      const color = COLORS.players[t.owner];
      ctx.strokeStyle = rgba(color, r === 0 ? 0.75 : r === 1 ? 0.38 : 0.2);
      ctx.lineWidth = r === 0 ? 1.6 : 1;
      ctx.setLineDash(r === 0 ? [] : [1.5, 4]);
      strokePolyline(ctx, t.points);
    }
    ctx.setLineDash([]);

    const shot = game.shot;
    const live = game.shotTrail;
    if (!shot || !live) return;
    const color = COLORS.players[live.owner];
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    strokePolyline(ctx, live.points);

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

  /** Chevron on the field edge pointing at a shot that has left the plate. */
  private drawOffscreenMarker(x: number, y: number, color: string): void {
    const { ctx } = this;
    const inset = 14;
    const cx = Math.min(FIELD.width - inset, Math.max(inset, x));
    const cy = Math.min(FIELD.height - inset, Math.max(inset, y));
    const a = Math.atan2(y - cy, x - cx);
    const pulse = 0.6 + 0.4 * Math.sin(this.time * 10);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(a);
    ctx.beginPath();
    ctx.moveTo(8, 0);
    ctx.lineTo(-5, -6);
    ctx.lineTo(-5, 6);
    ctx.closePath();
    ctx.fillStyle = rgba(color, pulse);
    ctx.fill();
    ctx.restore();
  }

  private drawShips(game: Game): void {
    const { ctx } = this;
    const destroyed = game.result?.target ?? null;
    for (let id = 0; id < game.players.length; id++) {
      if (id === destroyed) continue;
      const ship = game.world.ships[id];
      const player = game.players[id];
      const color = COLORS.players[id];
      const active = game.phase === 'aiming' && game.current === id;

      if (active) {
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
        this.drawAimVector(ship.x, ship.y, player.angle, player.power, color);
      }

      ctx.save();
      ctx.translate(ship.x, ship.y);
      ctx.rotate((-player.angle * Math.PI) / 180);
      if (active) {
        const flicker = 0.6 + 0.4 * Math.sin(this.time * 31) * Math.sin(this.time * 17);
        ctx.fillStyle = rgba(COLORS.sodium, 0.55 * flicker);
        ctx.beginPath();
        ctx.moveTo(-10, -2.5);
        ctx.lineTo(-16 - 4 * flicker, 0);
        ctx.lineTo(-10, 2.5);
        ctx.fill();
      }
      ctx.beginPath();
      SHIP_HULL.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
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
    }
  }

  private drawAimVector(x: number, y: number, angle: number, power: number, color: string): void {
    const { ctx } = this;
    const d = aimDirection(angle);
    const start = PHYSICS.MUZZLE + 8;
    const len = start + 18 + (power / AIM.MAX_POWER) * 110;
    const ex = x + d.x * len;
    const ey = y + d.y * len;
    ctx.strokeStyle = rgba(color, 0.9);
    ctx.lineWidth = 1.3;
    ctx.setLineDash([4, 4]);
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
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(ex + d.x * 7, ey + d.y * 7);
    ctx.lineTo(ex + px * 4, ey + py * 4);
    ctx.lineTo(ex - px * 4, ey - py * 4);
    ctx.closePath();
    ctx.fill();
  }

  // ————————————————————————————— HUD (CSS pixel space) —————————————————————————————

  private drawHud(game: Game, opts: DrawOptions): void {
    const { ctx, view } = this;
    const k = Math.min(1.2, Math.max(0.72, view.scale));
    const left = view.offsetX + 24 * k;
    const right = view.offsetX + FIELD.width * view.scale - 24 * k;
    const top = view.offsetY + 22 * k;

    if (game.players.length <= 2) {
      this.drawPlayerBlock(game, 0, opts.names[0], left, top, k, 'left');
      this.drawPlayerBlock(game, 1, opts.names[1], right, top, k, 'right');
    } else {
      const columns = 3;
      const spacing = (FIELD.width * view.scale) / columns;
      const start = view.offsetX + spacing / 2;
      for (let id = 0; id < game.players.length; id++) {
        this.drawCompactPlayerBlock(game, id, opts.names[id], start + (id % columns) * spacing, top + (32 + Math.floor(id / columns) * 46) * k, k);
      }
    }

    const cx = view.offsetX + (FIELD.width * view.scale) / 2;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = COLORS.bone;
    ctx.font = `800 ${26 * k}px ${FONTS.display}`;
    setSpacing(ctx, 2 * k);
    const total = game.totalRounds;
    ctx.fillText(total ? `RUNDE ${game.round} / ${total}` : `RUNDE ${game.round}`, cx, top - 2 * k);
    setSpacing(ctx, 0);

    if (game.phase === 'roundOver' && game.result) this.drawBanner(game, opts, cx, k);
    this.drawHint(game, opts, cx, view.offsetY + FIELD.height * view.scale - 20 * k, k);
  }

  private drawCompactPlayerBlock(game: Game, id: PlayerId, name: string, x: number, y: number, k: number): void {
    const { ctx } = this;
    const player = game.players[id];
    const color = COLORS.players[id];
    const active = game.phase === 'aiming' && game.current === id;
    ctx.globalAlpha = active || game.phase === 'roundOver' ? 1 : 0.68;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = color;
    ctx.font = `700 ${10 * k}px ${FONTS.body}`;
    setSpacing(ctx, 1.2 * k);
    ctx.fillText(`${game.mode === 'team' ? `TEAM ${game.teamOf(id) + 1} · ` : ''}${name.toUpperCase()}`, x, y);
    setSpacing(ctx, 0);
    ctx.fillStyle = COLORS.bone;
    ctx.font = `700 ${18 * k}px ${FONTS.mono}`;
    ctx.fillText(String(player.score), x, y + 14 * k);
    ctx.globalAlpha = 1;
  }

  private drawPlayerBlock(game: Game, id: PlayerId, name: string, x: number, y: number, k: number, align: 'left' | 'right'): void {
    const { ctx } = this;
    const p = game.players[id];
    const color = COLORS.players[id];
    const active = (game.phase === 'aiming' || game.phase === 'flying') && game.current === id;

    ctx.globalAlpha = active || game.phase === 'roundOver' || game.phase === 'gameOver' ? 1 : 0.55;
    ctx.textAlign = align;
    ctx.textBaseline = 'top';

    if (active) {
      ctx.fillStyle = color;
      ctx.fillRect(align === 'left' ? x - 12 * k : x + 9 * k, y + 1 * k, 3 * k, 76 * k);
    }

    ctx.fillStyle = color;
    ctx.font = `700 ${11.5 * k}px ${FONTS.body}`;
    setSpacing(ctx, 2.2 * k);
    ctx.fillText(name.toUpperCase(), x, y);
    setSpacing(ctx, 0);

    ctx.fillStyle = COLORS.bone;
    ctx.font = `700 ${30 * k}px ${FONTS.mono}`;
    ctx.fillText(String(p.score), x, y + 16 * k);

    ctx.font = `400 ${12.5 * k}px ${FONTS.mono}`;
    ctx.fillStyle = COLORS.boneDim;
    const angleText = `WINKEL ${fmt(p.angle, 2).padStart(6, ' ')}°`;
    const powerText = `KRAFT  ${fmt(p.power, 2).padStart(6, ' ')}${game.settings.fixedPower ? ' fix' : ''}`;
    ctx.fillText(angleText, x, y + 52 * k);
    ctx.fillText(powerText, x, y + 68 * k);

    // Power gauge.
    const gw = 128 * k;
    const gy = y + 86 * k;
    const gx = align === 'left' ? x : x - gw;
    ctx.fillStyle = rgba(COLORS.line, 0.35);
    ctx.fillRect(gx, gy, gw, 2 * k);
    ctx.fillStyle = color;
    const fill = (p.power / AIM.MAX_POWER) * gw;
    ctx.fillRect(align === 'left' ? gx : gx + gw - fill, gy, fill, 2 * k);
    ctx.globalAlpha = 1;
  }

  private drawBanner(game: Game, opts: DrawOptions, cx: number, k: number): void {
    const { ctx, view } = this;
    const r = game.result!;
    const t = Math.min(1, Math.max(0, (game.phaseTime - 0.35) / 0.4));
    if (t <= 0) return;
    const color = COLORS.players[r.winner];
    const cy = view.offsetY + (FIELD.height * view.scale) / 2;
    const h = 150 * k;
    const w = FIELD.width * view.scale;

    ctx.globalAlpha = t;
    ctx.fillStyle = rgba(COLORS.plate, 0.78);
    ctx.fillRect(view.offsetX, cy - h / 2, w, h);
    ctx.fillStyle = rgba(color, 0.8);
    ctx.fillRect(view.offsetX, cy - h / 2, w, 1);
    ctx.fillRect(view.offsetX, cy + h / 2 - 1, w, 1);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = color;
    ctx.font = `800 ${84 * k}px ${FONTS.display}`;
    setSpacing(ctx, 6 * k);
    ctx.fillText(r.kind === 'hit' ? 'TREFFER' : 'EIGENTREFFER', cx + 3 * k, cy + 12 * k);
    setSpacing(ctx, 0);

    ctx.fillStyle = COLORS.bone;
    ctx.font = `700 ${17 * k}px ${FONTS.body}`;
    ctx.fillText(`${opts.names[r.winner]}  +${r.points}`, cx, cy + 42 * k);

    ctx.fillStyle = COLORS.boneDim;
    ctx.font = `400 ${12.5 * k}px ${FONTS.mono}`;
    const detail =
      r.kind === 'hit'
        ? `${r.shots}. Schuss · Kraft ${fmt(r.power, 2)}`
        : `${opts.names[r.shooter]} hat das eigene Schiff getroffen`;
    ctx.fillText(detail, cx, cy + 62 * k);
    ctx.globalAlpha = 1;
  }

  private drawHint(game: Game, opts: DrawOptions, cx: number, y: number, k: number): void {
    const maxWidth = FIELD.width * this.view.scale - 48 * k;
    let items: [string, string][] = [];
    if (game.phase === 'aiming' && game.isHumanTurn) {
      if (opts.touch) {
        items = [['', 'Zum Zielen auf dem Spielfeld ziehen']];
      } else {
        const power: [string, string] = ['↑ ↓', game.settings.fixedPower ? 'Kraft fix' : 'Kraft'];
        items = [['← →', 'drehen'], power, ['Enter', 'Feuer'], ['Shift · Alt · Strg', 'Schrittweite'], ['Esc', 'Menü']];
        if (this.measureKeyRow(items, k) > maxWidth) items = [['← →', 'drehen'], power, ['Enter', 'Feuer']];
      }
    } else if (game.phase === 'aiming' && game.isRemoteTurn) {
      items = [['', `${opts.names[game.current]} zielt …`]];
    } else if (game.phase === 'aiming' && game.isCpu(game.current)) {
      items = [['', 'CPU zielt …']];
    } else if (game.phase === 'aiming') {
      items = [['', `${opts.names[game.current]} zielt …`]];
    } else if (game.phase === 'roundOver' && game.phaseTime > 0.6) {
      items = [[opts.touch ? '' : 'Leertaste', game.isLastRound ? 'Endstand' : 'Nächste Runde']];
    }
    if (!items.length) return;
    const width = this.measureKeyRow(items, k);
    this.drawKeyRow(items, cx, y, width > maxWidth ? (k * maxWidth) / width : k);
  }

  private keyRowMetrics(items: [string, string][], k: number) {
    const { ctx } = this;
    const keyFont = `700 ${11 * k}px ${FONTS.mono}`;
    const labelFont = `400 ${12 * k}px ${FONTS.body}`;
    const padX = 6 * k;
    const gap = 7 * k;
    const sep = 22 * k;
    const widths = items.map(([key, label]) => {
      ctx.font = keyFont;
      const kw = key ? ctx.measureText(key).width + padX * 2 : 0;
      ctx.font = labelFont;
      return { kw, lw: ctx.measureText(label).width };
    });
    const total = widths.reduce((s, w) => s + w.kw + (w.kw ? gap : 0) + w.lw, 0) + sep * (items.length - 1);
    return { keyFont, labelFont, padX, gap, sep, widths, total };
  }

  private measureKeyRow(items: [string, string][], k: number): number {
    return this.keyRowMetrics(items, k).total;
  }

  /** A centred row of keycaps with labels. */
  private drawKeyRow(items: [string, string][], cx: number, y: number, k: number): void {
    const { ctx } = this;
    const { keyFont, labelFont, padX, gap, sep, widths, total } = this.keyRowMetrics(items, k);
    let x = cx - total / 2;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    items.forEach(([key, label], i) => {
      const { kw, lw } = widths[i];
      if (key) {
        ctx.strokeStyle = rgba(COLORS.bone, 0.35);
        ctx.lineWidth = 1;
        roundRect(ctx, x + 0.5, y - 9 * k + 0.5, kw, 18 * k, 3 * k);
        ctx.stroke();
        ctx.fillStyle = COLORS.bone;
        ctx.font = keyFont;
        ctx.fillText(key, x + padX, y + 0.5 * k);
        x += kw + gap;
      }
      ctx.fillStyle = COLORS.boneDim;
      ctx.font = labelFont;
      ctx.fillText(label, x, y + 0.5 * k);
      x += lw + sep;
    });
  }
}

function strokePolyline(ctx: CanvasRenderingContext2D, pts: number[]): void {
  if (pts.length < 4) return;
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  ctx.stroke();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function setSpacing(ctx: CanvasRenderingContext2D, px: number): void {
  if ('letterSpacing' in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${px}px`;
}

/** German decimal formatting: 12,50 */
export function fmt(n: number, digits: number): string {
  return n.toFixed(digits).replace('.', ',');
}
