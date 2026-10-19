# Slingshot – the game

A web remake of the Linux classic [Slingshot](https://wiki.ubuntuusers.de/Spiele/Slingshot/): two spaceships take turns firing at each other, and every shot is bent by the gravity of the planets in between. The number, size and position of the planets change every round. Old shot trails stay on screen, so you can feel your way towards a hit.

The UI is available in **German and English**. On the first visit it follows your browser language; switch any time with the *Language* row on the title screen or in the settings.

Everything about how the game plays: controls, modes, setup, the CPU opponents and the scoring. For playing online see [multiplayer.md](multiplayer.md); for running and developing the project see the [README](../README.md).

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
| ← → / 1–5, 0 | Oracle, once you are shot down online: tip hit or miss (turn by turn) / name the ship that gets hit, or 0 for nobody. You can also tap the choices or the ships |
| Shift + 1–5, 0 | Oracle, who wins the round: the ship still in (0 for a draw, where one is possible). You can also tap it |
| B / Shift + B | Oracle, bet points of the match on your tip on the round: the smaller / the larger stake. You can also tap the stake |
| G | Open or close the ghost lane, once you are shot down online. While it is open ← → ↑ ↓ aim and Enter / Space fire (or drag on the panel), E makes the panel bigger or smaller (or the button in its header); the oracle's ← → tips wait until you close it |
| Esc | Menu |
| P | Use your power-up (experimental, offline Classic and Event Horizon): open or close a teleport's aim, or arm a preview or a repulse for your next shot |
| F | Fullscreen |
| ↑ ↓ ← → Enter (in menus) | Pick a row, change its value (sliders, switches and lists alike), confirm. Home / End jump a slider to its ends; Esc goes back to the row you came from |

## Game modes

- **Daily Challenge** (*Tägliche Herausforderung*) – five sectors with stationary targets and a limited number of shots, the same for everyone on a given calendar day. Today's theme (Billiard, Blind flight, Singularity, Heavy load, Precision, Sniper or Classic) decides which twists the sectors carry; difficulty ramps up through the day and with the weekend. Every target is guaranteed to be hittable. At the end you get a result card with your score and rank, made for screenshots, plus a Wordle-style text to copy. Your best run, attempts and streak are kept in the browser. Add `?daily=YYYY-MM-DD` to the URL to fly another day. Where a relay is configured the card also offers **Post to leaderboard**: the run goes up under a name you type, next to everyone else's runs of that day — nothing is posted unless you ask for it. The Daily Challenge screen has its own **Leaderboard** row, which shows the same board without offering to post ([multiplayer.md](multiplayer.md#daily-leaderboard)).
- **Classic** – the original duel, extended to up to six ships. Players take turns, one shot each. A hit ship is out; the round ends when one ship is left.
- **Free for all or teams** – with three or more ships, the *Players* row of the game setup splits them into two or three teams (Ember, Frost, Nebula). Teams share a colour family, start grouped together and take turns alternately, so a small team shoots as often as a big one. The round ends when one team is left. Works in both modes.
- **Event Horizon** (*Ereignishorizont*) – gravity royale. Everyone locks in an aim, then all shots fly at once. After every volley the central black hole grows, swallows planets and drags ships inwards. Kills pay base points × a trick-shot combo (swing-by, bank shot, graze, photon ring, airtime) and get a slow-motion killcam, which you can record as a video clip.
- **Multiplayer** – Classic or Event Horizon online, see [multiplayer.md](multiplayer.md).

## Game setup

Before a game starts — and for the room in the multiplayer lobby, where only the host can edit it — the rules are sliders and switches in four blocks (match, battlefield, shots, extras). Drag a slider, click its track or use ← →; everything is remembered for the next game, and *Reset rules* puts the defaults back. As in the original, you can toggle invisible planets, reflecting edges, fixed power, planet count, rounds and flight time.

**Shot power** is one choice of three: *Free* (0–100), *Capped* (a maximum from 10 to 90, a low one favours trick shots) or *Fixed* (every shot flies with the same power, 10 to 100 in steps of 5 – only the angle counts). The slider next to the choice appears only for *Capped* and *Fixed*.

The **Players** screen lists the ships (two to six): add a human or a CPU, take a ship out with ✕ and switch between free for all and two or three teams. In team mode every ship picks its team, and *Balance teams* deals them out evenly.

The **Settings** screen holds the device options: sound, fullscreen, particles, language and gravity contours. The browser saves them.

### CPU opponents

The Players screen offers four CPUs, in this order:

| CPU | Style |
| --- | --- |
| Kepler, Newton, Einstein | Easy, medium and hard. They search for a hitting shot and aim with an error that shrinks with every shot of a round. |
| Hawking | Searches like Einstein, with the same aim error, but prefers swing-bys. Enemy hits come first, and self-hit and friendly-hit safety is preserved. Among comparable safe shots it prefers more swing-by passes, then longer flights and paths within the full configured flight limit – also in Classic when trick-shot bonuses are off. |

New CPU seats start as Newton. In an online room the host seats CPUs in the same way (see [multiplayer.md](multiplayer.md)). A further CPU that fits gravity from its own completed shots exists for benchmarks and programmatic matches; it is not offered in the game (see the [AI benchmark](benchmarks/README.md)).

### Power-ups (experimental)

Switch on *Power-ups (experimental)* in the twists block. It works in Classic and Event Horizon, offline and in online rooms (the host sets it with the room's rules); the daily challenge and the menu background never use it. Online, the host's copy of the match runs everything and the guests send the keys: the power-up key, the aim and fire. Only the ship aiming a teleport sees where it would land. In Event Horizon a salvo counts as one pass, pickups keep clear of the black hole, and when it grows it pulls them in like planets: they drift towards it, the ones it swallows are gone and replaced, the fire key during the flight splits, and the killcam replays splits and shields exactly.

Under the switch, two rows open while it is on: a tile per kind (click or tap it, or ←/→ and Enter; at least one stays on) and *Pickups on the field* (1–4, usually 2). There is no submenu. A round starts with that many, a taken pickup is replaced at once, and the field never holds more. *Reset rules* puts the choices back too.

- **Pickups** float on the field, each with its own symbol and a bright colour: a cyan eye for the preview, a magenta portal for the teleport, a gold fork for the splitter. A shot that flies close to one takes it, and keeps flying.
- **One held at a time.** Taking another one swaps it: the old one is lost.
- **Preview** shows the first two seconds of your current shot as a dotted line while you aim. Armed, it is spent by the next shot.
- **Teleport** is aimed, not guessed. Press **P** to open the aim and a portal ring appears where you would land: the angle sets the direction and the power sets the distance, up to half the field (more power changes nothing). Drag on the field, or turn with ← → and ↑ ↓. The ring is walked back out of any planet the aim would land in, so it never comes to rest inside one. **Fire** jumps there and spends your shot: the turn moves on and you shoot nothing this turn (nothing this volley, in Event Horizon). **P** again or **Esc** thinks again. Only the ship aiming sees its ring.
- **Splitter** is a two-step move: fire as usual, then press fire again while the shot is flying. The shot forks into three, fanned a few degrees. While it can still be split, the shot wears a gold ring. It stays until you use it, so you can keep it across turns.
- **Repulse** (*Umpolung*, an orange rayed disc) turns gravity round for your next shot: planets push it away instead of pulling it in. P arms it (press again to disarm). While it is armed the aim arrow and the ship's ring turn orange, the key in the strip is filled in, and every planet sends out orange rings; the shot then flies orange, and the rings stay while it is in the air. Trick shots count as usual.
- **Shield** (*Schild*, a green shield) puts a bubble round your ship that soaks up the next shot that would hit it — and is then gone. It needs no key. Swapping it for another power-up takes it off.
- **P** uses the held power-up: it opens the teleport aim (P again thinks again), or arms a preview or a repulse (press P again to disarm). A splitter and a shield need no key.
- **Spawns:** two pickups at the start of a round, and never more than the amount on the field. A taken pickup is replaced at once. A pickup that fades (every ship still in has shot once per pass, and it fades after three passes) is replaced only once it is gone, so the next one waits for the old one to run out. Pickups lie on a path some ship could fire (so each can be reached), far enough from that ship that taking it costs a real shot, and preferably in a swing-by lane close above a planet. Often it is the path of the ship that is behind. A pickup blinks in its last pass and fades after three. Pickups pop in with a ring, burst into particles that fly to the ship that takes them, and a ship that swaps drops its old power-up as sparks.
- **CPUs** collect and use them too, except previews and repulses, which they leave lying. A CPU shield simply works. A CPU holding a teleport that finds no hitting shot jumps and plans again, and a CPU with a splitter forks its shot once it flies close to an enemy.
- The strip under each duel score shows the power-up a ship holds and the key that uses it. With three or more ships the scoreboard chip carries the symbol, and the key for the ship on turn. A shot that can still be split wears a gold ring.
- Teleports, splits and pickups come with their own sounds and effects.
- **Touch:** a power-up button appears above the fire button while a ship holds a teleport or a preview. With a splitter in the air the fire button reads *Split*.

## Rules & scoring

**Classic**

- A hit scores `1000 × shot factor × power factor` points (rounded to 10).
  - Shot factor: 1.0 on the first shot of the round, −0.15 for every further shot, minimum 0.25.
  - Power factor: `1.5 − power/100`, i.e. 0.5 to 1.5. With fixed shot power it is always 1.
- Hitting your own ship – or a teammate – costs 300 points.
- With three or more ships, the last survivor gets 250 points; in team mode every member of the winning team does, fallen ones included.
- After the last round, whoever (or whichever team) has more points wins.
- **Trick-shot bonuses** (optional, off by default): swing-bys, grazes, bank shots and airtime multiply a hit's points just like in Event Horizon (`1000 × shot factor × power factor × combo`).
- **High-five:** two shots that meet in mid-air cancel each other out. With trick-shot bonuses on, both shooters score for it – 50 points for an enemy missile, 100 for a teammate's. Event Horizon always pays it.

**Daily Challenge:** a hit pays `1000 × shot factor × power factor × trick-shot combo`, where the shot factor counts the shots spent on *that target* (−0.15 per extra shot, minimum 0.25). Clearing a sector adds 250; hitting yourself costs 300 and ends the sector. Ranks (Cadet … Gravity master) are measured against a flawless-but-plain run.

**Scorecard:** at the end of every round a row of cards under the banner hands out awards – longest shot, fastest kill (timed from the start of the round), most swing-bys, most grazes, best hit and most kills (two or more). Three more cards appear when they were earned: the **closest call** (the narrowest miss of an enemy ship, under 40 px), the **sniper** (a hit from 500 px or more) and the **own-goal king**. The cards that come with a shot take turns: the card is outlined and its shot is redrawn in bright on the field. With power-ups on, two more cards can appear: **most power-ups** (taken) and the **lifesaver** (hits a shield soaked up). Only awards somebody actually earned show up, and a tie shares the card. The final screen lists the same awards for the whole match, plus a chart of everybody's score over the rounds. In Classic, swing-bys and grazes are counted even when trick-shot bonuses are off.
