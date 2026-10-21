use super::connections::{MAX_PASSWORD_ATTEMPTS, MAX_SCRYPT_PER_SECOND};
use super::*;
use crate::auth::{check_password, hash_password, password_length};
use crate::command::RoomCommand;
use crate::protocol::DEFAULT_RULES;

fn valid_create_room_message(message: &Value) -> bool {
    matches!(RoomCommand::parse(message), RoomCommand::CreateRoom(create) if create.is_valid())
}
use serde_json::{json, Value};
use std::net::{IpAddr, Ipv4Addr};
use tokio::sync::mpsc;

fn connect(manager: &mut RoomManager, id: u64) -> mpsc::Receiver<crate::codec::WireMessage> {
    let (tx, rx) = mpsc::channel(128);
    let (slow, _) = tokio::sync::watch::channel(false);
    manager.connect(id, IpAddr::V4(Ipv4Addr::LOCALHOST), tx, slow);
    rx
}

fn drain_json(rx: &mut mpsc::Receiver<crate::codec::WireMessage>) -> Vec<Value> {
    let mut messages = Vec::new();
    while let Ok(crate::codec::WireMessage::Binary(bytes, _permit)) = rx.try_recv() {
        if let Some((seq, payload)) = crate::codec::state_header(&bytes) {
            let mut message: Value = rmp_serde::from_slice(payload).unwrap();
            message["type"] = json!("state");
            message["seq"] = json!(seq);
            messages.push(message);
        } else {
            messages.push(rmp_serde::from_slice(&bytes).unwrap());
        }
    }
    messages
}

fn take_type(messages: &[Value], ty: &str) -> Value {
    messages
        .iter()
        .rev()
        .find(|message| message["type"] == ty)
        .unwrap()
        .clone()
}

fn create(name: &str, password: Option<&str>) -> Value {
    let mut message = json!({
        "type":"create_room","name":name,"mode":"ffa","gameMode":"classic","maxPlayers":4
    });
    if let Some(password) = password {
        message["password"] = json!(password);
    }
    message
}

#[test]
fn room_flow_authorizes_host_and_relays_guest_input_and_host_state() {
    let mut rooms = RoomManager::new();
    let mut host_rx = connect(&mut rooms, 1);
    drain_json(&mut host_rx);
    rooms.handle(1, &create("Host", None));
    let room_update = take_type(&drain_json(&mut host_rx), "room_update");
    let room_id = room_update["room"]["id"].as_str().unwrap().to_owned();

    let mut guest_rx = connect(&mut rooms, 2);
    drain_json(&mut guest_rx);
    rooms.handle(
        2,
        &json!({"type":"join_room","roomId":room_id,"name":"Guest"}),
    );
    let guest_update = take_type(&drain_json(&mut guest_rx), "room_update");
    assert_eq!(guest_update["you"]["playerId"], 1);
    assert_eq!(guest_update["room"]["players"].as_array().unwrap().len(), 2);

    rooms.handle(1, &json!({"type":"start_game"}));
    let not_ready = drain_json(&mut host_rx);
    assert_eq!(
        take_type(&not_ready, "error")["message"],
        "Not everybody is ready yet"
    );
    assert!(!not_ready
        .iter()
        .any(|message| message["type"] == "game_start"));

    rooms.handle(2, &json!({"type":"ready","ready":true}));
    drain_json(&mut host_rx);
    rooms.handle(1, &json!({"type":"start_game"}));
    assert_eq!(
        take_type(&drain_json(&mut host_rx), "game_start")["hostId"],
        0
    );
    assert_eq!(
        take_type(&drain_json(&mut guest_rx), "game_start")["players"]
            .as_array()
            .unwrap()
            .len(),
        2
    );

    rooms.handle(
        2,
        &json!({"type":"input","input":{"kind":"aim","angle":15,"power":55}}),
    );
    let input = take_type(&drain_json(&mut host_rx), "input");
    assert_eq!(input["from"], 1);
    assert_eq!(input["input"]["angle"], 15);

    let payload =
        rmp_serde::to_vec_named(&json!({"patch":{"phase":"aiming"},"events":[]})).unwrap();
    let state = crate::codec::state_frame(1, &payload);
    rooms.handle_state_envelope(1, 1, &state);
    let relayed = take_type(&drain_json(&mut guest_rx), "state");
    assert_eq!(relayed["seq"], 1);
    assert_eq!(relayed["patch"]["phase"], "aiming");

    let guest_state = crate::codec::state_frame(2, &payload);
    rooms.handle_state_envelope(2, 2, &guest_state);
    assert_eq!(
        take_type(&drain_json(&mut guest_rx), "error")["message"],
        "Only the room host can send state"
    );
    rooms.handle_state_envelope(1, 1, &state);
    assert_eq!(
        take_type(&drain_json(&mut host_rx), "error")["message"],
        "State sequence must increase monotonically"
    );

    rooms.disconnect(1);
    assert_eq!(
        take_type(&drain_json(&mut guest_rx), "room_closed")["message"],
        "The host left the room"
    );
}

#[test]
fn password_attempts_lock_out_after_five_failures() {
    let mut rooms = RoomManager::new();
    let mut host_rx = connect(&mut rooms, 1);
    drain_json(&mut host_rx);
    let create = create("Host", Some("secret"));
    rooms.handle_create_room(1, &create, Some((vec![1; 16], vec![2; 32])));
    let room_id = take_type(&drain_json(&mut host_rx), "room_update")["room"]["id"]
        .as_str()
        .unwrap()
        .to_owned();

    let mut guest_rx = connect(&mut rooms, 2);
    drain_json(&mut guest_rx);
    for _ in 0..5 {
        rooms.handle_join_room(
            2,
            &json!({"type":"join_room","roomId":room_id,"name":"Guest","password":"wrong"}),
            Some(false),
        );
        assert_eq!(
            take_type(&drain_json(&mut guest_rx), "error")["message"],
            "Wrong password"
        );
    }
    rooms.handle_join_room(
        2,
        &json!({"type":"join_room","roomId":room_id,"name":"Guest","password":"secret"}),
        Some(true),
    );
    assert_eq!(
        take_type(&drain_json(&mut guest_rx), "error")["message"],
        "Too many wrong passwords – reconnect to try again"
    );
    assert_eq!(
        drain_json(&mut guest_rx)
            .iter()
            .filter(|m| m["type"] == "room_update")
            .count(),
        0
    );
}

#[test]
fn password_hash_round_trip_uses_the_real_scrypt_path() {
    let mut rooms = RoomManager::new();
    let mut host_rx = connect(&mut rooms, 1);
    drain_json(&mut host_rx);
    let (salt, hash) = hash_password("secret");
    rooms.handle_create_room(
        1,
        &create("Host", Some("secret")),
        Some((salt.clone(), hash.clone())),
    );
    let created = take_type(&drain_json(&mut host_rx), "room_update");
    assert_eq!(created["you"]["host"], true);
    assert_eq!(created["room"]["locked"], true);
    let room_id = created["room"]["id"].as_str().unwrap().to_owned();

    let mut guest_rx = connect(&mut rooms, 2);
    drain_json(&mut guest_rx);
    let join = |password: &str| json!({"type":"join_room","roomId":room_id,"name":"Guest","password":password});
    rooms.handle_join_room(
        2,
        &join("incorrect"),
        Some(check_password("incorrect", &salt, &hash)),
    );
    assert_eq!(
        take_type(&drain_json(&mut guest_rx), "error")["message"],
        "Wrong password"
    );
    rooms.handle_join_room(
        2,
        &join("secret"),
        Some(check_password("secret", &salt, &hash)),
    );
    assert_eq!(
        take_type(&drain_json(&mut guest_rx), "room_update")["room"]["players"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
}

#[test]
fn lobby_rooms_keep_creation_order_and_password_lock_flags() {
    let mut rooms = RoomManager::new();
    let mut host = connect(&mut rooms, 1);
    let mut watcher = connect(&mut rooms, 2);
    let mut second_host = connect(&mut rooms, 3);
    drain_json(&mut host);
    drain_json(&mut watcher);
    drain_json(&mut second_host);
    rooms.handle_create_room(
        1,
        &create("First", Some("secret")),
        Some((vec![1; 16], vec![2; 32])),
    );
    rooms.handle(3, &create("Second", None));
    let lobby = take_type(&drain_json(&mut watcher), "lobby_update");
    let listed = lobby["rooms"].as_array().unwrap();
    assert_eq!(listed[0]["host"], "First");
    assert_eq!(listed[0]["locked"], true);
    assert_eq!(listed[1]["host"], "Second");
    assert_eq!(listed[1]["locked"], false);
}

#[test]
fn password_limits_match_javascript_utf16_lengths() {
    assert_eq!(password_length(&"ü".repeat(64)), 64);
    assert_eq!(password_length(&"😀".repeat(32)), 64);
    assert_eq!(password_length(&"😀".repeat(33)), 66);
    assert!(valid_create_room_message(&create(
        "Host",
        Some(&"ü".repeat(64))
    )));
    assert!(!valid_create_room_message(&create(
        "Host",
        Some(&"😀".repeat(33))
    )));
}

#[test]
fn open_rooms_ignore_password_failures_and_password_success_does_not_reset_them() {
    let mut rooms = RoomManager::new();
    let mut host_rx = connect(&mut rooms, 1);
    drain_json(&mut host_rx);
    rooms.handle_create_room(
        1,
        &create("Host", Some("secret")),
        Some((vec![1; 16], vec![2; 32])),
    );
    let locked_id = take_type(&drain_json(&mut host_rx), "room_update")["room"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let mut open_host_rx = connect(&mut rooms, 3);
    drain_json(&mut open_host_rx);
    rooms.handle_create_room(3, &create("Open", None), None);
    let open_id = take_type(&drain_json(&mut open_host_rx), "room_update")["room"]["id"]
        .as_str()
        .unwrap()
        .to_owned();

    let mut guest_rx = connect(&mut rooms, 2);
    drain_json(&mut guest_rx);
    for _ in 0..MAX_PASSWORD_ATTEMPTS - 1 {
        rooms.handle_join_room(
            2,
            &json!({"type":"join_room","roomId":locked_id,"name":"Guest","password":"wrong"}),
            Some(false),
        );
        assert_eq!(
            take_type(&drain_json(&mut guest_rx), "error")["message"],
            "Wrong password"
        );
    }
    // The fifth miss cannot be cleared by successfully joining a different open room.
    rooms.handle_join_room(
        2,
        &json!({"type":"join_room","roomId":open_id,"name":"Guest"}),
        None,
    );
    assert_eq!(
        take_type(&drain_json(&mut guest_rx), "room_update")["room"]["locked"],
        false
    );
    rooms.leave_room(2);
    drain_json(&mut guest_rx);
    rooms.handle_join_room(
        2,
        &json!({"type":"join_room","roomId":locked_id,"name":"Guest","password":"wrong"}),
        Some(false),
    );
    assert_eq!(
        take_type(&drain_json(&mut guest_rx), "error")["message"],
        "Wrong password"
    );
    rooms.handle_join_room(
        2,
        &json!({"type":"join_room","roomId":locked_id,"name":"Guest","password":"secret"}),
        Some(true),
    );
    assert_eq!(
        take_type(&drain_json(&mut guest_rx), "error")["message"],
        "Too many wrong passwords – reconnect to try again"
    );
}

#[test]
fn state_envelope_sequence_must_be_a_safe_integer() {
    let mut rooms = RoomManager::new();
    let mut host_rx = connect(&mut rooms, 1);
    let mut guest_rx = connect(&mut rooms, 2);
    drain_json(&mut host_rx);
    drain_json(&mut guest_rx);
    rooms.handle(1, &create("Host", None));
    let room_id = take_type(&drain_json(&mut host_rx), "room_update")["room"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    rooms.handle(
        2,
        &json!({"type":"join_room","roomId":room_id,"name":"Guest"}),
    );
    drain_json(&mut host_rx);
    drain_json(&mut guest_rx);
    rooms.handle(2, &json!({"type":"ready","ready":true}));
    drain_json(&mut host_rx);
    rooms.handle(1, &json!({"type":"start_game"}));
    drain_json(&mut host_rx);
    drain_json(&mut guest_rx);
    let oversized_seq = 9_007_199_254_740_992_u64;
    rooms.handle_state_envelope(1, oversized_seq, &[]);
    assert_eq!(
        take_type(&drain_json(&mut host_rx), "error")["message"],
        "Invalid state sequence"
    );
}

#[test]
fn state_envelopes_require_a_playing_room_host_and_monotonic_sequence() {
    let mut rooms = RoomManager::new();
    let mut host_rx = connect(&mut rooms, 1);
    let mut guest_rx = connect(&mut rooms, 2);
    drain_json(&mut host_rx);
    drain_json(&mut guest_rx);
    rooms.handle(1, &create("Host", None));
    let room_id = take_type(&drain_json(&mut host_rx), "room_update")["room"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    rooms.handle(
        2,
        &json!({"type":"join_room","roomId":room_id,"name":"Guest"}),
    );
    drain_json(&mut host_rx);
    drain_json(&mut guest_rx);

    let payload = rmp_serde::to_vec_named(&json!({"patch":{},"events":[]})).unwrap();
    let seq1 = crate::codec::state_frame(1, &payload);
    rooms.handle_state_envelope(1, 1, &seq1);
    assert_eq!(
        take_type(&drain_json(&mut host_rx), "error")["message"],
        "You are not in a running game"
    );

    rooms.handle(2, &json!({"type":"ready","ready":true}));
    drain_json(&mut host_rx);
    rooms.handle(1, &json!({"type":"start_game"}));
    drain_json(&mut host_rx);
    drain_json(&mut guest_rx);

    rooms.handle_state_envelope(2, 1, &seq1);
    assert_eq!(
        take_type(&drain_json(&mut guest_rx), "error")["message"],
        "Only the room host can send state"
    );

    rooms.handle_state_envelope(1, 1, &seq1);
    assert_eq!(take_type(&drain_json(&mut guest_rx), "state")["seq"], 1);
    rooms.handle_state_envelope(1, 1, &seq1);
    assert_eq!(
        take_type(&drain_json(&mut host_rx), "error")["message"],
        "State sequence must increase monotonically"
    );
}

#[test]
fn create_room_validates_before_hashing_and_password_budget_is_per_connection() {
    let mut rooms = RoomManager::new();
    let mut rx = connect(&mut rooms, 1);
    drain_json(&mut rx);
    assert!(!valid_create_room_message(
        &json!({"type":"create_room","password":"secret"})
    ));
    assert!(rooms.scrypt_budget_available(1));
    for _ in 1..MAX_SCRYPT_PER_SECOND {
        assert!(rooms.scrypt_budget_available(1));
    }
    assert!(!rooms.scrypt_budget_available(1));
    assert!(rooms.scrypt_budget_available(2));
}

#[test]
fn outbound_queue_overflow_signals_immediate_disconnect_without_dropping_silently() {
    let mut rooms = RoomManager::new();
    let (tx, mut rx) = mpsc::channel(crate::codec::OUTBOUND_QUEUE);
    let (slow_tx, slow_rx) = tokio::sync::watch::channel(false);
    rooms.connect(1, IpAddr::V4(Ipv4Addr::LOCALHOST), tx, slow_tx);
    let _ = rx.try_recv(); // initial lobby update
    for _ in 0..=crate::codec::OUTBOUND_QUEUE {
        rooms.handle(1, &json!({"type":"lobby"}));
    }
    assert!(*slow_rx.borrow());
    let mut queued = 0;
    while rx.try_recv().is_ok() {
        queued += 1;
    }
    assert_eq!(queued, crate::codec::OUTBOUND_QUEUE);
}

#[test]
fn oversized_outbound_payload_signals_immediate_disconnect() {
    let mut rooms = RoomManager::new();
    let (tx, _rx) = mpsc::channel(crate::codec::OUTBOUND_QUEUE);
    let (slow_tx, slow_rx) = tokio::sync::watch::channel(false);
    rooms.connect(1, IpAddr::V4(Ipv4Addr::LOCALHOST), tx, slow_tx);
    rooms.send_fast(1, &vec![b'x'; crate::codec::OUTBOUND_BYTES + 1]);
    assert!(*slow_rx.borrow());
}

#[test]
fn team_assignment_balances_and_empty_teams_block_start_even_when_ready() {
    let mut rooms = RoomManager::new();
    let mut receivers: Vec<_> = (1..=5).map(|id| connect(&mut rooms, id)).collect();
    for receiver in &mut receivers {
        drain_json(receiver);
    }
    let mut team_create = create("A", None);
    team_create["mode"] = json!("team");
    team_create["maxPlayers"] = json!(6);
    rooms.handle(1, &team_create);
    let room_id = take_type(&drain_json(&mut receivers[0]), "room_update")["room"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    for (index, name) in ["B", "C", "D", "E"].iter().enumerate() {
        rooms.handle(
            2 + index as u64,
            &json!({"type":"join_room","roomId":room_id,"name":name}),
        );
        let _ = drain_json(&mut receivers[0]);
    }
    let players = rooms
        .rooms
        .get(&room_id)
        .unwrap()
        .players
        .iter()
        .map(|player| player.team)
        .collect::<Vec<_>>();
    assert_eq!(players, [0, 1, 0, 1, 0]);

    let mut small = RoomManager::new();
    let mut host_rx = connect(&mut small, 10);
    let mut guest_rx = connect(&mut small, 11);
    drain_json(&mut host_rx);
    drain_json(&mut guest_rx);
    small.handle(10, &team_create);
    let id = take_type(&drain_json(&mut host_rx), "room_update")["room"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    small.handle(11, &json!({"type":"join_room","roomId":id,"name":"B"}));
    drain_json(&mut host_rx);
    drain_json(&mut guest_rx);
    small.handle(11, &json!({"type":"set_team","team":0}));
    small.handle(11, &json!({"type":"ready","ready":true}));
    small.handle(10, &json!({"type":"ready","ready":true}));
    assert!(!drain_json(&mut host_rx)
        .iter()
        .any(|message| message["type"] == "game_start"));
    small.handle(10, &json!({"type":"start_game"}));
    assert_eq!(
        take_type(&drain_json(&mut host_rx), "error")["message"],
        "Both teams need at least one player"
    );
}

#[test]
fn host_cannot_change_rules_after_start_and_invalid_rule_types_are_rejected() {
    let mut rooms = RoomManager::new();
    let mut host_rx = connect(&mut rooms, 1);
    let mut guest_rx = connect(&mut rooms, 2);
    drain_json(&mut host_rx);
    drain_json(&mut guest_rx);
    let mut invalid = create("Host", None);
    invalid["rules"] = json!({"rounds":1.5});
    rooms.handle(1, &invalid);
    assert_eq!(
        take_type(&drain_json(&mut host_rx), "error")["message"],
        "Malformed game rules"
    );

    rooms.handle(1, &create("Host", None));
    let room_id = take_type(&drain_json(&mut host_rx), "room_update")["room"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    rooms.handle(
        2,
        &json!({"type":"join_room","roomId":room_id,"name":"Guest"}),
    );
    drain_json(&mut host_rx);
    drain_json(&mut guest_rx);
    let host_update = rooms.rooms.get(&room_id).unwrap();
    assert_eq!(host_update.rules.rounds, DEFAULT_RULES.rounds);
    assert_eq!(host_update.rules.max_planets, DEFAULT_RULES.max_planets);
    rooms.handle(2, &json!({"type":"ready","ready":true}));
    rooms.handle(1, &json!({"type":"start_game"}));
    drain_json(&mut host_rx);
    rooms.handle(1, &json!({"type":"set_rules","rules":{}}));
    assert_eq!(
        take_type(&drain_json(&mut host_rx), "error")["message"],
        "The rules cannot change while a game is running"
    );
}

#[test]
fn leaving_running_game_returns_room_to_waiting_and_reindexes_players() {
    let mut rooms = RoomManager::new();
    let mut host_rx = connect(&mut rooms, 1);
    let mut guest_rx = connect(&mut rooms, 2);
    drain_json(&mut host_rx);
    drain_json(&mut guest_rx);
    rooms.handle(1, &create("Host", None));
    let room_id = take_type(&drain_json(&mut host_rx), "room_update")["room"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    rooms.handle(
        2,
        &json!({"type":"join_room","roomId":room_id,"name":"Guest"}),
    );
    drain_json(&mut host_rx);
    drain_json(&mut guest_rx);
    rooms.handle(2, &json!({"type":"ready","ready":true}));
    drain_json(&mut host_rx);
    drain_json(&mut guest_rx);
    rooms.handle(1, &json!({"type":"start_game"}));
    drain_json(&mut host_rx);
    drain_json(&mut guest_rx);
    rooms.disconnect(2);
    let update = take_type(&drain_json(&mut host_rx), "room_update");
    assert_eq!(update["room"]["status"], "waiting");
    assert_eq!(update["room"]["players"].as_array().unwrap().len(), 1);
    assert_eq!(update["room"]["players"][0]["id"], 0);
    assert_eq!(update["you"]["playerId"], 0);
    assert!(update["room"]["players"][0]["ready"] == false);
}

#[test]
fn private_rooms_stay_out_of_the_lobby_but_open_with_their_code() {
    let mut rooms = RoomManager::new();
    let mut host_rx = connect(&mut rooms, 1);
    drain_json(&mut host_rx);
    let mut message = create("Host", None);
    message["visibility"] = json!("private");
    message["symbol"] = json!("ufo");
    message["color"] = json!("#ff6f9f");
    rooms.handle(1, &message);
    let created = take_type(&drain_json(&mut host_rx), "room_update")["room"].clone();
    assert_eq!(created["number"], 1);
    assert_eq!(created["visibility"], "private");
    assert_eq!(created["symbol"], "ufo");
    assert_eq!(created["color"], "#ff6f9f");
    let room_id = created["id"].as_str().unwrap().to_owned();

    let mut watcher = connect(&mut rooms, 2);
    drain_json(&mut watcher);
    rooms.handle(2, &json!({"type":"lobby"}));
    let lobby = take_type(&drain_json(&mut watcher), "lobby_update");
    assert!(lobby["rooms"].as_array().unwrap().is_empty());

    let mut guest_rx = connect(&mut rooms, 3);
    drain_json(&mut guest_rx);
    rooms.handle(
        3,
        &json!({"type":"join_room","roomId":room_id,"name":"Guest"}),
    );
    assert_eq!(
        take_type(&drain_json(&mut guest_rx), "room_update")["room"]["players"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
}

#[test]
fn rooms_name_their_symbol_and_colour_in_the_lobby_and_refuse_unknown_ones() {
    let mut rooms = RoomManager::new();
    let mut host_rx = connect(&mut rooms, 1);
    let mut watcher = connect(&mut rooms, 2);
    drain_json(&mut host_rx);
    drain_json(&mut watcher);
    let mut message = create("Host", None);
    message["symbol"] = json!("comet");
    rooms.handle(1, &message);
    let listed = take_type(&drain_json(&mut watcher), "lobby_update")["rooms"][0].clone();
    assert_eq!(listed["symbol"], "comet");
    assert_eq!(listed["color"], "#ff8660");
    assert_eq!(listed["number"], 1);

    let mut bad = create("Second", None);
    bad["symbol"] = json!("dragon");
    rooms.handle(2, &bad);
    assert_eq!(
        take_type(&drain_json(&mut watcher), "error")["message"],
        "Malformed room settings"
    );
}

#[test]
fn only_the_host_changes_the_lobby_and_only_while_waiting() {
    let mut rooms = RoomManager::new();
    let mut host_rx = connect(&mut rooms, 1);
    drain_json(&mut host_rx);
    rooms.handle(1, &create("Host", None));
    let room_id = take_type(&drain_json(&mut host_rx), "room_update")["room"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let mut guest_rx = connect(&mut rooms, 2);
    drain_json(&mut guest_rx);
    rooms.handle(
        2,
        &json!({"type":"join_room","roomId":room_id,"name":"Guest"}),
    );
    drain_json(&mut host_rx);
    drain_json(&mut guest_rx);

    let change = json!({"type":"set_room","look":{"visibility":"private","symbol":"moon","color":"#c6e86a"}});
    rooms.handle(2, &change);
    assert_eq!(
        take_type(&drain_json(&mut guest_rx), "error")["message"],
        "Only the room host can change the lobby"
    );

    rooms.handle(1, &change);
    let update = take_type(&drain_json(&mut guest_rx), "room_update")["room"].clone();
    assert_eq!(update["visibility"], "private");
    assert_eq!(update["symbol"], "moon");
    assert_eq!(update["color"], "#c6e86a");

    rooms.handle(1, &json!({"type":"set_room","look":{"symbol":"dragon"}}));
    assert_eq!(
        take_type(&drain_json(&mut host_rx), "error")["message"],
        "Malformed room settings"
    );

    rooms.handle(2, &json!({"type":"ready","ready":true}));
    rooms.handle(1, &json!({"type":"start_game"}));
    drain_json(&mut host_rx);
    drain_json(&mut guest_rx);
    rooms.handle(1, &change);
    assert_eq!(
        take_type(&drain_json(&mut host_rx), "error")["message"],
        "The lobby cannot change while a game is running"
    );
}

#[test]
fn players_pick_a_symbol_that_the_game_and_the_room_both_see() {
    let mut rooms = RoomManager::new();
    let mut host_rx = connect(&mut rooms, 1);
    drain_json(&mut host_rx);
    let mut message = create("Host", None);
    message["avatar"] = json!("gem");
    rooms.handle(1, &message);
    let room_id = take_type(&drain_json(&mut host_rx), "room_update")["room"]["id"]
        .as_str()
        .unwrap()
        .to_owned();

    let mut guest_rx = connect(&mut rooms, 2);
    drain_json(&mut guest_rx);
    rooms.handle(
        2,
        &json!({"type":"join_room","roomId":room_id,"name":"Guest","avatar":"alien"}),
    );
    let update = take_type(&drain_json(&mut guest_rx), "room_update");
    assert_eq!(update["room"]["players"][0]["avatar"], "gem");
    assert_eq!(update["room"]["players"][1]["avatar"], "alien");

    // A room symbol is not a player symbol.
    rooms.handle(2, &json!({"type":"set_avatar","avatar":"planet"}));
    assert_eq!(
        take_type(&drain_json(&mut guest_rx), "error")["message"],
        "Malformed player symbol"
    );
    rooms.handle(2, &json!({"type":"set_avatar","avatar":"bolt"}));
    let changed = take_type(&drain_json(&mut host_rx), "room_update");
    assert_eq!(changed["room"]["players"][1]["avatar"], "bolt");

    rooms.handle(2, &json!({"type":"ready","ready":true}));
    rooms.handle(1, &json!({"type":"start_game"}));
    let start = take_type(&drain_json(&mut guest_rx), "game_start");
    assert_eq!(start["players"][0]["avatar"], "gem");
    assert_eq!(start["players"][1]["avatar"], "bolt");

    rooms.handle(2, &json!({"type":"set_avatar","avatar":"robot"}));
    assert_eq!(
        take_type(&drain_json(&mut guest_rx), "error")["message"],
        "The symbol cannot change while a game is running"
    );
}

type Inbox = mpsc::Receiver<crate::codec::WireMessage>;

/// A room with its host on connection 1, and the room's id.
fn host_room(mode: &str, max_players: i64) -> (RoomManager, Inbox, String) {
    let mut rooms = RoomManager::new();
    let mut host_rx = connect(&mut rooms, 1);
    drain_json(&mut host_rx);
    rooms.handle(
        1,
        &json!({"type":"create_room","name":"Host","mode":mode,"gameMode":"classic","maxPlayers":max_players}),
    );
    let room_id = take_type(&drain_json(&mut host_rx), "room_update")["room"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    (rooms, host_rx, room_id)
}

fn join(rooms: &mut RoomManager, conn: u64, room_id: &str, name: &str) -> Inbox {
    let mut rx = connect(rooms, conn);
    drain_json(&mut rx);
    rooms.handle(
        conn,
        &json!({"type":"join_room","roomId":room_id,"name":name}),
    );
    rx
}

fn add_cpu(level: &str) -> Value {
    json!({"type":"add_cpu","level":level})
}

#[test]
fn cpu_seats_have_no_connection_are_always_ready_and_get_their_own_names_and_symbols() {
    let (mut rooms, mut host_rx, _room_id) = host_room("ffa", 4);
    rooms.handle(1, &add_cpu("easy"));
    rooms.handle(1, &add_cpu("easy"));
    let update = take_type(&drain_json(&mut host_rx), "room_update");
    let players = update["room"]["players"].as_array().unwrap();
    assert_eq!(players.len(), 3);
    assert!(players[0]["cpu"].is_null());
    assert_eq!(players[1]["cpu"], "easy");
    assert_eq!(players[1]["name"], "Kepler");
    assert_eq!(players[2]["name"], "Kepler 2");
    assert_eq!(players[1]["ready"], true);
    assert_ne!(players[1]["avatar"], players[0]["avatar"]);
    assert_ne!(players[2]["avatar"], players[1]["avatar"]);

    // The lobby counts the seats, CPUs included, and tells them apart.
    let mut lobby_rx = connect(&mut rooms, 9);
    drain_json(&mut lobby_rx);
    rooms.handle(9, &json!({"type":"lobby"}));
    let lobby = take_type(&drain_json(&mut lobby_rx), "lobby_update");
    assert_eq!(lobby["rooms"][0]["players"], 3);
    assert_eq!(lobby["rooms"][0]["cpus"], 2);
}

#[test]
fn only_the_host_seats_and_changes_cpus_and_a_change_makes_the_humans_confirm_again() {
    let (mut rooms, mut host_rx, room_id) = host_room("team", 4);
    let mut guest_rx = join(&mut rooms, 2, &room_id, "Ben");
    drain_json(&mut host_rx);
    rooms.handle(2, &json!({"type":"ready","ready":true}));
    drain_json(&mut guest_rx);

    // A CPU changes the game, so Ben has to confirm again. The smaller team takes it: team 0.
    rooms.handle(1, &add_cpu("medium"));
    let update = take_type(&drain_json(&mut guest_rx), "room_update");
    assert_eq!(update["room"]["players"][1]["ready"], false);
    assert_eq!(update["room"]["players"][2]["cpu"], "medium");
    assert_eq!(update["room"]["players"][2]["team"], 0);

    // Guests have no say over the CPUs.
    rooms.handle(2, &add_cpu("easy"));
    assert_eq!(
        take_type(&drain_json(&mut guest_rx), "error")["message"],
        "Only the room host can change the CPU seats"
    );

    // The host changes a CPU's level (and with it the name) and its team.
    rooms.handle(
        1,
        &json!({"type":"set_cpu","playerId":2,"level":"hawking","team":1}),
    );
    let update = take_type(&drain_json(&mut host_rx), "room_update");
    assert_eq!(update["room"]["players"][2]["cpu"], "hawking");
    assert_eq!(update["room"]["players"][2]["name"], "Hawking");
    assert_eq!(update["room"]["players"][2]["team"], 1);

    rooms.handle(1, &json!({"type":"remove_cpu","playerId":2}));
    let update = take_type(&drain_json(&mut host_rx), "room_update");
    assert_eq!(update["room"]["players"].as_array().unwrap().len(), 2);
}

#[test]
fn cpu_seat_changes_refuse_malformed_levels_seats_and_teams() {
    let (mut rooms, mut host_rx, _room_id) = host_room("ffa", 2);
    rooms.handle(1, &json!({"type":"add_cpu"}));
    assert_eq!(
        take_type(&drain_json(&mut host_rx), "error")["message"],
        "Malformed CPU level"
    );
    rooms.handle(1, &add_cpu("einstein"));
    assert_eq!(
        take_type(&drain_json(&mut host_rx), "error")["message"],
        "Malformed CPU level"
    );

    rooms.handle(1, &add_cpu("easy"));
    drain_json(&mut host_rx);
    // Full: host and one CPU.
    rooms.handle(1, &add_cpu("hard"));
    assert_eq!(
        take_type(&drain_json(&mut host_rx), "error")["message"],
        "Room is full"
    );

    // The host's own seat is not a CPU, and free-for-all rooms have no teams.
    rooms.handle(1, &json!({"type":"set_cpu","playerId":0,"level":"easy"}));
    assert_eq!(
        take_type(&drain_json(&mut host_rx), "error")["message"],
        "No CPU sits in that seat"
    );
    rooms.handle(1, &json!({"type":"set_cpu","playerId":1,"team":1}));
    assert_eq!(
        take_type(&drain_json(&mut host_rx), "error")["message"],
        "Teams only exist in team rooms"
    );
}

#[test]
fn a_team_name_is_0_or_1() {
    let (mut rooms, mut host_rx, _room_id) = host_room("team", 4);
    rooms.handle(1, &json!({"type":"add_cpu","level":"easy","team":2}));
    assert_eq!(
        take_type(&drain_json(&mut host_rx), "error")["message"],
        "team must be 0 or 1"
    );
}

#[test]
fn a_cpu_alone_with_the_host_is_refused_and_two_people_with_a_cpu_play() {
    let (mut rooms, mut host_rx, room_id) = host_room("ffa", 4);
    rooms.handle(1, &add_cpu("hawking"));
    drain_json(&mut host_rx);
    rooms.handle(1, &json!({"type":"start_game"}));
    assert_eq!(
        take_type(&drain_json(&mut host_rx), "error")["message"],
        "Play against CPUs alone in the singleplayer lobby"
    );

    let mut guest_rx = join(&mut rooms, 2, &room_id, "Ben");
    drain_json(&mut host_rx);
    rooms.handle(2, &json!({"type":"ready","ready":true}));
    rooms.handle(1, &json!({"type":"start_game"}));
    let start = take_type(&drain_json(&mut host_rx), "game_start");
    assert_eq!(start["players"].as_array().unwrap().len(), 3);
    assert_eq!(start["players"][1]["cpu"], "hawking");
    assert_eq!(start["players"][1]["name"], "Hawking");
    assert!(start["players"][2]["cpu"].is_null());
    // Only the people are sent the game, a CPU has nobody to send it to.
    assert_eq!(
        take_type(&drain_json(&mut guest_rx), "game_start")["players"][1]["cpu"],
        "hawking"
    );
}

#[test]
fn a_full_room_gives_its_newest_cpu_seat_to_a_joining_human_and_refuses_when_there_is_none() {
    let (mut rooms, mut host_rx, room_id) = host_room("ffa", 3);
    rooms.handle(1, &add_cpu("easy"));
    rooms.handle(1, &add_cpu("hard"));
    drain_json(&mut host_rx);

    let mut guest_rx = join(&mut rooms, 2, &room_id, "Ben");
    let update = take_type(&drain_json(&mut guest_rx), "room_update");
    let players = update["room"]["players"].as_array().unwrap();
    assert_eq!(players.len(), 3);
    assert_eq!(players[1]["cpu"], "easy", "the older CPU keeps its seat");
    assert_eq!(players[2]["name"], "Ben");
    assert_eq!(players[2]["id"], 2);

    // The older CPU gives its seat up next, and once the room is all people there is none left.
    let mut third_rx = join(&mut rooms, 3, &room_id, "Cy");
    let update = take_type(&drain_json(&mut third_rx), "room_update");
    let names: Vec<&str> = update["room"]["players"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["name"].as_str().unwrap())
        .collect();
    assert_eq!(names, ["Host", "Ben", "Cy"]);
    let mut fourth_rx = join(&mut rooms, 4, &room_id, "Di");
    assert_eq!(
        take_type(&drain_json(&mut fourth_rx), "error")["message"],
        "Room is full"
    );
}
#[test]
fn a_room_is_called_what_its_host_typed_or_after_the_host() {
    let mut rooms = RoomManager::new();
    let mut host_rx = connect(&mut rooms, 1);
    drain_json(&mut host_rx);
    let mut message = create("Ada", None);
    message["roomName"] = json!("  Friday night  ");
    rooms.handle(1, &message);
    let created = take_type(&drain_json(&mut host_rx), "room_update")["room"].clone();
    assert_eq!(created["name"], "Friday night");

    let mut other_rx = connect(&mut rooms, 2);
    drain_json(&mut other_rx);
    let mut blank = create("Bob", None);
    blank["roomName"] = json!("   ");
    rooms.handle(2, &blank);
    let created = take_type(&drain_json(&mut other_rx), "room_update")["room"].clone();
    assert_eq!(created["name"], "Bob's room");

    let mut third_rx = connect(&mut rooms, 3);
    drain_json(&mut third_rx);
    rooms.handle(3, &create("Cy", None));
    let created = take_type(&drain_json(&mut third_rx), "room_update")["room"].clone();
    assert_eq!(created["name"], "Cy's room");

    let mut watcher = connect(&mut rooms, 4);
    drain_json(&mut watcher);
    rooms.handle(4, &json!({"type":"lobby"}));
    let lobby = take_type(&drain_json(&mut watcher), "lobby_update");
    let names: Vec<_> = lobby["rooms"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| r["name"].clone())
        .collect();
    assert_eq!(
        names,
        [
            json!("Friday night"),
            json!("Bob's room"),
            json!("Cy's room")
        ]
    );
}

#[test]
fn a_profane_room_name_is_refused_and_no_room_is_made() {
    let mut rooms = RoomManager::new();
    let mut host_rx = connect(&mut rooms, 1);
    drain_json(&mut host_rx);
    let mut message = create("Ada", None);
    message["roomName"] = json!("fuck this");
    assert!(!valid_create_room_message(&message));
    rooms.handle(1, &message);
    let sent = drain_json(&mut host_rx);
    assert_eq!(
        take_type(&sent, "error")["message"],
        "That room name is not allowed"
    );
    assert!(rooms.rooms.is_empty());

    // A profane player name is refused the same way, and no room is made either.
    let mut other_rx = connect(&mut rooms, 2);
    drain_json(&mut other_rx);
    rooms.handle(2, &create("shit", None));
    assert_eq!(
        take_type(&drain_json(&mut other_rx), "error")["message"],
        "That name is not allowed"
    );
    assert!(rooms.rooms.is_empty());
}

#[test]
fn a_player_can_rename_in_a_waiting_room_but_not_to_a_profane_name() {
    let mut rooms = RoomManager::new();
    let mut host_rx = connect(&mut rooms, 1);
    let mut guest_rx = connect(&mut rooms, 2);
    drain_json(&mut host_rx);
    drain_json(&mut guest_rx);
    rooms.handle(1, &create("Ada", None));
    let room_id = take_type(&drain_json(&mut host_rx), "room_update")["room"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    rooms.handle(
        2,
        &json!({"type":"join_room","roomId":room_id,"name":"Guest"}),
    );
    drain_json(&mut host_rx);
    drain_json(&mut guest_rx);

    rooms.handle(2, &json!({"type":"set_name","name":"  Ben  "}));
    let update = take_type(&drain_json(&mut host_rx), "room_update");
    assert_eq!(update["room"]["players"][1]["name"], "Ben");

    rooms.handle(2, &json!({"type":"set_name","name":"fuck"}));
    assert_eq!(
        take_type(&drain_json(&mut guest_rx), "error")["message"],
        "That name is not allowed"
    );
    rooms.handle(2, &json!({"type":"set_name","name":"   "}));
    assert_eq!(
        take_type(&drain_json(&mut guest_rx), "error")["message"],
        "A non-empty player name is required"
    );

    // The host's name is the one the lobby lists.
    let mut watcher = connect(&mut rooms, 3);
    drain_json(&mut watcher);
    rooms.handle(1, &json!({"type":"set_name","name":"Ada L"}));
    let lobby = take_type(&drain_json(&mut watcher), "lobby_update");
    assert_eq!(lobby["rooms"][0]["host"], "Ada L");
}

#[test]
fn a_name_error_says_it_is_about_the_name_and_other_errors_do_not() {
    let mut rooms = RoomManager::new();
    let mut rx = connect(&mut rooms, 1);
    drain_json(&mut rx);
    rooms.handle(1, &create("shit", None));
    let error = take_type(&drain_json(&mut rx), "error");
    assert_eq!(error["field"], "name");

    rooms.handle(1, &json!({"type":"join_room","roomId":"nope","name":"Ada"}));
    let error = take_type(&drain_json(&mut rx), "error");
    assert!(error.get("field").is_none());
}

#[test]
fn a_new_name_has_to_be_confirmed_again_and_the_same_one_does_not_unready() {
    let mut rooms = RoomManager::new();
    let mut host_rx = connect(&mut rooms, 1);
    let mut guest_rx = connect(&mut rooms, 2);
    drain_json(&mut host_rx);
    drain_json(&mut guest_rx);
    rooms.handle(1, &create("Ada", None));
    let room_id = take_type(&drain_json(&mut host_rx), "room_update")["room"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    rooms.handle(
        2,
        &json!({"type":"join_room","roomId":room_id,"name":"Guest"}),
    );
    rooms.handle(2, &json!({"type":"ready","ready":true}));
    drain_json(&mut host_rx);
    drain_json(&mut guest_rx);

    rooms.handle(2, &json!({"type":"set_name","name":"Guest"}));
    let update = take_type(&drain_json(&mut host_rx), "room_update");
    assert_eq!(update["room"]["players"][1]["ready"], true);

    rooms.handle(2, &json!({"type":"set_name","name":"Ada"}));
    let update = take_type(&drain_json(&mut host_rx), "room_update");
    assert_eq!(update["room"]["players"][1]["name"], "Ada");
    assert_eq!(update["room"]["players"][1]["ready"], false);
}

#[test]
fn a_room_the_host_did_not_name_follows_their_rename_and_a_named_one_does_not() {
    let mut rooms = RoomManager::new();
    let mut default_rx = connect(&mut rooms, 1);
    let mut named_rx = connect(&mut rooms, 2);
    drain_json(&mut default_rx);
    drain_json(&mut named_rx);

    rooms.handle(1, &create("Ada", None));
    let update = take_type(&drain_json(&mut default_rx), "room_update");
    assert_eq!(update["room"]["name"], "Ada's room");
    rooms.handle(1, &json!({"type":"set_name","name":"Grace"}));
    let update = take_type(&drain_json(&mut default_rx), "room_update");
    assert_eq!(update["room"]["name"], "Grace's room");

    let mut message = create("Bob", None);
    message["roomName"] = json!("Arena");
    rooms.handle(2, &message);
    drain_json(&mut named_rx);
    rooms.handle(2, &json!({"type":"set_name","name":"Bobby"}));
    let update = take_type(&drain_json(&mut named_rx), "room_update");
    assert_eq!(update["room"]["name"], "Arena");
}
