//! Facts for the menu: one-line findings the statistics make, each from a query of its own. A fact is an id and a few numbers;
//! the client words it in the player's language. A query answers one row whose first column is how many things it looked at: a fact
//! with too few of them is left out, so the menu never boasts of three shots.

use std::sync::Arc;
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tracing::warn;

use super::Store;

/// How long a set of facts is handed out again before the queries are asked anew.
const FRESH: Duration = Duration::from_secs(60);

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
    ("swingbys", 10, "SELECT COUNT(*), 1.0 * SUM(swingbys) / COUNT(DISTINCT match_id || ':' || round) FROM stat_seats"),
    ("bestHit", 25, "SELECT COUNT(*), MAX(best_hit) FROM stat_rounds WHERE best_hit IS NOT NULL"),
    ("fastestKill", 25, "SELECT COUNT(*), MIN(fastest_kill) FROM stat_rounds WHERE fastest_kill IS NOT NULL"),
    ("closeCall", 25, "SELECT COUNT(*), MIN(close_call) FROM stat_rounds WHERE close_call > 0"),
    ("today", 1, "SELECT rounds, rounds, points FROM stat_days WHERE day = date('now')"),
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

impl Store {
    /// The facts, made at most once in `FRESH` and shared by whoever asks in between.
    pub async fn facts_shared(&self) -> Arc<Vec<Fact>> {
        let mut held = self.facts.lock().await;
        if let Some((made, facts)) = held.as_ref() {
            if made.elapsed() < FRESH {
                return facts.clone();
            }
        }
        let facts = Arc::new(self.facts().await);
        *held = Some((Instant::now(), facts.clone()));
        facts
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
}
