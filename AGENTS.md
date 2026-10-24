# Working on Slingshot

Notes for agents (and people) changing this repo. The README covers setup, scripts and releases; this file covers what to do besides writing the code.

## Announce new features in What's New

Players get a "What's New" dialog over the title screen once for every update, and can open it again from the title screen's footer. It is fed by one list: [`src/news/items.ts`](src/news/items.ts). **When you add or change something a player would notice, add an item at the top of that list in the same change.** Nothing needs clearing or resetting: the browser remembers the id of the newest item a player has seen, so a new item on top is shown to everybody who hasn't seen it yet.

**Announce:** new game modes, rules and power-ups, new looks or settings, new online features, anything players would want to try. **Don't announce:** fixes, balancing, refactors, tests, docs, anything invisible. When in doubt, leave it out: the dialog only works if it is rarely there. Three or four items fill a screen, so don't announce five small things; announce the one that matters.

### Write an item

```ts
{
  id: 'refined-look',                       // unique, never reused or renamed once shipped
  date: '2026-10-24',                       // YYYY-MM-DD
  title: { de: 'Refined Look', en: 'Refined Look' },
  text: { de: '…', en: '…' },               // one or two sentences: what it is, why it is fun
  where: { de: 'Einstellungen → Darstellung → Grafik', en: 'Settings → Display → Graphics' },
  image: { src: refinedLook, alt: { de: '…', en: '…' } },  // optional, see below
  open: 'settings',                         // optional "Try it" button, see NewsTarget in src/news/types.ts
}
```

- Both languages, always (`tests/news.test.ts` checks it). German addresses the player as "du". Write like a friend showing a new toy, not like release notes.
- Say **where to find it** in `where`, using the labels exactly as they appear in the UI.
- Newest item first; the test checks the dates.
- Need a new "Try it" target? Add it to `NewsTarget` in `src/news/types.ts` and wire it in `whatsNewScreen` in `src/ui/screens.ts`.

### Make the picture

A picture beats a paragraph, and one that shows *where* the thing is beats both. Pictures are 16:9 `.webp`, well under 250 KB, in `src/news/images/`, imported at the top of `items.ts`.

Start the dev server, then let `npm run shot` take it (it drives headless Chrome; set `CHROME_PATH` if Chrome is elsewhere). The settings are applied before the page loads, `--click` presses buttons by their text, `--mark` draws a ring around what the player should look at:

```bash
npm run dev   # in another terminal
npm run shot -- --out src/news/images/refined-look.webp \
  --settings '{"look":"refined"}' --click "Einstellungen" --mark "Refined Look"
```

`--size WxH` (default 1280x720), `--wait <ms>` and `--url` are there too; see the head of [`scripts/shot.ts`](scripts/shot.ts). The shots are in German. Look at the result before you commit it.

### Try it

Open `http://localhost:5173/?news` to see the newest items again whatever the browser remembers (`?news=off` keeps the dialog away). To test as a player would, clear `slingshot.news.seen` in the browser's local storage while `slingshot.settings.v1` exists (a browser without saved settings counts as a first visit, and first-time visitors are not shown the dialog).

## Language

The UI is German and English, strings live in `src/i18n.ts` (every key in both). Texts of What's New items stay in `src/news/items.ts`, next to the item.
