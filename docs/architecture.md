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

## Tests

`tests/` follows the same folders (`tests/sim/physics.test.ts` tests `src/sim/physics.ts`). `tests/browser/` holds pages to open by hand.
