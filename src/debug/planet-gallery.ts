import '@fontsource/big-shoulders-stencil-display/800';
import '@fontsource/b612/400';
import '@fontsource/b612/700';
import '@fontsource/b612-mono/400';
import '@fontsource/b612-mono/700';
import './looks-gallery.css';
import './planet-gallery.css';
import type { Match } from '../game';
import { LOOKS, lookLabelKey, setLook, type Look } from '../data/look';
import { t } from '../platform/i18n';
import { Effects } from '../render/effects';
import { Renderer } from '../render/renderer';
import { FIELD } from '../sim/config';
import type { Planet, PlanetStyle } from '../sim/physics';
import { createRng, pick } from '../sim/rng';
import { PLANET_TINTS } from '../sim/world';
import { aiming, GALLERY_OPTIONS, STYLE_NAMES } from './gallery-match';

/**
 * Dev-only page (`/dev/planets.html`): every style of planet at every size the game draws, from a solar system's smallest
 * moon to the biggest giant of an open field, in the real field renderer. A tab per look, or all of them side by side;
 * "Neue Samen" rolls other faces (maps, rings, moons) for the same grid, and the seed stays in the address to share.
 */

/** The radii the grid shows: the solar system's small bodies up to the largest planet `generateWorld` makes. */
const SIZES = [10, 16, 24, 34, 46, 60];
const STYLES: PlanetStyle[] = ['rocky', 'gas', 'ice', 'lava'];
/** Room left and right of the grid, in field units. */
const MARGIN = 80;

const params = new URLSearchParams(location.search);
let seed = Number(params.get('seed')) || 1;
let shown: Look | 'all' = (LOOKS as readonly string[]).includes(params.get('look') ?? '') ? (params.get('look') as Look) : 'all';

/** The grid: a row per style, a column per size, the gaps between columns even. Seeds and tints come from `seed`. */
function grid(seed: number): Planet[] {
  const rng = createRng(seed);
  const gap = (FIELD.width - 2 * MARGIN - SIZES.reduce((sum, r) => sum + 2 * r, 0)) / (SIZES.length - 1);
  const rowHeight = FIELD.height / STYLES.length;
  const planets: Planet[] = [];
  STYLES.forEach((style, row) => {
    let x = MARGIN;
    for (const radius of SIZES) {
      x += radius;
      planets.push({ x, y: rowHeight * (row + 0.5), radius, mass: radius ** 3, seed: Math.floor(rng() * 2 ** 31), style, tint: pick(rng, PLANET_TINTS[style]) });
      x += radius + gap;
    }
  });
  return planets;
}

function field(seed: number): Match {
  const match = aiming('classic', 11);
  match.world.planets.length = 0;
  match.world.planets.push(...grid(seed));
  for (const ship of match.world.ships) ship.alive = false;
  return match;
}

interface Card {
  look: Look;
  figure: HTMLElement;
  stage: HTMLElement;
  labels: HTMLElement;
  renderer: Renderer;
  effects: Effects;
}

const main = document.createElement('div');
main.className = 'wrap looks-gallery planet-gallery';
main.innerHTML = `
  <header>
    <h1>Planeten</h1>
    <p class="lead">Jede Art in jeder Größe, Radius ${SIZES.join(' · ')}: was bei einem kleinen Mond noch zu erkennen ist und bei einem großen Planeten nicht weich wird.</p>
  </header>
  <div class="tools">
    <div class="tabs" role="tablist" aria-label="Look">
      <button type="button" role="tab" data-look="all">Alle</button>
      ${LOOKS.map((look) => `<button type="button" role="tab" data-look="${look}">${t(lookLabelKey(look))}</button>`).join('')}
    </div>
    <button id="reroll" type="button">Neue Samen</button>
    <button id="pause" type="button">Animation pausieren</button>
    <output id="seed"></output>
  </div>
  <main id="cards"></main>`;
document.body.append(main);

let match = field(seed);
const host = main.querySelector('#cards')!;
const cards: Card[] = LOOKS.map((look) => {
  const figure = document.createElement('figure');
  figure.innerHTML = `<div class="stage"><canvas aria-label="Planeten, ${t(lookLabelKey(look))}"></canvas><div class="labels" aria-hidden="true"></div></div><figcaption><b>${t(lookLabelKey(look))}</b><span>Zeilen: ${STYLES.map((s) => STYLE_NAMES[s]).join(', ')}</span></figcaption>`;
  host.append(figure);
  const stage = figure.querySelector<HTMLElement>('.stage')!;
  const renderer = new Renderer(stage.querySelector('canvas')!, () => ({ width: Math.max(1, stage.clientWidth), height: Math.max(1, stage.clientHeight) }));
  return { look, figure, stage, labels: figure.querySelector<HTMLElement>('.labels')!, renderer, effects: new Effects(true, false, 'medium') };
});

/** The style at the start of each row and the radius under each column, placed where the renderer put the planets. */
function placeLabels(card: Card): void {
  const planets = match.world.planets;
  const marks: string[] = [];
  STYLES.forEach((style, row) => {
    const first = planets[row * SIZES.length];
    const at = card.renderer.project(first.x - first.radius - 14, first.y, null, false);
    marks.push(`<span class="style" style="left:${at.x}px;top:${at.y}px">${STYLE_NAMES[style]}</span>`);
  });
  const last = STYLES.length - 1;
  SIZES.forEach((radius, column) => {
    const p = planets[last * SIZES.length + column];
    const at = card.renderer.project(p.x, p.y + FIELD.height / STYLES.length / 2 - 6, null, false);
    marks.push(`<span class="size" style="left:${at.x}px;top:${at.y}px">r ${radius}</span>`);
  });
  card.labels.innerHTML = marks.join('');
}

function show(): void {
  main.querySelectorAll<HTMLButtonElement>('[role="tab"]').forEach((tab) => tab.setAttribute('aria-selected', String(tab.dataset.look === shown)));
  host.classList.toggle('single', shown !== 'all');
  for (const card of cards) card.figure.hidden = shown !== 'all' && card.look !== shown;
  main.querySelector<HTMLOutputElement>('#seed')!.value = `Samen ${seed}`;
  const url = new URL(location.href);
  url.searchParams.set('seed', String(seed));
  if (shown === 'all') url.searchParams.delete('look');
  else url.searchParams.set('look', shown);
  history.replaceState(null, '', url);
}

main.querySelectorAll<HTMLButtonElement>('[role="tab"]').forEach((tab) =>
  tab.addEventListener('click', () => {
    shown = tab.dataset.look as Look | 'all';
    show();
  }),
);
main.querySelector('#reroll')!.addEventListener('click', () => {
  seed = 1 + Math.floor(Math.random() * 99999);
  match = field(seed);
  show();
});

let paused = matchMedia('(prefers-reduced-motion: reduce)').matches;
const pauseButton = main.querySelector<HTMLButtonElement>('#pause')!;
const label = (): void => {
  pauseButton.textContent = paused ? 'Animation starten' : 'Animation pausieren';
};
label();
pauseButton.addEventListener('click', () => {
  paused = !paused;
  label();
});
show();

let last = performance.now();
function frame(now: number): void {
  const dt = paused ? 0 : Math.min(0.05, (now - last) / 1000);
  last = now;
  for (const card of cards) {
    if (card.figure.hidden) continue;
    card.effects.update(dt, match.world);
    setLook(card.look);
    card.renderer.draw(match, card.effects, GALLERY_OPTIONS, dt);
    placeLabels(card);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
