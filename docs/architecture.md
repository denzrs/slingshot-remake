# Code layout

`src/` is split by what a file knows about. A folder stands on the ones below it and never imports one above it (`tests/layering.test.ts` checks this).

| Folder | What lives there | May import |
| --- | --- | --- |
| `platform/` | Language (`i18n`), sound, emoji, avatars, clip recording, the installed app (`pwa`: service worker registration, the update and install hints), which device was used last (`input-device`: the key hints name its keys). Nothing of the game itself | — |
| `sim/` | The physics and rules of a flight: `physics`, `world`, `rng`, `scoring`, `powerups`, `volley`, the CPU's `ai`, the daily `challenge` specs, `config`, `modes`. No DOM | platform |
| `data/` | What is configured and remembered: `settings`, `roomRules` (the one owner of a room's rule set), `roomLook`, `look`, `customPresets`, `dailyStore`, `lobbyPrefs`, `stats`, `browserId` | platform, sim |
| `game/` | A match: its modes (`classic`, `horizon`, `solar`), `mayhem`, the killcam and replay, `oracle`, and the records of a game (`shotLog`, `roundReport`, `scorecard`) | platform, sim, data |
| `net/` | The relay and everything that crosses the wire: `net` (the messages), `multiplayer` (the session), `netsync`, `netMatch`, `messagepack`, `invite`, `leaderboard`, the stats the relay keeps | platform, sim, data, game |
| `render/` | The picture of the game: the field, the HUD, planets, effects. Knows nothing of net | platform, sim, data, game |
| `debug/` | Tools for developing (the aim predictor, `?preview=` screens) | everything below `ui/` |
| `ui/` | Menus, lobby and controls, grouped by feature (below) | everything below |

`main.ts` wires the lot together.

The service worker is a template, `scripts/pwa/sw.js`: `vite.config.ts` fills in the build's file list (`scripts/pwa/worker.ts`) and emits it as `sw.js` at the build root, so it covers the game and `/stats` under any sub-path. A file added to the build is cached without further work; a change to how files are named or served has to keep that list true.

## `ui/`

| Folder | |
| --- | --- |
| `menu/` | The menu itself: `menu`, `controls` (rows, sliders, tiles), the page frame (`menu-page`), `rules` (what the rules page lists), mode art |
| `presets/` | Match presets: `match-presets`, the shared card controller `preset-cards`, today's pick |
| `screens/` | The pages of the main menu: `title`, `setup`, `players`, `rules-page`, `settings`, `tutorial`, `pause`, `game-over`; `index.ts` exports `App` and the four entry points |
| `lobby/` | Online: `index.ts` is the frame, with `connection`, `browse`, `open-room`, `room`, `briefing`, `rules-form`, `widgets` |
| `room/` | What a room shows: seats, teams, chat, the room's symbol |
| `daily/`, `stats/`, `touch/` | The daily challenge and its board, the statistics and the fact ticker, touch controls |
| `gamepad/` | A game controller (standard layout): `mapping` turns a snapshot of the pad into actions (dead zone, edges, hold to repeat) with no browser in it, `gamepad` looks at `navigator.getGamepads()` once per frame and calls `GamepadHandlers`; menus are moved by key events pressed on the focused row |

Each folder's CSS sits beside its code; `src/style.css` and `src/ui/menu/menu-page.css` list the files in cascade order (see the comments there). Window-size breakpoints are fixed in `tests/css-breakpoints.test.ts`.

## `render/looks/`

A look is how every element of the playing field is drawn (menus, HUD and the tutorial stay as they are in every look). The renderer asks the chosen look's painter for each element and never asks which look it is: no file outside `render/looks/` may name a look (`tests/render/looks.test.ts` checks it).

| File | |
| --- | --- |
| `painter.ts` | The interface: one method per element (ship, planet, shot, portal, defense, aim, effects, …), and the whole-frame hooks (`begin`, `backdropArt`, `border`, `sky`, `post`) that a look can use to light the field as a whole. Start here to add or change an element |
| `classic.ts` | The engraved plan, and `engraved(id, styles, parts)`, which builds every other look: a look is the engraved painter with some `styles` (a hook inside an element, such as light over the black hole) and some `parts` (elements it draws itself). `classic-white` draws the White Hole anomaly (the core and a shot's jump) and its timing helpers for the other looks |
| `forged.ts`, `forged/`, `forged-*.ts` | The engraved plan in light (`forged-parts` the parts and styles, `forged-light` and `forged-lit-planet` their drawing) with the Blender renders put in (`scripts/forged/` makes them: `render_assets.py` the ship, turret and first three planet maps, `render_planets.py` the other planet maps by style (lava, ocean, desert, acid, carbon, crystal, living, machine, iron, hycean, fungal and volcanic worlds, more earth-like rock, an icy moon with geysers, and the tidally locked lava, ice and eyeball worlds among them), `render_cracks.py` the crack map an unstable planet breaks open along, `hole-frames.mjs` with `hole-trace.ts` the black hole's frames, traced as light bends round it, and the white hole's), and what is drawn over them: `forged-planet` (turning clouds, dusk, city lights, rings, what of a map glows by itself or mirrors the sun, a tidally locked world turned away from its light), `forged-planet-events` (what happens on a surface: a lava world's meteor strikes and volcanoes, a volcanic moon's sulphur plumes, geysers, dust storms, hurricanes, glints, a machine world's trains of light, heat haze, and the scars shots leave), `forged-hole` (the black hole: a loop of frames of its disk turning, drawn mixed between frames, and the White Hole's light in its shadow, traced with it and played on the same loop; `forged-hole-sheet` says how the sheets are laid out), `forged-blast` (fireballs, shrapnel), `forged-sky` (nebula, twinkling stars, vignette), `forged-shots` (shots, tracks, the sun's rays), `forged-gas` (nebula, storm clouds, portals), `forged-white` (the White Hole anomaly: haze, the jump), `forged-assets` (image loading). `forged-gl` is the shaders' stage: an offscreen WebGL2 canvas whose picture is put into the 2D frame. The sun (`forged-shots`), nebula and storm clouds (`forged-gas`) and planets (`forged-planet-gl`, with the glowing cracks of the Unstable anomaly) each draw with a shader of their own and keep their Canvas 2D drawing for when there is no stage. `?forgedgl=off` compares without them, and `?forgedgl=soft` allows a software renderer for headless shots |
| `holo.ts`, `holo-art.ts`, `holo-events.ts`, `holo-field.ts` | The projection: lines and hexagons (`holo-art`), bursts, the ship scanning in and shot packets (`holo-events`), the glass, frame, glow and the lattice's wave of the whole field (`holo-field`), the White Hole anomaly (`holo-white`) |
| `index.ts` | `painterFor(look)` |

To add a look: write a painter file that builds on one (`engraved(...)`, spreading what it extends, with a `note`), list its id in `LOOKS` in `data/look.ts` and its painter in `index.ts` (the types fail until both are done), and give it a name in the settings, `settings.look<Name>`, in both languages. The settings picker and the gallery are built from that list. To change how an element looks in one look: edit that look's file only.

The gallery at `/dev/looks.html` shows every look side by side; `/dev/planets.html` shows every style of planet at every size, four styles to a page and a page for the variants (tidally locked, geysers), a tab per look. "Pixel-Stand merken" remembers the pixels of every scene in every look and "Mit Stand vergleichen" lists what changed since, which catches a drawing change you did not mean to make (the browser keeps the stand, so it survives a reload).

## Tests

`tests/` follows the same folders (`tests/sim/physics.test.ts` tests `src/sim/physics.ts`). `dev/` holds the pages to open by hand (`npm run dev`, then `/dev/`).
