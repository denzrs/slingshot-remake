import { AIM, COLORS, FIELD, FONTS, HORIZON, NEBULA, PHYSICS, WORMHOLE } from '../config';
import type { Match, Scene } from '../game';
import { t, type Key } from '../i18n';
import { spotlight, SPOTLIGHT_EVERY } from '../scorecard';
import { aimDirection, inNebula, isWormholeJump, nextWormholeId, type Wormhole, type World } from '../physics';
import { POWER_UP, PREVIEW_POINTS } from '../powerups';
import { renderBackdrop, type View } from './backdrop';
import { drawBlackHole, drawDangerRing, drawLens } from './blackhole';
import { rgba } from './color';
import { renderContours } from './contours';
import type { Effects } from './effects';
import { Hud } from './hud';
import type { OracleTap } from './oracle';
import { renderPlanet } from './planets';
import { drawNebula } from './nebula';
import { drawPortal, drawWormhole } from './wormhole';
import { defensePlanet, defenseView, drawDefense, drawInterception } from './defense';
import { drawPowerUpSymbol, portalColor, POWER_UP_COLORS } from './powerup-art';

export interface DrawOptions {
  hud: boolean;
  /** Touch device: hint at dragging instead of keys. */
  touch: boolean;
  /** A clip is being recorded right now. */
  recording: boolean;
  /** Show the key caps in the oracle's choices. */
  keyHints: boolean;
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
  /** When each power-up pickup was first drawn, for its pop-in. */
  private readonly pickupSeen = new Map<number, number>();

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

  /** The oracle choice under a pointer position (client px), if it is over one. */
  oracleHit(clientX: number, clientY: number): OracleTap | null {
    const rect = this.canvas.getBoundingClientRect();
    return this.hud.oracleHit(clientX - rect.left, clientY - rect.top);
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
    this.drawPowerUps(match, scene);
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
    const primary = world.holes[0];
    if (primary) drawLens(ctx, primary, this.backdrop!.canvas);

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

    // Nebula clouds sit behind the planets and the ships, so nothing hides inside them.
    if (world.nebulae.length) {
      ctx.globalAlpha = alpha;
      for (const n of world.nebulae) drawNebula(ctx, n, POWER_UP_COLORS.nebula, this.time);
      ctx.globalAlpha = 1;
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
      if (eaten > 0 && primary) {
        // Spaghettification: stretched towards the hole, squeezed across, shrinking.
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(Math.atan2(primary.y - p.y, primary.x - p.x));
        const shrink = 1 - eaten * 0.85;
        ctx.scale((1 + eaten * 1.8) * shrink, (1 - eaten * 0.6) * shrink);
        ctx.drawImage(sprite, -size / 2, -size / 2, size, size);
        ctx.restore();
      } else {
        ctx.drawImage(sprite, p.x - size / 2, p.y - size / 2, size, size);
      }
    }
    ctx.globalAlpha = 1;

    world.defenses.forEach((d, i) => drawDefense(ctx, d, defensePlanet(world.planets, d), match.players[d.owner]?.color ?? POWER_UP_COLORS.defense, this.time, alpha, defenseView(scene.volley?.shots ?? [], d, i)));
    for (const hole of world.holes) drawBlackHole(ctx, hole, this.time);
    // Each wormhole has a colour of its own, shared by its two portals.
    for (const w of world.wormholes) drawWormhole(ctx, w.ax, w.ay, w.bx, w.by, w.radius, this.time, w.id, scene.camera ? 0 : match.devourWormhole(w.id));
    const next = match.nextHoleRadius;
    if (next && primary && !scene.camera) drawDangerRing(ctx, primary, next, this.time);
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
    // In salvo modes, and while aiming, previous trails step back as dashed lines so the next or live shots read clearly.
    const firstRank = match.salvo || match.phase === 'aiming' ? 1 : 0;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    // The shots of one splitter fan count as one flight: they share a rank.
    const lastFan = new Map<number, number | undefined>();
    for (let i = scene.trails.length - 1; i >= 0; i--) {
      const t = scene.trails[i];
      const fade = match.trailAlpha(t);
      if (fade <= 0) continue;
      let r = rank.get(t.owner) ?? firstRank;
      if (t.fan !== undefined && lastFan.get(t.owner) === t.fan) r -= 1;
      else rank.set(t.owner, r + 1);
      lastFan.set(t.owner, t.fan);
      const color = match.players[t.owner].color;
      ctx.strokeStyle = rgba(color, (r === 0 ? 0.75 : r === 1 ? 0.38 : 0.2) * fade);
      ctx.lineWidth = r === 0 ? 1.6 : 1;
      ctx.setLineDash(r === 0 ? [] : [1.5, 4]);
      strokePolyline(ctx, t.points, match.world.wormholes);
    }
    ctx.setLineDash([]);

    for (const vs of scene.volley?.shots ?? []) {
      const color = match.players[vs.owner].color;
      const shot = vs.shot;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      strokePolyline(ctx, vs.trail, match.world.wormholes);
      if (shot.end) continue;
      if (shot.inField) {
        const owner = match.players[vs.owner];
        // A shot that can still be split carries a gold ring.
        if (match.powerUps && owner.armed && owner.powerUp === 'splitter') {
          ctx.save();
          ctx.strokeStyle = POWER_UP_COLORS.splitter;
          ctx.lineWidth = 1.5;
          ctx.globalAlpha = 0.55 + 0.45 * Math.sin(this.time * 8);
          ctx.beginPath();
          ctx.arc(shot.x, shot.y, 12, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
        // A shot in a nebula pushes against the gas: a ring spreads from it (the wisps it sheds are the Effects').
        if (!vs.heavy && inNebula(match.world.nebulae, shot.x, shot.y)) {
          ctx.save();
          ctx.strokeStyle = POWER_UP_COLORS.nebula;
          const ripple = (this.time * 1.6) % 1;
          ctx.globalAlpha = 0.5 * (1 - ripple);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(shot.x, shot.y, 6 + ripple * 18, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
        const glow = ctx.createRadialGradient(shot.x, shot.y, 0, shot.x, shot.y, 9);
        glow.addColorStop(0, rgba(COLORS.bone, 0.95));
        glow.addColorStop(0.3, rgba(color, 0.6));
        glow.addColorStop(1, rgba(color, 0));
        ctx.fillStyle = glow;
        ctx.fillRect(shot.x - 9, shot.y - 9, 18, 18);
        // A heavy round is a bigger, solid ball in a ring of its own colour.
        if (vs.heavy) {
          ctx.save();
          ctx.fillStyle = rgba(COLORS.bone, 0.98);
          ctx.beginPath();
          ctx.arc(shot.x, shot.y, 4.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = rgba(POWER_UP_COLORS.heavy, 0.9);
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(shot.x, shot.y, 8, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
        // An armor-piercing round is an arrowhead pointing where it flies, glowing like the plain shot.
        if (vs.pierce) {
          ctx.save();
          ctx.translate(shot.x, shot.y);
          ctx.rotate(Math.atan2(shot.vy, shot.vx));
          ctx.beginPath();
          ctx.moveTo(13, 0);
          ctx.lineTo(-6, -4);
          ctx.lineTo(-3, 0);
          ctx.lineTo(-6, 4);
          ctx.closePath();
          // A wide, faint outline in the owner's colour is the glow: shadowBlur costs far more on a phone.
          ctx.lineJoin = 'round';
          ctx.lineWidth = 6;
          ctx.strokeStyle = rgba(color, 0.35);
          ctx.stroke();
          ctx.fillStyle = rgba(COLORS.bone, 0.98);
          ctx.fill();
          ctx.restore();
        }
      } else {
        this.drawOffscreenMarker(shot.x, shot.y, color);
      }
    }
    // What the planetary defenses do to the shots they track: the lock-on and the interceptor, over the shots.
    match.world.defenses.forEach((d, i) => drawInterception(ctx, match.players[d.owner]?.color ?? POWER_UP_COLORS.defense, defenseView(scene.volley?.shots ?? [], d, i), this.time));
  }

  /** Power-ups: the pickups on the field, the path of an armed preview, and the symbol each ship holds. */
  private drawPowerUps(match: Match, scene: Scene): void {
    const { ctx } = this;
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 5);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    this.drawRepelWaves(match, scene);
    const present = new Set<number>();
    for (const pick of scene.pickups ?? []) {
      present.add(pick.id);
      let born = this.pickupSeen.get(pick.id);
      if (born === undefined) {
        born = this.time;
        this.pickupSeen.set(pick.id, born);
      }
      // Pops in with a little overshoot; blinks in its last pass before it fades.
      const age = this.time - born;
      const pop = age < 0.4 ? easeOutBack(age / 0.4) : 1;
      const expiring = (scene.pass ?? 0) - pick.born >= POWER_UP.LIFETIME_PASSES - 1;
      const alpha = Math.min(1, age / 0.15) * (expiring ? (Math.sin(this.time * 9) > 0 ? 1 : 0.35) : 1);
      const color = POWER_UP_COLORS[pick.kind];
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(pick.x, pick.y);
      ctx.scale(pop, pop);
      ctx.shadowColor = color;
      ctx.shadowBlur = 14 + 8 * pulse;
      ctx.fillStyle = COLORS.plate;
      ctx.beginPath();
      ctx.arc(0, 0, 15, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, 0, 15, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      drawPowerUpSymbol(ctx, pick.kind, 0, 0, 8);
      ctx.restore();
      ctx.save();
      ctx.globalAlpha = alpha * Math.min(1, pop);
      ctx.font = `700 11px ${FONTS.mono}`;
      ctx.fillStyle = color;
      ctx.fillText(t(`powerup.${pick.kind}` as Key).toUpperCase(), pick.x, pick.y + 20);
      ctx.restore();
    }
    for (const id of this.pickupSeen.keys()) if (!present.has(id)) this.pickupSeen.delete(id);
    if (scene.preview && scene.preview.length >= 4) {
      // Faded by its place in the preview window, not by how far the path happened to get: a shot
      // that hits something ends its path early, and a fade measured against that end would give
      // the impact away before it happens.
      const span = POWER_UP.PREVIEW_FADE_AT * (PREVIEW_POINTS - 1);
      const last = Math.min(scene.preview.length / 2 - 1, Math.ceil(span));
      ctx.save();
      ctx.strokeStyle = POWER_UP_COLORS.preview;
      ctx.lineWidth = 1.6;
      ctx.setLineDash([3, 5]);
      for (let i = 0; i < last; i++) {
        ctx.globalAlpha = 0.9 * Math.max(0, 1 - i / span);
        ctx.beginPath();
        ctx.moveTo(scene.preview[i * 2], scene.preview[i * 2 + 1]);
        ctx.lineTo(scene.preview[i * 2 + 2], scene.preview[i * 2 + 3]);
        ctx.stroke();
      }
      ctx.restore();
    }
    // A ship aiming a placement: a marker at the spot — a teleport door, or where a black hole, nebula or planet killer would land — with a line from the ship.
    if (scene.placement?.kind === 'planetkiller' || scene.placement?.kind === 'polarity') {
      // Only the angle aims a planet killer or a polarity, and the power plays no part. So the whole ray is drawn: out to the
      // planet it will take (or turn) when there is one — locked on with brackets round it — or dimly to the edge when there is not.
      const { owner, target, kind } = scene.placement;
      const from = match.world.ships[owner];
      const dir = aimDirection(match.players[owner].angle);
      const color = POWER_UP_COLORS[kind];
      const planet = target ? match.world.planets.find((p) => p.x === target.x && p.y === target.y) : undefined;
      const length = planet ? Math.hypot(planet.x - from.x, planet.y - from.y) - planet.radius : Math.hypot(FIELD.width, FIELD.height);
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineCap = 'round';
      ctx.setLineDash(planet ? [10, 7] : [3, 9]);
      ctx.lineDashOffset = -this.time * (planet ? 70 : 20);
      ctx.globalAlpha = planet ? 0.9 : 0.35;
      ctx.lineWidth = planet ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(from.x + dir.x * 22, from.y + dir.y * 22);
      ctx.lineTo(from.x + dir.x * length, from.y + dir.y * length);
      ctx.stroke();
      ctx.setLineDash([]);
      if (planet) {
        const r = planet.radius + 9 + 3 * pulse;
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.12 + 0.1 * pulse;
        ctx.beginPath();
        ctx.arc(planet.x, planet.y, planet.radius, 0, Math.PI * 2);
        ctx.fill();
        // Four brackets turning slowly round the planet: it is locked.
        ctx.globalAlpha = 0.95;
        ctx.lineWidth = 2.5;
        for (let k = 0; k < 4; k++) {
          const a = this.time * 0.8 + (k * Math.PI) / 2;
          ctx.beginPath();
          ctx.arc(planet.x, planet.y, r, a - 0.32, a + 0.32);
          ctx.stroke();
        }
        if (kind === 'polarity') {
          // Rays pushing out, or pulling in when the planet is turned already: what the planet will do to shots.
          const back = !!planet.reversed;
          ctx.lineWidth = 2;
          ctx.globalAlpha = 0.85;
          for (let k = 0; k < 8; k++) {
            const a = (k * Math.PI) / 4 + Math.PI / 8;
            const [inner, outer] = back ? [planet.radius + 30, planet.radius + 14] : [planet.radius + 14, planet.radius + 30];
            ctx.beginPath();
            ctx.moveTo(planet.x + Math.cos(a) * inner, planet.y + Math.sin(a) * inner);
            ctx.lineTo(planet.x + Math.cos(a) * outer, planet.y + Math.sin(a) * outer);
            ctx.stroke();
          }
          ctx.globalAlpha = 1;
          ctx.font = `700 11px ${FONTS.mono}`;
          ctx.textAlign = 'center';
          ctx.fillStyle = color;
          ctx.fillText(t(back ? 'powerup.polarityBack' : 'powerup.polarityTurn').toUpperCase(), planet.x, planet.y - planet.radius - 38);
        } else {
          // The crack that will split it.
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(planet.x - planet.radius * 0.45, planet.y - planet.radius * 0.5);
          ctx.lineTo(planet.x - planet.radius * 0.1, planet.y - planet.radius * 0.05);
          ctx.lineTo(planet.x + planet.radius * 0.18, planet.y + planet.radius * 0.12);
          ctx.lineTo(planet.x + planet.radius * 0.45, planet.y + planet.radius * 0.5);
          ctx.stroke();
        }
      }
      ctx.restore();
    }
    if (scene.placement?.target && scene.placement.kind !== 'planetkiller' && scene.placement.kind !== 'polarity') {
      const { owner, kind, target } = scene.placement;
      const from = match.world.ships[owner];
      const nextWormhole = nextWormholeId(match.world);
      const color = kind === 'teleport' || kind === 'defense' ? match.players[owner].color : kind === 'wormhole' ? portalColor(nextWormhole) : POWER_UP_COLORS[kind];
      ctx.save();
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.6;
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 6]);
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(target.x, target.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.85 + 0.15 * pulse;
      ctx.lineWidth = 2;
      if (kind === 'defense') {
        // In the colour of whoever is aiming it, like the ring that will stay on the field.
        ctx.strokeStyle = color;
        // The turret as it would stand, with its three zones and the chance of a hit in each. A planet has only
        // one defense, so one already there is marked: this one will replace it.
        const planet = defensePlanet(match.world.planets, target);
        if (planet) {
          drawDefense(ctx, { x: target.x, y: target.y, radius: planet.radius * POWER_UP.DEFENSE_RADIUS_SHARE }, planet, color, this.time, 1, undefined, true);
          const standing = match.world.defenses.find((o) => o.planet === planet.seed);
          if (standing) {
            ctx.globalAlpha = 1;
            ctx.font = `700 11px ${FONTS.mono}`;
            ctx.textAlign = 'center';
            ctx.fillStyle = '#ff5c5c';
            ctx.fillText(t('powerup.defenseReplaces').toUpperCase(), standing.x, standing.y + (standing.y > planet.y ? 22 : -16));
          }
        }
        ctx.beginPath();
        ctx.arc(target.x, target.y, 7 + 2 * pulse, 0, Math.PI * 2);
        ctx.stroke();
      } else if (kind === 'blackhole') {
        // The would-be horizon: a dark core inside a bright accretion ring.
        const r = POWER_UP.BLACKHOLE_RADIUS;
        ctx.beginPath();
        ctx.arc(target.x, target.y, r + 4 + 2.5 * pulse, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = COLORS.plate;
        ctx.beginPath();
        ctx.arc(target.x, target.y, r, 0, Math.PI * 2);
        ctx.fill();
      } else if (kind === 'wormhole') {
        // The portal being set is a ghost of itself. Once the first is set it stays on the field, solid, with a
        // thread to the second being aimed, in the colour the pair will have. A portal cannot overlap another:
        // the ghost then turns red and says so, because the click would do nothing.
        const first = scene.placement.first;
        const facing = first ? Math.atan2(target.y - first.y, target.x - first.x) : Math.atan2(target.y - from.y, target.x - from.x);
        const blocked = !!scene.placement.blocked;
        if (first) {
          ctx.save();
          ctx.globalAlpha = blocked ? 0.5 : 0.25;
          ctx.strokeStyle = blocked ? '#ff5c5c' : color;
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 6]);
          ctx.beginPath();
          ctx.moveTo(first.x, first.y);
          ctx.lineTo(target.x, target.y);
          ctx.stroke();
          ctx.restore();
          drawPortal(ctx, first.x, first.y, facing, WORMHOLE.RADIUS, color, this.time);
        }
        drawPortal(ctx, target.x, target.y, first ? facing + Math.PI : facing, WORMHOLE.RADIUS, color, this.time, blocked ? 0.3 : 0.7, 1);
        ctx.globalAlpha = 1;
        ctx.font = `700 11px ${FONTS.mono}`;
        ctx.textAlign = 'center';
        ctx.fillStyle = blocked ? '#ff5c5c' : color;
        // The labels sit on the far side of each portal from the other, so two close ones do not overprint.
        const side = first && target.y >= first.y ? 1 : -1;
        const reach = WORMHOLE.RADIUS * 1.12 + 10;
        ctx.fillText(t(blocked ? 'powerup.wormholeClose' : first ? 'powerup.wormholeSecond' : 'powerup.wormholeFirst').toUpperCase(), target.x, target.y + side * reach);
        if (first) {
          ctx.fillStyle = color;
          ctx.fillText(t('powerup.wormholeFirst').toUpperCase(), first.x, first.y - side * reach);
        }
      } else if (kind === 'nebula') {
        // The reach of the cloud as a plain ring: it must not wobble while the aim moves. The cloud that
        // lands gets its own random outline (its seed is drawn when it is laid).
        ctx.setLineDash([6, 5]);
        ctx.beginPath();
        ctx.arc(target.x, target.y, NEBULA.RADIUS, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha *= 0.45;
        ctx.beginPath();
        ctx.arc(target.x, target.y, NEBULA.RADIUS * 0.55, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        // The door: a ring with a solid core and a crosshair.
        ctx.beginPath();
        ctx.arc(target.x, target.y, 17 + 2.5 * pulse, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(target.x, target.y, 11, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = COLORS.plate;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(target.x - 4, target.y);
        ctx.lineTo(target.x + 4, target.y);
        ctx.moveTo(target.x, target.y - 4);
        ctx.lineTo(target.x, target.y + 4);
        ctx.stroke();
      }
      ctx.restore();
    }
    // The symbol of what each ship holds, small above the ship. Activation is shown in the HUD strip.
    for (const p of match.players) {
      if (!p.powerUp || !p.alive) continue;
      const ship = match.world.ships[p.id];
      ctx.save();
      ctx.strokeStyle = POWER_UP_COLORS[p.powerUp];
      ctx.fillStyle = POWER_UP_COLORS[p.powerUp];
      ctx.lineWidth = 1.8;
      ctx.lineCap = 'round';
      drawPowerUpSymbol(ctx, p.powerUp, ship.x, ship.y - 30, 5);
      ctx.restore();
      // A shield is a bubble round the ship.
      if (p.powerUp === 'shield') {
        ctx.save();
        ctx.strokeStyle = POWER_UP_COLORS.shield;
        ctx.fillStyle = POWER_UP_COLORS.shield;
        ctx.lineWidth = 1.6;
        ctx.globalAlpha = 0.5 + 0.2 * pulse;
        ctx.beginPath();
        ctx.arc(ship.x, ship.y, 21, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 0.07 + 0.05 * pulse;
        ctx.fill();
        ctx.restore();
      }
    }
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'start';
  }

  /** A planet whose gravity is turned round sends out rings that spread away from it, for as long as it pushes. */
  private drawRepelWaves(match: Match, scene: Scene): void {
    if (!match.powerUps) return;
    const { ctx } = this;
    ctx.save();
    ctx.strokeStyle = POWER_UP_COLORS.polarity;
    ctx.lineWidth = 1.6;
    for (const planet of scene.world.planets) {
      if (!planet.reversed) continue;
      // A faint rim in the polarity colour marks the planet that pushes.
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.arc(planet.x, planet.y, planet.radius + 2, 0, Math.PI * 2);
      ctx.stroke();
      for (let k = 0; k < 3; k++) {
        const phase = (this.time * 0.7 + k / 3) % 1;
        ctx.globalAlpha = 0.6 * (1 - phase);
        ctx.beginPath();
        ctx.arc(planet.x, planet.y, planet.radius + 6 + phase * 80, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /**
   * Chevron on the field edge pointing at a shot that has left the plate, with how far outside the field it is (0 at the edge,
   * counting up until it counts as lost). The chevron turns white in the last stretch.
   */
  private drawOffscreenMarker(x: number, y: number, color: string): void {
    const { ctx } = this;
    const inset = 18;
    const cx = Math.min(FIELD.width - inset, Math.max(inset, x));
    const cy = Math.min(FIELD.height - inset, Math.max(inset, y));
    const a = Math.atan2(y - cy, x - cx);
    const beyond = Math.max(-x, x - FIELD.width, -y, y - FIELD.height, 0);
    const left = Math.max(0, 1 - beyond / PHYSICS.OUT_MARGIN);
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
    ctx.fillStyle = rgba(danger ? COLORS.bone : color, 0.9);
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
    const hole = scene.world.holes[0];

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

/** Ease that overshoots a little before settling, 0 → 1. */
function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

function strokePolyline(ctx: CanvasRenderingContext2D, pts: number[], wormholes: readonly Wormhole[] = []): void {
  if (pts.length < 4) return;
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) {
    // The segment between the two mouths of a wormhole is no flight: the line breaks there.
    if (wormholes.length && isWormholeJump(pts, i, wormholes)) ctx.moveTo(pts[i], pts[i + 1]);
    else ctx.lineTo(pts[i], pts[i + 1]);
  }
  ctx.stroke();
}
