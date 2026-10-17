//! Wire encoding for the relay: control messages use MessagePack and state updates use an opaque envelope.
//! `WireMessage` is the unit the writer task puts on the socket.

use tokio::sync::{mpsc, OwnedSemaphorePermit};

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

pub fn state_frame(seq: u64, payload: &[u8]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(STATE_HEADER_BYTES + payload.len());
    bytes.extend_from_slice(&STATE_MAGIC);
    bytes.push(STATE_VERSION);
    bytes.push(STATE_KIND);
    bytes.extend_from_slice(&seq.to_be_bytes());
    bytes.extend_from_slice(payload);
    bytes
}

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
}

/// A message the relay wants on the wire, as the writer task will send it.
pub enum WireMessage {
    /// MessagePack-encoded message.
    Binary(Vec<u8>, Option<OwnedSemaphorePermit>),
    Ping(Vec<u8>),
    Pong(Vec<u8>),
    /// A policy close: a code plus a short reason (e.g. 1008 for the rate limit).
    CloseWith {
        code: u16,
        reason: &'static str,
    },
}

/// Turn already-serialized MessagePack into the frame for one recipient.
pub fn frame(bytes: &[u8], permit: Option<OwnedSemaphorePermit>) -> WireMessage {
    WireMessage::Binary(bytes.to_owned(), permit)
}

/// The outbound half of one client connection: room logic sends into this, the writer drains it.
/// Bounded by both message count and a per-connection byte semaphore; exhausting either closes
/// the connection so no frame is silently dropped.
pub type Outbound = mpsc::Sender<WireMessage>;

/// Maximum number of queued messages per connection.
pub const OUTBOUND_QUEUE: usize = 128;
/// Maximum queued binary payload per connection, including the frame in flight.
pub const OUTBOUND_BYTES: usize = 4 * 1024 * 1024;
