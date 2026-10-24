//! One client connection: handshake, the inbound loop (rate limit + heartbeat) and the writer task
//! that drains the room's outbound channel.

use std::net::IpAddr;
use std::sync::Arc;
use std::time::{Duration, Instant};

use futures_util::{SinkExt, StreamExt};
use parking_lot::Mutex;
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::handshake::server::{ErrorResponse, Request, Response};
use tokio_tungstenite::tungstenite::http::StatusCode;
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
use tokio_tungstenite::tungstenite::protocol::{CloseFrame, Message, WebSocketConfig};
use tokio_tungstenite::tungstenite::Error as WsError;
use tokio_tungstenite::{accept_hdr_async_with_config, WebSocketStream};
use tracing::{debug, info, instrument, warn, Instrument};

use crate::admission::AdmissionGuard;
use crate::auth::ScryptSlots;
use crate::codec::WireMessage;
use crate::config::{HANDSHAKE_TIMEOUT, HEARTBEAT_MISSES, HEARTBEAT_MS, MAX_PAYLOAD};
use crate::leaderboard::Leaderboard;
use crate::room::RoomManager;
use crate::router::deliver;

/// What every connection task shares with the relay: handed over once when it is spawned, rather
/// than threaded through the accept loop as its own argument. Cloning it copies handles, not state.
#[derive(Clone)]
pub struct Shared {
    pub manager: Arc<Mutex<RoomManager>>,
    pub guard: Arc<AdmissionGuard>,
    pub boards: Arc<Leaderboard>,
    pub scrypt: ScryptSlots,
    /// The origin allowlist the handshake enforces, and the per-connection message and byte limits.
    pub allowed_origins: Arc<Vec<String>>,
    pub max_messages_per_second: u32,
    pub max_bytes_per_second: usize,
}

/// Whatever a connection holds of the relay, handed back however its task ends: the normal way out
/// of the loop, or a panic in a handler, which would otherwise leave a ghost in its room and its
/// address's admission slot taken for good.
struct Teardown {
    manager: Arc<Mutex<RoomManager>>,
    guard: Arc<AdmissionGuard>,
    client: IpAddr,
    conn_id: u64,
    /// Set once the room logic knows the connection, until it has been told it is gone.
    connected: bool,
}

impl Teardown {
    fn disconnect(&mut self) {
        if std::mem::take(&mut self.connected) {
            self.manager.lock().disconnect(self.conn_id);
        }
    }
}

impl Drop for Teardown {
    fn drop(&mut self) {
        if std::thread::panicking() {
            warn!("connection task panicked; cleaning up");
        }
        self.disconnect();
        self.guard.release(self.client);
    }
}

/// The inbound byte limit: a bucket that refills at `rate` bytes per second and holds enough for
/// the largest frame, so one full state frame always fits while a stream of them does not.
struct ByteBudget {
    rate: f64,
    capacity: f64,
    tokens: f64,
    last: Instant,
}

impl ByteBudget {
    fn new(rate: usize, now: Instant) -> Self {
        let capacity = rate.max(MAX_PAYLOAD) as f64;
        Self {
            rate: rate as f64,
            capacity,
            tokens: capacity,
            last: now,
        }
    }

    fn take(&mut self, bytes: usize, now: Instant) -> bool {
        let elapsed = now.duration_since(self.last).as_secs_f64();
        self.last = now;
        self.tokens = (self.tokens + elapsed * self.rate).min(self.capacity);
        if self.tokens < bytes as f64 {
            return false;
        }
        self.tokens -= bytes as f64;
        true
    }
}

/// One TCP connection: handshake, then the inbound loop (rate limit + heartbeat) next to a writer
/// task that drains the room's outbound channel.
#[instrument(skip_all, fields(conn = conn_id))]
pub async fn handle_connection<S>(stream: S, client: IpAddr, shared: Shared, conn_id: u64)
where
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    let Shared {
        manager,
        guard,
        boards,
        scrypt,
        allowed_origins,
        max_messages_per_second,
        max_bytes_per_second,
    } = shared;
    let mut teardown = Teardown {
        manager: manager.clone(),
        guard,
        client,
        conn_id,
        connected: false,
    };
    let config = WebSocketConfig {
        max_message_size: Some(MAX_PAYLOAD),
        max_frame_size: Some(MAX_PAYLOAD),
        ..Default::default()
    };
    let handshake = tokio::time::timeout(
        HANDSHAKE_TIMEOUT,
        accept_with_negotiation(stream, Some(config), &allowed_origins),
    )
    .await;
    let ws = match handshake {
        Ok(Ok(ws)) => ws,
        Ok(Err(error)) => {
            warn!(%error, "websocket handshake rejected");
            return;
        }
        Err(_) => {
            warn!("websocket handshake timed out");
            return;
        }
    };

    let (writer, mut reader) = ws.split();
    let (tx, rx) = mpsc::channel::<WireMessage>(crate::codec::OUTBOUND_QUEUE);
    let (slow_tx, mut slow_rx) = tokio::sync::watch::channel(false);
    {
        let mut manager = manager.lock();
        manager.connect(conn_id, client, tx.clone(), slow_tx);
    }
    teardown.connected = true;
    debug!("connection opened");
    let connection = tracing::Span::current();
    let writer_task = tokio::spawn(writer_task(rx, writer).instrument(connection));

    let mut missed: u32 = 0;
    let mut window_start = Instant::now();
    let mut window_count: u32 = 0;
    let mut inbound_bytes = ByteBudget::new(max_bytes_per_second, Instant::now());
    let mut heartbeat = tokio::time::interval(Duration::from_millis(HEARTBEAT_MS));
    heartbeat.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    heartbeat.tick().await; // like setInterval, the first expiry is a full interval away

    loop {
        tokio::select! {
            changed = slow_rx.changed() => {
                if changed.is_ok() && *slow_rx.borrow() {
                    warn!("outbound backlog limit exceeded; dropping slow client");
                    break;
                }
            }
            _ = heartbeat.tick() => {
                if missed >= HEARTBEAT_MISSES {
                    info!(missed, "no sign of life after the pings; dropping the peer");
                    break; // dead peer
                }
                missed += 1;
                let _ = tx.try_send(WireMessage::Ping(Vec::new()));
            }
            incoming = reader.next() => {
                let Some(frame) = incoming else { break };
                match frame {
                    Ok(message) => match &message {
                        // Any sign of life will do, not only the pong: on a busy link it may queue behind data.
                        Message::Pong(_) => missed = 0,
                        Message::Ping(payload) => {
                            let _ = tx.try_send(WireMessage::Pong(payload.clone()));
                        }
                        Message::Close(frame) => {
                            info!(?frame, "peer closed the connection");
                            // tungstenite auto-replies to a peer close and drives the handshake;
                            // just tear down.
                            break;
                        }
                        Message::Text(_) | Message::Binary(_) => {
                            missed = 0;
                            let limited = if !inbound_bytes.take(message.len(), Instant::now()) {
                                Some("byte rate")
                            } else if !within_rate_limit(&mut window_start, &mut window_count, max_messages_per_second) {
                                Some("message rate")
                            } else {
                                None
                            };
                            if let Some(limit) = limited {
                                warn!(limit, "rate limit exceeded; closing with 1008");
                                drain_flood(&mut reader, &tx).await;
                                let _ = tx.try_send(WireMessage::CloseWith { code: 1008, reason: "Rate limit exceeded" });
                                break;
                            }
                            match message {
                                Message::Binary(bytes) => deliver(&manager, &scrypt, &boards, conn_id, &bytes).await,
                                Message::Text(_) => manager.lock().error(conn_id, "Only binary MessagePack messages are accepted"),
                                _ => unreachable!(),
                            }
                        }
                        _ => {}
                    },
                    Err(err) => {
                        info!(%err, "connection read failed");
                        break;
                    }
                }
            }
        }
    }

    teardown.disconnect();
    // Every exit path already sent a close (peer-close echo in the loop, the rate-limit frame),
    // so the writer just drains whatever is queued.
    drop(tx);
    let mut writer_task = writer_task;
    if tokio::time::timeout(Duration::from_millis(250), &mut writer_task)
        .await
        .is_err()
    {
        writer_task.abort();
        let _ = writer_task.await;
    }
    drop(teardown);
    info!("connection closed");
}

fn within_rate_limit(window_start: &mut Instant, window_count: &mut u32, limit: u32) -> bool {
    let now = Instant::now();
    if now.duration_since(*window_start) >= Duration::from_secs(1) {
        *window_start = now;
        *window_count = 0;
    }
    *window_count += 1;
    *window_count <= limit
}

/// Handshake with optional origin enforcement. When `allowed_origins` is non-empty,
/// handshakes whose `Origin` header is not in the list are rejected with 403 before the
/// upgrade completes.
#[allow(clippy::result_large_err)]
async fn accept_with_negotiation<S>(
    stream: S,
    config: Option<WebSocketConfig>,
    allowed_origins: &[String],
) -> Result<WebSocketStream<S>, WsError>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    let origins: Vec<String> = allowed_origins.to_vec();
    let ws = accept_hdr_async_with_config(
        stream,
        move |request: &Request, response: Response| {
            if !origins.is_empty() {
                let origin = request
                    .headers()
                    .get("origin")
                    .and_then(|value| value.to_str().ok())
                    .unwrap_or("");
                // A missing Origin also fails: otherwise any script simply omits the header
                // and walks past the allowlist. Strict mode is the point of configuring one.
                if !origins.iter().any(|o| o == origin) {
                    // ErrorResponse::new defaults to 200 OK, which tungstenite refuses to
                    // send ("custom response must not be successful") — build a real 403.
                    let mut forbidden = ErrorResponse::new(Some("Forbidden".to_string()));
                    *forbidden.status_mut() = StatusCode::FORBIDDEN;
                    return Err(forbidden);
                }
            }
            Ok::<Response, ErrorResponse>(response)
        },
        config,
    )
    .await?;
    Ok(ws)
}

/// Consume a rate-limited peer's still-arriving flood while the connection is still ACTIVE
/// (tungstenite's server role refuses to read once the close frame flips it to Closing — reading
/// after that leaves the tail unread, and closing with unread data sends a RST that masks the
/// close code the peer should see). Stops once the stream has been quiet briefly or a hard cap
/// hits, whichever comes first.
async fn drain_flood<S>(
    reader: &mut futures_util::stream::SplitStream<WebSocketStream<S>>,
    tx: &mpsc::Sender<WireMessage>,
) where
    S: AsyncRead + AsyncWrite + Unpin,
{
    let quiet_window = Duration::from_millis(100);
    let hard_cap = Instant::now() + Duration::from_millis(500);
    let mut quiet_until = Instant::now() + quiet_window;
    loop {
        if Instant::now() >= hard_cap {
            break;
        }
        tokio::select! {
            frame = reader.next() => match frame {
                Some(Ok(Message::Ping(payload))) => {
                    let _ = tx.try_send(WireMessage::Pong(payload));
                }
                Some(Ok(Message::Close(_))) | Some(Err(_)) | None => break,
                Some(Ok(_)) => quiet_until = Instant::now() + quiet_window,
            },
            _ = tokio::time::sleep_until(tokio::time::Instant::from_std(quiet_until)) => break,
        }
    }
}

async fn writer_task<S: AsyncRead + AsyncWrite + Unpin>(
    mut rx: mpsc::Receiver<WireMessage>,
    mut sink: SplitSink<S>,
) {
    while let Some(frame) = rx.recv().await {
        let message = match frame {
            WireMessage::Binary(bytes, permit) => {
                // The socket's own copy, made here rather than under the room lock.
                let result = sink.send(Message::Binary(bytes.to_vec())).await;
                drop(permit);
                if result.is_err() {
                    break;
                }
                continue;
            }
            WireMessage::Ping(payload) => Message::Ping(payload),
            WireMessage::Pong(payload) => Message::Pong(payload),
            WireMessage::CloseWith { code, reason } => Message::Close(Some(CloseFrame {
                code: CloseCode::from(code),
                reason: reason.to_string().into(),
            })),
        };
        if sink.send(message).await.is_err() {
            break;
        }
    }
    let _ = sink.close().await;
}

/// The split sink type the writer drains (kept concrete to stay out of the room logic).
type SplitSink<S> = futures_util::stream::SplitSink<WebSocketStream<S>, Message>;

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::Ipv4Addr;

    #[test]
    fn the_byte_budget_lets_one_full_frame_through_but_not_a_stream_of_them() {
        let start = Instant::now();
        let mut budget = ByteBudget::new(1000, start);
        assert!(budget.take(MAX_PAYLOAD, start));
        assert!(!budget.take(2000, start));
        // Two seconds refill what two seconds allow, and no more.
        let later = start + Duration::from_secs(2);
        assert!(budget.take(2000, later));
        assert!(!budget.take(1, later));
    }

    #[test]
    fn a_panicking_connection_still_leaves_its_room_and_hands_back_its_slot() {
        let manager = Arc::new(Mutex::new(RoomManager::new()));
        let guard = Arc::new(AdmissionGuard::new(10, 1, 10));
        let client = IpAddr::V4(Ipv4Addr::LOCALHOST);
        assert!(guard.try_admit(client));
        let (tx, _rx) = mpsc::channel(crate::codec::OUTBOUND_QUEUE);
        let (slow, _) = tokio::sync::watch::channel(false);
        manager.lock().connect(7, client, tx, slow);

        let (task_manager, task_guard) = (manager.clone(), guard.clone());
        let panicked = std::thread::spawn(move || {
            let _teardown = Teardown {
                manager: task_manager,
                guard: task_guard,
                client,
                conn_id: 7,
                connected: true,
            };
            panic!("a handler bug");
        })
        .join();
        assert!(panicked.is_err());
        assert!(
            manager.lock().peer_ip(7).is_none(),
            "the connection is gone"
        );
        assert!(guard.try_admit(client), "its admission slot is free again");
    }
}
