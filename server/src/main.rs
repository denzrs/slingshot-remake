//! The WebSocket relay for online games.
//!
//! It also caps concurrent connections and throttles fresh connections per IP, alongside the
//! per-connection 300 msg/s limit.

mod admission;
mod auth;
mod codec;
mod command;
mod config;
mod connection;
mod leaderboard;
mod protocol;
mod room;
mod router;
mod tls;
mod wire;

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use parking_lot::Mutex;
use tokio::net::TcpListener;
use tracing::{error, info, warn};

use crate::admission::AdmissionGuard;
use crate::auth::{ScryptSlots, MAX_CONCURRENT_SCRYPTS};
use crate::config::{
    env_flag, env_parse, DEFAULT_CONNECTIONS_PER_IP_PER_SECOND, DEFAULT_MAX_CONNECTIONS,
    DEFAULT_MAX_CONNECTIONS_PER_IP, DEFAULT_PORT, HANDSHAKE_TIMEOUT, MAX_MESSAGES_PER_SECOND,
};
use crate::connection::{handle_connection, Shared};
use crate::leaderboard::{Leaderboard, DEFAULT_KEEP_DAYS};
use crate::room::RoomManager;
use crate::tls::load_tls;

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
        scrypt: ScryptSlots::new(MAX_CONCURRENT_SCRYPTS),
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
