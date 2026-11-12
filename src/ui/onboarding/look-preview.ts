import { getLook, setLook, type Look } from '../../data/look';
import { cloneSettings, DEFAULT_SETTINGS, type Settings } from '../../data/settings';
import { rulesOf } from '../../data/roomRules';
import { createMatch, newPlayer, type Camera, type Match } from '../../game';
import { Renderer } from '../../render/renderer';
import { Effects } from '../../render/effects';
import { Shot } from '../../sim/physics';

export const PREVIEW_SCENES = ['gravity', 'solar', 'horizon'] as const;
export type PreviewScene = typeof PREVIEW_SCENES[number];

export interface LookPreviewOptions {
  onSceneEnd?: (scene: PreviewScene) => void;
}

export interface LookPreview {
  draw(dt: number, look: Look, still?: boolean): void;
  setScene(scene: PreviewScene): void;
  dispose(): void;
}

/** Sample the predicted gravitational slingshot trajectory. */
function computeGuidance(match: Match, shipIndex: number, angle: number, power: number): number[] {
  try {
    const shot = new Shot(match.world, shipIndex, angle, power, match.rules);
    const pts = [shot.x, shot.y];
    let s = 0;
    while (!shot.end && s < 220) {
      shot.step();
      if (++s % 3 === 0) pts.push(shot.x, shot.y);
    }
    pts.push(shot.x, shot.y);
    return pts;
  } catch {
    return [];
  }
}

/** Real local match playback. The camera stays put, and a look change keeps the same flight on screen. */
export function lookPreview(canvas: HTMLCanvasElement, settings: Settings, options?: LookPreviewOptions): LookPreview {
  let scene: PreviewScene = 'gravity';
  let match: Match;
  let age = 0;
  let aimingSince = 0;
  let committedAt = 0;
  let volleyCount = 0;
  let disposed = false;
  let currentGuidance: number[] | null = null;
  let pendingScene: PreviewScene | null = null;
  let transitionAlpha = 0;
  let transitionPhase: 'idle' | 'fading-out' | 'fading-in' = 'idle';
  const effects = new Effects(settings.particles, matchMedia('(prefers-reduced-motion: reduce)').matches, settings.debris);
  const renderer = new Renderer(canvas, () => {
    const parent = canvas.parentElement;
    const rect = parent?.getBoundingClientRect();
    const width = parent?.clientWidth || rect?.width || canvas.clientWidth || 1;
    const height = parent?.clientHeight || rect?.height || canvas.clientHeight || 1;
    return { width: Math.max(1, width), height: Math.max(1, height), rotated: false };
  });

  const build = (): void => {
    match?.dispose();
    const rules: Settings = {
      ...cloneSettings(settings), ...rulesOf(DEFAULT_SETTINGS),
      seats: scene === 'horizon' ? ['human', 'human', 'human', 'off', 'off', 'off'] : ['human', 'human', 'off', 'off', 'off', 'off'],
      rounds: 1, maxPlanets: 0, powerUps: false, anomalies: [], mayhem: 0,
      betting: false, suddenDeath: false, killcam: 'off', shotTime: 5,
      teamMode: 0, contours: false,
    };
    match = createMatch(scene === 'gravity' ? 'classic' : scene, rules, { seed: 731 });
    match.skipReveal();
    match.phase = 'aiming';
    match.phaseTime = 10;
    match.world.planets = [];
    match.world.holes = [];
    volleyCount = 0;
    currentGuidance = null;
    if (scene === 'gravity') {
      match.current = 0;
      Object.assign(match.world.ships[0], { x: 220, y: 350 });
      Object.assign(match.world.ships[1], { x: 1040, y: 350 });
      match.players[1] = newPlayer(1, 1, 'easy', null, true);
      match.world.planets.push({ x: 630, y: 350, radius: 140, mass: 112 ** 3, seed: 31, style: 'hycean', tint: '#55cfe0' });
      match.setAim(0, 25);
    } else if (scene === 'solar') {
      match.current = 0;
      Object.assign(match.world.ships[0], { x: 260, y: 370 });
      Object.assign(match.world.ships[1], { x: 1020, y: 430 });
      match.world.planets.push(
        { x: 640, y: 400, radius: 82, mass: 200000, seed: 0, style: 'star', tint: '#ffd27a', sun: true },
        { x: 830, y: 350, radius: 40, mass: 40 ** 3, seed: 57, style: 'ice', tint: '#8bbbdc' },
      );
      match.setAim(-10, 25);
    } else {
      Object.assign(match.world.ships[0], { x: 260, y: 440 });
      Object.assign(match.world.ships[1], { x: 1010, y: 330 });
      Object.assign(match.world.ships[2], { x: 420, y: 150 });
      match.world.holes.push({ x: 640, y: 400, radius: 45, mass: 400000 });
      match.world.planets.push({ x: 727, y: 400, radius: 28, mass: 28 ** 3, seed: 33, style: 'rocky', tint: '#a89585' });
      const ship = match.world.ships[match.current];
      match.setAim(Math.atan2(ship.y - 400, 640 - ship.x) * 180 / Math.PI + 12, 55);
    }
    // Fixed presentation camera: fitted to view width for large arena or zoomed in on the celestial body for thumbnail art.
    const baseScene = match.scene.bind(match);
    match.scene = () => {
      const width = renderer.view.cssWidth;
      const height = renderer.view.cssHeight;
      const cover = Math.max(width / match.world.width, height / match.world.height);
      const isThumbnail = width < 250;
      const span = isThumbnail
        ? (scene === 'gravity' ? 360 : scene === 'solar' ? 250 : 210)
        : (scene === 'gravity' ? 1020 : 1120);
      const centerX = scene === 'gravity' ? 630 : 640;
      const centerY = isThumbnail ? (scene === 'gravity' ? 350 : 400) : (scene === 'gravity' ? 330 : 390);
      const camera: Camera = { x: centerX, y: centerY, zoom: width / (cover * span) };
      return { ...baseScene(), camera, preview: !isThumbnail && match.phase === 'aiming' ? currentGuidance : null };
    };
    match.on((event) => {
      if (event.type === 'volley') volleyCount++;
      const color = (id: number): string => match.players[id].color;
      if (event.type === 'fire') effects.muzzle(event.x, event.y, event.angle, color(event.player));
      else if (event.type === 'impact') effects.impact(event.x, event.y, color(event.player), event.vx, event.vy);
      else if (event.type === 'explode') effects.explode(event.x, event.y, color(event.ship), event.vx, event.vy);
      else if (event.type === 'clash') effects.clash(event.x, event.y, color(event.players[0]), color(event.players[1]), event.velocities);
      else if (event.type === 'devour') effects.devour(event.x, event.y, event.toX, event.toY, event.color, event.vx, event.vy);
      else if (event.type === 'collapse') effects.collapse(event.x, event.y);
    });
    age = 0;
    aimingSince = 0;
    committedAt = 0;
    effects.clear();
  };
  build();

  return {
    setScene(next) {
      if ((next === scene && !pendingScene) || disposed) return;
      if (next === pendingScene) return;
      if (transitionAlpha >= 0.95) {
        scene = next;
        pendingScene = null;
        transitionPhase = 'fading-in';
        transitionAlpha = 1;
        build();
        return;
      }
      pendingScene = next;
      transitionPhase = 'fading-out';
    },
    draw(dt, look, still = false) {
      if (disposed) return;
      const step = still || document.hidden ? 0 : Math.min(dt, 0.05);

      if (pendingScene) {
        if (still || step === 0) {
          scene = pendingScene;
          pendingScene = null;
          transitionPhase = 'idle';
          transitionAlpha = 0;
          build();
        } else {
          transitionAlpha = Math.min(1, transitionAlpha + step / 0.12);
          if (transitionAlpha >= 1) {
            scene = pendingScene;
            pendingScene = null;
            build();
            transitionPhase = 'fading-in';
            transitionAlpha = 1;
          }
        }
      } else if (transitionPhase === 'fading-in') {
        if (still || step === 0) {
          transitionPhase = 'idle';
          transitionAlpha = 0;
        } else {
          transitionAlpha = Math.max(0, transitionAlpha - step / 0.2);
          if (transitionAlpha <= 0) {
            transitionPhase = 'idle';
            transitionAlpha = 0;
          }
        }
      }

      age += step;
      const loopEnd = scene === 'gravity' ? 5.0 : scene === 'solar' ? 9.2 : 10.5;
      if (age > loopEnd) {
        if (options?.onSceneEnd) {
          options.onSceneEnd(scene);
          return;
        }
        build();
      }
      if (match.phase !== 'aiming') {
        aimingSince = 0;
        currentGuidance = null;
      } else if (!aimingSince) aimingSince = age;

      if (step > 0 && match.phase === 'aiming' && match.current >= 0) {
        if (scene === 'gravity') {
          const u = Math.min(1, Math.max(0, (age - 0.2) / 0.8));
          const k = u * u * (3 - 2 * u);
          match.setAim(0 + 38 * k, 25 + 75 * k);
          currentGuidance = computeGuidance(match, 0, match.players[0].angle, match.players[0].power);
          if (age >= 1.05 && age - committedAt > 0.4) {
            match.setAim(38, 100);
            match.commit();
            committedAt = age;
            currentGuidance = null;
          }
        } else if (scene === 'solar') {
          if (match.current === 0) {
            const u = Math.min(1, Math.max(0, (age - 0.2) / 0.8));
            const k = u * u * (3 - 2 * u);
            match.setAim(-10 + 34 * k, 25 + 35 * k);
            currentGuidance = computeGuidance(match, 0, match.players[0].angle, match.players[0].power);
            if (age >= 1.05 && age - committedAt > 0.4) {
              match.setAim(24, 60);
              match.commit();
              committedAt = age;
              currentGuidance = null;
            }
          } else {
            const u = Math.min(1, Math.max(0, (age - aimingSince) / 0.7));
            const k = u * u * (3 - 2 * u);
            match.setAim(180 + 24 * k, 25 + 40 * k);
            currentGuidance = computeGuidance(match, 1, match.players[1].angle, match.players[1].power);
            if (age - aimingSince >= 0.75 && age - committedAt > 0.4) {
              match.setAim(204, 65);
              match.commit();
              committedAt = age;
              currentGuidance = null;
            }
          }
        } else {
          // horizon
          if (volleyCount === 0) {
            for (let s = 0; s < 3; s++) {
              match.current = s;
              const ship = match.world.ships[s];
              match.setAim(Math.atan2(ship.y - 400, 640 - ship.x) * 180 / Math.PI + 12, 55);
            }
            if (age >= 1.05 && age - committedAt > 0.4) {
              for (let s = 0; s < 3; s++) {
                match.current = s;
                match.commit();
              }
              committedAt = age;
              currentGuidance = null;
            }
          } else {
            // Volley 1
            if (match.current === 2) {
              const u = Math.min(1, Math.max(0, (age - aimingSince) / 0.8));
              const k = u * u * (3 - 2 * u);
              match.setAim(50 - 42 * k, 30 + 35 * k);
              currentGuidance = computeGuidance(match, 2, match.players[2].angle, match.players[2].power);
            }
            if (age - aimingSince >= 0.85 && age - committedAt > 0.4) {
              for (let s = 0; s < 3; s++) {
                match.current = s;
                if (s === 2) match.setAim(8, 65);
                else {
                  const ship = match.world.ships[s];
                  match.setAim(Math.atan2(ship.y - 400, 640 - ship.x) * 180 / Math.PI + 12, 55);
                }
                match.commit();
              }
              committedAt = age;
              currentGuidance = null;
            }
          }
        }
      }
      match.update(step);
      effects.update(step, match.world);
      const previous = getLook();
      try {
        setLook(look);
        effects.infall(match.falling(), match.world.holes[0], step, true);
        renderer.draw(match, effects, { hud: false, fullScreen: true, touch: false, recording: false, keyHints: false, aimCardDodge: false, seatNumbers: false }, step);
      } finally {
        setLook(previous);
      }

      // Smooth cinematic fade transition at scene boundaries and transitions.
      if (!still && step > 0) {
        const fadeDuration = 0.35;
        let naturalFade = 0;
        if (age < fadeDuration) naturalFade = 1 - age / fadeDuration;
        else if (age > loopEnd - fadeDuration) naturalFade = (age - (loopEnd - fadeDuration)) / fadeDuration;
        const overlayAlpha = Math.max(transitionAlpha, naturalFade);
        if (overlayAlpha > 0.01) {
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.save();
            ctx.fillStyle = `rgba(7, 17, 34, ${Math.min(1, Math.max(0, overlayAlpha))})`;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.restore();
          }
        }
      }
    },
    dispose() { disposed = true; match.dispose(); effects.clear(); },
  };
}
