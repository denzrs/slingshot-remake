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
As in the original, you can toggle invisible planets, reflecting edges, fixed power, planet count, rounds, and flight time.
The setup screen contains these rules, players, teams, and CPU choices.
The setup offers the original easy, medium, and hard AIs plus `experimental-easy`, `experimental-medium`, and `experimental-hard`.
The original AIs remain unchanged. Experimental AIs learn gravity from their own completed shots.
The settings screen contains device options, such as sound, fullscreen, particles, language, and gravity contours.
The browser saves these settings.

## Tech

Vite + TypeScript + Canvas 2D, with no engine and no runtime dependencies besides three self-hosted fonts.

| File | Purpose |
| --- | --- |
| `src/physics.ts` | Shot integration (semi-implicit Euler, fixed time step 1/240 s), collisions, edges, trick-shot tracking |
| `src/world.ts` | Random battlefields from a seed |
| `src/game/` | Match state machines: aiming → flight → round end → final score (`classic.ts`, `horizon.ts`, shared base in `match.ts`) |
| `src/volley.ts` | Simultaneous shots for Event Horizon, including projectile clashes |
| `src/ai.ts`, `src/experimental-ai.ts` | CPU search and trajectory-based experimental gravity fitting |
| `src/experimental-worker.ts`, `src/experimental-worker-client.ts` | Background observation fitting and worker lifecycle |
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

The physics is deterministic. The CPU planner and killcam use the same production `Shot` integrator as the game. Experimental predictions can differ because the learner estimates hidden masses.

## AI benchmark

### Controls and information limits

The custom `experimental` CPU remains available for benchmarks and programmatic matches, but not in the setup choices.
Its controls are `MatchOptions.experimentalLearningRate` and `MatchOptions.experimentalStartingKnowledge`.
Both accept values from `0` to `1`, inclusive, and default to `1`.
The match and direct learner APIs clamp finite values to this range.
Explicit `NaN`, `Infinity`, and `-Infinity` values become `0`.
The browser has no sliders for these controls. They apply only to the custom `experimental` CPU.
Named presets use fixed per-seat values, even when a match contains different experimental presets:

| CPU name | Learning rate | Starting knowledge |
| --- | --- | --- |
| `experimental-easy` | 0.35 | 0.5 |
| `experimental-medium` | 0.54 | 0.72 |
| `experimental-hard` | 0.72 | 0.9 |

The browser saves each selected seat by name. Reloading preserves its preset.

- Learning rate `0` freezes evidence updates. Completed shots still count as observations.
- Learning rate `1` applies each unique own shot's full fitted update when trajectory samples support it.
- Intermediate learning rates scale evidence updates, not aim noise or search precision.
- Starting knowledge `1` uses the public density model and known initial black-hole mass as the opening prior.
- Starting knowledge `0` starts with minimal gravity knowledge and broad mass uncertainty. Visible collision geometry remains known.
- Intermediate starting knowledge changes initial mass beliefs and uncertainty, not the evidence update rate.

Use `createExperimentalLearner(startingKnowledge?: number)` to create a learner with immutable starting knowledge.
Use `observeExperimentalShot(learner, shot, observedWorld, learningRate)` to apply evidence.
Use `experimentalLearnerFit(learner, visibleWorld)` to inspect its current belief and diagnostics.
`planExperimentalShot` accepts optional `learner`, `learningRate`, and `startingKnowledge` options.
Its starting-knowledge option applies only when no learner is supplied. It never overwrites an existing learner's belief.

The learner receives visible planet centers, radii, stable IDs, and visible black-hole geometry. It never receives true masses.
Invisible planets supply only their count. The learner estimates anonymous positions from trajectories when planets are invisible.

The learner keeps evidence separately from displayed trails and resets each round.
Each unique completed own shot counts once. Sample-free shots add no learned evidence.
The learner retains up to 12 same-field shots. Each fitting update uses up to 96 samples across those trajectories.

In normal browser matches, a worker fits experimental observations outside the rendering thread.
The worker stores each CPU's retained trajectory history. Each request sends only the new completed shot and public geometry.
The main thread receives the fitted belief and diagnostics, not the retained trajectory history.
The fitting algorithm, evidence limits, learning rates, starting knowledge, and CPU difficulty remain unchanged.

The match waits for all completed-shot updates before the next aim or Event Horizon collapse.
During this wait, rendering continues. The next CPU aim uses the completed update, not stale knowledge.
Completed-shot reports contain that shot's counters and pre-update prediction diagnostics.
Round resets, rematches, and restored snapshots invalidate pending updates. Field transitions update the worker's public geometry in order.
Deterministic matches and environments without browser workers use the same learner synchronously.

Trajectory sensitivity determines estimated mass uncertainty. Short, low-information shots retain prior-scale uncertainty instead of narrowing it from shot count alone. The planner evaluates up to nine visible-geometry hypotheses with independent planet-density changes. Hidden-position fits add one alternative position estimate, for at most ten hypotheses. An `exploit` decision means the selected aim has positive expected enemy-hit probability across these hypotheses. It does not guarantee a hit in every hypothesis or the true world.

The planner searches safe alternatives before it returns a fallback. `unsafeRate` reports the fraction of evaluated hypotheses where the selected launch hits itself or a teammate. Zero means safe in those hypotheses, not proven safe in the true world.

Event Horizon carries visible estimated masses by stable planet ID. Public collapse rules update estimated black-hole growth and swallowed mass. Hidden planets have no survivor IDs. Public count or epoch changes reset anonymous positions and discard old-field evidence. Hidden count losses use estimated anonymous masses, not true swallowed masses. The learner does not fit old and new gravity fields as one static field.

`MatchOptions.seed` fixes the complete multi-round world sequence. Each seat has a separate planner random stream. `deterministicCpu: true` completes planner generators without a wall-clock budget. Normal browser play keeps its frame budget. `onExperimentalDecision` reports learning diagnostics independently of logging. `onShotComplete` reports authoritative shot outcomes for every seat, not killcam replays.

### Matrix commands

```bash
# One matched pair for a quick run.
npm run bench:experimental -- --mode=classic --format=1v1 --opponent=easy --rate=1 --knowledge=1 --pairs=1 --rounds=1 --json=results/smoke.json

# Full matrix with 50 independent matched worlds per cell.
npm run bench:experimental -- --pairs=50 --json=results/matrix.json

# Independent confirmation with another seed.
npm run bench:experimental -- --pairs=50 --seed=271828 --json=results/matrix-confirmation.json

# Select a smaller matrix for tuning.
npm run bench:experimental -- --modes=classic,horizon --formats=3v3 --opponents=medium --rates=0,0.1,0.35,1 --knowledge=0,0.5,1 --pairs=10 --rounds=5 --seed=99540717
```

The default matrix contains all 162 combinations:

| Axis | Values |
| --- | --- |
| Mode | Classic, Event Horizon |
| Format | 1v1, 2v2, 3v3 |
| Opponent | easy, medium, hard |
| Experimental learning rate | 0.1, 0.35, 1 |
| Experimental starting knowledge | 0, 0.5, 1 |

The defaults are 10 pairs per cell and five complete rounds per match. Ten pairs are exploratory, not evidence of parity.
Each pair plays the same seeded world sequence twice, with experimental on opposite sides.
The world sequence matches across learning rates, starting knowledge, and opponents.
Teams keep fixed seat assignments `[0, 1, 0, 1, 0, 1]`.

Every shot has a **60-second physics flight limit**, not a 60-second match limit. The matrix disables bounce, fixed power, invisible planets, trick-shot bonuses, and neighbor grace. Classic teams use simultaneous volleys. Classic 1v1 uses sequential shots. Event Horizon always uses volleys. The runner advances round screens and killcams without changing shot physics.

Use singular or plural mode, format, opponent, and rate filters.
`--knowledge=0,0.5,1` selects the starting-knowledge grid. `--starting-knowledge=0.5` is an alias.
Both `--key=value` and `--key value` work.
`--deterministic=false` selects the normal frame-budget path, which can depend on machine speed.

### Metrics

The final scoreboard determines match wins, losses, and draws. Scores follow CPU ownership after the side swap, not a fixed team.
Round results remain separate. An unfinished match is a failure, never a draw.
JSON schema version `3` includes both controls in options, raw legs, final rows, launch decisions, and completed-shot observations.
Calibration rejects historical schema `2` because it lacks starting-knowledge identity. It also rejects schema `1`, which lacks authoritative outcomes.
Neither historical schema is upgraded by guessing missing evidence.

Matrix and learning-validation reports include `codeFingerprint: { algorithm, digest, sources }`.
Both CLIs print the SHA256 code identity and exact relative source paths.
The digest covers fixed ordered production learner, planner, physics, world-generation, and match-integration sources, plus `benchmarks/ai-matrix.ts` and `benchmarks/ai-metrics.ts` to identify the executed experiment. It includes paths and byte lengths.
It excludes package metadata, other benchmark harnesses, tests, and research files. It requires no git or network access.
Identical source bytes give the same identity regardless of checkout path. Selected source edits change the identity.
Schema `3` reports without this field have unknown code identity, not the current checkout's identity.

Raw launch decisions record the belief available before firing. Raw completed-shot observations record the update after that shot, including terminal shots. Prediction RMS measures that shot before its update, not training residual after fitting. Sample-free updates report zero fit time and no prediction RMS.

A round reset clears evidence counts. Horizon field changes can clear retained evidence without clearing cumulative observed or learned counts. Anonymous position resets retain estimated mean mass and mass uncertainty, without identifying survivors. True-field map RMS is a benchmark diagnostic only. The planner never receives this truth.

A field transition clears old-field fit and forecast diagnostics from the next launch.
Completed-shot observations remain immutable history for their original field.
Browser console decision logs include `fit` and `reconstruction` details when `VITE_EXPERIMENTAL_AI_LOGS=1`.
`fit.rms` measures retained trajectories after assimilation. `fit.initialRms` is the optimizer's starting residual.
`reconstruction.relativeGravityErrorPercent` measures estimated gravity error across the diagnostic grid. Lower values are better, and zero is exact.
Per-planet entries show true and estimated masses and positions, with absolute and percentage errors. Black-hole estimates and mass errors appear separately.
True masses are console diagnostics only. They never enter the planner. Missing fit or prediction values remain `null`.

Schema version `3` summarizes prediction RMS and prediction samples from these observations, not later launch diagnostics.

| Metric | Meaning |
| --- | --- |
| Leg win points | `(wins + 0.5 × draws) / completed legs` |
| Paired win points | Mean of each world's two leg win points. Bounded Hoeffding 95% interval across complete independent pairs. |
| Paired score win points | Win=1, draw=0.5, loss=0 for each world's combined two-leg score. Same bounded Hoeffding 95% interval. |
| Paired score delta | Sum of experimental-minus-opponent scores across both legs. Separate descriptive Student-t 95% interval across worlds. |
| Paired score-win interval | Wilson 95% interval for strict combined-score wins. Draws count as not-wins. |
| Side results | Separate results for each experimental side assignment |
| Fired / completed / unfinished | Authoritative shot counts across every round and player |
| Ship hit rate | Ship-impact shots divided by completed shots. A hit is not necessarily an enemy kill. |
| Enemy hit rate | Enemy ship-impact shots divided by completed shots. Missing hit attribution makes this metric unavailable. |
| Kills | Offensive kills, self-kills, friendly kills, and black-hole deaths remain separate |
| Shots per kill | Fired shots divided by offensive kills. No offensive kills means unavailable. |
| Shot stages | First, second, and third-or-later own shots within each round, each with its own denominator |
| Observed / learned / retained | Evidence counts recorded after each unique completed own shot, including the final shot |
| Prediction RMS | New completed-shot position error measured before its fitted update, with pre-collapse observation geometry |
| Update fit time | Fitted-update time from the completed-shot observation, in milliseconds |
| Launch fit time / map RMS | Separate launch diagnostics. Map error uses a grid and normalization by true gravity magnitude. |
| Flight time | Simulated flight seconds, with overall and outcome-specific distributions |

Distributions report sample and missing counts, mean, p50, p90, p95, minimum, and maximum. Missing values remain `null`. A measured zero remains zero. Prediction and evidence distributions use completed shots as their denominator. Launch diagnostics use fired shots. Reports include observation counts and missing-observation counts. Shot samples are correlated and do not create independent match evidence.

For `n` complete independent pairs, bounded intervals use radius `sqrt(log(40) / (2 × n))`, clipped to `[0, 1]`. Zero pairs produce no interval. All-win, all-loss, and all-draw samples keep a nonzero interval width. Score-delta intervals describe unbounded scores and do not establish a win-probability guarantee.

The strength target is 40–60% balanced win points against hard at learning rate `1` and starting knowledge `1`.
Lower knowledge and slower learning are candidate controls for easy and medium strength, subject to measured evidence.
Use enough pairs and an independent confirmation seed. A wide interval that contains 50% does not establish parity.
Raw reports describe measured code, settings, and seeds. They do not guarantee strength.

The current benchmark work does not establish parity. Reports from earlier code do not verify later learner changes. Small training residuals do not establish global map recovery.

### Current measured state

The user stopped further benchmarks after these measurements. Logs and raw JSON reports remain in `.scratch/ai-benchmarks/`.
These results use seed `271828`, deterministic CPU planning, and five rounds per match.
Each complete cell contains 100 matches from 50 side-swapped world pairs, with no recorded failures.

The strongest control setting, learning rate `1` and starting knowledge `1`, completed all six cells against the original hard AI.

| Mode | 1v1 match wins | 2v2 match wins | 3v3 match wins |
| --- | --- | --- | --- |
| Classic | 61% | 49% | 48% |
| Event Horizon | 75% | 71% | 70% |

These cells contain no draws. Classic 2v2 and 3v3 meet the 40–60% point target, but the setting does not meet it across all formats.

The candidate level settings below have partial confirmation reports. The table includes only complete cells, not estimates from unfinished cells.
Values are match win points: a win counts as `1`, a draw as `0.5`, and a loss as `0`.

| Opponent | Rate | Starting knowledge | Classic 1v1 | Classic 2v2 | Classic 3v3 | Event Horizon 1v1 | Event Horizon 2v2 | Event Horizon 3v3 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| easy | 0.35 | 0.5 | 50.5% | 52.5% | — | — | — | — |
| medium | 0.6 | 0.8 | 67% | 61% | 55% | 43% | — | — |
| hard | 0.8 | 1 | 41% | 33% | 38% | 72% | 65% | — |

The easy, medium, and hard reports completed two, four, and five of six cells, respectively.
An em dash means no complete confirmation cell. The user intentionally stopped the remaining work.
No universal per-level preset has been proved across Classic and Event Horizon at all three formats.
The three named presets use these candidate settings. Their measured strength does not prove balance across every mode and format.
The custom `experimental` CPU keeps both programmatic controls. The original easy, medium, and hard AIs remain unchanged.

### Consolidated setting calibration

```bash
# Measure all cells before choosing each level's rate and starting knowledge.
npm run bench:experimental -- --modes=classic,horizon --formats=1v1,2v2,3v3 --opponents=easy,medium,hard --rates=0,0.1,0.35,1 --knowledge=0,0.5,1 --pairs=50 --rounds=5 --seed=99540717 --deterministic=true --json=results/matrix.json

# Independent worlds, identical code, rules, rounds, formats, rates, and starting knowledge.
npm run bench:experimental -- --modes=classic,horizon --formats=1v1,2v2,3v3 --opponents=easy,medium,hard --rates=0,0.1,0.35,1 --knowledge=0,0.5,1 --pairs=50 --rounds=5 --seed=271828 --deterministic=true --json=results/matrix-confirmation.json

# Read existing reports; do not rerun matches or scrape console logs.
npm run bench:calibration -- results/matrix.json results/matrix-confirmation.json --json=results/calibration.json
```

The console shows complete and partial cells, candidate presets, and unstarted-cell counts.
JSON retains every declared cell, uncertainty, missing evidence, worst cells, and all candidates.
`pairedSettingDeltas` compares both-knob settings on shared seeded worlds and lists unmatched worlds.
Opponent-balanced statistics hold both knobs fixed. They never pool different starting-knowledge settings or count them as independent evidence.
Code identities, seeds, round counts, and deterministic settings remain separate cohorts. Incompatible rules are rejected.

Recommendations map easy, medium, and hard to separate `selectedSetting: { learningRate, startingKnowledge }` presets.
`scope: level` covers one opposing level across all measured modes and formats.
`scope: cell` provides optional mode/format tuning. There is no universal all-opponent setting.
Measured evidence selects settings. Tied evidence does not force different presets or establish an unmeasured level mapping.
Candidates prioritize worst-cell target distance, aggregate target distance, closeness to 50%, then numeric rate and starting knowledge.
Missing or incomplete required cells block a candidate. `outside-target` identifies the nearest complete candidate, not a balanced preset.

`confirmation-required` needs a 40–60% point estimate and at least 50 complete pairs in every selected cell.
It also needs deterministic settings and known code identity.
`confirmed-target` requires the same rate and starting knowledge on an independent seed for every selected cell.
Confirmation must satisfy the same target and pair count, with matching fingerprint, source list, rules, rounds, and deterministic settings.
Reused worlds, different knobs, or a format-specific success cannot confirm a cross-format preset.
This is point-target screening, not proof of parity. Unknown code identity cannot confirm current-code strength.
Mixed identities block recommendations but retain separate descriptive groups. After a source change, regenerate both runs before claiming current-code confirmation.

Partial reports remain partial: missing cells, incomplete matched pairs, failed legs, and unavailable measurements are not converted to zero or draws. Complete matched worlds supply the independent sample count for win-point uncertainty. Shot and prediction statistics are diagnostics, not extra independent match samples. An exploratory recommendation or a wide interval spanning the target is not a parity result.

### Held-out learning validation

```bash
npm run bench:learning -- --json=learning-validation.json
npm test -- tests/ai-learning.test.ts tests/ai-benchmark.test.ts
```

The deterministic suite records production `Shot` trajectories on three fixed layouts.
It compares rates `0`, `0.1`, `0.35`, and `1` at each starting-knowledge setting `0` and `1`.
Each setting uses history budgets `0`, `1`, `2`, `4`, and `8`.
Rate comparisons always start with identical knowledge. Different knowledge settings remain separate.
Future launches remain excluded from training, including probe angles outside the training range.
The suite measures full-trail RMS and endpoint error against the hidden true world.

Declared gates require a frozen rate-zero baseline, rate-independent initial beliefs, repeat-observation idempotency, and substantive improvement from evidence.
Both zero-knowledge and informed suites must improve the rate-one median by at least 25% against their identical-knowledge frozen reference.
Aggregate final error must not rise with learning rate at either starting-knowledge setting.
The informed rate-one median must improve over one-shot history and reach at most two pixels.
Its 95th-percentile endpoint error must remain within 5% of the board diagonal.

The suite also checks an Event Horizon transition. Both learners receive identical public growth rules. Learned estimates must improve future prediction without old-field residuals.

Three scenarios supply four actual AI-chosen observations each, separately at starting knowledge `0` and `1`.
They include independent unequal planet densities and an off-center Event Horizon hole.
Learned and frozen beliefs receive identical observations and predict the same held-out launches.
At each starting-knowledge setting, the curated Classic case and fixed-suite aggregate must improve median trail RMS by at least 25%.
Individual arbitrary worlds need not improve monotonically.

Short boundary-exit shots check that unusable samples add no learned evidence.
Tiny remote trajectories check that subpixel fit residuals retain mass uncertainty. Such residuals do not certify future accuracy.
The CLI prints gate results, the fingerprint, and separate rate/knowledge/history tables with prediction and evidence diagnostics.
Actual-shot tables compare learned and frozen errors without pooling knowledge settings.
Probe distributions describe this fixed suite. They are not match-strength confidence intervals.
`--json=path` saves raw cells and gate diagnostics. The CLI exits nonzero when any declared gate fails.

This suite covers visible geometry, not global recovery of hidden source positions. Shot termination agreement is not optimal planner-action agreement. Held-out trajectories establish prediction accuracy only for the declared layouts and launches. The independent matrix tests match-level strength.

Set `EXPERIMENTAL_AI_LOGS=1` for benchmark diagnostics. Set `VITE_EXPERIMENTAL_AI_LOGS=1` before `npm run dev` for browser diagnostics. Completed-shot observations include the final shot, evidence counts, pre-update prediction samples, prediction RMS, and update time. Launch decisions retain separate fit-time and map-error diagnostics. Flight-time summaries report p50 and p95 with outcome-specific counts.

## Credits & license

🎯 **Special shoutout to [matthias-Q](https://github.com/matthias-Q)**, who gave me the idea for this remake.

Slingshot is a from-scratch remake of the game of the same name, written in Python/Pygame by [Jonathan Musther and Bart Mak](https://libregamewiki.org/Slingshot) (2007, GPL-2.0-or-later). This project reuses none of its code or assets; it only follows the original's game idea and rules.

This program is free software: you can redistribute it and/or modify it under the terms of the [GNU General Public License](LICENSE) as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. It is distributed in the hope that it will be useful, but without any warranty; without even the implied warranty of merchantability or fitness for a particular purpose.

Fonts are bundled via [Fontsource](https://fontsource.org/) and licensed under the [SIL Open Font License 1.1](https://openfontlicense.org/):

- [B612 and B612 Mono](https://github.com/polarsys/b612) – © The B612 Project Authors
- [Big Shoulders Stencil Display](https://github.com/xotypeco/big_shoulders) – © Google Inc. / The Big Shoulders Project Authors
