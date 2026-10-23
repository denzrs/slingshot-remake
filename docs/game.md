# Slingshot – the game

A web remake of the Linux classic [Slingshot](https://wiki.ubuntuusers.de/Spiele/Slingshot/): two spaceships take turns firing at each other, and every shot is bent by the gravity of the planets in between. The number, size and position of the planets change every round. Old shot trails stay on screen, so you can feel your way towards a hit.

The UI is available in **German and English**. On the first visit it follows your browser language; switch any time with the *Language* control in the title-screen footer or in device settings.

Everything about how the game plays: controls, modes, setup, the CPU opponents and the scoring. For playing online see [multiplayer.md](multiplayer.md); for running and developing the project see the [README](../README.md).

## Controls

| Key | Action |
| --- | --- |
| ← → | Rotate ship |
| ↑ ↓ | Shot power |
| Enter / Space | Fire (Event Horizon: lock in your aim; while a Mayhem round is announced: skip the announcement) |
| Shift | Large steps (×10) |
| Alt | Small steps (×0.1) |
| Ctrl or Alt+Shift | Tiny steps (×0.01) – on macOS the system claims Ctrl+arrows |
| Drag (mouse/touch) | Aim directly, the arrow tip follows the pointer |
| Space | Next round, skip the killcam |
| C | Save the last killcam as a video |
| ← → / 1–5, 0 | Oracle, once you are shot down online: tip hit or miss (turn by turn) / name the ship that gets hit, or 0 for nobody. You can also tap the choices or the ships |
| Shift + 1–5, 0 | Oracle, who wins the round: the ship still in (0 for a draw, where one is possible). You can also tap it |
| B / Shift + B | Oracle, bet points of the match on your tip on the round: the smaller / the larger stake. You can also tap the stake |
| Esc | Menu |
| P | Use your power-up (Classic and Event Horizon): open or close the aim of a teleport, a black hole, a planet killer, a nebula or an anti-gravity, or arm a preview, armor piercing or a plasma shot for your next shot |
| F | Fullscreen |
| ↑ ↓ ← → Enter (in menus) | Pick a row, change its value (sliders, switches and lists alike), confirm. Home / End jump a slider to its ends; Esc goes back to the row you came from |

## Game modes

The title screen keeps Local / Solo and Online in one shell. Click a Classic, Event Horizon or Mayhem card to open that mode's briefing directly; the Daily Challenge card opens its mission. Online replaces only the right-hand content with *Find a room*, *Create a room* and *Enter a code*, each opening its flow directly. *Settings* and *How to play* remain in the navigation rail. Keyboard focus has a light outline; selected navigation choices use an orange marker.

- **Daily Challenge** (*Tägliche Herausforderung*) – five sectors with stationary targets and a limited number of shots, the same for everyone on a given calendar day. Today's theme (Billiard, Blind flight, Singularity, Heavy load, Precision, Sniper or Classic, and since challenge #21 also **Bastion**, **Nebula** and **Hammerhead**) decides which twists the sectors carry. Bastion puts a flak cannon (a planetary defense that belongs to the targets) on a planet, Nebula lays a nebula over the field, Hammerhead gives you plasma shots only; Classic days sometimes carry a cloud or a cannon too. Days before #21 keep their old themes; difficulty ramps up through the day and with the weekend. Every target is guaranteed to be hittable. At the end you get a result card with your score and rank, made for screenshots, plus a Wordle-style text to copy. Your best run, attempts and streak are kept in the browser. Add `?daily=YYYY-MM-DD` to the URL to fly another day. Where a relay is configured the card also offers **Post to leaderboard**: the run goes up under a name you type, next to everyone else's runs of that day — nothing is posted unless you ask for it. The Daily Challenge screen has its own **Leaderboard** row, which shows the same board without offering to post ([multiplayer.md](multiplayer.md#daily-leaderboard)).
- **Classic** – the original duel, extended to up to six ships. Players take turns, one shot each. A hit ship is out; the round ends when one ship is left.
- **Free for all or teams** – with three or more ships, the *Players* row of the game setup splits them into two or three teams (Ember, Frost, Nebula). Teams share a colour family, start grouped together and take turns alternately, so a small team shoots as often as a big one. The round ends when one team is left. Works in both modes.
- **Event Horizon** (*Ereignishorizont*) – gravity royale. Everyone locks in an aim, then all shots fly at once. After every volley the central black hole grows, swallows planets and drags ships inwards. Kills pay base points × a trick-shot combo (swing-by, bank shot, graze, photon ring, airtime) and get a slow-motion killcam, which you can record as a video clip.
- **Multiplayer** – Classic or Event Horizon online, see [multiplayer.md](multiplayer.md).

## Game setup

Classic and Event Horizon open a match briefing with four rule presets. Choosing a preset replaces the match rules, keeping the players, teams and device preferences. Existing custom rules are preserved when opening the briefing; the active preset is derived from the actual rules, or labelled *Custom rules* when none matches.

| Preset | Rules |
| --- | --- |
| Standard | Original defaults: 5 rounds, up to 4 planets, 20-second flights, no power-ups or reflecting edges. |
| Trickshot | Standard with power capped at 60, reflecting edges and trick-shot bonuses. |
| Sniper | Standard with hidden aim arrows, trails that fade after 2 seconds, 30-second flights and up to 3 planets. |
| Party | Standard with up to 8 planets, all power-ups, 4 pickups, reflecting edges and trick-shot bonuses. |

Rounds and planet count can be changed directly in the briefing. It also shows the active power-ups as icons; hover an icon to read its effect. In Mayhem, the icons show kinds that may appear in a round twist. *Edit players* opens the crew; *Adjust rules* opens all rules in five categories (match, field, shots, twists and power-ups). *Done* returns to the briefing with the changes kept. *Start game* is initially focused, so Enter starts the match. Everything is remembered for the next game, and *Reset rules* in the full rules screen puts the defaults back.

The online room keeps its existing grouped rule controls, where only the host can edit them. Drag a slider, click its track or use ← →. As in the original, you can toggle invisible planets, reflecting edges, fixed power, planet count, rounds and flight time.

**Shot power** is one choice of three: *Free* (0–100), *Capped* (a maximum from 10 to 90, a low one favours trick shots) or *Fixed* (every shot flies with the same power, 10 to 100 in steps of 5 – only the angle counts). The slider next to the choice appears only for *Capped* and *Fixed*.

The **Players** screen presents two to six ships as pilot cards. Choose *Human* or *CPU* directly; a CPU card reveals its four difficulty levels. Add pilots as humans by default, remove a ship with its labelled control, and switch between free for all and two or three teams. In team mode every ship picks its team, and *Balance teams* deals them out evenly.

The **Settings** screen groups device options one category at a time: display, sound and fullscreen, language, and touch controls on coarse-pointer devices. The browser saves them.

### CPU opponents

The Players screen offers four CPUs, in this order:

| CPU | Style |
| --- | --- |
| Kepler, Newton, Einstein | Easy, medium and hard. They search for a hitting shot and aim with an error that shrinks with every shot of a round. Kepler favours whoever is nearest; Newton wastes no power and holds the longest grudge, aiming back at whoever shot it last; Einstein is the most precise and, with power-ups on, angles its shot to sweep up a pickup on the way even when it misses. |
| Hawking | Searches like Einstein, with the same aim error, but prefers swing-bys. Enemy hits come first, and self-hit and friendly-hit safety is preserved. Among comparable safe shots it prefers more swing-by passes, then longer flights and paths within the full configured flight limit – also in Classic when trick-shot bonuses are off. |

New CPU seats start as Newton. In an online room the host seats CPUs in the same way (see [multiplayer.md](multiplayer.md)).

### Power-ups

Choose the active kinds in the *Power-ups* category. It works in Classic and Event Horizon, offline and in online rooms (the host sets it with the room's rules); the daily challenge and the menu background never use it. Leave every tile off to play with no power-ups. Online, the host's copy of the match runs everything and the guests send the keys: the power-up key, the aim and fire. Only the ship aiming a teleport sees where it would land. In Event Horizon a salvo counts as one pass, pickups keep clear of the black hole, and when it grows it pulls them in like planets: they drift towards it, the ones it swallows are gone and replaced, the fire key during the flight splits, and the killcam replays splits and shield bounces exactly.

Each kind has its own on/off tile (click or tap it, or ←/→ and Enter); all tiles may be off. *Pickups on the field* (1–4, usually 2) appears while at least one kind is active. There is no submenu. A round starts with that many, a taken pickup is replaced at once, and the field never holds more. *Reset rules* puts the choices back too.

- **Pickups** float on the field, each with its own symbol and a bright colour: a cyan eye for the preview, a magenta portal for the teleport, a gold fork for the splitter, a violet ring for the black hole, a red cracked disc for the planet killer, an icy cloud for the nebula, an orange disc with four arrows for the anti-gravity, a blue turret under a half ring for the planetary defense, a pale missile through broken armor for armor piercing, a cyan plasma blob for the plasma shot. A shot that flies close to one takes it, and keeps flying.
- **One held at a time.** Taking another one swaps it: the old one is lost.
- **Preview** shows the first two seconds of your current shot as a dotted line while you aim. Armed, it is spent by the next shot.
- **Teleport** is aimed, not guessed. Press **P** to open the aim and a portal ring appears where you would land: the angle sets the direction and the power sets the distance, up to half the field (more power changes nothing). Drag on the field, or turn with ← → and ↑ ↓. The ring is walked back out of any planet the aim would land in, so it never comes to rest inside one. **Fire** jumps there and spends your shot: the turn moves on and you shoot nothing this turn (nothing this volley, in Event Horizon). **P** again or **Esc** thinks again. Only the ship aiming sees its ring.
- **In a salvo** (Event Horizon, or Classic with simultaneous shots) every placement — teleport, black hole, planet killer, nebula, wormhole, polarity, planetary defense — is held back: fire locks the ship in and spends its shot, but the placement is only made when the volley takes off, once every ship has locked in. Until then the others aim at the field as it is. A placement that no longer works by then does nothing and keeps the power-up. Two planet killers on the same planet kill it once, and both ships lose theirs.
- **Splitter** is a two-step move: fire as usual, then press fire again while the shot is flying. The shot forks into three, fanned a few degrees. While it can still be split, the shot wears a gold ring. It stays until you use it, so you can keep it across turns.
- **Anti-gravity** (*Antigravitation*, an orange disc with four arrows pushing out) switches a planet's gravity round for the rest of the round: it pushes every shot away instead of pulling it in, yours and the enemy's missiles alike. It is aimed at a planet like the planet killer: **P** opens the aim, only the angle matters, and brackets lock onto the first planet the ray meets, with arrows showing what it will do. **Fire** turns it and spends your shot; an aim that meets no planet does nothing and keeps the power-up. A turned planet carries an orange rim and sends out orange rings, and its well disappears from the gravity contours. Using anti-gravity on a planet that is turned already turns it back, so the other side can undo it. In Event Horizon the planet stays turned while it drifts, and is gone when the hole swallows it. **P** again or **Esc** thinks again.
- **Shield** (*Schild*, a green shield) puts a bubble round your ship that bounces the next shot that would hit it back off the hull — the shot flies on, and the shield is spent doing so. It needs no key. Swapping it for another power-up takes it off.
- **Black hole** (*Schwarzes Loch*, a violet ring) is the rarest find. It is aimed like a teleport: **P** opens the aim and a dark ring shows where the hole would open, walked back out of any planet or existing hole. **Fire** opens it there and spends your shot. The new hole is the same for every ship, lasts the rest of the round and never grows, but it pulls shots in and swallows any that cross its horizon — a second gravity well next to the one in the middle. **P** again or **Esc** thinks again.
- **Planet killer** (*Planetenkiller*, a red cracked disc) is a rare find (as rare as a black hole): it removes a planet from the map for the rest of the round, and with it its gravity. It is aimed like a teleport, but at a planet: **P** opens the aim and a ray runs from your ship; only its angle matters, not the power, so no planet is ever out of reach. Brackets lock onto the first planet the ray meets (a dim ray to the field's edge means there is none). **Fire** blows that planet up and spends your shot; an aim that meets no planet does nothing and keeps the power-up. **P** again or **Esc** thinks again.
- **Nebula** (*Nebel*, an icy cloud) lays a cloud on the field. It is aimed like a black hole: **P** opens the aim and the cloud's footprint shows where it would settle, kept whole inside the field. **Fire** lays it there and spends your shot. A shot flying through the cloud is slowed and the gravity it feels is stronger, so it lingers and bends inside it. The cloud lasts the rest of the round. **P** again or **Esc** thinks again.
- **Armor piercing** (*Panzerbrechend*, a pale missile through broken armor) rides your next shot once armed with **P** (press P again to disarm): it goes straight through every ship it meets — shields and all, so a shield neither stops it nor saves its wearer — and keeps flying after the kill, through the next hull and on. A planet or a black hole still stops it.
- **Plasma shot** (*Plasmaschuss*, a cyan plasma blob) turns your next shot into a pulsing cyan blob once armed with **P** (press P again to disarm), and costs no shot. Planets and black holes pull it only 40 % as hard, and a nebula leaves it alone: no drag, no deeper gravity. It flies flatter and straighter, which makes it the answer to a nebula and a way past a black hole's pull, but a horizon still swallows it, and a planet, a hull or a shield stop it, and a planetary defense shoots at it, as with any shot. It cannot swing round a planet either, so a ship tucked behind one is harder to reach, and swing-bys, grazes and photon rings are all but out of reach with it.
- **Wormhole** (*Wurmloch*, two oval portals that look alike; proof of concept) is placed in two clicks: P, aim and fire to set the first portal, aim again and fire to set the second. Any distance will do, but a portal cannot overlap another one, the first of the pair included: the aim turns red and reads "overlaps", and the click does nothing. The two portals are identical, because a shot that reaches either one comes out of the other with its velocity unchanged: there is no entry and no exit. They turn to face each other, float, and carry a swirl. Each wormhole has a colour of its own (the palette starts over after six), shared by its two portals and a faint thread between them, so it is plain which belong together. Portals have no gravity and swallow nothing. Placing the pair spends the shot. In Event Horizon the portals stay where they are and do not drift with the planets, but when the growing hole reaches one of them it swallows it, and its partner is lost with it.
- **Planetary defense** (*Planetenabwehr*, three zones round a turret and a missile climbing out of them) sets a turret on a planet's surface. It is aimed at a planet like the planet killer: **P** opens the aim, only the angle matters, and the turret shows where the ray meets the rock's rim, with its three zones and the chance of a hit in each. **Fire** sets it there and spends your shot; an aim that meets no planet does nothing and keeps the power-up. The area is four times the planet's radius round the turret, in three zones: **100 %** in the inner one (the glass dome, 40 % of the radius), **50 %** in the middle one and **25 %** in the outer one. It works like the Iron Dome: as soon as an enemy shot flies into the area the turret fires a missile after it, once per shot. The missile homes in on the shot, flying fast but turning only so fast, and where it catches the shot decides the hit: it hits if its dice (rolled when it is fired, the same on every replay) are below the chance of that zone. So a shot that dives deep towards the turret is surely lost, one that cuts across the outskirts may well get through, and a missile that loses its shot flies on and burns out. Armor piercing is no exception. Your own shots and your team's fly through untouched. A planet has only one defense: setting one on a planet that already has one replaces it, whoever's it was (the aim says so). It lasts the rest of the round, or until a planet killer takes its planet. **P** again or **Esc** thinks again.
- **P** uses the held power-up: it opens the aim of a teleport, a black hole, a planet killer, a nebula, an anti-gravity or a planetary defense (P again thinks again), or arms a preview, armor piercing or a plasma shot (press P again to disarm). A splitter and a shield need no key.
- **Spawns:** two pickups at the start of a round, and never more than the amount on the field. A taken pickup is replaced at once. A pickup that fades (every ship still in has shot once per pass, and it fades after three passes) is replaced only once it is gone, so the next one waits for the old one to run out. Pickups lie on a path some ship could fire (so each can be reached), far enough from that ship that taking it costs a real shot, and preferably in a swing-by lane close above a planet. Often it is the path of the ship that is behind. A pickup blinks in its last pass and fades after three. Pickups pop in with a ring, burst into particles that fly to the ship that takes them, and a ship that swaps drops its old power-up as sparks.
- **CPUs** collect and use them too, except previews, which they leave lying. A CPU shield simply works. A CPU holding a teleport that finds no hitting shot jumps and plans again, one holding a plasma shot arms it and plans again, and a CPU with a splitter forks its shot once it flies close to an enemy. A CPU that holds a placement lays it roughly and spends its shot: a black hole or a nebula goes part way along the line to the nearest enemy, the planet killer shoots the planet most in the way of that line, a planetary defense goes on the planet nearest the CPU, on the side that faces it, an anti-gravity turns the nearest planet that still pulls (a CPU never turns one back), and a wormhole gets one portal a little way out from the CPU's ship and the other near the nearest enemy. A spot that does not work out falls back to an ordinary shot.
- The strip under each duel score shows the power-up a ship holds and the key that uses it. With three or more ships the scoreboard chip carries the symbol, and the key for the ship on turn. A shot that can still be split wears a gold ring.
- Teleports, splits, pickups, a planted black hole, a blown-up planet and a laid cloud all come with their own sounds and effects.
- **Touch:** a power-up button appears above the fire button while a ship holds a placement or a preview. With a splitter in the air the fire button reads *Split*.

### Mayhem

*Mayhem* is a mode of its own, next to Classic and Event Horizon on the local menu. Its setup has only what Mayhem needs: the mode the rounds are played in (*Played as*: Classic or Event Horizon), the number of rounds, the *Chaos level* (Mild, Wild or Insane), the maximum flight time, whether everybody shoots at once (Classic only) and the players. Everything else plays by the plain rules, which each round's twists then change. It works offline and online (in the lobby, *Mayhem* is a third game mode next to Classic and Event Horizon, and a Mayhem room shows up in the list as such). It never runs in the daily challenge or behind the title menu.

Before every round the twists are announced on a band across the field: each one spins like a reel and lands on its name, and the ships stay put until it is over. The fire key skips the announcement (online, anybody's does). Afterwards the twists stay on screen as chips under the round number, and the final screen lists what every round was about and who scored most in it.

- **The twists** are bundles of rules the game has anyway: *Billiard* (reflecting edges, two or three planets), *Blind flight* (invisible planets, Classic only), *Memory* (trails fade after a second, aim arrows hidden), *Precision* (every shot at one fixed power), *Short breath* (power capped at 30–50), *Crowded* (eight planets), *The void* (one planet), and the power-up rounds *Power-up rain* (four pickups, every kind), *Plasma storm* (only plasma and armor-piercing shots), *Gravity party* (black holes, anti-gravity, planet killers, nebulae, wormholes), *Fortress* (shields and planetary defense) and *Teleport chaos* (teleports, wormholes, splitters). Everything they don't touch stays plain: there is no betting; trick-shot bonuses are always on, as in Event Horizon, and in Classic you choose whether everybody shoots at once or one shot per turn.
- **Strength:** *Mild* plays one gentle twist a round (never one that takes away sight or power), with a calm round now and then as a breather. *Wild* plays one twist, now and then two. *Insane* plays two, now and then three.
- **The deck** is shuffled: every twist comes up once before any comes up twice, never the same one two rounds in a row, never two that take hold of the same thing (two power limits, two planet counts, two power-up themes), and never one that would change nothing. The first round always has a twist.
- **Finale:** the last round of a match with a set number of rounds always stacks at least two twists.
- **Jackpot:** now and then (from round two on, more often in the finale) a round pays and costs double: every kill, self-hit, high-five, multi-kill bonus, survival and last-ship bonus counts twice.

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

**Multi-kill chain:** the chain counts the enemies you take in a round, however they come: several in one turn — a splitter's three forks, or an armor-piercing round going through hull after hull — or one per turn adding up. The second pays 250, the third 500, the fourth 750 and the fifth 1000 (six ships are the most on the field, so five is as far as a round can go). A new round starts you over. The announcer names the run: DOUBLE KILL, MULTI KILL, MEGA KILL, MONSTER KILL.

**Scorecard:** at the end of every round a row of cards under the banner hands out awards – longest shot, fastest kill (timed from the start of the round), most swing-bys, most grazes, best hit and most kills (two or more). Three more cards appear when they were earned: the **closest call** (the narrowest miss of an enemy ship, under 40 px), the **sniper** (a hit from 500 px or more) and the **own-goal king**. The cards that come with a shot take turns: the card is outlined and its shot is redrawn in bright on the field. With power-ups on, two more cards can appear: **most power-ups** (taken) and the **lifesaver** (shots a shield bounced off). Only awards somebody actually earned show up, and a tie shares the card. The final screen lists the same awards for the whole match, plus a chart of everybody's score over the rounds. In Classic, swing-bys and grazes are counted even when trick-shot bonuses are off.
