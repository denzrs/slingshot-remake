//! The WebSocket relay for online games.
//!
//! It also caps concurrent connections and throttles fresh connections per IP, alongside the
//! per-connection 300 msg/s limit.

mod codec;
mod leaderboard;
mod protocol;
mod room;

use std::collections::{HashMap, VecDeque};
use std::net::{IpAddr, SocketAddr};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use futures_util::{SinkExt, StreamExt};
use parking_lot::Mutex;
use serde_json::Value;
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::net::TcpListener;
use tokio::sync::mpsc;
use tokio_rustls::rustls::pki_types::{CertificateDer, PrivateKeyDer};
use tokio_rustls::rustls::ServerConfig;
use tokio_rustls::TlsAcceptor;
use tokio_tungstenite::tungstenite::handshake::server::{ErrorResponse, Request, Response};
use tokio_tungstenite::tungstenite::http::StatusCode;
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
use tokio_tungstenite::tungstenite::protocol::{CloseFrame, Message, WebSocketConfig};
use tokio_tungstenite::tungstenite::Error as WsError;
use tokio_tungstenite::{accept_hdr_async_with_config, WebSocketStream};
use tracing::{debug, error, info, instrument, warn, Instrument};

use crate::codec::WireMessage;
use crate::leaderboard::{Leaderboard, DEFAULT_KEEP_DAYS};
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
/// Bound memory and CPU use even when many clients request password checks at once.
const MAX_CONCURRENT_SCRYPTS: usize = 4;
/// Password derivations can queue briefly behind the shared concurrency limit.
const SCRYPT_QUEUE_TIMEOUT: Duration = Duration::from_secs(1);
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
    let per_ip_per_second = env_parse(
        "CONNECTIONS_PER_IP_PER_SECOND",
        DEFAULT_CONNECTIONS_PER_IP_PER_SECOND,
    );
    let max_messages_per_second = env_parse("MAX_MESSAGES_PER_SECOND", MAX_MESSAGES_PER_SECOND);
    // Comma-separated allowlist of Origin header values (e.g. "https://game.example.com"),
    // required unless ALLOW_ALL_ORIGINS=1. Browsers always send Origin on WS handshakes,
    // so the allowlist blocks cross-site WebSocket hijacking; handshakes with no Origin
    // header are rejected too, so scripts cannot bypass the check by omitting it.
    let default_origins = if env_flag("DEV_SERVER") {
        "http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174,http://localhost:4173,http://127.0.0.1:4173"
            .to_string()
    } else {
        String::new()
    };
    let allowed_origins: Vec<String> = std::env::var("ALLOWED_ORIGINS")
        .unwrap_or(default_origins)
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    // Fail closed: without an allowlist every cross-site page may open a WebSocket from a
    // victim's browser (WS handshakes are not same-origin protected). The explicit opt-out
    // is for LAN/dev deployments that know browsers never reach the relay.
    if allowed_origins.is_empty() && !env_flag("ALLOW_ALL_ORIGINS") {
        error!("ALLOWED_ORIGINS is not set; refusing to start (set ALLOW_ALL_ORIGINS=1 for an open relay)");
        std::process::exit(1);
    }
    if allowed_origins.is_empty() {
        warn!("no origin allowlist — cross-site browser connections are NOT restricted");
    } else {
        info!(origins = ?allowed_origins, "origin allowlist active");
    }

    // TLS_CERT/TLS_KEY: PEM certificate chain and private key. They must be set together.
    let tls = match (std::env::var("TLS_CERT"), std::env::var("TLS_KEY")) {
        (Ok(cert), Ok(key)) => Some(load_tls(&cert, &key)),
        (Err(_), Err(_)) => {
            warn!("TLS_CERT/TLS_KEY not set — serving plaintext ws; room passwords travel unencrypted");
            None
        }
        _ => {
            error!("TLS_CERT and TLS_KEY must either both be set or both be unset");
            std::process::exit(1);
        }
    };

    // LEADERBOARD_DB: the daily-challenge board's file. It sits beside the binary and the
    // environment file, which a deploy never replaces — only the binary is flipped.
    let db_path = std::env::var("LEADERBOARD_DB").unwrap_or_else(|_| "leaderboard.db".to_string());
    let keep_days = env_parse("LEADERBOARD_KEEP_DAYS", DEFAULT_KEEP_DAYS);
    // A board that cannot be opened is a deployment mistake (a bad path, a read-only directory);
    // the relay refusing to start says so, where serving on without one would not.
    let boards = match Leaderboard::open(&db_path, keep_days).await {
        Ok(boards) => Arc::new(boards),
        Err(err) => {
            error!(%db_path, %err, "failed to open the leaderboard");
            std::process::exit(1);
        }
    };
    info!(%db_path, keep_days, "leaderboard open");

    let listener = match TcpListener::bind(("::", port)).await {
        Ok(listener) => listener,
        Err(err) => {
            error!(%port, %err, "failed to bind");
            std::process::exit(1);
        }
    };
    info!(%port, "relay listening");

    let manager = Arc::new(Mutex::new(RoomManager::new()));
    let guard = Arc::new(AdmissionGuard::new(
        max_connections,
        max_per_ip,
        per_ip_per_second,
    ));
    let next_id = Arc::new(AtomicUsize::new(1));
    let shared = Arc::new(Shared {
        manager,
        guard,
        boards,
        allowed_origins: Arc::new(allowed_origins),
        max_messages_per_second,
    });
    let mut sweep = tokio::time::interval(Duration::from_secs(60));
    sweep.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

    loop {
        tokio::select! {
            _ = sweep.tick() => {
                shared.guard.sweep();
                shared.manager.lock().sweep();
                shared.boards.prune_if_due().await;
            }
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
                if !shared.guard.try_admit(peer.ip()) {
                    warn!("connection refused: at the connection limit");
                    drop(stream);
                    continue;
                }
                if let Err(err) = stream.set_nodelay(true) {
                    warn!(%err, "failed to enable TCP_NODELAY");
                }
                let shared = shared.clone();
                let next_id = next_id.clone();
                let tls = tls.clone();
                tokio::spawn(async move {
                    let conn_id = next_id.fetch_add(1, Ordering::Relaxed) as u64;
                    match tls {
                        Some(acceptor) => {
                            let accepted = tokio::time::timeout(HANDSHAKE_TIMEOUT, acceptor.accept(stream)).await;
                            match accepted {
                                Ok(Ok(tls_stream)) => {
                                    handle_connection(tls_stream, peer, shared.as_ref().clone(), conn_id).await;
                                }
                                Ok(Err(err)) => {
                                    warn!(%err, "TLS handshake failed");
                                    shared.guard.release(peer.ip());
                                }
                                Err(_) => {
                                    warn!("TLS handshake timed out");
                                    shared.guard.release(peer.ip());
                                }
                            }
                        }
                        None => {
                            handle_connection(stream, peer, shared.as_ref().clone(), conn_id).await;
                        }
                    }
                });
            }
        }
    }
}

/// What every connection task shares with the relay: handed over once when it is spawned, rather
/// than threaded through the accept loop as its own argument. Cloning it copies handles, not state.
#[derive(Clone)]
struct Shared {
    manager: Arc<Mutex<RoomManager>>,
    guard: Arc<AdmissionGuard>,
    boards: Arc<Leaderboard>,
    /// The origin allowlist the handshake enforces, and the per-connection message limit.
    allowed_origins: Arc<Vec<String>>,
    max_messages_per_second: u32,
}

/// One TCP connection: handshake, then the inbound loop (rate limit + heartbeat) next to a writer
/// task that drains the room's outbound channel.
#[instrument(skip_all, fields(conn = conn_id))]
async fn handle_connection<S>(stream: S, peer: SocketAddr, shared: Shared, conn_id: u64)
where
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    let Shared {
        manager,
        guard,
        boards,
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

    let mut alive = true;
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
                if !alive {
                    break; // no pong since the last ping — dead peer
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
                            if !within_rate_limit(&mut window_start, &mut window_count, max_messages_per_second) {
                                warn!("rate limit exceeded; closing with 1008");
                                drain_flood(&mut reader, &tx).await;
                                let _ = tx.try_send(WireMessage::CloseWith { code: 1008, reason: "Rate limit exceeded" });
                                break;
                            }
                            match message {
                                Message::Binary(bytes) => deliver(&manager, &guard.scrypt_slots, &boards, conn_id, &bytes).await,
                                Message::Text(_) => manager.lock().error(conn_id, "Only binary MessagePack messages are accepted"),
                                _ => unreachable!(),
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

/// Parse one decoded inbound frame and pass it to the room logic.
async fn deliver(
    manager: &Mutex<RoomManager>,
    scrypt_slots: &Arc<tokio::sync::Semaphore>,
    boards: &Leaderboard,
    conn_id: u64,
    bytes: &[u8],
) {
    if crate::codec::is_state_frame(bytes) {
        let Some((seq, _payload)) = crate::codec::state_header(bytes) else {
            manager.lock().error(conn_id, "Invalid state envelope");
            return;
        };
        // The room checks sender, status, and sequence before relaying the original frame.
        debug!(bytes = bytes.len(), kind = "state", "inbound message");
        manager.lock().handle_state_envelope(conn_id, seq, bytes);
        return;
    }
    let message = match rmp_serde::from_slice::<serde_json::Value>(bytes) {
        Ok(message) => message,
        Err(_) => {
            manager.lock().error(conn_id, "Invalid MessagePack message");
            return;
        }
    };
    let kind = message.get("type").and_then(Value::as_str).unwrap_or("?");
    debug!(bytes = bytes.len(), %kind, "inbound message");
    route(manager, scrypt_slots, boards, conn_id, &message).await;
}

/// Dispatch a parsed message to the room logic. Password work is done off the room lock (and off
/// the async reactor) via `spawn_blocking`, so a scrypt can never stall every other connection.
/// The daily board is awaited here too: it is reached from this task, never from the room lock.
async fn route(
    manager: &Mutex<RoomManager>,
    scrypt_slots: &Arc<tokio::sync::Semaphore>,
    boards: &Leaderboard,
    conn_id: u64,
    message: &Value,
) {
    let Some(ty) = message.get("type").and_then(Value::as_str) else {
        manager.lock().handle(conn_id, message);
        return;
    };
    match ty {
        "create_room" => {
            let can_create = manager.lock().can_create_room(conn_id);
            if !can_create || !crate::room::valid_create_room_message(message) {
                manager.lock().handle(conn_id, message);
                return;
            }
            let prehashed = match crate::room::create_password_plaintext(message) {
                Some(plaintext) => {
                    if !manager.lock().scrypt_budget_available(conn_id) {
                        manager
                            .lock()
                            .error(conn_id, "Server busy – try again shortly");
                        return;
                    }
                    let Some(permit) = acquire_scrypt_slot(scrypt_slots).await else {
                        manager
                            .lock()
                            .error(conn_id, "Server busy – try again shortly");
                        return;
                    };
                    let plaintext = plaintext.to_owned();
                    Some(
                        tokio::task::spawn_blocking(move || {
                            let _permit = permit;
                            crate::room::hash_password(&plaintext)
                        })
                        .await
                        .expect("scrypt task panicked"),
                    )
                }
                None => None,
            };
            manager.lock().create_room(conn_id, message, prehashed);
        }
        "join_room" => {
            if !crate::room::valid_join_room_message(message) {
                manager.lock().handle(conn_id, message);
                return;
            }
            let room_id = message
                .get("roomId")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_owned();
            let preverified = match crate::room::join_password_plaintext(message) {
                Some(plaintext) => {
                    if crate::room::password_length(plaintext) > crate::room::MAX_PASSWORD_LENGTH {
                        // Never worth a scrypt; `password_attempt_ok` counts this as a miss.
                        Some(false)
                    } else {
                        if manager.lock().password_attempts_exhausted(conn_id) {
                            manager.lock().error(
                                conn_id,
                                "Too many wrong passwords – reconnect to try again",
                            );
                            return;
                        }
                        let salt = manager.lock().join_password_salt(conn_id, &room_id);
                        match salt {
                            Some((salt, hash))
                                if manager.lock().scrypt_budget_available(conn_id) =>
                            {
                                let Some(permit) = acquire_scrypt_slot(scrypt_slots).await else {
                                    manager
                                        .lock()
                                        .error(conn_id, "Server busy – try again shortly");
                                    return;
                                };
                                let plaintext = plaintext.to_owned();
                                Some(
                                    tokio::task::spawn_blocking(move || {
                                        let _permit = permit;
                                        crate::room::check_password(&plaintext, &salt, &hash)
                                    })
                                    .await
                                    .expect("scrypt task panicked"),
                                )
                            }
                            Some(_) => {
                                manager
                                    .lock()
                                    .error(conn_id, "Server busy – try again shortly");
                                return;
                            }
                            None => None,
                        }
                    }
                }
                None => None,
            };
            manager.lock().join_room(conn_id, message, preverified);
        }
        "daily_submit" => {
            let Some(ip) = manager.lock().peer_ip(conn_id) else {
                return;
            };
            let Some(run) = crate::protocol::parse_daily_submit(message) else {
                manager.lock().error(conn_id, "Invalid daily run");
                return;
            };
            // The board is the one place a name is kept and shown to everyone, so it is the one
            // place worth refusing one.
            if !crate::protocol::is_acceptable_name(&run.name) {
                manager.lock().error(conn_id, "That name is not allowed");
                return;
            }
            match boards.submit(&run.day, &run.name, run.score, ip).await {
                Ok(board) => manager.lock().daily_board(conn_id, &run.day, &board),
                Err(err) => {
                    warn!(%err, "leaderboard write failed");
                    manager
                        .lock()
                        .error(conn_id, "The leaderboard is unavailable");
                }
            }
        }
        "daily_top" => {
            let Some(ip) = manager.lock().peer_ip(conn_id) else {
                return;
            };
            let Some(day) = crate::protocol::parse_daily_day(message) else {
                manager.lock().error(conn_id, "Invalid day");
                return;
            };
            match boards.board(&day, ip).await {
                Ok(board) => manager.lock().daily_board(conn_id, &day, &board),
                Err(err) => {
                    warn!(%err, "leaderboard read failed");
                    manager
                        .lock()
                        .error(conn_id, "The leaderboard is unavailable");
                }
            }
        }
        _ => manager.lock().handle(conn_id, message),
    }
}

async fn acquire_scrypt_slot(
    slots: &Arc<tokio::sync::Semaphore>,
) -> Option<tokio::sync::OwnedSemaphorePermit> {
    tokio::time::timeout(SCRYPT_QUEUE_TIMEOUT, slots.clone().acquire_owned())
        .await
        .ok()?
        .ok()
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
    scrypt_slots: Arc<tokio::sync::Semaphore>,
}

impl AdmissionGuard {
    fn new(max_total: usize, max_per_ip: usize, per_ip_per_second: usize) -> Self {
        Self {
            total: AtomicUsize::new(0),
            max_total,
            per_ip: Mutex::new(HashMap::new()),
            max_per_ip,
            per_ip_per_second,
            scrypt_slots: Arc::new(tokio::sync::Semaphore::new(MAX_CONCURRENT_SCRYPTS)),
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
                state
                    .recent
                    .retain(|t| now.duration_since(*t) < Duration::from_secs(1));
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
            state
                .recent
                .retain(|t| now.duration_since(*t) < Duration::from_secs(1));
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
            state
                .recent
                .retain(|t| now.duration_since(*t) < Duration::from_secs(1));
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
type SplitSink<S> = futures_util::stream::SplitSink<WebSocketStream<S>, Message>;

fn env_flag(name: &str) -> bool {
    std::env::var(name).is_ok_and(|v| v == "1" || v.eq_ignore_ascii_case("true"))
}

/// Load a PEM certificate chain and private key into a TLS acceptor, or die trying —
/// a half-configured TLS deployment must fail loudly at boot, not at 3 a.m.
fn load_tls(cert_path: &str, key_path: &str) -> TlsAcceptor {
    let cert_file = std::fs::File::open(cert_path).unwrap_or_else(|err| {
        error!(%cert_path, %err, "cannot open TLS_CERT");
        std::process::exit(1);
    });
    let certs: Vec<CertificateDer<'static>> =
        rustls_pemfile::certs(&mut std::io::BufReader::new(cert_file))
            .collect::<Result<_, _>>()
            .unwrap_or_else(|err| {
                error!(%cert_path, %err, "cannot parse TLS_CERT");
                std::process::exit(1);
            });
    if certs.is_empty() {
        error!(%cert_path, "TLS_CERT contains no certificates");
        std::process::exit(1);
    }
    let key_file = std::fs::File::open(key_path).unwrap_or_else(|err| {
        error!(%key_path, %err, "cannot open TLS_KEY");
        std::process::exit(1);
    });
    let key: PrivateKeyDer<'static> =
        rustls_pemfile::private_key(&mut std::io::BufReader::new(key_file))
            .unwrap_or_else(|err| {
                error!(%key_path, %err, "cannot parse TLS_KEY");
                std::process::exit(1);
            })
            .unwrap_or_else(|| {
                error!(%key_path, "TLS_KEY contains no private key");
                std::process::exit(1);
            });
    let config = ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(certs, key)
        .unwrap_or_else(|err| {
            error!(%err, "TLS certificate/key do not match or are unusable");
            std::process::exit(1);
        });
    TlsAcceptor::from(Arc::new(config))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::{IpAddr, Ipv4Addr};
    use tokio::sync::mpsc;

    async fn take_type(rx: &mut mpsc::Receiver<WireMessage>, kind: &str) -> Value {
        loop {
            let Some(WireMessage::Binary(bytes, _permit)) = rx.recv().await else {
                panic!("outbound channel closed before {kind}");
            };
            let message: Value = rmp_serde::from_slice(&bytes).unwrap();
            if message["type"] == kind {
                return message;
            }
        }
    }

    #[test]
    fn websocket_queues_have_both_message_and_byte_limits() {
        assert_eq!(crate::codec::OUTBOUND_QUEUE, 128);
        assert_eq!(crate::codec::OUTBOUND_BYTES, 4 * 1024 * 1024);
        let pool = Arc::new(tokio::sync::Semaphore::new(crate::codec::OUTBOUND_BYTES));
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

    #[tokio::test]
    async fn password_create_and_join_use_real_scrypt_hashing() {
        let manager = Mutex::new(RoomManager::new());
        let scrypt_slots = Arc::new(tokio::sync::Semaphore::new(MAX_CONCURRENT_SCRYPTS));
        let boards = Leaderboard::in_memory().await;
        let (host_tx, mut host_rx) = mpsc::channel(crate::codec::OUTBOUND_QUEUE);
        let (host_slow, _) = tokio::sync::watch::channel(false);
        manager
            .lock()
            .connect(1, IpAddr::V4(Ipv4Addr::LOCALHOST), host_tx, host_slow);
        let _ = take_type(&mut host_rx, "lobby_update").await;
        let create = serde_json::json!({
            "type":"create_room","name":"Host","mode":"ffa","gameMode":"classic",
            "maxPlayers":4,"password":"secret"
        });
        route(&manager, &scrypt_slots, &boards, 1, &create).await;
        let room_id = take_type(&mut host_rx, "room_update").await["room"]["id"]
            .as_str()
            .unwrap()
            .to_owned();

        let (guest_tx, mut guest_rx) = mpsc::channel(crate::codec::OUTBOUND_QUEUE);
        let (guest_slow, _) = tokio::sync::watch::channel(false);
        manager
            .lock()
            .connect(2, IpAddr::V4(Ipv4Addr::LOCALHOST), guest_tx, guest_slow);
        let _ = take_type(&mut guest_rx, "lobby_update").await;
        let bad = serde_json::json!({"type":"join_room","roomId":room_id,"name":"Guest","password":"wrong"});
        route(&manager, &scrypt_slots, &boards, 2, &bad).await;
        assert_eq!(
            take_type(&mut guest_rx, "error").await["message"],
            "Wrong password"
        );
        let good = serde_json::json!({"type":"join_room","roomId":room_id,"name":"Guest","password":"secret"});
        route(&manager, &scrypt_slots, &boards, 2, &good).await;
        assert_eq!(
            take_type(&mut guest_rx, "room_update").await["room"]["players"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
    }

    #[tokio::test]
    async fn exhausted_password_attempts_are_rejected_before_hashing() {
        let manager = Mutex::new(RoomManager::new());
        let scrypt_slots = Arc::new(tokio::sync::Semaphore::new(0));
        let boards = Leaderboard::in_memory().await;
        let (host_tx, mut host_rx) = mpsc::channel(crate::codec::OUTBOUND_QUEUE);
        let (host_slow, _) = tokio::sync::watch::channel(false);
        manager
            .lock()
            .connect(1, IpAddr::V4(Ipv4Addr::LOCALHOST), host_tx, host_slow);
        let _ = take_type(&mut host_rx, "lobby_update").await;
        let create = serde_json::json!({
            "type":"create_room","name":"Host","mode":"ffa","gameMode":"classic",
            "maxPlayers":4,"password":"secret"
        });
        manager
            .lock()
            .create_room(1, &create, Some((vec![1; 16], vec![2; 32])));
        let room_id = take_type(&mut host_rx, "room_update").await["room"]["id"]
            .as_str()
            .unwrap()
            .to_owned();

        let (guest_tx, mut guest_rx) = mpsc::channel(crate::codec::OUTBOUND_QUEUE);
        let (guest_slow, _) = tokio::sync::watch::channel(false);
        manager
            .lock()
            .connect(2, IpAddr::V4(Ipv4Addr::LOCALHOST), guest_tx, guest_slow);
        let _ = take_type(&mut guest_rx, "lobby_update").await;

        // Establish five failures. The exhausted attempt must not wait on the unavailable
        // derivation permit (nor consume a per-connection scrypt budget).
        for _ in 0..5 {
            manager.lock().join_room(
                2,
                &serde_json::json!({
                    "type":"join_room","roomId":room_id,"name":"Guest","password":"wrong"
                }),
                Some(false),
            );
            assert_eq!(
                take_type(&mut guest_rx, "error").await["message"],
                "Wrong password"
            );
        }
        let attempt = serde_json::json!({
            "type":"join_room","roomId":room_id,"name":"Guest","password":"secret"
        });
        route(&manager, &scrypt_slots, &boards, 2, &attempt).await;
        assert_eq!(
            take_type(&mut guest_rx, "error").await["message"],
            "Too many wrong passwords – reconnect to try again"
        );
    }

    #[tokio::test]
    async fn queued_scrypt_timeout_is_busy_and_does_not_count_as_a_password_miss() {
        let manager = Mutex::new(RoomManager::new());
        let scrypt_slots = Arc::new(tokio::sync::Semaphore::new(0));
        let boards = Leaderboard::in_memory().await;
        let (host_tx, mut host_rx) = mpsc::channel(crate::codec::OUTBOUND_QUEUE);
        let (host_slow, _) = tokio::sync::watch::channel(false);
        manager
            .lock()
            .connect(1, IpAddr::V4(Ipv4Addr::LOCALHOST), host_tx, host_slow);
        let _ = take_type(&mut host_rx, "lobby_update").await;
        let create = serde_json::json!({
            "type":"create_room","name":"Host","mode":"ffa","gameMode":"classic",
            "maxPlayers":4,"password":"secret"
        });
        manager
            .lock()
            .create_room(1, &create, Some((vec![1; 16], vec![2; 32])));
        let room_id = take_type(&mut host_rx, "room_update").await["room"]["id"]
            .as_str()
            .unwrap()
            .to_owned();

        let (guest_tx, mut guest_rx) = mpsc::channel(crate::codec::OUTBOUND_QUEUE);
        let (guest_slow, _) = tokio::sync::watch::channel(false);
        manager
            .lock()
            .connect(2, IpAddr::V4(Ipv4Addr::LOCALHOST), guest_tx, guest_slow);
        let _ = take_type(&mut guest_rx, "lobby_update").await;
        let attempt = serde_json::json!({
            "type":"join_room","roomId":room_id,"name":"Guest","password":"wrong"
        });

        route(&manager, &scrypt_slots, &boards, 2, &attempt).await;
        assert_eq!(
            take_type(&mut guest_rx, "error").await["message"],
            "Server busy – try again shortly"
        );

        // Once capacity is available, the same incorrect password is still the first miss.
        scrypt_slots.add_permits(1);
        route(&manager, &scrypt_slots, &boards, 2, &attempt).await;
        assert_eq!(
            take_type(&mut guest_rx, "error").await["message"],
            "Wrong password"
        );
    }

    #[tokio::test]
    async fn a_daily_run_reaches_the_board_and_a_refused_name_comes_back_with_a_reason() {
        let manager = Mutex::new(RoomManager::new());
        let scrypt_slots = Arc::new(tokio::sync::Semaphore::new(MAX_CONCURRENT_SCRYPTS));
        let boards = Leaderboard::in_memory().await;
        let (tx, mut rx) = mpsc::channel(crate::codec::OUTBOUND_QUEUE);
        let (slow, _) = tokio::sync::watch::channel(false);
        manager
            .lock()
            .connect(1, IpAddr::V4(Ipv4Addr::LOCALHOST), tx, slow);
        let _ = take_type(&mut rx, "lobby_update").await;

        route(
            &manager,
            &scrypt_slots,
            &boards,
            1,
            &serde_json::json!({"type":"daily_submit","day":"2026-10-19","name":"Ada","score":4200}),
        )
        .await;
        let board = take_type(&mut rx, "daily_board").await;
        assert_eq!(board["day"], "2026-10-19");
        assert_eq!(
            board["entries"],
            serde_json::json!([{"rank":1,"name":"Ada","score":4200}])
        );
        assert_eq!(
            board["you"],
            serde_json::json!({"rank":1,"name":"Ada","score":4200}),
            "the poster is told where their run landed"
        );

        // A name the board will not carry comes back with words the player can act on.
        route(
            &manager,
            &scrypt_slots,
            &boards,
            1,
            &serde_json::json!({"type":"daily_submit","day":"2026-10-19","name":"fuck","score":9000}),
        )
        .await;
        assert_eq!(
            take_type(&mut rx, "error").await["message"],
            "That name is not allowed"
        );

        // A run that will not do is refused the same way, and neither touched the board.
        route(
            &manager,
            &scrypt_slots,
            &boards,
            1,
            &serde_json::json!({"type":"daily_submit","day":"2026-10-19","name":"  ","score":10}),
        )
        .await;
        assert_eq!(
            take_type(&mut rx, "error").await["message"],
            "Invalid daily run"
        );
        route(
            &manager,
            &scrypt_slots,
            &boards,
            1,
            &serde_json::json!({"type":"daily_top","day":"today"}),
        )
        .await;
        assert_eq!(take_type(&mut rx, "error").await["message"], "Invalid day");

        // Looking at the board posts nothing, and shows the run that was already there.
        route(
            &manager,
            &scrypt_slots,
            &boards,
            1,
            &serde_json::json!({"type":"daily_top","day":"2026-10-19"}),
        )
        .await;
        assert_eq!(
            take_type(&mut rx, "daily_board").await["entries"],
            serde_json::json!([{"rank":1,"name":"Ada","score":4200}])
        );
    }
}
