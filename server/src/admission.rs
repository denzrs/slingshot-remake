//! Flood shields that sit in front of the room logic: who may open a connection at all.

use std::collections::{HashMap, VecDeque};
use std::net::IpAddr;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, Instant};

use parking_lot::Mutex;

/// Who a connection counts as for every per-address limit: an IPv4 address as it is (also when the
/// dual-stack listener reports it IPv4-mapped), an IPv6 address by its /64. A single IPv6 host
/// usually holds a whole /64, so counting its addresses one by one would give it billions of
/// fresh starts; everyone behind one /64 shares, as everyone behind one IPv4 NAT already does.
pub fn client_of(ip: IpAddr) -> IpAddr {
    match ip {
        IpAddr::V4(_) => ip,
        IpAddr::V6(v6) => match v6.to_ipv4_mapped() {
            Some(v4) => IpAddr::V4(v4),
            None => {
                let network = u128::from(v6) & !((1u128 << 64) - 1);
                IpAddr::V6(network.into())
            }
        },
    }
}

/// A random id the game keeps in the browser and sends with every connection (`?b=`), so that
/// the people behind one shared address (a VPN, a carrier NAT) are told apart by the abuse limits.
///
/// It is used for that alone and lives in memory only, for as long as a limit's window: never
/// written to the database, never logged, never part of the statistics or the board. `Debug` does
/// not print it, so it cannot slip into a log line either.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub struct BrowserId([u8; 16]);

impl BrowserId {
    /// The id from a connection's query string, or None when there is none or it is not one.
    pub fn from_query(query: Option<&str>) -> Option<Self> {
        use base64::engine::general_purpose::URL_SAFE_NO_PAD;
        use base64::Engine as _;
        let value = query?.split('&').find_map(|pair| pair.strip_prefix("b="))?;
        if value.len() != 22 {
            return None;
        }
        let bytes = URL_SAFE_NO_PAD.decode(value).ok()?;
        Some(Self(bytes.try_into().ok()?))
    }

    #[cfg(test)]
    pub fn of(byte: u8) -> Self {
        Self([byte; 16])
    }
}

impl std::fmt::Debug for BrowserId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("BrowserId(..)")
    }
}

/// Who a request counts as for the abuse limits: a browser on a client, or the client alone when
/// the connection sent no id. Each limit counts per `Who`, under a ceiling per client (`CEILING`
/// times the limit), so a made-up id buys a few more tries at most and leaving it out buys nothing.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct Who {
    pub client: IpAddr,
    pub browser: Option<BrowserId>,
}

/// How many times a limit one client may use over all its browsers.
pub const CEILING: usize = 10;

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_browser_id_is_read_from_the_query_and_never_printed() {
        let id = BrowserId::from_query(Some("b=AAECAwQFBgcICQoLDA0ODw")).expect("an id");
        assert_eq!(
            id,
            BrowserId((0..16).collect::<Vec<u8>>().try_into().unwrap())
        );
        assert_eq!(
            BrowserId::from_query(Some("x=1&b=AAECAwQFBgcICQoLDA0ODw")),
            Some(id)
        );
        assert_eq!(BrowserId::from_query(None), None);
        assert_eq!(BrowserId::from_query(Some("b=short")), None);
        assert_eq!(
            BrowserId::from_query(Some("b=!!!!!!!!!!!!!!!!!!!!!!")),
            None
        );
        assert_eq!(format!("{id:?}"), "BrowserId(..)");
    }

    #[test]
    fn a_client_is_its_ipv4_address_or_its_ipv6_slash_64() {
        let v4: IpAddr = "203.0.113.7".parse().unwrap();
        assert_eq!(client_of(v4), v4);
        let mapped: IpAddr = "::ffff:203.0.113.7".parse().unwrap();
        assert_eq!(client_of(mapped), v4);
        let network: IpAddr = "2001:db8:1:2::".parse().unwrap();
        for address in ["2001:db8:1:2:aaaa:bbbb:cccc:dddd", "2001:db8:1:2::1"] {
            assert_eq!(client_of(address.parse().unwrap()), network);
        }
        let next: IpAddr = "2001:db8:1:3::1".parse().unwrap();
        assert_ne!(client_of(next), network);
    }

    #[test]
    fn addresses_of_one_slash_64_share_the_per_address_cap() {
        let guard = AdmissionGuard::new(100, 2, 100);
        let clients: Vec<IpAddr> = ["2001:db8::1", "2001:db8::2", "2001:db8::3"]
            .iter()
            .map(|address| client_of(address.parse().unwrap()))
            .collect();
        assert!(guard.try_admit(clients[0]));
        assert!(guard.try_admit(clients[1]));
        assert!(!guard.try_admit(clients[2]), "the /64 is at its cap");
    }
}
