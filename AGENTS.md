# Working on Slingshot

The README covers setup and releases. This file covers the player-facing work that accompanies code changes.

## Announce new features in What's New

Players get a "What's New" dialog once for every release and can reopen it from the title screen. Its source is [`src/news/releases.json`](src/news/releases.json): `draft` holds the next release's items; `releases` holds finalized bundles, newest first. **When a player-facing feature lands, add its item to `draft.items` in the same change.** The release Action assigns the generated Git tag and moves the draft into `releases` before building.

Announce new modes, rules, power-ups, looks, settings, online features and other things players would want to try. Skip fixes, balancing, refactors, tests, docs and anything invisible. When in doubt, leave it out: the dialog works best when each bundle has only the changes that matter.

### Write an item

```json
{
  "id": "refined-look",
  "title": { "de": "Verfeinerter Look", "en": "Refined Look" },
  "text": { "de": "…", "en": "…" },
  "where": { "de": "Einstellungen → Darstellung → Grafik", "en": "Settings → Display → Graphics" },
  "image": { "src": "refined-look.webp", "alt": { "de": "…", "en": "…" } },
  "open": "settings"
}
```

- Give every item a unique, permanent kebab-case `id`. Dates are not part of the news data; the release tag provides the chronology.
- Write both languages. German addresses the player as "du". Keep the title short and the text to one or two friendly sentences.
- Say where to find the feature in `where`, using the UI labels exactly as they appear.
- Images are optional. Use a 16:9 `.webp` under 250 KB in `src/news/images/`; `src` is the filename. Without an image, the card uses the built-in space illustration.
- `open` adds a "Try it" button. Add new targets to `NewsTarget` in `src/news/types.ts` and wire them in `whatsNewScreen` in `src/ui/screens.ts`.
- Run `npm run news:validate` to check the JSON, languages, ids and image files.
- For a manually pushed release tag, move the draft into `releases` under that exact tag and clear `draft.items` before creating the tag. The tag workflow checks that the bundle is already finalized.

### Make the picture

A picture beats a paragraph, and one that shows where the feature lives beats both. Start the dev server, then let `npm run shot` take it (it drives headless Chrome; set `CHROME_PATH` if Chrome is elsewhere). The settings are applied before the page loads, `--click` presses buttons by their text, and `--mark` draws a ring around what the player should look at:

```bash
npm run dev   # in another terminal
npm run shot -- --out src/news/images/refined-look.webp \
  --settings '{"look":"refined"}' --click "Einstellungen" --mark "Verfeinerter Look"
```

`--size WxH` (default 1280x720), `--wait <ms>` and `--url` are available too; see [`scripts/shot.ts`](scripts/shot.ts). The shots use the German UI. Look at each result before committing it.

### Preview and seen state

Open `http://localhost:5173/?news` to preview the newest bundles, or add `?news=off` to keep the dialog away. A draft appears as "Nächste Version" locally. The browser stores the newest seen release tag in `slingshot.news.seen`. For a clean player preview, clear that key while `slingshot.settings.v1` exists. A browser without saved settings counts as a first visit and does not get the dialog.

## Language

UI labels live in `src/i18n.ts` (every key in both languages). What's New items live in `src/news/releases.json`.

## Presets

For a new or changed match preset idea, follow [`add-game-preset`](.agents/skills/add-game-preset/SKILL.md). It covers the three independent mode groups, both match setup flows, translations, card art and release notes.
