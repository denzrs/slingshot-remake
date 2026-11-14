# Working on Slingshot

The README covers setup and releases.

## Layout

Where a file belongs, and which folder may import which: [`docs/architecture.md`](docs/architecture.md). `tests/layering.test.ts` fails on an import that points up.

## Testing in a browser

A fresh browser is offered the first-run introduction (look picker, then the tutorial), which covers the menu. Open the game with `?nointro` to start at the title menu: `http://localhost:5173/?nointro`. It saves nothing and combines with the other parameters (`?nointro&debug`, `?nointro&try=name`). Leave it out only when the introduction itself is under test.

An online game needs the relay (`npm run dev:server`, port 8080) and two tabs: one creates a room under Online spielen, the other joins it.

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
