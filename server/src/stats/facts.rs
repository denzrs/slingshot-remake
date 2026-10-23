//! Facts for the menu: one-line findings the statistics make, each from a query of its own. A fact is an id and a few numbers;
//! the client words it in the player's language. A query answers one row whose first column is how many things it looked at: a fact
//! with too few of them is left out, so the menu never boasts of three shots.

use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tracing::warn;

use super::{Stats, Store};

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

/// An id, the fewest things it needs to have looked at, and the query: `n` first, then the numbers.
///
/// Stats are reported by the hosts and taken at face value, so a fact that names a single record (a best, a biggest) asks for
/// many more samples than a share does: one rogue host cannot put a silly record on the menu on its own.
type Query = (&'static str, i64, &'static str);

const QUERIES: &[Query] = &[
    // — Aim and power —
    ("hitRate", 20, concat!("SELECT COUNT(*), ", pct!("hit_kind = 'enemy'", "1"), " FROM stat_shots")),
    ("leftField", 20, concat!("SELECT COUNT(*), ", pct!("resolution = 'lost'", "1"), " FROM stat_shots")),
    ("planetCrash", 20, concat!("SELECT COUNT(*), ", pct!("resolution = 'planet'", "1"), " FROM stat_shots")),
    ("clash", 20, concat!("SELECT COUNT(*), ", pct!("resolution = 'clash'", "1"), " FROM stat_shots")),
    (
        "firstTurn",
        10,
        concat!("SELECT SUM(turn = 1), ", pct!("hit_kind = 'enemy' AND turn = 1", "turn = 1"), ", ", pct!("hit_kind = 'enemy' AND turn > 1", "turn > 1"), " FROM stat_shots"),
    ),
    (
        "maxPower",
        20,
        concat!("SELECT COUNT(*), ", pct!("power >= 99.5", "1"), ", ", pct!("power >= 99.5 AND hit_kind = 'enemy'", "power >= 99.5"), " FROM stat_shots"),
    ),
    (
        "defaultPower",
        20,
        concat!("SELECT COUNT(*), ", pct!("power BETWEEN 49.5 AND 50.5", "1"), " FROM stat_shots WHERE turn = 1"),
    ),
    (
        "selfHighClassic",
        10,
        concat!(
            "SELECT SUM(s.power >= 80), ", pct!("s.hit_kind = 'self' AND s.power >= 80", "s.power >= 80"), ", ", pct!("s.hit_kind = 'self' AND s.power < 80", "s.power < 80"),
            " FROM stat_shots s JOIN stat_matches m ON m.match_id = s.match_id WHERE m.game_mode = 'classic'"
        ),
    ),
    (
        "selfHighHorizon",
        10,
        concat!(
            "SELECT SUM(s.power >= 80), ", pct!("s.hit_kind = 'self' AND s.power >= 80", "s.power >= 80"), ", ", pct!("s.hit_kind = 'self' AND s.power < 80", "s.power < 80"),
            " FROM stat_shots s JOIN stat_matches m ON m.match_id = s.match_id WHERE m.game_mode = 'horizon'"
        ),
    ),
    (
        "powerUpShots",
        10,
        concat!("SELECT SUM(power_up IS NOT NULL), ", pct!("hit_kind = 'enemy' AND power_up IS NOT NULL", "power_up IS NOT NULL"), ", ", pct!("hit_kind = 'enemy' AND power_up IS NULL", "power_up IS NULL"), " FROM stat_shots"),
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
    ("plasmaShots", 5, concat!("SELECT SUM(power_up = 'plasma'), ", pct!("power_up = 'plasma'", "1"), ", ", pct!("hit_kind = 'enemy' AND power_up = 'plasma'", "power_up = 'plasma'"), " FROM stat_shots")),
    ("piercingShots", 5, concat!("SELECT SUM(power_up = 'piercing'), ", pct!("power_up = 'piercing'", "1"), ", ", pct!("hit_kind = 'enemy' AND power_up = 'piercing'", "power_up = 'piercing'"), " FROM stat_shots")),
    ("splitterShots", 5, concat!("SELECT SUM(power_up = 'splitter'), ", pct!("power_up = 'splitter'", "1"), ", ", pct!("hit_kind = 'enemy' AND power_up = 'splitter'", "power_up = 'splitter'"), " FROM stat_shots")),
    ("lowPower", 20, concat!("SELECT SUM(power < 20), ", pct!("power < 20", "1"), ", ", pct!("hit_kind = 'enemy' AND power < 20", "power < 20"), " FROM stat_shots")),
    ("avgKillTurn", 20, "SELECT COUNT(*), AVG(turn) FROM stat_shots WHERE hit_kind = 'enemy'"),
    ("longestShot", 25, "SELECT COUNT(*), MAX(longest_shot) FROM stat_rounds WHERE longest_shot IS NOT NULL"),
    ("sniper", 25, "SELECT COUNT(*), MAX(sniper) FROM stat_rounds WHERE sniper IS NOT NULL"),
    // A kill is an enemy ship: the chain counts a ship's kills in a round (2 a double kill, 3 a multi kill, 4 a mega kill, 5 a monster kill).
    (
        "multiKill",
        10,
        "SELECT COUNT(DISTINCT match_id || ':' || round), 100.0 * COUNT(DISTINCT CASE WHEN kills >= 2 THEN match_id || ':' || round END) / COUNT(DISTINCT match_id || ':' || round) FROM stat_seats",
    ),
    ("bigKills", 1, "SELECT SUM(kills >= 4), SUM(kills >= 4), SUM(kills >= 5) FROM stat_seats"),
    ("monsterKill", 25, "SELECT COUNT(*), MAX(kills) FROM stat_seats"),
    (
        "volleyKill",
        10,
        concat!("SELECT COUNT(*), ", pct!("h > 1", "1"), " FROM (SELECT SUM(hits) AS h FROM stat_shots GROUP BY match_id, round, turn HAVING SUM(hits) > 0)"),
    ),
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
    // — Power-ups laid on the field —
    ("placedBlackhole", 1, "SELECT COUNT(*), COUNT(*) FROM stat_placements WHERE kind = 'blackhole'"),
    ("placedWormhole", 1, "SELECT COUNT(*), COUNT(*) FROM stat_placements WHERE kind = 'wormhole'"),
    ("placedNebula", 1, "SELECT COUNT(*), COUNT(*) FROM stat_placements WHERE kind = 'nebula'"),
    // A planet of -1 is a planet killer that found its planet already gone.
    ("planetsDestroyed", 1, "SELECT COUNT(*), COUNT(*) FROM stat_placements WHERE kind = 'planetkiller' AND planet >= 0"),
    // — Rounds and games —
    ("rounds", 5, "SELECT COUNT(*), AVG(seconds), MAX(seconds) FROM stat_rounds WHERE seconds > 0"),
    ("longestRound", 25, "SELECT COUNT(*), MAX(turns) FROM stat_rounds WHERE turns IS NOT NULL"),
    ("selfHitRounds", 10, concat!("SELECT COUNT(*), ", pct!("title = 'selfHit'", "1"), " FROM stat_rounds")),
    ("noWinner", 10, concat!("SELECT COUNT(*), ", pct!("survivor IS NULL AND team IS NULL", "1"), " FROM stat_rounds")),
    ("horizonShare", 10, concat!("SELECT COUNT(*), ", pct!("game_mode = 'horizon'", "1"), " FROM stat_rounds")),
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
    ("saves", 1, "SELECT SUM(saves), SUM(saves) FROM stat_seats"),
    (
        "ownGoals",
        10,
        concat!("SELECT COUNT(*), ", pct!("o > 0", "1"), " FROM (SELECT SUM(own_goals) AS o FROM stat_seats WHERE player IS NOT NULL GROUP BY match_id, player)"),
    ),
    ("swingbys", 10, "SELECT COUNT(*), 1.0 * SUM(swingbys) / COUNT(DISTINCT match_id || ':' || round) FROM stat_seats"),
    ("bestHit", 25, "SELECT COUNT(*), MAX(best_hit) FROM stat_rounds WHERE best_hit IS NOT NULL"),
    ("fastestKill", 25, "SELECT COUNT(*), MIN(fastest_kill) FROM stat_rounds WHERE fastest_kill IS NOT NULL"),
    ("closeCall", 25, "SELECT COUNT(*), MIN(close_call) FROM stat_rounds WHERE close_call > 0"),
    ("today", 1, "SELECT rounds, rounds, points FROM stat_days WHERE day = date('now')"),
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
    /// The facts, always from the cache once there is one: a request never waits for the queries. Facts older than `FRESH` are
    /// still handed out while one task in the background makes them anew, so the menus of any number of visitors cost one set of
    /// queries per `FRESH`, and only the very first request after a start waits for them.
    pub async fn facts_shared(&self) -> Arc<Vec<Fact>> {
        let mut held = self.facts.lock().await;
        if let Some((made, facts)) = held.as_ref() {
            if made.elapsed() >= FRESH && !self.refreshing_facts.swap(true, Ordering::AcqRel) {
                let store = self.store.clone();
                tokio::spawn(async move {
                    let facts = Arc::new(store.facts().await);
                    *store.facts.lock().await = Some((Instant::now(), facts));
                    store.refreshing_facts.store(false, Ordering::Release);
                });
            }
            return facts.clone();
        }
        let facts = Arc::new(self.facts().await);
        *held = Some((Instant::now(), facts.clone()));
        facts
    }
}

impl Store {
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

    #[tokio::test]
    async fn facts_are_made_once_and_handed_out_from_the_cache() {
        let stats = Stats::in_memory().await;
        let first = stats.facts_shared().await;
        assert!(Arc::ptr_eq(&first, &stats.facts_shared().await));
    }
}
