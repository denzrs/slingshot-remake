import type { Look } from '../../data/look';
import type { BlackHole, Planet } from '../../sim/physics';
import type { PowerUpKind } from '../../sim/powerups';
import type { Wormhole } from '../../sim/physics';
import type { BlackHoleStyle } from '../blackhole';
import type { DefenseStyle, DefenseView, InterceptionStyle } from '../defense';
import type { Nova } from '../effects';
import type { PlanetSprite } from '../planet-common';
import type { PortalStyle } from '../wormhole';

/**
 * A look is how every element of the playing field is drawn. The renderer asks the chosen painter for each element and
 * never asks which look it is, so a look lives in one file (`classic.ts`, `luminous.ts`, `forged.ts`, `holo.ts`) and
 * the renderer does not change when one is added or adjusted.
 *
 * To add an element: put it here, draw it in `classic.ts` (the engraved plan, which every other look falls back on),
 * then override it in the looks that draw it differently. To add a look: write a file that builds on another painter
 * (`engraved(...)` in `classic.ts`, then spread what it extends) and list it in `index.ts`.
 *
 * Every method draws in field units in the caller's frame, as the function it replaced did.
 */
export interface LookPainter {
  readonly id: Look;
  /** One line on what the look is, for the gallery. */
  readonly note: string;
  /** A planet's sprite is painted lit from one side, and turned in the Solar System so that side faces the sun it orbits; false for a look whose planets are not lit from one side (the wireframe). */
  readonly planetsTurnToSun: boolean;

  /** A planet's sprite at `ps` device pixels per field unit. */
  planet(p: Planet, ps: number): PlanetSprite;
  sun(ctx: CanvasRenderingContext2D, sun: Planet, time: number, alpha: number, flare: number): void;
  /** What a supernova leaves, `age` seconds after it. */
  neutronStar(ctx: CanvasRenderingContext2D, star: Planet, time: number, age: number, alpha: number): void;
  blackHole(ctx: CanvasRenderingContext2D, hole: BlackHole, time: number): void;
  /** Both portals of a wormhole and the thread between them; `eaten` (0 → 1) is how far a black hole has taken it. */
  wormhole(ctx: CanvasRenderingContext2D, ax: number, ay: number, bx: number, by: number, radius: number, time: number, id: number, eaten: number): void;
  /** One portal, facing `facing`. */
  portal(ctx: CanvasRenderingContext2D, x: number, y: number, facing: number, radius: number, color: string, time: number, alpha: number, phase: number, size: number): void;
  nebula(ctx: CanvasRenderingContext2D, n: { x: number; y: number; radius: number; seed: number }, color: string, time: number): void;
  /** One cloud of the sun's storm, `age` seconds after the storm broke out; `dissolve` (0 → 1) is it thinning away. */
  stormCloud(ctx: CanvasRenderingContext2D, cloud: { x: number; y: number; radius: number; seed: number }, sun: { x: number; y: number }, age: number, time: number, dissolve: number): void;
  stormBurst(ctx: CanvasRenderingContext2D, sun: { x: number; y: number; radius: number }, age: number): void;
  /** Arcs jumping round a shot while it is in the storm. */
  stormSparks(ctx: CanvasRenderingContext2D, x: number, y: number, time: number, seed: number): void;
  /** A planetary defense: its area, its turret and, with `labels`, the chance of a hit in each zone. `hideRock` draws the rings whole. */
  defense(ctx: CanvasRenderingContext2D, d: { x: number; y: number; radius: number }, planet: Planet | null, color: string, time: number, alpha: number, view: DefenseView | undefined, labels: boolean, hideRock: boolean): void;
  /** The defense's missiles and the brackets on the shots they chase, drawn over the shots. */
  interception(ctx: CanvasRenderingContext2D, color: string, view: DefenseView, time: number, rocks: readonly Planet[]): void;

  /** A ship in its own frame: centred, nose along +x. `thrust` is 0 (idle) to 1 (aiming); `phase` keeps ships from flickering in step. */
  ship(ctx: CanvasRenderingContext2D, color: string, time: number, thrust: number, phase: number): void;
  /** The mark on the ship whose turn it is; the frame is the ship's middle. */
  selection(ctx: CanvasRenderingContext2D, color: string, time: number): void;
  /** The shot clock: an arc round the ship at (x, y) that runs down; `clock` is the seconds left. */
  shotClock(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, clock: number): void;
  /** Rings that close in on a ship so the eye finds it when a round begins, `age` seconds into the ping. */
  locatePing(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, age: number): void;
  /** Sudden death: rings that keep closing in on a ship, wider the harder it pulls its enemies' shots (`strength` 0 → 1, out to `reach`). */
  pull(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, time: number, strength: number, reach: number): void;
  /** The aim: a line out from the ship with an arrowhead. `style` is how it is shown: the aiming ship's own, another's locked in, or a CPU's. */
  aimVector(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, power: number, color: string, style: AimStyle, time: number): void;
  /** A ship that has locked in its shot: a ring round it, drawn with the stroke the caller has set. */
  lockedRing(ctx: CanvasRenderingContext2D, x: number, y: number): void;
  /** A ship the neighbour grace period covers: a ring turning round it. */
  sparedRing(ctx: CanvasRenderingContext2D, x: number, y: number, time: number): void;
  /** The target of a daily challenge. */
  target(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, time: number): void;
  /** The symbol of the power-up a ship holds, small above it. */
  heldSymbol(ctx: CanvasRenderingContext2D, kind: PowerUpKind, color: string, x: number, y: number): void;
  /** A shield: a bubble round the ship at (x, y). */
  shield(ctx: CanvasRenderingContext2D, x: number, y: number, pulse: number, time: number): void;
  /** The chevron on the field's edge pointing at a shot that has left it, at the frame's origin, turned by `angle`. */
  offscreenArrow(ctx: CanvasRenderingContext2D, color: string, danger: boolean, angle: number): void;

  /** A finished trail. `rank` 0 is the newest flight, later ranks step back; `fade` (0 → 1) is how much of it is left. */
  trail(ctx: CanvasRenderingContext2D, points: number[], wormholes: readonly Wormhole[], color: string, rank: number, fade: number): void;
  /** The track of a shot in flight; a plasma shot's is a ribbon. */
  liveTrail(ctx: CanvasRenderingContext2D, points: number[], wormholes: readonly Wormhole[], color: string, plasma: boolean, time: number): void;
  /** A shot in flight, with the points it has just flown through. */
  shot(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, trail: readonly number[], time: number): void;
  plasmaShot(ctx: CanvasRenderingContext2D, x: number, y: number, time: number): void;
  /** An armor-piercing round: an arrowhead at (x, y) pointing along `heading`. */
  piercer(ctx: CanvasRenderingContext2D, x: number, y: number, heading: number, color: string): void;
  /** The ring on a shot that can still be split. */
  splitterRing(ctx: CanvasRenderingContext2D, x: number, y: number, time: number): void;
  /** The path of a shot that has hit something, in the colour of the round, `part` of it from the muzzle on. */
  spotlightPath(ctx: CanvasRenderingContext2D, part: number[], color: string): void;
  /** The spot where the spotlit shot counted, pulsing (`pulse` 0 → 1). */
  spotlightMark(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, pulse: number): void;

  /** A power-up lying on the field, in a frame centred on it. */
  pickup(ctx: CanvasRenderingContext2D, kind: PowerUpKind, color: string, time: number, pulse: number): void;
  /** The path of an armed preview: `last` segments of `points`, fading out over `span` of them. */
  previewPath(ctx: CanvasRenderingContext2D, points: number[], last: number, span: number, color: string): void;
  /** The ray of a planet killer or an antigravity, from (x0, y0) to (x1, y1), dashed and running; `locked` once it is on a planet. Draws with the stroke colour the caller has set. */
  aimRay(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, locked: boolean, time: number): void;
  /** Brackets turning slowly round a planet the ray has locked on to, `r` from its middle. */
  lockBrackets(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, time: number): void;
  /** The door of a teleport as it would stand, with the caller's stroke. */
  teleportGhost(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, pulse: number, time: number): void;
  /** The ring round a black hole as it would stand, with the caller's stroke. */
  blackHoleGhost(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, pulse: number, time: number): void;
  /** The reach of a nebula as it would stand, with the caller's stroke. */
  nebulaReach(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number): void;
  /** One ring spreading from a planet whose gravity is turned, `phase` of the way (alpha is set by the caller). */
  repelRing(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, phase: number): void;

  /** How the cosmetic effects (shockwaves, beams, sparks, a supernova) are drawn. */
  readonly effects: EffectStyle;
}

/** How a look draws the `Effects`. */
export interface EffectStyle {
  nova(ctx: CanvasRenderingContext2D, nova: Nova): void;
  /** A shockwave `radius` wide, `t` (0 → 1) of the way through its life. */
  ring(ctx: CanvasRenderingContext2D, ring: { x: number; y: number; color: string }, radius: number, width: number, t: number): void;
  beam(ctx: CanvasRenderingContext2D, beam: { x1: number; y1: number; x2: number; y2: number; color: string }, t: number): void;
  /** A spark flying at `speed` is a streak this long and wide; without it every spark is a plain square, as in the engraved look. */
  streak?(speed: number, size: number): { length: number; width: number };
}

/** How an aim is shown. */
export type AimStyle = 'full' | 'ghost' | 'thin';

/** The rings that point out your ship when a round starts: how long they last (s), how many, seconds per sweep, and the radius they start from (field units). */
export const LOCATE_PING = { DURATION: 3, RINGS: 2, PERIOD: 1, RADIUS: 110 } as const;

/** The parts of the engraved elements that a look changes without drawing the whole element again. */
export interface Styles {
  hole?: BlackHoleStyle;
  portal?: PortalStyle;
  defense?: DefenseStyle;
  interception?: InterceptionStyle;
}
