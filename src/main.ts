import '@fontsource/big-shoulders-stencil-display/800';
import '@fontsource/b612/400';
import '@fontsource/b612/700';
import '@fontsource/b612-mono/400';
import '@fontsource/b612-mono/700';
import './style.css';

import { Sound } from './audio';
import { dailyChallenge, dateKey, isDateKey } from './challenge';
import { ClipRecorder } from './clip';
import { AIM, COLORS, FIELD, FONTS, PHYSICS } from './config';
import { recordRun } from './dailyStore';
import { ChallengeMatch, createChallenge, createMatch, HorizonMatch, type Match, type VersusMode } from './game';
import { stakeOptions, TIP_HIT, TIP_MISS, TIP_NOBODY } from './game/oracle';
import type { OracleTap } from './render/oracle';
import { readInvite } from './invite';
import { MultiplayerSession } from './multiplayer';
import type { ClientInput } from './net';
import { inNebula } from './physics';
import { POWER_UP } from './powerups';
import { Effects } from './render/effects';
import { applyStaticTexts, fmt, getLang, setLang, t, type Key } from './i18n';
import { Renderer } from './render/renderer';
import { POWER_UP_COLORS } from './render/powerup-art';
import { STYLE_MULTIPLIER, styleLabel } from './scoring';
import { mayhemRules } from './lobbyPrefs';
import { cloneSettings, DEFAULT_SETTINGS, loadSettings, saveSettings } from './settings';
import { dailyResultScreen } from './ui/daily';
import { Menu } from './ui/menu';
import { lobbyScreen } from './ui/lobby';
import { gameOverScreen, pauseScreen, titleScreen, type App } from './ui/screens';

const canvas = document.querySelector<HTMLCanvasElement>('#stage')!;
const debugSeedBadge = document.querySelector<HTMLAnchorElement>('#debug-seed')!;
const overlay = document.querySelector<HTMLElement>('#overlay')!;
const touchFire = document.querySelector<HTMLButtonElement>('#touch-fire')!;
const touchPower = document.querySelector<HTMLButtonElement>('#touch-power')!;
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
let lastMayhem = false;
/** `?daily=YYYY-MM-DD` flies another day's challenge — handy for testing and for sharing an old one. */
const requestedDay = new URLSearchParams(location.search).get('daily');
const forcedDay = isDateKey(requestedDay) ? requestedDay : null;

const active = (): Match => (screen === 'play' && match ? match : attract);

function wire(m: Match): void {
  const audible = m !== attract;
  const color = (id: number) => m.players[id].color;
  // The first round of a Mayhem match is announced before anybody is listening for the round event.
  if (audible && m.revealing) sound.reveal(m.mayhem!.jackpot);
  m.on((e) => {
    if (active() !== m) return;
    switch (e.type) {
      case 'round':
        effects.clear();
        if (audible && m.revealing) sound.reveal(m.mayhem!.jackpot);
        break;
      case 'fire':
        effects.muzzle(e.x, e.y, e.angle, color(e.player));
        if (audible) sound.fire(e.power);
        break;
      case 'impact':
        effects.impact(e.x, e.y, color(e.player), e.vx, e.vy);
        if (audible) sound.impact();
        break;
      case 'pickup':
        effects.pickup(e.x, e.y, POWER_UP_COLORS[e.kind], m.world.ships[e.player]);
        if (e.dropped) effects.drop(m.world.ships[e.player].x, m.world.ships[e.player].y, POWER_UP_COLORS[e.dropped]);
        if (audible) sound.pickup();
        break;
      case 'pickupSpawn':
        effects.spawn(e.x, e.y, POWER_UP_COLORS[e.kind]);
        if (audible) sound.spawn();
        break;
      case 'pickupFade':
        effects.fade(e.x, e.y, POWER_UP_COLORS[e.kind]);
        if (audible) sound.fade();
        break;
      case 'teleport':
        effects.teleport(e.fromX, e.fromY, e.toX, e.toY, color(e.player));
        if (audible) sound.teleport();
        break;
      case 'blackhole':
        effects.collapse(e.x, e.y);
        if (audible) sound.devour();
        break;
      case 'planetKiller': {
        const ship = m.world.ships[e.player];
        effects.laser(ship.x, ship.y, e.x, e.y, POWER_UP_COLORS.planetkiller, e.radius);
        if (audible) sound.explode();
        break;
      }
      case 'wormhole':
        effects.teleport(e.x, e.y, e.toX, e.toY, POWER_UP_COLORS.wormhole);
        if (audible) sound.teleport();
        break;
      case 'nebula':
        effects.spawn(e.x, e.y, POWER_UP_COLORS.nebula);
        if (audible) sound.spawn();
        break;
      case 'defense':
        effects.spawn(e.x, e.y, color(e.player));
        if (audible) sound.spawn();
        break;
      case 'polarity':
        effects.polarity(e.x, e.y, e.radius, e.reversed, POWER_UP_COLORS.polarity);
        if (audible) sound.polarity(e.reversed);
        break;
      case 'defenseFire':
        effects.defenseFire(e.x, e.y, e.toX, e.toY, POWER_UP_COLORS.defense);
        if (audible) sound.defenseFire();
        break;
      case 'defenseMiss':
        effects.missileLost(e.x, e.y, POWER_UP_COLORS.defense);
        if (audible) sound.fizzle();
        break;
      case 'shotdown':
        effects.intercepted(e.x, e.y, POWER_UP_COLORS.defense, color(e.player), e.vx, e.vy);
        if (audible) sound.intercepted();
        break;
      case 'split':
        effects.split(e.x, e.y, POWER_UP_COLORS.splitter);
        if (audible) sound.split();
        break;
      case 'shield':
        effects.shieldHit(e.x, e.y, POWER_UP_COLORS.shield);
        if (audible) sound.shield();
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
        if (e.points > 0) effects.callout(`${t('hud.highFive')} +${e.points}`, e.x, e.y, COLORS.sodium, true);
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
      case 'multiKill': {
        const name = t(`multiKill.${Math.min(e.kills, 5)}` as Key);
        effects.callout(`${name} ×${e.kills}  +${e.points}`, e.x, e.y - 46, COLORS.sodium, true);
        if (audible) sound.combo();
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

/** Created on first use; it outlives single matches, so leaving a game lands you back in the lobby. */
let session: MultiplayerSession | null = null;
function multiplayer(): MultiplayerSession {
  session ??= new MultiplayerSession({
    settings: () => settings,
    matchStarted(m) {
      if (match !== m) match?.dispose();
      match = m;
      wire(m);
      screen = 'play';
      effects.clear();
      menu.close();
    },
    matchRestarted: () => menu.close(),
    matchEnded() {
      match?.dispose();
      match = null;
      screen = 'title';
      effects.clear();
      menu.open(() => lobbyScreen(app, multiplayer()));
    },
  });
  return session;
}
/** The online match on screen, if any. */
const online = (): MultiplayerSession | null => (session?.match ? session : null);

/** Route a player input: online it goes through the session, offline straight to the match. */
function dispatchInput(input: ClientInput): void {
  const net = online();
  if (net) return net.input(input);
  if (!match) return;
  if (input.kind === 'adjust') match.adjust(input.dAngle, input.dPower);
  else if (input.kind === 'aim') match.setAim(input.angle, input.power);
  else if (input.kind === 'fire') match.commit();
  else if (input.kind === 'power') match.usePowerUp();
  else if (input.kind === 'cancel') match.cancelPlacement();
}

/** Whether a splitter is armed in a shot the person at this screen has in the air. */
const splitterInAir = (m: Match): boolean => m.powerUps && m.phase === 'flying' && m.players.some((p) => (m.viewer === null ? !p.cpu : p.id === m.viewer) && p.armed && p.powerUp === 'splitter');

function advanceMatch(): void {
  const net = online();
  if (net) net.advance();
  else match?.advance();
}

/** Whether the local player may aim right now. */
const canAim = (): boolean => !!match?.localCanAim;

const app: App = {
  menu,
  settings,
  settingsChanged() {
    saveSettings(settings);
    sound.enabled = settings.sound;
    effects.particles = settings.particles;
    attract.applySettings(settings);
    if (!online()) match?.applySettings(settings);
    if (settings.language !== getLang()) {
      setLang(settings.language);
      applyStaticTexts();
      menu.rebuild();
    }
  },
  get mode() {
    return screen === 'play' && match ? match.mode : null;
  },
  get mayhem() {
    return screen === 'play' && !!match && match.settings.mayhem > 0;
  },
  today: () => forcedDay ?? dateKey(),
  start(mode, mayhem = false) {
    lastMode = mode;
    lastMayhem = mayhem;
    match?.dispose();
    // Mayhem is a game of its own: it plays by its two rules over the plain ones, whatever the other setups say.
    const rules = cloneSettings(settings);
    match = createMatch(mode, mayhem ? { ...rules, ...mayhemRules(rules, mode) } : { ...rules, mayhem: 0 });
    wire(match);
    screen = 'play';
    effects.clear();
    menu.close();
  },
  startDaily() {
    match?.dispose();
    match = createChallenge(cloneSettings(settings), dailyChallenge(app.today()));
    wire(match);
    screen = 'play';
    effects.clear();
    menu.close();
  },
  get online() {
    return !!online();
  },
  openLobby: () => menu.open(() => lobbyScreen(app, multiplayer())),
  toLobby() {
    session?.leaveRoom();
    match?.dispose();
    match = null;
    screen = 'title';
    effects.clear();
    menu.open(() => lobbyScreen(app, multiplayer()));
  },
  resume() {
    menu.close();
  },
  rematch() {
    if (!match) return app.start(lastMode, lastMayhem);
    if (online()) {
      if (!match.canAdvance) return;
      advanceMatch();
      menu.close();
      return;
    }
    effects.clear();
    match.newMatch();
    menu.close();
  },
  toTitle() {
    session?.disconnect();
    match?.dispose();
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
  if (online() && match.phase === 'gameOver') app.rematch();
  // The announcement of a Mayhem round: the fire key skips it.
  else if (match.revealing) {
    if (match.canAdvance) dispatchInput({ kind: 'fire' });
  } else if (canAim()) dispatchInput({ kind: 'fire' });
  // While a shot flies, the fire key only matters for a splitter.
  else if (splitterInAir(match)) dispatchInput({ kind: 'fire' });
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

/** A focused text field gets every key, so typing a name can't toggle full screen. */
function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || target.matches('input, textarea, select'));
}

/**
 * The oracle tip a key stands for while an eliminated player has a question open: ← → for a shot, 1–5 and
 * 0 for a salvo — and Shift with 1–5 (0 for a draw) for who wins the round.
 */
function oracleKey(e: KeyboardEvent): OracleTap | null {
  const q = match?.oracle.question;
  if (!match || !match.ghost || e.ctrlKey || e.metaKey || e.altKey) return null;
  const digit = /^(?:Digit|Numpad)(\d)$/.exec(e.code);
  const rq = match.oracle.roundQuestion;
  // B puts the smaller stake on the tip on the round, Shift + B the larger one: points of the match, once.
  if (e.code === 'KeyB' && rq && match.viewer !== null) {
    const mine = match.oracle.roundMine;
    const options = stakeOptions(match.players[match.viewer].score);
    if (!mine || mine.id !== rq.id || !match.maxStake(match.viewer) || !options.length) return null;
    return { pick: mine.pick, round: true, stake: e.shiftKey ? options[options.length - 1] : options[0] };
  }
  if (e.shiftKey && digit && rq) {
    if (match.phase !== 'aiming') return null;
    const n = Number(digit[1]);
    const pick = n === 0 ? (rq.draw ? TIP_NOBODY : null) : match.roundChoices[n - 1] ?? null;
    return pick === null ? null : { pick, round: true };
  }
  if (!q || q.locked) return null;
  if (q.kind === 'shot') return e.code === 'ArrowLeft' ? { pick: TIP_HIT, round: false } : e.code === 'ArrowRight' ? { pick: TIP_MISS, round: false } : null;
  if (!digit) return null;
  const n = Number(digit[1]);
  const pick = n === 0 ? TIP_NOBODY : q.choices[n - 1] ?? null;
  return pick === null ? null : { pick, round: false };
}

/** The oracle tip under a pointer: one of the bar's or the round row's choices, or — for a salvo — the ship itself. */
function oracleTap(clientX: number, clientY: number): OracleTap | null {
  const q = match?.oracle.question;
  if (!match || !match.ghost) return null;
  const chip = renderer.oracleHit(clientX, clientY);
  if (chip) return chip.round ? (match.canBetRound(match.viewer ?? -1) ? chip : null) : q && !q.locked ? chip : null;
  if (!q || q.locked || q.kind !== 'salvo') return null;
  const at = renderer.toField(clientX, clientY);
  const ship = q.choices.find((id) => Math.hypot(match!.world.ships[id].x - at.x, match!.world.ships[id].y - at.y) < 30);
  return ship === undefined ? null : { pick: ship, round: false };
}

/** Whether the oracle was last answered with the pointer: then the choices lose their key caps, which only add noise. */
let oraclePointer = false;

/** Sends an oracle tip to wherever the match is judged. */
function placeTip(tip: OracleTap): void {
  dispatchInput({ kind: 'bet', pick: tip.pick, ...(tip.round ? { round: true } : {}), ...(tip.stake ? { stake: tip.stake } : {}) });
}

window.addEventListener('keydown', (e) => {
  sound.unlock();
  if (e.code === 'KeyF' && !e.metaKey && !e.ctrlKey && !isTyping(e.target)) {
    app.toggleFullscreen();
    return;
  }
  if (menu.isOpen) {
    if (menu.handleKey(e)) e.preventDefault();
    return;
  }
  if (screen !== 'play' || !match) return;

  const tip = oracleKey(e);
  if (tip) {
    if (!e.repeat) {
      oraclePointer = false;
      placeTip(tip);
    }
    e.preventDefault();
    return;
  }

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
    case 'KeyP':
      if (match?.powerUps && !e.repeat) dispatchInput({ kind: 'power' });
      break;
    case 'Escape':
      // Aiming a placement: Esc thinks again, it does not open the menu.
      if (match?.placing) {
        dispatchInput({ kind: 'cancel' });
        break;
      }
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
  if (!match || !canAim()) return;
  const f = renderer.toField(clientX, clientY);
  const ship = match.world.ships[match.viewer ?? match.current];
  const dx = f.x - ship.x;
  const dy = f.y - ship.y;
  const angle = (Math.atan2(-dy, dx) * 180) / Math.PI;
  const distance = Math.hypot(dx, dy);
  // A teleport puts its spot under the pointer; a shot's arrow tip follows the pointer.
  const reach = match.placing ? distance / POWER_UP.TELEPORT_RANGE : (distance - (PHYSICS.MUZZLE + 26)) / 110;
  dispatchInput({ kind: 'aim', angle, power: Math.round(reach * AIM.MAX_POWER * 100) / 100 });
}

canvas.addEventListener('pointerdown', (e) => {
  sound.unlock();
  if (screen !== 'play' || !match || menu.isOpen) return;
  const tip = oracleTap(e.clientX, e.clientY);
  if (tip) {
    oraclePointer = true;
    return placeTip(tip);
  }
  if (match.phase === 'roundOver' || match.phase === 'killcam') return advanceMatch();
  if (!canAim()) return;
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
touchPower.addEventListener('click', () => {
  sound.unlock();
  if (match?.powerUps) dispatchInput({ kind: 'power' });
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
    if (canAim()) touchLabel = m.placing ? t('powerup.jump') : m.salvo ? t('common.ready') : t('common.fire');
    // A splitter in the air: the fire button splits the shot.
    else if (splitterInAir(m)) touchLabel = t('powerup.splitNow');
    else if (m.phase === 'roundOver') touchLabel = t('common.next');
    else if (m.phase === 'killcam' && !recorder.recording) touchLabel = t('common.skip');
  }
  if (touchFire.hidden !== !touchLabel) touchFire.hidden = !touchLabel;
  if (touchLabel && touchFire.textContent !== touchLabel) touchFire.textContent = touchLabel;

  // Power-ups on touch: a placement or a preview has a button of its own while its ship is aiming.
  const holder = playing && coarsePointer.matches && m?.powerUps && canAim() ? m.players[m.viewer ?? m.current] : null;
  const power = holder && holder.powerUp && holder.powerUp !== 'splitter' && holder.powerUp !== 'shield' ? holder : null;
  if (touchPower.hidden !== !power) touchPower.hidden = !power;
  if (power) {
    const label = `${power.armed || m!.placing ? '● ' : ''}${t(`powerup.${power.powerUp}` as Key).toUpperCase()}`;
    if (touchPower.textContent !== label) touchPower.textContent = label;
    touchPower.style.setProperty('--power', POWER_UP_COLORS[power.powerUp!]);
  }

  const canClip = playing && m instanceof HorizonMatch && m.canReplay && ClipRecorder.supported && !recorder.recording;
  if (clipButton.hidden === canClip) clipButton.hidden = !canClip;
}

/** The oracle's last verdicts per match (shot or salvo, and the round's), so each one is announced on the field once. */
const judged = new WeakMap<Match, { shot: number; round: number }>();

/**
 * Right or wrong, floating over the ship that was tipped — once the killcam is out of the way — and, for
 * everybody at the table, the moment the ghosts' majority turned out wrong ("Oracle fooled!") or knew it all.
 */
function announceOracle(m: Match): void {
  if (!judged.has(m)) judged.set(m, { shot: m.oracle.result?.id ?? 0, round: m.oracle.roundResult?.id ?? 0 });
  const seen = judged.get(m)!;
  const crowd = (verdict: 'wrong' | 'right' | undefined, at: { x: number; y: number }, lift: number) => {
    if (!verdict || m.viewer === null) return;
    effects.callout(t(verdict === 'wrong' ? 'oracle.crowd.wrong' : 'oracle.crowd.right'), at.x, at.y - lift, COLORS.sodium, true);
  };

  const r = m.oracle.result;
  if (r && m.phase !== 'killcam' && r.id > seen.shot) {
    seen.shot = r.id;
    const tip = m.ghost ? r.tips.find((x) => x.player === m.viewer) : undefined;
    const at = r.kind === 'shot' ? m.world.ships[r.shooter] : tip && tip.pick >= 0 ? m.world.ships[tip.pick] : { x: FIELD.width / 2, y: FIELD.height / 2 };
    if (tip) {
      effects.callout(tip.right ? `${t('oracle.right')} +${tip.points}` : t('oracle.wrong'), at.x, at.y - 34, tip.right ? COLORS.sodium : COLORS.boneDim, tip.right);
      if (tip.right) sound.combo();
    }
    crowd(r.crowd, at, tip ? 72 : 40);
  }

  const round = m.oracle.roundResult;
  if (round && m.phase === 'roundOver' && round.id > seen.round) {
    seen.round = round.id;
    const tip = m.ghost ? round.tips.find((x) => x.player === m.viewer) : undefined;
    const winner = round.winners.length ? m.world.ships[round.winners[0]] : { x: FIELD.width / 2, y: FIELD.height / 2 };
    if (tip) {
      // Below the ship: the shot's own verdict may be floating above it.
      effects.callout(tip.right ? `${t('oracle.right')} +${tip.points}` : t('oracle.wrong'), winner.x, winner.y + 48, tip.right ? COLORS.sodium : COLORS.boneDim, tip.right);
      if (tip.right) sound.combo();
    }
    // What the bet on it came to, below that.
    if (tip?.stake) {
      const net = (tip.payout ?? 0) - tip.stake;
      effects.callout(`${t('oracle.stake')} ${net > 0 ? '+' : net < 0 ? '−' : '±'}${Math.abs(net)}`, winner.x, winner.y + 84, net > 0 ? COLORS.sodium : COLORS.boneDim, net > 0);
    }
    crowd(round.crowd, winner, tip ? -86 : -54);
  }
}

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const m = active();
  // The seed badge (a shortcut into debug-aim.html) follows the same switch that serves the page.
  debugSeedBadge.hidden = !import.meta.env.DEBUG_AIM || screen !== 'play' || !match;
  if (!debugSeedBadge.hidden) {
    const current = match!;
    const shooterId = current.current >= 0 ? current.current : Math.max(0, current.viewer ?? 0);
    const shooter = current.players[shooterId];
    const activeGrace = shooter && shooter.shots < current.settings.neighborGrace ? current.settings.neighborGrace : 0;
    const teams = current.teamMode ? ` · TEAMS ${current.teamMode} [${current.players.map((p) => p.team).join(',')}]` : ' · FFA';
    debugSeedBadge.textContent = `SEED ${current.worldSeed} · ${current.mode.toUpperCase()} · ${current.players.length} SHIPS · ${current.settings.maxPlanets} MAX PLANETS${teams}`;
    const query = new URLSearchParams({
      seed: String(current.worldSeed),
      mode: current.mode,
      ships: String(current.players.length),
      planets: String(current.settings.maxPlanets),
      teams: String(current.teamMode),
      teamIds: current.players.map((p) => p.team ?? 0).join(','),
      shooter: String(shooterId),
      angle: String(shooter?.angle ?? 0),
      power: String(shooter?.power ?? 50),
      aimPower: String(shooter?.power ?? 50),
      bounce: String(current.rules.bounce),
      shotTime: String(current.rules.timeLimit),
      grace: String(activeGrace),
      style: String(current.settings.styleBonuses),
      fixed: String(current.settings.fixedPower),
      fixedPower: String(current.settings.fixedPowerLevel),
      maxPower: String(current.settings.maxPower),
    });
    debugSeedBadge.href = `/debug-aim.html?${query}`;
  }
  const net = online();
  // Online the others keep playing, so a menu on top doesn't stop the world.
  const paused = screen === 'play' && menu.isOpen && !net;
  const empty = screen !== 'play' && !settings.menuBackground;
  if (!paused && !empty) {
    if (!net || net.isHost) m.update(dt);
    effects.update(dt, m.world);
    // A shot flying through a nebula sheds wisps of gas, so its slowing down shows.
    if (m.world.nebulae.length) {
      for (const vs of m.scene().volley?.shots ?? []) {
        const s = vs.shot;
        if (!s.end && s.inField && inNebula(m.world.nebulae, s.x, s.y)) effects.nebulaDrag(s.x, s.y, s.vx, s.vy, dt, POWER_UP_COLORS.nebula);
      }
    }
  }
  net?.update(dt);
  if (empty) renderer.drawEmpty();
  else {
    renderer.draw(
      m,
      effects,
      { hud: screen === 'play', touch: coarsePointer.matches, recording: recorder.recording, keyHints: !oraclePointer },
      paused ? 0 : dt,
    );
  }
  if (screen === 'play' && m === match) announceOracle(m);
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
  // An invite link opens the lobby by itself and joins the named room after connecting.
  if (readInvite(location.search, location.hash)) app.openLobby();
  else app.toTitle();
  requestAnimationFrame(frame);
}
void boot();
