//! Flood shields that sit in front of the room logic: who may open a connection at all.

use std::collections::{HashMap, VecDeque};
use std::net::IpAddr;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, Instant};

use parking_lot::Mutex;

struct IpState {
    count: usize,
    recent: VecDeque<Instant>,
}

/// Flood shields that sit in front of the room logic:
/// - a hard cap on concurrent connections;
/// - a cap on concurrent connections per IP;
/// - a sliding-window cap on fresh connections per second per IP.
pub struct AdmissionGuard {
    total: AtomicUsize,
    max_total: usize,
    per_ip: Mutex<HashMap<IpAddr, IpState>>,
    max_per_ip: usize,
    per_ip_per_second: usize,
}

impl AdmissionGuard {
    pub fn new(max_total: usize, max_per_ip: usize, per_ip_per_second: usize) -> Self {
        Self {
            total: AtomicUsize::new(0),
            max_total,
            per_ip: Mutex::new(HashMap::new()),
            max_per_ip,
            per_ip_per_second,
        }
    }

    pub fn try_admit(&self, ip: IpAddr) -> bool {
        if self.total.load(Ordering::Relaxed) >= self.max_total {
            return false;
        }
        let mut map = self.per_ip.lock();
        let now = Instant::now();
        let (count, recent_len) = match map.get_mut(&ip) {
            Some(state) => {
                state
                    .recent
                    .retain(|t| now.duration_since(*t) < Duration::from_secs(1));
                (state.count, state.recent.len())
            }
            None => (0, 0),
        };
        // Refused probes return here without ever inserting an entry, so a flood of
        // distinct source addresses cannot grow the map (every admitted connection is
        // removed again by `release`).
        if recent_len >= self.per_ip_per_second || count >= self.max_per_ip {
            return false;
        }
        let state = map.entry(ip).or_insert(IpState {
            count: 0,
            recent: VecDeque::new(),
        });
        state.recent.push_back(now);
        state.count += 1;
        self.total.fetch_add(1, Ordering::Relaxed);
        true
    }

    pub fn release(&self, ip: IpAddr) {
        self.total.fetch_sub(1, Ordering::Relaxed);
        let mut map = self.per_ip.lock();
        if let Some(state) = map.get_mut(&ip) {
            state.count = state.count.saturating_sub(1);
            let now = Instant::now();
            state
                .recent
                .retain(|t| now.duration_since(*t) < Duration::from_secs(1));
            if state.count == 0 && state.recent.is_empty() {
                map.remove(&ip);
            }
        }
    }
    /// Drop entries whose connections are all gone and whose recent-window is empty.
    /// Cheap safety net on top of `release`; called periodically from the accept loop.
    pub fn sweep(&self) {
        let mut map = self.per_ip.lock();
        let now = Instant::now();
        map.retain(|_, state| {
            state
                .recent
                .retain(|t| now.duration_since(*t) < Duration::from_secs(1));
            state.count > 0 || !state.recent.is_empty()
        });
    }
}
