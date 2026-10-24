//! Who is connected: each connection's outbound queue and client, and the limits on password
//! attempts, scrypt work and room-list requests.

use std::collections::{HashMap, HashSet, VecDeque};
use std::net::IpAddr;
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tracing::{info, warn};

use crate::admission::{BrowserId, Who, CEILING};
use crate::codec::{Frame, Outbound, OutboundPool, WireMessage};
use crate::protocol::{is_name_refusal, is_password_refusal};

/// Wrong passwords one client may type in `PASSWORD_WINDOW`, over all its connections and rooms.
/// Counted per client, so reconnecting does not start the count over.
pub const MAX_PASSWORD_ATTEMPTS: usize = 10;
pub const PASSWORD_WINDOW: Duration = Duration::from_secs(15 * 60);
/// Password checks one room takes in `ROOM_PASSWORD_WINDOW`, from everybody together: a guesser
/// spread over many addresses gets no further than one, and a friend waits a few seconds at worst.
pub const MAX_ROOM_PASSWORD_CHECKS: usize = 5;
pub const ROOM_PASSWORD_WINDOW: Duration = Duration::from_secs(5);
/// Password derivations one client may start per second.
pub const MAX_SCRYPT_PER_SECOND: usize = 10;
/// Room lists one connection may ask for in `LOBBY_WINDOW`; the relay sends every change anyway.
pub const MAX_LOBBY_REQUESTS: usize = 5;
pub const LOBBY_WINDOW: Duration = Duration::from_secs(10);
/// Requests that read or write the database (the daily board, the statistics page, the menu's
/// facts, replays) one client may make per minute (`DB_REQUESTS_PER_MINUTE`). The client opens a
/// connection per request, so they are counted per client; a page view takes a handful.
pub const DEFAULT_DB_REQUESTS_PER_MINUTE: usize = 120;
pub const DB_WINDOW: Duration = Duration::from_secs(60);
/// How many inputs a spectator may send per second; a bet needs a few clicks, not a stream.
pub const MAX_SPECTATOR_INPUTS_PER_SECOND: usize = 8;
/// Chat messages one connection may send in `CHAT_WINDOW`.
pub const MAX_CHAT_MESSAGES: usize = 5;
pub const CHAT_WINDOW: Duration = Duration::from_secs(10);
/// Times one connection may walk into the stands in `SPECTATE_WINDOW`: every mid-game arrival costs the host a full frame.
pub const MAX_SPECTATE_JOINS: usize = 3;
pub const SPECTATE_WINDOW: Duration = Duration::from_secs(30);

struct Conn {
    tx: Outbound,
    bytes: std::sync::Arc<tokio::sync::Semaphore>,
    slow: tokio::sync::watch::Sender<bool>,
}

/// When each key last did something, within a window: a sliding-window rate limit per key.
struct Windows<K> {
    span: Duration,
    seen: HashMap<K, VecDeque<Instant>>,
}

impl<K: std::hash::Hash + Eq> Windows<K> {
    fn new(span: Duration) -> Self {
        Self {
            span,
            seen: HashMap::new(),
        }
    }

    /// How often `key` did it within the window.
    fn count(&mut self, key: &K, now: Instant) -> usize {
        let span = self.span;
        self.seen.get_mut(key).map_or(0, |window| {
            window.retain(|at| now.duration_since(*at) < span);
            window.len()
        })
    }

    fn record(&mut self, key: K, now: Instant) {
        self.seen.entry(key).or_default().push_back(now);
    }

    /// Record one more unless `key` already did it `max` times within the window.
    fn allow(&mut self, key: K, now: Instant, max: usize) -> bool {
        if self.count(&key, now) >= max {
            return false;
        }
        self.record(key, now);
        true
    }

    fn forget(&mut self, key: &K) {
        self.seen.remove(key);
    }

    fn sweep(&mut self, now: Instant) {
        let span = self.span;
        self.seen.retain(|_, window| {
            window.retain(|at| now.duration_since(*at) < span);
            !window.is_empty()
        });
    }
}

/// A limit per browser (`Who`), under a ceiling of `CEILING` times as much per client: the people
/// behind one shared address each get the limit, and made-up ids get no further than the ceiling.
struct PerBrowser {
    own: Windows<Who>,
    ceiling: Windows<IpAddr>,
}

impl PerBrowser {
    fn new(span: Duration) -> Self {
        Self {
            own: Windows::new(span),
            ceiling: Windows::new(span),
        }
    }

    fn spent(&mut self, who: Who, now: Instant, max: usize) -> bool {
        self.own.count(&who, now) >= max || self.ceiling.count(&who.client, now) >= max * CEILING
    }

    fn record(&mut self, who: Who, now: Instant) {
        self.own.record(who, now);
        self.ceiling.record(who.client, now);
    }

    fn allow(&mut self, who: Who, now: Instant, max: usize) -> bool {
        if self.spent(who, now, max) {
            return false;
        }
        self.record(who, now);
        true
    }

    fn sweep(&mut self, now: Instant) {
        self.own.sweep(now);
        self.ceiling.sweep(now);
    }
}

pub struct Connections {
    connected: HashSet<u64>,
    outbounds: HashMap<u64, Conn>,
    /// Which client each connection is (`admission::client_of`). The per-client limits below count
    /// by it, and the leaderboard and statistics tell players apart by it.
    ips: HashMap<u64, IpAddr>,
    /// The browser id each connection sent, if it sent one (see `admission::BrowserId`).
    browsers: HashMap<u64, BrowserId>,
    /// Wrong passwords per browser.
    password_failures: PerBrowser,
    /// Password checks per room.
    room_password_checks: Windows<String>,
    /// Password derivations started per browser.
    scrypt_windows: PerBrowser,
    lobby_requests: Windows<u64>,
    /// Database requests per browser, and how many a minute it may make.
    db_requests: PerBrowser,
    db_requests_per_minute: usize,
    spectator_windows: HashMap<u64, VecDeque<Instant>>,
    chat_windows: HashMap<u64, VecDeque<Instant>>,
    spectate_windows: HashMap<u64, VecDeque<Instant>>,
    /// What all the outbound queues may hold together.
    pool: OutboundPool,
}

impl Default for Connections {
    fn default() -> Self {
        Self {
            connected: HashSet::new(),
            outbounds: HashMap::new(),
            ips: HashMap::new(),
            browsers: HashMap::new(),
            password_failures: PerBrowser::new(PASSWORD_WINDOW),
            room_password_checks: Windows::new(ROOM_PASSWORD_WINDOW),
            scrypt_windows: PerBrowser::new(Duration::from_secs(1)),
            lobby_requests: Windows::new(LOBBY_WINDOW),
            db_requests: PerBrowser::new(DB_WINDOW),
            db_requests_per_minute: DEFAULT_DB_REQUESTS_PER_MINUTE,
            spectator_windows: HashMap::new(),
            chat_windows: HashMap::new(),
            spectate_windows: HashMap::new(),
            pool: OutboundPool::default(),
        }
    }
}

impl Connections {
    pub fn with_pool(pool: OutboundPool) -> Self {
        Self {
            pool,
            ..Self::default()
        }
    }

    pub fn open(
        &mut self,
        conn: u64,
        ip: IpAddr,
        tx: Outbound,
        slow: tokio::sync::watch::Sender<bool>,
    ) {
        self.connected.insert(conn);
        self.ips.insert(conn, ip);
        self.outbounds.insert(
            conn,
            Conn {
                tx,
                bytes: std::sync::Arc::new(tokio::sync::Semaphore::new(
                    crate::codec::OUTBOUND_BYTES,
                )),
                slow,
            },
        );
        info!(conn, "connection opened");
    }

    pub fn close(&mut self, conn: u64) {
        info!(conn, "connection closed");
        self.connected.remove(&conn);
        self.outbounds.remove(&conn);
        // The per-client counts outlive the connection: that is what they are for.
        self.lobby_requests.forget(&conn);
        self.spectator_windows.remove(&conn);
        self.chat_windows.remove(&conn);
        self.spectate_windows.remove(&conn);
        self.ips.remove(&conn);
        self.browsers.remove(&conn);
    }

    pub fn set_browser(&mut self, conn: u64, browser: BrowserId) {
        if self.connected.contains(&conn) {
            self.browsers.insert(conn, browser);
        }
    }

    /// Who a connection counts as for the abuse limits.
    pub fn who(&self, conn: u64) -> Option<Who> {
        Some(Who {
            client: self.peer_ip(conn)?,
            browser: self.browsers.get(&conn).copied(),
        })
    }

    pub fn is_connected(&self, conn: u64) -> bool {
        self.connected.contains(&conn)
    }

    pub fn connected(&self) -> impl Iterator<Item = u64> + '_ {
        self.connected.iter().copied()
    }

    /// Where a connection came from, so the board can tell one player from another.
    pub fn peer_ip(&self, conn: u64) -> Option<IpAddr> {
        self.ips.get(&conn).copied()
    }

    /// Prune expired password and scrypt timestamps without disturbing active lockouts.
    pub fn sweep(&mut self) {
        let now = Instant::now();
        self.scrypt_windows.sweep(now);
        self.password_failures.sweep(now);
        self.room_password_checks.sweep(now);
        self.lobby_requests.sweep(now);
        self.db_requests.sweep(now);
        self.spectator_windows.retain(|_, window| {
            window.retain(|at| now.duration_since(*at) < Duration::from_secs(1));
            !window.is_empty()
        });
        self.chat_windows.retain(|_, window| {
            window.retain(|at| now.duration_since(*at) < CHAT_WINDOW);
            !window.is_empty()
        });
        self.spectate_windows.retain(|_, window| {
            window.retain(|at| now.duration_since(*at) < SPECTATE_WINDOW);
            !window.is_empty()
        });
    }

    /// Counts one more walk into the stands; false when a connection keeps coming and going.
    pub fn allow_spectate_join(&mut self, conn: u64) -> bool {
        let now = Instant::now();
        let window = self.spectate_windows.entry(conn).or_default();
        while window
            .front()
            .is_some_and(|at| now.duration_since(*at) >= SPECTATE_WINDOW)
        {
            window.pop_front();
        }
        if window.len() >= MAX_SPECTATE_JOINS {
            return false;
        }
        window.push_back(now);
        true
    }

    /// Counts one more chat message from a connection; false when it is talking too much.
    pub fn allow_chat(&mut self, conn: u64) -> bool {
        let now = Instant::now();
        let window = self.chat_windows.entry(conn).or_default();
        while window
            .front()
            .is_some_and(|at| now.duration_since(*at) >= CHAT_WINDOW)
        {
            window.pop_front();
        }
        if window.len() >= MAX_CHAT_MESSAGES {
            return false;
        }
        window.push_back(now);
        true
    }

    /// Counts one more input from a spectator; false when they are sending too many.
    pub fn allow_spectator_input(&mut self, conn: u64) -> bool {
        let now = Instant::now();
        let window = self.spectator_windows.entry(conn).or_default();
        while window
            .front()
            .is_some_and(|at| now.duration_since(*at) >= Duration::from_secs(1))
        {
            window.pop_front();
        }
        if window.len() >= MAX_SPECTATOR_INPUTS_PER_SECOND {
            return false;
        }
        window.push_back(now);
        true
    }

    /// A spectator is gone from their room: their budget goes with them.
    pub fn forget_spectator(&mut self, conn: u64) {
        self.spectator_windows.remove(&conn);
    }

    /// Counts one more derivation for the connection's browser; false when it has started too many.
    pub fn scrypt_budget_available(&mut self, conn: u64) -> bool {
        let Some(who) = self.who(conn) else {
            return false;
        };
        self.scrypt_windows
            .allow(who, Instant::now(), MAX_SCRYPT_PER_SECOND)
    }

    pub fn password_attempts_exhausted(&mut self, conn: u64) -> bool {
        let Some(who) = self.who(conn) else {
            return true;
        };
        self.password_failures
            .spent(who, Instant::now(), MAX_PASSWORD_ATTEMPTS)
    }

    pub fn password_failed(&mut self, conn: u64) {
        if let Some(who) = self.who(conn) {
            self.password_failures.record(who, Instant::now());
        }
    }

    /// Counts one more password check against a room; false when the room has had its share.
    pub fn allow_room_password_check(&mut self, room_id: &str) -> bool {
        self.room_password_checks.allow(
            room_id.to_owned(),
            Instant::now(),
            MAX_ROOM_PASSWORD_CHECKS,
        )
    }

    /// Counts one more request for the room list; false when the connection keeps asking.
    pub fn allow_lobby_request(&mut self, conn: u64) -> bool {
        self.lobby_requests
            .allow(conn, Instant::now(), MAX_LOBBY_REQUESTS)
    }

    pub fn set_db_requests_per_minute(&mut self, requests: usize) {
        self.db_requests_per_minute = requests;
    }

    /// Counts one more database request for the connection's browser; false when it has made its share.
    pub fn allow_db_request(&mut self, conn: u64) -> bool {
        let Some(who) = self.who(conn) else {
            return false;
        };
        let limit = self.db_requests_per_minute;
        self.db_requests.allow(who, Instant::now(), limit)
    }

    pub fn send_value(&self, conn: u64, value: &Value) {
        let Ok(bytes) = rmp_serde::to_vec_named(value) else {
            return;
        };
        self.send_fast(conn, &Frame::from(bytes));
    }

    /// The fast path: an already-serialized frame that may be fanned out to several players. Every
    /// recipient shares the same bytes.
    pub fn send_fast(&self, conn: u64, bytes: &Frame) {
        let Some(out) = self.outbounds.get(&conn) else {
            return;
        };
        if bytes.len() > crate::codec::OUTBOUND_BYTES {
            let _ = out.slow.send(true);
            warn!(
                conn,
                "outbound frame exceeds byte budget; closing connection"
            );
            return;
        }
        let Some(permits) = self.pool.reserve(&out.bytes, bytes.len()) else {
            let _ = out.slow.send(true);
            warn!(conn, "outbound byte budget exhausted; closing connection");
            return;
        };
        if out
            .tx
            .try_send(WireMessage::Binary(bytes.clone(), Some(permits)))
            .is_err()
        {
            let _ = out.slow.send(true);
            warn!(
                conn,
                "outbound writer unavailable or queue full; closing connection"
            );
        }
    }

    pub fn error(&self, conn: u64, message: &str) {
        // An error about the name says so, so the client can show it under the name field and nowhere else.
        let value = if is_name_refusal(message) {
            json!({ "type": "error", "message": message, "field": "name" })
        } else if is_password_refusal(message) {
            json!({ "type": "error", "message": message, "field": "password" })
        } else {
            json!({ "type": "error", "message": message })
        };
        self.send_value(conn, &value);
    }
}
