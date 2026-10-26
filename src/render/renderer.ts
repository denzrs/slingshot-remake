import { AIM, COLORS, FIELD, FONTS, HORIZON, NEBULA, PHYSICS, SOLAR, WORMHOLE } from '../sim/config';
import type { Match, Scene, Trail } from '../game';
import { t } from '../platform/i18n';
import { spotlight, SPOTLIGHT_EVERY } from '../game/scorecard';
import { aimDirection, inPowerUpNebula, isWormholeJump, nextWormholeId, stormCloudAt, type Wormhole, type World } from '../sim/physics';
import { POWER_UP, PREVIEW_POINTS } from '../sim/powerups';
import { renderBackdrop, type View } from './backdrop';
import { applyUpright, fieldTransform, plateUnits, portraitLayout, safeArea, touchScale } from './layout';
import { fillTextUpright, isTurned, screenOffset, setTurned, uprightFrame } from './orientation';
import { drawSun } from './sun';
import { orbitOf, solarCenter } from '../sim/world';
import { drawBlackHole, drawDangerRing, drawLens } from './blackhole';
import { rgba } from './color';
import { renderContours } from './contours';
import type { Effects } from './effects';
import { Hud } from './hud';
import type { OracleTap } from './oracle';
import { getLook, isRefined, type Look } from '../data/look';
import { LIGHT, type PlanetSprite } from './planet-common';
import { renderPlanet } from './planets';
import { drawRefinedShip, SHIP_HULL } from './ship';
import { drawNebula } from './nebula';
import { drawStormBurst, drawStormCloud, drawStormSparks, stormFlare } from './storm';
import { drawPortal, drawWormhole } from './wormhole';
import { defensePlanet, defenseView, drawDefense, drawInterception } from './defense';
import { drawPowerUpSymbol, portalColor, POWER_UP_COLORS } from './powerup-art';

export interface DrawOptions {
  hud: boolean;
  /** Fill the viewport with the animated world while a menu is open. */
  fullScreen: boolean;
  /** Touch device: hint at dragging instead of keys. */
  touch: boolean;
  /** A clip is being recorded right now. */
  recording: boolean;
  /** Show the key caps in the oracle's choices. */
  keyHints: boolean;
}

export class Renderer {
  view!: View;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly hud: Hud;
  /** The empty plate is on the canvas already; it stays until the canvas is resized or a match is drawn over it. */
  private emptyDrawn = false;
  private backdrop: { canvas: HTMLCanvasElement; walls: boolean; fullScreen: boolean } | null = null;
  /** Per world (live or killcam replay), rebuilt when the world's version or the pixel scale changes. */
  private contours = new WeakMap<World, { version: number; ps: number; canvas: HTMLCanvasElement }>();
  /** Planet sprites by seed at `spritePs` device pixels per field unit. */
  private sprites = new Map<number, PlanetSprite>();
  /** The finished trails, drawn once: dashed strokes are costly to rasterise and the trails only change when a shot ends. */
  private trailLayer: { key: string; world: World; canvas: HTMLCanvasElement } | null = null;
  private readonly trailIds = new WeakMap<Trail, number>();
  private spritePs = 0;
  private spriteLook: Look = getLook();
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
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    // Held upright a phone gets its own layout: HUD on top, the field, the thumbs' controls underneath.
    const portrait = coarse && cssHeight > cssWidth ? portraitLayout(cssWidth, cssHeight, safeArea(), touchScale()) : null;
    applyUpright(portrait);
    // On a touch screen the field is height-limited and small: give it every pixel.
    const margin = coarse ? 4 : Math.min(28, cssWidth * 0.03);
    const scale = portrait?.scale ?? Math.min((cssWidth - margin * 2) / FIELD.width, (cssHeight - margin * 2) / FIELD.height);
    const rotated = !!portrait?.rotated;
    const plate = plateUnits(rotated);
    this.view = {
      cssWidth,
      cssHeight,
      dpr,
      scale,
      offsetX: portrait?.offsetX ?? (cssWidth - plate.w * scale) / 2,
      offsetY: portrait?.offsetY ?? (cssHeight - plate.h * scale) / 2,
      stage: portrait?.stage,
      rotated,
    };
    setTurned(rotated);
    this.canvas.width = Math.round(cssWidth * dpr);
    this.canvas.height = Math.round(cssHeight * dpr);
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;
    this.backdrop = null;
    this.emptyDrawn = false;
    this.contours = new WeakMap();
    this.trailLayer = null;
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
    const sx = (clientX - rect.left - v.offsetX) / v.scale;
    const sy = (clientY - rect.top - v.offsetY) / v.scale;
    // Turned, the field's y runs to the right on the screen and its x up.
    return v.rotated ? { x: FIELD.width - sy, y: sx } : { x: sx, y: sy };
  }

  /** Where a field point is on the screen (CSS px on the canvas). */
  private screenOf(x: number, y: number): { x: number; y: number } {
    const { scale, offsetX, offsetY, rotated } = this.view;
    return rotated ? { x: offsetX + y * scale, y: offsetY + (FIELD.width - x) * scale } : { x: offsetX + x * scale, y: offsetY + y * scale };
  }

  /** Catches window resizes, zoom and moving to a screen with another pixel ratio. */
  private resizeIfNeeded(): void {
    const v = this.view;
    if (v.cssWidth !== window.innerWidth || v.cssHeight !== window.innerHeight || v.dpr !== Math.min(window.devicePixelRatio || 1, 2)) {
      this.resize();
    }
  }

  /** Just the empty plate, for menus that show no game behind them. */
  drawEmpty(): void {
    this.resizeIfNeeded();
    if (this.emptyDrawn) return;
    this.emptyDrawn = true;
    if (!this.backdrop || this.backdrop.walls || this.backdrop.fullScreen) this.backdrop = { canvas: renderBackdrop(this.view, false), walls: false, fullScreen: false };
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.drawImage(this.backdrop.canvas, 0, 0);
  }

  draw(match: Match, effects: Effects, opts: DrawOptions, dt: number): void {
    this.resizeIfNeeded();
    this.emptyDrawn = false;
    this.time += dt;
    const { ctx } = this;
    const view = this.view;
    const fieldView = opts.fullScreen ? this.fullScreenView() : view;
    const { dpr, scale, offsetX, offsetY } = fieldView;
    const scene = match.scene();
    const walls = match.rules.bounce;

    if (!this.backdrop || this.backdrop.walls !== walls || this.backdrop.fullScreen !== opts.fullScreen) {
      this.backdrop = { canvas: renderBackdrop(fieldView, walls, !opts.fullScreen), walls, fullScreen: opts.fullScreen };
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.backdrop.canvas, 0, 0);

    const base = dpr * scale;
    const cam = scene.camera;
    const P = base * (cam?.zoom ?? 1);
    const plate = plateUnits(!!fieldView.rotated);
    const [a, b, c, d, e, f] = fieldTransform(fieldView, cam ?? undefined);
    const shakeX = effects.shake ? (Math.random() - 0.5) * 2 * effects.shake : 0;
    const shakeY = effects.shake ? (Math.random() - 0.5) * 2 * effects.shake : 0;

    ctx.save();
    if (cam) {
      // Keep the zoomed killcam inside the plate.
      ctx.beginPath();
      ctx.rect(dpr * offsetX, dpr * offsetY, plate.w * base, plate.h * base);
      ctx.clip();
    }
    ctx.setTransform(a, b, c, d, e + shakeX * P, f + shakeY * P);
    this.drawWorld(match, scene, base);
    this.drawTrails(match, scene, base);
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
      this.hud.draw(match, view, opts, this.time, (i) => this.screenOf(match.world.ships[i].x, match.world.ships[i].y));
    }
  }

  private fullScreenView(): View {
    const view = this.view;
    const plate = plateUnits(!!view.rotated);
    const scale = Math.max(view.cssWidth / plate.w, view.cssHeight / plate.h);
    return {
      ...view,
      scale,
      offsetX: (view.cssWidth - plate.w * scale) / 2,
      offsetY: (view.cssHeight - plate.h * scale) / 2,
    };
  }

  private drawOrbits(world: World): void {
    const { ctx } = this;
    const centre = solarCenter();
    const radii: number[] = [];
    for (const o of [...world.planets.filter((p) => !p.sun), ...world.ships.filter((sh) => sh.alive)]) {
      const r = orbitOf(o.x, o.y).r;
      if (!radii.some((known) => Math.abs(known - r) < 0.5)) radii.push(r);
    }
    ctx.save();
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 6]);
    ctx.strokeStyle = 'rgba(111, 227, 200, 0.45)';
    for (const r of radii) {
      ctx.beginPath();
      ctx.ellipse(centre.x, centre.y, r * SOLAR.STRETCH, r, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255, 90, 110, 0.35)';
    for (const r of [SOLAR.INNER_ORBIT, SOLAR.OUTER_ORBIT]) {
      ctx.beginPath();
      ctx.ellipse(centre.x, centre.y, r * SOLAR.STRETCH, r, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** When this screen first saw each storm cloud, in renderer time: the burst plays from there, the same for every cloud of one storm. */
  private readonly stormSeen = new Map<number, number>();

  /** When this screen first saw each storm cloud thinning away, in renderer time. */
  private readonly stormFading = new Map<number, number>();

  /** How far a storm cloud has thinned away (0 → 1): its last turn of the system lasts about this long. */
  private stormDissolve(cloud: { seed: number; fading?: boolean }): number {
    if (!cloud.fading) {
      this.stormFading.delete(cloud.seed);
      return 0;
    }
    if (!this.stormFading.has(cloud.seed)) this.stormFading.set(cloud.seed, this.time);
    return Math.min(1, (this.time - this.stormFading.get(cloud.seed)!) / 1.7);
  }

  /** Seconds since the storm broke out (of the cloud with `seed`, or the newest one), or -1 when the world has none. */
  private stormAge(world: World, seed?: number): number {
    const clouds = world.nebulae.filter((n) => n.storm);
    if (!clouds.length) {
      this.stormSeen.clear();
      return -1;
    }
    for (const n of clouds) if (!this.stormSeen.has(n.seed)) this.stormSeen.set(n.seed, this.time);
    for (const key of this.stormSeen.keys()) if (!clouds.some((n) => n.seed === key)) this.stormSeen.delete(key);
    const first = seed === undefined ? Math.max(...this.stormSeen.values()) : this.stormSeen.get(seed)!;
    return this.time - first;
  }

  private drawWorld(match: Match, scene: Scene, ps: number): void {
    const { ctx } = this;
    const world = scene.world;
    const primary = world.holes[0];
    if (primary) drawLens(ctx, primary, this.backdrop!.canvas);

    // Hidden planets (and the contours of their gravity, which would give them away) fade in once the round is over.
    const showPlanets = match.planetsVisible;
    const alpha = match.hiddenPlanets ? Math.min(1, match.phaseTime / 0.8) : 1;

    if (showPlanets && match.settings.contours) {
      let layer = this.contours.get(world);
      if (!layer || layer.version !== world.version || layer.ps !== ps) {
        layer = { version: world.version, ps, canvas: renderContours(world, ps) };
        this.contours.set(world, layer);
      }
      // While the hole collapses everything moves, so the stale map fades back.
      ctx.globalAlpha = alpha * (match.phase === 'collapse' || match.phase === 'orbit' ? 0.25 : 1);
      ctx.drawImage(layer.canvas, 0, 0, FIELD.width, FIELD.height);
    }

    // Debug aid: the orbit every body of a Solar System rides, and the limits the orbits are laid out between.
    if (import.meta.env.DEBUG_AIM && match.mode === 'solar') this.drawOrbits(world);

    // Nebula clouds sit behind the planets and the ships, so nothing hides inside them.
    if (world.nebulae.length) {
      ctx.globalAlpha = 1;
      const sun = world.planets.find((p) => p.sun);
      for (const n of world.nebulae) {
        if (n.storm && sun) drawStormCloud(ctx, n, sun, this.stormAge(world, n.seed), this.time, this.stormDissolve(n));
        else drawNebula(ctx, n, POWER_UP_COLORS.nebula, this.time);
      }
      if (sun) drawStormBurst(ctx, sun, this.stormAge(world));
      ctx.globalAlpha = 1;
    }

    if (this.spritePs !== ps || this.spriteLook !== getLook() || this.sprites.size > 64) {
      this.sprites.clear();
      this.spritePs = ps;
      this.spriteLook = getLook();
    }
    const sun = match.mode === 'solar' ? world.planets.find((q) => q.sun) : undefined;
    for (const p of showPlanets ? world.planets : []) {
      if (p.sun) continue;
      let sprite = this.sprites.get(p.seed);
      if (!sprite) {
        sprite = renderPlanet(p, ps);
        this.sprites.set(p.seed, sprite);
      }
      const eaten = scene.camera ? 0 : match.devourProgress(p.seed);
      ctx.globalAlpha = alpha * (1 - eaten * 0.4);
      if (eaten > 0 && primary) {
        // Spaghettification: stretched towards the hole, squeezed across, shrinking.
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(Math.atan2(primary.y - p.y, primary.x - p.x));
        const shrink = 1 - eaten * 0.85;
        ctx.scale((1 + eaten * 1.8) * shrink, (1 - eaten * 0.6) * shrink);
        sprite.draw(ctx, 0, 0, ps, this.time);
        ctx.restore();
      } else if (sun && !isRefined()) {
        // A classic sprite is painted lit from one side; turn it so that side faces the sun it orbits.
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(Math.atan2(sun.y - p.y, sun.x - p.x) - SPRITE_LIGHT_ANGLE);
        sprite.draw(ctx, 0, 0, ps, this.time);
        ctx.restore();
      } else if (isTurned()) {
        // The light stays where it was painted: upright on the screen.
        ctx.save();
        ctx.translate(p.x, p.y);
        uprightFrame(ctx);
        sprite.draw(ctx, 0, 0, ps, this.time);
        ctx.restore();
      } else {
        sprite.draw(ctx, p.x, p.y, ps, this.time);
      }
    }
    ctx.globalAlpha = 1;

    world.defenses.forEach((d, i) => d.wrecked || drawDefense(ctx, d, defensePlanet(world.planets, d), match.players[d.owner]?.color ?? POWER_UP_COLORS.defense, this.time, 1, defenseView(scene.volley?.shots ?? [], d, i), false, !showPlanets));
    for (const p of world.planets) if (p.sun) drawSun(ctx, p, this.time, alpha, stormFlare(this.stormAge(world)));
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

  /** The finished trails on a canvas the size of the field plus a margin, rebuilt when a trail comes, goes or changes rank. */
  private trailLayerFor(match: Match, drawn: { trail: Trail; rank: number }[], ps: number): HTMLCanvasElement {
    const ids = drawn.map((d) => {
      let id = this.trailIds.get(d.trail);
      if (id === undefined) this.trailIds.set(d.trail, (id = nextTrailId++));
      return `${id}:${Math.min(d.rank, 2)}`;
    });
    const key = `${ps}|${ids.join(',')}`;
    const cached = this.trailLayer;
    if (cached && cached.key === key && cached.world === match.world) return cached.canvas;
    const canvas = cached?.canvas ?? document.createElement('canvas');
    canvas.width = Math.ceil((FIELD.width + 2 * TRAIL_MARGIN) * ps);
    canvas.height = Math.ceil((FIELD.height + 2 * TRAIL_MARGIN) * ps);
    const c = canvas.getContext('2d')!;
    c.setTransform(ps, 0, 0, ps, TRAIL_MARGIN * ps, TRAIL_MARGIN * ps);
    c.lineJoin = 'round';
    c.lineCap = 'round';
    strokeTrails(c, match, drawn as { trail: Trail; rank: number; fade: number }[]);
    this.trailLayer = { key, world: match.world, canvas };
    return canvas;
  }

  private drawTrails(match: Match, scene: Scene, ps: number): void {
    const { ctx } = this;
    const rank = new Map<number, number>();
    // In salvo modes, and while aiming, previous trails step back as dashed lines so the next or live shots read clearly.
    const firstRank = match.salvo || match.phase === 'aiming' ? 1 : 0;
    const lastFan = new Map<number, number | undefined>();
    const drawn: { trail: Trail; rank: number; fade: number }[] = [];
    // The shots of one splitter fan count as one flight: they share a rank.
    for (let i = scene.trails.length - 1; i >= 0; i--) {
      const t = scene.trails[i];
      const fade = match.trailAlpha(t);
      if (fade <= 0) continue;
      let r = rank.get(t.owner) ?? firstRank;
      if (t.fan !== undefined && lastFan.get(t.owner) === t.fan) r -= 1;
      else rank.set(t.owner, r + 1);
      lastFan.set(t.owner, t.fan);
      drawn.push({ trail: t, rank: r, fade });
    }
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const still = !scene.camera && drawn.length > 1 && drawn.every((d) => d.fade === 1);
    if (still) {
      const layer = this.trailLayerFor(match, drawn, ps);
      ctx.drawImage(layer, -TRAIL_MARGIN, -TRAIL_MARGIN, FIELD.width + 2 * TRAIL_MARGIN, FIELD.height + 2 * TRAIL_MARGIN);
    } else {
      strokeTrails(ctx, match, drawn);
    }

    for (const vs of scene.volley?.shots ?? []) {
      const color = match.players[vs.owner].color;
      const shot = vs.shot;
      ctx.strokeStyle = color;
      ctx.lineWidth = vs.plasma ? 1 : 2;
      if (vs.plasma) ctx.globalAlpha = 0.45;
      strokePolyline(ctx, vs.trail, match.world.wormholes);
      ctx.globalAlpha = 1;
      if (vs.plasma) this.drawPlasmaTrail(vs.trail, match.world.wormholes);
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
        if (!vs.plasma && inPowerUpNebula(match.world.nebulae, shot.x, shot.y)) {
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
        const storm = !vs.plasma ? stormCloudAt(match.world.nebulae, shot.x, shot.y) : undefined;
        if (storm) drawStormSparks(ctx, shot.x, shot.y, this.time, storm.seed);
        // A plasma shot is a pulsing cyan blob: a wide soft halo, a wobbling body and a bright core.
        if (vs.plasma) {
          ctx.save();
          const pulse = 1 + 0.12 * Math.sin(this.time * 14);
          const halo = ctx.createRadialGradient(shot.x, shot.y, 0, shot.x, shot.y, 15 * pulse);
          halo.addColorStop(0, rgba(POWER_UP_COLORS.plasma, 0.55));
          halo.addColorStop(1, rgba(POWER_UP_COLORS.plasma, 0));
          ctx.fillStyle = halo;
          ctx.fillRect(shot.x - 16, shot.y - 16, 32, 32);
          ctx.fillStyle = rgba(POWER_UP_COLORS.plasma, 0.9);
          ctx.beginPath();
          for (let i = 0; i <= 16; i++) {
            const a = (i / 16) * Math.PI * 2;
            const rr = 5.5 * pulse + 1.2 * Math.sin(a * 3 + this.time * 10);
            if (i === 0) ctx.moveTo(shot.x + Math.cos(a) * rr, shot.y + Math.sin(a) * rr);
            else ctx.lineTo(shot.x + Math.cos(a) * rr, shot.y + Math.sin(a) * rr);
          }
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = rgba('#e6ffff', 0.95);
          ctx.beginPath();
          ctx.arc(shot.x, shot.y, 2.4, 0, Math.PI * 2);
          ctx.fill();
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
    match.world.defenses.forEach((d, i) => d.wrecked || drawInterception(ctx, match.players[d.owner]?.color ?? POWER_UP_COLORS.defense, defenseView(scene.volley?.shots ?? [], d, i), this.time, match.planetsVisible ? scene.world.planets : []));
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
      uprightFrame(ctx);
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
      fillTextUpright(ctx, t(`powerup.${pick.kind}`).toUpperCase(), pick.x, pick.y, 0, 20);
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
    if (scene.placement?.kind === 'planetkiller' || scene.placement?.kind === 'antigravity') {
      // Only the angle aims a planet killer or a antigravity, and the power plays no part. So the whole ray is drawn: out to the
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
        if (kind === 'antigravity') {
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
          fillTextUpright(ctx, t(back ? 'powerup.antigravityBack' : 'powerup.antigravityTurn').toUpperCase(), planet.x, planet.y, 0, -planet.radius - 38);
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
    if (scene.placement?.target && scene.placement.kind !== 'planetkiller' && scene.placement.kind !== 'antigravity') {
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
          const standing = match.world.defenses.find((o) => o.planet === planet.seed && !o.wrecked);
          if (standing) {
            ctx.globalAlpha = 1;
            ctx.font = `700 11px ${FONTS.mono}`;
            ctx.textAlign = 'center';
            ctx.fillStyle = '#ff5c5c';
            // Above or below the planet as it appears on the screen.
            const below = isTurned() ? standing.x < planet.x : standing.y > planet.y;
            fillTextUpright(ctx, t('powerup.defenseReplaces').toUpperCase(), standing.x, standing.y, 0, below ? 22 : -16);
          }
        }
        ctx.beginPath();
        ctx.arc(target.x, target.y, 7 + 2 * pulse, 0, Math.PI * 2);
        ctx.stroke();
      } else if (kind === 'blackhole') {
        // The would-be horizon: a dark core inside a bright accretion ring.
        // Too close to another ship, the click would do nothing: the ring turns red, those ships show their keep-out circle, and it says so.
        const r = POWER_UP.BLACKHOLE_RADIUS;
        const blocked = !!scene.placement.blocked;
        if (blocked) {
          ctx.strokeStyle = '#ff5c5c';
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 5]);
          match.world.ships.forEach((s, i) => {
            if (i === owner || !s.alive) return;
            ctx.beginPath();
            ctx.arc(s.x, s.y, POWER_UP.BLACKHOLE_PLAYER_GAP, 0, Math.PI * 2);
            ctx.stroke();
          });
          ctx.setLineDash([]);
          ctx.lineWidth = 2;
        }
        ctx.beginPath();
        ctx.arc(target.x, target.y, r + 4 + 2.5 * pulse, 0, Math.PI * 2);
        ctx.stroke();
        if (blocked) {
          ctx.globalAlpha = 1;
          ctx.font = `700 11px ${FONTS.mono}`;
          ctx.textAlign = 'center';
          ctx.fillStyle = '#ff5c5c';
          ctx.fillText(t('powerup.blackholeClose').toUpperCase(), target.x, target.y + (target.y > 60 ? -r - 14 : r + 22));
          ctx.globalAlpha = 0.85 + 0.15 * pulse;
        }
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
        // Too close to another ship is a reason of its own: those ships show their keep-out circle.
        const nearShip = blocked && match.world.ships.some((s, i) => i !== owner && s.alive && Math.hypot(target.x - s.x, target.y - s.y) < WORMHOLE.PLAYER_GAP);
        if (nearShip) {
          ctx.save();
          ctx.strokeStyle = '#ff5c5c';
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 5]);
          match.world.ships.forEach((s, i) => {
            if (i === owner || !s.alive) return;
            ctx.beginPath();
            ctx.arc(s.x, s.y, WORMHOLE.PLAYER_GAP, 0, Math.PI * 2);
            ctx.stroke();
          });
          ctx.restore();
        }
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
        const side = first && (isTurned() ? target.x <= first.x : target.y >= first.y) ? 1 : -1;
        const reach = WORMHOLE.RADIUS * 1.12 + 10;
        fillTextUpright(ctx, t(nearShip ? 'powerup.blackholeClose' : blocked ? 'powerup.wormholeClose' : first ? 'powerup.wormholeSecond' : 'powerup.wormholeFirst').toUpperCase(), target.x, target.y, 0, side * reach);
        if (first) {
          ctx.fillStyle = color;
          fillTextUpright(ctx, t('powerup.wormholeFirst').toUpperCase(), first.x, first.y, 0, -side * reach);
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

  /** Plasma shot: a tapering cyan ribbon that swells toward the blob, with sparks that drift off the trail and die. */
  private drawPlasmaTrail(pts: number[], wormholes: readonly Wormhole[]): void {
    const { ctx } = this;
    const n = pts.length / 2;
    if (n < 2) return;
    const from = Math.max(1, n - 48);
    ctx.save();
    ctx.lineCap = 'round';
    for (let pass = 0; pass < 2; pass++) {
      for (let k = from; k < n; k++) {
        if (wormholes.length && isWormholeJump(pts, k * 2, wormholes)) continue;
        const f = (k - from + 1) / (n - from);
        ctx.strokeStyle = pass === 0 ? rgba(POWER_UP_COLORS.plasma, 0.22 * f) : rgba('#e6ffff', 0.8 * f * f);
        ctx.lineWidth = (pass === 0 ? 9 : 2.4) * f;
        ctx.beginPath();
        ctx.moveTo(pts[k * 2 - 2], pts[k * 2 - 1]);
        ctx.lineTo(pts[k * 2], pts[k * 2 + 1]);
        ctx.stroke();
      }
    }
    // Sparks: every few points a speck sits off the line, drifting sideways as it ages and shrinking away.
    for (let k = from; k < n; k += 3) {
      const age = (n - k) / 48;
      const side = Math.sin(k * 12.9898) > 0 ? 1 : -1;
      const dx = pts[k * 2] - pts[k * 2 - 2];
      const dy = pts[k * 2 + 1] - pts[k * 2 - 1];
      const len = Math.hypot(dx, dy) || 1;
      const off = side * (2 + age * 9 + 1.5 * Math.sin(this.time * 6 + k));
      ctx.fillStyle = rgba(POWER_UP_COLORS.plasma, 0.7 * (1 - age));
      ctx.beginPath();
      ctx.arc(pts[k * 2] - (dy / len) * off, pts[k * 2 + 1] + (dx / len) * off, 1.8 * (1 - age) + 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /** A planet whose gravity is turned round sends out rings that spread away from it, for as long as it pushes. */
  private drawRepelWaves(match: Match, scene: Scene): void {
    if (!match.powerUps) return;
    const { ctx } = this;
    ctx.save();
    ctx.strokeStyle = POWER_UP_COLORS.antigravity;
    ctx.lineWidth = 1.6;
    for (const planet of scene.world.planets) {
      if (!planet.reversed) continue;
      // A faint rim in the antigravity colour marks the planet that pushes.
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
    const [ox, oy] = screenOffset(-Math.cos(a) * 30, -Math.sin(a) * 30);
    fillTextUpright(ctx, String(Math.round(beyond)), 0, 0, ox, oy);
    ctx.restore();
  }

  /** Whether this ship is the one the person at the screen aims, in the first seconds of its first turn of the round. */
  private isPinged(match: Match, id: number): boolean {
    const player = match.players[id];
    if (match.attract || match.spectating || player.cpu || player.shots > 0 || match.phaseTime >= LOCATE_PING.DURATION) return false;
    return id === (match.viewer ?? match.focus);
  }

  /** Sonar rings sweeping in towards the ship so the eye finds it when a round begins; they fade out over the ping's last half second. */
  private drawLocatePing(x: number, y: number, color: string, age: number): void {
    const { ctx } = this;
    const fade = Math.min(1, (LOCATE_PING.DURATION - age) / 0.5);
    ctx.save();
    ctx.translate(x, y);
    ctx.lineWidth = 2;
    for (let k = 0; k < LOCATE_PING.RINGS; k++) {
      const t = (age / LOCATE_PING.PERIOD + k / LOCATE_PING.RINGS) % 1;
      ctx.globalAlpha = fade * t * 0.85;
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.arc(0, 0, LOCATE_PING.RADIUS * (1 - t) + 14, 0, Math.PI * 2);
      ctx.stroke();
    }
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

      if (planning && this.isPinged(match, i)) this.drawLocatePing(ship.x, ship.y, color, match.phaseTime);

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
      if (isRefined()) {
        drawRefinedShip(ctx, color, this.time, current && aimShown ? 1 : 0, i * 1.7);
      } else {
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
      }
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

let nextTrailId = 0;
/** How far past the field's edge a cached trail is still kept, in field units: shots that fly off do so on the screen's margin. */
const TRAIL_MARGIN = 200;

/** Which way, in the field plane, a classic planet sprite is lit from. */
const SPRITE_LIGHT_ANGLE = Math.atan2(LIGHT[1], LIGHT[0]);

/** The rings that point out your ship when a round starts: how long they last (s), how many, seconds per sweep, and the radius they start from (field units). */
const LOCATE_PING = { DURATION: 3, RINGS: 2, PERIOD: 1, RADIUS: 110 } as const;

function strokeTrails(ctx: CanvasRenderingContext2D, match: Match, drawn: readonly { trail: Trail; rank: number; fade: number }[]): void {
  for (const { trail, rank: r, fade } of drawn) {
    ctx.strokeStyle = rgba(match.players[trail.owner].color, (r === 0 ? 0.75 : r === 1 ? 0.38 : 0.2) * fade);
    ctx.lineWidth = r === 0 ? 1.6 : 1;
    ctx.setLineDash(r === 0 ? [] : [1.5, 4]);
    strokePolyline(ctx, trail.points, match.world.wormholes);
  }
  ctx.setLineDash([]);
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
