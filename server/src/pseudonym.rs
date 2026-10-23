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

/// Telling the people in the match statistics apart for as long as the statistics are kept: a
/// player is a keyed hash of their address and the name they play under, so the same person is the
/// same player on every day and after every restart, and two people behind one address are two
/// players. The key is a random salt that the database keeps (see `stats`), so the hash cannot be
/// worked out from a list of addresses and names without it. Not the board's key: the board's
/// rows carry a name, and sharing a hash with it would tie that name to these rows.
pub struct Identities {
    salt: Vec<u8>,
}

impl Identities {
    pub fn new(salt: Vec<u8>) -> Self {
        Self { salt }
    }

    /// A fresh salt: 32 random bytes.
    pub fn new_salt() -> Vec<u8> {
        use rand::Rng;
        rand::thread_rng().gen::<[u8; 32]>().to_vec()
    }

    /// Who this name is at this address: 16 hex digits.
    pub fn player(&self, ip: IpAddr, name: &str) -> String {
        use hmac::{Hmac, Mac};
        let mut mac =
            Hmac::<sha2::Sha256>::new_from_slice(&self.salt).expect("HMAC takes a key of any size");
        mac.update(ip.to_string().as_bytes());
        // The address holds no NUL, so where it ends and the name begins is never in doubt.
        mac.update(&[0]);
        mac.update(name.as_bytes());
        mac.finalize().into_bytes()[..8]
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect()
    }
}
