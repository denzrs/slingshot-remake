//! Telling players apart without knowing who they are: a player is the hash of their address and
//! the day, keyed per process, so no address is ever written down. A restart (a deploy) forgets the
//! key, and with it who was who.
//!
//! Every store gets a key of its own. Sharing one would let a row that carries a name (the daily
//! board) be matched to a row that must not (the match statistics) by the hash they have in common.

use std::collections::hash_map::RandomState;
use std::hash::{BuildHasher, Hash, Hasher};
use std::net::IpAddr;

#[derive(Default)]
pub struct Pseudonyms {
    key: RandomState,
}

impl Pseudonyms {
    pub fn new() -> Self {
        Self::default()
    }

    /// Who this address is on this day: 16 hex digits.
    pub fn player(&self, day: impl Hash, ip: IpAddr) -> String {
        let mut hasher = self.key.build_hasher();
        day.hash(&mut hasher);
        ip.hash(&mut hasher);
        format!("{:016x}", hasher.finish())
    }
}
