# Look inventory: what is drawn on the playing field

As of: `main` at `4b99c9b`, 2026-10-31. Basis for the four selectable looks **Simple** (*Einfach*), **Luminous**, **Forged**, **Holo**.

- **Simple** is today's `classic` and stays unchanged.
- **Luminous** replaces today's `refined`.
- **Forged** and **Holo** are new.
- Every row below needs an entry in Luminous, Forged and Holo. Where an element looks the same in two looks today, that is a finding, not a state we have to keep.

**Main finding:** Today `classic` and `refined` differ in only three places (`isRefined()` in `src/render/planets.ts`, `renderer.ts:343` and `renderer.ts:1098`): the ship hull, the planet sphere and the light rotation of the planets in the Solar System. Everything else below is identical in both looks and has no look switch.

Columns: **Proto** = shown in the prototype gallery (yes / partly / no). **Forged route** = Blender render (R), code (C) or both (R+C).

## 1. Background and map

| # | Element | Where | Today | Forged route | Proto | Notes |
|---|---|---|---|---|---|---|
| 1.1 | Plate: ink gradient, stars, grain, plotter frame, registration marks, variant with walls | `backdrop.ts` | same in both | C (maybe R for texture) | no | Built once, rebuilt on size or wall changes. The cache key needs the look. |
| 1.2 | Gravity contours (topo map, every 5th line stronger) | `contours.ts` | same | C | no | Cached per world version and pixel scale. Fades to 25 % during the collapse. |
| 1.3 | Gravitational lens around the hole: background redrawn enlarged in rings | `blackhole.ts` `drawLens` | same | C | no | Redraws the backdrop image. Depends on 1.1. |
| 1.4 | Danger ring (where the horizon ends after the next collapse) | `blackhole.ts` `drawDangerRing` | same | C | no | Dashed red ring. |
| 1.5 | Debug orbits (only with `DEBUG_AIM`) | `renderer.ts` `drawOrbits` | same | – | – | Developer aid, out of scope. |

## 2. Celestial bodies

| # | Element | Where | Today | Forged route | Proto | Notes |
|---|---|---|---|---|---|---|
| 2.1 | Planet, style **rock** | `planets.ts`, `planet-refined.ts` | classic: engraving with hatching. refined: sphere with rim, glow, drifting pattern | R | yes | Sprite per seed, `sprites` cache (max. 64), already rebuilt per look. |
| 2.2 | Planet, style **gas** | same | refined: bands in opposite directions | R | yes | |
| 2.3 | Planet, style **ice** | same | cracks, craters | R | **no** | Missing from the prototype. |
| 2.4 | Planet lighting in the Solar System | `renderer.ts:343` | classic turns the sprite towards the sun, refined does not | R (light fixed in the render, or rotatable) | no | Decided: Simple, Luminous and Forged turn the planet's lit side towards the sun it orbits (`planetsTurnToSun` in the painter); Holo is a wireframe and has no lit side. |
| 2.5 | Planet gets devoured (stretched towards the hole) | `renderer.ts:331` | transform, no graphic of its own | – | – | Must work with the new sprites. |
| 2.6 | Hidden planets: fade in after the round | `renderer.ts:299` | alpha | – | – | Check only. |
| 2.7 | **Sun** (Solar System): plasma surface, chromosphere, magnetic loops, corona rays, glow | `sun.ts` `drawSun` | same | R+C | partly | The prototype shows only the calm sun. |
| 2.8 | Sun in a **flare** (storm breaks out: glow, loops, white) | `sun.ts` `flare` | same | C | **no** | State 0 to 1. |
| 2.9 | Sun as a **red giant** (`giant` 0 to 1) | `sun.ts` | same | C | **no** | State 0 to 1. |
| 2.10 | **Neutron star** after a supernova | `sun.ts` `drawNeutronStar` | same | C | **no** | |
| 2.11 | **Planetary nebula** round the neutron star, grows with age | `sun.ts` | same | C | **no** | Growth runs through `remnantAge`. |
| 2.12 | **Black hole**: disk (back and front half), horizon, photon ring, light arc, halo | `blackhole.ts` `drawBlackHole` | same | R+C | yes | Several holes possible (`world.holes`). Radius grows with each collapse. |
| 2.13 | **Wormhole** portal: oval door, swirl, floats, turned to its partner | `wormhole.ts` | same | C | **no** | Colour per wormhole ID, both portals alike. Sprite cache per colour and size. |
| 2.14 | Wormhole gets devoured (shrinks and fades) | `wormhole.ts` `eaten` | same | C | no | |
| 2.15 | **Nebula** cloud (nebula power-up): haze, two layers, drifts | `nebula.ts` | same | C | **no** | Sprite from the seed. |
| 2.16 | **Storm cloud** of the sun: plasma with hot veins, embers, pulsing heart | `storm.ts` `drawStormCloud` | same | C | **no** | Age and dissolve (`age`, `dissolve`). |
| 2.17 | Storm burst: two shock rings from the sun | `storm.ts` `drawStormBurst` | same | C | no | |
| 2.18 | Sparks round a shot in the storm | `storm.ts` `drawStormSparks` | same | C | no | |
| 2.19 | **Planetary defense**: three zones, hexagon skin, turret, search beam, rims flash | `defense.ts` `drawDefense` | same | C | **no** | Sprite per colour and size, planet cut out. Owner's colour. |
| 2.20 | Defense: **missile** and interception | `defense.ts` `drawInterception` | same | C | no | Drawn over the shots. |
| 2.21 | Defense: hit-chance labels while aiming | `defense.ts` (`labels`) | same | C | no | Text. |
| 2.22 | Destroyed defense (`wrecked`) | `renderer.ts:359` | not drawn | – | – | Check only. |

## 3. Ships

| # | Element | Where | Today | Forged route | Proto | Notes |
|---|---|---|---|---|---|---|
| 3.1 | **Ship hull**: body, canopy, wing lights | `ship.ts` `drawRefinedShip`, `renderer.ts:1098` | classic: flat surface. refined: glow, blinking lights | R | yes | 6 player colours plus team shades (`TEAMS`, 3 shades each). Team colour needs a mask in the render. |
| 3.2 | **Engine flame** idling and while aiming, ember sparks | `ship.ts` | classic: small flame only while aiming | C | yes | `thrust` 0 to 1. |
| 3.3 | Ship in the **aiming state** versus idle | `renderer.ts:1096` | | R+C | partly | |
| 3.4 | Ring round the active ship (dashed, turns, r 25) | `renderer.ts` `drawShips` | same | C | partly | This is the "selection". |
| 3.5 | **Shot clock**: arc round the ship, turns red under 4 s | `renderer.ts` | same | C | **no** | |
| 3.6 | **Locked in** (salvo): ring r 21 | `renderer.ts` | same | C | **no** | |
| 3.7 | **Grace period**: dashed ring, neighbour ship in the line of fire | `renderer.ts` | same | C | **no** | |
| 3.8 | **Sudden death**: rings drawing in on the ship | `renderer.ts` `drawPull` | same | C | **no** | Wider the stronger the pull. |
| 3.9 | **Shield** bubble round the ship | `renderer.ts` | same | C | **no** | Pulses. |
| 3.10 | Held power-up as a symbol above the ship | `renderer.ts:860` | same | C | no | Symbol r 5. |
| 3.11 | **Sonar** at the start of a round | `renderer.ts` `drawLocatePing` | same | C | yes, **but the wrong way round** | Today the rings run **inwards** towards your own ship. The prototype lets them run outwards. It shows only your own ship, not the others. |
| 3.12 | **Aim vector**: dashed line, arrowhead, styles `full`, `ghost`, `thin` | `renderer.ts` `drawAimVector` | same | C | **no** | Length depends on the power. |
| 3.13 | **Offscreen marker** for shots outside the field | `renderer.ts` `drawOffscreenMarker` | same | C | **no** | With the distance as a number. |
| 3.14 | Daily challenge **target**: diamond, ring at hit radius, turning brackets | `renderer.ts` `drawTarget` | same | C | **no** | Challenge mode only. |
| 3.15 | Ship gets devoured (stretch) | `renderer.ts:1085` | transform | – | – | Must work with a rendered ship. |
| 3.16 | Doomed ship in the supernova (glows up) | `effects.ts:539` | draws `SHIP_HULL` directly | C | **no** | Its own hull drawing, not via `ship.ts`. Has to follow. |

## 4. Shots and trails

| # | Element | Where | Today | Forged route | Proto | Notes |
|---|---|---|---|---|---|---|
| 4.1 | **Trail** of a finished shot (solid, older ranks dashed, fade) | `renderer.ts` `drawTrails`, `strokeTrails` | same | C | **no** | Finished trails live in one cache image (`trailLayerFor`). The cache needs the look. |
| 4.2 | **Shot head**: bright dot | `renderer.ts` | same | C | **no** | |
| 4.3 | **Plasma shot**: pulsing cyan blob | `renderer.ts` | same | C | **no** | |
| 4.4 | **Plasma trail**: tapering ribbon with sparks | `renderer.ts` `drawPlasmaTrail` | same | C | **no** | |
| 4.5 | **Armor-piercing** shot: arrowhead | `renderer.ts` | same | C | **no** | |
| 4.6 | **Splitter** ready: golden ring on the shot | `renderer.ts` | same | C | **no** | |
| 4.7 | Shot in a **nebula**: ripple ring | `renderer.ts` | same | C | **no** | |
| 4.8 | **Spotlight** at the end of a round: the shot behind the award, marker pulses | `renderer.ts` `drawSpotlight` | same | C | **no** | |
| 4.9 | **Preview** path (dashed, fades out) | `renderer.ts` | same | C | **no** | |

## 5. Power-ups

12 kinds (`PowerUpKind`): `preview`, `teleport`, `splitter`, `antigravity`, `shield`, `blackhole`, `planetkiller`, `nebula`, `piercing`, `wormhole`, `defense`, `plasma`.

| # | Element | Where | Today | Forged route | Proto | Notes |
|---|---|---|---|---|---|---|
| 5.1 | **Pickup on the field**: coin r 15 with glow, symbol, label, pop-in, blinking before it expires | `renderer.ts` `drawPowerUps` | same | R+C | partly | The prototype shows 3 of 12 symbols. The label stays upright (`uprightFrame`). |
| 5.2 | **12 symbols** | `powerup-art.ts` `drawPowerUpSymbol` | same | C (R for the coin) | **3 of 12** | Also used **outside the field**, see section 8. |
| 5.3 | **Antigravity**: waves going out from the planet, rim on the planet | `renderer.ts` `drawRepelWaves` | same | C | **no** | Also reversed (inwards). |
| 5.4 | Aiming **planet killer / antigravity**: ray, brackets on the target, crack, arrows | `renderer.ts` (placement) | same | C | **no** | Label. |
| 5.5 | Aiming **teleport**: door (ring, core, crosshair) | same | same | C | **no** | |
| 5.6 | Aiming **black hole**: the would-be horizon (dark core, bright ring) | same | same | C | **no** | Blocked state red, keep-out circles round nearby ships. |
| 5.7 | Aiming **wormhole**: ghost portal, then a solid portal with a thread to the second | same | same | C | **no** | Blocked state red, labels. |
| 5.8 | Aiming **nebula**: plain reach ring | same | same | C | **no** | |
| 5.9 | Aiming **defense**: turret with its zones and hit chance, replaces an existing one | same | same | C | **no** | |
| 5.10 | Labels on the field (`700 11px mono`) | `renderer.ts` | same | C | no | Decide the type style per look. |

## 6. Effects (`Effects`, field coordinates)

| # | Effect | Where | Forged route | Proto | Notes |
|---|---|---|---|---|---|
| 6.1 | **Explosion** of a ship (`explode`) and **hit** (`impact`) | `effects.ts` | C | yes (one explosion) | Spark tiers large / medium / small, debris setting. |
| 6.2 | **Muzzle flash** (`muzzle`) | `effects.ts` | C | **no** | |
| 6.3 | **Fizzle** (`fizzle`), **clash** of two shots (`clash`) | `effects.ts` | C | **no** | |
| 6.4 | **Pickup**: pieces fly to the ship, pulse (`pickup`) | `effects.ts` | C | **no** | |
| 6.5 | **Spawn** (`spawn`, ring closes), **expiry** (`fade`), **loss** (`drop`) | `effects.ts` | C | **no** | |
| 6.6 | **Teleport**: collapse, streak, burst | `effects.ts` | C | **no** | |
| 6.7 | **Shield hit** (`shieldHit`) | `effects.ts` | C | **no** | |
| 6.8 | **Antigravity** on/off (`antigravity`) | `effects.ts` | C | **no** | |
| 6.9 | **Defense fires** (`defenseFire`), **intercepted** (`intercepted`), **missile lost** (`missileLost`) | `effects.ts` | C | **no** | |
| 6.10 | **Splitter** (`split`) | `effects.ts` | C | **no** | |
| 6.11 | **Devouring**: matter spirals into the hole (`devour`), **horizon swells** (`collapse`) | `effects.ts` | C | **no** | |
| 6.12 | **Supernova**: core, two shockwaves, white-out, quake, ships and planets break up | `effects.ts` (`Nova`) | C | **no** | Its own hull drawing (3.16). |
| 6.13 | **Planet-killer laser** (`laser`) and **planet shatters** (`shatter`) | `effects.ts` | C | **no** | |
| 6.14 | **Nebula wisps** (`nebulaDrag`) | `effects.ts` | C | **no** | |
| 6.15 | **Callout**: floating text (`SWING-BY x1.5`, `+820`) | `effects.ts` | C | **no** | Type. |
| 6.16 | **Screen flash** and **white-out** | `renderer.ts:187` | C | no | Full screen. The quake is motion, not graphics. |

## 7. Plumbing (no looks, but needed)

| # | What | Where | Notes |
|---|---|---|---|
| 7.1 | `Look` = `'refined' \| 'classic'` | `src/data/look.ts` | Four values. `refined` becomes `luminous`. |
| 7.2 | Stored setting | `src/data/settings.ts` | Migrate the old value `refined`. Unknown values fall back to `classic` (`isLook`). |
| 7.3 | Picker in the settings | `src/ui/screens/settings.ts:63` | Two entries, should become four. |
| 7.4 | Texts (DE and EN) | `src/platform/i18n.ts` | `settings.lookRefined`, `settings.lookClassic` plus three new ones. Both languages. |
| 7.5 | Entry point | `src/main.ts:58`, `:387` | `setLook(settings.look)`. |
| 7.6 | Caches that have to know the look | Planet sprites (has it), **backdrop**, **contour cache**, **trail cache**, sprite caches of defense, wormhole, nebula, storm, sun | Otherwise an old look stays on screen after switching. |
| 7.7 | Structure | `docs/architecture.md`, `tests/layering.test.ts` | File the look set so that no import points upwards. |
| 7.8 | Forged assets | new | Atlas (WebP), team colour mask, size budget, licence (the repo is GPL, own renders). |
| 7.9 | Tests | `tests/` | One smoke test per look that every drawing function runs without errors. A look changes pixels only, so the replay tests must not change. |

## 8. Outside the field, but using field graphics

**Decided (2026-10-31): the playing field only.** Menus, HUD, cards, tutorial, rules and preset cards stay in the Simple look, even when another look is chosen. These places call the same drawing functions as the field. The look must therefore not hang inside the functions themselves; the field renderer passes it in. The callers below keep the Simple variant.

| Place | Uses | Question |
|---|---|---|
| `src/ui/screens/tutorial-preview.ts` | `drawBlackHole`, `drawSun`, `renderPlanet`, power-up symbols | **Simple.** `renderPlanet` looks at `isRefined()` itself today and would otherwise switch along in the tutorial. |
| `src/ui/screens/tutorial.ts` | power-up symbols | **Simple** |
| `src/ui/menu/rules.ts` | power-up symbols (rules menu) | **Simple** |
| `src/ui/presets/powerup-summary.ts` | power-up symbols (preset cards) | **Simple** |
| `src/render/hud.ts:357` | power-up symbol in the HUD strip | **Simple** |
| `src/render/hud.ts:307, 449`, `avatar.ts` | avatars | Out of scope. |
| `src/render/oracle.ts`, `skip-vote.ts` | cards with a ring round a tapped ship | HUD cards, out of scope. The ring on the field belongs to 3.x. |
| The players' menu arrows (ship icons in menus) | own drawing | Out of scope. |

## 9. Numbers

- Items in sections 1 to 6: **78 rows** (minus one debug row: 77). Shown or partly shown in the prototype: **12**.
- Power-up symbols: 3 of 12 shown.
- Planet styles: 2 of 3 shown (ice is missing).
- States without a prototype: sun flare, red giant, neutron star, storm, all aiming previews, all ship rings except the selection, aim vector, shots, trails and almost all effects.

## 10. Progress (branch `feat/field-looks`)

**Luminous, step 1:**

| Item | Status |
|---|---|
| 7.1 to 7.5 look type, migration `refined` → `luminous`, picker, texts | done (`classic` is called "Einfach" in the UI) |
| The look is passed to the drawing instead of read globally; the tutorial stays Simple | done for planets and black hole (default `classic`) |
| 3.1, 3.2 ship hull and flame | taken over from the old `refined`, hull with a colour gradient, keel stripe, canopy |
| 2.1, 2.2 rock and gas planets | taken over from the old `refined` |
| 2.12 black hole | bloom at the photon ring, matter falls in |
| 3.11 sonar | band of light behind the rings, rings keep running inwards |
| 3.4 selection ring of the active ship | twelve circling points of light with a wave instead of a dashed ring |
| 5.1 power-up on the field | ring of light with a halo, circling dot, symbol lit from within (symbol shape unchanged) |
| 6.1 to 6.x effect rings and sparks | rings as a wave of light with a soft band and a bright core, sparks as comet tails |
| 7.6 caches | only the planet sprites know the look |

**Open for Luminous:** everything else in sections 1 to 6, see the column "Proto". Forged and Holo: nothing yet.

**Holo, step 1** (`src/render/looks/holo.ts`):

| Item | Status |
|---|---|
| 1.1 Plate | No grid and no scanlines any more: the lens always bends the background, and a bent grid looked bad. The background is the same for all looks |
| 2.1 to 2.3 planets | Wireframe sphere with turning meridians, scan line, dotted ring. Hue by style: rock amber, gas cyan, ice light blue |
| 2.7 to 2.9 sun, flare, red giant | Disc with scanlines, tick ring, three counter-rotating orbits, crosshair. Flare as a ring, giant in red. Neutron star and nebula still classic |
| 2.12 black hole | Disk as dashed ellipses with spokes, light arc, horizon in a bright ring. **Not seen in the game** |
| 3.1, 3.2 ship | Outline in the player's colour, scan fill, afterimages, dashed flame |
| 3.4 selection | dashed ring, ticks, four fixed corner brackets |
| 3.11 sonar | Hexagons instead of circles |
| 5.1 power-up on the field | turning hexagon, dashed ring, symbol as a line |
| 6.1 effect rings and sparks | Hexagon rings, dashed going outwards; sparks as thin strokes |

**Open for Holo:** everything else, see sections 1 to 6.

**Code structure (after the rebuild):** Every look is a painter in `src/render/looks/` (`classic`, `luminous`, `forged`, `holo`), with one method per element, defined in `painter.ts`. The renderer asks the painter and knows no look name; a test (`tests/render/looks.test.ts`) enforces it. A look builds on another (`engraved(id, styles, parts)`): Forged is Luminous plus images, Luminous is Simple plus light. The Holo grid is gone, and the lens round the black hole bends the background in all looks.

**Look gallery (dev):** `npm run dev`, then `/looks.html`. The real renderer, once per look, on five scenes (field with a sonar loop, Solar System, event horizon, all twelve power-ups, effects loop). New looks go into `LOOKS`, new scenes into `SCENES` in `src/debug/looks-gallery.ts`.

**Second round (Luminous and Holo):** Shots (head, trail, finished trails, plasma, armor-piercing, splitter ring), shield, wormhole portals, nebula cloud, planetary defense with missile and brackets, antigravity waves, aiming for teleport, black hole, nebula (reach), wormhole ghost and defense ghost, teleport beam. The gallery has three new scenes for this: Shots, Effect of the power-ups, Aiming.

**Third round (gaps):** Aim ray of planet killer and antigravity, preview path, spotlight, shot clock, locked in, grace period, sudden-death pull, aim vector, offscreen marker, daily challenge target, held symbol above the ship, storm clouds, storm burst and sparks, neutron star, supernova. New gallery scenes: Aiming aids, Solar storm, Supernova.

**Still classic or only partly done:** Luminous leaves storm clouds, the neutron star and the supernova as they are (they already consist of light). Planet shatter and the planet-killer laser run through the effects' rings and sparks but have no drawing of their own. Sun, red giant and flare appear in the gallery only as the Solar System and the supernova.

**Forged:** The images come from Blender (`scripts/forged/render_assets.py`, packed with `scripts/forged/pack.py` into `src/render/looks/forged/`, about 60 KB together). Drawn as images are the ship (hull in the player's colour over a mask, flame and wing lights in code), planets (rock, gas, ice: albedo map, wrapped round the sphere in the renderer, lit and given an atmosphere rim), the black hole (disk and horizon), the power-up coin and the turret of the planetary defense (a hexagonal plinth in the owner's colour, on it a mount with twin barrels as its own image that follows the target and recoils on launch; sensor and muzzle glow in code). Forged draws everything else like Luminous. Until an image has loaded, the Luminous drawing stands in.
