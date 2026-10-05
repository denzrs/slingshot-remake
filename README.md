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
a room. Choose Classic or Event Horizon, plus free-for-all or two-team play; the host starts the
game. Both modes support up to six players. The host runs the authoritative simulation and relays
state patches to the other players (only what changed since the last tick, so a match needs a few KB/s instead of MB/s). Rooms can be protected with a password, and leaving a game puts you back into the lobby. For remote players, host both the web client and relay server at reachable addresses.
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

**Trick-shot bonuses in Classic** (optional, off by default): swing-bys, grazes, bank shots and airtime multiply a hit's points just like in Event Horizon (`1000 × shot factor × power factor × combo`).

As in the original, you can toggle invisible planets, reflecting edges, fixed shot power, the maximum number of planets and the number of rounds per game. On top of that there are CPU opponents in three strengths and a maximum flight time. These rules (plus the players and teams) live on the **setup screen** that opens when you pick a mode, right before the game starts – also from *New game* in the pause menu. The **settings** screen only keeps what concerns your device: gravity contour lines, particles, sound, fullscreen and language. Everything is saved in the browser.

## Tech

Vite + TypeScript + Canvas 2D, with no engine and no runtime dependencies besides three self-hosted fonts.

| File | Purpose |
| --- | --- |
| `src/physics.ts` | Shot integration (semi-implicit Euler, fixed time step 1/240 s), collisions, edges, trick-shot tracking |
| `src/world.ts` | Random battlefields from a seed |
| `src/game/` | Match state machines: aiming → flight → round end → final score (`classic.ts`, `horizon.ts`, shared base in `match.ts`) |
| `src/volley.ts` | Simultaneous shots for Event Horizon, including projectile clashes |
| `src/ai.ts` | CPU: random search + hill climbing over the same physics, spread shrinks with every shot |
| `src/scoring.ts` | Scoring formulas and trick-shot multipliers |
| `src/challenge.ts` | Daily challenge generator: date → seed → theme → sector specs → worlds. Targets sit on the path of a probe shot, so every sector has a known solution (pure and deterministic, no DOM) |
| `src/game/challenge.ts` | `ChallengeMatch`: one pilot, stationary targets, a shot budget per sector |
| `src/dailyStore.ts` | Best run per day, attempts and streak in `localStorage` |
| `src/render/` | Engraved planets (hatching shader on ImageData), equipotential contour lines (marching squares), black hole lensing, backdrop, particles, HUD |
| `src/ui/` | DOM menus with keyboard navigation |
| `src/i18n.ts` | UI translations (`de` / `en`), `t()` lookup with `{placeholders}`, number formatting, runtime language switch |
| `src/audio.ts` | Synthesized sound effects via the Web Audio API |
| `src/clip.ts` | Records the killcam canvas to a downloadable video |

The physics is deterministic, and the CPU planner uses exactly the same `Shot` class as the game. What the CPU predicts is exactly how the shot flies – and it is also what makes the killcam replays exact.

## Credits & license

🎯 **Special shoutout to [matthias-Q](https://github.com/matthias-Q)**, who gave me the idea for this remake.

Slingshot is a from-scratch remake of the game of the same name, written in Python/Pygame by [Jonathan Musther and Bart Mak](https://libregamewiki.org/Slingshot) (2007, GPL-2.0-or-later). This project reuses none of its code or assets; it only follows the original's game idea and rules.

This program is free software: you can redistribute it and/or modify it under the terms of the [GNU General Public License](LICENSE) as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. It is distributed in the hope that it will be useful, but without any warranty; without even the implied warranty of merchantability or fitness for a particular purpose.

Fonts are bundled via [Fontsource](https://fontsource.org/) and licensed under the [SIL Open Font License 1.1](https://openfontlicense.org/):

- [B612 and B612 Mono](https://github.com/polarsys/b612) – © The B612 Project Authors
- [Big Shoulders Stencil Display](https://github.com/xotypeco/big_shoulders) – © Google Inc. / The Big Shoulders Project Authors
