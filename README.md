# Slingshot

A web remake of the Linux classic [Slingshot](https://wiki.ubuntuusers.de/Spiele/Slingshot/): up to six spaceships fire at each other, and every shot is bent by the gravity of the planets in between. Classic duels, a solar system whose orbits turn after every shot, a gravity royale with a growing black hole (Event Horizon), a daily challenge, CPU opponents and online multiplayer. The UI is available in German and English.

## Getting started

You need [Node.js](https://nodejs.org/) and npm; the multiplayer relay and the tests also need the stable [Rust toolchain](https://rustup.rs/) (including Cargo).

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static build in dist/ – runs on any web server
```

Arrow keys aim (← → angle, ↑ ↓ power), Enter fires. All controls, modes and rules are in [docs/game.md](docs/game.md).

### Multiplayer

Online games go through a small Rust relay. Start it in a second terminal and connect to it from **Multiplayer** in the client (default `ws://localhost:8080`):

```bash
npm run dev:server
```

Hosting, TLS, the relay's environment variables and how online play works are covered in [docs/multiplayer.md](docs/multiplayer.md).

## Documentation

- [docs/game.md](docs/game.md) – controls, game modes, setup, CPU opponents, rules and scoring
- [docs/multiplayer.md](docs/multiplayer.md) – playing online (rooms, oracle) and running the relay
- [benchmarks/README.md](benchmarks/README.md) – the benchmarks

## Development

To inspect the statistics UI with sample history, start `npm run dev:server:stats-demo` in one terminal and run `VITE_MULTIPLAYER_SERVER=ws://localhost:8080 npm run dev` in another. Open `http://localhost:5173/stats`. The demo flag implies `--stats`, writes only to `slingshot-stats-demo.db` (override with `STATS_DEMO_DATABASE`), and refreshes its synthetic statistics on each start; it ignores `DATABASE` and `LEADERBOARD_DB` so normal relay data stays untouched.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Dev server at http://localhost:5173 |
| `npm run build` | Typecheck and build the client into `dist/` |
| `npm run typecheck` | Typecheck the client, tests, benchmarks and scripts |
| `npm run screens` | Build the game and walk every menu page at 13 window sizes in headless Chrome (about 4 minutes with the relay running); fails if anything is cut off (see `scripts/screens.ts`) |
| `npm run screens:quick` | The same at three sizes, under a minute |
| `npm run screens -- --compare [ref]` | What the working tree changed on each page since `HEAD` (or another commit): DOM, element positions and styles; the earlier run is kept in `.screens-baseline/` |
| `npm run shot -- --out <file>` | Screenshot of the running game (headless Chrome; see `scripts/shot.ts`) |
| `npm test` | Run all tests |
| `npm run dev:server` | Rust multiplayer relay (port `8080`, override with `PORT`) |
| `npm run dev:server:stats-demo` | Relay with a separate, refreshed demo database for the Stats page |
| `npm run build:server` | Build the Rust relay in release mode |
| `npm run bench:relay -- ws://localhost:8080` | Measure Rust relay latency, fan-out, real 30 Hz snapshots and synthetic large payloads |

**Debug aim.** `DEBUG_AIM=1 npm run dev` serves the aim-predictor page at `/debug-aim.html`, and shows the in-game seed badge that links to it with the seed, mode and aim of the round on screen. Without the variable the page 404s and the badge stays hidden.

**Tests.** `npm test` builds and tests the Rust relay, so install the stable Rust toolchain (including Cargo) first; `npx vitest` runs only the TypeScript tests and expects the Rust test binary to have been built. The suites take roughly one minute on 8 cores. Vitest runs test files in parallel but the tests inside one file one after the other, so put a long-running test in a file of its own instead of adding it to a big one. Under Vitest every read of an imported binding goes through a getter, which doubled the cost of `Shot.step` until it read its `PHYSICS` constants once into locals; do the same in other hot loops. Comparing huge snapshots with `toEqual` is slow too, so `tests/netsync.test.ts` only falls back to it to explain a mismatch.

**Releases.** Every merge to `main` that passes typecheck and tests is tagged with the next minor version (`vX.Y.0` → `vX.(Y+1).0`), released on GitHub and deployed to GitHub Pages. A commit since the last release with `[major]` in its message makes it a major bump instead (`v(X+1).0.0`); with squash merges that is the PR title or description. Pushing a tag such as `v2.0.0` by hand also works.

## Credits & license

🎯 **Special shoutout to [matthias-Q](https://github.com/matthias-Q)**, co-contributor to this project and the original idea behind this remake.

Slingshot is a from-scratch remake of the game of the same name, written in Python/Pygame by [Jonathan Musther and Bart Mak](https://libregamewiki.org/Slingshot) (2007, GPL-2.0-or-later). This project reuses none of its code or assets; it only follows the original's game idea and rules.

This program is free software: you can redistribute it and/or modify it under the terms of the [GNU General Public License](LICENSE) as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. It is distributed in the hope that it will be useful, but without any warranty; without even the implied warranty of merchantability or fitness for a particular purpose.

Fonts are bundled via [Fontsource](https://fontsource.org/) and licensed under the [SIL Open Font License 1.1](https://openfontlicense.org/):

- [B612 and B612 Mono](https://github.com/polarsys/b612) – © The B612 Project Authors
- [Big Shoulders Stencil Display](https://github.com/xotypeco/big_shoulders) – © Google Inc. / The Big Shoulders Project Authors
