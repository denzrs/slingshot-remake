//! Match statistics: how each turn and round of an online game went, for a week, in one SQLite-compatible
//! file beside the relay. The host's client reports each turn when its shots have landed and each round
//! when it ends (`report`); the relay adds
//! what only it knows (the room's rules, who is a person, how many watch) and writes it down.
//!
//! No name is kept — not a player's, not a room's (a room is its random code). A person is told apart the way the daily board
//! tells them apart, by a hash of their address and the day, but with a key of its own, so a stats
//! row can never be matched to a name on the board. A CPU seat has no hash. The numbers are taken at
//! face value: they come from the host's own browser, and the relay can fly nothing again.

use std::net::IpAddr;
use std::sync::atomic::{AtomicI64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde_json::Value;
use tracing::{info, warn};
use turso::{Builder, Connection, Database, Value as Sql};

use crate::pseudonym::Pseudonyms;
use crate::report::{RoundReport, ShotRound, TurnReport, RECORD_KEYS};

/// Days a round is kept before the sweeper drops it.
pub const DEFAULT_KEEP_DAYS: i64 = 7;
/// The sweeper runs at most this often, however busy the relay is.
const PRUNE_INTERVAL_SECS: i64 = 6 * 60 * 60;
const DAY_SECS: i64 = 24 * 60 * 60;

const SCHEMA: [&str; 5] = [
    // One row per round. `match_id` is random per game and says nothing about the room.
    "CREATE TABLE IF NOT EXISTS stat_rounds (
         match_id   TEXT    NOT NULL,
         room_id    TEXT    NOT NULL,
         round      INTEGER NOT NULL,
         at         INTEGER NOT NULL,
         day        TEXT    NOT NULL,
         game_mode  TEXT    NOT NULL,
         mode       TEXT    NOT NULL,
         rules      TEXT    NOT NULL,
         humans     INTEGER NOT NULL,
         cpus       INTEGER NOT NULL,
         spectators INTEGER NOT NULL,
         title      TEXT    NOT NULL,
         survivor   INTEGER,
         team       INTEGER,
         seconds    REAL    NOT NULL,
         planets    INTEGER NOT NULL,
         longest_shot_seat INTEGER, longest_shot REAL,
         fastest_kill_seat INTEGER, fastest_kill REAL,
         best_hit_seat     INTEGER, best_hit     REAL,
         close_call_seat   INTEGER, close_call   REAL,
         sniper_seat       INTEGER, sniper       REAL,
         PRIMARY KEY (match_id, round)
     )",
    // One row per ship and round. `player` is the day's pseudonym of a person, NULL for a CPU.
    "CREATE TABLE IF NOT EXISTS stat_seats (
         match_id  TEXT    NOT NULL,
         round     INTEGER NOT NULL,
         seat      INTEGER NOT NULL,
         at        INTEGER NOT NULL,
         player    TEXT,
         cpu       TEXT,
         team      INTEGER,
         won       INTEGER NOT NULL,
         alive     INTEGER NOT NULL,
         score     INTEGER NOT NULL,
         shots     INTEGER NOT NULL,
         kills     INTEGER NOT NULL,
         swingbys  INTEGER NOT NULL,
         grazes    INTEGER NOT NULL,
         own_goals INTEGER NOT NULL,
         pickups   INTEGER NOT NULL,
         saves     INTEGER NOT NULL,
         PRIMARY KEY (match_id, round, seat)
     )",
    // One row per shot: how it was aimed, what rode with it, how it ended, what it earned.
    "CREATE TABLE IF NOT EXISTS stat_shots (
         match_id   TEXT    NOT NULL,
         round      INTEGER NOT NULL,
         turn       INTEGER NOT NULL,
         n          INTEGER NOT NULL,
         at         INTEGER NOT NULL,
         seat       INTEGER NOT NULL,
         player     TEXT,
         cpu        TEXT,
         angle      REAL    NOT NULL,
         power      REAL    NOT NULL,
         power_up   TEXT,
         fork       INTEGER NOT NULL,
         resolution TEXT,
         hits       INTEGER NOT NULL,
         hit_seat   INTEGER,
         hit_kind   TEXT,
         points     INTEGER NOT NULL,
         PRIMARY KEY (match_id, round, n)
     )",
    // One row per ship and turn: where the scores stand after it.
    "CREATE TABLE IF NOT EXISTS stat_turns (
         match_id TEXT    NOT NULL,
         round    INTEGER NOT NULL,
         turn     INTEGER NOT NULL,
         seat     INTEGER NOT NULL,
         at       INTEGER NOT NULL,
         player   TEXT,
         cpu      TEXT,
         alive    INTEGER NOT NULL,
         score    INTEGER NOT NULL,
         PRIMARY KEY (match_id, round, turn, seat)
     )",
    "CREATE INDEX IF NOT EXISTS stat_rounds_at ON stat_rounds (at)",
];

const INSERT_ROUND: &str = "INSERT INTO stat_rounds (
         match_id, round, at, day, game_mode, mode, rules, humans, cpus, spectators,
         title, survivor, team, seconds, planets,
         longest_shot_seat, longest_shot, fastest_kill_seat, fastest_kill,
         best_hit_seat, best_hit, close_call_seat, close_call, sniper_seat, sniper, room_id)
     VALUES (?1, ?2, ?3, date(?3, 'unixepoch'), ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14,
             ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25)";

const INSERT_SEAT: &str = "INSERT INTO stat_seats (
         match_id, round, seat, at, player, cpu, team, won, alive,
         score, shots, kills, swingbys, grazes, own_goals, pickups, saves)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)";

const INSERT_SHOT: &str = "INSERT INTO stat_shots (
         match_id, round, turn, n, at, seat, player, cpu, angle, power, power_up, fork,
         resolution, hits, hit_seat, hit_kind, points)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)";

const INSERT_TURN: &str = "INSERT INTO stat_turns (
         match_id, round, turn, seat, at, player, cpu, alive, score)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)";

const PRUNE_TURNS: &str = "DELETE FROM stat_turns WHERE at < ?1";
const PRUNE_SHOTS: &str = "DELETE FROM stat_shots WHERE at < ?1";
const PRUNE_ROUNDS: &str = "DELETE FROM stat_rounds WHERE at < ?1";
const PRUNE_SEATS: &str = "DELETE FROM stat_seats WHERE at < ?1";

/// Who sat in a ship: a person at an address, or a CPU of some level.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Occupant {
    Person(IpAddr),
    Cpu(&'static str),
}

/// What the relay knows about the seat; the report holds the rest.
#[derive(Clone, Debug)]
pub struct SeatFacts {
    pub occupant: Occupant,
    /// 0 or 1 in a team game.
    pub team: Option<u8>,
}

/// What the relay knows about the room a round was played in.
#[derive(Clone, Debug)]
pub struct RoundFacts {
    /// The room's code. Random, and gone with the room, so it names a room and nobody in it.
    pub room_id: String,
    pub match_id: String,
    pub game_mode: &'static str,
    pub mode: &'static str,
    /// The room's rules as the lobby sends them.
    pub rules: Value,
    pub spectators: usize,
    pub seats: Vec<SeatFacts>,
}

/// The database half: what a writer task needs, and what the tests read back.
pub struct Store {
    _database: Database,
    conn: Connection,
    /// Its own key: see `pseudonym`.
    players: Pseudonyms,
    keep_days: i64,
    last_prune: AtomicI64,
}

impl Store {
    /// Open (or create) the statistics file. Like the leaderboard's, a file that cannot be opened is
    /// a deployment error, not something to run without.
    async fn open(path: &str, keep_days: i64) -> turso::Result<Self> {
        let database = Builder::new_local(path).build().await?;
        let conn = database.connect()?;
        let _ = conn.pragma_update("journal_mode", "WAL").await?;
        conn.execute("PRAGMA synchronous = NORMAL", ()).await?;
        conn.busy_timeout(Duration::from_secs(2))?;
        for statement in SCHEMA {
            conn.execute(statement, ()).await?;
        }
        Ok(Self {
            _database: database,
            conn,
            players: Pseudonyms::new(),
            keep_days: keep_days.max(1),
            last_prune: AtomicI64::new(0),
        })
    }

    /// Write what a report says down, as one transaction.
    pub async fn record(&self, job: &Job) -> turso::Result<()> {
        self.record_at(job, now_unix()).await
    }

    async fn record_at(&self, job: &Job, at: i64) -> turso::Result<()> {
        self.conn.execute("BEGIN", ()).await?;
        let written = match job {
            Job::Round(facts, report) => self.write_round(facts, report, at).await,
            Job::Turn(facts, report) => self.write_turn(facts, report, at).await,
        };
        match written {
            Ok(()) => self.conn.execute("COMMIT", ()).await.map(|_| ()),
            Err(err) => {
                let _ = self.conn.execute("ROLLBACK", ()).await;
                Err(err)
            }
        }
    }

    /// Who sat where: a person's pseudonym or a CPU's level, the same for the seat's every row.
    fn who(&self, facts: &RoundFacts, at: i64) -> Vec<(Sql, Sql)> {
        let day_number = at.div_euclid(DAY_SECS);
        facts
            .seats
            .iter()
            .map(|sitter| match &sitter.occupant {
                Occupant::Person(ip) => {
                    (Sql::Text(self.players.player(day_number, *ip)), Sql::Null)
                }
                Occupant::Cpu(level) => (Sql::Null, Sql::Text((*level).into())),
            })
            .collect()
    }

    async fn write_turn(
        &self,
        facts: &RoundFacts,
        report: &TurnReport,
        at: i64,
    ) -> turso::Result<()> {
        let who = self.who(facts, at);
        for (seat, ship) in report.seats.iter().enumerate() {
            let (player, cpu) = who[seat].clone();
            let row = vec![
                Sql::Text(facts.match_id.clone()),
                Sql::Integer(report.round),
                Sql::Integer(report.turn),
                Sql::Integer(seat as i64),
                Sql::Integer(at),
                player,
                cpu,
                Sql::Integer(ship.alive.into()),
                Sql::Integer(ship.score),
            ];
            self.conn.execute(INSERT_TURN, row).await?;
        }
        for shot in &report.shots {
            self.write_shot(facts, report.round, shot, &who, at).await?;
        }
        Ok(())
    }

    async fn write_shot(
        &self,
        facts: &RoundFacts,
        round: i64,
        shot: &ShotRound,
        who: &[(Sql, Sql)],
        at: i64,
    ) -> turso::Result<()> {
        let (player, cpu) = who[shot.seat].clone();
        let text = |value: Option<&str>| value.map_or(Sql::Null, |v| Sql::Text(v.into()));
        let row = vec![
            Sql::Text(facts.match_id.clone()),
            Sql::Integer(round),
            Sql::Integer(shot.turn),
            Sql::Integer(shot.n),
            Sql::Integer(at),
            Sql::Integer(shot.seat as i64),
            player,
            cpu,
            Sql::Real(shot.angle),
            Sql::Real(shot.power),
            text(shot.power_up),
            Sql::Integer(shot.fork.into()),
            text(shot.resolution),
            Sql::Integer(shot.hits),
            optional(shot.hit_seat.map(|s| s as i64)),
            text(shot.hit_kind),
            Sql::Integer(shot.points),
        ];
        self.conn.execute(INSERT_SHOT, row).await?;
        Ok(())
    }

    async fn write_round(
        &self,
        facts: &RoundFacts,
        report: &RoundReport,
        at: i64,
    ) -> turso::Result<()> {
        let humans = facts
            .seats
            .iter()
            .filter(|s| matches!(s.occupant, Occupant::Person(_)))
            .count();
        let mut round = vec![
            Sql::Text(facts.match_id.clone()),
            Sql::Integer(report.round),
            Sql::Integer(at),
            Sql::Text(facts.game_mode.into()),
            Sql::Text(facts.mode.into()),
            Sql::Text(facts.rules.to_string()),
            Sql::Integer(humans as i64),
            Sql::Integer((facts.seats.len() - humans) as i64),
            Sql::Integer(facts.spectators as i64),
            Sql::Text(report.title.into()),
            optional(report.survivor.map(|s| s as i64)),
            optional(report.team.map(i64::from)),
            Sql::Real(report.seconds),
            Sql::Integer(report.planets),
        ];
        for record in report.records {
            round.push(optional(record.map(|r| r.seat as i64)));
            round.push(record.map_or(Sql::Null, |r| Sql::Real(r.value)));
        }
        round.push(Sql::Text(facts.room_id.clone()));
        debug_assert_eq!(report.records.len(), RECORD_KEYS.len());
        self.conn.execute(INSERT_ROUND, round).await?;

        let who = self.who(facts, at);
        for (seat, (sitter, ship)) in facts.seats.iter().zip(&report.seats).enumerate() {
            let (player, cpu) = who[seat].clone();
            let won = report.survivor == Some(seat)
                || (report.team.is_some() && report.team == sitter.team);
            let row = vec![
                Sql::Text(facts.match_id.clone()),
                Sql::Integer(report.round),
                Sql::Integer(seat as i64),
                Sql::Integer(at),
                player,
                cpu,
                optional(sitter.team.map(i64::from)),
                Sql::Integer(won.into()),
                Sql::Integer(ship.alive.into()),
                Sql::Integer(ship.score),
                Sql::Integer(ship.shots),
                Sql::Integer(ship.kills),
                Sql::Integer(ship.swingbys),
                Sql::Integer(ship.grazes),
                Sql::Integer(ship.own_goals),
                Sql::Integer(ship.pickups),
                Sql::Integer(ship.saves),
            ];
            self.conn.execute(INSERT_SEAT, row).await?;
        }
        Ok(())
    }

    /// Drop what is older than `keep_days`; returns how many rounds went.
    pub async fn prune(&self, keep_days: i64) -> turso::Result<u64> {
        self.prune_before(now_unix() - keep_days.max(1) * DAY_SECS)
            .await
    }

    async fn prune_before(&self, cutoff: i64) -> turso::Result<u64> {
        self.conn.execute(PRUNE_SEATS, (cutoff,)).await?;
        self.conn.execute(PRUNE_SHOTS, (cutoff,)).await?;
        self.conn.execute(PRUNE_TURNS, (cutoff,)).await?;
        self.conn.execute(PRUNE_ROUNDS, (cutoff,)).await
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
            Ok(removed) => info!(removed, "stats pruned"),
            Err(err) => warn!(%err, "stats prune failed"),
        }
    }

    #[cfg(test)]
    pub(crate) async fn count(&self, table: &str) -> i64 {
        let mut rows = self
            .conn
            .query(format!("SELECT COUNT(*) FROM {table}"), ())
            .await
            .unwrap();
        rows.next().await.unwrap().unwrap().get::<i64>(0).unwrap()
    }
}

/// Rounds waiting for the writer. A relay that is hosting more than this at once is better off
/// dropping a few rounds of statistics than growing without bound.
const QUEUE: usize = 1024;

/// A report on its way to the writer, with what the relay knows about its room.
pub enum Job {
    Round(RoundFacts, RoundReport),
    Turn(RoundFacts, TurnReport),
}

/// The statistics as the room logic sees them: a queue in front of one writer task, so a report is
/// handed over without waiting, written in order, and never written by two tasks at once.
pub struct Stats {
    store: std::sync::Arc<Store>,
    queue: tokio::sync::mpsc::Sender<Job>,
}

impl std::ops::Deref for Stats {
    type Target = Store;

    fn deref(&self) -> &Store {
        &self.store
    }
}

impl Stats {
    /// Open (or create) the statistics file and start the writer. Like the leaderboard's, a file that
    /// cannot be opened is a deployment error, not something to run without.
    pub async fn open(path: &str, keep_days: i64) -> turso::Result<Self> {
        let store = std::sync::Arc::new(Store::open(path, keep_days).await?);
        let (queue, mut waiting) = tokio::sync::mpsc::channel::<Job>(QUEUE);
        let writer = store.clone();
        tokio::spawn(async move {
            while let Some(job) = waiting.recv().await {
                if let Err(err) = writer.record(&job).await {
                    warn!(%err, "stats write failed");
                }
            }
        });
        Ok(Self { store, queue })
    }

    #[cfg(test)]
    pub async fn in_memory() -> Self {
        Self::open(":memory:", DEFAULT_KEEP_DAYS)
            .await
            .expect("an in-memory store opens")
    }

    /// Hand a round to the writer. Never waits: a full queue drops the round and says so.
    pub fn submit(&self, job: Job) {
        if self.queue.try_send(job).is_err() {
            warn!("stats queue full or closed; a report was dropped");
        }
    }
}

fn optional(value: Option<i64>) -> Sql {
    value.map_or(Sql::Null, Sql::Integer)
}

fn now_unix() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|since| since.as_secs() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::report::{parse_round_report, parse_turn_report};
    use serde_json::json;

    fn round(round: i64) -> RoundReport {
        parse_round_report(&json!({
            "round": round, "title": "hit", "survivor": 1, "team": null,
            "seconds": 30.5, "planets": 3,
            "players": [
                {"score": 0, "shots": 2, "kills": 0, "swingbys": 0, "grazes": 1, "ownGoals": 0, "pickups": 0, "saves": 0, "alive": false},
                {"score": 500, "shots": 1, "kills": 1, "swingbys": 2, "grazes": 0, "ownGoals": 0, "pickups": 0, "saves": 0, "alive": true},
            ],
            "records": {"bestHit": {"player": 1, "value": 250.5}},
        }))
        .unwrap()
    }

    fn turn(round: i64, turn: i64) -> TurnReport {
        parse_turn_report(&json!({
            "round": round, "turn": turn,
            "players": [{"score": 0, "alive": false}, {"score": 500, "alive": true}],
            "shots": [
                {"n": turn * 10 + 1, "turn": turn, "player": 0, "angle": 33.3, "power": 61.3, "powerUp": null, "fork": false, "resolution": "planet", "hits": 0, "hitSeat": null, "hitKind": null, "points": 0},
                {"n": turn * 10 + 2, "turn": turn, "player": 1, "angle": 140.0, "power": 80.0, "powerUp": "plasma", "fork": false, "resolution": "ship", "hits": 1, "hitSeat": 0, "hitKind": "enemy", "points": 250},
            ],
        }))
        .unwrap()
    }

    fn facts(ip: [u8; 4]) -> RoundFacts {
        RoundFacts {
            room_id: "abc123".into(),
            match_id: "m1".into(),
            game_mode: "classic",
            mode: "ffa",
            rules: json!({"rounds": 5}),
            spectators: 1,
            seats: vec![
                SeatFacts {
                    occupant: Occupant::Person(IpAddr::from(ip)),
                    team: None,
                },
                SeatFacts {
                    occupant: Occupant::Cpu("hard"),
                    team: None,
                },
            ],
        }
    }

    fn round_job(ip: [u8; 4], n: i64) -> Job {
        Job::Round(facts(ip), round(n))
    }

    fn turn_job(ip: [u8; 4], n: i64, t: i64) -> Job {
        Job::Turn(facts(ip), turn(n, t))
    }

    async fn text(stats: &Stats, sql: &str) -> Vec<Option<String>> {
        let mut rows = stats.conn.query(sql, ()).await.unwrap();
        let mut out = Vec::new();
        while let Some(row) = rows.next().await.unwrap() {
            out.push(row.get::<String>(0).ok());
        }
        out
    }

    #[tokio::test]
    async fn a_round_lands_as_one_round_row_and_a_row_per_ship() {
        let stats = Stats::in_memory().await;
        stats.record(&round_job([10, 0, 0, 1], 1)).await.unwrap();
        assert_eq!(stats.count("stat_rounds").await, 1);
        assert_eq!(stats.count("stat_seats").await, 2);

        // The CPU has a level and no pseudonym, the person the other way round, and the winner won.
        assert_eq!(
            text(&stats, "SELECT cpu FROM stat_seats ORDER BY seat").await,
            [None, Some("hard".into())]
        );
        let players = text(&stats, "SELECT player FROM stat_seats ORDER BY seat").await;
        assert_eq!(players[0].as_deref().map(str::len), Some(16));
        assert_eq!(players[1], None);
        assert_eq!(
            text(
                &stats,
                "SELECT CAST(won AS TEXT) FROM stat_seats ORDER BY seat"
            )
            .await,
            [Some("0".into()), Some("1".into())]
        );
        assert_eq!(
            text(&stats, "SELECT room_id FROM stat_rounds").await,
            [Some("abc123".into())]
        );
        assert_eq!(
            text(&stats, "SELECT CAST(best_hit AS TEXT) FROM stat_rounds").await,
            [Some("250.5".into())]
        );
    }

    #[tokio::test]
    async fn a_turn_lands_as_the_scores_after_it_and_a_row_per_shot() {
        let stats = Stats::in_memory().await;
        stats.record(&turn_job([10, 0, 0, 1], 2, 3)).await.unwrap();
        assert_eq!(stats.count("stat_turns").await, 2);
        assert_eq!(stats.count("stat_shots").await, 2);
        assert_eq!(
            text(
                &stats,
                "SELECT CAST(score AS TEXT) || ':' || CAST(alive AS TEXT) FROM stat_turns ORDER BY seat"
            )
            .await,
            [Some("0:0".into()), Some("500:1".into())]
        );
        assert_eq!(
            text(
                &stats,
                "SELECT resolution || ':' || COALESCE(power_up, '-') || ':' || CAST(turn AS TEXT) FROM stat_shots ORDER BY n"
            )
            .await,
            [Some("planet:-:3".into()), Some("ship:plasma:3".into())]
        );
        // A shot carries its seat's pseudonym, or the CPU's level.
        assert_eq!(
            text(
                &stats,
                "SELECT COALESCE(cpu, 'person') FROM stat_shots ORDER BY n"
            )
            .await,
            [Some("person".into()), Some("hard".into())]
        );
    }

    #[tokio::test]
    async fn nothing_that_names_anybody_is_stored() {
        let stats = Stats::in_memory().await;
        stats.record(&round_job([10, 0, 0, 1], 1)).await.unwrap();
        let mut rows = stats
            .conn
            .query("SELECT name FROM pragma_table_info('stat_seats') UNION SELECT name FROM pragma_table_info('stat_shots') UNION SELECT name FROM pragma_table_info('stat_turns') UNION SELECT name FROM pragma_table_info('stat_rounds')", ())
            .await
            .unwrap();
        while let Some(row) = rows.next().await.unwrap() {
            let column = row.get::<String>(0).unwrap();
            let forbidden = ["name", "ip", "addr", "address", "room"];
            assert!(!forbidden.contains(&column.as_str()), "column {column}");
        }
    }

    #[tokio::test]
    async fn a_person_is_the_same_all_day_and_somebody_else_the_next() {
        let stats = Stats::in_memory().await;
        let day = 1_760_000_000;
        let ip = [10, 0, 0, 1];
        stats.record_at(&turn_job(ip, 1, 1), day).await.unwrap();
        stats
            .record_at(&turn_job(ip, 1, 2), day + 60)
            .await
            .unwrap();
        stats
            .record_at(&turn_job(ip, 1, 3), day + DAY_SECS)
            .await
            .unwrap();
        stats
            .record_at(&turn_job([10, 0, 0, 2], 1, 4), day)
            .await
            .unwrap();
        let players = text(
            &stats,
            "SELECT player FROM stat_turns WHERE seat = 0 ORDER BY turn",
        )
        .await;
        assert_eq!(players[0], players[1]);
        assert_ne!(players[0], players[2]);
        assert_ne!(players[0], players[3]);
    }

    #[tokio::test]
    async fn the_sweeper_drops_what_is_older_than_the_window() {
        let stats = Stats::in_memory().await;
        let ip = [10, 0, 0, 1];
        stats.record_at(&round_job(ip, 1), 1_000_000).await.unwrap();
        stats
            .record_at(&turn_job(ip, 1, 1), 1_000_000)
            .await
            .unwrap();
        stats.record(&round_job(ip, 2)).await.unwrap();
        stats.record(&turn_job(ip, 2, 1)).await.unwrap();
        assert_eq!(stats.prune(DEFAULT_KEEP_DAYS).await.unwrap(), 1);
        assert_eq!(stats.count("stat_rounds").await, 1);
        assert_eq!(stats.count("stat_seats").await, 2);
        assert_eq!(stats.count("stat_turns").await, 2);
        assert_eq!(stats.count("stat_shots").await, 2);
    }
}
