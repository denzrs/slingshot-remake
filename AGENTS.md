# Working on Slingshot

The README covers setup and releases.

## Layout

Where a file belongs, and which folder may import which: [`docs/architecture.md`](docs/architecture.md). `tests/layering.test.ts` fails on an import that points up.

## Language

UI labels live in `src/platform/i18n.ts` (every key in both languages).

## Looks

How the playing field is drawn (Einfach, Forged, Holo) lives in `src/render/looks/`: one painter per look, one method per element ([`painter.ts`](src/render/looks/painter.ts), layout in [`docs/architecture.md`](docs/architecture.md)). The renderer never branches on the look; to change how something looks in a look, edit that look's file. Check it in `npm run dev` at `/dev/looks.html`.

## Presets

For a new or changed match preset idea, follow [`add-game-preset`](.agents/skills/add-game-preset/SKILL.md). It covers the three independent mode groups, both match setup flows, translations, and card art.

## Wire

For any change to what client and relay say to each other (messages, state patches and their events, room rules, `server/protocol-contract.json`, or relay code that builds or validates them), follow [`change-wire-protocol`](.agents/skills/change-wire-protocol/SKILL.md). `tests/protocol-wire.test.ts` is red until the change is recorded with `npm run protocol`.
