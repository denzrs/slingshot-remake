# Plan: make a new rule cheap to try and cheap to keep

Status: Part A and B1–B3 built on `improve/cheaper-rules` (B4 not done). Written 2026-11-14. Companion to [`match-split.md`](match-split.md); the two are independent and can be done in either order.

## Problem

A rule idea costs its full price before anyone has played it. The Bounty Hunt preset was built with CPU handling and net sync in all three modes, played once, and thrown away. Two separate costs are behind that:

1. **There is no way to play an idea before it is a rule.** Anything a match reads comes from `Settings`, which extends `RoomRules`, and `RoomRules` is the wire, the relay, the rules page, the presets and the saved settings at once.
2. **A rule is declared about fourteen times.** For a plain one such as `fadingTrails`:

| Where | What is written by hand |
| --- | --- |
| `src/data/roomRules.ts` | field of `RoomRules`, entry in `RULE_NAMES`, default in `DEFAULT_ROOM_RULES`, check in `roomRulesFrom` |
| `src/sim/config.ts` | the allowed values (`TRAIL_FADE.OPTIONS`) |
| `src/ui/menu/rules.ts` | the row in `ruleRows()` |
| `src/platform/i18n.ts` | label, both languages |
| `server/protocol-contract.json` | default, allowed values |
| `server/src/protocol.rs` | struct field, default in `DEFAULT_RULES`, line in `rules_to_value`, check in `parse_rules` (allowed values again, `&[0, 1, 2, 4]`), line in the struct literal at its end |
| `server/src/report.rs`, `protocol.rs`, `room/tests.rs`, `stats.rs` | whole rule sets written out as JSON in test fixtures |

The contract is a third copy that both sides are only *checked* against (`shared_menu_contract_matches_relay_defaults_and_slider_options` in `protocol.rs`, `tests/net/protocol.test.ts`). The relay itself reads only two rules as fields outside `protocol.rs`: `chat_players_only` (`room/chat.rs`) and `mayhem` (`room/lobby.rs`). `stats.rs` handles rules as JSON and keeps two lists of rule names (`FAVORITES_IGNORE`, `CLASSIC_FAMILY_ONLY`).

What stays expensive, and should: the mechanic in `sim/`, its art and HUD, its copy, the presets that use it, its tests.

## Part A — a lane for experiments (small, do first)

An experiment is a rule idea that exists only in a dev build, offline, until it has been played and kept.

### Shape

- `MatchOptions` (`src/game/match.ts`, or `match-types.ts` after the split) gets `experiments?: readonly Experiment[]`, with `Experiment` a string union declared in one new file, `src/game/experiments.ts`, next to a list `EXPERIMENTS` with a one-line description each.
- `Match` gets `protected trying(name: Experiment): boolean` (false when the list lacks it). The mode code branches on it where the idea lives.
- `src/main.ts:526` creates the offline match with `createMatch(mode, played)`: pass the experiments there, read from the URL (`?try=name,other`) in dev builds only (`import.meta.env.DEV`). Online (`src/net/netMatch.ts`), the attract match, the daily challenge and replays never pass any.
- The dev panel (`src/debug/dev-toggles.ts`, shown with `?debug`) lists `EXPERIMENTS` as checkboxes that set the same URL parameter and reload. Its labels are the experiment's own name and description from `experiments.ts`, not `i18n` keys: an experiment has no translation until it is kept.
- While one is on, the HUD shows a small `EXPERIMENT: name` chip, drawn by the dev build only, so a screenshot or clip of one is never mistaken for the game.

### Rules of the lane

- An experiment touches **no** file in `src/net`, `server/`, `src/data/roomRules.ts`, `src/ui/menu/rules.ts`, `src/ui/presets` or `src/platform/i18n.ts`. If it needs one of them, it has stopped being an experiment.
- State it needs lives in the mode class and is **not** added to the snapshot: hot-seat has no guests.
- One mode is enough. CPUs may ignore it.
- It must not change a draw from `worldRng` or `rng` while it is off (the replay-seed tests check that).
- When the idea is kept, it is promoted: becomes a rule (Part B makes that one entry), gets copy, CPU handling, a preset if wanted, and its `trying(…)` checks become reads of the rule. When it is dropped, delete its entry in `experiments.ts` and the compiler lists every branch to remove.

### Done when

- `?debug` shows the experiments; switching one on starts the next offline match with it; a production build (`npm run build`) contains no experiment panel and ignores `?try`.
- One test: a match created with an experiment reports `trying()` true, one without false; `netMatch` never passes any.
- A short section "Trying a rule idea" in `AGENTS.md` pointing here, so an agent asked for a new rule idea starts in the lane instead of on the wire.

## Part B — one declaration per rule (larger)

Turn the contract from a copy that is checked into the source that is read.

### B1. Client: a rule table

In `src/data/roomRules.ts`, replace `RULE_NAMES`, `DEFAULT_ROOM_RULES` and the body of `roomRulesFrom` with one table:

```ts
export const RULES = {
  rounds:        { kind: 'choice', default: 5, options: [0, 1, 3, 5, 7, 10, 15, 20] },
  hiddenAim:     { kind: 'flag',   default: false },
  edges:         { kind: 'choice', default: 'void', options: EDGE_MODES },
  powerUpKinds:  { kind: 'set',    default: POWER_UP_KINDS, options: POWER_UP_KINDS, nonEmpty: true },
  anomalies:     { kind: 'set',    default: [], options: ANOMALIES },
  // …
} as const satisfies Record<string, RuleSpec>;
```

- `RoomRules` is derived from it (a mapped type: `flag` → `boolean`, `choice` → the union of its options, `set` → an array of them). Keep the doc comments on the table's entries.
- `RULE_KEYS`, `DEFAULT_ROOM_RULES`, `rulesOf`, `defaultRoomRules` are derived. `roomRulesFrom` becomes a loop: a saved value that is not one of the rule's options falls back to the default. The three special cases it has today (`bounce` → `edges`, `neighborGrace === true` → 2, `suddenDeath` defaulting to on) stay as a small migration before the loop.
- Every legal value must be an option. Today `maxPower: 100` ("no cap") is the default but not in the contract's `options`, and `fixedPowerLevel` is "any step of 5": write them out in full.
- `ruleRows()` in `src/ui/menu/rules.ts` takes its `options` from the table (`numbers(RULES.fadingTrails.options, …)`) instead of from `TRAIL_FADE.OPTIONS`, `GRACE.OPTIONS`, `AIM.CAP_OPTIONS`, `MAYHEM.LEVELS`, `POWER_UP.AMOUNTS` and its own literals. Those constants in `sim/config.ts` either go, or stay as the table's source where `sim/` reads them (`sim/` may not import `data/`). The row keeps what is UI: group, control, label, `modes`, `when`.
- Mode scope (`modes: CLASSIC_FAMILY`) is in the UI row today and again in `stats.rs` (`CLASSIC_FAMILY_ONLY`). Move it into the table (`modes?: readonly GameMode[]`), read it from the row.

Check: `tests/data/*.test.ts`, `tests/ui/menu.test.ts`, `tests/ui/match-presets.test.ts` green; the type of `RoomRules` is unchanged for every other file (no edit outside the three files named).

### B2. The contract is generated

`npm run protocol` (`scripts/protocol/record.ts`, `wire.ts`) writes the `defaults` and `options` blocks of `server/protocol-contract.json` from `RULES`, and adds a `rules` block with each rule's `kind`, `modes` and `nonEmpty`. `tests/protocol-wire.test.ts` already fails when the sources and the contract disagree; extend it to fail when the contract's rule blocks are not what the table generates. The `room`, `avatar`, `daily`, `spectators` and `cpu` blocks stay hand-written.

### B3. Relay: validate against the contract

In `server/src/protocol.rs`:

- The contract is compiled in (`include_str!("../protocol-contract.json")`, as the tests already do) and parsed once (`OnceLock`).
- `RoomRules` becomes a validated JSON object (`serde_json::Map<String, Value>` in a newtype) with typed getters for what the relay reads: `chat_players_only()`, `mayhem()`, plus what `stats/demo.rs` and the tests use.
- `parse_rules` becomes generic: for each rule in the contract, the value must be a boolean (`flag`), one of the options (`choice`), or a list of distinct options, non-empty where the contract says so (`set`). A missing field takes the default. An unknown key is refused.
- `rules_to_value` returns the object; `DEFAULT_RULES` is the contract's `defaults`.
- The legacy paths go (`bounce`, the wider ranges such as `rounds` 0–99 and `shotTime` 5–120, fields that may be missing): the relay turns away clients of an older protocol anyway, and breaking the wire is accepted in this project.
- The bitmasks for `powerUpKinds` and `anomalies` and the Rust lists `POWER_UP_KINDS` and `ANOMALIES` go if nothing but `protocol.rs` reads them (check `stats/` first; if it does, keep the list and assert it equals the contract's).
- `stats.rs`: `CLASSIC_FAMILY_ONLY` is read from the contract's `modes`. `FAVORITES_IGNORE` stays (it is a statistics decision, not a rule's property).
- Test fixtures: one helper `rules_with(json!({ "fadingTrails": 2 }))` that lays overrides on the defaults, replacing the written-out rule sets in `protocol.rs`, `report.rs`, `room/tests.rs` and `stats.rs`. A fixture whose point is a complete, explicit set (`valid_rules`) may stay.

This is a change to relay code that validates messages: follow [`change-wire-protocol`](../../.agents/skills/change-wire-protocol/SKILL.md). The shape of `rules` on the wire does not change, but what the relay accepts narrows, so record it as a break (`npm run protocol`).

### B4. Anomalies

Smallest gain, do last or not at all. A new anomaly already needs no new rule. What remains by hand in the bookkeeping: `ANOMALIES` in `sim/config.ts`, the six lines of `anomalyRules` and its return type in `sim/anomalies.ts` (derive both from `ANOMALIES`, with `fuse` as the one that carries a number), and the relay's list (gone with B3).

### Done when

- Adding a throwaway toggle `testRule` takes: one entry in `RULES`, one row in `ruleRows()`, two strings in `i18n.ts`, `npm run protocol`. `npm test` is green (client and relay) and the rule shows on the rules page, is saved, reaches a guest's match and is refused by the relay with a value outside its options. No Rust file edited. Remove it again before committing.
- `git grep -n "0, 1, 2, 4"` finds the fading-trail steps once.
- `npm run screens:quick` shows no change on the rules pages (`npm run screens -- --compare`).

## Order

A, then B1, B2, B3 as separate commits; B4 optional. A is a day's work and pays back on the first idea that is dropped. B is the larger change because it touches the client, the contract script and the relay together; B1 alone already removes the client's duplicates and can stand without B2–B3.

## What was built, and where it differs from the plan

- **A:** as planned (`src/game/experiments.ts`, `Match.trying`, `?try=` and the dev panel, a test, a section in `AGENTS.md`), with two changes. The chip is a DOM element of the dev panel (`dev-toggles.ts`), not drawn by the HUD, so `render/` is untouched. `trying()` is false online, in attract mode and in a replay, whatever was asked for, so no caller has to remember to leave experiments out. The registry holds one entry, `lane-check`, which does nothing; delete it with the first real experiment.
- **B1:** `RULES` in `src/data/roomRules.ts` (`flag`, `choice`, `set`); `RoomRules`, `DEFAULT_ROOM_RULES`, `RULE_KEYS` and `roomRulesFrom` come from it, and `ruleRows()` reads its stops and modes from it. The option lists that `sim/` itself reads (`AIM.CAP_OPTIONS`, `TRAIL_FADE.OPTIONS`, …) stay in `sim/config.ts`: the table takes them from there. A choice rule may carry `accepts` (`rounds` 0–99, `shotTime` 5–120): the relay always took any whole number there, the rules page offers fewer, and rooms and tests rely on it. A saved value outside a rule's options and range is now replaced by the default on load (before, `rounds`, `maxPlanets` and `shotTime` were taken as they were saved).
- **B2:** `npm run protocol` writes the `defaults`, `options` and new `rules` blocks of `server/protocol-contract.json` from the table (`scripts/protocol/rules.ts`); `tests/protocol-wire.test.ts` fails if they differ from it. `maxPower`'s options now include 100 (no cap), which the relay always accepted.
- **B3:** the relay holds `RoomRules` as the validated JSON object and checks each rule against the contract (`protocol.rs`: `contract()`, `legal_value`, `parse_rules`); `chat_players_only()` and `mayhem()` are the typed reads left. A missing or null rule takes its default; one that is present has to be legal; keys the contract does not name are dropped. The old yes/no `bounce` is no longer read. `stats.rs` reads which rules exist in which mode from the contract's `modes`; the bitmasks and `ALL_POWER_UP_KINDS` are gone. The test fixtures that write out whole rule sets were left as they were: they stay valid, since a rule that is missing now has its default.
- **Recorded as compatible** (`npm run protocol -- --compatible`, protocol stays at 2): a client of version 2 sends complete rules in values the relay took before, and every one still passes. Raise it (`npm run protocol`) if that judgement is not shared.
- **Shown:** adding a throwaway `testRule: flag(false)` to the table and running `npm run protocol` put it in the contract's defaults and rules, and the relay's contract tests stayed green, with no Rust file edited. It was removed again.
- **Not done:** B4 (anomalies), and the `rules_with` fixture helper.
