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
import { NetworkClient, type ClientInput, type ClientMessage, type ServerMessage } from './net';
import { gameOverScreen, lobbyScreen, pauseScreen, titleScreen, type App } from './ui/screens';
import type { GameEvent } from './game';

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
let network: NetworkClient | null = null;
let networkHost = false;
let networkPlayerId = 0;
let networkRoomJoined = false;
let networkNames: string[] | null = null;
let pendingEvents: GameEvent[] = [];
let stateSequence = 0;
let stateElapsed = 0;

const active = (): Game => (mode === 'play' && game ? game : attract);

const LEVEL_NAMES = { easy: 'leicht', medium: 'mittel', hard: 'schwer' } as const;
function names(g: Game): string[] {
  if (g === attract) return ['CPU 1', 'CPU 2'];
  if (g === game && networkNames) {
    if (g.mode === 'team' && g.players.length <= 2) return networkNames.map((name, id) => `TEAM ${g.teamOf(id) + 1} · ${name}`);
    return networkNames;
  }
  return ['Spieler 1', settings.opponent === 'cpu' ? `CPU · ${LEVEL_NAMES[settings.cpuLevel]}` : 'Spieler 2'];
}

function sendNetwork(message: Parameters<NetworkClient['send']>[0]): void {
  try {
    network?.send(message);
  } catch {
    // A closed transport is reported by its close event; avoid breaking input handlers.
  }
}

function dispatchInput(input: ClientInput): void {
  if (!game) return;
  if (!network) {
    if (input.kind === 'adjust') game.adjust(input.dAngle, input.dPower);
    else if (input.kind === 'aim') game.setAim(input.angle, input.power);
    else if (input.kind === 'fire') game.fire();
  } else if (networkHost) {
    if (input.kind === 'adjust') game.adjustFor(0, input.dAngle, input.dPower);
    else if (input.kind === 'aim') game.setAimFor(0, input.angle, input.power);
    else if (input.kind === 'fire') game.fireFor(0);
  } else {
    sendNetwork({ type: 'input', input });
  }
}

function advanceNetworkGame(): void {
  if (!game) return;
  if (!network || networkHost) game.advance();
  else sendNetwork({ type: 'input', input: { kind: 'advance' } } as unknown as ClientMessage);
}

function sendHostState(dt: number): void {
  if (!network || !networkHost || !game || mode !== 'play') return;
  stateElapsed += dt;
  if (stateElapsed < 0.1) return;
  stateElapsed %= 0.1;
  const events = pendingEvents;
  pendingEvents = [];
  sendNetwork({ type: 'state', seq: ++stateSequence, snapshot: game.snapshot(), events });
}


function appDisconnected(client: NetworkClient, message: string): void {
  if (network !== client) return;
  network = null;
  networkHost = false;
  networkRoomJoined = false;
  networkPlayerId = 0;
  networkNames = null;
  game = null;
  mode = 'title';
  pendingEvents = [];
  stateSequence = 0;
  stateElapsed = 0;
  effects.clear();
  client.close();
  menu.open(titleScreen(app));
  window.alert(`Multiplayer-Verbindung verloren: ${message}`);
}

function beginNetworkGame(message: Extract<ServerMessage, { type: 'game_start' }>): void {
  if (!network) return;
  networkNames = message.players.map((player) => player.name);
  game = new Game(settings, {
    playerCount: message.players.length,
    mode: message.mode,
    localPlayerId: networkPlayerId,
    seed: message.seed,
    network: true,
  });
  pendingEvents = [];
  stateSequence = 0;
  stateElapsed = 0;
  wire(game);
  mode = 'play';
  effects.clear();
  menu.close();
}
function connectMultiplayer(): void {
  const client = new NetworkClient('ws://localhost:8080');
  network = client;
  networkHost = false;
  networkPlayerId = 0;
  networkRoomJoined = false;
  networkNames = null;
  client.onMessage((message) => {
    if (network !== client) return;
    switch (message.type) {
      case 'room_update':
        networkPlayerId = message.you.playerId;
        networkHost = message.you.host;
        networkRoomJoined = true;
        networkNames = message.room.players.map((player) => player.name);
        break;
      case 'game_start':
        beginNetworkGame(message);
        break;
      case 'input': {
        if (!networkHost || !game) break;
        const input = message.input as ClientInput | { kind: 'advance' };
        if (input.kind === 'adjust') game.adjustFor(message.from, input.dAngle, input.dPower);
        else if (input.kind === 'aim') game.setAimFor(message.from, input.angle, input.power);
        else if (input.kind === 'fire') game.fireFor(message.from);
        else if (input.kind === 'advance') game.advance();
        break;
      }
      case 'state':
        if (!networkHost && game && message.seq > stateSequence) {
          stateSequence = message.seq;
          game.restoreSnapshot(message.snapshot);
          for (const event of message.events) game.applyRemoteEvent(event);
        }
        break;
      case 'error':
        if (mode === 'play') appDisconnected(client, message.message);
        break;
      case 'lobby_update':
        break;
    }
  });
  menu.open(lobbyScreen(app, client));
}

function wire(g: Game): void {
  const audible = g !== attract;
  g.on((e) => {
    if (active() !== g) return;
    if (g === game && networkHost) pendingEvents.push(e);
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
    if (game && !network) game.applySettings(settings);
  },
  startGame() {
    network = null;
    networkHost = false;
    networkRoomJoined = false;
    networkNames = null;
    pendingEvents = [];
    stateSequence = 0;
    stateElapsed = 0;
    game = new Game(settings);
    wire(game);
    mode = 'play';
    effects.clear();
    menu.close();
  },
  connectMultiplayer,
  resume() {
    menu.close();
  },
  rematch() {
    if (!game) return app.startGame();
    if (network) {
      if (networkHost) {
        pendingEvents = [];
        game.advance();
      } else sendNetwork({ type: 'input', input: { kind: 'advance' } } as unknown as ClientMessage);
      menu.close();
      return;
    }
    game.newMatch();
    menu.close();
  },
  toTitle() {
    if (network) {
      if (networkRoomJoined) sendNetwork({ type: 'leave_room' });
      const client = network;
      network = null;
      client.close();
    }
    networkHost = false;
    networkRoomJoined = false;
    networkNames = null;
    pendingEvents = [];
    stateSequence = 0;
    stateElapsed = 0;
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
      dispatchInput({ kind: 'adjust', dAngle, dPower: 0 });
      break;
    case 'ArrowRight':
      dispatchInput({ kind: 'adjust', dAngle: -dAngle, dPower: 0 });
      break;
    case 'ArrowUp':
      dispatchInput({ kind: 'adjust', dAngle: 0, dPower });
      break;
    case 'ArrowDown':
      dispatchInput({ kind: 'adjust', dAngle: 0, dPower: -dPower });
      break;
    case 'Enter':
    case 'NumpadEnter':
    case 'Space':
      if (e.repeat) break;
      if (game.isHumanTurn) dispatchInput({ kind: 'fire' });
      else if (game.phase === 'roundOver') advanceNetworkGame();
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
  const reach = Math.hypot(dx, dy) - (PHYSICS.MUZZLE + 26);
  dispatchInput({ kind: 'aim', angle, power: Math.round((reach / 110) * AIM.MAX_POWER * 100) / 100 });
}

canvas.addEventListener('pointerdown', (e) => {
  sound.unlock();
  if (mode !== 'play' || !game || menu.isOpen) return;
  if (game.phase === 'roundOver') return advanceNetworkGame();
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
  if (game.isHumanTurn) dispatchInput({ kind: 'fire' });
  else if (game.phase === 'roundOver') advanceNetworkGame();
});

// ————————————————————————————— Loop —————————————————————————————

document.addEventListener('fullscreenchange', () => menu.refresh());

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const g = active();
  const paused = mode === 'play' && menu.isOpen;
  if (mode !== 'play' || !network || networkHost) g.update(dt);
  if (!paused) effects.update(dt);
  if (mode === 'play' && network && networkHost) sendHostState(dt);
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
