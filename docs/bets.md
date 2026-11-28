# Bets and fans online

The rules of the round bet, the escape pods and the fans in one place, with the constants behind them. Sources: `src/game/bets.ts` (rules), `src/game/match.ts` (betting window, settling), `src/game/fans.ts` (fans), `src/sim/config.ts` (`BETS`, `FANS`, `GALLERY`), `src/render/bets.ts` (the card). For players, [multiplayer.md](multiplayer.md#playing-online) tells the same story in short.

## Escape pods and fans (online, with or without bets)

When you are shot down online, you ride an **escape pod** in your colour.

- **Rooting:** the card at the bottom asks *Who are you rooting for?*. You pick with keys 1–5, the name or a tap on the ship. Your pod flies over and circles the ship with its other fans. A new pick sends it on.
- **Finding your pod:** your pod (in the stands, your UFO) pings on your screen, smaller than a ship's ping at the start of a round. It pings as it comes out, when it flies to another ship and every 10 s.
- **Cheering:** key **G**, the *Cheer* chip or a second tap on your ship. Your pod hops with a ring of light, and the whole room sees it. The chip flashes and fills up in grey for 0.8 s, the time until your next cheer. Cheers make no sound.
  - **Epic cheers:** each call you get right in the match makes your cheer bigger, up to step five. From one on, more sparks fly, half of them in your colour. Two add rays and three a third ring. Four bring a crown that turns round the pod, five a second wave of sparks, and your pod hops higher and longer.
  - **Forged** draws the cheer as a firework of light. Streaks of sparks fall in arcs, and from two a flare of light lies across the pod. Three add a second ring of light in your colour with sinking embers, four six wheeling lights, and at five the sparks flash into stars where they end.
  - The step counts for your own cheer and for the cheer when your ship hits. Spectators make no calls and cheer at step zero. The look gallery shows every step under *Jubel-Stufen*.
- **Hits:** when your ship hits, its fans cheer together (*CHEERS ×n*).
- **Calls:** while your ship aims its next shot (its turn or a salvo, a person's ship or a CPU's), you call it: **Hits** (T, it destroys an enemy), **Misses** (D, it destroys nothing) or **Gets hit** (X, it goes down in that flight). You can change your call until the shot flies, and the game keeps the aiming open for 3 s or more while a fan can call, with bets off too. Your call shows as a badge over your pod, after the flight with ✓ or ✗.
  - **With a bet on that ship:** a right *Hits* raises the multiplier by 1, a right *Misses* by 0.25. A wrong call takes 0.25 off, down to ×1.5 at the lowest. A right *Gets hit* insures the bet: if you lose it, you pay half the stake.
  - **Without a bet:** a right call pays match points: *Hits* +50, *Gets hit* +30, *Misses* +10 (a kill pays 1,000). A wrong call costs nothing.
  - **Statistics:** the game reports each judged call to the online statistics as a shot tip, right or wrong, with no stake and no name. The tile reads *Next shot called right*.
- **Losses:** when your ship goes down and its side is out, its fans' pods blow up with it.
- **Spectators** root and cheer like the shot-down, with or without bets. They fly a **UFO** in their colour in from the field's edge to circle the ship outside the pods, against their direction. Each look has its own UFO, so you tell the stands from the shot-down at a glance. The inner ring round a ship holds eight UFOs, each ring further out four more, and the rings turn against each other. Twenty spectators fit on two rings.
- **Offline** there are no pods. Sources: `src/game/fans.ts` (`FanClub`, for the stands `match.standsFans`), `Renderer.drawPods` and `drawUfos`, inputs `fan`, `cheer` and `call` (protocol 14).

## The switch

The room rule **Bets** (`betting`) is **on** by default. With it off, pods, rooting, cheers and calls stay, and the bets go.

## Who bets

| Role | Bets with |
| --- | --- |
| **Shot-down player** (a person at the table) | their **match points** |
| **Spectator** | a **bankroll** of 500 per match (at least 100 at the start of a round) |

## The round bet

- You bet **once per round**, once somebody is out and two or more sides are in. The window stays open while the ships aim.
- **Pick a side:** keys 1–5 (0 = draw, when ships fire at once), the name or a tap on the ship. The pick roots for that ship too, and your pod stays there for the round.
- **Pick a stake:** **Q** = 25%, **H** = 50% (half), **A** = all, of your points. The game rounds to tens, 10 at least.
- **Multiplier:** stake × **the number of sides in the game when you place the bet**. Three left give ×3, two give ×2. A draw pays ×5.
  - Win = stake × (multiplier − 1)
  - Loss = stake
- Placing a bet takes no points.
- When your side goes out, you lose the bet that moment. The card then reads "BET LOST −900 · Bob is out · place 2 → 3".
- The game settles the other bets at the **end of the round**.
- **Teams:** a side is a team. When the team wins, you win, whichever member you picked.
- **Skipped round:** the game takes back every bet of the round. In a **round cut short**, open bets lapse and cost nothing.

**Example:** Dora has 1,800 points and puts them all on Cem after the first kill, with three sides left (×3).
- If Cem wins, Dora gets **+3,600**.
- If Cem goes out, she loses **1,800** that moment.

## What shows afterwards

- **End of the round:** the card shows the winner, your bet large on the right and the room's bets below with their results.
- **Pause:** your net from bets this match and your open bet.
- **Final screen:** *Bets this match* with the net and the bets won, and *Best bettors in the stands*.

## Trying it out

`npm run dev`, then `/?nointro&preview=bets-live`. You are out from the start of every round with 1,800 points, and four players shoot by themselves. `/?nointro&preview=fans-live` runs without bets: you root and cheer, the shot-down players root along, and nine spectators fly their UFOs.

Online with a relay: `npm run dev:local`, add three bots to the room under Online-Bots in the DEV panel, and join as a spectator from a second tab with `?join=<code>`.

## Constants (`src/sim/config.ts`)

| Name | Value |
| --- | --- |
| `BETS.STAKE_SHARES` | 25% / 50% / 100% |
| `BETS.STAKE_STEP` / `STAKE_MIN` | 10 / 10 |
| `BETS.DRAW_MULTIPLIER` | 5 |
| `BETS.MIN_BET_TIME` | 3 s of aiming before a shot flies, while somebody can bet or call |
| `BETS.RESULT_SECONDS` | 3 s a result stays on the card |
| `FANS.CHEER_GAP` | 0.8 s between two cheers of one fan |
| `FANS.CALL_POINTS` | *Hits* 50, *Misses* 10, *Gets hit* 30 |
| `FANS.EPIC_MAX` | 5 cheer steps |
| `GALLERY.BANKROLL` / `RELIEF` | 500 / 100 |
