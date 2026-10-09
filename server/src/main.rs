//! The WebSocket relay, ported 1:1 from `server/index.ts`.
//!
//! Beyond the TypeScript original it also:
//! - negotiates the `slingshot-flate-v1` subprotocol and flate-compresses anything >= 10 KiB;
//! - caps concurrent connections and throttles fresh connections per IP, so it is not an easy
//!   flood target (the per-connection 300 msg/s limit was already in the original).

mod codec;
mod protocol;
mod room;

use std::collections::{HashMap, VecDeque};
use std::net::{IpAddr, SocketAddr};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use futures_util::{SinkExt, StreamExt};
use parking_lot::Mutex;
use serde_json::Value;
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::handshake::server::{ErrorResponse, Request, Response};
use tokio_tungstenite::tungstenite::http::header::HeaderValue;
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
use tokio_tungstenite::tungstenite::protocol::{CloseFrame, Message, WebSocketConfig};
use tokio_tungstenite::tungstenite::Error as WsError;
use tokio_tungstenite::{accept_hdr_async_with_config, WebSocketStream};
use tracing::{debug, error, info, instrument, warn, Instrument};

use crate::codec::{decompress, WireMessage, SUBPROTOCOL};
use crate::room::RoomManager;

const DEFAULT_PORT: u16 = 8080;
/// The host's full state can be large once; everything after that is small patches.
const MAX_PAYLOAD: usize = 1024 * 1024;
const MAX_MESSAGES_PER_SECOND: u32 = 300;
const HEARTBEAT_MS: u64 = 30_000;
/// Sized for ~1k concurrent rooms (6 players each) plus idle lobby browsers.
const DEFAULT_MAX_CONNECTIONS: usize = 8192;
const DEFAULT_MAX_CONNECTIONS_PER_IP: usize = 64;
const DEFAULT_CONNECTIONS_PER_IP_PER_SECOND: usize = 20;
/// A handshake that does not finish in time is dropped (slow-open probes hold a task otherwise).
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(10);

#[tokio::main]
async fn main() {
    use std::io::IsTerminal;
    tracing_subscriber::fmt()
        .with_ansi(std::io::stdout().is_terminal())
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let port = env_parse("PORT", DEFAULT_PORT);
    let max_connections = env_parse("MAX_CONNECTIONS", DEFAULT_MAX_CONNECTIONS);
    let max_per_ip = env_parse("MAX_CONNECTIONS_PER_IP", DEFAULT_MAX_CONNECTIONS_PER_IP);
    let per_ip_per_second = env_parse("CONNECTIONS_PER_IP_PER_SECOND", DEFAULT_CONNECTIONS_PER_IP_PER_SECOND);
    // Comma-separated allowlist of Origin header values (e.g. "https://game.example.com").
    // Empty (the default) skips the check — suitable only behind a proxy that strips Origin
    // or for non-browser deployments. Browsers always send Origin on cross-site WS
    // handshakes, so a configured allowlist blocks cross-site WebSocket hijacking.
    let allowed_origins: Vec<String> = std::env::var("ALLOWED_ORIGINS")
        .unwrap_or_default()
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();

    let listener = match TcpListener::bind(("0.0.0.0", port)).await {
        Ok(listener) => listener,
        Err(err) => {
            error!(%port, %err, "failed to bind");
            std::process::exit(1);
        }
    };
    info!(%port, "relay listening");

    let manager = Arc::new(Mutex::new(RoomManager::new()));
    let guard = Arc::new(AdmissionGuard::new(max_connections, max_per_ip, per_ip_per_second));
    let next_id = Arc::new(AtomicUsize::new(1));
    let mut sweep = tokio::time::interval(Duration::from_secs(60));
    sweep.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

    loop {
        tokio::select! {
            _ = sweep.tick() => guard.sweep(),
            accepted = listener.accept() => {
                let (stream, peer) = match accepted {
                    Ok(accepted) => accepted,
                    Err(err) => {
                        // Usually EMFILE: the process fd limit is below the connection cap. Don't
                        // spin hot while fd-starved. Deployments need `ulimit -n` ≥ MAX_CONNECTIONS.
                        error!(%err, "accept error");
                        tokio::time::sleep(Duration::from_millis(100)).await;
                        continue;
                    }
                };
                if !guard.try_admit(peer.ip()) {
                    warn!(%peer, "connection refused: at the connection limit");
                    drop(stream);
                    continue;
                }
                if let Err(err) = stream.set_nodelay(true) {
                    warn!(%peer, %err, "failed to enable TCP_NODELAY");
                }
                let manager = manager.clone();
                let guard = guard.clone();
                let next_id = next_id.clone();
                let allowed_origins = allowed_origins.clone();
                tokio::spawn(async move {
                    let conn_id = next_id.fetch_add(1, Ordering::Relaxed) as u64;
                    handle_connection(stream, peer, manager, guard, conn_id, &allowed_origins).await;
                });
            }
        }
    }
}

/// One TCP connection: handshake, then the inbound loop (rate limit + heartbeat) next to a writer
/// task that drains the room's outbound channel.
#[instrument(skip_all, fields(conn = conn_id, %peer))]
async fn handle_connection(
    stream: TcpStream,
    peer: SocketAddr,
    manager: Arc<Mutex<RoomManager>>,
    guard: Arc<AdmissionGuard>,
    conn_id: u64,
    allowed_origins: &[String],
) {
    let config = WebSocketConfig {
        max_message_size: Some(MAX_PAYLOAD),
        max_frame_size: Some(MAX_PAYLOAD),
        ..Default::default()
    };
    let handshake = tokio::time::timeout(
        HANDSHAKE_TIMEOUT,
        accept_with_negotiation(stream, Some(config), allowed_origins),
    )
    .await;
    let (ws, compressed) = match handshake {
        Ok(Ok(negotiated)) => negotiated,
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
    {
        let mut manager = manager.lock();
        manager.connect(conn_id, peer.ip(), tx.clone(), compressed);
    }
    // Tell the client that flate is understood before any large payload can fly; the client only
    // compresses its own sends after seeing this ack. (Text, so every client parses it.)
    let _ = tx.try_send(WireMessage::Text("{\"type\":\"capabilities\",\"compression\":\"flate\"}".to_string()));
    debug!(compressed, "connection opened");
    let connection = tracing::Span::current();
    let writer_task = tokio::spawn(writer_task(rx, writer).instrument(connection));

    let mut alive = true;
    let mut window_start = Instant::now();
    let mut window_count: u32 = 0;
    let mut heartbeat = tokio::time::interval(Duration::from_millis(HEARTBEAT_MS));
    heartbeat.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    heartbeat.tick().await; // like setInterval, the first expiry is a full interval away

    loop {
        tokio::select! {
            _ = heartbeat.tick() => {
                if !alive {
                    break; // no pong since the last ping — dead peer
                }
                if manager.lock().is_slow(conn_id) {
                    warn!("outbound queue full; dropping slow client");
                    break;
                }
                alive = false;
                let _ = tx.try_send(WireMessage::Ping(Vec::new()));
            }
            incoming = reader.next() => {
                let Some(frame) = incoming else { break };
                match frame {
                    Ok(message) => match &message {
                        Message::Pong(_) => alive = true,
                        Message::Ping(payload) => {
                            let _ = tx.try_send(WireMessage::Pong(payload.clone()));
                        }
                        Message::Close(_) => {
                            // tungstenite auto-replies to a peer close and drives the handshake;
                            // just tear down.
                            break;
                        }
                        Message::Text(_) | Message::Binary(_) => {
                            if !within_rate_limit(&mut window_start, &mut window_count) {
                                warn!("rate limit exceeded; closing with 1008");
                                drain_flood(&mut reader, &tx).await;
                                let _ = tx.try_send(WireMessage::CloseWith { code: 1008, reason: "Rate limit exceeded" });
                                break;
                            }
                            let decoded = match message {
                                Message::Text(text) => Some(text.into_bytes()),
                                Message::Binary(bytes) => {
                                    if !compressed {
                                        manager.lock().error(conn_id, "Only text JSON messages are accepted");
                                        None
                                    } else {
                                        match decompress(&bytes, MAX_PAYLOAD) {
                                            Ok(plain) => Some(plain),
                                            Err(()) => {
                                                manager.lock().error(conn_id, "Invalid JSON message");
                                                None
                                            }
                                        }
                                    }
                                }
                                _ => unreachable!(),
                            };
                            if let Some(bytes) = decoded {
                                deliver(&manager, conn_id, &bytes).await;
                            }
                        }
                        _ => {}
                    },
                    Err(_) => break,
                }
            }
        }
    }

    {
        let mut manager = manager.lock();
        manager.disconnect(conn_id);
    }
    guard.release(peer.ip());

    // Every exit path already sent a close (peer-close echo in the loop, the rate-limit frame),
    // so the writer just drains whatever is queued.
    drop(tx);
    let _ = tokio::time::timeout(Duration::from_millis(250), writer_task).await;
    info!("connection closed");
}

fn within_rate_limit(window_start: &mut Instant, window_count: &mut u32) -> bool {
    let now = Instant::now();
    if now.duration_since(*window_start) >= Duration::from_secs(1) {
        *window_start = now;
        *window_count = 0;
    }
    *window_count += 1;
    *window_count <= MAX_MESSAGES_PER_SECOND
}

/// Handshake with the compression subprotocol; reports what the client ended up with.
/// When `allowed_origins` is non-empty, handshakes whose `Origin` header is not in the list
/// are rejected with 403 before the upgrade completes.
async fn accept_with_negotiation<S>(
    stream: S,
    config: Option<WebSocketConfig>,
    allowed_origins: &[String],
) -> Result<(WebSocketStream<S>, bool), WsError>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    let negotiated = Arc::new(AtomicBool::new(false));
    let probe = negotiated.clone();
    let origins: Vec<String> = allowed_origins.to_vec();
    let ws = accept_hdr_async_with_config(
        stream,
        move |request: &Request, mut response: Response| {
            if !origins.is_empty() {
                let origin = request
                    .headers()
                    .get("origin")
                    .and_then(|value| value.to_str().ok())
                    .unwrap_or("");
                // No Origin header (non-browser client) passes; browsers always send one
                // on WS handshakes, so this check only bites cross-site pages.
                if !origin.is_empty() && !origins.iter().any(|o| o == origin) {
                    return Err(ErrorResponse::new(Some("403 Forbidden".to_string())));
                }
            }
            let offers = request
                .headers()
                .get("sec-websocket-protocol")
                .and_then(|value| value.to_str().ok())
                .unwrap_or("");
            if offers.split(',').any(|part| part.trim() == SUBPROTOCOL) {
                response
                    .headers_mut()
                    .insert("sec-websocket-protocol", HeaderValue::from_static(SUBPROTOCOL));
                probe.store(true, Ordering::Relaxed);
            }
            Ok::<Response, ErrorResponse>(response)
        },
        config,
    )
    .await?;
    Ok((ws, negotiated.load(Ordering::Relaxed)))
}

/// Parse one decoded inbound frame and pass it to the room logic.
async fn deliver(manager: &Mutex<RoomManager>, conn_id: u64, bytes: &[u8]) {
    let message = match serde_json::from_slice::<serde_json::Value>(bytes) {
        Ok(message) => message,
        Err(_) => {
            manager.lock().error(conn_id, "Invalid JSON message");
            return;
        }
    };
    let kind = message.get("type").and_then(Value::as_str).unwrap_or("?");
    debug!(bytes = bytes.len(), %kind, "inbound message");
    route(manager, conn_id, &message).await;
}

/// Dispatch a parsed message to the room logic. Password work is done off the room lock (and off
/// the async reactor) via `spawn_blocking`, so a scrypt can never stall every other connection.
async fn route(manager: &Mutex<RoomManager>, conn_id: u64, message: &Value) {
    let Some(ty) = message.get("type").and_then(Value::as_str) else {
        manager.lock().handle(conn_id, message);
        return;
    };
    match ty {
        "create_room" => {
            let prehashed = match crate::room::create_password_plaintext(message) {
                Some(plaintext) => {
                    if !manager.lock().scrypt_budget_available() {
                        manager.lock().error(conn_id, "Server busy – try again shortly");
                        return;
                    }
                    let plaintext = plaintext.to_owned();
                    Some(
                        tokio::task::spawn_blocking(move || crate::room::hash_password(&plaintext))
                            .await
                            .expect("scrypt task panicked"),
                    )
                }
                None => None,
            };
            manager.lock().create_room(conn_id, message, prehashed);
        }
        "join_room" => {
            let room_id = message.get("roomId").and_then(Value::as_str).unwrap_or("").to_owned();
            // Per-IP lockout check happens before any scrypt is spent on this attempt.
            if manager.lock().ip_password_locked_out(conn_id) {
                manager.lock().error(conn_id, "Too many wrong passwords – try again later");
                return;
            }
            let preverified = match crate::room::join_password_plaintext(message) {
                Some(plaintext) => {
                    if plaintext.len() > crate::room::MAX_PASSWORD_LENGTH {
                        // Never worth a scrypt; `password_attempt_ok` counts this as a miss.
                        Some(false)
                    } else {
                        let salt = manager.lock().join_password_salt(conn_id, &room_id);
                        match salt {
                            Some((salt, hash)) if manager.lock().scrypt_budget_available() => {
                                let plaintext = plaintext.to_owned();
                                Some(
                                    tokio::task::spawn_blocking(move || {
                                        crate::room::check_password(&plaintext, &salt, &hash)
                                    })
                                    .await
                                    .expect("scrypt task panicked"),
                                )
                            }
                            // Budget spent: count the attempt as a miss without paying for a
                            // derivation; the client sees "Wrong password".
                            _ => Some(false),
                        }
                    }
                }
                None => None,
            };
            manager.lock().join_room(conn_id, message, preverified);
        }
        _ => manager.lock().handle(conn_id, message),
    }
}

/// Consume a rate-limited peer's still-arriving flood while the connection is still ACTIVE
/// (tungstenite's server role refuses to read once the close frame flips it to Closing — reading
/// after that leaves the tail unread, and closing with unread data sends a RST that masks the
/// close code the peer should see). Stops once the stream has been quiet briefly or a hard cap
/// hits, whichever comes first.
async fn drain_flood(
    reader: &mut futures_util::stream::SplitStream<WebSocketStream<TcpStream>>,
    tx: &mpsc::Sender<WireMessage>,
) {
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

async fn writer_task(mut rx: mpsc::Receiver<WireMessage>, mut sink: SplitSink) {
    while let Some(frame) = rx.recv().await {
        let message = match frame {
            WireMessage::Text(text) => Message::Text(text),
            WireMessage::Binary(bytes) => Message::Binary(bytes),
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

// ————————————————————————————— Connection admission —————————————————————————————

struct IpState {
    count: usize,
    recent: VecDeque<Instant>,
}

/// Flood shields that sit in front of the room logic:
/// - a hard cap on concurrent connections;
/// - a cap on concurrent connections per IP;
/// - a sliding-window cap on fresh connections per second per IP.
struct AdmissionGuard {
    total: AtomicUsize,
    max_total: usize,
    per_ip: Mutex<HashMap<IpAddr, IpState>>,
    max_per_ip: usize,
    per_ip_per_second: usize,
}

impl AdmissionGuard {
    fn new(max_total: usize, max_per_ip: usize, per_ip_per_second: usize) -> Self {
        Self {
            total: AtomicUsize::new(0),
            max_total,
            per_ip: Mutex::new(HashMap::new()),
            max_per_ip,
            per_ip_per_second,
        }
    }

    fn try_admit(&self, ip: IpAddr) -> bool {
        if self.total.load(Ordering::Relaxed) >= self.max_total {
            return false;
        }
        let mut map = self.per_ip.lock();
        let now = Instant::now();
        let (count, recent_len) = match map.get_mut(&ip) {
            Some(state) => {
                state.recent.retain(|t| now.duration_since(*t) < Duration::from_secs(1));
                (state.count, state.recent.len())
            }
            None => (0, 0),
        };
        // Refused probes return here without ever inserting an entry, so a flood of
        // distinct source addresses cannot grow the map (every admitted connection is
        // removed again by `release`).
        if recent_len >= self.per_ip_per_second || count >= self.max_per_ip {
            return false;
        }
        let state = map.entry(ip).or_insert(IpState {
            count: 0,
            recent: VecDeque::new(),
        });
        state.recent.push_back(now);
        state.count += 1;
        self.total.fetch_add(1, Ordering::Relaxed);
        true
    }

    fn release(&self, ip: IpAddr) {
        self.total.fetch_sub(1, Ordering::Relaxed);
        let mut map = self.per_ip.lock();
        if let Some(state) = map.get_mut(&ip) {
            state.count = state.count.saturating_sub(1);
            let now = Instant::now();
            state.recent.retain(|t| now.duration_since(*t) < Duration::from_secs(1));
            if state.count == 0 && state.recent.is_empty() {
                map.remove(&ip);
            }
        }
    }
    /// Drop entries whose connections are all gone and whose recent-window is empty.
    /// Cheap safety net on top of `release`; called periodically from the accept loop.
    fn sweep(&self) {
        let mut map = self.per_ip.lock();
        let now = Instant::now();
        map.retain(|_, state| {
            state.recent.retain(|t| now.duration_since(*t) < Duration::from_secs(1));
            state.count > 0 || !state.recent.is_empty()
        });
    }
}

fn env_parse<T: std::str::FromStr>(name: &str, default: T) -> T {
    std::env::var(name)
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(default)
}

/// The split sink type the writer drains (kept concrete to stay out of the room logic).
type SplitSink = futures_util::stream::SplitSink<WebSocketStream<TcpStream>, Message>;
