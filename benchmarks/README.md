# Benchmarks

Measurement scripts, run with `tsx`. Nothing here is loaded by the game, but the TypeScript project
typechecks them, so a change to `src/` can break them.

| Command | Source | What it does |
| --- | --- | --- |
| `npm run bench:powerups` | `powerups.ts` | The experimental power-ups: pickups laid, taken and used by CPUs per round, and how easy a pickup is to reach compared with a ship (`--matches`, `--rounds`, `--worlds`) |
| `npm run bench:multikill` | `multi-kill.ts` | How often the multi-kill chain fires in six-CPU rounds: awards per tier, per round and per match, and whether a piercer or a splitter did it (`--matches`, `--rounds`, `--level`, `--amount`) |
| `npm run bench:relay -- ws://localhost:8080` | `relay-perf.ts` | Rust relay latency, fan-out, real 30 Hz snapshots and synthetic large payloads |
| – | `relay-matrix.ts` | JSON, plain MessagePack and MessagePack with envelope on equivalent live relay workloads (`npx tsx benchmarks/relay-matrix.ts ws://localhost:8080 json\|msgpack\|envelope`) |
| – | `relay-profile-load.ts` | Sustained state-frame workload for profiling the relay (`npx tsx benchmarks/relay-profile-load.ts ws://localhost:8080 msgpack\|envelope [seconds]`) |

Reports are written to the paths you pass with `--json`.

## Deterministic matches

`MatchOptions.seed` fixes the complete multi-round world sequence. Each seat has a separate planner random stream. `deterministicCpu: true` completes planner generators without a wall-clock budget, so a seeded match plays out the same on every machine. Normal browser play keeps its frame budget.
