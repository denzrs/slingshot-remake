//! The daily-challenge leaderboard: the best run each player reported for a day, in one SQLite-
//! compatible file beside the relay. One row per player and day; the sweeper drops the days that
//! have rolled past.
//!
//! Storage is `turso`, the Rust engine, so the build needs no C for it — the TLS stack is the only
//! part that does. Its API is async, so every call here is: the relay's daily messages are served
//! from the connection task, which can await, rather than from the synchronous room dispatch.
//!
//! A run is reported by the player's own browser, and the relay has no way to fly it again — the
//! score is taken at face value. What the board does hold to is one row per player and day (a later
//! run only overwrites a worse one), the score range the client also enforces, and the name cleanup
//! in `protocol`; a day's board is then a plain sorted read.

use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use tracing::{info, warn};
use turso::{Connection, Database};

use crate::pseudonym::Pseudonyms;

/// How many runs a day's board hands back.
pub const BOARD_SIZE: usize = 50;
/// Days a run is kept before the sweeper drops it.
pub const DEFAULT_KEEP_DAYS: i64 = 7;
/// The sweeper runs at most this often, however busy the relay is.
const PRUNE_INTERVAL_SECS: i64 = 6 * 60 * 60;

const SCHEMA: &str = "CREATE TABLE IF NOT EXISTS daily_scores (
     day    TEXT    NOT NULL,
     player TEXT    NOT NULL,
     name   TEXT    NOT NULL,
     score  INTEGER NOT NULL,
     at     INTEGER NOT NULL,
     PRIMARY KEY (day, player)
 )";

/// A worse run than the one already posted for that day stays out; a better one takes the name and
/// score with it.
const UPSERT: &str =
    "INSERT INTO daily_scores (day, player, name, score, at) VALUES (?1, ?2, ?3, ?4, ?5)
 ON CONFLICT(day, player) DO UPDATE
     SET name = excluded.name, score = excluded.score, at = excluded.at
     WHERE excluded.score > daily_scores.score";

/// The same total order the caller's own rank is counted with, so the two can never disagree.
const TOP_LIST: &str = "SELECT name, score FROM daily_scores WHERE day = ?1
 ORDER BY score DESC, at ASC, player ASC LIMIT ?2";

const OWN_ENTRY: &str = "SELECT name, score, at FROM daily_scores WHERE day = ?1 AND player = ?2";

const AHEAD: &str = "SELECT COUNT(*) FROM daily_scores WHERE day = ?1 AND (
     score > ?2 OR (score = ?2 AND (at < ?3 OR (at = ?3 AND player < ?4))))";

/// The cutoff is a calendar day, so a board from an earlier day goes whether it saw traffic or not.
const PRUNE: &str = "DELETE FROM daily_scores WHERE day < date('now', ?1)";

/// One run on a day's board.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Entry {
    /// Place on the board, 1 = best.
    pub rank: usize,
    pub name: String,
    pub score: i64,
}

/// A day's board as one client sees it: the best runs, and the caller's own run if it has one.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Board {
    pub entries: Vec<Entry>,
    pub you: Option<Entry>,
}

pub struct Leaderboard {
    /// Held with the connection: the database owns the pager behind it.
    _database: Database,
    conn: Connection,
    /// The per-process hashing key: a player is the hash of their address and the day, so no
    /// address is ever written down. A restart (a deploy) forgets the key, and with it who posted
    /// what — at worst someone posts a second run for the same day.
    players: Pseudonyms,
    /// How many days a board is kept.
    keep_days: i64,
    last_prune: AtomicI64,
    /// Each day's top list as last read, handed out for `TOP_FRESH`; a run posted to a day drops it.
    tops: parking_lot::Mutex<HashMap<String, TopList>>,
}

/// A day's top list, and when it was read.
type TopList = (Instant, Arc<Vec<Entry>>);

/// How long a day's top list is handed out again before it is read anew.
const TOP_FRESH: Duration = Duration::from_secs(1);

impl Leaderboard {
    /// Open the board in the relay's database, creating its table. A board that cannot be opened is
    /// a deployment error, not something to run without.
    pub async fn open(database: &Database, keep_days: i64) -> turso::Result<Self> {
        let database = database.clone();
        let conn = database.connect()?;
        conn.execute("PRAGMA synchronous = NORMAL", ()).await?;
        conn.busy_timeout(Duration::from_secs(2))?;
        conn.execute(SCHEMA, ()).await?;
        Ok(Self {
            _database: database,
            conn,
            players: Pseudonyms::new(),
            keep_days: keep_days.max(1),
            last_prune: AtomicI64::new(0),
            tops: parking_lot::Mutex::new(HashMap::new()),
        })
    }

    /// Whether `day` has a board here, seen from `today` (both as days since 1970): one of the days
    /// that are kept, or tomorrow, which is already today for a player east of UTC. A run for any
    /// other day would only be a row the sweeper takes years to reach.
    pub fn keeps(&self, day: &str, today: i64) -> bool {
        day_number(day).is_some_and(|day| (today - self.keep_days..=today + 1).contains(&day))
    }

    /// A board in memory, for the relay's own tests: they have no business writing files.
    #[cfg(test)]
    pub async fn in_memory() -> Self {
        let database = crate::db::open(":memory:")
            .await
            .expect("an in-memory database opens");
        Self::open(&database, DEFAULT_KEEP_DAYS)
            .await
            .expect("an in-memory board opens")
    }

    /// Post a run and hand back the board it landed on.
    pub async fn submit(
        &self,
        day: &str,
        name: &str,
        score: i64,
        ip: IpAddr,
    ) -> turso::Result<Board> {
        let player = self.player(day, ip);
        self.conn
            .execute(UPSERT, (day, player.as_str(), name, score, now_unix()))
            .await?;
        // The poster sees their own run on the list.
        self.tops.lock().remove(day);
        self.board(day, ip).await
    }

    /// A day's board: the best runs, and where the caller's own run sits.
    pub async fn board(&self, day: &str, ip: IpAddr) -> turso::Result<Board> {
        let entries = self.top(day).await?;
        let you = self.own_entry(day, &self.player(day, ip)).await?;
        Ok(Board {
            entries: entries.as_ref().clone(),
            you,
        })
    }

    /// A day's best runs, read at most once per `TOP_FRESH` however many look.
    async fn top(&self, day: &str) -> turso::Result<Arc<Vec<Entry>>> {
        let now = Instant::now();
        if let Some((read, entries)) = self.tops.lock().get(day) {
            if now.duration_since(*read) < TOP_FRESH {
                return Ok(entries.clone());
            }
        }
        let mut rows = self.conn.query(TOP_LIST, (day, BOARD_SIZE as i64)).await?;
        let mut entries = Vec::new();
        while let Some(row) = rows.next().await? {
            entries.push(Entry {
                rank: entries.len() + 1,
                name: row.get::<String>(0)?,
                score: row.get::<i64>(1)?,
            });
        }
        let entries = Arc::new(entries);
        let mut tops = self.tops.lock();
        tops.retain(|_, (read, _)| now.duration_since(*read) < TOP_FRESH);
        tops.insert(day.to_owned(), (now, entries.clone()));
        Ok(entries)
    }

    /// The caller's own run, wherever it sits on the board — the top list stops at `BOARD_SIZE`.
    async fn own_entry(&self, day: &str, player: &str) -> turso::Result<Option<Entry>> {
        let mut rows = self.conn.query(OWN_ENTRY, (day, player)).await?;
        let Some(row) = rows.next().await? else {
            return Ok(None);
        };
        let (name, score, at) = (
            row.get::<String>(0)?,
            row.get::<i64>(1)?,
            row.get::<i64>(2)?,
        );
        let rank = self.rank_of(day, player, score, at).await?;
        Ok(Some(Entry { rank, name, score }))
    }

    /// How many runs sort ahead of this one, by the board's own ordering.
    async fn rank_of(&self, day: &str, player: &str, score: i64, at: i64) -> turso::Result<usize> {
        let mut rows = self.conn.query(AHEAD, (day, score, at, player)).await?;
        let ahead = match rows.next().await? {
            Some(row) => row.get::<i64>(0)?,
            None => 0,
        };
        Ok(ahead as usize + 1)
    }

    /// Drop the boards of the days older than `keep_days`; returns how many runs went.
    pub async fn prune(&self, keep_days: i64) -> turso::Result<u64> {
        let cutoff = format!("-{} days", keep_days.max(1));
        let removed = self.conn.execute(PRUNE, (cutoff,)).await;
        // A list read before the sweep would show runs that are gone.
        self.tops.lock().clear();
        removed
    }

    /// Called from the relay's sweep: prune once in a while, and never let a failure stop the relay.
    pub async fn prune_if_due(&self) {
        let now = now_unix();
        if now - self.last_prune.load(Ordering::Relaxed) < PRUNE_INTERVAL_SECS {
            return;
        }
        self.last_prune.store(now, Ordering::Relaxed);
        match self.prune(self.keep_days).await {
            Ok(0) => {}
            Ok(removed) => info!(removed, "leaderboard pruned"),
            Err(err) => warn!(%err, "leaderboard prune failed"),
        }
    }

    /// Who posted this run: the address and the day, hashed so the address is not kept.
    fn player(&self, day: &str, ip: IpAddr) -> String {
        self.players.player(day, ip)
    }
}

fn now_unix() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|since| since.as_secs() as i64)
        .unwrap_or(0)
}

/// Today in UTC, as days since 1970-01-01.
pub fn today() -> i64 {
    now_unix().div_euclid(24 * 60 * 60)
}

/// A `YYYY-MM-DD` day as days since 1970-01-01 (the proleptic Gregorian calendar), or None when it
/// is not one.
pub fn day_number(day: &str) -> Option<i64> {
    let bytes = day.as_bytes();
    if bytes.len() != 10 || bytes[4] != b'-' || bytes[7] != b'-' {
        return None;
    }
    let year: i64 = day[0..4].parse().ok()?;
    let month: i64 = day[5..7].parse().ok()?;
    let date: i64 = day[8..10].parse().ok()?;
    if !(1..=12).contains(&month) || !(1..=31).contains(&date) {
        return None;
    }
    // Howard Hinnant's days_from_civil.
    let year = if month <= 2 { year - 1 } else { year };
    let era = year.div_euclid(400);
    let year_of_era = year - era * 400;
    let day_of_year = (153 * ((month + 9) % 12) + 2) / 5 + date - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    Some(era * 146_097 + day_of_era - 719_468)
}

/// The `YYYY-MM-DD` of a day since 1970-01-01: `day_number` the other way round.
#[cfg(test)]
pub fn day_key(days: i64) -> String {
    // Howard Hinnant's civil_from_days.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let day_of_era = z - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let mp = (5 * day_of_year + 2) / 153;
    let date = day_of_year - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    format!("{year:04}-{month:02}-{date:02}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ip(last: u8) -> IpAddr {
        IpAddr::from([10, 0, 0, last])
    }

    const DAY: &str = "2026-10-19";

    #[test]
    fn days_count_from_1970_and_back() {
        assert_eq!(day_number("1970-01-01"), Some(0));
        assert_eq!(day_number("2000-03-01"), Some(11_017));
        assert_eq!(day_number("2026-10-19"), Some(20_745));
        assert_eq!(day_number("2026-13-01"), None);
        assert_eq!(day_number("today"), None);
        for days in [0, 11_016, 11_017, 20_745, 59, 60, 425] {
            assert_eq!(day_number(&day_key(days)), Some(days));
        }
        assert_eq!(day_key(20_745), "2026-10-19");
    }

    #[tokio::test]
    async fn a_board_is_open_for_the_days_it_keeps_and_tomorrow() {
        let board = Leaderboard::in_memory().await;
        let today = day_number(DAY).unwrap();
        assert!(board.keeps(DAY, today));
        assert!(board.keeps("2026-10-20", today), "tomorrow east of UTC");
        assert!(!board.keeps("2026-10-21", today));
        assert!(board.keeps("2026-10-12", today), "the oldest day kept");
        assert!(!board.keeps("2026-10-11", today));
        assert!(!board.keeps("2999-12-31", today));
    }

    #[tokio::test]
    async fn a_posted_run_is_on_the_list_at_once_though_the_list_is_kept_a_moment() {
        let board = Leaderboard::in_memory().await;
        board.submit(DAY, "Ada", 1200, ip(1)).await.unwrap();
        // Read and kept …
        assert_eq!(board.board(DAY, ip(9)).await.unwrap().entries.len(), 1);
        // … yet the next run shows up straight away.
        let posted = board.submit(DAY, "Grace", 3400, ip(2)).await.unwrap();
        assert_eq!(posted.entries[0].name, "Grace");
        assert_eq!(board.board(DAY, ip(9)).await.unwrap().entries.len(), 2);
    }

    #[tokio::test]
    async fn a_board_ranks_the_best_run_first() {
        let board = Leaderboard::in_memory().await;
        board.submit(DAY, "Ada", 1200, ip(1)).await.unwrap();
        board.submit(DAY, "Grace", 3400, ip(2)).await.unwrap();
        board.submit(DAY, "Alan", 800, ip(3)).await.unwrap();

        let seen = board.board(DAY, ip(1)).await.unwrap();
        let names: Vec<&str> = seen.entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, ["Grace", "Ada", "Alan"]);
        assert_eq!(
            seen.entries.iter().map(|e| e.rank).collect::<Vec<_>>(),
            [1, 2, 3]
        );
    }

    #[tokio::test]
    async fn the_same_player_keeps_only_their_best_run_that_day() {
        let board = Leaderboard::in_memory().await;
        board.submit(DAY, "Ada", 1200, ip(1)).await.unwrap();
        board.submit(DAY, "Ada", 900, ip(1)).await.unwrap();

        // A worse run does not overwrite the one already posted.
        let seen = board.board(DAY, ip(1)).await.unwrap();
        assert_eq!(seen.entries.len(), 1);
        assert_eq!(seen.entries[0].score, 1200);

        // A better one does, and takes the name it was posted under along with it.
        board.submit(DAY, "Ada L.", 2000, ip(1)).await.unwrap();
        let seen = board.board(DAY, ip(1)).await.unwrap();
        assert_eq!(seen.entries.len(), 1);
        assert_eq!(seen.entries[0].score, 2000);
        assert_eq!(seen.entries[0].name, "Ada L.");
    }

    #[tokio::test]
    async fn a_player_sees_their_own_rank_even_from_outside_the_top_list() {
        let board = Leaderboard::in_memory().await;
        board.submit(DAY, "Ada", 10, ip(1)).await.unwrap();
        for last in 2..=BOARD_SIZE as u8 + 2 {
            board
                .submit(DAY, &format!("p{last}"), 100 + last as i64, ip(last))
                .await
                .unwrap();
        }

        let seen = board.board(DAY, ip(1)).await.unwrap();
        assert_eq!(seen.entries.len(), BOARD_SIZE);
        assert_eq!(
            seen.you,
            Some(Entry {
                rank: BOARD_SIZE + 2,
                name: "Ada".into(),
                score: 10,
            })
        );
        // The caller's rank is the one the board would put them at.
        assert!(seen.entries.iter().all(|e| e.score > 10));
    }

    #[tokio::test]
    async fn a_day_without_runs_is_empty_and_a_visitor_has_no_rank() {
        let board = Leaderboard::in_memory().await;
        board.submit(DAY, "Ada", 1200, ip(1)).await.unwrap();
        let other_day = board.board("2026-10-18", ip(1)).await.unwrap();
        assert!(other_day.entries.is_empty());
        assert!(other_day.you.is_none());
    }

    #[tokio::test]
    async fn the_sweeper_drops_the_boards_of_past_days() {
        let board = Leaderboard::in_memory().await;
        let today: String = {
            let mut rows = board.conn.query("SELECT date('now')", ()).await.unwrap();
            rows.next()
                .await
                .unwrap()
                .unwrap()
                .get::<String>(0)
                .unwrap()
        };
        board.submit(&today, "Ada", 1200, ip(1)).await.unwrap();
        board.submit("2020-01-01", "Ada", 900, ip(1)).await.unwrap();

        // Only the board of a day older than the window goes.
        let removed = board.prune(DEFAULT_KEEP_DAYS).await.unwrap();
        assert_eq!(removed, 1);
        assert_eq!(board.board(&today, ip(1)).await.unwrap().entries.len(), 1);
        assert!(board
            .board("2020-01-01", ip(1))
            .await
            .unwrap()
            .entries
            .is_empty());
    }
}
