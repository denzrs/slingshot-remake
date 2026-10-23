//! Match statistics: how each turn and round of an online game went, for a year, in one SQLite-compatible
//! file beside the relay. The host's client reports each turn when its shots have landed and each round
//! when it ends (`report`); the relay adds
//! what only it knows (the room's rules, who is a person, how many watch) and writes it down.
//!
//! No name is kept — not a player's, not a room's. A person is told apart by a keyed hash of their
//! address and the name they play under (`pseudonym::Identities`), the same on every day of a week, with a
//! key of its own that is replaced every Sunday, so a stats row can never be matched to a name on the board. A room is a random id of
//! its own, never reused (not the code players type, which is free again when the room is gone). A
//! CPU seat has no hash. The numbers are taken at face value: they come from the host's own
//! browser, and the relay can fly nothing again.

use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::atomic::{AtomicI64, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde_json::Value;
use tracing::{info, warn};
use turso::{Connection, Database, Value as Sql};

use crate::pseudonym::Identities;
use crate::report::{LocalGame, RoundReport, ShotRound, TurnReport, RECORD_KEYS};

mod facts;
pub use facts::Fact;

/// Days a round is kept before the sweeper drops it.
pub const DEFAULT_KEEP_DAYS: i64 = 365;
/// How long an overview is good for: the page asks every so often, and what it shows moves by the minute.
const OVERVIEW_FRESH: Duration = Duration::from_secs(2);
/// Games the overview lists.
const OVERVIEW_GAMES: i64 = 50;
/// The sweeper runs at most this often, however busy the relay is.
const PRUNE_INTERVAL_SECS: i64 = 6 * 60 * 60;
const DAY_SECS: i64 = 24 * 60 * 60;

const SCHEMA: [&str; 14] = [
    // What the statistics remember between runs: the key their players are hashed with.
    "CREATE TABLE IF NOT EXISTS stat_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
    // One row per round. `match_id` is random per game and `room_id` random per room; neither is reused.
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
    // One row per judged tip of the oracle game (the shot-down players' and the stands'), no names: how it came out.
    "CREATE TABLE IF NOT EXISTS stat_tips (
         match_id TEXT    NOT NULL,
         round    INTEGER NOT NULL,
         n        INTEGER NOT NULL,
         at       INTEGER NOT NULL,
         kind     TEXT    NOT NULL,
         correct  INTEGER NOT NULL,
         stake    INTEGER NOT NULL,
         payout   INTEGER NOT NULL,
         underdog INTEGER NOT NULL,
         stands   INTEGER NOT NULL,
         PRIMARY KEY (match_id, round, n)
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
         fan        INTEGER,
         split_at   INTEGER,
         rider      TEXT,
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
    // One row per game: what it takes to fly it again besides what the turns say – the seed, the room's
    // rules and who sat where (a CPU's level, a team). No names. `replayable` drops to 0 when a report came from
    // a client that does not log what a replay needs.
    "CREATE TABLE IF NOT EXISTS stat_matches (
         match_id   TEXT    PRIMARY KEY,
         at         INTEGER NOT NULL,
         seed       INTEGER NOT NULL,
         game_mode  TEXT    NOT NULL,
         mode       TEXT    NOT NULL,
         rules      TEXT    NOT NULL,
         seats      TEXT    NOT NULL,
         replayable INTEGER NOT NULL,
         source     TEXT    NOT NULL DEFAULT 'online'
     )",
    "CREATE INDEX IF NOT EXISTS stat_matches_at ON stat_matches (at)",
    // One row per power-up laid on the field, in the order it was made: the part of a turn that is not a shot.
    "CREATE TABLE IF NOT EXISTS stat_placements (
         match_id TEXT    NOT NULL,
         round    INTEGER NOT NULL,
         turn     INTEGER NOT NULL,
         n        INTEGER NOT NULL,
         at       INTEGER NOT NULL,
         seat     INTEGER NOT NULL,
         kind     TEXT    NOT NULL,
         x        REAL,
         y        REAL,
         x2       REAL,
         y2       REAL,
         planet   INTEGER,
         PRIMARY KEY (match_id, round, turn, n)
     )",
    // One row per day: rounds played, and the points the shots earned (a shot's points are added
    // once, so the day's total is a plain sum). Kept as long as the rows above, and quick to read.
    "CREATE TABLE IF NOT EXISTS stat_days (
         day    TEXT    PRIMARY KEY,
         rounds INTEGER NOT NULL,
         points INTEGER NOT NULL
     )",
    // The same for games played on one device. They are told apart because their numbers are not the online ones:
    // a local game has no shots, and its points are the scores the seats ended on, CPUs included.
    "CREATE TABLE IF NOT EXISTS stat_local_days (
         day    TEXT    PRIMARY KEY,
         rounds INTEGER NOT NULL,
         points INTEGER NOT NULL
     )",
    "CREATE TABLE IF NOT EXISTS stat_local_day_players (
         day    TEXT NOT NULL,
         player TEXT NOT NULL,
         PRIMARY KEY (day, player)
     )",
    // Who played on a day, for as long as the day is kept: a player's hash and nothing about them.
    "CREATE TABLE IF NOT EXISTS stat_day_players (
         day    TEXT NOT NULL,
         player TEXT NOT NULL,
         PRIMARY KEY (day, player)
     )",
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

const INSERT_TIP: &str = "INSERT OR IGNORE INTO stat_tips (match_id, round, n, at, kind, correct, stake, payout, underdog, stands)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)";

const INSERT_SHOT: &str = "INSERT INTO stat_shots (
         match_id, round, turn, n, at, seat, player, cpu, angle, power, power_up, fork,
         fan, split_at, rider, resolution, hits, hit_seat, hit_kind, points)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20)";

const INSERT_MATCH: &str = "INSERT OR IGNORE INTO stat_matches (match_id, at, seed, game_mode, mode, rules, seats, replayable, source)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)";

const NOT_REPLAYABLE: &str = "UPDATE stat_matches SET replayable = 0 WHERE match_id = ?1";

const INSERT_PLACEMENT: &str =
    "INSERT INTO stat_placements (match_id, round, turn, n, at, seat, kind, x, y, x2, y2, planet)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)";

const INSERT_TURN: &str = "INSERT INTO stat_turns (
         match_id, round, turn, seat, at, player, cpu, alive, score)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)";

const ADD_DAY: &str = "INSERT INTO stat_days (day, rounds, points) VALUES (date(?1, 'unixepoch'), ?2, ?3)
     ON CONFLICT(day) DO UPDATE SET rounds = rounds + excluded.rounds, points = points + excluded.points";

const ADD_DAY_PLAYER: &str =
    "INSERT OR IGNORE INTO stat_day_players (day, player) VALUES (date(?1, 'unixepoch'), ?2)";

const ADD_LOCAL_DAY: &str = "INSERT INTO stat_local_days (day, rounds, points) VALUES (date(?1, 'unixepoch'), ?2, ?3)
     ON CONFLICT(day) DO UPDATE SET rounds = rounds + excluded.rounds, points = points + excluded.points";

const ADD_LOCAL_DAY_PLAYER: &str =
    "INSERT OR IGNORE INTO stat_local_day_players (day, player) VALUES (date(?1, 'unixepoch'), ?2)";

const SET_TURNS: &str = "UPDATE stat_rounds SET turns = ?3 WHERE match_id = ?1 AND round = ?2";

const PRUNE_LOCAL_DAYS: &str = "DELETE FROM stat_local_days WHERE day < date(?1, 'unixepoch')";
const PRUNE_LOCAL_DAY_PLAYERS: &str =
    "DELETE FROM stat_local_day_players WHERE day < date(?1, 'unixepoch')";
const PRUNE_DAYS: &str = "DELETE FROM stat_days WHERE day < date(?1, 'unixepoch')";
const PRUNE_DAY_PLAYERS: &str = "DELETE FROM stat_day_players WHERE day < date(?1, 'unixepoch')";

const PRUNE_PLACEMENTS: &str = "DELETE FROM stat_placements WHERE at < ?1";
const PRUNE_MATCHES: &str = "DELETE FROM stat_matches WHERE at < ?1";
const PRUNE_TURNS: &str = "DELETE FROM stat_turns WHERE at < ?1";
const PRUNE_SHOTS: &str = "DELETE FROM stat_shots WHERE at < ?1";
const PRUNE_ROUNDS: &str = "DELETE FROM stat_rounds WHERE at < ?1";
const PRUNE_SEATS: &str = "DELETE FROM stat_seats WHERE at < ?1";
const PRUNE_TIPS: &str = "DELETE FROM stat_tips WHERE at < ?1";

/// One day of the heatmap.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DayTotals {
    pub day: String,
    pub rounds: i64,
    pub players: i64,
    pub points: i64,
}

/// One game in the table: its rounds taken together.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Game {
    pub id: String,
    pub at: i64,
    pub game_mode: String,
    pub mode: String,
    pub humans: i64,
    pub cpus: i64,
    pub rounds: i64,
    pub points: i64,
    /// Whether the game can be flown again: all it takes was reported, whole.
    pub replay: bool,
    /// Played on one device, and reported when it was over.
    pub local: bool,
}

/// What the oracle's tips and bets came to, all kept games together.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Betting {
    pub shot_tips: i64,
    pub shot_right: i64,
    pub round_tips: i64,
    pub round_right: i64,
    /// Right tips against the crowd.
    pub underdogs: i64,
    /// Tips placed from the stands.
    pub stands: i64,
    /// Round tips with points on them.
    pub bets: i64,
    pub staked: i64,
    pub paid: i64,
    /// Bets that paid more than the stake.
    pub won: i64,
    pub biggest_win: i64,
    pub biggest_stake: i64,
}

pub struct Overview {
    /// Tips and bets; None while nobody has tipped.
    pub betting: Option<Betting>,
    /// Online games, by day.
    pub days: Vec<DayTotals>,
    /// Games played on one device, by day.
    pub local_days: Vec<DayTotals>,
    pub games: Vec<Game>,
}

/// Who sat in a ship: a person at an address under a name, or a CPU of some level.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Occupant {
    Person { ip: IpAddr, name: String },
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
    /// The room's id: random, made when the room is, and never used again, so it names a room and
    /// nobody in it.
    pub room_id: String,
    pub match_id: String,
    /// The seed the game started from: with the rules it builds every world of the game again.
    pub seed: u32,
    pub game_mode: &'static str,
    pub mode: &'static str,
    /// The room's rules as the lobby sends them.
    pub rules: Value,
    pub spectators: usize,
    pub seats: Vec<SeatFacts>,
    /// Played on one device and reported when it was over: it has no turns, and cannot be flown again.
    pub local: bool,
}

/// The database half: what a writer task needs, and what the tests read back.
pub struct Store {
    _database: Database,
    conn: Connection,
    /// For the overview's reads, so they never sit inside the writer's transaction.
    reader: Connection,
    /// For replays, which read a game's every row: a connection of their own and their own lock, so that a replay
    /// never holds up the overview (nor the other way round).
    replay_reader: Connection,
    replaying: tokio::sync::Mutex<()>,
    /// For the menu's facts, a few dozen scans of the shots: a connection of their own, so they never queue the overview's reads.
    facts_reader: Connection,
    /// One reader at a time: several tasks asking one connection at once wait on one another's statements, which a page with
    /// a few readers felt as seconds. Holds the overview last made, to hand to whoever asks within `OVERVIEW_FRESH`.
    reading: tokio::sync::Mutex<Option<(std::time::Instant, std::sync::Arc<Overview>)>>,
    /// The menu's facts last made (see `facts`), kept for a minute.
    facts: tokio::sync::Mutex<Option<(std::time::Instant, std::sync::Arc<Vec<Fact>>)>>,
    /// Its own key, kept in `stat_meta`: see `pseudonym`.
    /// The key of the week it was made in (see `week_of`) and the players it hashes.
    players: parking_lot::Mutex<(i64, Identities)>,
    keep_days: i64,
    last_prune: AtomicI64,
}

impl Store {
    /// Open the statistics in the relay's database, creating their tables. Like the leaderboard's,
    /// tables that cannot be opened are a deployment error, not something to run without.
    async fn open(database: &Database, keep_days: i64) -> turso::Result<Self> {
        let database = database.clone();
        let conn = database.connect()?;
        conn.execute("PRAGMA synchronous = NORMAL", ()).await?;
        conn.busy_timeout(Duration::from_secs(2))?;
        for statement in SCHEMA {
            conn.execute(statement, ()).await?;
        }
        // Columns that came after a file was first made.
        for (table, column, declared) in [
            ("stat_shots", "fan", "INTEGER"),
            ("stat_shots", "split_at", "INTEGER"),
            ("stat_shots", "rider", "TEXT"),
            ("stat_rounds", "turns", "INTEGER"),
        ] {
            Self::ensure_column(&conn, table, column, declared).await?;
        }
        let (week, salt) = Self::salt(&conn, week_of(now_unix())).await?;
        let reader = database.connect()?;
        reader.busy_timeout(Duration::from_secs(2))?;
        let replay_reader = database.connect()?;
        replay_reader.busy_timeout(Duration::from_secs(2))?;
        let facts_reader = database.connect()?;
        facts_reader.busy_timeout(Duration::from_secs(2))?;
        Ok(Self {
            _database: database,
            conn,
            reader,
            replay_reader,
            replaying: tokio::sync::Mutex::new(()),
            facts_reader,
            reading: tokio::sync::Mutex::new(None),
            facts: tokio::sync::Mutex::new(None),
            players: parking_lot::Mutex::new((week, Identities::new(salt))),
            keep_days: keep_days.max(1),
            last_prune: AtomicI64::new(0),
        })
    }

    /// Adds a column that a file made by an earlier version does not have yet.
    async fn ensure_column(
        conn: &Connection,
        table: &str,
        column: &str,
        declared: &str,
    ) -> turso::Result<()> {
        let mut rows = conn
            .query(
                format!(
                    "SELECT COUNT(*) FROM pragma_table_info('{table}') WHERE name = '{column}'"
                ),
                (),
            )
            .await?;
        let present = match rows.next().await? {
            Some(row) => row.get::<i64>(0)? > 0,
            None => false,
        };
        drop(rows);
        if !present {
            conn.execute(
                format!("ALTER TABLE {table} ADD COLUMN {column} {declared}"),
                (),
            )
            .await?;
        }
        Ok(())
    }

    /// The key the players are hashed with and the week it was made in: made on the first start and
    /// kept, so a player stays the same one across restarts and deploys, until the week is over (see
    /// `week_of`) and a fresh one takes its place.
    async fn salt(conn: &Connection, week: i64) -> turso::Result<(i64, Vec<u8>)> {
        let mut rows = conn
            .query(
                "SELECT value FROM stat_meta WHERE key = 'player_salt'
                 UNION ALL SELECT value FROM stat_meta WHERE key = 'player_salt_week'",
                (),
            )
            .await?;
        let mut kept = Vec::new();
        while let Some(row) = rows.next().await? {
            kept.push(row.get::<String>(0)?);
        }
        drop(rows);
        // A file from before the rotation has a salt and no week: it is in the week it is opened.
        let made = kept.get(1).and_then(|text| text.parse::<i64>().ok());
        if let Some(salt) = kept.first().and_then(|text| decode_hex(text)) {
            if made.unwrap_or(week) == week {
                if made.is_none() {
                    Self::keep_salt(conn, &salt, week).await?;
                }
                return Ok((week, salt));
            }
        }
        let salt = Identities::new_salt();
        Self::keep_salt(conn, &salt, week).await?;
        Ok((week, salt))
    }

    async fn keep_salt(conn: &Connection, salt: &[u8], week: i64) -> turso::Result<()> {
        for (key, value) in [
            ("player_salt", encode_hex(salt)),
            ("player_salt_week", week.to_string()),
        ] {
            conn.execute(
                "INSERT OR REPLACE INTO stat_meta (key, value) VALUES (?1, ?2)",
                (key, value),
            )
            .await?;
        }
        Ok(())
    }

    /// Swaps the players' key for a fresh one when a new week has begun, so nobody can be followed
    /// from one week to the next.
    async fn rotate(&self, at: i64) -> turso::Result<()> {
        let week = week_of(at);
        if self.players.lock().0 >= week {
            return Ok(());
        }
        let salt = Identities::new_salt();
        Self::keep_salt(&self.conn, &salt, week).await?;
        let mut players = self.players.lock();
        if players.0 < week {
            *players = (week, Identities::new(salt));
        }
        Ok(())
    }

    /// Write what a report says down, as one transaction.
    pub async fn record(&self, job: &Job) -> turso::Result<()> {
        self.record_at(job, now_unix()).await
    }

    async fn record_at(&self, job: &Job, at: i64) -> turso::Result<()> {
        self.rotate(at).await?;
        if self.conn.execute("BEGIN", ()).await.is_err() {
            // A transaction left open by a failure would fail every write after it: close it and begin again.
            let _ = self.conn.execute("ROLLBACK", ()).await;
            self.conn.execute("BEGIN", ()).await?;
        }
        let written = match job {
            Job::Round(facts, report) => self.write_round(facts, report, at).await,
            Job::Turn(facts, report) => self.write_turn(facts, report, at).await,
            Job::Local(facts, rounds) => self.write_local(facts, rounds, at).await,
        };
        match written {
            Ok(()) => match self.conn.execute("COMMIT", ()).await {
                Ok(_) => Ok(()),
                Err(err) => {
                    let _ = self.conn.execute("ROLLBACK", ()).await;
                    Err(err)
                }
            },
            Err(err) => {
                let _ = self.conn.execute("ROLLBACK", ()).await;
                Err(err)
            }
        }
    }

    /// Who sat where: a person's player hash or a CPU's level, the same for the seat's every row.
    fn who(&self, facts: &RoundFacts) -> Vec<(Sql, Sql)> {
        facts
            .seats
            .iter()
            .map(|sitter| match &sitter.occupant {
                Occupant::Person { ip, name } => (
                    Sql::Text(self.players.lock().1.player(*ip, name)),
                    Sql::Null,
                ),
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
        let who = self.who(facts);
        self.write_match(facts, at).await?;
        // A client that does not log the placements has a game that cannot be flown again.
        if report.placements.is_none() {
            self.conn
                .execute(NOT_REPLAYABLE, (facts.match_id.clone(),))
                .await?;
        }
        for (n, placement) in report.placements.iter().flatten().enumerate() {
            let number = |value: Option<f64>| value.map_or(Sql::Null, Sql::Real);
            let row = vec![
                Sql::Text(facts.match_id.clone()),
                Sql::Integer(report.round),
                Sql::Integer(report.turn),
                Sql::Integer(n as i64 + 1),
                Sql::Integer(at),
                Sql::Integer(placement.seat as i64),
                Sql::Text(placement.kind.into()),
                number(placement.x),
                number(placement.y),
                number(placement.x2),
                number(placement.y2),
                optional(placement.planet),
            ];
            self.conn.execute(INSERT_PLACEMENT, row).await?;
        }
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
        let points = report.shots.iter().map(|shot| shot.points).sum();
        self.tally(facts.local, &who, 0, points, at).await
    }

    /// A game played on one device: its rounds as the player's own client reports them, all at once, and the
    /// points they ended on for the day's total (there are no shots to add up).
    async fn write_local(
        &self,
        facts: &RoundFacts,
        rounds: &[RoundReport],
        at: i64,
    ) -> turso::Result<()> {
        for report in rounds {
            self.write_round(facts, report, at).await?;
        }
        let points = rounds
            .last()
            .map_or(0, |last| last.seats.iter().map(|seat| seat.score).sum());
        self.tally(facts.local, &self.who(facts), 0, points, at)
            .await
    }

    /// The game's row, written with its first report: the seed, the rules and who sat where.
    async fn write_match(&self, facts: &RoundFacts, at: i64) -> turso::Result<()> {
        let seats: Vec<Value> = facts
            .seats
            .iter()
            .map(|seat| {
                let cpu = match &seat.occupant {
                    Occupant::Cpu(level) => Value::from(*level),
                    Occupant::Person { .. } => Value::Null,
                };
                serde_json::json!({ "cpu": cpu, "team": seat.team })
            })
            .collect();
        let row = vec![
            Sql::Text(facts.match_id.clone()),
            Sql::Integer(at),
            Sql::Integer(facts.seed.into()),
            Sql::Text(facts.game_mode.into()),
            Sql::Text(facts.mode.into()),
            Sql::Text(facts.rules.to_string()),
            Sql::Text(Value::from(seats).to_string()),
            Sql::Integer((!facts.local).into()),
            Sql::Text(if facts.local { "local" } else { "online" }.into()),
        ];
        self.conn.execute(INSERT_MATCH, row).await?;
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
            optional(shot.fan),
            optional(shot.split_at),
            text(shot.rider),
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
        self.write_match(facts, at).await?;
        let humans = facts
            .seats
            .iter()
            .filter(|s| matches!(s.occupant, Occupant::Person { .. }))
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
        if let Some(turns) = report.turns {
            self.conn
                .execute(SET_TURNS, (facts.match_id.clone(), report.round, turns))
                .await?;
        }

        let who = self.who(facts);
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
        for (n, tip) in report.tips.iter().enumerate() {
            let row = vec![
                Sql::Text(facts.match_id.clone()),
                Sql::Integer(report.round),
                Sql::Integer(n as i64 + 1),
                Sql::Integer(at),
                Sql::Text(tip.kind.into()),
                Sql::Integer(tip.right.into()),
                Sql::Integer(tip.stake),
                Sql::Integer(tip.payout),
                Sql::Integer(tip.underdog.into()),
                Sql::Integer(tip.stands.into()),
            ];
            self.conn.execute(INSERT_TIP, row).await?;
        }
        self.tally(facts.local, &who, 1, 0, at).await
    }

    /// Add to the day's totals: rounds and points, and the people who played.
    async fn tally(
        &self,
        local: bool,
        who: &[(Sql, Sql)],
        rounds: i64,
        points: i64,
        at: i64,
    ) -> turso::Result<()> {
        let (add_day, add_player) = if local {
            (ADD_LOCAL_DAY, ADD_LOCAL_DAY_PLAYER)
        } else {
            (ADD_DAY, ADD_DAY_PLAYER)
        };
        self.conn.execute(add_day, (at, rounds, points)).await?;
        for (player, _) in who {
            if let Sql::Text(player) = player {
                self.conn.execute(add_player, (at, player.clone())).await?;
            }
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
        self.conn.execute(PRUNE_TIPS, (cutoff,)).await?;
        self.conn.execute(PRUNE_PLACEMENTS, (cutoff,)).await?;
        self.conn.execute(PRUNE_MATCHES, (cutoff,)).await?;
        self.conn.execute(PRUNE_SHOTS, (cutoff,)).await?;
        self.conn.execute(PRUNE_TURNS, (cutoff,)).await?;
        let removed = self.conn.execute(PRUNE_ROUNDS, (cutoff,)).await?;
        self.conn.execute(PRUNE_DAYS, (cutoff,)).await?;
        self.conn.execute(PRUNE_DAY_PLAYERS, (cutoff,)).await?;
        self.conn.execute(PRUNE_LOCAL_DAYS, (cutoff,)).await?;
        self.conn
            .execute(PRUNE_LOCAL_DAY_PLAYERS, (cutoff,))
            .await?;
        Ok(removed)
    }

    /// The overview, as the relay hands it to every reader of the page: made at most once in `OVERVIEW_FRESH`, by one reader at a
    /// time, and shared.
    pub async fn overview_shared(&self) -> turso::Result<std::sync::Arc<Overview>> {
        let mut held = self.reading.lock().await;
        if let Some((made, overview)) = held.as_ref() {
            if made.elapsed() < OVERVIEW_FRESH {
                return Ok(overview.clone());
            }
        }
        let overview = std::sync::Arc::new(self.overview().await?);
        *held = Some((std::time::Instant::now(), overview.clone()));
        Ok(overview)
    }

    /// What the stats page shows: the totals of every day kept, and the latest games.
    pub async fn overview(&self) -> turso::Result<Overview> {
        Ok(Overview {
            betting: self.betting().await?,
            days: self.days("stat_days", "stat_day_players").await?,
            local_days: self
                .days("stat_local_days", "stat_local_day_players")
                .await?,
            games: self.latest_games().await?,
        })
    }

    async fn betting(&self) -> turso::Result<Option<Betting>> {
        let mut rows = self
            .reader
            .query(
                "SELECT COUNT(*),
                        COALESCE(SUM(kind = 'shot'), 0), COALESCE(SUM(kind = 'shot' AND correct = 1), 0),
                        COALESCE(SUM(kind = 'round'), 0), COALESCE(SUM(kind = 'round' AND correct = 1), 0),
                        COALESCE(SUM(underdog), 0), COALESCE(SUM(stands), 0),
                        COALESCE(SUM(stake > 0), 0), COALESCE(SUM(stake), 0), COALESCE(SUM(payout), 0),
                        COALESCE(SUM(stake > 0 AND payout > stake), 0),
                        COALESCE(MAX(CASE WHEN payout > stake THEN payout - stake ELSE 0 END), 0),
                        COALESCE(MAX(stake), 0)
                 FROM stat_tips",
                (),
            )
            .await?;
        let Some(row) = rows.next().await? else {
            return Ok(None);
        };
        if row.get::<i64>(0)? == 0 {
            return Ok(None);
        }
        Ok(Some(Betting {
            shot_tips: row.get(1)?,
            shot_right: row.get(2)?,
            round_tips: row.get(3)?,
            round_right: row.get(4)?,
            underdogs: row.get(5)?,
            stands: row.get(6)?,
            bets: row.get(7)?,
            staked: row.get(8)?,
            paid: row.get(9)?,
            won: row.get(10)?,
            biggest_win: row.get(11)?,
            biggest_stake: row.get(12)?,
        }))
    }

    /// The totals of every day in a pair of day tables (online or local), oldest first.
    async fn days(&self, days: &str, players: &str) -> turso::Result<Vec<DayTotals>> {
        let mut out = Vec::new();
        let mut rows = self
            .reader
            .query(
                format!(
                    "SELECT d.day, d.rounds,
                            (SELECT COUNT(*) FROM {players} p WHERE p.day = d.day), d.points
                     FROM {days} d ORDER BY d.day"
                ),
                (),
            )
            .await?;
        while let Some(row) = rows.next().await? {
            out.push(DayTotals {
                day: row.get(0)?,
                rounds: row.get(1)?,
                players: row.get(2)?,
                points: row.get(3)?,
            });
        }
        drop(rows);
        Ok(out)
    }

    /// The latest games, newest first, with what the table shows of each. A handful of queries in all – one for the games, then one
    /// each for what is summed over the games' rows – because one query per game made the page wait behind the writer for
    /// every one of them.
    async fn latest_games(&self) -> turso::Result<Vec<Game>> {
        struct Head {
            game: Game,
            replayable: i64,
            rules: String,
        }
        let mut heads: Vec<Head> = Vec::new();
        // Games with at least one round in: one that was left in its first round has nothing to show.
        let mut rows = self
            .reader
            .query(
                "SELECT m.match_id, m.at, m.game_mode, m.mode, m.source, m.replayable, m.rules
                 FROM stat_matches m
                 WHERE EXISTS (SELECT 1 FROM stat_rounds r WHERE r.match_id = m.match_id)
                 ORDER BY m.at DESC LIMIT ?1",
                (OVERVIEW_GAMES,),
            )
            .await?;
        while let Some(row) = rows.next().await? {
            heads.push(Head {
                game: Game {
                    id: row.get(0)?,
                    at: row.get(1)?,
                    game_mode: row.get(2)?,
                    mode: row.get(3)?,
                    local: row.get::<String>(4)? == "local",
                    humans: 0,
                    cpus: 0,
                    rounds: 0,
                    points: 0,
                    replay: false,
                },
                replayable: row.get(5)?,
                rules: row.get(6)?,
            });
        }
        drop(rows);
        // Ids are made here, 16 hex digits; anything else is not listed rather than put into a query.
        heads.retain(|head| {
            head.game.id.len() == 16 && head.game.id.bytes().all(|b| b.is_ascii_hexdigit())
        });
        if heads.is_empty() {
            return Ok(Vec::new());
        }
        let ids = heads
            .iter()
            .map(|head| format!("'{}'", head.game.id))
            .collect::<Vec<_>>()
            .join(",");
        let by_id =
            |heads: &mut Vec<Head>, id: &str| heads.iter().position(|head| head.game.id == id);

        let mut rows = self
            .reader
            .query(
                format!(
                    "SELECT match_id, MAX(humans), MAX(cpus), COUNT(*) FROM stat_rounds WHERE match_id IN ({ids}) GROUP BY match_id"
                ),
                (),
            )
            .await?;
        while let Some(row) = rows.next().await? {
            if let Some(i) = by_id(&mut heads, &row.get::<String>(0)?) {
                heads[i].game.humans = row.get(1)?;
                heads[i].game.cpus = row.get(2)?;
                heads[i].game.rounds = row.get(3)?;
            }
        }
        drop(rows);

        // What the shots earned; a game on one device has none, and ended on the points its seats held.
        let mut rows = self
            .reader
            .query(
                format!("SELECT match_id, SUM(points) FROM stat_shots WHERE match_id IN ({ids}) GROUP BY match_id"),
                (),
            )
            .await?;
        while let Some(row) = rows.next().await? {
            if let Some(i) = by_id(&mut heads, &row.get::<String>(0)?) {
                heads[i].game.points = row.get(1)?;
            }
        }
        drop(rows);
        let mut rows = self
            .reader
            .query(
                format!(
                    "SELECT match_id, SUM(score) FROM stat_seats s WHERE match_id IN ({ids})
                     AND round = (SELECT MAX(round) FROM stat_seats WHERE match_id = s.match_id) GROUP BY match_id"
                ),
                (),
            )
            .await?;
        while let Some(row) = rows.next().await? {
            if let Some(i) = by_id(&mut heads, &row.get::<String>(0)?) {
                if heads[i].game.local {
                    heads[i].game.points = row.get(1)?;
                }
            }
        }
        drop(rows);

        // Whether a game can be flown again: its rounds' turns, counted.
        let mut turns: std::collections::HashMap<String, Vec<(i64, i64, i64)>> =
            std::collections::HashMap::new();
        let mut reported: std::collections::HashMap<String, Vec<(i64, Option<i64>)>> =
            std::collections::HashMap::new();
        let mut rows = self
            .reader
            .query(
                format!(
                    "SELECT match_id, round, COUNT(DISTINCT turn), MAX(turn) FROM stat_turns WHERE match_id IN ({ids}) GROUP BY match_id, round"
                ),
                (),
            )
            .await?;
        while let Some(row) = rows.next().await? {
            turns
                .entry(row.get(0)?)
                .or_default()
                .push((row.get(1)?, row.get(2)?, row.get(3)?));
        }
        drop(rows);
        let mut rows = self
            .reader
            .query(
                format!("SELECT match_id, round, turns FROM stat_rounds WHERE match_id IN ({ids})"),
                (),
            )
            .await?;
        while let Some(row) = rows.next().await? {
            reported
                .entry(row.get(0)?)
                .or_default()
                .push((row.get(1)?, row.get::<i64>(2).ok()));
        }
        drop(rows);

        Ok(heads
            .into_iter()
            .map(|mut head| {
                let counted = turns.get(&head.game.id).map_or(&[][..], Vec::as_slice);
                let rounds = reported.get(&head.game.id).map_or(&[][..], Vec::as_slice);
                head.game.replay = !head.game.local
                    && is_replayable(head.replayable, &head.rules, rounds, counted);
                head.game
            })
            .collect())
    }

    /// Whether a game can be flown again: it has its row (its seed and rules), every client that reported
    /// it logged what a replay needs, every round of the rules was reported, and every round's turns are all there.
    async fn replayable(&self, match_id: &str) -> turso::Result<bool> {
        let mut rows = self
            .replay_reader
            .query(
                "SELECT replayable, rules, source FROM stat_matches WHERE match_id = ?1",
                (match_id.to_string(),),
            )
            .await?;
        let Some(row) = rows.next().await? else {
            return Ok(false);
        };
        let (replayable, rules, source): (i64, String, String) =
            (row.get(0)?, row.get(1)?, row.get(2)?);
        drop(rows);
        if source == "local" {
            return Ok(false);
        }
        let mut counted = Vec::new();
        let mut rows = self
            .replay_reader
            .query(
                "SELECT round, COUNT(DISTINCT turn), MAX(turn) FROM stat_turns WHERE match_id = ?1 GROUP BY round",
                (match_id.to_string(),),
            )
            .await?;
        while let Some(row) = rows.next().await? {
            counted.push((row.get(0)?, row.get(1)?, row.get(2)?));
        }
        drop(rows);
        let mut rounds = Vec::new();
        let mut rows = self
            .replay_reader
            .query(
                "SELECT round, turns FROM stat_rounds WHERE match_id = ?1",
                (match_id.to_string(),),
            )
            .await?;
        while let Some(row) = rows.next().await? {
            rounds.push((row.get(0)?, row.get::<i64>(1).ok()));
        }
        drop(rows);
        Ok(is_replayable(replayable, &rules, &rounds, &counted))
    }

    /// A replay, read by one reader at a time like the overview.
    pub async fn replay_shared(&self, match_id: &str) -> turso::Result<Option<Value>> {
        let _replaying = self.replaying.lock().await;
        self.replay(match_id).await
    }

    /// Everything the client needs to fly a game again: the seed, the rules, who sat where and, turn by
    /// turn, the placements and shots. None when the game cannot be flown again.
    pub async fn replay(&self, match_id: &str) -> turso::Result<Option<Value>> {
        if !self.replayable(match_id).await? {
            return Ok(None);
        }
        let id = match_id.to_string();
        let mut rows = self
            .replay_reader
            .query(
                "SELECT seed, game_mode, mode, rules, seats FROM stat_matches WHERE match_id = ?1",
                (id.clone(),),
            )
            .await?;
        let Some(row) = rows.next().await? else {
            return Ok(None);
        };
        let header = (
            row.get::<i64>(0)?,
            row.get::<String>(1)?,
            row.get::<String>(2)?,
            row.get::<String>(3)?,
            row.get::<String>(4)?,
        );
        drop(rows);
        // The turns, in order: a turn nobody shot in still has its row among the seats'.
        let mut turns: Vec<(i64, i64, Vec<Value>, Vec<Value>)> = Vec::new();
        let mut rows = self
            .replay_reader
            .query(
                "SELECT DISTINCT round, turn FROM stat_turns WHERE match_id = ?1 ORDER BY round, turn",
                (id.clone(),),
            )
            .await?;
        while let Some(row) = rows.next().await? {
            turns.push((row.get(0)?, row.get(1)?, Vec::new(), Vec::new()));
        }
        drop(rows);
        let at = |turns: &mut Vec<(i64, i64, Vec<Value>, Vec<Value>)>, round: i64, turn: i64| {
            turns
                .binary_search_by_key(&(round, turn), |t| (t.0, t.1))
                .ok()
        };
        let mut rows = self
            .replay_reader
            .query(
                "SELECT round, turn, seat, angle, power, rider, split_at FROM stat_shots
                 WHERE match_id = ?1 AND fork = 0 ORDER BY round, turn, n",
                (id.clone(),),
            )
            .await?;
        while let Some(row) = rows.next().await? {
            let (round, turn): (i64, i64) = (row.get(0)?, row.get(1)?);
            if let Some(i) = at(&mut turns, round, turn) {
                turns[i].3.push(serde_json::json!({
                    "player": row.get::<i64>(2)?,
                    "angle": row.get::<f64>(3)?,
                    "power": row.get::<f64>(4)?,
                    "rider": row.get::<String>(5).ok(),
                    "splitAt": row.get::<i64>(6).ok(),
                }));
            }
        }
        drop(rows);
        let mut rows = self
            .replay_reader
            .query(
                "SELECT round, turn, seat, kind, x, y, x2, y2, planet FROM stat_placements
                 WHERE match_id = ?1 ORDER BY round, turn, n",
                (id,),
            )
            .await?;
        while let Some(row) = rows.next().await? {
            let (round, turn): (i64, i64) = (row.get(0)?, row.get(1)?);
            let mut placement =
                serde_json::json!({ "player": row.get::<i64>(2)?, "kind": row.get::<String>(3)? });
            for (key, column) in [("x", 4), ("y", 5), ("x2", 6), ("y2", 7)] {
                if let Ok(value) = row.get::<f64>(column) {
                    placement[key] = Value::from(value);
                }
            }
            if let Ok(planet) = row.get::<i64>(8) {
                placement["planet"] = Value::from(planet);
            }
            if let Some(i) = at(&mut turns, round, turn) {
                turns[i].2.push(placement);
            }
        }
        // The rounds the room skipped by vote: they end after their last turn.
        let mut skipped: Vec<i64> = Vec::new();
        let mut rows = self
            .replay_reader
            .query(
                "SELECT round FROM stat_rounds WHERE match_id = ?1 AND title = 'skipped' ORDER BY round",
                (match_id.to_string(),),
            )
            .await?;
        while let Some(row) = rows.next().await? {
            skipped.push(row.get(0)?);
        }
        drop(rows);
        Ok(Some(serde_json::json!({
            "skipped": skipped,
            "seed": header.0,
            "gameMode": header.1,
            "mode": header.2,
            "rules": serde_json::from_str::<Value>(&header.3).unwrap_or(Value::Null),
            "seats": serde_json::from_str::<Value>(&header.4).unwrap_or(Value::Null),
            "turns": turns.into_iter().map(|(round, turn, placements, shots)| serde_json::json!({
                "round": round, "turn": turn, "placements": placements, "shots": shots,
            })).collect::<Vec<_>>(),
        })))
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
    /// A whole game played on one device.
    Local(RoundFacts, Vec<RoundReport>),
}

/// The statistics as the room logic sees them: a queue in front of one writer task, so a report is
/// handed over without waiting, written in order, and never written by two tasks at once.
pub struct Stats {
    store: std::sync::Arc<Store>,
    queue: tokio::sync::mpsc::Sender<Job>,
    /// Per address, when the current hour of local games began and how many were handed in during it.
    local_games: std::sync::Mutex<HashMap<IpAddr, (Instant, u32)>>,
}

/// How many games played on one device an address may hand in per hour: far more than anyone plays, far fewer
/// than it takes to bury the statistics under made-up games.
const LOCAL_GAMES_PER_HOUR: u32 = 20;
const LOCAL_WINDOW: Duration = Duration::from_secs(3600);
/// Addresses remembered at most; when it is passed, those whose hour is over are forgotten.
const LOCAL_ADDRESSES: usize = 4096;

impl std::ops::Deref for Stats {
    type Target = Store;

    fn deref(&self) -> &Store {
        &self.store
    }
}

impl Stats {
    /// Open (or create) the statistics file and start the writer. Like the leaderboard's, a file that
    /// cannot be opened is a deployment error, not something to run without.
    pub async fn open(database: &Database, keep_days: i64) -> turso::Result<Self> {
        let store = std::sync::Arc::new(Store::open(database, keep_days).await?);
        let (queue, mut waiting) = tokio::sync::mpsc::channel::<Job>(QUEUE);
        let writer = store.clone();
        tokio::spawn(async move {
            while let Some(job) = waiting.recv().await {
                if let Err(err) = writer.record(&job).await {
                    warn!(%err, "stats write failed");
                }
            }
        });
        Ok(Self {
            store,
            queue,
            local_games: std::sync::Mutex::new(HashMap::new()),
        })
    }

    #[cfg(test)]
    pub async fn in_memory() -> Self {
        let database = crate::db::open(":memory:")
            .await
            .expect("an in-memory database opens");
        Self::open(&database, DEFAULT_KEEP_DAYS)
            .await
            .expect("an in-memory store opens")
    }

    /// Hand over a game played on one device by the person at `ip`. It has the ids of any other game, made here:
    /// the player's own client knows no room and chooses no id that could name one.
    pub fn submit_local(&self, ip: IpAddr, game: LocalGame) {
        use rand::Rng;
        if !self.local_allowed(ip, Instant::now()) {
            warn!(%ip, "too many local games from one address; one was dropped");
            return;
        }
        let mut rng = rand::thread_rng();
        let facts = RoundFacts {
            room_id: format!("{:032x}", rng.gen::<u128>()),
            match_id: format!("{:016x}", rng.gen::<u64>()),
            seed: 0,
            game_mode: game.game_mode.as_str(),
            mode: game.mode.as_str(),
            rules: crate::protocol::rules_to_value(&game.rules),
            spectators: 0,
            seats: game
                .seats
                .iter()
                .map(|(cpu, team)| SeatFacts {
                    // No name: the person at a keyboard is told apart by their address alone.
                    occupant: cpu.map_or_else(
                        || Occupant::Person {
                            ip,
                            name: String::new(),
                        },
                        |level| Occupant::Cpu(level.as_str()),
                    ),
                    team: *team,
                })
                .collect(),
            local: true,
        };
        self.submit(Job::Local(facts, game.rounds));
    }

    /// Whether `ip` may hand in another local game: a fixed window of an hour from its first, with a count.
    fn local_allowed(&self, ip: IpAddr, now: Instant) -> bool {
        let mut seen = self
            .local_games
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if seen.len() >= LOCAL_ADDRESSES {
            seen.retain(|_, (since, _)| now.duration_since(*since) < LOCAL_WINDOW);
        }
        let entry = seen.entry(ip).or_insert((now, 0));
        if now.duration_since(entry.0) >= LOCAL_WINDOW {
            *entry = (now, 0);
        }
        if entry.1 >= LOCAL_GAMES_PER_HOUR {
            return false;
        }
        entry.1 += 1;
        true
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

/// Whether a game can be flown again: no client left out the placements, every round of the rules was reported, and
/// every round's turns count up from 1 to the number the round reported (`counted` is, per round with turns, how many
/// there are and the highest number).
fn is_replayable(
    replayable: i64,
    rules: &str,
    reported: &[(i64, Option<i64>)],
    counted: &[(i64, i64, i64)],
) -> bool {
    let expected = serde_json::from_str::<Value>(rules)
        .ok()
        .and_then(|rules| rules.get("rounds").and_then(Value::as_i64));
    let Some(expected) = expected else {
        return false;
    };
    // Each round says how many turns it took: those are all there, from 1 without a gap, and there is no turn
    // of a round that was never reported. A round that does not say (an old client) cannot be checked.
    let whole = reported.iter().all(|(round, turns)| {
        let found = counted.iter().find(|(r, _, _)| r == round);
        match (turns, found) {
            (Some(0), None) => true,
            (Some(turns), Some((_, count, last))) => count == turns && last == turns,
            _ => false,
        }
    });
    replayable != 0
        && whole
        && counted
            .iter()
            .all(|(round, _, _)| reported.iter().any(|(r, _)| r == round))
        && reported.len() as i64 == expected
}

fn encode_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn decode_hex(text: &str) -> Option<Vec<u8>> {
    if !text.len().is_multiple_of(2) || text.is_empty() {
        return None;
    }
    (0..text.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(text.get(i..i + 2)?, 16).ok())
        .collect()
}

/// The Sunday (as a day number since the epoch) that the week of this moment began on, UTC. The
/// players' key is replaced when it changes. The epoch, a Thursday, is day 0, so day 3 is a Sunday.
fn week_of(at: i64) -> i64 {
    let day = at.div_euclid(DAY_SECS);
    day - (day - 3).rem_euclid(7)
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
            "seconds": 30.5, "planets": 3, "turns": 2,
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
                {"n": turn * 10 + 2, "turn": turn, "player": 1, "angle": 140.0, "power": 80.0, "powerUp": "splitter", "rider": "plasma", "fork": false, "fan": 4, "splitAt": 120, "resolution": "ship", "hits": 1, "hitSeat": 0, "hitKind": "enemy", "points": 250},
            ],
            "placements": [{"player": 0, "kind": "blackhole", "x": 410.5, "y": 220.25}, {"player": 1, "kind": "wormhole", "x": 1.5, "y": 2.5, "x2": 3.5, "y2": 4.5}, {"player": 1, "kind": "planetkiller", "planet": 2}, {"player": 0, "kind": "teleport"}],
        }))
        .unwrap()
    }

    fn facts(ip: [u8; 4], name: &str) -> RoundFacts {
        RoundFacts {
            room_id: "abc123".into(),
            match_id: "0123456789abcdef".into(),
            seed: 99,
            game_mode: "classic",
            mode: "ffa",
            rules: json!({"rounds": 1}),
            spectators: 1,
            seats: vec![
                SeatFacts {
                    occupant: Occupant::Person {
                        ip: IpAddr::from(ip),
                        name: name.into(),
                    },
                    team: None,
                },
                SeatFacts {
                    occupant: Occupant::Cpu("hard"),
                    team: None,
                },
            ],
            local: false,
        }
    }

    fn round_job(ip: [u8; 4], n: i64) -> Job {
        Job::Round(facts(ip, "ann"), round(n))
    }

    fn turn_job(ip: [u8; 4], n: i64, t: i64) -> Job {
        Job::Turn(facts(ip, "ann"), turn(n, t))
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
            [Some("planet:-:3".into()), Some("ship:splitter:3".into())]
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
    async fn a_player_is_their_address_and_name_on_every_day_of_a_week_and_nobody_else() {
        let stats = Stats::in_memory().await;
        let day = 1_760_000_000;
        let ip = [10, 0, 0, 1];
        let job = |ip, name: &str, t| Job::Turn(facts(ip, name), turn(1, t));
        stats.record_at(&job(ip, "ann", 1), day).await.unwrap();
        stats.record_at(&job(ip, "ann", 2), day + 60).await.unwrap();
        stats
            .record_at(&job(ip, "ann", 3), day + 2 * DAY_SECS)
            .await
            .unwrap();
        // The same address under another name, and another address under the same name.
        stats.record_at(&job(ip, "bob", 4), day).await.unwrap();
        stats
            .record_at(&job([10, 0, 0, 2], "ann", 5), day)
            .await
            .unwrap();
        let players = text(
            &stats,
            "SELECT player FROM stat_turns WHERE seat = 0 ORDER BY turn",
        )
        .await;
        assert_eq!(players[0], players[1]);
        assert_eq!(players[0], players[2]);
        assert_ne!(players[0], players[3]);
        assert_ne!(players[0], players[4]);
    }

    #[test]
    fn a_week_begins_on_sunday_at_midnight_utc() {
        // 2025-10-05 was a Sunday.
        let sunday = 1_759_622_400;
        assert_eq!(sunday % DAY_SECS, 0);
        assert_eq!(week_of(sunday), week_of(sunday + 7 * DAY_SECS - 1));
        assert_ne!(week_of(sunday), week_of(sunday - 1));
        assert_ne!(week_of(sunday), week_of(sunday + 7 * DAY_SECS));
        assert_eq!(week_of(sunday), sunday / DAY_SECS);
    }

    #[tokio::test]
    async fn a_new_week_makes_the_same_person_a_new_player() {
        let stats = Stats::in_memory().await;
        let now = now_unix();
        let job = |t| Job::Turn(facts([10, 0, 0, 1], "ann"), turn(1, t));
        stats.record_at(&job(1), now).await.unwrap();
        stats.record_at(&job(2), now).await.unwrap();
        stats.record_at(&job(3), now + 8 * DAY_SECS).await.unwrap();
        let players = text(
            &stats,
            "SELECT player FROM stat_turns WHERE seat = 0 ORDER BY turn",
        )
        .await;
        assert_eq!(players[0], players[1]);
        assert_ne!(players[0], players[2]);
    }

    #[tokio::test]
    async fn a_split_is_kept_with_the_step_it_happened_at() {
        let stats = Stats::in_memory().await;
        stats.record(&turn_job([10, 0, 0, 1], 1, 1)).await.unwrap();
        assert_eq!(
            text(
                &stats,
                "SELECT COALESCE(CAST(fan AS TEXT) || '@' || CAST(split_at AS TEXT), '-') FROM stat_shots ORDER BY n"
            )
            .await,
            [Some("-".into()), Some("4@120".into())]
        );
    }

    #[tokio::test]
    async fn the_board_and_the_statistics_share_one_database() {
        let database = crate::db::open(":memory:").await.unwrap();
        let board = crate::leaderboard::Leaderboard::open(&database, 7)
            .await
            .unwrap();
        let stats = Stats::open(&database, DEFAULT_KEEP_DAYS).await.unwrap();
        let ip = IpAddr::from([10, 0, 0, 1]);
        board.submit("2026-10-23", "ann", 100, ip).await.unwrap();
        stats.record(&round_job([10, 0, 0, 1], 1)).await.unwrap();
        assert_eq!(stats.count("stat_rounds").await, 1);
        assert_eq!(
            board.board("2026-10-23", ip).await.unwrap().entries.len(),
            1
        );
    }

    #[tokio::test]
    async fn the_board_is_not_held_up_by_the_statistics_writing() {
        let path = std::env::temp_dir().join(format!("slingshot-busy-{}.db", std::process::id()));
        let path = path.to_str().unwrap();
        let database = crate::db::open(path).await.unwrap();
        let board = crate::leaderboard::Leaderboard::open(&database, 7)
            .await
            .unwrap();
        let stats = std::sync::Arc::new(Stats::open(&database, DEFAULT_KEEP_DAYS).await.unwrap());
        let writer = {
            let stats = stats.clone();
            tokio::spawn(async move {
                for n in 1..=40 {
                    stats.record(&turn_job([10, 0, 0, 1], 1, n)).await.unwrap();
                }
            })
        };
        let ip = IpAddr::from([10, 0, 0, 2]);
        for score in 1..=200 {
            board.submit("2026-10-23", "ann", score, ip).await.unwrap();
        }
        writer.await.unwrap();
        assert_eq!(stats.count("stat_turns").await, 80);
        assert_eq!(
            board.board("2026-10-23", ip).await.unwrap().entries[0].score,
            200
        );
        for suffix in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(format!("{path}{suffix}"));
        }
    }

    #[tokio::test]
    async fn the_overview_totals_the_days_and_lists_the_games() {
        let stats = Stats::in_memory().await;
        let day = 1_760_000_000;
        let ann = [10, 0, 0, 1];
        stats.record_at(&turn_job(ann, 1, 1), day).await.unwrap();
        stats
            .record_at(&turn_job(ann, 1, 2), day + 60)
            .await
            .unwrap();
        stats.record_at(&round_job(ann, 1), day + 90).await.unwrap();
        stats
            .record_at(&round_job([10, 0, 0, 2], 2), day + DAY_SECS)
            .await
            .unwrap();
        let overview = stats.overview().await.unwrap();
        assert_eq!(overview.days.len(), 2);
        // Two turns of 250 points each; one round; the one person who sat down.
        assert_eq!(
            overview.days[0],
            DayTotals {
                day: "2025-10-09".into(),
                rounds: 1,
                players: 1,
                points: 500
            }
        );
        assert_eq!(overview.days[1].rounds, 1);
        assert_eq!(overview.games.len(), 1);
        let game = &overview.games[0];
        assert_eq!(
            (game.humans, game.cpus, game.rounds, game.points),
            (1, 1, 2, 500)
        );
        assert_eq!(
            (game.game_mode.as_str(), game.mode.as_str()),
            ("classic", "ffa")
        );
    }

    #[tokio::test]
    async fn a_whole_game_can_be_flown_again_and_half_of_one_cannot() {
        let stats = Stats::in_memory().await;
        let id = "0123456789abcdef";
        let ann = [10, 0, 0, 1];
        // Nothing reported yet.
        assert!(stats.replay(id).await.unwrap().is_none());
        // A turn is in, but the round it belongs to is not over: not the whole game.
        stats.record(&turn_job(ann, 1, 1)).await.unwrap();
        assert!(stats.replay(id).await.unwrap().is_none());
        stats.record(&turn_job(ann, 1, 2)).await.unwrap();
        stats.record(&round_job(ann, 1)).await.unwrap();
        let replay = stats
            .replay(id)
            .await
            .unwrap()
            .expect("the one round of the rules is all there");
        assert_eq!(replay["skipped"], json!([]));
        assert_eq!(replay["seed"], 99);
        assert_eq!(replay["gameMode"], "classic");
        assert_eq!(replay["rules"], json!({"rounds": 1}));
        assert_eq!(
            replay["seats"],
            json!([{"cpu": null, "team": null}, {"cpu": "hard", "team": null}])
        );
        assert_eq!(replay["turns"].as_array().unwrap().len(), 2);
        let turn = &replay["turns"][0];
        assert_eq!((&turn["round"], &turn["turn"]), (&json!(1), &json!(1)));
        // The aim exactly as aimed, the rider that was armed, the step the splitter went off at; forks are not shots.
        assert_eq!(
            turn["shots"][1],
            json!({"player": 1, "angle": 140.0, "power": 80.0, "rider": "plasma", "splitAt": 120})
        );
        assert_eq!(turn["shots"][0]["rider"], Value::Null);
        assert_eq!(
            turn["placements"],
            json!([
                {"player": 0, "kind": "blackhole", "x": 410.5, "y": 220.25},
                {"player": 1, "kind": "wormhole", "x": 1.5, "y": 2.5, "x2": 3.5, "y2": 4.5},
                {"player": 1, "kind": "planetkiller", "planet": 2},
                {"player": 0, "kind": "teleport"},
            ])
        );
        // The list says so too.
        assert!(stats.overview().await.unwrap().games[0].replay);
    }

    #[tokio::test]
    async fn a_game_with_a_turn_missing_or_from_an_old_client_is_not_replayable() {
        let ann = [10, 0, 0, 1];
        let stats = Stats::in_memory().await;
        stats.record(&turn_job(ann, 1, 1)).await.unwrap();
        stats.record(&turn_job(ann, 1, 3)).await.unwrap();
        stats.record(&round_job(ann, 1)).await.unwrap();
        assert!(
            !stats.overview().await.unwrap().games[0].replay,
            "turn 2 was never reported"
        );

        // A client that does not log placements (the field is absent) has a game that cannot be flown again.
        let stats = Stats::in_memory().await;
        let mut old = turn(1, 1);
        old.placements = None;
        stats
            .record(&Job::Turn(facts(ann, "ann"), old))
            .await
            .unwrap();
        stats.record(&round_job(ann, 1)).await.unwrap();
        let game = &stats.overview().await.unwrap().games[0];
        assert!(!game.replay);
        assert!(stats.replay("0123456789abcdef").await.unwrap().is_none());
    }

    #[tokio::test]
    async fn a_turn_lost_at_the_end_of_a_round_is_noticed() {
        let ann = [10, 0, 0, 1];
        let stats = Stats::in_memory().await;
        // The round says it took two turns; the second never arrived.
        stats.record(&turn_job(ann, 1, 1)).await.unwrap();
        stats.record(&round_job(ann, 1)).await.unwrap();
        assert!(!stats.overview().await.unwrap().games[0].replay);
        assert!(stats.replay("0123456789abcdef").await.unwrap().is_none());
        // A round that does not say how many turns it took cannot be checked either.
        let stats = Stats::in_memory().await;
        let mut vague = round(1);
        vague.turns = None;
        stats.record(&turn_job(ann, 1, 1)).await.unwrap();
        stats.record(&turn_job(ann, 1, 2)).await.unwrap();
        stats
            .record(&Job::Round(facts(ann, "ann"), vague))
            .await
            .unwrap();
        assert!(!stats.overview().await.unwrap().games[0].replay);
    }

    #[tokio::test]
    async fn an_address_may_hand_in_only_so_many_local_games_an_hour() {
        let stats = Stats::in_memory().await;
        let ip: IpAddr = [10, 0, 0, 1].into();
        let other: IpAddr = [10, 0, 0, 2].into();
        let now = Instant::now();
        for _ in 0..LOCAL_GAMES_PER_HOUR {
            assert!(stats.local_allowed(ip, now));
        }
        assert!(!stats.local_allowed(ip, now));
        assert!(
            stats.local_allowed(other, now),
            "another address has its own"
        );
        assert!(
            stats.local_allowed(ip, now + LOCAL_WINDOW),
            "the next hour starts afresh"
        );
    }

    #[tokio::test]
    async fn a_game_played_on_one_device_is_kept_without_turns_and_cannot_be_flown_again() {
        let stats = Stats::in_memory().await;
        let mut facts = facts([10, 0, 0, 1], "");
        facts.local = true;
        facts.rules = json!({"rounds": 2});
        let job = Job::Local(facts, vec![round(1), round(2)]);
        stats.record_at(&job, 1_760_000_000).await.unwrap();
        assert_eq!(stats.count("stat_rounds").await, 2);
        assert_eq!(stats.count("stat_seats").await, 4);
        assert_eq!(stats.count("stat_turns").await, 0);
        assert_eq!(stats.count("stat_shots").await, 0);
        let overview = stats.overview().await.unwrap();
        let game = &overview.games[0];
        assert!(game.local && !game.replay);
        assert_eq!((game.rounds, game.humans, game.cpus), (2, 1, 1));
        // No shots to add up: the points are what the seats ended on (0 and 500).
        assert_eq!(game.points, 500);
        assert!(stats.replay("0123456789abcdef").await.unwrap().is_none());
        // The day counts it, among the local days and not the online ones: two rounds, one person, the points it ended on.
        assert!(overview.days.is_empty());
        assert_eq!(
            overview.local_days[0],
            DayTotals {
                day: "2025-10-09".into(),
                rounds: 2,
                players: 1,
                points: 500
            }
        );
    }

    #[tokio::test]
    async fn the_page_readers_share_one_overview_for_a_moment() {
        let stats = Stats::in_memory().await;
        let first = stats.overview_shared().await.unwrap();
        stats.record(&round_job([10, 0, 0, 1], 1)).await.unwrap();
        let second = stats.overview_shared().await.unwrap();
        assert!(
            std::sync::Arc::ptr_eq(&first, &second),
            "a second reader gets what the first was given"
        );
        assert!(second.games.is_empty());
        // The overview itself is always fresh.
        assert_eq!(stats.overview().await.unwrap().games.len(), 1);
    }

    #[tokio::test]
    async fn the_players_key_is_made_once_and_kept() {
        let path = std::env::temp_dir().join(format!("slingshot-key-{}.db", std::process::id()));
        let path = path.to_str().unwrap();
        let first = {
            let database = crate::db::open(path).await.unwrap();
            let stats = Stats::open(&database, DEFAULT_KEEP_DAYS).await.unwrap();
            stats.record(&turn_job([10, 0, 0, 1], 1, 1)).await.unwrap();
            text(&stats, "SELECT player FROM stat_turns WHERE seat = 0").await
        };
        let database = crate::db::open(path).await.unwrap();
        let stats = Stats::open(&database, DEFAULT_KEEP_DAYS).await.unwrap();
        stats.record(&turn_job([10, 0, 0, 1], 1, 2)).await.unwrap();
        let again = text(
            &stats,
            "SELECT player FROM stat_turns WHERE seat = 0 AND turn = 2",
        )
        .await;
        assert_eq!(first, again);
        for suffix in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(format!("{path}{suffix}"));
        }
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

    #[tokio::test]
    async fn the_tips_of_a_round_are_kept_and_the_menu_gets_facts_from_them() {
        let stats = Stats::in_memory().await;
        let mut report = round(1);
        let tip = |kind: &str, correct: bool, stake: i64, payout: i64| json!({"kind": kind, "right": correct, "stake": stake, "payout": payout, "underdog": false, "stands": false});
        let mut sent = json!({
            "round": 1, "title": "hit", "survivor": 1, "team": null, "seconds": 30.5, "planets": 3, "turns": 2,
            "players": [
                {"score": 0, "shots": 2, "kills": 0, "swingbys": 0, "grazes": 1, "ownGoals": 0, "pickups": 0, "saves": 0, "alive": false},
                {"score": 500, "shots": 1, "kills": 1, "swingbys": 2, "grazes": 0, "ownGoals": 0, "pickups": 0, "saves": 0, "alive": true},
            ],
            "records": {},
            "tips": [
                tip("round", true, 100, 250), tip("round", false, 100, 0), tip("round", false, 50, 0),
                tip("round", true, 0, 0), tip("round", false, 0, 0), tip("shot", true, 0, 0),
            ],
        });
        report.tips = parse_round_report(&sent).unwrap().tips;
        assert_eq!(report.tips.len(), 6);
        stats
            .record(&Job::Round(facts([10, 0, 0, 1], "ann"), report))
            .await
            .unwrap();
        assert_eq!(stats.count("stat_tips").await, 6);

        let betting = stats.overview().await.unwrap().betting.unwrap();
        assert_eq!(
            (
                betting.shot_tips,
                betting.shot_right,
                betting.round_tips,
                betting.round_right
            ),
            (1, 1, 5, 2)
        );
        assert_eq!(
            (betting.bets, betting.staked, betting.paid, betting.won),
            (3, 250, 250, 1)
        );
        assert_eq!((betting.biggest_win, betting.biggest_stake), (150, 100));

        let facts = stats.facts().await;
        let ids: Vec<_> = facts.iter().map(|f| f.id).collect();
        // Five round tips are enough for a fact; three bets and one shot tip, or no shots at all, are not.
        assert!(
            ids.contains(&"tipRound") && ids.contains(&"tipStands"),
            "{ids:?}"
        );
        assert!(
            !ids.contains(&"betStake") && !ids.contains(&"hitRate"),
            "{ids:?}"
        );
        let round_tips = facts.iter().find(|f| f.id == "tipRound").unwrap();
        assert_eq!(round_tips.values, [40.0]);
        // A tip that does not make sense is no report at all.
        sent["tips"][0]["kind"] = json!("lottery");
        assert!(parse_round_report(&sent).is_none());
    }
}
