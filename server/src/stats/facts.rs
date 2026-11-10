//! Facts for the menu: one-line findings the statistics make, each from a query of its own. A fact is an id and a few numbers;
//! the client words it in the player's language. A query answers one row whose first column is how many things it looked at: a fact
//! with too few of them is left out, so the menu never boasts of three shots.

use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tracing::warn;

use super::{MenuStats, Stats, Store};

/// How long a set of facts is handed out before one request starts making them anew (they move slowly: a day's worth of play barely shifts a share).
const FRESH: Duration = Duration::from_secs(10 * 60);

/// One finding: what it is about and its numbers (the sample size is not among them).
#[derive(Clone, Debug, PartialEq)]
pub struct Fact {
    pub id: &'static str,
    pub values: Vec<f64>,
}

impl Fact {
    pub fn json(&self) -> Value {
        json!({ "id": self.id, "values": self.values })
    }
}

/// A shot's share of the others, in percent, from a boolean expression over rows.
macro_rules! pct {
    ($hit:expr, $of:expr) => {
        concat!("100.0 * SUM(", $hit, ") / NULLIF(SUM(", $of, "), 0)")
    };
}

/// Whether a shot a player fired destroyed an enemy ship: itself, or for a splitter one of its forks. Over `stat_shots` unaliased.
macro_rules! hit {
    () => {
        "(hit_kind = 'enemy' OR (fan IS NOT NULL AND EXISTS (SELECT 1 FROM stat_shots f WHERE f.match_id = stat_shots.match_id AND f.round = stat_shots.round AND f.turn = stat_shots.turn AND f.fan = stat_shots.fan AND f.fork = 1 AND f.hit_kind = 'enemy')))"
    };
}

/// A fact that names a power-up sends it as its index in this list: the client keeps the same one, in the
/// same order (`src/net/statsFacts.ts`), so a new kind goes at the end of both.
macro_rules! placed_kind {
    () => {
        "CASE kind WHEN 'blackhole' THEN 0 WHEN 'wormhole' THEN 1 WHEN 'nebula' THEN 2 WHEN 'planetkiller' THEN 3 WHEN 'teleport' THEN 4 WHEN 'defense' THEN 5 WHEN 'antigravity' THEN 6 END"
    };
}

/// A fact that names an extra sends it as its index in this list: the client keeps the same one, in the same order
/// (`BONUS_KINDS` in `src/sim/config.ts`, and `report::BONUS_KINDS` here), so a new kind goes at the end of all three
/// (a test below holds this one to `report::BONUS_KINDS`).
macro_rules! bonus_kind {
    () => {
        "CASE kind WHEN 'firstBlood' THEN 0 WHEN 'bounty' THEN 1 WHEN 'revenge' THEN 2 WHEN 'shutdown' THEN 3 WHEN 'underdog' THEN 4 WHEN 'avenger' THEN 5 WHEN 'posthumous' THEN 6 WHEN 'domination' THEN 7 WHEN 'opener' THEN 8 WHEN 'comeback' THEN 9 END"
    };
}

/// Whether a round's rules (`rules` as `rules_to_value` writes it) play by this anomaly; a round from before them has none.
/// Only the `anomalies` list is searched, so another rule that happens to share a name never counts.
macro_rules! plays {
    ($anomaly:literal) => {
        concat!(
            "(COALESCE(instr(json_extract(rules, '$.anomalies'), '\"",
            $anomaly,
            "\"'), 0) > 0)"
        )
    };
}

/// Whether a round's rules play by any anomaly at all.
macro_rules! anomalous {
    () => {
        "(COALESCE(json_array_length(rules, '$.anomalies'), 0) > 0)"
    };
}

/// The field's edge in a round's rules. Rounds from before the loop say `bounce` instead: true was a wall, false the void.
macro_rules! walled {
    () => {
        "(rules LIKE '%\"edges\":\"wall\"%' OR rules LIKE '%\"bounce\":true%')"
    };
}
macro_rules! looped {
    () => {
        "(rules LIKE '%\"edges\":\"loop\"%')"
    };
}
macro_rules! open_edge {
    () => {
        concat!("(NOT ", walled!(), " AND NOT ", looped!(), ")")
    };
}

/// Joins a table with a `match_id` and a `round` to the rules that round was played by, as `rules` (a game's rounds can
/// differ, and a round outlives its game's row when the statistics are pruned). The table's own columns that `stat_rounds`
/// shares (`round`, `at`, `team` …) then need its name.
macro_rules! with_rules {
    ($table:literal) => {
        concat!(
            " JOIN stat_rounds g ON g.match_id = ",
            $table,
            ".match_id AND g.round = ",
            $table,
            ".round"
        )
    };
}

/// A fact that names an anomaly sends it as its index in this list (`c0`, `c1` …): the client keeps the same one, in the same
/// order (`ANOMALIES` in `src/sim/config.ts`, and `protocol::ANOMALIES` here), so a new one goes at the end of all three
/// (a test below holds this one to `protocol::ANOMALIES`). One pass over the rounds counts them all, and the rounds with any.
macro_rules! anomaly_counts {
    () => {
        concat!(
            "WITH c AS (SELECT SUM(", anomalous!(), ") AS rounds",
            ", SUM(", plays!("trickShots"), ") AS c0",
            ", SUM(", plays!("pinball"), ") AS c1",
            ", SUM(", plays!("fuse"), ") AS c2",
            ", SUM(", plays!("fusion"), ") AS c3",
            ", SUM(", plays!("whiteHole"), ") AS c4",
            ", SUM(", plays!("unstable"), ") AS c5",
            " FROM stat_rounds)",
            " SELECT rounds, k, n FROM (SELECT rounds, 0 AS k, c0 AS n FROM c UNION ALL SELECT rounds, 1, c1 FROM c",
            " UNION ALL SELECT rounds, 2, c2 FROM c UNION ALL SELECT rounds, 3, c3 FROM c",
            " UNION ALL SELECT rounds, 4, c4 FROM c UNION ALL SELECT rounds, 5, c5 FROM c)"
        )
    };
}

/// An id, the fewest things it needs to have looked at, and the query: `n` first, then the numbers.
///
/// Stats are reported by the hosts and taken at face value, so a fact that names a single record (a best, a biggest) asks for
/// many more samples than a share does: one rogue host cannot put a silly record on the menu on its own. A count asks for at
/// least two, so its sentence never speaks of "1 ships".
///
/// A shot is one a player fired (`fork = 0`): a splitter's forks are not shots of their own, though a ship one of them
/// destroys counts for the shot they came from.
type Query = (&'static str, i64, &'static str);

const QUERIES: &[Query] = &[
    // — Aim and power —
    (
        "shotsPerKill",
        20,
        "SELECT SUM(fork = 0), 1.0 * SUM(fork = 0) / NULLIF(SUM(CASE WHEN hit_kind = 'enemy' THEN hits ELSE 0 END), 0) FROM stat_shots",
    ),
    // Only an open edge loses shots: a wall throws them back, a loop carries them across.
    ("leftField", 20, concat!("SELECT COUNT(*), ", pct!("resolution = 'lost'", "1"), " FROM stat_shots", with_rules!("stat_shots"), " WHERE fork = 0 AND ", open_edge!())),
    ("planetCrash", 20, concat!("SELECT COUNT(*), ", pct!("resolution = 'planet'", "1"), " FROM stat_shots WHERE fork = 0")),
    ("holeShots", 20, concat!("SELECT COUNT(*), ", pct!("resolution = 'hole'", "1"), " FROM stat_shots WHERE fork = 0")),
    ("clash", 20, concat!("SELECT COUNT(*), ", pct!("resolution = 'clash'", "1"), " FROM stat_shots WHERE fork = 0")),
    (
        "firstTurn",
        10,
        concat!("SELECT SUM(turn = 1), ", pct!(concat!(hit!(), " AND turn = 1"), "turn = 1"), ", ", pct!(concat!(hit!(), " AND turn > 1"), "turn > 1"), " FROM stat_shots WHERE fork = 0"),
    ),
    (
        "maxPower",
        20,
        concat!("SELECT COUNT(*), ", pct!("power >= 99.5", "1"), ", ", pct!(concat!("power >= 99.5 AND ", hit!()), "power >= 99.5"), " FROM stat_shots WHERE fork = 0"),
    ),
    (
        "defaultPower",
        20,
        concat!("SELECT COUNT(*), ", pct!("power BETWEEN 49.5 AND 50.5", "1"), " FROM stat_shots WHERE turn = 1 AND fork = 0"),
    ),
    (
        "selfHighClassic",
        10,
        concat!(
            "SELECT SUM(s.power >= 80), ", pct!("s.hit_kind = 'self' AND s.power >= 80", "s.power >= 80"), ", ", pct!("s.hit_kind = 'self' AND s.power < 80", "s.power < 80"),
            " FROM stat_shots s JOIN stat_matches m ON m.match_id = s.match_id WHERE m.game_mode = 'classic' AND s.fork = 0"
        ),
    ),
    (
        "selfHighHorizon",
        10,
        concat!(
            "SELECT SUM(s.power >= 80), ", pct!("s.hit_kind = 'self' AND s.power >= 80", "s.power >= 80"), ", ", pct!("s.hit_kind = 'self' AND s.power < 80", "s.power < 80"),
            " FROM stat_shots s JOIN stat_matches m ON m.match_id = s.match_id WHERE m.game_mode = 'horizon' AND s.fork = 0"
        ),
    ),
    (
        "selfHighSolar",
        10,
        concat!(
            "SELECT SUM(s.power >= 80), ", pct!("s.hit_kind = 'self' AND s.power >= 80", "s.power >= 80"), ", ", pct!("s.hit_kind = 'self' AND s.power < 80", "s.power < 80"),
            " FROM stat_shots s JOIN stat_matches m ON m.match_id = s.match_id WHERE m.game_mode = 'solar' AND s.fork = 0"
        ),
    ),
    (
        "powerUpShots",
        10,
        concat!(
            "SELECT SUM(power_up IS NOT NULL), ", pct!(concat!(hit!(), " AND power_up IS NOT NULL"), "power_up IS NOT NULL"), ", ", pct!(concat!(hit!(), " AND power_up IS NULL"), "power_up IS NULL"),
            " FROM stat_shots WHERE fork = 0"
        ),
    ),
    (
        "repeatMiss",
        15,
        "SELECT COUNT(*), 100.0 * SUM(ABS(a.angle - b.angle) < 4 AND ABS(a.power - b.power) < 2) / COUNT(*)
         FROM stat_shots a JOIN stat_shots b
           ON b.match_id = a.match_id AND b.round = a.round AND b.seat = a.seat AND b.turn = a.turn + 1
         WHERE a.fork = 0 AND b.fork = 0 AND a.resolution IN ('planet', 'lost', 'clash')",
    ),
    // — Shot types, power and kills —
    ("plasmaShots", 5, concat!("SELECT SUM(power_up = 'plasma'), ", pct!("power_up = 'plasma'", "1"), ", ", pct!("hit_kind = 'enemy' AND power_up = 'plasma'", "power_up = 'plasma'"), " FROM stat_shots WHERE fork = 0")),
    ("piercingShots", 5, concat!("SELECT SUM(power_up = 'piercing'), ", pct!("power_up = 'piercing'", "1"), ", ", pct!("hit_kind = 'enemy' AND power_up = 'piercing'", "power_up = 'piercing'"), " FROM stat_shots WHERE fork = 0")),
    ("previewShots", 5, concat!("SELECT SUM(power_up = 'preview'), ", pct!("power_up = 'preview'", "1"), ", ", pct!("hit_kind = 'enemy' AND power_up = 'preview'", "power_up = 'preview'"), " FROM stat_shots WHERE fork = 0")),
    (
        "splitterShots",
        5,
        concat!("SELECT SUM(power_up = 'splitter'), ", pct!("power_up = 'splitter'", "1"), ", ", pct!(concat!(hit!(), " AND power_up = 'splitter'"), "power_up = 'splitter'"), " FROM stat_shots WHERE fork = 0"),
    ),
    (
        "lowPower",
        20,
        concat!("SELECT SUM(power < 20), ", pct!("power < 20", "1"), ", ", pct!(concat!(hit!(), " AND power < 20"), "power < 20"), " FROM stat_shots WHERE fork = 0"),
    ),
    ("avgKillTurn", 20, "SELECT COUNT(*), AVG(turn) FROM stat_shots WHERE hit_kind = 'enemy'"),
    ("longestShot", 25, "SELECT COUNT(*), MAX(longest_shot) FROM stat_rounds WHERE longest_shot IS NOT NULL"),
    ("sniper", 25, "SELECT COUNT(*), MAX(sniper) FROM stat_rounds WHERE sniper IS NOT NULL"),
    // A kill is an enemy ship: the chain counts a ship's kills in a round (2 a double kill, 3 a multi kill, 4 a mega kill, 5 a monster kill).
    (
        "multiKill",
        10,
        "SELECT COUNT(DISTINCT match_id || ':' || round), 100.0 * COUNT(DISTINCT CASE WHEN kills >= 2 THEN match_id || ':' || round END) / COUNT(DISTINCT match_id || ':' || round) FROM stat_seats",
    ),
    ("bigKills", 2, "SELECT SUM(kills >= 4), SUM(kills >= 4), SUM(kills >= 5) FROM stat_seats"),
    (
        "firstShotKill",
        20,
        concat!(
            "SELECT COUNT(*), ", pct!("s.hit_kind = 'enemy'", "1"),
            " FROM stat_shots s WHERE s.n = (SELECT MIN(x.n) FROM stat_shots x WHERE x.match_id = s.match_id AND x.round = s.round)"
        ),
    ),
    // Only Classic has a turn order; in Event Horizon everyone fires together.
    (
        "seatAdvantage",
        20,
        concat!(
            "SELECT COUNT(*), ", pct!("se.won = 1", "1"),
            " FROM stat_shots s
               JOIN stat_matches m ON m.match_id = s.match_id
               JOIN stat_seats se ON se.match_id = s.match_id AND se.round = s.round AND se.seat = s.seat
              WHERE m.game_mode = 'classic' AND s.n = (SELECT MIN(x.n) FROM stat_shots x WHERE x.match_id = s.match_id AND x.round = s.round)"
        ),
    ),
    // The leader after the first turn, alone in front, in a round that went on past it.
    (
        "comeback",
        20,
        concat!(
            "SELECT COUNT(*), ", pct!("se.won = 0", "1"),
            " FROM (SELECT t.match_id, t.round, t.seat FROM stat_turns t
                      JOIN stat_turns o ON o.match_id = t.match_id AND o.round = t.round AND o.turn = 1 AND o.seat <> t.seat
                     WHERE t.turn = 1 GROUP BY t.match_id, t.round, t.seat HAVING t.score > MAX(o.score)) l
               JOIN stat_rounds r ON r.match_id = l.match_id AND r.round = l.round AND r.turns > 1
               JOIN stat_seats se ON se.match_id = l.match_id AND se.round = l.round AND se.seat = l.seat"
        ),
    ),
    // — Power-ups laid on the field —
    (
        "topPlacement",
        10,
        concat!(
            "SELECT (SELECT COUNT(*) FROM stat_placements), ", placed_kind!(), ", COUNT(*) FROM stat_placements
              WHERE kind IN ('blackhole', 'wormhole', 'nebula', 'planetkiller', 'teleport', 'defense', 'antigravity')
              GROUP BY kind ORDER BY COUNT(*) DESC LIMIT 1"
        ),
    ),
    // A planet of -1 is a planet killer that found its planet already gone.
    ("planetsDestroyed", 2, "SELECT COUNT(*), COUNT(*) FROM stat_placements WHERE kind = 'planetkiller' AND planet >= 0"),
    // — Anomalies and the field's edge: what only some of them do is counted over the rounds that play by them, and a
    // comparison's other side is the rounds with no anomaly at all, so another anomaly never tips it —
    // A blast takes every ship in reach; its first victim is its hit.
    (
        "blastShots",
        20,
        concat!(
            "SELECT COUNT(*), ", pct!("resolution = 'blast'", "1"), ", ", pct!("resolution = 'blast' AND hit_kind IS NOT NULL", "resolution = 'blast'"),
            " FROM stat_shots", with_rules!("stat_shots"), " WHERE fork = 0 AND ", plays!("fuse")
        ),
    ),
    ("fusedShots", 20, concat!("SELECT COUNT(*), ", pct!("resolution = 'fused'", "1"), " FROM stat_shots", with_rules!("stat_shots"), " WHERE fork = 0 AND ", plays!("fusion"))),
    ("anomalyShare", 10, concat!("SELECT COUNT(*), ", pct!(anomalous!(), "1"), " FROM stat_rounds")),
    // A round with two anomalies counts for both.
    ("topAnomaly", 10, concat!(anomaly_counts!(), " WHERE n > 0 ORDER BY n DESC, k LIMIT 1")),
    (
        "trickShotHits",
        20,
        concat!(
            "SELECT SUM(", plays!("trickShots"), "), ",
            pct!(concat!(hit!(), " AND ", plays!("trickShots")), plays!("trickShots")), ", ",
            pct!(concat!(hit!(), " AND NOT ", anomalous!()), concat!("NOT ", anomalous!())),
            " FROM stat_shots", with_rules!("stat_shots"), " WHERE fork = 0"
        ),
    ),
    (
        "anomalyShotsPerKill",
        20,
        concat!(
            "SELECT SUM(fork = 0 AND ", anomalous!(), "),
                    1.0 * SUM(fork = 0 AND ", anomalous!(), ") / NULLIF(SUM(CASE WHEN hit_kind = 'enemy' AND ", anomalous!(), " THEN hits ELSE 0 END), 0),
                    1.0 * SUM(fork = 0 AND NOT ", anomalous!(), ") / NULLIF(SUM(CASE WHEN hit_kind = 'enemy' AND NOT ", anomalous!(), " THEN hits ELSE 0 END), 0)
               FROM stat_shots", with_rules!("stat_shots")
        ),
    ),
    (
        "pinballSelfHits",
        10,
        concat!(
            "SELECT SUM(", plays!("pinball"), "), ", pct!(concat!("title = 'selfHit' AND ", plays!("pinball")), plays!("pinball")), ", ",
            pct!(concat!("title = 'selfHit' AND NOT ", anomalous!()), concat!("NOT ", anomalous!())), " FROM stat_rounds"
        ),
    ),
    (
        "anomalyRoundLength",
        10,
        concat!(
            "SELECT SUM(", anomalous!(), "), AVG(CASE WHEN ", anomalous!(), " THEN seconds END), AVG(CASE WHEN NOT ", anomalous!(), " THEN seconds END)
               FROM stat_rounds WHERE seconds > 0"
        ),
    ),
    ("loopShare", 10, concat!("SELECT COUNT(*), ", pct!(looped!(), "1"), " FROM stat_rounds")),
    // Walls against an open edge in rounds without anomalies: Trick Shots Only, say, arms a shot at a wall.
    (
        "wallHits",
        20,
        concat!(
            "SELECT SUM(", walled!(), "), ", pct!(concat!(hit!(), " AND ", walled!()), walled!()), ", ",
            pct!(concat!(hit!(), " AND ", open_edge!()), open_edge!()),
            " FROM stat_shots", with_rules!("stat_shots"), " WHERE fork = 0 AND NOT ", anomalous!()
        ),
    ),
    // What the anomalies and the loop do to a seat's shots, from clients that count it (NULL from older ones).
    (
        "planetsShattered",
        2,
        concat!(
            "SELECT SUM(shatters), SUM(shatters), 1.0 * SUM(shatters) / COUNT(DISTINCT stat_seats.match_id || ':' || stat_seats.round)
               FROM stat_seats", with_rules!("stat_seats"), " WHERE shatters IS NOT NULL AND ", plays!("unstable")
        ),
    ),
    ("pinballBumps", 20, concat!("SELECT COUNT(*), 1.0 * SUM(bumps) / COUNT(*) FROM stat_seats", with_rules!("stat_seats"), " WHERE bumps IS NOT NULL AND ", plays!("pinball"))),
    // `arms` counts the seat's fired shots that got armed, not their forks or stray missiles, so it is a share of `shots`.
    (
        "armedShots",
        20,
        concat!(
            "SELECT SUM(shots), 100.0 * SUM(arms) / NULLIF(SUM(shots), 0) FROM stat_seats", with_rules!("stat_seats"),
            " WHERE arms IS NOT NULL AND ", plays!("trickShots")
        ),
    ),
    ("loopCrossings", 20, concat!("SELECT COUNT(*), 1.0 * SUM(loops) / COUNT(*) FROM stat_seats", with_rules!("stat_seats"), " WHERE loops IS NOT NULL AND ", looped!())),
    ("whiteHoleReturns", 2, "SELECT SUM(returns), SUM(returns) FROM stat_seats WHERE returns IS NOT NULL"),
    // — Rounds and games —
    ("rounds", 5, "SELECT COUNT(*), AVG(seconds), MAX(seconds) FROM stat_rounds WHERE seconds > 0"),
    ("selfHitRounds", 10, concat!("SELECT COUNT(*), ", pct!("title = 'selfHit'", "1"), " FROM stat_rounds")),
    ("noWinner", 10, concat!("SELECT COUNT(*), ", pct!("survivor IS NULL AND team IS NULL", "1"), " FROM stat_rounds")),
    ("horizonShare", 10, concat!("SELECT COUNT(*), ", pct!("game_mode = 'horizon'", "1"), " FROM stat_rounds")),
    ("solarShare", 10, concat!("SELECT COUNT(*), ", pct!("game_mode = 'solar'", "1"), " FROM stat_rounds")),
    ("teamShare", 10, concat!("SELECT COUNT(*), ", pct!("mode = 'team'", "1"), " FROM stat_rounds")),
    (
        "cpuWins",
        20,
        concat!(
            "SELECT COUNT(*), ", pct!("won = 1 AND cpu IS NULL", "cpu IS NULL"), ", ", pct!("won = 1 AND cpu IS NOT NULL", "cpu IS NOT NULL"),
            " FROM stat_seats WHERE match_id IN (SELECT match_id FROM stat_seats WHERE cpu IS NOT NULL) AND match_id IN (SELECT match_id FROM stat_seats WHERE cpu IS NULL)"
        ),
    ),
    ("quickRound", 10, concat!("SELECT COUNT(*), ", pct!("seconds < 30", "1"), " FROM stat_rounds WHERE seconds > 0")),
    ("soloVsCpu", 10, concat!("SELECT COUNT(*), ", pct!("humans = 1 AND cpus > 0", "1"), " FROM stat_rounds")),
    ("spectated", 10, concat!("SELECT COUNT(*), ", pct!("spectators > 0", "1"), " FROM stat_rounds")),
    ("avgHumans", 10, "SELECT COUNT(*), AVG(humans) FROM stat_rounds"),
    (
        "planetsEffect",
        10,
        concat!("SELECT SUM(planets >= 4), ", pct!("title = 'selfHit' AND planets >= 4", "planets >= 4"), ", ", pct!("title = 'selfHit' AND planets < 4", "planets < 4"), " FROM stat_rounds"),
    ),
    (
        "cpuLevels",
        40,
        concat!("SELECT SUM(cpu IN ('easy', 'hawking')), ", pct!("won = 1 AND cpu = 'hawking'", "cpu = 'hawking'"), ", ", pct!("won = 1 AND cpu = 'easy'", "cpu = 'easy'"), " FROM stat_seats"),
    ),
    ("pickups", 20, "SELECT COUNT(*), 1.0 * SUM(pickups) / COUNT(*) FROM stat_seats WHERE cpu IS NULL"),
    ("grazes", 20, "SELECT COUNT(*), 1.0 * SUM(grazes) / COUNT(*) FROM stat_seats WHERE cpu IS NULL"),
    // A save is a shield bouncing a shot that would have hit its holder.
    ("saves", 2, "SELECT SUM(saves), SUM(saves) FROM stat_seats"),
    // A planetary defense fires one missile at each enemy shot that flies into its area; one that loses its shot flies on as a
    // stray, and may still hit a ship. Rows from clients that do not count them yet are NULL and left out.
    ("intercepts", 10, concat!("SELECT SUM(missiles), ", pct!("intercepts", "missiles"), " FROM stat_seats WHERE missiles IS NOT NULL")),
    ("strayKills", 2, "SELECT SUM(stray_kills), SUM(stray_kills) FROM stat_seats"),
    // — Extras paid on top of the points; rounds from clients that do not pay them have no `bonuses` and are left out —
    // How often first blood goes on to win the round, where there were more than two ships (in a duel it always does).
    (
        "firstBlood",
        10,
        concat!(
            "SELECT COUNT(*), ", pct!("s.won = 1", "1"),
            " FROM stat_bonuses b
               JOIN stat_seats s ON s.match_id = b.match_id AND s.round = b.round AND s.seat = b.seat
               JOIN stat_rounds r ON r.match_id = b.match_id AND r.round = b.round
              WHERE b.kind = 'firstBlood' AND r.humans + r.cpus >= 3"
        ),
    ),
    // The biggest bounty is a record.
    ("bounties", 25, "SELECT COUNT(*), COUNT(*), MAX(points) FROM stat_bonuses WHERE kind = 'bounty'"),
    (
        "revenges",
        20,
        "SELECT SUM(s.kills), 100.0 * (SELECT COUNT(*) FROM stat_bonuses WHERE kind = 'revenge') / NULLIF(SUM(s.kills), 0)
           FROM stat_seats s JOIN stat_rounds r ON r.match_id = s.match_id AND r.round = s.round WHERE r.bonuses IS NOT NULL",
    ),
    // First blood is paid nearly every round, so it is not in the race.
    (
        "topBonus",
        10,
        concat!(
            "SELECT (SELECT COUNT(*) FROM stat_bonuses WHERE kind <> 'firstBlood'), ", bonus_kind!(), ", COUNT(*) FROM stat_bonuses
              WHERE kind <> 'firstBlood' GROUP BY kind ORDER BY COUNT(*) DESC, kind LIMIT 1"
        ),
    ),
    (
        "bonusPoints",
        10,
        "SELECT n, p, 1.0 * p / n FROM (SELECT (SELECT COUNT(*) FROM stat_rounds WHERE bonuses IS NOT NULL) AS n,
                                              (SELECT COALESCE(SUM(points), 0) FROM stat_bonuses) AS p)",
    ),
    ("dominations", 2, "SELECT COUNT(*), COUNT(*) FROM stat_bonuses WHERE kind = 'domination'"),
    ("posthumous", 2, "SELECT COUNT(*), COUNT(*) FROM stat_bonuses WHERE kind = 'posthumous'"),
    ("shutdowns", 2, "SELECT COUNT(*), COUNT(*) FROM stat_bonuses WHERE kind = 'shutdown'"),
    ("lastToFirst", 2, "SELECT COUNT(*), COUNT(*) FROM stat_bonuses WHERE kind = 'comeback'"),
    (
        "ownGoals",
        10,
        concat!("SELECT COUNT(*), ", pct!("o > 0", "1"), " FROM (SELECT SUM(own_goals) AS o FROM stat_seats WHERE player IS NOT NULL GROUP BY match_id, player)"),
    ),
    ("swingbys", 10, "SELECT COUNT(*), 1.0 * SUM(swingbys) / COUNT(DISTINCT match_id || ':' || round) FROM stat_seats"),
    ("bestHit", 25, "SELECT COUNT(*), MAX(best_hit) FROM stat_rounds WHERE best_hit IS NOT NULL"),
    ("fastestKill", 25, "SELECT COUNT(*), MIN(fastest_kill) FROM stat_rounds WHERE fastest_kill IS NOT NULL"),
    ("closeCall", 25, "SELECT COUNT(*), MIN(close_call) FROM stat_rounds WHERE close_call > 0"),
    // Today's people and rounds, online and on one device: a person is the same pseudonym in both.
    (
        "todayPlayers",
        1,
        "SELECT r, p, r FROM (
             SELECT COALESCE((SELECT rounds FROM stat_days WHERE day = date('now')), 0)
                  + COALESCE((SELECT rounds FROM stat_local_days WHERE day = date('now')), 0) AS r,
                    (SELECT COUNT(*) FROM (SELECT player FROM stat_day_players WHERE day = date('now')
                                           UNION SELECT player FROM stat_local_day_players WHERE day = date('now'))) AS p)",
    ),
    ("dailyChallenge", 2, "SELECT COUNT(*), COUNT(*), MAX(score) FROM daily_scores WHERE day = date('now')"),
    // The week's rounds against the week before; the weekend's share needs two weeks of days to mean anything.
    (
        "weekTrend",
        20,
        "SELECT p, t, 100.0 * t / p FROM (
             SELECT SUM(CASE WHEN day <= date('now', '-7 days') AND day > date('now', '-14 days') THEN rounds END) AS p,
                    COALESCE(SUM(CASE WHEN day > date('now', '-7 days') THEN rounds END), 0) AS t
             FROM stat_days)",
    ),
    ("weekend", 14, concat!("SELECT COUNT(DISTINCT day), ", pct!("strftime('%w', day) IN ('0', '6')", "1"), " FROM stat_rounds")),
    // — The oracle: tips and bets —
    ("tipRound", 5, concat!("SELECT COUNT(*), ", pct!("correct = 1", "1"), " FROM stat_tips WHERE kind = 'round'")),
    ("tipShot", 5, concat!("SELECT COUNT(*), ", pct!("correct = 1", "1"), " FROM stat_tips WHERE kind = 'shot'")),
    ("tipUnderdog", 5, concat!("SELECT COUNT(*), ", pct!("underdog = 1", "1"), " FROM stat_tips WHERE correct = 1")),
    ("tipStands", 5, concat!("SELECT COUNT(*), ", pct!("stands = 1", "1"), " FROM stat_tips")),
    ("betPaid", 5, concat!("SELECT COUNT(*), ", pct!("payout > stake", "1"), " FROM stat_tips WHERE stake > 0")),
    ("betStake", 5, "SELECT COUNT(*), AVG(stake), MAX(stake) FROM stat_tips WHERE stake > 0"),
    ("betWin", 25, "SELECT COUNT(*), MAX(payout - stake) FROM stat_tips WHERE stake > 0 AND payout > stake"),
    ("betLoss", 25, "SELECT COUNT(*), MAX(stake) FROM stat_tips WHERE stake > 0 AND payout = 0"),
];

impl Stats {
    /// The facts and favourites, always from the cache once there is one: a request never waits for the queries. Ones older than
    /// `FRESH` are still handed out while one task in the background makes them anew, so the menus of any number of visitors cost
    /// one set of queries per `FRESH`, and only the very first request after a start waits for them.
    pub async fn menu_shared(&self) -> Arc<MenuStats> {
        let mut held = self.facts.lock().await;
        if let Some((made, menu)) = held.as_ref() {
            if made.elapsed() >= FRESH && !self.refreshing_facts.swap(true, Ordering::AcqRel) {
                let store = self.store.clone();
                tokio::spawn(async move {
                    let menu = Arc::new(store.menu().await);
                    *store.facts.lock().await = Some((Instant::now(), menu));
                    store.refreshing_facts.store(false, Ordering::Release);
                });
            }
            return menu.clone();
        }
        let menu = Arc::new(self.menu().await);
        *held = Some((Instant::now(), menu.clone()));
        menu
    }
}

impl Store {
    /// What the menu shows. Favourites that cannot be read are none: a quick game then plays the standard rules.
    pub async fn menu(&self) -> MenuStats {
        let favorites = self.favorites().await.unwrap_or_else(|err| {
            warn!(%err, "the favourites could not be read");
            Vec::new()
        });
        MenuStats {
            facts: self.facts().await,
            favorites,
        }
    }

    /// Every fact the data can back. A query that fails is left out, not fatal: the menu shows the rest.
    pub async fn facts(&self) -> Vec<Fact> {
        let mut out = Vec::new();
        for (id, at_least, sql) in QUERIES {
            match self.fact(sql, *at_least).await {
                Ok(Some(values)) => out.push(Fact { id, values }),
                Ok(None) => {}
                Err(err) => warn!(%err, fact = id, "a fact could not be read"),
            }
        }
        out
    }

    async fn fact(&self, sql: &str, at_least: i64) -> turso::Result<Option<Vec<f64>>> {
        let mut rows = self.facts_reader.query(sql, ()).await?;
        let Some(row) = rows.next().await? else {
            return Ok(None);
        };
        let n = row.get_value(0)?;
        let enough = match n {
            turso::Value::Integer(n) => n >= at_least,
            turso::Value::Real(n) => n >= at_least as f64,
            _ => false,
        };
        if !enough {
            return Ok(None);
        }
        let mut values = Vec::new();
        for column in 1.. {
            let Ok(value) = row.get_value(column) else {
                break;
            };
            match value {
                turso::Value::Integer(v) => values.push(v as f64),
                turso::Value::Real(v) if v.is_finite() => values.push(v),
                // A number the data cannot give (nothing to divide by) spoils the whole fact.
                _ => return Ok(None),
            }
        }
        // "0 % of rounds are played in teams" is no finding.
        if values.iter().all(|v| *v == 0.0) {
            return Ok(None);
        }
        Ok(Some(values))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::stats::Stats;

    #[tokio::test]
    async fn every_query_runs_even_on_an_empty_database() {
        let stats = Stats::in_memory().await;
        for (id, _, sql) in QUERIES {
            let mut rows = stats
                .reader
                .query(*sql, ())
                .await
                .unwrap_or_else(|e| panic!("{id}: {e}"));
            while rows
                .next()
                .await
                .unwrap_or_else(|e| panic!("{id}: {e}"))
                .is_some()
            {}
        }
        assert!(stats.facts().await.is_empty());
    }

    /// A small database with a row in every table the facts read: a Classic round, its two turns with a splitter whose fork
    /// destroys the other ship, placements, CPU seats, and a daily challenge entry.
    async fn played() -> Stats {
        let stats = Stats::in_memory().await;
        let rows = [
            "INSERT INTO stat_matches VALUES ('m', 0, 1, 'classic', 'ffa', '{}', '[]', 1, 'online', NULL)",
            "INSERT INTO stat_rounds (match_id, room_id, round, at, day, game_mode, mode, rules, humans, cpus, spectators, title, survivor, team, seconds, planets, turns)
             VALUES ('m', 'r', 1, 0, date('now'), 'classic', 'ffa', '{}', 1, 1, 0, 'hit', 0, NULL, 40.0, 3, 2)",
            "INSERT INTO stat_seats (match_id, round, seat, at, player, cpu, team, won, alive, score, shots, kills, swingbys, grazes, own_goals, pickups, saves, missiles, intercepts, stray_kills)
             VALUES ('m', 1, 0, 0, 'p', NULL, NULL, 1, 1, 500, 2, 1, 0, 0, 0, 0, 0, 2, 1, 0),
                    ('m', 1, 1, 0, NULL, 'easy', NULL, 0, 0, 100, 2, 0, 0, 0, 0, 0, 0, NULL, NULL, NULL)",
            "UPDATE stat_rounds SET bonuses = 3",
            "INSERT INTO stat_bonuses VALUES ('m', 1, 1, 0, 0, 'firstBlood', 100), ('m', 1, 2, 0, 0, 'bounty', 120), ('m', 1, 3, 0, 0, 'opener', 100)",
            "INSERT INTO stat_turns VALUES ('m', 1, 1, 0, 0, 'p', NULL, 1, 0), ('m', 1, 1, 1, 0, NULL, 'easy', 1, 100)",
            "INSERT INTO stat_shots (match_id, round, turn, n, at, seat, player, cpu, angle, power, power_up, fork, fan, split_at, rider, resolution, hits, hit_seat, hit_kind, points)
             VALUES ('m', 1, 1, 1, 0, 0, 'p', NULL, 10, 50, NULL, 0, NULL, NULL, NULL, 'lost', 0, NULL, NULL, 0),
                    ('m', 1, 1, 2, 0, 1, NULL, 'easy', 190, 100, NULL, 0, NULL, NULL, NULL, 'planet', 0, NULL, NULL, 0),
                    ('m', 1, 2, 3, 0, 0, 'p', NULL, 12, 60, 'splitter', 0, 1, 40, NULL, 'lost', 0, NULL, NULL, 0),
                    ('m', 1, 2, 4, 0, 0, 'p', NULL, 12, 60, 'splitter', 1, 1, 40, NULL, 'ship', 1, 1, 'enemy', 500)",
            "INSERT INTO stat_placements VALUES ('m', 1, 2, 1, 0, 0, 'teleport', NULL, NULL, NULL, NULL, NULL), ('m', 1, 2, 2, 0, 1, 'defense', NULL, NULL, NULL, NULL, 2)",
            "INSERT INTO stat_days VALUES (date('now'), 1, 600)",
            "INSERT INTO stat_day_players VALUES (date('now'), 'p')",
            "INSERT INTO daily_scores VALUES (date('now'), 'p', 'Ann', 4000, 0)",
        ];
        for sql in rows {
            stats
                .conn
                .execute(sql, ())
                .await
                .unwrap_or_else(|e| panic!("{sql}: {e}"));
        }
        stats
    }

    #[tokio::test]
    async fn every_query_reads_a_played_database_without_an_error() {
        let stats = played().await;
        for (id, _, sql) in QUERIES {
            stats
                .fact(sql, 0)
                .await
                .unwrap_or_else(|e| panic!("{id}: {e}"));
        }
    }

    #[tokio::test]
    async fn a_splitter_counts_as_one_shot_and_its_fork_s_kill_as_its_hit() {
        let stats = played().await;
        let query = |id: &str| QUERIES.iter().find(|(q, _, _)| *q == id).unwrap().2;
        // Three shots fired, the fork not among them; one of them a splitter, which hit.
        assert_eq!(
            stats.fact(query("splitterShots"), 0).await.unwrap(),
            Some(vec![100.0 / 3.0, 100.0])
        );
        assert_eq!(
            stats.fact(query("shotsPerKill"), 0).await.unwrap(),
            Some(vec![3.0])
        );
        assert_eq!(
            stats.fact(query("todayPlayers"), 0).await.unwrap(),
            Some(vec![1.0, 1.0])
        );
        assert_eq!(
            stats.fact(query("topPlacement"), 0).await.unwrap(),
            Some(vec![4.0, 1.0])
        );
    }

    #[tokio::test]
    async fn the_extras_read_the_rounds_that_report_them() {
        let stats = played().await;
        let query = |id: &str| QUERIES.iter().find(|(q, _, _)| *q == id).unwrap().2;
        // The one bounty, and what it paid. The one kill was no revenge, and 0 % is no fact.
        assert_eq!(
            stats.fact(query("bounties"), 0).await.unwrap(),
            Some(vec![1.0, 120.0])
        );
        // Two extras besides first blood, the bounty first on a tie of one each (a tie goes by name); 320 points in the one round.
        assert_eq!(
            stats
                .fact(query("topBonus"), 0)
                .await
                .unwrap()
                .map(|v| v[1]),
            Some(1.0)
        );
        assert_eq!(
            stats.fact(query("bonusPoints"), 0).await.unwrap(),
            Some(vec![320.0, 320.0])
        );
        assert_eq!(stats.fact(query("revenges"), 0).await.unwrap(), None);
        // A duel's first blood always wins, so it is not asked about.
        assert_eq!(stats.fact(query("firstBlood"), 0).await.unwrap(), None);
    }

    #[test]
    fn the_bonus_kinds_are_numbered_as_the_report_lists_them() {
        let case = bonus_kind!();
        for (i, kind) in crate::report::BONUS_KINDS.iter().enumerate() {
            assert!(
                case.contains(&format!("WHEN '{kind}' THEN {i} ")),
                "{kind} is not {i}"
            );
        }
        assert_eq!(
            case.matches(" WHEN ").count(),
            crate::report::BONUS_KINDS.len()
        );
    }

    #[test]
    fn the_anomalies_are_numbered_as_the_protocol_lists_them() {
        let sql = anomaly_counts!();
        assert_eq!(
            sql.matches(") AS c").count(),
            crate::protocol::ANOMALIES.len()
        );
        for (i, anomaly) in crate::protocol::ANOMALIES.iter().enumerate() {
            assert!(
                sql.contains(&format!("'\"{anomaly}\"'), 0) > 0)) AS c{i}"))
                    && sql.contains(&format!("SELECT rounds, {i}")),
                "{anomaly} is not {i}"
            );
        }
    }

    #[tokio::test]
    async fn an_anomaly_is_only_looked_for_in_the_anomalies() {
        let stats = Stats::in_memory().await;
        let rules = r#"{"anomalies":["pinball"],"powerUpKinds":["fuse"]}"#;
        let count = |cond: &str| {
            format!("SELECT COUNT(*), COUNT(*) FROM (SELECT '{rules}' AS rules) WHERE {cond}")
        };
        assert_eq!(
            stats.fact(&count(plays!("pinball")), 0).await.unwrap(),
            Some(vec![1.0])
        );
        assert_eq!(stats.fact(&count(plays!("fuse")), 0).await.unwrap(), None);
        assert_eq!(
            stats.fact(&count(anomalous!()), 0).await.unwrap(),
            Some(vec![1.0])
        );
        let none = "SELECT COUNT(*), COUNT(*) FROM (SELECT '{\"anomalies\":[]}' AS rules UNION ALL SELECT '{}') WHERE ";
        assert_eq!(
            stats
                .fact(&format!("{none}{}", anomalous!()), 0)
                .await
                .unwrap(),
            None
        );
        assert_eq!(
            stats
                .fact(&format!("{none}NOT {}", anomalous!()), 0)
                .await
                .unwrap(),
            Some(vec![2.0])
        );
    }

    /// Four more games beside the plain one of `played` (open edge, no anomalies, 40 s):
    /// - `a` by Time Fuse and Fusion, open edge, 30 s: a blast that takes a ship, a fused shot, a miss and a blast that takes none;
    /// - `b` by Pinball, looped, 20 s, a self-hit round: no shots logged, but its seats' bumps and crossings;
    /// - `c` by Trick Shots Only, Unstable and White Hole, walled, 50 s: two shots that both kill, and its seats' counts;
    /// - `d` by no anomalies, walled, 40 s: a shot that kills and one that hits a planet.
    async fn anomalies() -> Stats {
        let stats = played().await;
        let both = r#"{"rounds":1,"edges":"void","anomalies":["fuse","fusion"]}"#;
        let pinball = r#"{"rounds":1,"edges":"loop","anomalies":["pinball"]}"#;
        let tricks =
            r#"{"rounds":1,"edges":"wall","anomalies":["trickShots","whiteHole","unstable"]}"#;
        let walls = r#"{"rounds":1,"edges":"wall","anomalies":[]}"#;
        let rows = [
            format!(
                "INSERT INTO stat_matches VALUES ('a', 0, 2, 'classic', 'ffa', '{both}', '[]', 1, 'online', NULL), ('b', 0, 3, 'classic', 'ffa', '{pinball}', '[]', 1, 'local', NULL),
                                                 ('c', 0, 4, 'classic', 'ffa', '{tricks}', '[]', 1, 'online', NULL), ('d', 0, 5, 'classic', 'ffa', '{walls}', '[]', 1, 'online', NULL)"
            ),
            format!(
                "INSERT INTO stat_rounds (match_id, room_id, round, at, day, game_mode, mode, rules, humans, cpus, spectators, title, survivor, team, seconds, planets, turns)
                 VALUES ('a', 'r', 1, 0, date('now'), 'classic', 'ffa', '{both}', 2, 0, 0, 'hit', 0, NULL, 30.0, 3, 1),
                        ('b', 'r', 1, 0, date('now'), 'classic', 'ffa', '{pinball}', 1, 1, 0, 'selfHit', 0, NULL, 20.0, 3, 1),
                        ('c', 'r', 1, 0, date('now'), 'classic', 'ffa', '{tricks}', 2, 0, 0, 'hit', 0, NULL, 50.0, 3, 1),
                        ('d', 'r', 1, 0, date('now'), 'classic', 'ffa', '{walls}', 2, 0, 0, 'hit', 0, NULL, 40.0, 3, 1)"
            ),
            "INSERT INTO stat_shots (match_id, round, turn, n, at, seat, player, cpu, angle, power, power_up, fork, fan, split_at, rider, resolution, hits, hit_seat, hit_kind, points)
             VALUES ('a', 1, 1, 1, 0, 0, 'p', NULL, 10, 50, NULL, 0, NULL, NULL, NULL, 'blast', 1, 1, 'enemy', 500),
                    ('a', 1, 1, 2, 0, 1, 'q', NULL, 190, 50, NULL, 0, NULL, NULL, NULL, 'fused', 0, NULL, NULL, 0),
                    ('a', 1, 1, 3, 0, 1, 'q', NULL, 190, 50, NULL, 0, NULL, NULL, NULL, 'lost', 0, NULL, NULL, 0),
                    ('a', 1, 1, 4, 0, 1, 'q', NULL, 190, 50, NULL, 0, NULL, NULL, NULL, 'blast', 0, NULL, NULL, 0),
                    ('c', 1, 1, 1, 0, 0, 'p', NULL, 10, 50, NULL, 0, NULL, NULL, NULL, 'ship', 1, 1, 'enemy', 500),
                    ('c', 1, 1, 2, 0, 1, 'q', NULL, 190, 50, NULL, 0, NULL, NULL, NULL, 'ship', 1, 0, 'enemy', 500),
                    ('d', 1, 1, 1, 0, 0, 'p', NULL, 10, 50, NULL, 0, NULL, NULL, NULL, 'ship', 1, 1, 'enemy', 500),
                    ('d', 1, 1, 2, 0, 1, 'q', NULL, 190, 50, NULL, 0, NULL, NULL, NULL, 'planet', 0, NULL, NULL, 0)"
                .to_string(),
            "INSERT INTO stat_seats (match_id, round, seat, at, player, cpu, team, won, alive, score, shots, kills, swingbys, grazes, own_goals, pickups, saves,
                                     shatters, bumps, arms, loops, returns)
             VALUES ('b', 1, 0, 0, 'p', NULL, NULL, 0, 0, 0, 2, 0, 0, 0, 1, 0, 0, 0, 3, 0, 2, 0),
                    ('b', 1, 1, 0, NULL, 'easy', NULL, 1, 1, 0, 2, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0),
                    ('c', 1, 0, 0, 'p', NULL, NULL, 1, 1, 500, 4, 1, 0, 0, 0, 0, 0, 1, 0, 2, 0, 2),
                    ('c', 1, 1, 0, 'q', NULL, NULL, 0, 0, 500, 2, 1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0)"
                .to_string(),
        ];
        for sql in rows {
            stats
                .conn
                .execute(&sql, ())
                .await
                .unwrap_or_else(|e| panic!("{sql}: {e}"));
        }
        stats
    }

    #[tokio::test]
    async fn anomaly_facts_read_the_games_that_play_by_them() {
        let stats = anomalies().await;
        let fact = |id: &'static str| {
            let sql = QUERIES.iter().find(|(q, _, _)| *q == id).unwrap().2;
            let stats = &stats;
            async move { stats.fact(sql, 0).await.unwrap() }
        };
        // Of the Time Fuse game's four shots two went off, one of them taking a ship; the other games' shots are not asked.
        assert_eq!(fact("blastShots").await, Some(vec![50.0, 50.0]));
        assert_eq!(fact("fusedShots").await, Some(vec![25.0]));
        // Three of the five rounds play by anomalies, each anomaly one round: the first in the list wins the tie.
        assert_eq!(fact("anomalyShare").await, Some(vec![60.0]));
        assert_eq!(fact("topAnomaly").await, Some(vec![0.0, 1.0]));
        // Both Trick Shots Only shots killed; of the five in games without anomalies two did (the splitter's fork and one of `d`).
        // The blast of `a` is in neither: its game plays by other anomalies.
        assert_eq!(fact("trickShotHits").await, Some(vec![100.0, 40.0]));
        // Six shots and three kills with anomalies, five shots and two kills without.
        assert_eq!(fact("anomalyShotsPerKill").await, Some(vec![2.0, 2.5]));
        assert_eq!(fact("pinballSelfHits").await, Some(vec![100.0, 0.0]));
        assert_eq!(
            fact("anomalyRoundLength").await,
            Some(vec![100.0 / 3.0, 40.0])
        );
        assert_eq!(fact("loopShare").await, Some(vec![20.0]));
        // In games without anomalies, walled: one kill in the two shots of `d`; open: one in the plain game's three.
        assert_eq!(fact("wallHits").await, Some(vec![50.0, 100.0 / 3.0]));
        // Only an open edge loses shots: two in the plain game and one in `a`, of seven.
        assert_eq!(fact("leftField").await, Some(vec![300.0 / 7.0]));
        assert_eq!(fact("planetsShattered").await, Some(vec![2.0, 2.0]));
        assert_eq!(fact("pinballBumps").await, Some(vec![2.0]));
        assert_eq!(fact("armedShots").await, Some(vec![50.0]));
        assert_eq!(fact("loopCrossings").await, Some(vec![1.0]));
        assert_eq!(fact("whiteHoleReturns").await, Some(vec![2.0]));
        // The sample is the anomaly rounds, not all rounds.
        let top = QUERIES
            .iter()
            .find(|(q, _, _)| *q == "topAnomaly")
            .unwrap()
            .2;
        assert_eq!(stats.fact(top, 4).await.unwrap(), None);
        assert!(stats.fact(top, 3).await.unwrap().is_some());
        // A round is read by its own rules, so it keeps them when its game's row is pruned before it.
        stats
            .conn
            .execute("DELETE FROM stat_matches", ())
            .await
            .unwrap();
        assert_eq!(fact("leftField").await, Some(vec![300.0 / 7.0]));
        assert_eq!(fact("blastShots").await, Some(vec![50.0, 50.0]));
        assert_eq!(fact("armedShots").await, Some(vec![50.0]));
    }

    #[tokio::test]
    async fn a_blast_that_takes_a_teammate_or_its_shooter_takes_a_ship() {
        let stats = anomalies().await;
        stats
            .conn
            .execute(
                "UPDATE stat_shots SET hit_kind = 'team' WHERE match_id = 'a' AND n = 1",
                (),
            )
            .await
            .unwrap();
        let sql = QUERIES
            .iter()
            .find(|(q, _, _)| *q == "blastShots")
            .unwrap()
            .2;
        assert_eq!(stats.fact(sql, 0).await.unwrap(), Some(vec![50.0, 50.0]));
    }

    #[tokio::test]
    async fn a_round_from_before_the_loop_keeps_its_wall() {
        let stats = played().await;
        stats
            .conn
            .execute(
                "UPDATE stat_rounds SET rules = '{\"rounds\":1,\"bounce\":true}'",
                (),
            )
            .await
            .unwrap();
        let walled = concat!(
            "SELECT COUNT(*), COUNT(*) FROM stat_rounds WHERE ",
            walled!()
        );
        let open = concat!(
            "SELECT COUNT(*), COUNT(*) FROM stat_rounds WHERE ",
            open_edge!()
        );
        assert_eq!(stats.fact(walled, 0).await.unwrap(), Some(vec![1.0]));
        assert_eq!(stats.fact(open, 0).await.unwrap(), None);
    }

    #[tokio::test]
    async fn without_anomaly_games_there_are_no_anomaly_facts() {
        let stats = played().await;
        let query = |id: &str| QUERIES.iter().find(|(q, _, _)| *q == id).unwrap().2;
        for id in [
            "blastShots",
            "fusedShots",
            "anomalyShare",
            "topAnomaly",
            "trickShotHits",
            "anomalyShotsPerKill",
            "pinballSelfHits",
            "anomalyRoundLength",
            "loopShare",
            "wallHits",
            "planetsShattered",
            "pinballBumps",
            "armedShots",
            "loopCrossings",
            "whiteHoleReturns",
        ] {
            assert_eq!(stats.fact(query(id), 0).await.unwrap(), None, "{id}");
        }
    }

    #[tokio::test]
    async fn a_fact_whose_numbers_are_all_zero_is_left_out() {
        let stats = played().await;
        let query = |id: &str| QUERIES.iter().find(|(q, _, _)| *q == id).unwrap().2;
        assert_eq!(stats.fact(query("teamShare"), 0).await.unwrap(), None);
    }

    #[tokio::test]
    async fn facts_are_made_once_and_handed_out_from_the_cache() {
        let stats = Stats::in_memory().await;
        let first = stats.menu_shared().await;
        assert!(Arc::ptr_eq(&first, &stats.menu_shared().await));
    }
}
