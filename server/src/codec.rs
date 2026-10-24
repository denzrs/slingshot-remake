//! Wire encoding for the relay: control messages use MessagePack and state updates use an opaque envelope.
//! `WireMessage` is the unit the writer task puts on the socket.

use std::sync::Arc;

use tokio::sync::{mpsc, OwnedSemaphorePermit, Semaphore};

pub const STATE_MAGIC: [u8; 4] = *b"SLNG";
pub const STATE_VERSION: u8 = 1;
pub const STATE_KIND: u8 = 1;
pub const STATE_HEADER_BYTES: usize = 14;

pub fn is_state_frame(bytes: &[u8]) -> bool {
    bytes.len() >= STATE_MAGIC.len() && bytes[..4] == STATE_MAGIC
}

/// A state frame contains the readable header followed by MessagePack `{patch, events}` bytes.
pub fn state_header(bytes: &[u8]) -> Option<(u64, &[u8])> {
    if bytes.len() <= STATE_HEADER_BYTES || bytes[..4] != STATE_MAGIC {
        return None;
    }
    if bytes[4] != STATE_VERSION || bytes[5] != STATE_KIND {
        return None;
    }
    let seq = u64::from_be_bytes(bytes[6..14].try_into().ok()?);
    Some((seq, &bytes[STATE_HEADER_BYTES..]))
}

#[cfg(test)]
pub fn state_frame(seq: u64, payload: &[u8]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(STATE_HEADER_BYTES + payload.len());
    bytes.extend_from_slice(&STATE_MAGIC);
    bytes.push(STATE_VERSION);
    bytes.push(STATE_KIND);
    bytes.extend_from_slice(&seq.to_be_bytes());
    bytes.extend_from_slice(payload);
    bytes
}

/// Encoded bytes on their way out. Shared, not copied, between every recipient of a fan-out: the
/// room lock only bumps a reference count, and the one copy a socket needs is made by its writer.
pub type Frame = Arc<[u8]>;

/// What a queued frame holds of the outbound byte budgets: its connection's and the relay's.
/// Dropped once the frame is on the socket, which hands both back.
pub struct Permits {
    _conn: OwnedSemaphorePermit,
    _total: OwnedSemaphorePermit,
}

/// The relay-wide outbound budget: what every connection's queue may hold together, so a crowd of
/// clients that stop reading cannot add their per-connection budgets up to more than the host has.
#[derive(Clone)]
pub struct OutboundPool(Arc<Semaphore>);

impl OutboundPool {
    pub fn new(bytes: usize) -> Self {
        Self(Arc::new(Semaphore::new(bytes)))
    }

    /// Take `bytes` from both budgets, or None (holding nothing) when either is spent.
    pub fn reserve(&self, conn: &Arc<Semaphore>, bytes: usize) -> Option<Permits> {
        let bytes = u32::try_from(bytes).ok()?;
        let conn = conn.clone().try_acquire_many_owned(bytes).ok()?;
        let total = self.0.clone().try_acquire_many_owned(bytes).ok()?;
        Some(Permits {
            _conn: conn,
            _total: total,
        })
    }

    #[cfg(test)]
    pub fn available(&self) -> usize {
        self.0.available_permits()
    }
}

impl Default for OutboundPool {
    fn default() -> Self {
        Self::new(DEFAULT_OUTBOUND_BYTES_TOTAL)
    }
}

/// A message the relay wants on the wire, as the writer task will send it.
pub enum WireMessage {
    /// MessagePack-encoded message, or a state envelope, with the budget it holds while queued.
    Binary(Frame, Option<Permits>),
    Ping(Vec<u8>),
    Pong(Vec<u8>),
    /// A policy close: a code plus a short reason (e.g. 1008 for the rate limit).
    CloseWith {
        code: u16,
        reason: &'static str,
    },
}

/// The outbound half of one client connection: room logic sends into this, the writer drains it.
/// Bounded by both message count and a per-connection byte semaphore; exhausting either closes
/// the connection so no frame is silently dropped.
pub type Outbound = mpsc::Sender<WireMessage>;

/// Maximum number of queued messages per connection.
pub const OUTBOUND_QUEUE: usize = 128;
/// Maximum queued binary payload per connection, including the frame in flight.
pub const OUTBOUND_BYTES: usize = 4 * 1024 * 1024;
/// Maximum queued binary payload of all connections together (`MAX_OUTBOUND_BYTES`). A frame
/// shared by many recipients counts once for each, so this errs on the safe side.
pub const DEFAULT_OUTBOUND_BYTES_TOTAL: usize = 512 * 1024 * 1024;

/// The largest message that is not a state envelope. The biggest real one, a long local game's
/// report, stays far below it; only the host's state may come near the frame limit.
pub const MAX_CONTROL_BYTES: usize = 256 * 1024;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn state_header_round_trips_sequence_and_leaves_payload_untouched() {
        let payload = [
            0x82, 0xa5, b'p', b'a', b't', b'c', b'h', 0x80, 0xa6, b'e', b'v', b'e', b'n', b't',
            b's', 0x90,
        ];
        let frame = state_frame(0x0102_0304_0506, &payload);
        assert!(is_state_frame(&frame));
        let (seq, forwarded_payload) = state_header(&frame).unwrap();
        assert_eq!(seq, 0x0102_0304_0506);
        assert_eq!(forwarded_payload, payload);
    }

    #[test]
    fn malformed_state_headers_are_not_parsed_as_envelopes() {
        assert!(!is_state_frame(b"SLN"));
        assert!(state_header(b"SLNG").is_none());

        let mut wrong_version = state_frame(1, &[0x80]);
        wrong_version[4] = STATE_VERSION + 1;
        assert!(is_state_frame(&wrong_version));
        assert!(state_header(&wrong_version).is_none());

        let mut wrong_kind = state_frame(1, &[0x80]);
        wrong_kind[5] = STATE_KIND + 1;
        assert!(state_header(&wrong_kind).is_none());
    }

    #[test]
    fn websocket_queues_have_both_message_and_byte_limits() {
        assert_eq!(crate::codec::OUTBOUND_QUEUE, 128);
        assert_eq!(crate::codec::OUTBOUND_BYTES, 4 * 1024 * 1024);
        let pool = std::sync::Arc::new(tokio::sync::Semaphore::new(crate::codec::OUTBOUND_BYTES));
        let held = pool
            .clone()
            .try_acquire_many_owned(3 * 1024 * 1024)
            .unwrap();
        assert!(pool
            .clone()
            .try_acquire_many_owned(2 * 1024 * 1024)
            .is_err());
        drop(held);
    }

    #[test]
    fn a_reservation_takes_from_both_budgets_and_holds_nothing_when_either_is_spent() {
        let total = OutboundPool::new(100);
        let conn = Arc::new(Semaphore::new(60));
        let held = total.reserve(&conn, 50).unwrap();
        assert_eq!((total.available(), conn.available_permits()), (50, 10));
        // The connection's budget is spent: nothing is taken from the relay's.
        assert!(total.reserve(&conn, 20).is_none());
        assert_eq!(total.available(), 50);
        // The relay's budget is spent: the connection's comes back.
        let other = Arc::new(Semaphore::new(100));
        assert!(total.reserve(&other, 60).is_none());
        assert_eq!(other.available_permits(), 100);
        drop(held);
        assert_eq!((total.available(), conn.available_permits()), (100, 60));
    }
}
