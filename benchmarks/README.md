# AI benchmark

Tools for measuring the gravity-learning (`experimental`) CPU against the classic planners, plus the
deterministic validation suite for its learner. Nothing here is loaded by the game; the shipped
planners and the learner live in `src/ai.ts`, `src/experimental-ai.ts` and `src/experimental-worker*.ts`
(see the main [README](../README.md)).

| Command | Source | What it does |
| --- | --- | --- |
| `npm run bench:experimental` | `ai-matrix.ts` | Matched-pair matches of the learning CPU against easy, medium and hard over modes, formats, learning rates and starting knowledge ([matrix commands](#matrix-commands)) |
| `npm run bench:levels` | `level-matrix.ts` | Any CPU level against any other, Hawking and the learning presets included ([level matrix](#level-matrix)) |
| `npm run bench:calibration` | `ai-calibration.ts` | Reads matrix reports and recommends a rate and starting knowledge per level ([calibration](#consolidated-setting-calibration)) |
| `npm run bench:learning` | `learning-validation.ts` | Held-out learning validation with pass/fail gates ([learning validation](#held-out-learning-validation)) |
| – | `ai-metrics.ts` | Shared record types, distributions and confidence intervals |

Reports are written to the paths you pass with `--json` (the examples use `results/`, which is not
committed). Several tests import fixtures and metrics from these modules (`tests/ai-*.test.ts`,
`tests/experimental-*.test.ts`), so changing them means running `npm test`.

## Controls and information limits

The custom `experimental` CPU remains available for benchmarks and programmatic matches, but not in the setup choices.
Its controls are `MatchOptions.experimentalLearningRate` and `MatchOptions.experimentalStartingKnowledge`.
Both accept values from `0` to `1`, inclusive, and default to `1`.
The match and direct learner APIs clamp finite values to this range.
Explicit `NaN`, `Infinity`, and `-Infinity` values become `0`.
The browser has no sliders for these controls. They apply only to the custom `experimental` CPU.
Named presets use fixed per-seat values, even when a match contains different experimental presets:

| Display name | Preset ID | Learning rate | Starting knowledge |
| --- | --- | --- | --- |
| Kepler | `experimental-easy` | 0.45 | 0.5 |
| Newton | `experimental-medium` | 0.54 | 0.72 |
| Einstein | `experimental-hard` | 0.72 | 0.9 |

The presets are not selectable in the game. The Players screen seats the classic `easy`, `medium` and `hard` planners (shown as Kepler, Newton and Einstein), which do not learn gravity; `bench:levels` calls the learning presets X-Kepler, X-Newton and X-Einstein. Learning presets run in benchmarks and in programmatic matches (`MatchOptions.seats`).

- Learning rate `0` freezes evidence updates. Completed shots still count as observations.
- Learning rate `1` requests each unique own shot's full fitted update when trajectory samples support it; guards may reduce or reject that step.
- Intermediate learning rates scale requested evidence updates, not aim noise or search precision. The accepted effective rate can be less than the configured rate.
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
Each unique completed own shot counts once. Sample-free, frozen, and rejected updates add no learned evidence. `learnedShots` accumulates accepted effective learning-rate steps, not configured rate multiplied by observed shots.
The learner retains up to 12 representative same-field shots, including the newest, with spatial coverage and trajectory diversity rather than simply the oldest or newest 12. Each fitting update uses a balanced budget of up to 96 samples distributed across usable trajectories; long paths cannot consume the entire budget while shorter informative paths are omitted.

Hidden sources are anonymous. Before interpolating a separately fitted candidate into the current belief, the learner matches estimated sources one-to-one by estimated geometry and mass, never by array order or true-world identities. Local warm-start candidates retain their existing correspondence. Relabeling exchangeable sources is not new evidence or a distinct alternative map.
Candidate fitting and accepted belief updates are separate stages. A bounded local optimizer starts from the current belief and preserves its source correspondence; it supplies an update direction rather than an unrestricted replacement map. Other candidate maps are matched before interpolation. The previous belief and proposed update are replayed through the production `Shot` integrator on identical balanced samples. A bounded learning-rate backtrack reduces or rejects a worsening interpolation rather than blindly applying the configured rate. This nonworsening guard applies to retained evidence, not every future launch.
When at least two usable trajectories are available, candidate validation fits exclude the newest trajectory. The candidate and previous belief are compared on that same excluded trajectory, with its own sample denominator. The newest trajectory can enter the final all-evidence refit only after this validation; the final training residual is not held-out error.
Persistently poor pre-update predictions trigger stagnation diagnostics, broader uncertainty, and safe probes favoring map disagreement and new coverage over repeated speculative attacks. Recovery uses bounded, separated optimizer starts and cooldowns, not unlimited retries. Repeated paths and low training residuals do not create information or certify recovery. Diverse observations may help, but hidden-source identifiability and global recovery are not guaranteed.

In normal browser matches, a worker fits experimental observations outside the rendering thread.
The worker stores each CPU's retained trajectory history. Each request sends only the new completed shot and public geometry.
The main thread receives the fitted belief and diagnostics, not the retained trajectory history.
The synchronous path and worker use the same fitting algorithm, evidence limits, guarded learning, and starting-knowledge model. CPU difficulty presets remain unchanged.

The match waits for all completed-shot updates before the next aim or Event Horizon collapse.
During this wait, rendering continues. The next CPU aim uses the completed update, not stale knowledge.
Completed-shot reports contain that shot's counters, pre-update prediction diagnostics, and optional nested recovery diagnostics.
Round resets, rematches, and restored snapshots invalidate pending updates. Field transitions update the worker's public geometry in order.
Deterministic matches and environments without browser workers use the same learner synchronously.

Trajectory sensitivity determines estimated mass uncertainty. Short, low-information shots retain prior-scale uncertainty instead of narrowing it from shot count alone. The planner evaluates plausible mass and hidden-position hypotheses, including distinct estimated alternatives retained by recovery. An `exploit` decision means the selected aim has positive expected enemy-hit probability across the evaluated hypotheses. It does not guarantee a hit in every hypothesis or the true world; stalled prediction history can instead request an information-seeking probe.

The planner searches safe alternatives before it returns a fallback. `unsafeRate` reports the fraction of evaluated hypotheses where the selected launch hits itself or a teammate. Zero means safe in those hypotheses, not proven safe in the true world.

Event Horizon carries visible estimated masses by stable planet ID. Public collapse rules update estimated black-hole growth and swallowed mass. Hidden planets have no survivor IDs. Public count or epoch changes reset anonymous positions and discard old-field evidence. Hidden count losses use estimated anonymous masses, not true swallowed masses. The learner does not fit old and new gravity fields as one static field.

`MatchOptions.seed` fixes the complete multi-round world sequence. Each seat has a separate planner random stream. `deterministicCpu: true` completes planner generators without a wall-clock budget. Normal browser play keeps its frame budget. `onExperimentalDecision` reports learning diagnostics independently of logging. `onShotComplete` reports authoritative shot outcomes for every seat, not killcam replays.

## Matrix commands

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

## Level matrix

`npm run bench:levels` plays every challenger level against every opponent level on matched worlds with both seat assignments (same pairing logic, flight limit and rules as the matrix above).
It uses the same filters (`--modes`, `--formats`, `--pairs`, `--rounds`, `--seed`, `--json`, `--deterministic`, singular and plural forms) and adds `--challengers` and `--opponents`, which take level labels:

| Label | CPU level |
| --- | --- |
| Kepler, Newton, Einstein | classic `easy`, `medium`, `hard` |
| Hawking | `hawking` |
| X-Kepler, X-Newton, X-Einstein | learning presets `experimental-easy`, `-medium`, `-hard` |

All seven labels are used by default, with 10 pairs, the game's default rounds and seed `99540717`.

```bash
npm run bench:levels -- --mode=classic --format=1v1 --challengers=Einstein --opponents=Kepler --pairs=1 --rounds=1 --json=results/level-smoke.json
```

Level-matrix reports use JSON schema version `4` and carry no learning-rate or starting-knowledge axes. `bench:calibration` reads schema `3` matrix reports only.

## Metrics

The final scoreboard determines match wins, losses, and draws. Scores follow CPU ownership after the side swap, not a fixed team.
Round results remain separate. An unfinished match is a failure, never a draw.
JSON schema version `3` includes both controls in options, raw legs, final rows, launch decisions, and completed-shot observations.
Calibration rejects historical schema `2` because it lacks starting-knowledge identity. It also rejects schema `1`, which lacks authoritative outcomes.
Neither historical schema is upgraded by guessing missing evidence.

Matrix and learning-validation reports include `codeFingerprint: { algorithm, digest, sources }`.
Both CLIs print the SHA256 code identity and exact relative source paths.
The digest covers fixed ordered production learner, planner, physics, world-generation, and match-integration sources, including `src/experimental-evidence.ts` for trajectory sampling, anonymous-source matching, and representative-history selection, plus `benchmarks/ai-matrix.ts` and `benchmarks/ai-metrics.ts` to identify the executed experiment. It includes exact relative paths and byte lengths.
It excludes package metadata, other benchmark harnesses, tests, and research files. It requires no git or network access.
Identical source bytes give the same identity regardless of checkout path. Selected source edits change the identity.
Schema `3` reports without this field have unknown code identity, not the current checkout's identity.

Raw launch decisions record the belief available before firing. Raw completed-shot observations record the update after that shot, including terminal shots. Prediction RMS measures that shot before its update, not training residual after fitting. Sample-free updates report zero fit time and no prediction RMS.

A round reset clears evidence counts. Horizon field changes can clear retained evidence without clearing cumulative observed or learned counts. Anonymous position resets retain estimated mean mass and mass uncertainty, without identifying survivors. True-field map RMS is a benchmark diagnostic only. The planner never receives this truth.

A field transition clears old-field fit and forecast diagnostics from the next launch.
Completed-shot observations remain immutable history for their original field.
Browser console decision logs include `fit` and `reconstruction` details when `VITE_EXPERIMENTAL_AI_LOGS=1`.
For learner updates, `fit.initialRms` and `fit.rms` compare the belief before and after assimilation on identical retained samples; `fit.improvement` is their difference, not a mixed optimizer-start/belief-final comparison. Standalone optimizer fits retain their optimizer-stage residual semantics.
Optional `recovery` objects on launch decisions and completed-shot observations separate `optimizerInitialRms` / `optimizerFinalRms` from `beliefBeforeRms` / `beliefAfterRms`. `candidateValidationRms` and `previousValidationRms` compare the excluded-newest-trajectory candidate and previous belief with `validationSamples` as their common denominator. Missing validation stays `null`, rather than becoming a measured zero.
`proposedLearningRate`, `effectiveLearningRate`, and `updateStatus` distinguish requested, accepted, reduced, rejected, frozen, and unavailable work. `retainedShotIds` and `sampleCounts` correspond in retained-history order; `matchedSources`, `stagnationCount`, `stalled`, and `recoveryStarts` describe correspondence and recovery activity. Raw schema-3 JSON preserves these additive objects. Historical records without them remain valid and do not acquire invented recovery values.
`recoveryStarts` counts additional separated starts in that observation (zero or two), not lifetime attempts; total optimizer starts are bounded at four. Frozen or unavailable updates have no optimizer-stage RMS. `predictionRms` remains the actual pre-update forecast error, separate from the excluded-newest candidate validation RMS.
The console's `fit.diagonalSensitivityProxy` labels the existing sensitivity-diagonal ratio (`GravityFit.condition`). This is a diagonal sensitivity proxy, not a full-matrix condition number or a proof of identifiability.
`reconstruction.relativeGravityErrorPercent` measures estimated gravity error across the diagnostic grid. Lower values are better, and zero is exact.
Per-planet entries show true and estimated masses and positions, with absolute and percentage errors. Black-hole estimates and mass errors appear separately.
True masses are console diagnostics only. They never enter the planner. Missing fit or prediction values remain `null`.

Schema version `3` summarizes prediction RMS and prediction samples from these observations, not later launch diagnostics. Optional recovery summaries also use completed shots as their denominator and report missing counts; launch recovery remains separate raw pre-launch history.

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
| Observed / learned / retained | Unique completed own shots / cumulative accepted effective-rate evidence / representative retained same-field shots, including the final shot |
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

## Current measured state

Further benchmarks were stopped after these measurements. Logs and raw JSON reports were kept locally in `.scratch/ai-benchmarks/` and are not part of the repository.
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
An em dash means no complete confirmation cell. The remaining work was stopped on purpose.
No universal per-level preset has been proved across Classic and Event Horizon at all three formats.
The three named presets use these candidate settings. Their measured strength does not prove balance across every mode and format.
The custom `experimental` CPU keeps both programmatic controls. The classic easy, medium, and hard AIs remain unchanged.

## Consolidated setting calibration

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

## Held-out learning validation

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

The hidden-source recovery fixture uses seed `7139`, seven invisible planets, starting knowledge `0.72`, and learning rate `0.54`. It assimilates eight own trajectories at power `65` and angles `0.4`, `0.8`, `1.2`, `1.6`, `-30`, `30`, `-50`, and `50` degrees. Four probes at power `70` and angles `-35`, `-10`, `20`, and `45` degrees remain excluded from training. Both observations and probes use production `Shot` physics with no bounce and a 12-second limit; predictions use estimated point sources without hidden true positions or radii.
Its final prediction error is the square root of summed squared Euclidean position errors divided by the pooled probe sample count, not an unweighted average of per-probe RMS values. The nonregression gate uses the full measured pre-recovery reference `64.12803234206731` pixels from a local script (`.scratch/recovery-before.ts`, not committed) on the same fixture and metric; rounded displays may show `64.13` pixels. It also requires at least 75% improvement over the identical-knowledge frozen prior, unchanged rate-zero predictions, nonworsening retained-evidence updates, and meaningful recovery diagnostics. These comparisons test recovery on this fixture, not universal hidden-map identifiability or match-strength parity.

Short boundary-exit shots check that unusable samples add no learned evidence.
Tiny remote trajectories check that subpixel fit residuals retain mass uncertainty. Such residuals do not certify future accuracy.
The CLI prints gate results, the fingerprint, and separate rate/knowledge/history tables with prediction and evidence diagnostics.
Actual-shot tables compare learned and frozen errors without pooling knowledge settings.
Probe distributions describe this fixed suite. They are not match-strength confidence intervals.
`--json=path` saves raw cells and gate diagnostics. The CLI exits nonzero when any declared gate fails.

The visible-geometry suite and a separately declared deterministic hidden-source recovery fixture test prediction only on their specified layouts and excluded launches, not universal or global recovery of hidden source positions. Shot termination agreement is not optimal planner-action agreement. The independent matrix tests match-level strength.

Set `EXPERIMENTAL_AI_LOGS=1` for benchmark diagnostics. Set `VITE_EXPERIMENTAL_AI_LOGS=1` before `npm run dev` for browser diagnostics. Completed-shot observations include the final shot, evidence counts, pre-update prediction samples, prediction RMS, and update time. Launch decisions retain separate fit-time and map-error diagnostics. Flight-time summaries report p50 and p95 with outcome-specific counts.
