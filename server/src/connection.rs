//! One client connection: handshake, the inbound loop (rate limit + heartbeat) and the writer task
//! that drains the room's outbound channel.

use std::net::SocketAddr;
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
    /// The origin allowlist the handshake enforces, and the per-connection message limit.
    pub allowed_origins: Arc<Vec<String>>,
    pub max_messages_per_second: u32,
}

/// One TCP connection: handshake, then the inbound loop (rate limit + heartbeat) next to a writer
/// task that drains the room's outbound channel.
#[instrument(skip_all, fields(conn = conn_id))]
pub async fn handle_connection<S>(stream: S, peer: SocketAddr, shared: Shared, conn_id: u64)
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
    } = shared;
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
            guard.release(peer.ip());
            return;
        }
        Err(_) => {
            warn!("websocket handshake timed out");
            guard.release(peer.ip());
            return;
        }
    };

    let (writer, mut reader) = ws.split();
    let (tx, rx) = mpsc::channel::<WireMessage>(crate::codec::OUTBOUND_QUEUE);
    let (slow_tx, mut slow_rx) = tokio::sync::watch::channel(false);
    {
        let mut manager = manager.lock();
        manager.connect(conn_id, peer.ip(), tx.clone(), slow_tx);
    }
    debug!("connection opened");
    let connection = tracing::Span::current();
    let writer_task = tokio::spawn(writer_task(rx, writer).instrument(connection));

    let mut missed: u32 = 0;
    let mut window_start = Instant::now();
    let mut window_count: u32 = 0;
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
                            if !within_rate_limit(&mut window_start, &mut window_count, max_messages_per_second) {
                                warn!("rate limit exceeded; closing with 1008");
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

    {
        let mut manager = manager.lock();
        manager.disconnect(conn_id);
    }
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
    guard.release(peer.ip());
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
                let result = sink.send(Message::Binary(bytes)).await;
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
