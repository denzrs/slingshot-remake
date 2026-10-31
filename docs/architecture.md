# Code layout

`src/` is split by what a file knows about. A folder stands on the ones below it and never imports one above it (`tests/layering.test.ts` checks this).

| Folder | What lives there | May import |
| --- | --- | --- |
| `platform/` | Language (`i18n`), sound, emoji, avatars, clip recording. Nothing of the game itself | — |
| `sim/` | The physics and rules of a flight: `physics`, `world`, `rng`, `scoring`, `powerups`, `volley`, the CPU's `ai`, the daily `challenge` specs, `config`, `modes`. No DOM | platform |
| `data/` | What is configured and remembered: `settings`, `roomRules` (the one owner of a room's rule set), `roomLook`, `look`, `customPresets`, `dailyStore`, `lobbyPrefs`, `stats`, `browserId` | platform, sim |
| `game/` | A match: its modes (`classic`, `horizon`, `solar`), `mayhem`, the killcam and replay, `oracle`, and the records of a game (`shotLog`, `roundReport`, `scorecard`) | platform, sim, data |
| `net/` | The relay and everything that crosses the wire: `net` (the messages), `multiplayer` (the session), `netsync`, `netMatch`, `messagepack`, `invite`, `leaderboard`, the stats the relay keeps | platform, sim, data, game |
| `render/` | The picture of the game: the field, the HUD, planets, effects. Knows nothing of net | platform, sim, data, game |
| `debug/` | Tools for developing (the aim predictor, `?preview=` screens) | everything below `ui/` |
| `ui/` | Menus, lobby and controls, grouped by feature (below) | everything below |

`main.ts` wires the lot together.

## `ui/`

| Folder | |
| --- | --- |
| `menu/` | The menu itself: `menu`, `controls` (rows, sliders, tiles), the page frame (`menu-page`), `rules` (what the rules page lists), mode art |
| `presets/` | Match presets: `match-presets`, the shared card controller `preset-cards`, today's pick |
| `screens/` | The pages of the main menu: `title`, `setup`, `players`, `rules-page`, `settings`, `tutorial`, `pause`, `game-over`; `index.ts` exports `App` and the four entry points |
| `lobby/` | Online: `index.ts` is the frame, with `connection`, `browse`, `open-room`, `room`, `briefing`, `rules-form`, `widgets` |
| `room/` | What a room shows: seats, teams, chat, the room's symbol |
| `daily/`, `stats/`, `touch/` | The daily challenge and its board, the statistics and the fact ticker, touch controls |

Each folder's CSS sits beside its code; `src/style.css` and `src/ui/menu/menu-page.css` list the files in cascade order (see the comments there). Window-size breakpoints are fixed in `tests/css-breakpoints.test.ts`.

## `render/looks/`

A look is how every element of the playing field is drawn (menus, HUD and the tutorial stay as they are in every look). The renderer asks the chosen look's painter for each element and never asks which look it is: no file outside `render/looks/` may name a look (`tests/render/looks.test.ts` checks it).

| File | |
| --- | --- |
| `painter.ts` | The interface: one method per element (ship, planet, shot, portal, defense, aim, effects, …). Start here to add or change an element |
| `classic.ts` | The engraved plan, and `engraved(id, styles, parts)`, which builds every other look: a look is the engraved painter with some `styles` (a hook inside an element, such as light over the black hole) and some `parts` (elements it draws itself) |
| `luminous.ts`, `luminous-art.ts`, `luminous-planet.ts` | The look in light: what it changes, and how it draws it |
| `forged.ts`, `forged/` | The luminous look with the Blender renders put in (`scripts/forged/` makes them) |
| `holo.ts`, `holo-art.ts` | The projection of lines and hexagons |
| `index.ts` | `painterFor(look)` |

To add a look: write a painter file that builds on one (`engraved(...)`, spreading what it extends) and list it in `index.ts` and `data/look.ts`. To change how an element looks in one look: edit that look's file only. The gallery at `/looks.html` shows every look side by side.

## Tests

`tests/` follows the same folders (`tests/sim/physics.test.ts` tests `src/sim/physics.ts`). `tests/browser/` holds pages to open by hand.
