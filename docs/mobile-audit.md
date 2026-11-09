# Mobile audit

`npm run mobile:audit` walks the game as it looks on an iPhone 16 (393×852) and an iPhone 16 Pro Max (440×956), held upright and on its side, and leaves a screenshot of every screen with a list of what looks wrong in it. Run it after any change to layout, the HUD or the touch controls, and read the screenshots: the findings point at things, they do not replace looking.

```
npm run mobile:audit                                   # both phones, both ways held, everything
npm run mobile:audit -- --only game                    # the screens whose name contains "game"
npm run mobile:audit -- --devices iphone-16 --orientations portrait
npm run mobile:audit -- --url http://localhost:5173/   # a game that is already running (`npm run dev`)
npm run mobile:audit -- --relay ws://localhost:8080    # include the online screens (`npm run dev:server` starts a relay; without one they are left out)
```

The result is in `output/mobile-audit/` (not tracked): `index.html` shows every screenshot with its findings beside it (red border: a failure, amber: warnings only), `report.md` and `report.json` list the same. The exit code is 1 when anything fails.

## What it visits

- **Menu pages** — the title, every mode's setup and presets, one mode's rules, crew and rule maker, settings, flight training, the daily challenge. They come from `scripts/screens-pages.ts`, the list `npm run screens` uses; a page added there is visited here too.
- **A match** (`game`, and `game-stick` with the stick instead of the wheel) — played as a person would, one round against CPUs: aiming, the shot in flight, the pause menu, the killcam, the round's end, the result page.
- **Turning** (`turning`, `turning-pointer-flip`) — the phone is turned portrait → landscape → portrait six times in a running match. After every turn the page must catch up: the canvas as big as the window and sharp (its bitmap is the window times the pixel ratio), and the upright layout on exactly when the window is tall. The second run also switches the browser's touch pointer off and on around each turn, which is what the in-app browser's phone emulation does, and what once left the upright layout missing (issue 214).

## What counts

| Finding | Counts as | Meaning |
| --- | --- | --- |
| cut off | failure | an element reaches past the window's edge and no scrolling or clipping parent holds it |
| under the notch or home bar | failure | text or a control sits in the phone's safe area: in landscape at the side around mid-height (where the Dynamic Island is), or a control fixed to the top or bottom |
| in the side safe area (a corner) | warning | the same at the side of a landscape screen, but near its top or bottom corner |
| layout did not follow the turn | failure | see "Turning" |
| text runs out of its box | warning | text wider than the box that is meant to hold it, clipped or spilling |
| text shortened | warning | an ellipsis or line clamp is cutting text; fine for a long name, not for a label |
| small tap target | warning | a button or link under 44 px on its short side |
| safe area not seen by the page | warning | the emulated safe area did not reach the page's CSS, so the checks above are blind to it |

Text drawn on the canvas (the HUD, scores, the killcam strip) is not in the page, so the script cannot measure it: only the screenshots show whether it fits.

## What it is not

Chrome's phone emulation, not iOS Safari: the sizes, the touch screen and the safe area are the phones', but Safari's address bar, the keyboard, the home-screen app's own window and Safari's layout quirks are not in it. A change that matters on a phone still wants a look on one.
