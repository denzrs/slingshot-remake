//! Limits, defaults and environment helpers shared by the relay's modules.

use std::time::Duration;

pub const DEFAULT_PORT: u16 = 8080;
/// The host's full state can be large once; everything after that is small patches.
pub const MAX_PAYLOAD: usize = 1024 * 1024;
pub const MAX_MESSAGES_PER_SECOND: u32 = 300;
/// Inbound bytes per second one connection may send (`MAX_BYTES_PER_SECOND`). A real host streams
/// well under 1 MB/s at 30 Hz; the bucket also always holds one full `MAX_PAYLOAD` frame.
pub const MAX_BYTES_PER_SECOND: usize = 2 * 1024 * 1024;
pub const HEARTBEAT_MS: u64 = 10_000;
/// Pings in a row that may go unanswered before a peer counts as dead. A proxy that stalls for a
/// moment should not cost a player the game.
pub const HEARTBEAT_MISSES: u32 = 3;
/// Sized for ~1k concurrent rooms (6 players each) plus idle lobby browsers.
pub const DEFAULT_MAX_CONNECTIONS: usize = 8192;
pub const DEFAULT_MAX_CONNECTIONS_PER_IP: usize = 64;
pub const DEFAULT_CONNECTIONS_PER_IP_PER_SECOND: usize = 20;
/// A handshake that does not finish in time is dropped (slow-open probes hold a task otherwise).
pub const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(10);

pub fn env_parse<T: std::str::FromStr>(name: &str, default: T) -> T {
    std::env::var(name)
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(default)
}

pub fn env_flag(name: &str) -> bool {
    std::env::var(name).is_ok_and(|v| v == "1" || v.eq_ignore_ascii_case("true"))
}
