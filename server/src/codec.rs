//! Wire encoding for the relay: every payload is MessagePack in a binary WebSocket frame.
//! `WireMessage` is the unit the writer task puts on the socket.

use tokio::sync::{mpsc, OwnedSemaphorePermit};

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
