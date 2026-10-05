import '@fontsource/big-shoulders-stencil-display/800';
import '@fontsource/b612/400';
import '@fontsource/b612/700';
import '@fontsource/b612-mono/400';
import '@fontsource/b612-mono/700';
import './style.css';

import { Sound } from './audio';
import { dailyChallenge, dateKey, isDateKey } from './challenge';
import { ClipRecorder } from './clip';
import { AIM, COLORS, FONTS, PHYSICS } from './config';
import { recordRun } from './dailyStore';
import { ChallengeMatch, createChallenge, createMatch, type GameEvent, type Match, type VersusMode } from './game';
import { ClassicMatch } from './game/classic';
import { HorizonMatch } from './game/horizon';
import { NetworkClient, type ClientInput, type ClientMessage, type ServerMessage } from './net';
import { Effects } from './render/effects';
import { applyStaticTexts, fmt, getLang, setLang, t } from './i18n';
import { Renderer } from './render/renderer';
import { STYLE_MULTIPLIER, styleLabel } from './scoring';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from './settings';
import { dailyResultScreen } from './ui/daily';
import { Menu } from './ui/menu';
import { gameOverScreen, lobbyScreen, pauseScreen, titleScreen, type App } from './ui/screens';

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
let lastMode: VersusMode = 'classic';
let network: NetworkClient | null = null;
let networkHost = false;
let networkPlayerId = 0;
let networkRoomJoined = false;
let pendingEvents: GameEvent[] = [];
let stateSequence = 0;
let stateElapsed = 0;
let latestRoom: Extract<ServerMessage, { type: 'room_update' }> | null = null;
/** `?daily=YYYY-MM-DD` flies another day's challenge — handy for testing and for sharing an old one. */
const requestedDay = new URLSearchParams(location.search).get('daily');
const forcedDay = isDateKey(requestedDay) ? requestedDay : null;

const active = (): Match => (screen === 'play' && match ? match : attract);

function wire(m: Match): void {
  const audible = m !== attract;
  const color = (id: number) => m.players[id].color;
  m.on((e) => {
    if (active() !== m) return;
    if (m === match && network && networkHost) pendingEvents.push(e);
    switch (e.type) {
      case 'round':
        effects.clear();
        break;
      case 'fire':
        effects.muzzle(e.x, e.y, e.angle, color(e.player));
        if (audible) sound.fire(e.power);
        break;
      case 'impact':
        effects.impact(e.x, e.y, color(e.player), e.vx, e.vy);
        if (audible) sound.impact();
        break;
      case 'explode':
        effects.explode(e.x, e.y, color(e.ship), e.vx, e.vy);
        if (audible) sound.explode();
        break;
      case 'fizzle':
        if (!e.lost) effects.fizzle(e.x, e.y, color(e.player), e.vx, e.vy);
        if (audible) sound.fizzle();
        break;
      case 'clash':
        effects.clash(e.x, e.y, color(e.players[0]), color(e.players[1]), e.velocities);
        if (audible) sound.clash();
        break;
      case 'devour':
        effects.devour(e.x, e.y, e.toX, e.toY, e.color, e.vx, e.vy);
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
        if (m instanceof ChallengeMatch) {
          const outcome = recordRun(m.challenge.dateKey, m.total);
          menu.open(() => dailyResultScreen(app, m, outcome));
        } else {
          menu.open(() => gameOverScreen(app, m));
        }
        break;
    }
  });
}
wire(attract);

function sendNetwork(message: ClientMessage): void {
  try { network?.send(message); } catch { /* Transport close is handled by its error message. */ }
}

function dispatchInput(input: ClientInput): void {
  if (!network || !match) {
    if (!match) return;
    if (input.kind === 'adjust') match.adjust(input.dAngle, input.dPower);
    else if (input.kind === 'aim') match.setAim(input.angle, input.power);
    else if (input.kind === 'fire') match.commit();
    return;
  }
  if (!networkHost) {
    sendNetwork({ type: 'input', input });
    return;
  }
  if (input.kind === 'advance') {
    match.advance();
    return;
  }
  if (match instanceof ClassicMatch || match instanceof HorizonMatch) {
    if (input.kind === 'adjust') match.adjustPlayer(networkPlayerId, input.dAngle, input.dPower);
    else if (input.kind === 'aim') match.setPlayerAim(networkPlayerId, input.angle, input.power);
    else if (input.kind === 'fire') match.commitPlayer(networkPlayerId);
  }
}

function advanceMatch(): void {
  if (!network) match?.advance();
  else if (networkHost) match?.advance();
  else sendNetwork({ type: 'input', input: { kind: 'advance' } });
}

function disconnectNetwork(client: NetworkClient, message: string): void {
  if (network !== client) return;
  network = null;
  networkHost = false;
  networkRoomJoined = false;
  latestRoom = null;
  match = null;
  screen = 'title';
  pendingEvents = [];
  effects.clear();
  client.close();
  menu.open(() => titleScreen(app));
  window.alert(`${t('multiplayer.title')}: ${message}`);
}

function startNetworkMatch(message: Extract<ServerMessage, { type: 'game_start' }>): void {
  const room = latestRoom;
  if (!room) return;
  const remoteSettings = {
    ...settings,
    seats: [...settings.seats],
    seatTeams: [...settings.seatTeams],
    teamMode: room.room.mode === 'team' ? 2 : 0,
    bounce: message.gameMode === 'horizon' ? true : settings.bounce,
  };
  remoteSettings.seats.fill('off');
  for (const player of message.players) {
    remoteSettings.seats[player.id] = 'human';
    remoteSettings.seatTeams[player.id] = player.team;
  }
  remoteSettings.seats[0] = 'human';
  match = createMatch(message.gameMode, remoteSettings, { seats: remoteSettings.seats });
  if (!(match instanceof ClassicMatch || match instanceof HorizonMatch)) return;
  if (match instanceof ClassicMatch && remoteSettings.teamMode) match.configureNetworkTeams(message.players.map((p) => p.team));
  for (const player of message.players) {
    Object.defineProperty(match.players[player.id], 'name', { configurable: true, enumerable: true, value: player.name });
  }
  pendingEvents = [];
  stateSequence = 0;
  stateElapsed = 0;
  wire(match);
  screen = 'play';
  effects.clear();
  menu.close();
}

function connectMultiplayer(): void {
  const client = new NetworkClient('ws://localhost:8080');
  network = client;
  networkHost = false;
  networkPlayerId = 0;
  networkRoomJoined = false;
  latestRoom = null;
  client.onMessage((message) => {
    if (network !== client) return;
    switch (message.type) {
      case 'room_update':
        latestRoom = message;
        networkPlayerId = message.you.playerId;
        networkHost = message.you.host;
        networkRoomJoined = true;
        break;
      case 'game_start': startNetworkMatch(message); break;
      case 'input': {
        if (!networkHost || !(match instanceof ClassicMatch || match instanceof HorizonMatch)) break;
        const input = message.input;
        if (input.kind === 'adjust') match.adjustPlayer(message.from, input.dAngle, input.dPower);
        else if (input.kind === 'aim') match.setPlayerAim(message.from, input.angle, input.power);
        else if (input.kind === 'fire') match.commitPlayer(message.from);
        else if (input.kind === 'advance') {
          match.advance();
        }
        break;
      }
      case 'state':
        if (!networkHost && (match instanceof ClassicMatch || match instanceof HorizonMatch) && message.seq > stateSequence) {
          stateSequence = message.seq;
          const previousPhase = match.phase;
          if (match instanceof ClassicMatch && 'teamCursor' in message.snapshot) match.restoreSnapshot(message.snapshot);
          else if (match instanceof HorizonMatch && 'volleyNo' in message.snapshot) match.restoreSnapshot(message.snapshot);
          for (const event of message.events) match.applyRemoteEvent(event);
          if (previousPhase === 'gameOver' && match.phase !== 'gameOver') menu.close();
        }
        break;
      case 'error':
        if (networkRoomJoined || screen === 'play') disconnectNetwork(client, message.message);
        break;
      case 'lobby_update': break;
    }
  });
  menu.open(() => lobbyScreen(app, client));
}

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
  get mode() {
    return screen === 'play' && match ? match.mode : null;
  },
  today: () => forcedDay ?? dateKey(),
  start(mode) {
    lastMode = mode;
    match = createMatch(mode, settings);
    wire(match);
    screen = 'play';
    effects.clear();
    menu.close();
  },
  startDaily() {
    match = createChallenge(settings, dailyChallenge(app.today()));
    wire(match);
    screen = 'play';
    effects.clear();
    menu.close();
  },
  connectMultiplayer,
  startMultiplayer(message) {
    startNetworkMatch(message);
  },
  resume() {
    menu.close();
  },
  rematch() {
    if (!match) return app.start(lastMode);
  if (network) {
    if (networkHost && match.phase === 'gameOver') match.newMatch();
    else if (networkHost) advanceMatch();
      else sendNetwork({ type: 'input', input: { kind: 'advance' } });
      menu.close();
      return;
    }
    effects.clear();
    match.newMatch();
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
    latestRoom = null;
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
  if (network) {
    if (match.phase === 'gameOver') app.rematch();
    else if (match.current === networkPlayerId) dispatchInput({ kind: 'fire' });
    else if (match.phase === 'roundOver' || match.phase === 'killcam') advanceMatch();
    return;
  }
  if (match.isHumanTurn) dispatchInput({ kind: 'fire' });
  else if (match.phase === 'roundOver' || match.phase === 'killcam') advanceMatch();
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
  if (!match || (!network && !match.isHumanTurn) || (network && match.current !== networkPlayerId)) return;
  const f = renderer.toField(clientX, clientY);
  const ship = match.world.ships[match.current];
  const dx = f.x - ship.x;
  const dy = f.y - ship.y;
  const angle = (Math.atan2(-dy, dx) * 180) / Math.PI;
  // Map distance so the tip of the drawn aim arrow follows the pointer.
  const reach = Math.hypot(dx, dy) - (PHYSICS.MUZZLE + 26);
  dispatchInput({ kind: 'aim', angle, power: Math.round((reach / 110) * AIM.MAX_POWER * 100) / 100 });
}

canvas.addEventListener('pointerdown', (e) => {
  sound.unlock();
  if (screen !== 'play' || !match || menu.isOpen) return;
  if (match.phase === 'roundOver' || match.phase === 'killcam') return advanceMatch();
  if (!network && !match.isHumanTurn) return;
  if (network && match.current !== networkPlayerId) return;
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
    if (network ? m.current === networkPlayerId : m.isHumanTurn) touchLabel = m.mode === 'horizon' ? t('common.ready') : t('common.fire');
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
    if (!network || networkHost) m.update(dt);
    effects.update(dt, m.world);
  }
  if (network && networkHost && (match instanceof ClassicMatch || match instanceof HorizonMatch) && screen === 'play') {
    stateElapsed += dt;
    if (stateElapsed >= 0.1) {
      stateElapsed %= 0.1;
      const events = pendingEvents;
      pendingEvents = [];
      sendNetwork({ type: 'state', seq: ++stateSequence, snapshot: match.snapshot(), events });
    }
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
