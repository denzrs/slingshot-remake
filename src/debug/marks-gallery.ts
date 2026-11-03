import '@fontsource/big-shoulders-stencil-display/800';
import '@fontsource/b612/400';
import '@fontsource/b612/700';
import '@fontsource/b612-mono/400';
import '@fontsource/b612-mono/700';
import './looks-gallery.css';
import './marks-gallery.css';
import { createMatch, type MarkKind, type Match } from '../game';
import { DEFAULT_SETTINGS, type Seat } from '../data/settings';
import { SCORING } from '../sim/config';
import { t } from '../platform/i18n';
import { Effects } from '../render/effects';
import { drawMarkSymbol, MARK_COLORS } from '../render/mark-art';
import { Renderer, type DrawOptions } from '../render/renderer';
import { createUiPreview } from './devPreview';

/**
 * Dev-only page (`/marks.html`, never part of a build): every symbol the scoreboard's cards carry, large and at the size they are
 * drawn, and the real HUD with them, through the eyes of each seat (the buttons), on a narrow card (a phone held upright) and in a team.
 * A new mark shows up here by being added to `MARK_COLORS` and to `SYMBOLS` below.
 */

const OPTIONS: DrawOptions = { hud: true, fullScreen: false, touch: false, recording: false, keyHints: false, aimCardDodge: false };

interface MarkEntry {
  kind: MarkKind;
  name: string;
  pays: string;
  where: string;
}

const SYMBOLS: MarkEntry[] = [
  { kind: 'bounty', name: `${t('bonus.bounty')} · Champion`, pays: `+25 % des Vorsprungs, höchstens ${SCORING.BOUNTY_MAX}`, where: 'Krone auf dem Führenden (Vorsprung ab 100). Für alle.' },
  { kind: 'shutdown', name: t('bonus.shutdown'), pays: `+${SCORING.SHUTDOWN_PER_KILL} je Gegner, den das Schiff genommen hat`, where: 'Flamme auf einem Schiff mit zwei oder mehr Abschüssen in der Runde. Für alle.' },
  { kind: 'comeback', name: t('bonus.comeback'), pays: `+${SCORING.COMEBACK} am Rundenende`, where: 'Auf dem einzigen Letzten bei Rundenbeginn: gewinnt er die Runde, zahlt es. Für alle.' },
  { kind: 'revenge', name: t('bonus.revenge'), pays: `+${SCORING.REVENGE}, doppelt nach ${SCORING.DOMINATION_ROUNDS} Runden in Folge`, where: 'Auf dem, der dich in der Runde davor abgeschossen hat. Nur für dich.' },
  { kind: 'domination', name: t('bonus.domination'), pays: `+${SCORING.DOMINATION}`, where: `Auf einem Schiff, das du ${SCORING.DOMINATION_ROUNDS - 1} Runden in Folge abgeschossen hast. Nur für dich.` },
  { kind: 'avenger', name: t('bonus.avenger'), pays: `+${SCORING.AVENGER}`, where: 'Auf dem Gegner, der diese Runde einen Teamkameraden genommen hat. Fürs Team.' },
  { kind: 'underdog', name: t('bonus.underdog'), pays: `+20 % des Abstands, höchstens ${SCORING.UNDERDOG_MAX}`, where: 'Auf jedem Schiff über dir, solange du allein Letzter bist (ab drei Schiffen). Nur für dich.' },
  { kind: 'firstBlood', name: t('bonus.firstBlood'), pays: `+${SCORING.FIRST_BLOOD}`, where: 'Auf deiner eigenen Karte, bis der erste Abschuss der Runde gefallen ist.' },
  { kind: 'opener', name: t('bonus.opener'), pays: `+${SCORING.OPENER}`, where: 'Auf deiner eigenen Karte, solange du in der Runde noch nicht geschossen hast.' },
  { kind: 'chain', name: 'Abschussserie', pays: `+${SCORING.MULTI_KILL[2]} bis +${SCORING.MULTI_KILL[5]}`, where: 'Auf deiner eigenen Karte, ab dem zweiten Abschuss der Runde: das nächste Kettenglied.' },
];

/** Draws one symbol into a canvas of `size` CSS pixels, `r` big, with the line the HUD would use scaled to it. */
function paint(canvas: HTMLCanvasElement, kind: MarkKind, size: number, r: number, line: number): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = canvas.height = Math.round(size * dpr);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = line;
  ctx.strokeStyle = ctx.fillStyle = MARK_COLORS[kind];
  drawMarkSymbol(ctx, kind, size / 2, size / 2, r);
}

/** Six ships on the dev preview's field (see `cardMarks` in devPreview.ts): you are last, Mira leads, Nia has a grudge, Vega is on a spree. */
function freeForAll(): Match {
  return createUiPreview('card-marks');
}

/** Four ships in two teams (you and Rook against Mira and Nia): Rook, your teammate, has just been shot down by Nia, who is the avenger's mark. */
function teams(): Match {
  const seats: Seat[] = ['human', 'human', 'human', 'human', 'off', 'off'];
  const settings = { ...DEFAULT_SETTINGS, seats, teamMode: 2, rounds: 5, menuBackground: false, menuSounds: false, gameSounds: false };
  const match = createMatch('classic', settings, { seats, names: ['Du', 'Mira', 'Rook', 'Nia'], seed: 24681357 });
  match.phase = 'aiming';
  match.current = 0;
  match.viewer = 0;
  match.players.forEach((p, i) => (p.score = [900, 3400, 2100, 1800][i]));
  match.players[2].alive = false;
  const state = match as unknown as { killedBy: Map<number, number>; killedBefore: Map<number, number>[]; roundScores: number[] };
  state.killedBy = new Map([[2, 3]]);
  state.killedBefore = [];
  state.roundScores = match.players.map((p) => p.score);
  return match;
}

/** A duel: two ships, no scoreboard but a block in each corner. Mira leads and shot you down last round. */
function duel(): Match {
  const seats: Seat[] = ['human', 'human', 'off', 'off', 'off', 'off'];
  const settings = { ...DEFAULT_SETTINGS, seats, rounds: 5, powerUps: true, menuBackground: false, menuSounds: false, gameSounds: false };
  const match = createMatch('classic', settings, { seats, names: ['Du', 'Mira'], seed: 24681357 });
  match.phase = 'aiming';
  match.current = 0;
  match.viewer = 0;
  match.players.forEach((p, i) => (p.score = [900, 2100][i]));
  const state = match as unknown as { killedBefore: Map<number, number>[]; roundScores: number[] };
  state.killedBefore = [new Map([[0, 1]])];
  state.roundScores = match.players.map((p) => p.score);
  return match;
}

interface Figure {
  match: Match;
  canvas: HTMLCanvasElement;
  stage: HTMLElement;
  renderer: Renderer;
  effects: Effects;
}

const figures: Figure[] = [];

function figure(parent: HTMLElement, match: Match, title: string, note: string, shape: 'wide' | 'narrow'): Figure {
  const fig = document.createElement('figure');
  fig.innerHTML = `<div class="stage ${shape}"><canvas aria-label="${title}"></canvas></div><figcaption><b>${title}</b><span>${note}</span></figcaption>`;
  parent.append(fig);
  const stage = fig.querySelector<HTMLElement>('.stage')!;
  const canvas = stage.querySelector('canvas')!;
  const renderer = new Renderer(canvas, () => ({ width: Math.max(1, stage.clientWidth), height: Math.max(1, stage.clientHeight) }));
  const entry = { match, canvas, stage, renderer, effects: new Effects(true, false, 'medium') };
  figures.push(entry);
  return entry;
}

const root = document.createElement('div');
root.className = 'wrap';
root.innerHTML = `
  <header>
    <h1>Marken auf den Karten</h1>
    <p class="note">Beim Zielen sagen die Karten, welches Schiff den meisten Gewinn bringt. Hier stehen alle Symbole, das echte Scoreboard aus der Sicht jedes Platzes und die schmale Karte eines Handys.</p>
  </header>
  <main>
    <section><h2>Symbole <small>groß, und so groß wie auf der Karte</small></h2><ul class="symbols"></ul></section>
    <section id="viewers"><h2>Scoreboard <small>aus der Sicht von …</small></h2><div class="viewers"></div><div class="row big"></div>
      <p class="note">Du bist Letzter und zielst zuerst. Mira führt, Nia hat dich letzte Runde abgeschossen, du hast Oskar zwei Runden in Folge abgeschossen, Vega ist auf Serie. Der Rahmen liegt um die Karte mit dem höchsten Gewinn.</p></section>
    <section><h2>Schmal, Duell und Team <small>Handy hochkant, zwei Schiffe, zwei Teams mit Rächer</small></h2><div class="row pair"></div></section>
  </main>`;
document.body.append(root);

const list = root.querySelector<HTMLUListElement>('.symbols')!;
for (const symbol of SYMBOLS) {
  const item = document.createElement('li');
  item.style.setProperty('--mark', MARK_COLORS[symbol.kind]);
  item.innerHTML = `<canvas aria-hidden="true"></canvas><b>${symbol.name}</b><span class="pays">${symbol.pays}</span><span class="where">${symbol.where}</span><span class="actual"><canvas aria-hidden="true"></canvas>auf der Karte</span>`;
  list.append(item);
  const [big, small] = item.querySelectorAll('canvas');
  paint(big, symbol.kind, 96, 38, 4.6);
  paint(small, symbol.kind, 24, 5.8, 1.4);
}

// One real scoreboard, seen by each seat in turn.
const main = figure(root.querySelector('#viewers .row')!, freeForAll(), 'Aus Sicht von Du', 'Alle Marken auf einmal', 'wide');
const viewerBar = root.querySelector<HTMLElement>('.viewers')!;
const SEATS = ['Du', 'Mira', 'Rook', 'Nia', 'Oskar', 'Vega'];
const buttons = [...SEATS.map((name, i) => ({ name, seat: i })), { name: 'Zuschauer', seat: -1 }].map(({ name, seat }) => {
  const button = document.createElement('button');
  button.textContent = name;
  button.addEventListener('click', () => {
    main.match.viewer = seat < 0 ? null : seat;
    main.match.spectatorId = seat < 0 ? 0 : null;
    main.match.current = Math.max(0, seat);
    main.stage.parentElement!.querySelector('figcaption b')!.textContent = `Aus Sicht von ${name}`;
    buttons.forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
  });
  viewerBar.append(button);
  return button;
});
buttons[0].setAttribute('aria-pressed', 'true');

const pair = root.querySelector<HTMLElement>('.row.pair')!;
figure(pair, freeForAll(), 'Schmale Karten', 'Zu schmal für Marken neben dem Punktestand: eine Zeile mit Summe und dem wertvollsten Symbol', 'narrow');
figure(pair, duel(), 'Duell', 'Zwei Schiffe, zwei Blöcke: Kopfgeld und Rache auf Mira (Mira hat dich abgeschossen und führt), Erstes Blut und Auftakt auf deiner Seite', 'wide');
figure(pair, teams(), 'Team', 'Rächer auf Nia, die Rook aus deinem Team genommen hat; der ausgeschiedene Rook trägt nichts', 'wide');

const redraw = (): void => {
  for (const { match, renderer, effects } of figures) renderer.draw(match, effects, OPTIONS, 1 / 60);
  requestAnimationFrame(redraw);
};
void document.fonts.ready.then(redraw);
