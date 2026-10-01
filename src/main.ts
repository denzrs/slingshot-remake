import '@fontsource/big-shoulders-stencil-display/800';
import '@fontsource/b612/400';
import '@fontsource/b612/700';
import '@fontsource/b612-mono/400';
import '@fontsource/b612-mono/700';
import './style.css';

import { Sound } from './audio';
import { ClipRecorder } from './clip';
import { AIM, COLORS, FONTS, PHYSICS } from './config';
import { createMatch, HorizonMatch, type Match, type Mode } from './game';
import { Effects } from './render/effects';
import { applyStaticTexts, fmt, getLang, setLang, t } from './i18n';
import { Renderer } from './render/renderer';
import { STYLE_MULTIPLIER, styleLabel } from './scoring';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from './settings';
import { Menu } from './ui/menu';
import { gameOverScreen, pauseScreen, titleScreen, type App } from './ui/screens';

const canvas = document.querySelector<HTMLCanvasElement>('#stage')!;
const overlay = document.querySelector<HTMLElement>('#overlay')!;
const touchFire = document.querySelector<HTMLButtonElement>('#touch-fire')!;
const clipButton = document.querySelector<HTMLButtonElement>('#clip-save')!;

const settings = loadSettings();
setLang(settings.language);
applyStaticTexts();
const sound = new Sound();
sound.enabled = settings.sound;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarsePointer = matchMedia('(pointer: coarse)');
const effects = new Effects(settings.particles, reducedMotion);
const renderer = new Renderer(canvas);
const menu = new Menu(overlay, sound);
const recorder = new ClipRecorder();

/** The title screen plays an Event Horizon match between four CPUs behind the menu. */
const attract = createMatch(
  'horizon',
  { ...DEFAULT_SETTINGS, maxPlanets: 4, contours: settings.contours, sound: false },
  { attract: true, seats: ['medium', 'medium', 'medium', 'medium', 'off', 'off'] },
);
let match: Match | null = null;
let screen: 'title' | 'play' = 'title';
let lastMode: Mode = 'classic';

const active = (): Match => (screen === 'play' && match ? match : attract);

function wire(m: Match): void {
  const audible = m !== attract;
  const color = (id: number) => m.players[id].color;
  m.on((e) => {
    if (active() !== m) return;
    switch (e.type) {
      case 'round':
        effects.clear();
        break;
      case 'fire':
        effects.muzzle(e.x, e.y, e.angle, color(e.player));
        if (audible) sound.fire(e.power);
        break;
      case 'impact':
        effects.impact(e.x, e.y, color(e.player));
        if (audible) sound.impact();
        break;
      case 'explode':
        effects.explode(e.x, e.y, color(e.ship));
        if (audible) sound.explode();
        break;
      case 'fizzle':
        if (!e.lost) effects.fizzle(e.x, e.y, color(e.player));
        if (audible) sound.fizzle();
        break;
      case 'clash':
        effects.clash(e.x, e.y, color(e.players[0]), color(e.players[1]));
        if (audible) sound.clash();
        break;
      case 'devour':
        effects.devour(e.x, e.y, e.toX, e.toY, e.color);
        if (audible) sound.devour();
        break;
      case 'style':
        effects.callout(`${styleLabel(e.kind).toUpperCase()} ×${fmt(STYLE_MULTIPLIER[e.kind], 2).replace(/[.,]?0+$/, '')}`, e.x, e.y, COLORS.sodium);
        if (audible) sound.combo();
        break;
      case 'kill': {
        const r = e.record;
        const ship = m.world.ships[r.victim];
        if (r.friendly) effects.callout(`${t('title.friendlyFire')} ${r.points}`, ship.x, ship.y - 10, COLORS.danger, true);
        else if (r.killer !== null && !r.self) effects.callout(`+${r.points}`, ship.x, ship.y - 10, color(r.killer), true);
        break;
      }
      case 'collapse':
        effects.collapse(e.x, e.y);
        if (audible) sound.rumble();
        break;
      case 'volley':
        if (audible) sound.volley();
        break;
      case 'lock':
        if (audible) sound.blip();
        break;
      case 'killcam':
        effects.clear();
        if (e.active && e.recording) recorder.start(canvas);
        if (!e.active && e.recording) void recorder.stopAndSave();
        break;
      case 'gameOver':
        menu.open(() => gameOverScreen(app, m));
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
    match?.applySettings(settings);
    if (settings.language !== getLang()) {
      setLang(settings.language);
      applyStaticTexts();
      menu.rebuild();
    }
  },
  start(mode) {
    lastMode = mode;
    match = createMatch(mode, settings);
    wire(match);
    screen = 'play';
    effects.clear();
    menu.close();
  },
  resume() {
    menu.close();
  },
  rematch() {
    if (!match) return app.start(lastMode);
    effects.clear();
    match.newMatch();
    menu.close();
  },
  toTitle() {
    screen = 'title';
    match = null;
    effects.clear();
    menu.open(() => titleScreen(app));
  },
  toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => {});
  },
  isFullscreen: () => !!document.fullscreenElement,
};

/** Replay the last killcam while recording the canvas, then download the video. */
function saveClip(): void {
  if (!(match instanceof HorizonMatch) || !ClipRecorder.supported || recorder.recording) return;
  match.replayLastKill(true);
}

/** Enter / Space / the touch button: fire or lock in, continue, or skip the killcam. */
function primaryAction(): void {
  if (!match) return;
  if (match.isHumanTurn) match.commit();
  else if (match.phase === 'roundOver' || match.phase === 'killcam') match.advance();
}

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
  if (screen !== 'play' || !match) return;

  const [dAngle, dPower] = stepFor(e);
  let handled = true;
  switch (e.code) {
    case 'ArrowLeft':
      match.adjust(dAngle, 0);
      break;
    case 'ArrowRight':
      match.adjust(-dAngle, 0);
      break;
    case 'ArrowUp':
      match.adjust(0, dPower);
      break;
    case 'ArrowDown':
      match.adjust(0, -dPower);
      break;
    case 'Enter':
    case 'NumpadEnter':
    case 'Space':
      if (!e.repeat) primaryAction();
      break;
    case 'KeyC':
      saveClip();
      break;
    case 'Escape':
      // A clip records whatever is on screen — don't freeze it behind the menu.
      if (!recorder.recording) menu.open(() => pauseScreen(app));
      break;
    default:
      handled = false;
  }
  if (handled) e.preventDefault();
});

// ————————————————————————————— Pointer aiming —————————————————————————————

let dragging = false;

function aimAt(clientX: number, clientY: number): void {
  if (!match?.isHumanTurn) return;
  const f = renderer.toField(clientX, clientY);
  const ship = match.world.ships[match.current];
  const dx = f.x - ship.x;
  const dy = f.y - ship.y;
  const angle = (Math.atan2(-dy, dx) * 180) / Math.PI;
  // Map distance so the tip of the drawn aim arrow follows the pointer.
  const reach = Math.hypot(dx, dy) - (PHYSICS.MUZZLE + 26);
  match.setAim(angle, Math.round((reach / 110) * AIM.MAX_POWER * 100) / 100);
}

canvas.addEventListener('pointerdown', (e) => {
  sound.unlock();
  if (screen !== 'play' || !match || menu.isOpen) return;
  if (match.phase === 'roundOver' || match.phase === 'killcam') return match.advance();
  if (!match.isHumanTurn) return;
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
  primaryAction();
});
clipButton.addEventListener('click', () => {
  sound.unlock();
  saveClip();
});

// ————————————————————————————— Loop —————————————————————————————

document.addEventListener('fullscreenchange', () => menu.refresh());

function syncButtons(): void {
  const playing = screen === 'play' && !menu.isOpen && !!match;
  const m = match;
  let touchLabel: string | null = null;
  if (playing && coarsePointer.matches && m) {
    if (m.isHumanTurn) touchLabel = m.mode === 'horizon' ? t('common.ready') : t('common.fire');
    else if (m.phase === 'roundOver') touchLabel = t('common.next');
    else if (m.phase === 'killcam' && !recorder.recording) touchLabel = t('common.skip');
  }
  if (touchFire.hidden !== !touchLabel) touchFire.hidden = !touchLabel;
  if (touchLabel && touchFire.textContent !== touchLabel) touchFire.textContent = touchLabel;

  const canClip = playing && m instanceof HorizonMatch && m.canReplay && ClipRecorder.supported && !recorder.recording;
  if (clipButton.hidden === canClip) clipButton.hidden = !canClip;
}

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const m = active();
  const paused = screen === 'play' && menu.isOpen;
  if (!paused) {
    m.update(dt);
    effects.update(dt);
  }
  renderer.draw(m, effects, { hud: screen === 'play', touch: coarsePointer.matches, recording: recorder.recording }, paused ? 0 : dt);
  document.body.classList.toggle('is-playing', screen === 'play');
  syncButtons();
  requestAnimationFrame(frame);
}

if (import.meta.env.DEV) {
  // Handle for poking at the running game from the dev console.
  Object.assign(window, { slingshot: { app, attract, settings, get match() { return match; } } });
}

async function boot(): Promise<void> {
  // Canvas text needs the web fonts loaded before the first draw.
  const fonts = [`800 32px ${FONTS.display}`, `400 16px ${FONTS.body}`, `700 16px ${FONTS.body}`, `400 16px ${FONTS.mono}`, `700 16px ${FONTS.mono}`];
  await Promise.race([Promise.all(fonts.map((f) => document.fonts.load(f))), new Promise((r) => setTimeout(r, 1500))]);
  app.toTitle();
  requestAnimationFrame(frame);
}
void boot();
