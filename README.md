# Slingshot

A web remake of the Linux classic [Slingshot](https://wiki.ubuntuusers.de/Spiele/Slingshot/): two spaceships take turns firing at each other, and every shot is bent by the gravity of the planets in between. The number, size and position of the planets change every round. Old shot trails stay on screen, so you can feel your way towards a hit.

The UI is available in **German and English**. On the first visit it follows your browser language; switch any time with the *Language* row on the title screen or in the settings.

## Getting started

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static build in dist/ – runs on any web server
```

Tests, the multiplayer relay and the AI benchmarks are covered under [Development](#development).

## Controls

| Key | Action |
| --- | --- |
| ← → | Rotate ship |
| ↑ ↓ | Shot power |
| Enter / Space | Fire (Event Horizon: lock in your aim) |
| Shift | Large steps (×10) |
| Alt | Small steps (×0.1) |
| Ctrl or Alt+Shift | Tiny steps (×0.01) – on macOS the system claims Ctrl+arrows |
| Drag (mouse/touch) | Aim directly, the arrow tip follows the pointer |
| Space | Next round, skip the killcam |
| C | Save the last killcam as a video |
| ← → / 1–5, 0 | Oracle, once you are shot down online: tip hit or miss (turn by turn) / name the ship that gets hit, or 0 for nobody. You can also tap the choices or the ships |
| O | Show or hide the oracle |
| G | Open or close the ghost lane, once you are shot down online. While it is open ← → ↑ ↓ aim and Enter / Space fire (or drag on the panel); the oracle's ← → tips wait until you close it |
| Esc | Menu |
| F | Fullscreen |
| ↑ ↓ ← → Enter (in menus) | Pick a row, change its value (sliders, switches and lists alike), confirm. Home / End jump a slider to its ends; Esc goes back to the row you came from |

## Game modes

- **Daily Challenge** (*Tägliche Herausforderung*) – five sectors with stationary targets and a limited number of shots, the same for everyone on a given calendar day. Today's theme (Billiard, Blind flight, Singularity, Heavy load, Precision, Sniper or Classic) decides which twists the sectors carry; difficulty ramps up through the day and with the weekend. Every target is guaranteed to be hittable. At the end you get a result card with your score and rank, made for screenshots, plus a Wordle-style text to copy. Your best run, attempts and streak are kept in the browser. Add `?daily=YYYY-MM-DD` to the URL to fly another day.
- **Classic** – the original duel, extended to up to six ships. Players take turns, one shot each. A hit ship is out; the round ends when one ship is left.
- **Free for all or teams** – with three or more ships, the *Players* row of the game setup splits them into two or three teams (Ember, Frost, Nebula). Teams share a colour family, start grouped together and take turns alternately, so a small team shoots as often as a big one. The round ends when one team is left. Works in both modes.
- **Event Horizon** (*Ereignishorizont*) – gravity royale. Everyone locks in an aim, then all shots fly at once. After every volley the central black hole grows, swallows planets and drags ships inwards. Kills pay base points × a trick-shot combo (swing-by, bank shot, graze, photon ring, airtime) and get a slow-motion killcam, which you can record as a video clip.
- **Multiplayer** – Classic or Event Horizon online, see [Multiplayer](#multiplayer).

## Game setup

Before a game starts — and for the room in the multiplayer lobby, where only the host can edit it — the rules are sliders and switches in four blocks (match, battlefield, shots, extras). Drag a slider, click its track or use ← →; everything is remembered for the next game, and *Reset rules* puts the defaults back. As in the original, you can toggle invisible planets, reflecting edges, fixed power, planet count, rounds and flight time.

**Shot power** is one choice of three: *Free* (0–100), *Capped* (a maximum from 10 to 90, a low one favours trick shots) or *Fixed* (every shot flies with the same power, 10 to 100 in steps of 5 – only the angle counts). The slider next to the choice appears only for *Capped* and *Fixed*.

The **Players** screen lists the ships (two to six): add a human or a CPU, take a ship out with ✕ and switch between free for all and two or three teams. In team mode every ship picks its team, and *Balance teams* deals them out evenly.

The **Settings** screen holds the device options: sound, fullscreen, particles, language and gravity contours. The browser saves them.

### CPU opponents

The Players screen offers four CPUs, in this order:

| CPU | Style |
| --- | --- |
| Kepler, Newton, Einstein | Easy, medium and hard. They search for a hitting shot and aim with an error that shrinks with every shot of a round. |
| Hawking | Searches like Einstein, with the same aim error, but prefers swing-bys. Enemy hits come first, and self-hit and friendly-hit safety is preserved. Among comparable safe shots it prefers more swing-by passes, then longer flights and paths within the full configured flight limit – also in Classic when trick-shot bonuses are off. |

New CPU seats start as Newton. A further CPU that fits gravity from its own completed shots exists for benchmarks and programmatic matches; it is not offered in the game (see the [AI benchmark](benchmarks/README.md)).

## Rules & scoring

**Classic**

- A hit scores `1000 × shot factor × power factor` points (rounded to 10).
  - Shot factor: 1.0 on the first shot of the round, −0.15 for every further shot, minimum 0.25.
  - Power factor: `1.5 − power/100`, i.e. 0.5 to 1.5. With fixed shot power it is always 1.
- Hitting your own ship – or a teammate – costs 300 points.
- With three or more ships, the last survivor gets 250 points; in team mode every member of the winning team does, fallen ones included.
- After the last round, whoever (or whichever team) has more points wins.
- **Trick-shot bonuses** (optional, off by default): swing-bys, grazes, bank shots and airtime multiply a hit's points just like in Event Horizon (`1000 × shot factor × power factor × combo`).

**Daily Challenge:** a hit pays `1000 × shot factor × power factor × trick-shot combo`, where the shot factor counts the shots spent on *that target* (−0.15 per extra shot, minimum 0.25). Clearing a sector adds 250; hitting yourself costs 300 and ends the sector. Ranks (Cadet … Gravity master) are measured against a flawless-but-plain run.

**Scorecard:** at the end of every round a row of cards under the banner hands out awards – longest shot, fastest kill (timed from the start of the round), most swing-bys, most grazes, best hit and most kills (two or more). Three more cards appear when they were earned: the **closest call** (the narrowest miss of an enemy ship, under 40 px), the **sniper** (a hit from 500 px or more) and the **own-goal king**. The cards that come with a shot take turns: the card is outlined and its shot is redrawn in bright on the field. Only awards somebody actually earned show up, and a tie shares the card. The final screen lists the same awards for the whole match, plus a chart of everybody's score over the rounds. In Classic, swing-bys and grazes are counted even when trick-shot bonuses are off.

## Multiplayer

Set `ALLOWED_ORIGINS` to the frontend's exact origin before startup. For Vite, run `ALLOWED_ORIGINS=http://localhost:5173 npm run dev:server`. The relay refuses to start without an allowlist unless `ALLOW_ALL_ORIGINS=1`.
The Rust relay logs through `tracing`. Set `RUST_LOG=debug` to show each message and room event. The default level (`info`) shows lifecycle events.
In the client, open **Multiplayer**, connect to the relay address (default `ws://localhost:8080`), then create or join a room.

- **Rooms:** choose Classic or Event Horizon, free-for-all or two-team play (everybody picks their own team in the room, the host can deal everybody out again with *Reset teams*) and the rules of the game (rounds, planets, reflective edges, shot power, flight time, …). Both modes support up to six players. Rooms can be protected with a password.
- **Host:** the host can change the rules while the room is waiting and starts the game. The host runs the authoritative simulation and relays state patches to the other players – only what changed since the last tick, so a match needs a few KB/s instead of MB/s. Guests carry a shot's flight on between patches, so it moves smoothly.
- **Event Horizon online:** everybody aims at the same time against one shared clock.
- **Oracle:** whoever is shot down does not just wait. Turn by turn the oracle asks "Will Lena hit?", with simultaneous shots (Event Horizon, or Classic with *Simultaneous shots*) "Who gets hit?". A bar at the bottom edge takes the tip until the shots are away; right tips pay 100 / 150 (a named ship) / 75 (nobody), and every right tip in a row raises the multiplier up to ×3. The other shot-down players' tips appear live above the bar, and after the shot the verdict lists who was right; the round's standings show up for everybody. It is a side standing – it never counts towards winning – and can be switched off in the settings. The host judges the tips, so a relay older than this feature rejects them.
- **Ghost lane:** a second way to pass the time once you are shot down, and the round is not yet decided. About three seconds after your exit the hint *Ghost lane [G]* appears where "Waiting for the others" stood; **G** opens a small, semi-transparent panel in the bottom right corner with a mini field – two or three planets and a target – and your ship as a shadow in your colour. Aim and fire as usual, three shots per lane; a hit brings up the next lane at once. A hit pays 100 (70 % on the second shot, 45 % on the third) plus 50 per swing-by, and every lane cleared in a row raises the multiplier by 0.5 up to ×3; a lane lost ends the series. Everyone flies the same lanes: the seed comes from the round number and the world the round was dealt, which every screen has, so nothing extra travels over the network. The panel closes when the next round starts and rests during the killcam and between rounds, so Enter and Space still skip it. Nothing counts towards the match; it can be switched off in the settings, per device.
- **Lobby:** it remembers your server, name and room settings (separate from the settings of offline games) and reconnects on its own. Leaving a game puts you back into the lobby.
- **Hosting:** for remote players, host both the web client and the relay at reachable addresses. Use a `wss://` address behind TLS when the client is served over HTTPS.

## Development

| Command | Purpose |
| --- | --- |
| `npm run dev` | Dev server at http://localhost:5173 |
| `npm run build` | Typecheck and build the client into `dist/` |
| `npm run typecheck` | Typecheck the client, tests and benchmarks |
| `npm test` | Run all tests |
| `npm run dev:server` | Rust multiplayer relay (port `8080`, override with `PORT`) |
| `npm run build:server` | Build the Rust relay in release mode |
| `npm run bench:relay -- ws://localhost:8080` | Measure Rust relay latency, fan-out, real 30 Hz snapshots and synthetic large payloads |

**Tests.** The suites take roughly 20 seconds on 8 cores. Vitest runs test files in parallel but the tests inside one file one after the other, so put a long-running test in a file of its own (see `tests/experimental-worker-long-*.test.ts`) instead of adding it to a big one. Under Vitest every read of an imported binding goes through a getter, which doubled the cost of `Shot.step` until it read its `PHYSICS` constants once into locals; do the same in other hot loops. Comparing huge snapshots with `toEqual` is slow too, so `tests/netsync.test.ts` only falls back to it to explain a mismatch.

**Releases.** Every merge to `main` that passes typecheck and tests is tagged with the next minor version (`vX.Y.0` → `vX.(Y+1).0`), released on GitHub and deployed to GitHub Pages. Push a tag such as `v2.0.0` for a major bump.

## Credits & license

🎯 **Special shoutout to [matthias-Q](https://github.com/matthias-Q)**, who gave me the idea for this remake.

Slingshot is a from-scratch remake of the game of the same name, written in Python/Pygame by [Jonathan Musther and Bart Mak](https://libregamewiki.org/Slingshot) (2007, GPL-2.0-or-later). This project reuses none of its code or assets; it only follows the original's game idea and rules.

This program is free software: you can redistribute it and/or modify it under the terms of the [GNU General Public License](LICENSE) as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. It is distributed in the hope that it will be useful, but without any warranty; without even the implied warranty of merchantability or fitness for a particular purpose.

Fonts are bundled via [Fontsource](https://fontsource.org/) and licensed under the [SIL Open Font License 1.1](https://openfontlicense.org/):

- [B612 and B612 Mono](https://github.com/polarsys/b612) – © The B612 Project Authors
- [Big Shoulders Stencil Display](https://github.com/xotypeco/big_shoulders) – © Google Inc. / The Big Shoulders Project Authors
