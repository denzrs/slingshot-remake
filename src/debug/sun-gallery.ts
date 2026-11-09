import '@fontsource/big-shoulders-stencil-display/800';
import '@fontsource/b612/400';
import '@fontsource/b612/700';
import '@fontsource/b612-mono/400';
import '@fontsource/b612-mono/700';
import './looks-gallery.css';
import './planet-gallery.css';
import './sun-gallery.css';
import type { Match } from '../game';
import { LOOKS, lookLabelKey, setLook, type Look } from '../data/look';
import { t } from '../platform/i18n';
import { Effects } from '../render/effects';
import { Renderer } from '../render/renderer';
import { SUN_KINDS, sunBeat, sunKind, type SunKindId } from '../render/sun-kinds';
import { FIELD, SOLAR, SUDDEN_DEATH } from '../sim/config';
import type { Planet } from '../sim/physics';
import { createRng } from '../sim/rng';
import { PLANET_TINTS } from '../sim/world';
import { aiming, GALLERY_OPTIONS } from './gallery-match';

/**
 * Dev-only page (`/dev/suns.html`): every kind of sun a Solar System may have, in the real field renderer, a tab per look.
 * All kinds side by side at the game's size, or one up close; a slider swells them towards a red giant (one up close grows
 * as in sudden death), a button sets off a solar storm, another lets them go supernova. Seed, kind, look and giant stay in
 * the address to share.
 */

/** What the page calls each kind of sun. */
const SUN_NAMES: Record<SunKindId, string> = { yellow: 'Gelb', orange: 'Orange', red: 'Roter Zwerg', blue: 'Blauweiß', pulsing: 'Pulsierend' };
const SUN_NOTES: Record<SunKindId, string> = {
  yellow: 'Die Sonne wie bisher',
  orange: 'Kühler, bernsteinfarben, einzelne Flecken',
  red: 'Tiefrot, voller Flecken, flackert alle 7–13 s von selbst auf',
  blue: 'Heiß, feine schnelle Zellen, lange blasse Korona',
  pulsing: 'Atmet: hellt schnell auf, dunkelt langsam ab',
};
/** How long a storm the button sets off lasts here, before its clouds go. */
const STORM_LIFE = 7;

const params = new URLSearchParams(location.search);
let seed = Number(params.get('seed')) || 1;
let shown: Look | 'all' = (LOOKS as readonly string[]).includes(params.get('look') ?? '') ? (params.get('look') as Look) : 'all';
let focus: SunKindId | 'all' = (SUN_KINDS as readonly string[]).includes(params.get('kind') ?? '') ? (params.get('kind') as SunKindId) : 'all';
let giant = Math.min(1, Math.max(0, Number(params.get('giant')) || 0));
let nova = false;
let stormAt = -Infinity;
let clock = 0;

/** A seed of `kind`, the first one `rng` finds. */
function seedOf(kind: SunKindId, rng: () => number): number {
  for (let tries = 0; tries < 5000; tries++) {
    const s = Math.floor(rng() * 2 ** 31);
    if (sunKind({ seed: s }).id === kind) return s;
  }
  return 0;
}

/** Up close, a sun grows as in sudden death: from its own size through the red giant's three. */
function giantRadius(g: number): number {
  const radii = [SOLAR.SUN_RADIUS, ...SUDDEN_DEATH.GIANT_RADII];
  const at = g * (radii.length - 1);
  const i = Math.min(radii.length - 2, Math.floor(at));
  return radii[i] + (radii[i + 1] - radii[i]) * (at - i);
}

/** The suns on show: a row of every kind at the game's size, or one in the middle. */
function suns(): Planet[] {
  const rng = createRng(seed);
  const kinds = focus === 'all' ? SUN_KINDS : [focus];
  const gap = FIELD.width / kinds.length;
  return kinds.map((kind, column) => {
    const close = focus !== 'all';
    const sun: Planet = {
      x: close ? FIELD.width / 2 : gap * (column + 0.5),
      y: FIELD.height / 2,
      radius: close ? giantRadius(giant) : SOLAR.SUN_RADIUS,
      mass: SOLAR.SUN_MASS,
      seed: seedOf(kind, rng),
      style: 'star',
      tint: PLANET_TINTS.star[0],
      sun: true,
      giant,
    };
    if (nova) {
      sun.radius = SUDDEN_DEATH.NEUTRON_RADIUS;
      sun.giant = 0;
      sun.neutron = true;
    }
    return sun;
  });
}

function field(): Match {
  const match = aiming('solar', 11);
  match.world.planets = suns();
  match.world.nebulae = [];
  match.world.holes = [];
  match.world.wormholes = [];
  match.world.defenses = [];
  for (const ship of match.world.ships) ship.alive = false;
  return match;
}

/** A storm thrown out by every sun: clouds round it, as a Solar System's storm lays them. */
function storm(match: Match): void {
  const rng = createRng(Math.floor(clock * 1000) + 7);
  match.world.nebulae = match.world.planets.flatMap((sun) =>
    Array.from({ length: 3 }, (_, k) => {
      const a = (k / 3) * Math.PI * 2 + rng() * 1.2;
      const d = sun.radius + (focus === 'all' ? 70 : 150) + rng() * 40;
      return { x: sun.x + Math.cos(a) * d, y: sun.y + Math.sin(a) * d, radius: focus === 'all' ? 34 : 60, seed: Math.floor(rng() * 2 ** 31), storm: true };
    }),
  );
  match.world.version++;
  stormAt = clock;
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
main.className = 'wrap looks-gallery planet-gallery sun-gallery';
main.innerHTML = `
  <header>
    <h1>Sonnen</h1>
    <p class="lead">Jede Art von Sonne, die ein Sonnensystem haben kann, gewählt aus dem Samen der Sonne: ruhig, auf dem Weg zum Roten Riesen, im Sonnensturm oder als Supernova-Rest.</p>
  </header>
  <div class="tools">
    <div class="tabs" role="tablist" aria-label="Look">
      <button type="button" role="tab" data-look="all">Alle</button>
      ${LOOKS.map((look) => `<button type="button" role="tab" data-look="${look}">${t(lookLabelKey(look))}</button>`).join('')}
    </div>
    <div class="tabs" role="tablist" aria-label="Art">
      <button type="button" role="tab" data-kind="all">Alle Arten</button>
      ${SUN_KINDS.map((kind) => `<button type="button" role="tab" data-kind="${kind}">${SUN_NAMES[kind]}</button>`).join('')}
    </div>
  </div>
  <div class="tools">
    <label class="giant">Roter Riese <input id="giant" type="range" min="0" max="1" step="0.01" /> <output id="giant-value"></output></label>
    <button id="storm" type="button">Sonnensturm</button>
    <button id="nova" type="button" aria-pressed="false">Supernova</button>
    <button id="reroll" type="button">Neue Samen</button>
    <button id="pause" type="button">Animation pausieren</button>
    <output id="seed"></output>
  </div>
  <p class="note" id="note"></p>
  <main id="cards"></main>`;
document.body.append(main);

let match = field();
const host = main.querySelector('#cards')!;
const cards: Card[] = LOOKS.map((look) => {
  const figure = document.createElement('figure');
  figure.innerHTML = `<div class="stage"><canvas aria-label="Sonnen, ${t(lookLabelKey(look))}"></canvas><div class="labels" aria-hidden="true"></div></div><figcaption><b>${t(lookLabelKey(look))}</b><span class="rows"></span></figcaption>`;
  host.append(figure);
  const stage = figure.querySelector<HTMLElement>('.stage')!;
  const renderer = new Renderer(stage.querySelector('canvas')!, () => ({ width: Math.max(1, stage.clientWidth), height: Math.max(1, stage.clientHeight) }));
  return { look, figure, stage, labels: figure.querySelector<HTMLElement>('.labels')!, renderer, effects: new Effects(true, false, 'medium') };
});

/** Each sun's kind over it, and how bright it beats just now under it, placed where the renderer put it. */
function placeLabels(card: Card): void {
  const marks = match.world.planets.map((sun) => {
    const kind = sunKind(sun);
    const reach = nova ? 60 : Math.max(sun.radius * 2.4, 90);
    const top = card.renderer.project(sun.x, sun.y - reach, null, false);
    const under = card.renderer.project(sun.x, sun.y + reach, null, false);
    const beat = sunBeat(kind, sun.seed, clock);
    const pulse = nova ? '' : kind.id === 'pulsing' ? `Helligkeit ${beat.glow.toFixed(2)}` : kind.id === 'red' ? `Flackern ${beat.flare.toFixed(2)}` : '';
    return `<span class="size" style="left:${top.x}px;top:${top.y}px">${SUN_NAMES[kind.id]}</span>${pulse ? `<span class="beat" style="left:${under.x}px;top:${under.y}px">${pulse}</span>` : ''}`;
  });
  // The beat changes every frame; the rest only on a change.
  const html = marks.join('');
  if (card.labels.innerHTML !== html) card.labels.innerHTML = html;
}

function show(): void {
  main.querySelectorAll<HTMLButtonElement>('[data-look]').forEach((tab) => tab.setAttribute('aria-selected', String(tab.dataset.look === shown)));
  main.querySelectorAll<HTMLButtonElement>('[data-kind]').forEach((tab) => tab.setAttribute('aria-selected', String(tab.dataset.kind === focus)));
  for (const card of cards) card.figure.querySelector('.rows')!.textContent = focus === 'all' ? 'Alle Arten in Spielgröße' : `${SUN_NAMES[focus]}, Radius ${Math.round(match.world.planets[0].radius)}`;
  host.classList.toggle('single', shown !== 'all');
  for (const card of cards) card.figure.hidden = shown !== 'all' && card.look !== shown;
  main.querySelector<HTMLInputElement>('#giant')!.value = String(giant);
  main.querySelector<HTMLOutputElement>('#giant-value')!.value = giant.toFixed(2);
  main.querySelector<HTMLInputElement>('#giant')!.disabled = nova;
  main.querySelector('#nova')!.setAttribute('aria-pressed', String(nova));
  main.querySelector('#nova')!.textContent = nova ? 'Zurück zur Sonne' : 'Supernova';
  main.querySelector<HTMLOutputElement>('#seed')!.value = `Samen ${seed}`;
  main.querySelector('#note')!.textContent = nova
    ? 'Was die Supernova übrig lässt: ein Neutronenstern in seinem Nebel, gleich für jede Art.'
    : focus === 'all'
      ? 'Alle Arten in der Größe des Spiels; der Regler färbt sie zum Roten Riesen. Eine Art einzeln wächst auch, wie im Sudden Death.'
      : SUN_NOTES[focus];
  const url = new URL(location.href);
  url.searchParams.set('seed', String(seed));
  for (const [key, value, quiet] of [['look', shown, 'all'], ['kind', focus, 'all'], ['giant', String(giant), '0']] as const) {
    if (value === quiet) url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  }
  history.replaceState(null, '', url);
}

/** The suns again, as the controls now say; a storm still under way is laid round them again. */
function rebuild(): void {
  match = field();
  if (clock - stormAt < STORM_LIFE) storm(match);
  show();
}

main.querySelectorAll<HTMLButtonElement>('[data-look]').forEach((tab) =>
  tab.addEventListener('click', () => {
    shown = tab.dataset.look as Look | 'all';
    show();
  }),
);
main.querySelectorAll<HTMLButtonElement>('[data-kind]').forEach((tab) =>
  tab.addEventListener('click', () => {
    focus = tab.dataset.kind as SunKindId | 'all';
    stormAt = -Infinity;
    rebuild();
  }),
);
main.querySelector<HTMLInputElement>('#giant')!.addEventListener('input', (e) => {
  giant = Number((e.target as HTMLInputElement).value);
  // Only the sun changes: its seed and place stay, so it does not jump.
  for (const sun of match.world.planets) {
    sun.giant = giant;
    if (focus !== 'all') sun.radius = giantRadius(giant);
  }
  show();
});
main.querySelector('#storm')!.addEventListener('click', () => storm(match));
main.querySelector('#nova')!.addEventListener('click', () => {
  nova = !nova;
  stormAt = -Infinity;
  rebuild();
  // One blast from the middle: one from every sun at once would only white the field out.
  if (nova) for (const card of cards) card.effects.supernova(FIELD.width / 2, FIELD.height / 2, [], []);
});
main.querySelector('#reroll')!.addEventListener('click', () => {
  seed = 1 + Math.floor(Math.random() * 99999);
  stormAt = -Infinity;
  rebuild();
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
  clock += dt;
  // The storm's clouds go once it has blown out, and the sun calms.
  if (match.world.nebulae.length && clock - stormAt > STORM_LIFE) {
    match.world.nebulae = [];
    match.world.version++;
  }
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
