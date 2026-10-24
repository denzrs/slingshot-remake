# Benchmarks

Measurement scripts, run with `tsx`. Nothing here is loaded by the game, but the TypeScript project
typechecks them, so a change to `src/` can break them.

| Command | Source | What it does |
| --- | --- | --- |
| `npm run bench:powerups` | `powerups.ts` | The power-ups: pickups laid, taken and used by CPUs per round, and how easy a pickup is to reach compared with a ship (`--matches`, `--rounds`, `--worlds`) |
| `npm run bench:multikill` | `multi-kill.ts` | How often the multi-kill chain fires in six-CPU rounds: awards per tier, per round and per match, and whether a piercer or a splitter did it (`--matches`, `--rounds`, `--level`, `--amount`) |
| `npm run bench:relay -- ws://localhost:8080` | `relay-perf.ts` | Rust relay latency, fan-out, real 30 Hz snapshots and synthetic large payloads |
| `npm run bench:stats` | `stats-perf.ts` | What the match statistics cost the relay: the same load on the relay without and with `--stats` (state latency, CPU, memory, rows and bytes written), plus the statistics page's readers, games told from one device, and fetching a replay (`ROOMS`, `SECONDS`, `READERS`, …) |
| `npm run bench:client` | `client-perf.ts` | What the statistics cost the game's own simulation: seeded CPU matches without the shot log, with it, with the reports an online host builds and with a local game's report, against the same match flown again from its recording (`MATCHES`, `ROUNDS`) |
| `npm run bench:browser` | `browser-perf.ts` | Frame times in headless Chromium of a build without a relay (nothing is sent) against one with it: the title screen, a match, a replay and the statistics page (`SECONDS`, `MATCH_SECONDS`, `CHROME`) |
| – | `relay-matrix.ts` | JSON, plain MessagePack and MessagePack with envelope on equivalent live relay workloads (`npx tsx benchmarks/relay-matrix.ts ws://localhost:8080 json\|msgpack\|envelope`) |
| – | `relay-profile-load.ts` | Sustained state-frame workload for profiling the relay (`npx tsx benchmarks/relay-profile-load.ts ws://localhost:8080 msgpack\|envelope [seconds]`) |
| – | `report-volume.ts` | What a host reports to the statistics per round and turn (turns, shots, placements, simulated seconds), with CPUs at two and six seats; sizes the relay's `STATS_ROWS_PER_DAY` (`MATCHES`, `ROUNDS`) |

Reports are written to the paths you pass with `--json`. The three statistics benchmarks write their figures as JSON to the path in `BENCH_JSON`.

## Deterministic matches

`MatchOptions.seed` fixes the complete multi-round world sequence. Each seat has a separate planner random stream. `deterministicCpu: true` completes planner generators without a wall-clock budget, so a seeded match plays out the same on every machine. Normal browser play keeps its frame budget.
