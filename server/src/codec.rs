//! Wire encoding for the relay: every payload is plain JSON text. `WireMessage` is the unit
//! the writer task puts on the socket.

use tokio::sync::mpsc;

/// A message the relay wants on the wire, as the writer task will send it.
#[derive(Clone)]
pub enum WireMessage {
    /// Plain JSON text (UTF-8).
    Text(String),
    Ping(Vec<u8>),
    Pong(Vec<u8>),
    /// A policy close: a code plus a short reason (e.g. 1008 for the rate limit).
    CloseWith { code: u16, reason: &'static str },
}

/// Turn already-serialized JSON into the frame for one recipient.
pub fn frame(text: &str) -> WireMessage {
    WireMessage::Text(text.to_owned())
}

/// The outbound half of one client connection: room logic sends into this, the writer drains it.
/// Bounded: a peer that stops reading gets flagged slow (see `Conn::slow`) and disconnected,
/// so a chatty room can never balloon one connection's queue into memory.
pub type Outbound = mpsc::Sender<WireMessage>;

/// Messages queued per connection before the peer counts as too slow.
pub const OUTBOUND_QUEUE: usize = 128;
