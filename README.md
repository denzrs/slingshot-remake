# Slingshot

A web remake of the Linux classic [Slingshot](https://wiki.ubuntuusers.de/Spiele/Slingshot/): two spaceships take turns firing at each other, and every shot is bent by the gravity of the planets in between. The number, size and position of the planets change every round. Old shot trails stay on screen, so you can feel your way towards a hit.

The UI is available in **German and English**. On the first visit it follows your browser language; switch any time with the *Language* row on the title screen or in the settings.

## Getting started

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # physics, scoring and CPU tests
npm run build      # static build in dist/ – runs on any web server
```

## Multiplayer

Start the relay server in a second terminal with `npm run dev:server`. In the client, open
**Multiplayer**, connect to the relay address (default `ws://localhost:8080`), then create or join
a room. Choose Classic or Event Horizon, free-for-all or two-team play and the rules of the game
(rounds, planets, reflective edges, fixed power, flight time, …); the host can still change the rules
while the room is waiting, and the host starts the game. Both modes support up to six players. In
Event Horizon online everybody aims at the same time against one shared clock. The lobby remembers
your server, name and room settings and reconnects on its own. The host runs the authoritative simulation and relays
state patches to the other players (only what changed since the last tick, so a match needs a few KB/s instead of MB/s); guests carry a shot's flight on between patches, so it moves smoothly. Rooms can be protected with a password, and leaving a game puts you back into the lobby. For remote players, host both the web client and relay server at reachable addresses.
The relay can also be built with `npm run build:server` and started with `npm run start:server` (output in `dist-server/`). Use a `wss://` address behind TLS when the client is served over HTTPS.

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
| Esc | Menu |
| F | Fullscreen |

## Game modes

- **Daily Challenge** (*Tägliche Herausforderung*) – five sectors with stationary targets and a limited number of shots, the same for everyone on a given calendar day. Today's theme (Billiard, Blind flight, Singularity, Heavy load, Precision, Sniper or Classic) decides which twists the sectors carry; difficulty ramps up through the day and with the weekend. Every target is guaranteed to be hittable. At the end you get a result card with your score and rank, made for screenshots, plus a Wordle-style text to copy. Your best run, attempts and streak are kept in the browser. Add `?daily=YYYY-MM-DD` to the URL to fly another day.
- **Classic** – the original duel, extended to up to six ships. Players take turns, one shot each. A hit ship is out; the round ends when one ship is left.
- **Free for all or teams** – with three or more ships, the *Players* row of the game setup splits them into two or three teams (Ember, Frost, Nebula). Teams share a colour family, start grouped together and take turns alternately, so a small team shoots as often as a big one. The round ends when one team is left. Works in both modes.
- **Event Horizon** (*Ereignishorizont*) – gravity royale. Everyone locks in an aim, then all shots fly at once. After every volley the central black hole grows, swallows planets and drags ships inwards. Kills pay base points × a trick-shot combo (swing-by, bank shot, graze, photon ring, airtime) and get a slow-motion killcam, which you can record as a video clip.

## Rules & scoring (Classic)

- A hit scores `1000 × shot factor × power factor` points (rounded to 10).
  - Shot factor: 1.0 on the first shot of the round, −0.15 for every further shot, minimum 0.25.
  - Power factor: `1.5 − power/100`, i.e. 0.5 to 1.5. With fixed shot power it is always 1.
- Hitting your own ship – or a teammate – costs 300 points.
- With three or more ships, the last survivor gets 250 points; in team mode every member of the winning team does, fallen ones included.
- After the last round, whoever (or whichever team) has more points wins.

**Daily Challenge scoring:** a hit pays `1000 × shot factor × power factor × trick-shot combo`, where the shot factor counts the shots spent on *that target* (−0.15 per extra shot, minimum 0.25). Clearing a sector adds 250; hitting yourself costs 300 and ends the sector. Ranks (Cadet … Gravity master) are measured against a flawless-but-plain run.

**Scorecard:** at the end of every round a row of cards under the banner hands out awards – longest shot, fastest kill (timed from the start of the round), most swing-bys, most grazes, best hit and most kills (two or more). Three more cards appear when they were earned: the **closest call** (the narrowest miss of an enemy ship, under 40 px), the **sniper** (a hit from 500 px or more) and the **own-goal king**. The cards that come with a shot take turns: the card is outlined and its shot is redrawn in bright on the field. Only awards somebody actually earned show up, and a tie shares the card. The final screen lists the same awards for the whole match, plus a chart of everybody's score over the rounds. In Classic, swing-bys and grazes are counted even when trick-shot bonuses are off.

**Trick-shot bonuses in Classic** (optional, off by default): swing-bys, grazes, bank shots and airtime multiply a hit's points just like in Event Horizon (`1000 × shot factor × power factor × combo`).
As in the original, you can toggle invisible planets, reflecting edges, fixed shot power, the maximum number of planets and the number of rounds per game. On top of that there are CPU opponents in four strengths, including experimental, and a maximum flight time. Experimental estimates gravity from its own past shots. These rules (plus the players and teams) live on the **setup screen** that opens when you pick a mode, right before the game starts – also from *New game* in the pause menu. The **settings** screen only keeps what concerns this device: gravity contour lines, particles, sound, fullscreen and language. Everything is saved in the browser.

## Tech

Vite + TypeScript + Canvas 2D, with no engine and no runtime dependencies besides three self-hosted fonts.

| File | Purpose |
| --- | --- |
| `src/physics.ts` | Shot integration (semi-implicit Euler, fixed time step 1/240 s), collisions, edges, trick-shot tracking |
| `src/world.ts` | Random battlefields from a seed |
| `src/game/` | Match state machines: aiming → flight → round end → final score (`classic.ts`, `horizon.ts`, shared base in `match.ts`) |
| `src/volley.ts` | Simultaneous shots for Event Horizon, including projectile clashes |
| `src/ai.ts`, `src/experimental-ai.ts` | CPU search and trajectory-based experimental gravity fitting |
| `src/scoring.ts` | Scoring formulas and trick-shot multipliers |
| `src/stats.ts`, `src/scorecard.ts` | Per-round and per-match records (longest shot, fastest kill, swing-bys, …) and the awards drawn from them |
| `src/challenge.ts` | Daily challenge generator: date → seed → theme → sector specs → worlds. Targets sit on the path of a probe shot, so every sector has a known solution (pure and deterministic, no DOM) |
| `src/game/challenge.ts` | `ChallengeMatch`: one pilot, stationary targets, a shot budget per sector |
| `src/dailyStore.ts` | Best run per day, attempts and streak in `localStorage` |
| `src/render/` | Engraved planets (hatching shader on ImageData), equipotential contour lines (marching squares), black hole lensing, backdrop, particles, HUD |
| `src/ui/` | DOM menus with keyboard navigation |
| `src/i18n.ts` | UI translations (`de` / `en`), `t()` lookup with `{placeholders}`, number formatting, runtime language switch |
| `src/audio.ts` | Synthesized sound effects via the Web Audio API |
| `src/clip.ts` | Records the killcam canvas to a downloadable video |

The physics is deterministic, and the CPU planner uses exactly the same `Shot` class as the game. What the CPU predicts is exactly how the shot flies – and it is also what makes the killcam replays exact.

## AI benchmark

Run `npm run bench:experimental -- --sims 100 --seed 99540653` to compare experimental CPU against easy, medium and hard CPU on repeatable worlds. Add `--mode=horizon`, `--bounce`, `--fixed-power`, or `--planets=1..8` to test one ruleset. Add `--opening-low-probe` only to compare the low-power opening-probe experiment. Results group match win rate and map RMS by total shots. They also show first-shot, second-shot, and later-shot hit rates and held-out error.

Run `npm run bench:team -- --seed 99540653` for 100 seeded Classic 3v3 team matches: experimental CPUs versus medium CPUs. It uses 60-second flight limits and simultaneous shots. Add `--games=1..100` for a smaller run. The result shows wins, draws, mean team scores, and mean shots.

Experimental fits its own launch states and sampled positions through the production Euler step. It uses bounded positive masses and several start points. It keeps distinct plausible maps instead of trusting one fit. A held-out completed trajectory checks prediction quality.

The CPU opens with one safe power-45 coverage probe. Afterward it fires ensemble-stable hits with medium perturbation and low-power preference. `--opening-low-probe` remains a benchmark-only comparison of powers `25`, `35`, `45`, and `55`.

Set `EXPERIMENTAL_AI_LOGS=1` to print each experimental fit during the benchmark. Set `VITE_EXPERIMENTAL_AI_LOGS=1` before `npm run dev` to print logs in the browser. Logs include fit time, held-out RMS, chosen action, map errors, and trajectory-fit RMS. The fitter uses at most 500 trajectory samples.

## Credits & license

🎯 **Special shoutout to [matthias-Q](https://github.com/matthias-Q)**, who gave me the idea for this remake.

Slingshot is a from-scratch remake of the game of the same name, written in Python/Pygame by [Jonathan Musther and Bart Mak](https://libregamewiki.org/Slingshot) (2007, GPL-2.0-or-later). This project reuses none of its code or assets; it only follows the original's game idea and rules.

This program is free software: you can redistribute it and/or modify it under the terms of the [GNU General Public License](LICENSE) as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. It is distributed in the hope that it will be useful, but without any warranty; without even the implied warranty of merchantability or fitness for a particular purpose.

Fonts are bundled via [Fontsource](https://fontsource.org/) and licensed under the [SIL Open Font License 1.1](https://openfontlicense.org/):

- [B612 and B612 Mono](https://github.com/polarsys/b612) – © The B612 Project Authors
- [Big Shoulders Stencil Display](https://github.com/xotypeco/big_shoulders) – © Google Inc. / The Big Shoulders Project Authors
