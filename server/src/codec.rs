//! Wire encoding for the relay: JSON text by default, flate (RFC 1950 zlib) when a payload is
//! larger than 10 KiB and the peer negotiated the compression subprotocol. The compression is
//! transparent to the room logic — `WireMessage` is the unit the writer task puts on the socket.

use flate2::read::ZlibDecoder;
use flate2::write::ZlibEncoder;
use flate2::Compression;
use std::io::{Read, Write};
use tokio::sync::mpsc;

/// The subprotocol the frontend offers; the relay selects it when a payload may be compressed.
pub const SUBPROTOCOL: &str = "slingshot-flate-v1";

/// Serialized payloads at or below this size go out as plain text; anything larger is flate.
pub const COMPRESS_THRESHOLD: usize = 10 * 1024;

/// A message the relay wants on the wire, as the writer task will send it.
#[derive(Clone)]
pub enum WireMessage {
    /// Plain JSON text (UTF-8). The default for every small payload.
    Text(String),
    /// Flate-compressed JSON, only ever sent to a peer that negotiated `SUBPROTOCOL`.
    Binary(Vec<u8>),
    Ping(Vec<u8>),
    Pong(Vec<u8>),
    /// A policy close: a code plus a short reason (e.g. 1008 for the rate limit).
    CloseWith { code: u16, reason: &'static str },
}

/// Turn already-serialized JSON into the frame for one recipient.
pub fn frame(text: &str, compressed: bool) -> WireMessage {
    if compressed && text.len() > COMPRESS_THRESHOLD {
        WireMessage::Binary(compress(text.as_bytes()))
    } else {
        WireMessage::Text(text.to_owned())
    }
}

fn compress(data: &[u8]) -> Vec<u8> {
    let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());
    // Forwarding a socket message; the source is a valid JSON string we just built.
    encoder.write_all(data).expect("write into in-memory encoder");
    encoder.finish().expect("finish in-memory encoder")
}

/// Inflate a received frame back into JSON text. Fails on bad data or an oversized result.
pub fn decompress(data: &[u8], limit: usize) -> Result<Vec<u8>, ()> {
    let mut decoder = ZlibDecoder::new(data);
    let mut out = Vec::new();
    // Cap the output so a small frame cannot balloon into gigabytes of memory.
    let mut chunk = [0u8; 8192];
    loop {
        let read = decoder.read(&mut chunk).map_err(|_| ())?;
        if read == 0 {
            break;
        }
        if out.len() + read > limit {
            return Err(());
        }
        out.extend_from_slice(&chunk[..read]);
    }
    Ok(out)
}

/// The outbound half of one client connection: room logic sends into this, the writer drains it.
/// Bounded: a peer that stops reading gets flagged slow (see `Conn::slow`) and disconnected,
/// so a chatty room can never balloon one connection's queue into memory.
pub type Outbound = mpsc::Sender<WireMessage>;

/// Messages queued per connection before the peer counts as too slow.
pub const OUTBOUND_QUEUE: usize = 128;
