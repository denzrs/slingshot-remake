//! Room passwords. Hashing is scrypt and runs off the room lock and off the async reactor, behind
//! a small shared concurrency limit (one slot per client at most) and a per-client budget, so a flood of password checks
//! can never stall the connections that are only playing.

use std::collections::HashSet;
use std::net::IpAddr;
use std::sync::Arc;
use std::time::Duration;

use parking_lot::Mutex;
use rand::Rng;

use crate::command::{CreateRoom, JoinRoom};
use crate::room::RoomManager;

pub const MAX_PASSWORD_LENGTH: usize = 64;
/// Bound memory and CPU use even when many clients request password checks at once.
pub const MAX_CONCURRENT_SCRYPTS: usize = 4;
/// Password derivations can queue briefly behind the shared concurrency limit.
const SCRYPT_QUEUE_TIMEOUT: Duration = Duration::from_secs(1);

const BUSY: &str = "Server busy – try again shortly";
pub const PASSWORDS_EXHAUSTED: &str = "Too many wrong passwords – try again in a few minutes";
const ROOM_BUSY: &str = "Too many password attempts on this room – try again shortly";

/// The shared limit on password derivations running at once, of which one client holds at most one,
/// so a single client cannot keep everybody else's passwords waiting. Cloning copies the handle.
#[derive(Clone)]
pub struct ScryptSlots {
    total: Arc<tokio::sync::Semaphore>,
    running: Arc<Mutex<HashSet<IpAddr>>>,
}

/// A running derivation's hold on a shared slot and on its client's one.
struct Slot {
    _permit: tokio::sync::OwnedSemaphorePermit,
    _client: ClientSlot,
}

/// The client's one derivation; handed back when dropped.
struct ClientSlot {
    running: Arc<Mutex<HashSet<IpAddr>>>,
    client: IpAddr,
}

impl Drop for ClientSlot {
    fn drop(&mut self) {
        self.running.lock().remove(&self.client);
    }
}

impl ScryptSlots {
    pub fn new(slots: usize) -> Self {
        Self {
            total: Arc::new(tokio::sync::Semaphore::new(slots)),
            running: Arc::new(Mutex::new(HashSet::new())),
        }
    }

    /// A slot, or None when the client already runs a derivation or none frees up within the queue
    /// timeout.
    async fn acquire(&self, client: IpAddr) -> Option<Slot> {
        if !self.running.lock().insert(client) {
            return None;
        }
        // Held from here, so every way out below hands the client's slot back.
        let client = ClientSlot {
            running: self.running.clone(),
            client,
        };
        let permit = tokio::time::timeout(SCRYPT_QUEUE_TIMEOUT, self.total.clone().acquire_owned())
            .await
            .ok()?
            .ok()?;
        Some(Slot {
            _permit: permit,
            _client: client,
        })
    }

    #[cfg(test)]
    pub fn add_permits(&self, count: usize) {
        self.total.add_permits(count);
    }
}

/// The client has already been told why this message goes no further.
pub struct Handled;

/// A salt and the password hash derived with it.
pub type Hashed = (Vec<u8>, Vec<u8>);

/// Hash the password a `create_room` carries, if it carries one. `Ok(None)` means no password to
/// hash (the room is open, or the message is invalid and the room logic will say so).
pub async fn prepare_create(
    manager: &Mutex<RoomManager>,
    slots: &ScryptSlots,
    conn: u64,
    create: &CreateRoom,
) -> Result<Option<Hashed>, Handled> {
    let Some(plaintext) = create.password_plaintext() else {
        return Ok(None);
    };
    let plaintext = plaintext.to_owned();
    derive(manager, slots, conn, move || hash_password(&plaintext))
        .await
        .map(Some)
}

/// Check the password a `join_room` carries against the room's. `Ok(None)` means there is nothing
/// to verify (no password sent, or no lockable room), which the room logic judges on its own;
/// `Ok(Some(ok))` is the verdict.
pub async fn prepare_join(
    manager: &Mutex<RoomManager>,
    slots: &ScryptSlots,
    conn: u64,
    join: &JoinRoom,
) -> Result<Option<bool>, Handled> {
    let Some(plaintext) = join.password.as_deref() else {
        return Ok(None);
    };
    if password_length(plaintext) > MAX_PASSWORD_LENGTH {
        // Never worth a scrypt; `password_attempt_ok` counts this as a miss.
        return Ok(Some(false));
    }
    let salt = {
        let mut manager = manager.lock();
        if manager.password_attempts_exhausted(conn) {
            manager.error(conn, PASSWORDS_EXHAUSTED);
            return Err(Handled);
        }
        let Some(salt) = manager.join_password_salt(conn, join.room_id(), join.spectate) else {
            return Ok(None);
        };
        // A room's share of checks is spent: like a busy server, this is no miss of the client's.
        if !manager.allow_room_password_check(join.room_id()) {
            manager.error(conn, ROOM_BUSY);
            return Err(Handled);
        }
        salt
    };
    let (salt, hash) = salt;
    let plaintext = plaintext.to_owned();
    derive(manager, slots, conn, move || {
        check_password(&plaintext, &salt, &hash)
    })
    .await
    .map(Some)
}

/// Run a derivation on the blocking pool, within the client's budget and the shared slots.
/// When either is spent the client is told the server is busy, and no password attempt is counted.
async fn derive<T: Send + 'static>(
    manager: &Mutex<RoomManager>,
    slots: &ScryptSlots,
    conn: u64,
    work: impl FnOnce() -> T + Send + 'static,
) -> Result<T, Handled> {
    let client = {
        let mut manager = manager.lock();
        match manager.peer_ip(conn) {
            Some(client) if manager.scrypt_budget_available(conn) => client,
            _ => {
                manager.error(conn, BUSY);
                return Err(Handled);
            }
        }
    };
    let Some(permit) = slots.acquire(client).await else {
        manager.lock().error(conn, BUSY);
        return Err(Handled);
    };
    Ok(tokio::task::spawn_blocking(move || {
        let _permit = permit;
        work()
    })
    .await
    .expect("scrypt task panicked"))
}

pub fn password_length(password: &str) -> usize {
    password.encode_utf16().count()
}

pub fn hash_password(password: &str) -> (Vec<u8>, Vec<u8>) {
    let mut salt = [0u8; 16];
    rand::thread_rng().fill(&mut salt);
    let mut hash = vec![0u8; 32];
    scrypt::scrypt(
        password.as_bytes(),
        &salt,
        &scrypt::Params::new(14, 8, 1, 32).unwrap(),
        &mut hash,
    )
    .expect("scrypt derivation");
    (salt.to_vec(), hash)
}

pub fn check_password(password: &str, salt: &[u8], expected: &[u8]) -> bool {
    let mut actual = vec![0u8; expected.len()];
    if scrypt::scrypt(
        password.as_bytes(),
        salt,
        &scrypt::Params::new(14, 8, 1, 32).unwrap(),
        &mut actual,
    )
    .is_err()
    {
        return false;
    }
    timing_safe_eq(&actual, expected)
}

fn timing_safe_eq(left: &[u8], right: &[u8]) -> bool {
    let mut difference = (left.len() ^ right.len()) as u8;
    let max_len = left.len().max(right.len());
    for index in 0..max_len {
        difference |=
            left.get(index).copied().unwrap_or(0) ^ right.get(index).copied().unwrap_or(0);
    }
    difference == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn one_client_holds_one_slot_however_many_are_free() {
        let slots = ScryptSlots::new(MAX_CONCURRENT_SCRYPTS);
        let a: IpAddr = "198.51.100.9".parse().unwrap();
        let b: IpAddr = "203.0.113.4".parse().unwrap();
        let first = slots.acquire(a).await.expect("a free slot");
        assert!(
            slots.acquire(a).await.is_none(),
            "the client already runs one"
        );
        let other = slots
            .acquire(b)
            .await
            .expect("somebody else still gets one");
        drop(first);
        assert!(
            slots.acquire(a).await.is_some(),
            "the client's slot came back"
        );
        drop(other);
    }

    #[tokio::test]
    async fn a_client_waiting_in_vain_for_a_shared_slot_gets_its_own_back() {
        let slots = ScryptSlots::new(0);
        let a: IpAddr = "198.51.100.9".parse().unwrap();
        assert!(slots.acquire(a).await.is_none());
        slots.add_permits(1);
        assert!(slots.acquire(a).await.is_some());
    }
}
