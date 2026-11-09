import '@fontsource/big-shoulders-stencil-display/800';
import '@fontsource/b612/400';
import '@fontsource/b612/700';
import '@fontsource/b612-mono/400';
import '@fontsource/b612-mono/700';
import './looks-gallery.css';
import { createMatch, type Match, type Scene as FieldScene } from '../game';
import { newPlayer } from '../game/match';
import type { Seat } from '../data/settings';
import { LOOKS as LOOK_IDS, lookLabelKey, setLook, type Look } from '../data/look';
import { t } from '../platform/i18n';
import { FIELD, NEBULA, SUDDEN_DEATH, WORMHOLE } from '../sim/config';
import type { Missile } from '../sim/physics';
import type { VolleyShot } from '../sim/volley';
import { POWER_UP_KINDS } from '../sim/powerups';
import { Effects } from '../render/effects';
import { painterFor } from '../render/looks';
import { forgedPlanetTraits } from '../render/looks/forged-planet';
import type { Planet, PlanetStyle } from '../sim/physics';
import { PLANET_TINTS } from '../sim/world';
import { shaderGpuSeconds } from '../render/looks/forged-gl';
import { holdShaderDetail } from '../render/looks/forged-sky';
import { Renderer } from '../render/renderer';
import { aiming, GALLERY_OPTIONS, gallerySettings, STYLE_NAMES } from './gallery-match';

/**
 * Dev-only page (`/dev/looks.html`, never part of a build): the real field renderer, once per look, on the same scene, so the
 * looks can be compared side by side and talked about. A new look shows up by itself (see `data/look.ts`); a new scene goes
 * into `SCENES`. "Pixel-Stand merken" and "Mit Stand vergleichen" catch a drawing change you did not mean to make: remember
 * the pixels of every scene in every look, change the code, compare.
 */

/** Every look, named as in the settings and described by its own painter: a new look shows up here without a change. */
const LOOKS: { look: Look; name: string; note: string }[] = LOOK_IDS.map((look) => ({ look, name: t(lookLabelKey(look)), note: painterFor(look).note }));

/** The seconds a scene's card has run, handed to the scene override of that match. */
const shotClock = new WeakMap<Match, { t: number }>();

/** The planets a match started with, for a scene where a wave takes them and the loop brings them back. */
const allPlanets = new WeakMap<Match, Planet[]>();

const SIX: Seat[] = ['human', 'human', 'human', 'human', 'human', 'human'];

interface Card {
  look: Look;
  canvas: HTMLCanvasElement;
  stage: HTMLElement;
  renderer: Renderer;
  effects: Effects;
  /** Seconds this card has been running, for what a scene loops. */
  clock: number;
  /** What the scene last triggered on this card. */
  step: number;
}

interface Scene {
  title: string;
  sub: string;
  build(): Match;
  /** How much faster than real time the scene's drawing runs (default 1), for what is slow, like a moon's orbit. */
  speed?: number;
  /** Called every frame for every card of the scene, before it draws. */
  tick?(match: Match, card: Card, dt: number): void;
}

/** The match's scene with some of it replaced, so a page can show a state the game would only reach mid-flight. */
function overrideScene(match: Match, extra: () => Partial<FieldScene>): void {
  const base = match.scene.bind(match);
  match.scene = () => ({ ...base(), ...extra() });
}

/** A flat polyline along a lifted arc from one point to another, as far as `progress` (0 → 1) of the way. */
function arc(x0: number, y0: number, x1: number, y1: number, lift: number, progress = 1, samples = 48): number[] {
  const points: number[] = [];
  const n = Math.max(2, Math.round(samples * progress));
  for (let i = 0; i <= n; i++) {
    const s = (i / n) * progress;
    points.push(x0 + (x1 - x0) * s, y0 + (y1 - y0) * s - lift * Math.sin(Math.PI * s));
  }
  return points;
}

/** A shot of the volley at the end of `trail`, flying the way the trail points. */
function flying(owner: number, trail: number[], extra: Partial<VolleyShot> = {}, missiles: Missile[] = []): VolleyShot {
  const n = trail.length;
  const [x, y] = [trail[n - 2], trail[n - 1]];
  const shot = { x, y, vx: (x - trail[n - 4]) * 60, vy: (y - trail[n - 3]) * 60, inField: true, end: null, missiles };
  return { owner, trail, shot: shot as unknown as VolleyShot['shot'], ...extra };
}

/** What a picked planet should have besides its map. */
interface Want {
  ring?: boolean;
  moon?: boolean;
  aurora?: boolean;
}
/** A planet in a planet scene: its style, which of the style's maps, and what else. */
type Pick = [PlanetStyle, number, Want];

const probe = (seed: number, style: PlanetStyle): Planet => ({ x: 0, y: 0, radius: 30, mass: 1, seed, style, tint: '#ffffff' });

/** How many maps a style has (a tidally locked world's among them, last). */
function maps(style: PlanetStyle): number {
  let n = 0;
  for (let seed = 1; seed < 3000; seed++) n = Math.max(n, forgedPlanetTraits(probe(seed, style)).index + 1);
  return n;
}

/** Seeds already in a scene: the renderer keeps a planet's sprite by its seed, so no two planets of the galleries may share one. */
const taken = new Set<number>();

/** The first free seed whose planet wears map `index` and has what is wanted (and nothing of the rest it is not asked for). */
function find(style: PlanetStyle, index: number, want: Want): number {
  let fallback = 0;
  for (let seed = 1; seed < 20000; seed++) {
    if (taken.has(seed)) continue;
    const t = forgedPlanetTraits(probe(seed, style));
    if (t.index !== index) continue;
    fallback ||= seed;
    if (!!want.ring === t.ringed && !!want.moon === t.moon && (style !== 'gas' || !!want.aurora === t.aurora)) return seed;
  }
  return fallback;
}

/** Every map of `style` up to `count` (all of them when left out), each with what `want` gives it. */
const all = (style: PlanetStyle, want: (i: number) => Want = () => ({}), count = maps(style)): Pick[] => Array.from({ length: count }, (_, i) => [style, i, want(i)]);

/**
 * A field of planets, a row each of up to eight, that shows the maps of some styles and what a seed may add to them: rings, a
 * moon (and so its shadow on the planet, and the planet's on the moon), an aurora over a gas giant's poles. The seeds are
 * searched for in the forged look's own rolls, so this stays true when the rolls change. Lightning (gas), clouds and their
 * shadows, city lights and what happens on a surface (meteors, volcanoes, geysers, dust, hurricanes, glints, trains of
 * light) come with the maps.
 */
function planetField(rows: Pick[][]): { planets: Planet[]; rows: string[] } {
  const planets: Planet[] = [];
  const names: string[] = [];
  rows.forEach((picks, r) => {
    const label: string[] = [];
    picks.forEach(([style, index, want], c) => {
      const seed = find(style, index, want);
      taken.add(seed);
      const probed = probe(seed, style);
      const t = forgedPlanetTraits(probed);
      const tint = PLANET_TINTS[style][seed % PLANET_TINTS[style].length];
      planets.push({ ...probed, x: 85 + c * 158, y: 110 + r * 190, mass: 30 ** 3, tint });
      label.push([`${STYLE_NAMES[style]} ${t.map}`, t.locked && 'gebunden', t.ringed && 'Ringe', t.moon && 'Mond', t.aurora && 'Polarlicht', t.settled && 'Stadtlichter'].filter(Boolean).join(' + '));
    });
    names.push(`Reihe ${r + 1}: ${label.join(' · ')}`);
  });
  return { planets, rows: names };
}

/** The first four styles; their tidally locked maps are in `NEW_PLANETS`. */
const PLANETS = planetField([
  [...all('rocky'), ['rocky', 0, { moon: true }], ['rocky', 2, { moon: true }], ['rocky', 4, { moon: true }]],
  [...all('gas', (i) => ({ aurora: true, ring: i % 2 === 0 })), ['gas', 5, { ring: true }], ['gas', 3, { aurora: true, moon: true }]],
  [...all('ice', () => ({}), maps('ice') - 1), ['ice', 2, { ring: true }], ['ice', 0, { moon: true }]],
  [...all('lava', () => ({}), maps('lava') - 1), ['lava', 0, { moon: true }], ['lava', 1, { ring: true }], ['rocky', 0, { ring: true }]],
]);

/** The styles after them, two to a row, and the tidally locked lava and ice worlds. */
const NEW_PLANETS = planetField([
  [...all('ocean'), ['ocean', 0, { moon: true }], ...all('desert'), ['desert', 1, { ring: true }]],
  [...all('acid'), ['acid', 0, { moon: true }], ...all('carbon'), ['carbon', 0, { ring: true }]],
  [...all('crystal'), ['crystal', 1, { ring: true }], ...all('living'), ['living', 0, { moon: true }]],
  [...all('machine'), ['machine', 0, { ring: true }], ['lava', maps('lava') - 1, {}], ['lava', maps('lava') - 1, { moon: true }], ['ice', maps('ice') - 1, {}], ['ice', maps('ice') - 1, { ring: true }]],
]);

/** A field of nothing but `planets`. */
function planetScene(planets: Planet[]): Match {
  const match = aiming('classic', 11);
  match.world.planets.length = 0;
  match.world.planets.push(...planets.map((p) => ({ ...p })));
  for (const ship of match.world.ships) ship.alive = false;
  return match;
}

const EFFECTS: ((e: Effects, m: Match) => void)[] = [
  (e, m) => e.explode(m.world.ships[1].x, m.world.ships[1].y, m.players[1].color),
  (e, m) => e.impact(FIELD.width / 2, FIELD.height / 2, m.players[0].color, 40, -20),
  (e, m) => e.clash(FIELD.width / 2, FIELD.height / 2, m.players[0].color, m.players[1].color),
  (e, m) => e.shieldHit(m.world.ships[0].x, m.world.ships[0].y, '#4dffb0'),
  (e, m) => e.teleport(m.world.ships[2].x, m.world.ships[2].y, FIELD.width / 2, FIELD.height / 2, m.players[2].color),
  (e) => e.split(FIELD.width / 2, FIELD.height / 2, '#ffd21f'),
  (e, m) => {
    const p = m.world.planets[0];
    if (p) e.shatter(p.x, p.y, p.tint, p.radius);
  },
  (e, m) => e.muzzle(m.world.ships[0].x, m.world.ships[0].y, 0, m.players[0].color),
];

const SCENES: Scene[] = [
  {
    title: 'Spielfeld',
    sub: 'Klassisch: Schiffe, Planeten, Höhenlinien, Auswahl des Schiffs am Zug und das Sonar zu Rundenbeginn (Schleife)',
    build: () => aiming('classic', 11),
    tick: (match, card) => {
      match.phaseTime = card.clock % 4;
    },
  },
  {
    title: 'Planeten',
    sub: `Jede Karte von Fels, Gas, Eis und Lava, dazu Ringe, Monde mit Schatten, Polarlicht, Blitze, Wolkenschatten, Stadtlichter, Meteore, Vulkane und Geysire; vierfache Geschwindigkeit. ${PLANETS.rows.join('. ')}`,
    speed: 4,
    build: () => planetScene(PLANETS.planets),
  },
  {
    title: 'Neue Welten',
    sub: `Ozean, Wüste, Säure, Kohlenstoff, Kristall, Lebend und Maschine, dazu die gebundenen Lava- und Eiswelten: Hurrikane, Staubstürme, Glitzern, Leuchten bei Nacht, Lichterzüge, Hitzeflimmern; vierfache Geschwindigkeit. ${NEW_PLANETS.rows.join('. ')}`,
    speed: 4,
    build: () => planetScene(NEW_PLANETS.planets),
  },
  {
    title: 'Sonnensystem',
    sub: 'Die Sonne, Planeten auf Bahnen',
    build: () => aiming('solar', 7, { maxPlanets: 6 }),
  },
  {
    title: 'Ereignishorizont',
    sub: 'Das schwarze Loch mit Scheibe, Photonenring und Linse',
    build: () => {
      const match = aiming('horizon', 5);
      if (!match.world.holes.length) match.world.holes.push({ x: FIELD.width / 2, y: FIELD.height / 2, radius: 24, mass: 1 });
      return match;
    },
  },
  {
    title: 'Schwarze Löcher in allen Größen',
    sub: 'Vom Power-up-Loch (18) bis zum späten Ereignishorizont (110): die Scheibe darf beim Vergrößern nicht weich werden',
    build: () => {
      const match = aiming('horizon', 5);
      match.world.planets.length = 0;
      match.world.holes.length = 0;
      const sizes: [number, number, number][] = [
        [18, 110, 190],
        [30, 300, 190],
        [48, 560, 190],
        [72, 930, 190],
        [110, 360, 610],
      ];
      for (const [radius, x, y] of sizes) match.world.holes.push({ x, y, radius, mass: 1 });
      for (const ship of match.world.ships) ship.alive = false;
      return match;
    },
  },
  {
    title: 'Power-ups',
    sub: 'Alle zwölf auf dem Feld, dazu ein Schild und ein gehaltenes Symbol',
    build: () => {
      const match = aiming('classic', 3, { powerUps: true });
      match.world.planets.length = 0;
      match.pickups = POWER_UP_KINDS.map((kind, i) => ({ id: i + 1, kind, x: 200 + (i % 6) * 176, y: 290 + Math.floor(i / 6) * 150, born: 0 }));
      match.players[0].powerUp = 'shield';
      match.players[1].powerUp = 'preview';
      return match;
    },
  },
  {
    title: 'Effekte',
    sub: 'Explosion, Einschlag, Zusammenprall, Schildtreffer, Teleport, Splitter, Planet zerplatzt, Mündungsfeuer (Schleife)',
    build: () => aiming('classic', 11),
    tick: (match, card) => {
      const step = Math.floor(card.clock / 2.6);
      if (step === card.step) return;
      card.step = step;
      EFFECTS[step % EFFECTS.length](card.effects, match);
    },
  },
  {
    title: 'Schüsse',
    sub: 'Normal, Plasma, panzerbrechend, ein Schuss mit Splitter bereit; dazu fertige Spuren (Schleife)',
    build: () => {
      const match = aiming('classic', 11, { powerUps: true });
      match.pickups = [];
      match.phase = 'flying';
      match.players[2].armed = true;
      match.players[2].powerUp = 'splitter';
      const done = [
        { owner: 0, points: arc(120, 640, 640, 560, 260), volley: 0, at: 0 },
        { owner: 1, points: arc(1160, 160, 620, 340, 200), volley: 0, at: 0 },
      ];
      const clock = { t: 0 };
      shotClock.set(match, clock);
      overrideScene(match, () => {
        const p = (clock.t % 4) / 4;
        return {
          trails: done,
          volley: {
            shots: [
              flying(0, arc(120, 700, 700, 380, 300, p)),
              flying(1, arc(1160, 700, 560, 300, 260, p), { plasma: true }),
              flying(2, arc(160, 120, 1000, 260, 160, p), { pierce: true }),
              flying(2, arc(160, 120, 1000, 420, 160, p * 0.8)),
            ],
          } as unknown as FieldScene['volley'],
        };
      });
      return match;
    },
    tick: (match, card) => {
      const clock = shotClock.get(match);
      if (clock) clock.t = card.clock;
    },
  },
  {
    title: 'Wirkung der Power-ups',
    sub: 'Schild, Antigravitation, Nebel, Wormhole und Planetenabwehr mit Rakete, so wie sie auf dem Feld stehen',
    build: () => {
      const match = aiming('classic', 11, { powerUps: true });
      match.pickups = [];
      const world = match.world;
      match.players[0].powerUp = 'shield';
      const [rock, home] = world.planets;
      if (rock) rock.reversed = true;
      if (home) {
        world.defenses.push({ x: home.x, y: home.y - home.radius, radius: home.radius * 4, planet: home.seed, owner: 0, protects: [0] });
      }
      world.nebulae.push({ x: 930, y: 610, radius: NEBULA.RADIUS, seed: 3 });
      world.wormholes.push({ id: 0, ax: 260, ay: 640, bx: 560, by: 130, radius: WORMHOLE.RADIUS });
      world.wormholes.push({ id: 1, ax: 1120, ay: 220, bx: 760, by: 420, radius: WORMHOLE.RADIUS });
      const clock = { t: 0 };
      shotClock.set(match, clock);
      overrideScene(match, () => {
        const d = world.defenses[0];
        if (!d) return {};
        const p = 0.35 + 0.4 * ((clock.t % 3) / 3);
        const trail = arc(d.x - d.radius * 1.4, d.y - d.radius * 0.1, d.x + d.radius * 0.5, d.y - d.radius * 0.6, 40, p);
        const [sx, sy] = [trail[trail.length - 2], trail[trail.length - 1]];
        const reach = Math.min(0.9, (clock.t % 3) / 3 + 0.2);
        const mx = d.x + (sx - d.x) * reach;
        const my = d.y + (sy - d.y) * reach;
        const heading = Math.atan2(sy - d.y, sx - d.x);
        const missile: Missile = { defense: 0, x: mx, y: my, heading, speed: 300, age: 0.4, roll: 0.5, chasing: true, trail: [d.x, d.y, (d.x + mx) / 2, (d.y + my) / 2, mx, my] };
        return { volley: { shots: [flying(1, trail, {}, [missile])] } as unknown as FieldScene['volley'] };
      });
      return match;
    },
    tick: (match, card) => {
      const clock = shotClock.get(match);
      if (clock) clock.t = card.clock;
    },
  },
  {
    title: 'Zielhilfen',
    sub: 'Zielvektor, Vorschau-Pfad, Schussuhr, gesperrtes Schiff, Schonfrist, Sudden-Death-Zug, Schuss außerhalb des Felds',
    build: () => {
      const match = aiming('classic', 11, { powerUps: true });
      match.pickups = [];
      match.players[0].angle = 20;
      match.players[0].power = 70;
      match.players[1].locked = true;
      match.world.ships[2].pull = 6;
      Object.defineProperty(match, 'salvo', { get: () => true });
      Object.defineProperty(match, 'shotClock', { get: () => 11 });
      match.sparedFor = () => [2];
      const ship = match.world.ships[0];
      const preview = arc(ship.x, ship.y, ship.x + 520, ship.y - 120, 220, 1, 40);
      overrideScene(match, () => ({
        preview,
        volley: { shots: [{ owner: 1, trail: [1200, 400, 1330, 360], shot: { x: 1330, y: 360, vx: 80, vy: -30, inField: false, end: null, missiles: [] } }] } as unknown as FieldScene['volley'],
      }));
      return match;
    },
  },
  {
    title: 'Ziele',
    sub: 'Die Zielscheiben der Tagesaufgabe: das eigene Schiff und fünf stillstehende Drohnen, so wie das Spiel sie anlegt (rot, mit Trefferring)',
    build: () => {
      const match = createMatch('classic', gallerySettings(SIX), { seats: SIX, names: ['Ash', 'Bo', 'Cy', 'Di', 'Ed', 'Flo'], seed: 11 });
      match.phase = 'aiming';
      // As `ChallengeMatch` does: ship 0 is the pilot, every other ship a target drone.
      match.players = match.players.map((p, id) => (id === 0 ? p : newPlayer(id, id, 'easy', null, true)));
      return match;
    },
  },
  {
    title: 'Loop',
    sub: 'Hinter dem Rand öffnet sich ein Tor im Wurmloch-Stil der Look, wo der Schuss hindurchgeht; gegenüber öffnet sich das zweite. Der Schweif reißt am Sprung ab, es blitzt keine Linie über das Feld',
    build: () => {
      const match = aiming('classic', 11, { edges: 'loop', maxPlanets: 3 });
      overrideScene(match, () => ({
        volley: {
          shots: [
            // Leaving to the right, halfway between the edge and its gate.
            flying(0, [1150, 300, 1200, 303, 1240, 306, 1280, 308, 1300, 309]),
            // Coming out of the left gate: the trail is the other side's, so it breaks at the jump.
            flying(1, [1210, 560, 1250, 556, 1285, 551, -24, 548, -16, 547, -9, 546]),
            // Through the top gate and on out of the bottom one.
            flying(2, [640, 60, 640, 20, 640, -18, 640, 822, 640, 814]),
          ],
        } as unknown as FieldScene['volley'],
      }));
      return match;
    },
  },
  {
    title: 'Sonnensturm',
    sub: 'Der Ausbruch der Sonne: Plasmawolken fliegen hinaus, Schockringe, Funken um einen Schuss im Sturm (Schleife)',
    build: () => {
      const match = aiming('solar', 7, { maxPlanets: 6 });
      const sun = match.world.planets.find((p) => p.sun);
      if (sun) {
        for (const [i, a] of [0.4, 2.3, 4.2].entries()) {
          match.world.nebulae.push({ x: sun.x + Math.cos(a) * 190, y: sun.y + Math.sin(a) * 190, radius: 90, seed: 40 + i, storm: true });
        }
      }
      return match;
    },
    tick: (match, card) => {
      // The renderer starts a storm's clock when it first sees its clouds: a new loop starts it over.
      const loop = Math.floor(card.clock / 8);
      if (loop === card.step) return;
      card.step = loop;
      const sun = match.world.planets.find((p) => p.sun);
      if (!sun) return;
      match.world.nebulae.forEach((n, i) => (n.seed = loop * 7 + 40 + i));
    },
  },
  {
    title: 'Supernova',
    sub: 'Roter Riese, Explosion, Welle zerlegt die Planeten, Neutronenstern im Nebel (Schleife)',
    build: () => {
      const match = aiming('solar', 7, { maxPlanets: 6 });
      allPlanets.set(match, [...match.world.planets]);
      return match;
    },
    tick: (match, card) => {
      const sun = match.world.planets.find((p) => p.sun);
      if (!sun) return;
      const world = match.world;
      const t = card.clock % 14;
      sun.giant = t < 4 ? t / 4 : 0;
      if (t < 4) {
        sun.neutron = false;
        card.step = -1;
        // A new loop: the planets the last wave took are back.
        const planets = allPlanets.get(match);
        if (planets && world.planets.length !== planets.length) {
          world.planets = [...planets];
          world.version++;
        }
      } else {
        if (card.step !== 1) {
          card.step = 1;
          sun.neutron = true;
          const doomed = world.ships.map((s, i) => ({ x: s.x, y: s.y, angle: match.players[i].angle, color: match.players[i].color }));
          const rocks = world.planets.filter((p) => !p.sun).map((p) => ({ x: p.x, y: p.y, radius: p.radius, color: p.tint }));
          card.effects.supernova(sun.x, sun.y, doomed.slice(0, 3), rocks);
        }
        // The shockwave takes each planet as it gets there, as in the game (`SolarMatch.shatter`).
        const front = SUDDEN_DEATH.NOVA_SPEED * (t - 4);
        const kept = world.planets.filter((p) => p.sun || Math.hypot(p.x - sun.x, p.y - sun.y) > front);
        if (kept.length !== world.planets.length) {
          world.planets = kept;
          world.version++;
        }
      }
    },
  },
  {
    title: 'Zielen',
    sub: 'Was beim Platzieren zu sehen ist: Teleport, Schwarzes Loch, Nebel, Wormhole, Planetenkiller, Antigravitation, Abwehr (Schleife)',
    build: () => {
      const match = aiming('classic', 11, { powerUps: true });
      match.pickups = [];
      const clock = { t: 0 };
      shotClock.set(match, clock);
      const [rock, home] = match.world.planets;
      overrideScene(match, () => {
        const centre = { x: FIELD.width / 2, y: FIELD.height / 2 };
        const rim = home ? { x: home.x, y: home.y - home.radius } : centre;
        const placements = [
          { owner: 0, kind: 'teleport', target: centre },
          { owner: 0, kind: 'blackhole', target: centre },
          { owner: 0, kind: 'nebula', target: centre },
          { owner: 0, kind: 'wormhole', target: { x: 900, y: 560 }, first: { x: 380, y: 300 } },
          { owner: 0, kind: 'planetkiller', target: rock ? { x: rock.x, y: rock.y } : null },
          { owner: 0, kind: 'antigravity', target: rock ? { x: rock.x, y: rock.y } : null },
          { owner: 0, kind: 'defense', target: rim },
        ] as const;
        return { placement: { ...placements[Math.floor(clock.t / 2.6) % placements.length] } as unknown as FieldScene['placement'] };
      });
      return match;
    },
    tick: (match, card) => {
      const clock = shotClock.get(match);
      if (clock) clock.t = card.clock;
    },
  },
  {
    title: 'Instabil · Warnpuls',
    sub: 'Ein, drei und fünf Treffer: Je näher am Zerbrechen, desto schneller der dunkelrote Puls. Holo-Linien glühen rot.',
    build: () => {
      const match = aiming('classic', 17, { anomalies: ['unstable', 'pinball'] });
      match.world.planets = [1, 3, 5].map((hits, i) => ({
        x: 300 + i * 340, y: 400, radius: 72, mass: 72 ** 3, seed: 1701 + i,
        style: 'rocky' as const, tint: '#a89880',
        fractures: Array.from({ length: hits }, (_, j) => -.8 + j * 2.4),
      }));
      return match;
    },
  },
  {
    title: 'Weißes Loch',
    sub: 'Anomalie Weißes Loch: der Horizont leuchtet, Licht läuft aus ihm heraus (Forged: mit dem Loch geraytract); beim Hineinfliegen schließt sich ein Ring und der Kern blitzt, am Ausgang öffnet sich eine Fontäne und der Schuss glüht weiß (Schleife, zwei Schüsse versetzt)',
    build: () => {
      const match = aiming('horizon', 5, { anomalies: ['whiteHole'] });
      const world = match.world;
      world.holes.length = 0;
      world.holes.push({ x: FIELD.width / 2, y: FIELD.height / 2, radius: 34, mass: 1 });
      const hole = world.holes[0];
      const clock = { t: 0 };
      shotClock.set(match, clock);
      const PERIOD = 3.2;
      const IN = 1.3;
      const SPEED = 320;
      /** One shot's loop: flying into the hole, then out of `exit` at angle `heading`, `offset` seconds behind the clock. */
      const loop = (owner: number, from: [number, number], lift: number, exit: { x: number; y: number; out: number; heading: number }, offset: number): unknown => {
        const t = (clock.t + offset) % PERIOD;
        const going = arc(from[0], from[1], hole.x, hole.y, lift, Math.min(1, t / IN));
        if (t < IN) return flying(owner, going);
        const out = t - IN;
        const trail = [...going];
        for (let s = 0; s <= out + 1e-6; s += 1 / 30) trail.push(exit.x + Math.cos(exit.heading) * SPEED * s, exit.y + Math.sin(exit.heading) * SPEED * s);
        const n = trail.length;
        const shot = { x: trail[n - 2], y: trail[n - 1], vx: Math.cos(exit.heading) * SPEED, vy: Math.sin(exit.heading) * SPEED, inField: true, end: null, missiles: [], time: t, whiteExit: { x: exit.x, y: exit.y, out: exit.out, at: IN, hole: 0 } };
        return { owner, trail, shot };
      };
      overrideScene(match, () => ({
        volley: {
          shots: [
            loop(0, [180, 680], 260, { x: 0.5, y: 250, out: Math.PI, heading: -0.25 }, 0),
            loop(1, [1110, 640], 180, { x: 820, y: 0.5, out: -Math.PI / 2, heading: Math.PI / 2 + 0.35 }, PERIOD / 2),
          ],
        } as unknown as FieldScene['volley'],
      }));
      match.phase = 'flying';
      return match;
    },
    tick: (match, card) => {
      const clock = shotClock.get(match);
      if (clock) clock.t = card.clock;
    },
  },
];

const main = document.createElement('div');
main.className = 'wrap looks-gallery';
main.innerHTML = `
  <header>
    <h1>Look<br>Galerie</h1>
    <ul class="legend">${LOOKS.map((l) => `<li><b>${l.name}</b><span>${l.note}</span></li>`).join('')}</ul>
  </header>
  <div class="tools">
    <button id="pause" type="button">Animation pausieren</button>
    <button id="remember" type="button">Pixel-Stand merken</button>
    <button id="compare" type="button">Mit Stand vergleichen</button>
    <output id="result"></output>
    <output id="cost" title="Mittel über etwa eine Sekunde: Zeichenzeit (CPU) aller sichtbaren Karten, GPU-Zeit der Shader (nur mit Zeitmesser), Abstand der Bilder"></output>
  </div>
  <main id="scenes"></main>`;
document.body.append(main);

const cards: { scene: Scene; match: Match; card: Card }[] = [];
const host = main.querySelector('#scenes')!;
for (const scene of SCENES) {
  const match = scene.build();
  const section = document.createElement('section');
  section.innerHTML = `<h2>${scene.title}<small>${scene.sub}</small><button class="size" type="button">Groß</button></h2><div class="row"></div>`;
  const row = section.querySelector('.row')!;
  // One card per line, to look at the details of a scene.
  const size = section.querySelector<HTMLButtonElement>('.size')!;
  size.addEventListener('click', () => {
    const big = row.classList.toggle('big');
    size.textContent = big ? 'Klein' : 'Groß';
  });
  for (const { look, name } of LOOKS) {
    const figure = document.createElement('figure');
    figure.innerHTML = `<div class="stage"><canvas aria-label="${scene.title}, ${name}"></canvas></div><figcaption><b>${scene.title}</b><span>${name}</span></figcaption>`;
    row.append(figure);
    const stage = figure.querySelector<HTMLElement>('.stage')!;
    const canvas = stage.querySelector('canvas')!;
    const renderer = new Renderer(canvas, () => ({ width: Math.max(1, stage.clientWidth), height: Math.max(1, stage.clientHeight) }));
    cards.push({ scene, match, card: { look, canvas, stage, renderer, effects: new Effects(true, false, 'medium'), clock: 0, step: -1 } });
  }
  host.append(section);
}

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

const visible = new Set<Element>();
const observer = new IntersectionObserver((entries) => {
  for (const e of entries) e.isIntersecting ? visible.add(e.target) : visible.delete(e.target);
});
for (const { card } of cards) observer.observe(card.stage);

// A cheap readout, so a regression shows without a profiler: smoothed over about a second.
const cost = main.querySelector<HTMLOutputElement>('#cost')!;
const smooth = { cpu: 0, gpu: 0, gap: 0 };
let costShown = 0;
const ease = (was: number, now: number): number => (was ? was + (now - was) * 0.05 : now);

let last = performance.now();
function frame(now: number): void {
  const dt = paused ? 0 : Math.min(0.05, (now - last) / 1000);
  smooth.gap = ease(smooth.gap, Math.min(250, now - last));
  last = now;
  const began = performance.now();
  for (const { scene, match, card } of cards) {
    if (!visible.has(card.stage)) continue;
    card.clock += dt;
    scene.tick?.(match, card, dt);
    card.effects.update(dt, match.world);
    setLook(card.look);
    card.renderer.draw(match, card.effects, GALLERY_OPTIONS, dt * (scene.speed ?? 1));
  }
  smooth.cpu = ease(smooth.cpu, performance.now() - began);
  smooth.gpu = ease(smooth.gpu, shaderGpuSeconds() * 1000);
  if (now - costShown > 500) {
    costShown = now;
    cost.value = `CPU ${smooth.cpu.toFixed(1)} ms · GPU ${smooth.gpu ? `${smooth.gpu.toFixed(1)} ms` : '–'} · Abstand ${smooth.gap.toFixed(1)} ms`;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ------------------------------------------------------------ pixel snapshot ----

const SNAPSHOT_KEY = 'looks-gallery-pixels';
/** Moments of each scene that are hashed: the scenes loop, so a few spread out catch what changes over time. */
const SNAPSHOT_TIMES = [0.4, 2.2, 5.5];

/** A deterministic random generator, so the particles of a scene are the same every time it is hashed. */
function seeded(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A hash of every scene in every look at a few fixed moments, drawn fresh with seeded randomness. */
async function pixelHashes(): Promise<Record<string, number>> {
  paused = true;
  holdShaderDetail(true);
  const realRandom = Math.random;
  await document.fonts.ready;
  const out: Record<string, number> = {};
  // The first pass only starts the images that load on first use; the second one is hashed.
  for (const pass of ['warm', 'real']) {
    for (const { scene, match, card } of cards) {
      card.clock = 0;
      card.step = -1;
      card.effects = new Effects(true, false, 'medium');
      card.renderer = new Renderer(card.canvas, () => ({ width: Math.max(1, card.stage.clientWidth), height: Math.max(1, card.stage.clientHeight) }));
      let at = 0;
      for (const time of SNAPSHOT_TIMES) {
        Math.random = seeded(1234);
        card.clock = time;
        scene.tick?.(match, card, 0);
        card.effects.update(0.016, match.world);
        setLook(card.look);
        card.renderer.draw(match, card.effects, GALLERY_OPTIONS, time - at);
        at = time;
        if (pass === 'real') {
          const data = card.canvas.getContext('2d')!.getImageData(0, 0, card.canvas.width, card.canvas.height).data;
          let hash = 2166136261;
          for (let i = 0; i < data.length; i += 3) hash = Math.imul(hash ^ data[i], 16777619);
          out[`${scene.title} · ${card.look} · ${time}s`] = hash >>> 0;
        }
      }
    }
    if (pass === 'warm') await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  Math.random = realRandom;
  holdShaderDetail(false);
  return out;
}

const result = main.querySelector<HTMLOutputElement>('#result')!;
const busy = (on: boolean): void => {
  for (const id of ['#remember', '#compare']) main.querySelector<HTMLButtonElement>(id)!.disabled = on;
  if (on) result.textContent = 'Rechne …';
};

main.querySelector('#remember')!.addEventListener('click', async () => {
  busy(true);
  const hashes = await pixelHashes();
  try {
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(hashes));
    result.textContent = `${Object.keys(hashes).length} Bilder gemerkt.`;
  } catch {
    result.textContent = 'Konnte den Stand nicht speichern.';
  }
  busy(false);
});

main.querySelector('#compare')!.addEventListener('click', async () => {
  let before: Record<string, number> | null = null;
  try {
    before = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) ?? 'null');
  } catch {
    before = null;
  }
  if (!before) {
    result.textContent = 'Noch kein Stand gemerkt.';
    return;
  }
  busy(true);
  const now = await pixelHashes();
  const changed = Object.keys({ ...before, ...now }).filter((key) => before![key] !== now[key]);
  result.textContent = changed.length ? `${changed.length} von ${Object.keys(now).length} Bildern anders: ${changed.join(', ')}` : `Alle ${Object.keys(now).length} Bilder gleich.`;
  busy(false);
});
