import '@fontsource/big-shoulders-stencil-display/800';
import '@fontsource/b612/400';
import '@fontsource/b612/700';
import '@fontsource/b612-mono/400';
import '@fontsource/b612-mono/700';
import './style.css';

import { Sound } from './audio';
import { AIM, COLORS, FONTS, PHYSICS } from './config';
import { Game } from './game';
import { Effects } from './render/effects';
import { Renderer } from './render/renderer';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from './settings';
import { Menu } from './ui/menu';
import { gameOverScreen, pauseScreen, titleScreen, type App } from './ui/screens';

const canvas = document.querySelector<HTMLCanvasElement>('#stage')!;
const overlay = document.querySelector<HTMLElement>('#overlay')!;
const touchFire = document.querySelector<HTMLButtonElement>('#touch-fire')!;

const settings = loadSettings();
const sound = new Sound();
sound.enabled = settings.sound;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarsePointer = matchMedia('(pointer: coarse)');
const effects = new Effects(settings.particles, reducedMotion);
const renderer = new Renderer(canvas);
const menu = new Menu(overlay, sound);

/** The title screen plays a CPU-vs-CPU match behind the menu. */
const attract = new Game(
  { ...DEFAULT_SETTINGS, maxPlanets: 5, shotTime: 12, contours: settings.contours, sound: false },
  { attract: true },
);
let game: Game | null = null;
let mode: 'title' | 'play' = 'title';

const active = (): Game => (mode === 'play' && game ? game : attract);

const LEVEL_NAMES = { easy: 'leicht', medium: 'mittel', hard: 'schwer' } as const;
function names(g: Game): [string, string] {
  if (g === attract) return ['CPU 1', 'CPU 2'];
  return ['Spieler 1', settings.opponent === 'cpu' ? `CPU · ${LEVEL_NAMES[settings.cpuLevel]}` : 'Spieler 2'];
}

function wire(g: Game): void {
  const audible = g !== attract;
  g.on((e) => {
    if (active() !== g) return;
    switch (e.type) {
      case 'round':
        effects.clear();
        break;
      case 'fire':
        effects.muzzle(e.x, e.y, e.angle, COLORS.players[e.player]);
        if (audible) sound.fire(e.power);
        break;
      case 'impact':
        effects.impact(e.x, e.y, COLORS.players[e.player]);
        if (audible) sound.impact();
        break;
      case 'explode':
        effects.explode(e.x, e.y, COLORS.players[e.ship]);
        if (audible) sound.explode();
        break;
      case 'fizzle':
        if (!e.lost) effects.fizzle(e.x, e.y, COLORS.players[e.player]);
        if (audible) sound.fizzle();
        break;
      case 'gameOver':
        menu.open(gameOverScreen(app, g, names(g)));
        break;
    }
  });
}
wire(attract);

const app: App = {
  menu,
  settings,
  settingsChanged() {
    saveSettings(settings);
    sound.enabled = settings.sound;
    effects.particles = settings.particles;
    attract.settings.contours = settings.contours;
    game?.applySettings(settings);
  },
  startGame() {
    game = new Game(settings);
    wire(game);
    mode = 'play';
    effects.clear();
    menu.close();
  },
  resume() {
    menu.close();
  },
  rematch() {
    if (!game) return app.startGame();
    game.newMatch();
    menu.close();
  },
  toTitle() {
    mode = 'title';
    game = null;
    effects.clear();
    menu.open(titleScreen(app));
  },
  toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => {});
  },
  isFullscreen: () => !!document.fullscreenElement,
};

// ————————————————————————————— Keyboard —————————————————————————————

function stepFor(e: KeyboardEvent): readonly [number, number] {
  // macOS reserves Ctrl+arrows for switching desktops, so Alt+Shift works as "very small" too.
  if (e.ctrlKey || e.metaKey || (e.altKey && e.shiftKey)) return AIM.STEPS.tiny;
  if (e.shiftKey) return AIM.STEPS.large;
  if (e.altKey) return AIM.STEPS.small;
  return AIM.STEPS.normal;
}

window.addEventListener('keydown', (e) => {
  sound.unlock();
  if (e.code === 'KeyF' && !e.metaKey && !e.ctrlKey) {
    app.toggleFullscreen();
    return;
  }
  if (menu.isOpen) {
    if (menu.handleKey(e)) e.preventDefault();
    return;
  }
  if (mode !== 'play' || !game) return;

  const [dAngle, dPower] = stepFor(e);
  let handled = true;
  switch (e.code) {
    case 'ArrowLeft':
      game.adjust(dAngle, 0);
      break;
    case 'ArrowRight':
      game.adjust(-dAngle, 0);
      break;
    case 'ArrowUp':
      game.adjust(0, dPower);
      break;
    case 'ArrowDown':
      game.adjust(0, -dPower);
      break;
    case 'Enter':
    case 'NumpadEnter':
    case 'Space':
      if (e.repeat) break;
      if (game.isHumanTurn) game.fire();
      else if (game.phase === 'roundOver') game.advance();
      break;
    case 'Escape':
      menu.open(pauseScreen(app));
      break;
    default:
      handled = false;
  }
  if (handled) e.preventDefault();
});

// ————————————————————————————— Pointer aiming —————————————————————————————

let dragging = false;

function aimAt(clientX: number, clientY: number): void {
  if (!game?.isHumanTurn) return;
  const f = renderer.toField(clientX, clientY);
  const ship = game.world.ships[game.current];
  const dx = f.x - ship.x;
  const dy = f.y - ship.y;
  const angle = (Math.atan2(-dy, dx) * 180) / Math.PI;
  // Map distance so the tip of the drawn aim arrow follows the pointer.
  const reach = Math.hypot(dx, dy) - (PHYSICS.MUZZLE + 26);
  game.setAim(angle, Math.round((reach / 110) * AIM.MAX_POWER * 100) / 100);
}

canvas.addEventListener('pointerdown', (e) => {
  sound.unlock();
  if (mode !== 'play' || !game || menu.isOpen) return;
  if (game.phase === 'roundOver') return game.advance();
  if (!game.isHumanTurn) return;
  dragging = true;
  canvas.setPointerCapture(e.pointerId);
  aimAt(e.clientX, e.clientY);
});
canvas.addEventListener('pointermove', (e) => dragging && aimAt(e.clientX, e.clientY));
const endDrag = () => (dragging = false);
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

touchFire.addEventListener('click', () => {
  sound.unlock();
  if (!game) return;
  if (game.isHumanTurn) game.fire();
  else if (game.phase === 'roundOver') game.advance();
});

// ————————————————————————————— Loop —————————————————————————————

document.addEventListener('fullscreenchange', () => menu.refresh());

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const g = active();
  const paused = mode === 'play' && menu.isOpen;
  if (!paused) {
    g.update(dt);
    effects.update(dt);
  }
  renderer.draw(g, effects, { hud: mode === 'play', names: names(g), touch: coarsePointer.matches }, paused ? 0 : dt);
  document.body.classList.toggle('is-playing', mode === 'play');

  const showTouch = coarsePointer.matches && mode === 'play' && !menu.isOpen && !!game && (game.isHumanTurn || game.phase === 'roundOver');
  if (touchFire.hidden === showTouch) touchFire.hidden = !showTouch;
  if (showTouch) touchFire.textContent = game!.phase === 'roundOver' ? 'Weiter' : 'Feuer';

  requestAnimationFrame(frame);
}

if (import.meta.env.DEV) {
  // Handle for poking at the running game from the dev console.
  Object.assign(window, { slingshot: { app, attract, settings, get game() { return game; } } });
}

async function boot(): Promise<void> {
  // Canvas text needs the web fonts loaded before the first draw.
  const fonts = [`800 32px ${FONTS.display}`, `400 16px ${FONTS.body}`, `700 16px ${FONTS.body}`, `400 16px ${FONTS.mono}`, `700 16px ${FONTS.mono}`];
  await Promise.race([Promise.all(fonts.map((f) => document.fonts.load(f))), new Promise((r) => setTimeout(r, 1500))]);
  app.toTitle();
  requestAnimationFrame(frame);
}
void boot();
