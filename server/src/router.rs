//! Inbound messages: decode a frame, then hand it to the room logic, the password flow or the
//! daily board.

use parking_lot::Mutex;
use serde_json::Value;
use tracing::{debug, warn};

use crate::auth::{self, ScryptSlots};
use crate::command::{Command, DailyCommand, Parsed, RoomCommand};
use crate::leaderboard::Leaderboard;
use crate::protocol::DailyScore;
use crate::room::RoomManager;

/// Parse one decoded inbound frame and pass it to the room logic.
pub async fn deliver(
    manager: &Mutex<RoomManager>,
    scrypt_slots: &ScryptSlots,
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
/// the async reactor) by `auth`, so a scrypt can never stall every other connection. The daily
/// board is awaited here too: it is reached from this task, never from the room lock.
pub async fn route(
    manager: &Mutex<RoomManager>,
    scrypt_slots: &ScryptSlots,
    boards: &Leaderboard,
    conn_id: u64,
    message: &Value,
) {
    match Command::parse(message) {
        Command::Daily(DailyCommand::Submit(run)) => {
            daily_submit(manager, boards, conn_id, run).await
        }
        Command::Daily(DailyCommand::Top(day)) => daily_top(manager, boards, conn_id, day).await,
        Command::Daily(DailyCommand::Stats) => stats_overview(manager, conn_id).await,
        Command::Daily(DailyCommand::Facts) => stats_facts(manager, conn_id).await,
        Command::Daily(DailyCommand::Local(game)) => local_game(manager, conn_id, *game),
        Command::Daily(DailyCommand::Replay(id)) => stats_replay(manager, conn_id, id).await,
        Command::Room(RoomCommand::CreateRoom(create)) => {
            let can_create = manager.lock().can_create_room(conn_id);
            if !can_create || !create.is_valid() {
                // Nothing worth hashing: the room logic says what is wrong.
                manager
                    .lock()
                    .dispatch(conn_id, RoomCommand::CreateRoom(create));
                return;
            }
            if let Ok(prehashed) =
                auth::prepare_create(manager, scrypt_slots, conn_id, &create).await
            {
                manager.lock().create_room(conn_id, create, prehashed);
            }
        }
        Command::Room(RoomCommand::JoinRoom(join)) => {
            if !join.is_valid() {
                manager
                    .lock()
                    .dispatch(conn_id, RoomCommand::JoinRoom(join));
                return;
            }
            if let Ok(preverified) = auth::prepare_join(manager, scrypt_slots, conn_id, &join).await
            {
                manager.lock().join_room(conn_id, join, preverified);
            }
        }
        Command::Room(command) => manager.lock().dispatch(conn_id, command),
    }
}

async fn daily_submit(
    manager: &Mutex<RoomManager>,
    boards: &Leaderboard,
    conn_id: u64,
    run: Parsed<DailyScore>,
) {
    let Some(ip) = manager.lock().peer_ip(conn_id) else {
        return;
    };
    let run = match run {
        Ok(run) => run,
        Err(reason) => {
            manager.lock().error(conn_id, reason);
            return;
        }
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

async fn daily_top(
    manager: &Mutex<RoomManager>,
    boards: &Leaderboard,
    conn_id: u64,
    day: Parsed<String>,
) {
    let Some(ip) = manager.lock().peer_ip(conn_id) else {
        return;
    };
    let day = match day {
        Ok(day) => day,
        Err(reason) => {
            manager.lock().error(conn_id, reason);
            return;
        }
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

/// The numbers of the stats page. With statistics off there is nothing to show, and the page is told so.
async fn stats_overview(manager: &Mutex<RoomManager>, conn_id: u64) {
    let stats = manager.lock().stats();
    let Some(stats) = stats else {
        manager.lock().stats_overview(conn_id, None);
        return;
    };
    match stats.overview_shared().await {
        Ok(overview) => manager.lock().stats_overview(conn_id, Some(&overview)),
        Err(err) => {
            warn!(%err, "stats read failed");
            manager
                .lock()
                .error(conn_id, "The statistics are unavailable");
        }
    }
}

/// The menu's facts; with statistics off there are none, and the menu is told so.
async fn stats_facts(manager: &Mutex<RoomManager>, conn_id: u64) {
    let stats = manager.lock().stats();
    let facts = match stats {
        Some(stats) => Some(stats.facts_shared().await),
        None => None,
    };
    manager
        .lock()
        .stats_facts(conn_id, facts.as_deref().map(Vec::as_slice));
}

/// A game played on one device: handed to the statistics, if the relay keeps any, and not answered.
fn local_game(manager: &Mutex<RoomManager>, conn_id: u64, game: Parsed<crate::report::LocalGame>) {
    let game = match game {
        Ok(game) => game,
        Err(reason) => {
            manager.lock().error(conn_id, reason);
            return;
        }
    };
    let (ip, stats) = {
        let manager = manager.lock();
        (manager.peer_ip(conn_id), manager.stats())
    };
    if let (Some(ip), Some(stats)) = (ip, stats) {
        stats.submit_local(ip, game);
    }
}

/// One game to fly again, or `replay: null` when this relay has no such game or not the whole of it.
async fn stats_replay(manager: &Mutex<RoomManager>, conn_id: u64, id: Parsed<String>) {
    let id = match id {
        Ok(id) => id,
        Err(reason) => {
            manager.lock().error(conn_id, reason);
            return;
        }
    };
    let stats = manager.lock().stats();
    let Some(stats) = stats else {
        manager.lock().stats_replay(conn_id, &id, None);
        return;
    };
    match stats.replay_shared(&id).await {
        Ok(replay) => manager.lock().stats_replay(conn_id, &id, replay),
        Err(err) => {
            warn!(%err, "stats read failed");
            manager
                .lock()
                .error(conn_id, "The statistics are unavailable");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::{IpAddr, Ipv4Addr};
    use tokio::sync::mpsc;

    use crate::auth::MAX_CONCURRENT_SCRYPTS;
    use crate::codec::WireMessage;

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

    #[tokio::test]
    async fn password_create_and_join_use_real_scrypt_hashing() {
        let manager = Mutex::new(RoomManager::new());
        let scrypt_slots = ScryptSlots::new(MAX_CONCURRENT_SCRYPTS);
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
        let scrypt_slots = ScryptSlots::new(0);
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
            .handle_create_room(1, &create, Some((vec![1; 16], vec![2; 32])));
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
            manager.lock().handle_join_room(
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
        let scrypt_slots = ScryptSlots::new(0);
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
            .handle_create_room(1, &create, Some((vec![1; 16], vec![2; 32])));
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
    async fn the_stats_page_is_told_the_numbers_or_that_there_are_none() {
        let scrypt_slots = ScryptSlots::new(MAX_CONCURRENT_SCRYPTS);
        let boards = Leaderboard::in_memory().await;
        let ask = serde_json::json!({"type":"stats_overview"});

        // Statistics off: an answer all the same, saying so.
        let manager = Mutex::new(RoomManager::new());
        let (tx, mut rx) = mpsc::channel(crate::codec::OUTBOUND_QUEUE);
        let (slow, _) = tokio::sync::watch::channel(false);
        manager
            .lock()
            .connect(1, IpAddr::V4(Ipv4Addr::LOCALHOST), tx, slow);
        let _ = take_type(&mut rx, "lobby_update").await;
        route(&manager, &scrypt_slots, &boards, 1, &ask).await;
        let off = take_type(&mut rx, "stats_overview").await;
        assert_eq!(off["enabled"], false);

        // Statistics on, nothing played yet: enabled, and empty.
        let manager = Mutex::new(
            RoomManager::new()
                .with_stats(std::sync::Arc::new(crate::stats::Stats::in_memory().await)),
        );
        let (tx, mut rx) = mpsc::channel(crate::codec::OUTBOUND_QUEUE);
        let (slow, _) = tokio::sync::watch::channel(false);
        manager
            .lock()
            .connect(1, IpAddr::V4(Ipv4Addr::LOCALHOST), tx, slow);
        let _ = take_type(&mut rx, "lobby_update").await;
        route(&manager, &scrypt_slots, &boards, 1, &ask).await;
        let on = take_type(&mut rx, "stats_overview").await;
        assert_eq!(on["enabled"], true);
        assert_eq!(on["days"], serde_json::json!([]));
        assert_eq!(on["games"], serde_json::json!([]));
    }

    #[tokio::test]
    async fn a_daily_run_reaches_the_board_and_a_refused_name_comes_back_with_a_reason() {
        let manager = Mutex::new(RoomManager::new());
        let scrypt_slots = ScryptSlots::new(MAX_CONCURRENT_SCRYPTS);
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
