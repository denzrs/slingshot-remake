# Working on Slingshot

The README covers setup and releases.

## Layout

Where a file belongs, and which folder may import which: [`docs/architecture.md`](docs/architecture.md). `tests/layering.test.ts` fails on an import that points up.

## Language

UI labels live in `src/platform/i18n.ts` (every key in both languages).

## Presets

For a new or changed match preset idea, follow [`add-game-preset`](.agents/skills/add-game-preset/SKILL.md). It covers the three independent mode groups, both match setup flows, translations, and card art.
