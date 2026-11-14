# Plan: split `src/game/match.ts`

Status: proposed, nothing built. Written 2026-11-14 from a read of `match.ts` (2448 lines) and its subclasses.

## Goal

`Match` is the base class of every game (`ClassicMatch`, `HorizonMatch`, `SolarMatch extends ClassicMatch`, `ChallengeMatch`, `PracticeMatch`). It should keep the round and flight loop and nothing else. Everything below moves out into a collaborator that `Match` owns, the way `Killcam`, `Oracle`, `ShotLog`, `Crowd` and `PowerUpField` already are.

This is a refactor with no change in behaviour: no rule, score, event, snapshot field or random draw changes.

## What the read found

- The modes are **not** tangled in `match.ts`. They are subclasses behind eight abstract hooks (`commit`, `beginRound`, `updatePhase`, `afterVolley`, `killPoints`, `survivorBonus`, `roundTitle`, `mode`). `match.ts` has about a dozen `mode ===` checks, nearly all "not in the daily challenge" or flags for `generateWorld`. Leave them.
- Mayhem and the anomalies are not tangled in it either. Twists are an overlay on `settings` (`applyTwists` in `mayhem.ts`); anomalies become `ShotRules` in `sim/anomalies.ts`. `match.ts` holds only their announcement (about 70 lines).
- The size comes from unrelated jobs sharing one class. By line range today:

| Lines | Job | Size |
| --- | --- | --- |
| 1–310 | Types and small exported helpers | 310 |
| 595–751 | Oracle and betting (ships and stands) | 157 |
| 1271–1430 | Leaving, away, and the replay's seat changes | 160 |
| 1432–1554 | Pause and the vote to skip a round | 123 |
| 1617–1688 | Replay: scripted turns and splits | ~100 |
| 1910–2135 | Kills: bonuses, chain, marks on the cards | 226 |
| 2208–2385 | CPU: planning jobs, placement aim, swing | 178 |

- The one place a new rule idea pays twice is the **snapshot**. `ClassicMatch.snapshot/restoreSnapshot` (`classic.ts:73–176`) and `HorizonMatch.snapshot/restoreSnapshot` (`horizon.ts:104–156`) each list about 35 fields that belong to `Match`, by hand. Any new state in `Match` has to be added in four places across two files, or online guests silently miss it.

## Rules for every step

- One step per commit. After each: `npm run typecheck` and `npm test` green.
- `tests/game/replay-seed-*.test.ts` are the safety net: they fly recorded matches and fail on any drift. They only stay green if the **order of random draws** is unchanged. `worldRng`, `rng` and the per-seat planner RNGs must be created and consumed exactly as now (see `newMatch`, `startRound`, `plannerRngFor`).
- **Snapshot shape stays identical**: same keys, same nesting. `SnapshotEncoder` (`src/net/netsync.ts`) diffs it field by field. The snapshot's fields are not in `server/protocol-contract.json`, so `tests/protocol-wire.test.ts` must stay green **without** running `npm run protocol`. If it goes red, the step changed the wire by accident: undo, do not record it.
- **Event order stays identical**: listeners (`on`, `onBanter`, `onSeatChange`, `onTurnEnd`) see the same events in the same order.
- Tests reach into `Match` by cast (`endRound`, `afterVolley`, `startRound`, `setPhase`, `stylePays`, …; 32 casts in `tests/game`). Keep those members on `Match` under the same names. Where a test reaches for state that moved, change the test to reach the collaborator; do not weaken an assertion.
- Everything outside `src/game` reads `Match` through its public members (`match.players`, `match.cardMarks`, `match.placeBet`, …). **Keep the public surface.** Where a job moves out, `Match` keeps a one-line forwarder, as it already does for power-ups (`usePowerUp`, `placing`, `pickups`). No file in `render/`, `ui/`, `net/` or `main.ts` should need an edit, except for import paths in step 1.
- New files go in `src/game/` and obey `docs/architecture.md` (game may import platform, sim, data). `tests/layering.test.ts` checks it.
- A collaborator takes what it needs as a small `deps` object of functions, like `PowerUpField` (`match.ts:437–461`). It never imports `Match` as a value (types only), so it can be tested alone.

## Steps

Ordered by payoff per risk. Each stands alone; stopping after any of them leaves the code better.

### 1. Types out — `src/game/match-types.ts`

Move lines 27–309 (everything before `export abstract class Match`): `Mode`, `Phase`, `PlayerState`, `Trail`, `KillRecord`, `Falling`, `infallAt`, `RoundTitle`, `SkipVote`, `Camera`, `Scene`, `GameEvent`, `Bonus`, `Mark`, `MarkState`, `MatchOptions`, `CpuJob`, constants, `teamName`; also `newPlayer`, `sidesOf`, `atTable`, `shotDown` from the bottom of the file. `match.ts` re-exports all of it (`export * from './match-types'`), so the 13 files importing from `./match` keep working. Zero risk; it makes every later step's imports acyclic.

### 2. One snapshot of the base — highest payoff

Add to `Match`:

```ts
protected baseSnapshot(): MatchSnapshot
protected restoreBase(s: MatchSnapshot): void
```

holding every field both subclasses list today (phase, clocks, round, players, world, trails, volley, killFeed, summary, notice, settings, mayhem and reveal fields, stats, scoreHistory, skipVote, pause, flightDoneAt, killcam, oracle, stands, crowd, marks, pickups, power). `ClassicSnapshot` and `HorizonSnapshot` become `MatchSnapshot & { …their own fields }`; their `snapshot()` is `{ ...this.baseSnapshot(), planClock, passes, … }`.

Watch for:
- The two `restoreSnapshot`s restore in slightly different orders (Horizon restores the volley before the oracle, Classic after; Classic builds the volley against `snapshot.world`, Horizon against `this.world`, the same object by then). Pick Classic's order and confirm nothing reads across the difference: `killcam.restore(s, this.rules)` and `new Volley(…, this.rules, …)` need `settings`, `world` and `worldSeed` set first; `restarted()` then `flightDoneAt` come last.
- `freeFireAnnounced` is in Classic's snapshot only. Keep it Classic's (moving it into the base adds a field to Horizon's wire state).
- `SolarMatch` already does `{ ...super.snapshot(), solar }`: unchanged.
- Write the test first: a round trip `b.restoreSnapshot(a.snapshot())` then `expect(b.snapshot()).toEqual(a.snapshot())`, for Classic, Horizon and Solar, mid-flight and at a round's end, with Mayhem and power-ups on. It must pass before and after.

### 3. Kills and marks — `src/game/kill-ledger.ts`

`class KillLedger` takes the state `killChain`, `firstBloodDrawn`, `killedBy`, `killedBefore`, `launchScores`, `roundScores` and the methods `killBonuses`, `targetExtras`, `standings`, `standingsAtLaunch`, `comebackCandidate`, `marksFor`, `markState`, `restoreMarkState`, plus the bookkeeping now inlined in `startRound` (lines 1044–1048, 1095), `skipRound` (1547), `launch` (1606) and `registerKill` (1944–1946, 1977–1986) as named methods: `startRound(scores)`, `rollbackRound()`, `launched(scores)`, `noteKill(killer, victim)`, `chainBonus(killer)`.

Deps: `players()`, `payFactor()`, `friendsOf(id)`, `paysKillBonuses()`, `forfeited()`, `phase()`.

Stays in `Match`: `registerKill`, `creditKill`, `payBonuses`, `roundBonuses`, `endRound` (they write scores, the shot log, stats, the killcam and emit events: that is the match's job). They ask the ledger what to pay.

Tests that pin it: `tests/game/kill-bonuses.test.ts` (17), `card-marks.test.ts` (10), `skip-round.test.ts` (12). Add direct unit tests of `KillLedger` for `targetExtras`.

### 4. CPU — `src/game/cpu-desk.ts` and `src/game/cpu-placement.ts`

- `cpuPlacementAim` (2227–2289) reads only `world`, `players` and `friendsOf`: make it a plain exported function `cpuPlacementAim(world, players, p, friends)` in `cpu-placement.ts`, with its own tests.
- `class CpuDesk` takes `cpuJobs`, `plannerRngs`, `lastHitBy`, and `runCpu`, `plannerRngFor`, `logCpuDecision`, `cpuRescueIfBlind`, `swingTowards`. Deps: `world()`, `players()`, `rules()`, `settings()`, `friendsOf`, `sparedFor`, `power` (pickups, teleport), `powerUps()`, `options` (`deterministicCpu`, `onCpuDecision`), `matchSeed`, `mode()`, `round()`.
- `ClassicMatch` and `HorizonMatch` call `this.runCpu`, `this.cpuJob`, `this.cpuJobs`, `this.swingTowards`, `this.cpuRescueIfBlind`, `this.cpuPlacementAim`, `this.placeForCpu` (about 20 call sites). Either keep thin protected forwarders on `Match`, or change the call sites to `this.cpu.…`; the second is cleaner, do it if the diff stays mechanical.
- `PowerUpField`'s dep `clearCpuJobs` and the many `this.cpuJobs.clear()` in `Match` become `this.cpu.clear()`.
- Risk: the planner RNG seed (`matchSeed ^ imul(seat + 1, 0x9e3779b9)`) and the moment each RNG is first created must not move. `tests/sim/cpu-personality.test.ts`, `hawking-ai.test.ts` and the replay seeds cover it.

### 5. Replay driver — `src/game/replay-driver.ts`

Takes `scriptTurns`, `scriptSkipped`, `scriptSeats`, `pendingSplits`, `replayState` and `updateScripted`, `recordedBeyond`, `stageTurn`, `makeSplits`, `applySeatChanges`, `makeFlightSeatChanges`, `makeSeatChanges`, and the constructor's script parsing (471–479). `Match` keeps `replaying`, `replayState` (forwarded) and `nextTurnKey` (the recording side, `noteSeatChange`, needs it too).

This one is entangled with the phase loop: `update`, `updateFlight`, `nextVolley` and the killcam branch each call into it at a precise moment. Keep every call at the same line of the same method; only the body moves. `tests/game/replay-seats.test.ts` (10) and the four replay-seed files pin it. Do it only if steps 1–4 went smoothly.

### 6. Pause and skip vote — `src/game/skip-vote.ts`

`pause`, `tickPause`, `skipVote`, `voters`, `skipVotesNeeded`, `requestSkipRound`, `voteSkipRound`, `skipAnswer`, `canAnswerSkip`, `endSkipVote` move; `skipRound` itself (what skipping does to the round) and `canSkipRound` stay in `Match`. `tableChanged` keeps calling both the killcam and the vote. `pause` and `skipVote` are snapshot fields: they must come out of `baseSnapshot` under the same keys. Pinned by `skip-round.test.ts`, `pause.test.ts`, `leaving.test.ts`.

### Not planned

- **Oracle and betting (595–751).** It is already a facade over `Oracle` and `Crowd`, and `render/` and `ui/` read it through about 80 call sites (`match.betOracle`, `match.bettor`, `match.ghost`, `match.placeBet`, …). Moving it means forwarders for nearly every method, so little is gained. Revisit only together with a change to those call sites.
- **Leaving and away (`removePlayer`, `setAway`, `passTurnOf`, …).** They end rounds and hand out turns: that is the round loop.
- **`onVolleyEvent`.** It is the match: sim events in, game events and scores out.
- **A hook or plug-in system for rules.** The subclass hooks, `applyTwists` and `anomalyRules` already are the seams, and there is no second user to design a wider one for.

## Expected result

`match.ts` at roughly 1300 lines after steps 1–4, about 1050 after 5–6. A new piece of match state is added in one place and reaches online guests. A new kill bonus is one entry in `KillLedger.targetExtras`, which pays it and marks it on the cards from the same rule.

What this does **not** shorten: a new rule still needs its setting in `data/roomRules.ts`, its wire entry (`change-wire-protocol`), its UI and its translations. The anomalies touch 47 files, and nearly all of them are outside `src/game`.

## Done when

- `npm run typecheck`, `npm test` green after every commit; `tests/protocol-wire.test.ts` green with no change to `server/protocol-contract.json`.
- No file outside `src/game` and `tests/` changed, except import paths.
- `git diff --stat` for each step shows moves, not rewrites: the moved method bodies are the same text with `this.x` turned into `this.deps.x()` or a field of the collaborator.
- A hot-seat game and an online game (host and guest, `npm run dev:server`) each played through a round in Classic and Event Horizon with Mayhem on: guest sees the marks on the cards, the kill chain and the round's announcement as the host does.
