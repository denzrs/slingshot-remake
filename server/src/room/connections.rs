//! Who is connected: each connection's outbound queue and address, and the per-connection limits
//! on password attempts and scrypt work.

use std::collections::{HashMap, HashSet, VecDeque};
use std::net::IpAddr;
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tracing::{info, warn};

use crate::codec::{frame, Outbound};
use crate::protocol::{is_name_refusal, is_password_refusal};

pub const MAX_PASSWORD_ATTEMPTS: u32 = 5;
pub const MAX_SCRYPT_PER_SECOND: usize = 10;
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

#[derive(Default)]
pub struct Connections {
    connected: HashSet<u64>,
    outbounds: HashMap<u64, Conn>,
    /// Where each connection came from. The leaderboard is told apart by it; nothing else uses it.
    ips: HashMap<u64, IpAddr>,
    password_failures: HashMap<u64, u32>,
    scrypt_windows: HashMap<u64, VecDeque<Instant>>,
    spectator_windows: HashMap<u64, VecDeque<Instant>>,
    chat_windows: HashMap<u64, VecDeque<Instant>>,
    spectate_windows: HashMap<u64, VecDeque<Instant>>,
}

impl Connections {
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
        self.password_failures.remove(&conn);
        self.scrypt_windows.remove(&conn);
        self.spectator_windows.remove(&conn);
        self.chat_windows.remove(&conn);
        self.spectate_windows.remove(&conn);
        self.ips.remove(&conn);
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
        self.scrypt_windows.retain(|_, window| {
            window.retain(|at| now.duration_since(*at) < Duration::from_secs(1));
            !window.is_empty()
        });
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
        self.password_failures
            .retain(|conn, _| self.connected.contains(conn));
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

    pub fn scrypt_budget_available(&mut self, conn: u64) -> bool {
        let now = Instant::now();
        let window = self.scrypt_windows.entry(conn).or_default();
        while window
            .front()
            .is_some_and(|at| now.duration_since(*at) >= Duration::from_secs(1))
        {
            window.pop_front();
        }
        if window.len() >= MAX_SCRYPT_PER_SECOND {
            return false;
        }
        window.push_back(now);
        true
    }

    pub fn password_attempts_exhausted(&self, conn: u64) -> bool {
        self.password_failures.get(&conn).copied().unwrap_or(0) >= MAX_PASSWORD_ATTEMPTS
    }

    pub fn password_failed(&mut self, conn: u64) {
        *self.password_failures.entry(conn).or_insert(0) += 1;
    }

    pub fn send_value(&self, conn: u64, value: &Value) {
        let Ok(bytes) = rmp_serde::to_vec_named(value) else {
            return;
        };
        self.send_fast(conn, &bytes);
    }

    /// The fast path: an already-serialized MessagePack frame that may be fanned out to several players.
    pub fn send_fast(&self, conn: u64, bytes: &[u8]) {
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
        let permits = bytes.len();
        let Ok(permit) = out.bytes.clone().try_acquire_many_owned(permits as u32) else {
            let _ = out.slow.send(true);
            warn!(conn, "outbound byte budget exhausted; closing connection");
            return;
        };
        if out.tx.try_send(frame(bytes, Some(permit))).is_err() {
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
