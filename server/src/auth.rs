//! Room passwords. Hashing is scrypt and runs off the room lock and off the async reactor, behind
//! a small shared concurrency limit and a per-connection budget, so a flood of password checks
//! can never stall the connections that are only playing.

use std::sync::Arc;
use std::time::Duration;

use parking_lot::Mutex;
use rand::Rng;
use serde_json::Value;

use crate::room::RoomManager;

pub const MAX_PASSWORD_LENGTH: usize = 64;
/// Bound memory and CPU use even when many clients request password checks at once.
pub const MAX_CONCURRENT_SCRYPTS: usize = 4;
/// Password derivations can queue briefly behind the shared concurrency limit.
const SCRYPT_QUEUE_TIMEOUT: Duration = Duration::from_secs(1);

const BUSY: &str = "Server busy – try again shortly";

/// The shared limit on password derivations running at once. Cloning copies the handle.
#[derive(Clone)]
pub struct ScryptSlots(Arc<tokio::sync::Semaphore>);

impl ScryptSlots {
    pub fn new(slots: usize) -> Self {
        Self(Arc::new(tokio::sync::Semaphore::new(slots)))
    }

    /// A slot, or None when none frees up within the queue timeout.
    async fn acquire(&self) -> Option<tokio::sync::OwnedSemaphorePermit> {
        tokio::time::timeout(SCRYPT_QUEUE_TIMEOUT, self.0.clone().acquire_owned())
            .await
            .ok()?
            .ok()
    }

    #[cfg(test)]
    pub fn add_permits(&self, count: usize) {
        self.0.add_permits(count);
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
    message: &Value,
) -> Result<Option<Hashed>, Handled> {
    let Some(plaintext) = create_password_plaintext(message) else {
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
    message: &Value,
) -> Result<Option<bool>, Handled> {
    let Some(plaintext) = join_password_plaintext(message) else {
        return Ok(None);
    };
    if password_length(plaintext) > MAX_PASSWORD_LENGTH {
        // Never worth a scrypt; `password_attempt_ok` counts this as a miss.
        return Ok(Some(false));
    }
    if manager.lock().password_attempts_exhausted(conn) {
        manager
            .lock()
            .error(conn, "Too many wrong passwords – reconnect to try again");
        return Err(Handled);
    }
    let room_id = message
        .get("roomId")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_owned();
    let salt = manager.lock().join_password_salt(conn, &room_id);
    let Some((salt, hash)) = salt else {
        return Ok(None);
    };
    let plaintext = plaintext.to_owned();
    derive(manager, slots, conn, move || {
        check_password(&plaintext, &salt, &hash)
    })
    .await
    .map(Some)
}

/// Run a derivation on the blocking pool, within the connection's budget and the shared slots.
/// When either is spent the client is told the server is busy, and no password attempt is counted.
async fn derive<T: Send + 'static>(
    manager: &Mutex<RoomManager>,
    slots: &ScryptSlots,
    conn: u64,
    work: impl FnOnce() -> T + Send + 'static,
) -> Result<T, Handled> {
    if !manager.lock().scrypt_budget_available(conn) {
        manager.lock().error(conn, BUSY);
        return Err(Handled);
    }
    let Some(permit) = slots.acquire().await else {
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

pub fn create_password_plaintext(message: &Value) -> Option<&str> {
    message
        .get("password")
        .and_then(Value::as_str)
        .filter(|password| !password.is_empty() && password_length(password) <= MAX_PASSWORD_LENGTH)
}

pub fn join_password_plaintext(message: &Value) -> Option<&str> {
    message.get("password").and_then(Value::as_str)
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
