# Working on Slingshot

The README covers setup and releases.

## Layout

Where a file belongs, and which folder may import which: [`docs/architecture.md`](docs/architecture.md). `tests/layering.test.ts` fails on an import that points up.

## Testing in a browser

A fresh browser is offered the first-run introduction (look picker, then the tutorial), which covers the menu. Open the game with `?nointro` to start at the title menu: `http://localhost:5173/?nointro`. It saves nothing and combines with the other parameters (`?nointro&debug`, `?nointro&try=name`). Leave it out only when the introduction itself is under test.

The introduction also asks whether to use the online features (`src/data/online.ts`); until the player says yes, nothing connects to the relay and the menu shows online rows greyed. A `?nointro` visit counts as online without saving it, unless the browser chose offline before; switch it under Einstellungen → Online-Funktionen to test the offline menu.

The daily challenge's page shows a shot of the day only to a player who has posted a run, and only with a relay. In a dev build `?nointro&fakeshot` gives it a sample shot, to look at the card in a short window.

`npm run dev:local` starts both at once: the relay with demo statistics (its own `slingshot-stats-demo.db`), then the page already pointed at it, opened at `/?nointro&debug`.

An online game needs the relay (`npm run dev:server`, port 8080) and two tabs: one creates a room under Online spielen, the other joins it.

To test online alone, open the game with `?nointro&debug` and use Online-Bots in the DEV panel: a bot is a connection of its own that the relay takes for a person (it joins your room, gets ready, founds or joins a tournament team and comes to its matches), and that `npm run dev:server` hands to the game as a CPU, so your page plays it ([`online-bots.ts`](src/debug/online-bots.ts)). A bot never hosts: open the room or the match yourself. Its "View" button opens a tab that takes its seat and tournament person over ([`impersonate.ts`](src/debug/impersonate.ts)), to see the room, the bracket and the game as the bot sees them; the host still plays its turns, and closing that tab takes the bot out of its room.

To watch a whole tournament run, create one and press "Turnier simulieren" under Online-Bots: it fills the bracket with bot teams and starts it, and a dev relay plays every match between bot teams out by itself, round by round, with drawn points and no game to watch ([`simulate.rs`](server/src/room/simulate.rs)). Found a team of your own first to play your matches for real. The bracket and the Arena (Q/E) show it as it goes.

To look at the bracket alone, without a relay, open `/dev/tournament.html` (`npm run dev`): it simulates a whole tournament in the page with 2 to 16 teams, from registration through the draw to the champion, step by step, level by level or on its own ([`bracket-gallery.ts`](src/ui/tournament/bracket-gallery.ts)). `?teams=n&phase=running|live|finished` opens it there.

## Language

UI labels live in `src/platform/i18n.ts` (every key in both languages).

## Looks

How the playing field is drawn (Einfach, Forged, Holo) lives in `src/render/looks/`: one painter per look, one method per element ([`painter.ts`](src/render/looks/painter.ts), layout in [`docs/architecture.md`](docs/architecture.md)). The renderer never branches on the look; to change how something looks in a look, edit that look's file. Check it in `npm run dev` at `/dev/looks.html`.

## Presets

For a new or changed match preset idea, follow [`add-game-preset`](.agents/skills/add-game-preset/SKILL.md). It covers the three independent mode groups, both match setup flows, translations, and card art.

## Trying a rule idea

A new rule idea starts as an experiment, not as a rule: [`src/game/experiments.ts`](src/game/experiments.ts), checked with `this.trying('name')` in a match, switched on with `?try=name` or the dev panel (`?debug`). It stays out of `RoomRules`, the wire, the relay, the presets and `i18n` until it has been played and kept.

## Wire

For any change to what client and relay say to each other (messages, state patches and their events, room rules, `server/protocol-contract.json`, or relay code that builds or validates them), follow [`change-wire-protocol`](.agents/skills/change-wire-protocol/SKILL.md). `tests/protocol-wire.test.ts` is red until the change is recorded with `npm run protocol`.
