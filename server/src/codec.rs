//! Wire encoding for the relay: every payload is plain JSON text. `WireMessage` is the unit
//! the writer task puts on the socket.

use tokio::sync::{mpsc, OwnedSemaphorePermit};

/// A message the relay wants on the wire, as the writer task will send it.
pub enum WireMessage {
    /// Plain JSON text (UTF-8).
    Text(String, Option<OwnedSemaphorePermit>),
    Ping(Vec<u8>),
    Pong(Vec<u8>),
    /// A policy close: a code plus a short reason (e.g. 1008 for the rate limit).
    CloseWith {
        code: u16,
        reason: &'static str,
    },
}

/// Turn already-serialized JSON into the frame for one recipient.
pub fn frame(text: &str, permit: Option<OwnedSemaphorePermit>) -> WireMessage {
    WireMessage::Text(text.to_owned(), permit)
}

/// The outbound half of one client connection: room logic sends into this, the writer drains it.
/// Bounded by both message count and a per-connection byte semaphore; exhausting either closes
/// the connection so no frame is silently dropped.
pub type Outbound = mpsc::Sender<WireMessage>;

/// Maximum number of queued messages per connection.
pub const OUTBOUND_QUEUE: usize = 128;
/// Maximum queued text payload per connection, including the frame in flight.
pub const OUTBOUND_BYTES: usize = 4 * 1024 * 1024;
