//! Room and player lifecycle management for the multiplayer relay. Each connection is identified
//! by an opaque id; outbound messages go into a per-connection channel the writer task drains.

use std::collections::{HashMap, HashSet, VecDeque};
use std::net::IpAddr;
use std::time::{Duration, Instant};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use rand::Rng;
use serde_json::{json, Value};
use tracing::{debug, info, warn};

use crate::codec::{frame, Outbound};
use crate::protocol::{
    clean_name_checked, is_game_event, is_input_message, is_record, is_safe_integer, parse_rules,
    rules_to_value, RoomRules, DEFAULT_RULES,
};

const MAX_ROOM_PLAYERS: i64 = 6;
pub const MAX_PASSWORD_LENGTH: usize = 64;
const MAX_PASSWORD_ATTEMPTS: u32 = 5;
const MAX_SCRYPT_PER_SECOND: usize = 10;

#[derive(Clone, Copy, PartialEq)]
enum RoomStatus {
    Waiting,
    Playing,
}

impl RoomStatus {
    fn as_str(self) -> &'static str {
        match self {
            RoomStatus::Waiting => "waiting",
            RoomStatus::Playing => "playing",
        }
    }
}

struct Conn {
    tx: Outbound,
    bytes: std::sync::Arc<tokio::sync::Semaphore>,
    slow: tokio::sync::watch::Sender<bool>,
}

struct Player {
    id: usize,
    name: String,
    ready: bool,
    team: u8,
    conn: u64,
}

struct Room {
    id: String,
    mode: String,
    game_mode: String,
    rules: RoomRules,
    max_players: i64,
    status: RoomStatus,
    players: Vec<Player>,
    next_player_id: usize,
    last_state_seq: i64,
    /// (salt, hash) — the plaintext never leaves the server.
    password: Option<(Vec<u8>, Vec<u8>)>,
    created_order: u64,
}

struct Membership {
    room_id: String,
    player_id: usize,
}

pub struct RoomManager {
    rooms: HashMap<String, Room>,
    next_room_order: u64,
    connections: HashSet<u64>,
    outbounds: HashMap<u64, Conn>,
    memberships: HashMap<u64, Membership>,
    password_failures: HashMap<u64, u32>,
    scrypt_windows: HashMap<u64, VecDeque<Instant>>,
}

impl RoomManager {
    pub fn new() -> Self {
        Self {
            rooms: HashMap::new(),
            next_room_order: 0,
            connections: HashSet::new(),
            outbounds: HashMap::new(),
            memberships: HashMap::new(),
            password_failures: HashMap::new(),
            scrypt_windows: HashMap::new(),
        }
    }

    pub fn connect(
        &mut self,
        conn: u64,
        _ip: IpAddr,
        tx: Outbound,
        slow: tokio::sync::watch::Sender<bool>,
    ) {
        self.connections.insert(conn);
        self.outbounds.insert(
            conn,
            Conn {
                tx,
                bytes: std::sync::Arc::new(tokio::sync::Semaphore::new(
                    crate::codec::OUTBOUND_BYTES,
                )),
                slow,
            },
        );
        info!(conn, "connection opened");
        self.send_lobby(conn);
    }

    /// Prune expired password and scrypt timestamps without disturbing active lockouts.
    pub fn sweep(&mut self) {
        let now = Instant::now();
        self.scrypt_windows.retain(|_, window| {
            window.retain(|at| now.duration_since(*at) < Duration::from_secs(1));
            !window.is_empty()
        });
        self.password_failures
            .retain(|conn, _| self.connections.contains(conn));
    }

    pub fn scrypt_budget_available(&mut self, conn: u64) -> bool {
        let now = Instant::now();
        let window = self.scrypt_windows.entry(conn).or_default();
        while window
            .front()
            .is_some_and(|at| now.duration_since(*at) >= Duration::from_secs(1))
        {
            window.pop_front();
        }
        if window.len() >= MAX_SCRYPT_PER_SECOND {
            return false;
        }
        window.push_back(now);
        true
    }

    pub fn can_create_room(&self, conn: u64) -> bool {
        self.connections.contains(&conn) && !self.memberships.contains_key(&conn)
    }

    pub fn password_attempts_exhausted(&self, conn: u64) -> bool {
        self.password_failures.get(&conn).copied().unwrap_or(0) >= MAX_PASSWORD_ATTEMPTS
    }

    pub fn join_password_salt(&self, conn: u64, room_id: &str) -> Option<(Vec<u8>, Vec<u8>)> {
        if !self.connections.contains(&conn) || self.memberships.contains_key(&conn) {
            return None;
        }
        let room = self.rooms.get(room_id)?;
        if room.status != RoomStatus::Waiting || room.players.len() >= room.max_players as usize {
            return None;
        }
        room.password.clone()
    }

    pub fn handle(&mut self, conn: u64, message: &Value) {
        if !self.connections.contains(&conn) {
            return;
        }
        let Some(ty) = message.get("type").and_then(Value::as_str) else {
            self.error(conn, "Malformed message");
            return;
        };
        match ty {
            "lobby" => self.send_lobby(conn),
            "create_room" => self.create_room(conn, message, None),
            "join_room" => self.join_room(conn, message, None),
            "ready" => self.set_ready(conn, message),
            "set_rules" => self.set_rules(conn, message),
            "set_team" => self.set_team(conn, message),
            "reset_teams" => self.reset_teams(conn),
            "start_game" => self.start_game(conn),
            "input" => self.relay_input(conn, message),
            "state" => self.relay_state(conn, message),
            "leave_room" => self.leave_room(conn),
            other => self.error(conn, &format!("Unknown message type: {other}")),
        }
    }

    pub fn disconnect(&mut self, conn: u64) {
        info!(conn, "connection closed");
        self.connections.remove(&conn);
        self.outbounds.remove(&conn);
        self.password_failures.remove(&conn);
        self.scrypt_windows.remove(&conn);
        self.remove_from_room(conn, "A player disconnected");
    }

    // ————————————————————————————— Outbound —————————————————————————————

    fn send_value(&mut self, conn: u64, value: &Value) {
        let Ok(text) = serde_json::to_string(value) else {
            return;
        };
        self.send_fast(conn, &text);
    }

    /// The fast path: an already-serialized frame that may be fanned out to several players.
    fn send_fast(&self, conn: u64, text: &str) {
        let Some(out) = self.outbounds.get(&conn) else {
            return;
        };
        if text.len() > crate::codec::OUTBOUND_BYTES {
            let _ = out.slow.send(true);
            warn!(
                conn,
                "outbound frame exceeds byte budget; closing connection"
            );
            return;
        }
        let permits = text.len();
        let Ok(permit) = out.bytes.clone().try_acquire_many_owned(permits as u32) else {
            let _ = out.slow.send(true);
            warn!(conn, "outbound byte budget exhausted; closing connection");
            return;
        };
        if out.tx.try_send(frame(text, Some(permit))).is_err() {
            let _ = out.slow.send(true);
            warn!(
                conn,
                "outbound writer unavailable or queue full; closing connection"
            );
        }
    }

    pub fn error(&mut self, conn: u64, message: &str) {
        self.send_value(conn, &json!({ "type": "error", "message": message }));
    }

    fn send_lobby(&mut self, conn: u64) {
        self.send_value(
            conn,
            &json!({ "type": "lobby_update", "rooms": self.visible_rooms() }),
        );
    }

    fn broadcast_lobby(&mut self) {
        let message = json!({ "type": "lobby_update", "rooms": self.visible_rooms() });
        let connections: Vec<u64> = self.connections.iter().copied().collect();
        for conn in connections {
            // Players inside a room have no use for the room list.
            if !self.memberships.contains_key(&conn) {
                self.send_value(conn, &message);
            }
        }
    }

    fn visible_rooms(&self) -> Vec<Value> {
        let mut rooms: Vec<_> = self
            .rooms
            .values()
            .filter(|room| room.status == RoomStatus::Waiting)
            .collect();
        rooms.sort_by_key(|room| room.created_order);
        rooms
            .into_iter()
            .map(|room| {
                json!({
                    "id": room.id,
                    "host": room.players.first().map(|p| p.name.clone()).unwrap_or_default(),
                    "mode": room.mode,
                    "gameMode": room.game_mode,
                    "players": room.players.len(),
                    "maxPlayers": room.max_players,
                    "locked": room.password.is_some(),
                })
            })
            .collect()
    }

    // ————————————————————————————— Rooms —————————————————————————————

    pub fn create_room(
        &mut self,
        conn: u64,
        message: &Value,
        prehashed: Option<(Vec<u8>, Vec<u8>)>,
    ) {
        if self.memberships.contains_key(&conn) {
            self.error(conn, "Leave your current room before creating another");
            return;
        }
        let Some(name) = clean_name_checked(message.get("name")) else {
            self.error(conn, "A non-empty player name is required");
            return;
        };
        let mode = match message.get("mode").and_then(Value::as_str) {
            Some(m) if m == "ffa" || m == "team" => m,
            _ => {
                self.error(conn, "Mode must be ffa or team");
                return;
            }
        };
        let game_mode = match message.get("gameMode").and_then(Value::as_str) {
            Some(g) if g == "classic" || g == "horizon" => g,
            _ => {
                self.error(conn, "gameMode must be classic or horizon");
                return;
            }
        };
        let max_players = message.get("maxPlayers");
        let max_players_num = max_players.and_then(Value::as_f64);
        if !max_players.is_some_and(is_safe_integer)
            || !matches!(max_players_num, Some(v) if (2.0..=MAX_ROOM_PLAYERS as f64).contains(&v))
        {
            self.error(conn, "maxPlayers must be an integer from 2 to 6");
            return;
        }
        match message.get("password") {
            Some(pw)
                if pw.as_str().is_none()
                    || pw
                        .as_str()
                        .is_some_and(|s| password_length(s) > MAX_PASSWORD_LENGTH) =>
            {
                self.error(conn, "The password must be at most 64 characters");
                return;
            }
            _ => {}
        }
        let rules = match message.get("rules") {
            None => DEFAULT_RULES.clone(),
            Some(value) => match parse_rules(value) {
                Some(rules) => rules,
                None => {
                    self.error(conn, "Malformed game rules");
                    return;
                }
            },
        };
        let id = self.new_room_id();
        let created_order = self.next_room_order;
        self.next_room_order += 1;
        let password_text = message
            .get("password")
            .and_then(Value::as_str)
            .filter(|pw| !pw.is_empty());
        let password = if password_text.is_some() {
            match prehashed {
                Some(hash) => Some(hash),
                None => {
                    self.error(conn, "Server busy – try again shortly");
                    return;
                }
            }
        } else {
            None
        };
        self.rooms.insert(
            id.clone(),
            Room {
                id: id.clone(),
                mode: mode.to_string(),
                game_mode: game_mode.to_string(),
                rules,
                max_players: max_players_num.unwrap() as i64,
                status: RoomStatus::Waiting,
                players: Vec::new(),
                next_player_id: 0,
                last_state_seq: -1,
                password,
                created_order,
            },
        );
        self.add_player(&id, conn, name);
        self.broadcast_room_update(&id, None);
        self.broadcast_lobby();
    }

    pub fn join_room(&mut self, conn: u64, message: &Value, preverified: Option<bool>) {
        if self.memberships.contains_key(&conn) {
            self.error(conn, "Leave your current room before joining another");
            return;
        }
        let name = clean_name_checked(message.get("name"));
        let room_id = message.get("roomId").and_then(Value::as_str);
        if room_id.is_none() || name.is_none() {
            self.error(
                conn,
                "join_room requires a roomId and non-empty player name",
            );
            return;
        }
        let room_id = room_id.unwrap();
        let waiting = self
            .rooms
            .get(room_id)
            .is_some_and(|room| room.status == RoomStatus::Waiting);
        if !waiting {
            self.error(conn, "Room not found or no longer accepting players");
            return;
        }
        let full = self
            .rooms
            .get(room_id)
            .is_some_and(|room| room.players.len() >= room.max_players as usize);
        if full {
            self.error(conn, "Room is full");
            return;
        }
        let locked = self
            .rooms
            .get(room_id)
            .is_some_and(|room| room.password.is_some());
        if locked && !self.password_attempt_ok(conn, room_id, preverified) {
            return;
        }
        self.add_player(room_id, conn, name.unwrap());
        self.broadcast_room_update(room_id, None);
        self.broadcast_lobby();
    }

    /// Applies the verification result computed off-lock by the transport layer.
    fn password_attempt_ok(&mut self, conn: u64, room_id: &str, preverified: Option<bool>) -> bool {
        if self.password_failures.get(&conn).copied().unwrap_or(0) >= MAX_PASSWORD_ATTEMPTS {
            warn!(room_id = %room_id, "password attempts exhausted");
            self.error(conn, "Too many wrong passwords – reconnect to try again");
            return false;
        }
        let correct = preverified.unwrap_or(false);
        if correct {
            debug!(room_id = %room_id, "password accepted");
            true
        } else {
            *self.password_failures.entry(conn).or_insert(0) += 1;
            debug!(room_id = %room_id, "password rejected");
            self.error(conn, "Wrong password");
            false
        }
    }

    fn set_ready(&mut self, conn: u64, message: &Value) {
        let Some(ready) = message.get("ready").and_then(Value::as_bool) else {
            self.error(conn, "ready must be a boolean");
            return;
        };
        let Some(room_id) = self.memberships.get(&conn).map(|mb| mb.room_id.clone()) else {
            self.error(conn, "You are not in a waiting room");
            return;
        };
        let waiting = self
            .rooms
            .get(&room_id)
            .is_some_and(|room| room.status == RoomStatus::Waiting);
        if !waiting {
            self.error(conn, "You are not in a waiting room");
            return;
        }
        let should_start = {
            let room = self.rooms.get_mut(&room_id).unwrap();
            let player = room
                .players
                .iter_mut()
                .find(|p| p.conn == conn)
                .expect("member's player is in the room");
            player.ready = ready;
            room.players.len() >= 2 && room.players.iter().all(|p| p.ready) && teams_playable(room)
        };
        self.broadcast_room_update(&room_id, None);
        if should_start {
            self.begin_game(&room_id);
        }
    }

    /// The host edits the rules while the room is waiting; everybody has to confirm (ready) again.
    fn set_rules(&mut self, conn: u64, message: &Value) {
        let Some((room_id, is_host)) = self
            .memberships
            .get(&conn)
            .map(|mb| (mb.room_id.clone(), mb.player_id == 0))
        else {
            self.error(conn, "Only the room host can change the rules");
            return;
        };
        if !is_host {
            self.error(conn, "Only the room host can change the rules");
            return;
        }
        let waiting = self
            .rooms
            .get(&room_id)
            .is_some_and(|room| room.status == RoomStatus::Waiting);
        if !waiting {
            self.error(conn, "The rules cannot change while a game is running");
            return;
        }
        let Some(rules) = message.get("rules").and_then(parse_rules) else {
            self.error(conn, "Malformed game rules");
            return;
        };
        let room = self.rooms.get_mut(&room_id).unwrap();
        room.rules = rules;
        for player in room.players.iter_mut() {
            player.ready = false;
        }
        self.broadcast_room_update(&room_id, None);
    }

    /// A player picks their own team; they have to confirm (ready) again, everybody else's choice
    /// stands.
    fn set_team(&mut self, conn: u64, message: &Value) {
        let Some((room_id, player_id)) = self
            .memberships
            .get(&conn)
            .map(|mb| (mb.room_id.clone(), mb.player_id))
        else {
            self.error(conn, "You are not in a waiting room");
            return;
        };
        let waiting = self
            .rooms
            .get(&room_id)
            .is_some_and(|room| room.status == RoomStatus::Waiting);
        if !waiting {
            self.error(conn, "You are not in a waiting room");
            return;
        }
        let team_room = self
            .rooms
            .get(&room_id)
            .is_some_and(|room| room.mode == "team");
        if !team_room {
            self.error(conn, "Teams only exist in team rooms");
            return;
        }
        let team = message.get("team").and_then(Value::as_f64);
        if !matches!(team, Some(v) if v == 0.0 || v == 1.0) {
            self.error(conn, "team must be 0 or 1");
            return;
        }
        let team = team.unwrap() as u8;
        let room = self.rooms.get_mut(&room_id).unwrap();
        let player = room
            .players
            .iter_mut()
            .find(|p| p.id == player_id)
            .expect("member's player is in the room");
        if player.team == team {
            return;
        }
        player.team = team;
        player.ready = false;
        self.broadcast_room_update(&room_id, None);
    }

    /// The host deals everybody back out to the teams, one after the other, in the order they
    /// joined.
    fn reset_teams(&mut self, conn: u64) {
        let Some((room_id, is_host)) = self
            .memberships
            .get(&conn)
            .map(|mb| (mb.room_id.clone(), mb.player_id == 0))
        else {
            self.error(conn, "Only the room host can reset the teams");
            return;
        };
        if !is_host {
            self.error(conn, "Only the room host can reset the teams");
            return;
        }
        let waiting = self
            .rooms
            .get(&room_id)
            .is_some_and(|room| room.status == RoomStatus::Waiting);
        if !waiting {
            self.error(conn, "The teams cannot change while a game is running");
            return;
        }
        let team_room = self
            .rooms
            .get(&room_id)
            .is_some_and(|room| room.mode == "team");
        if !team_room {
            self.error(conn, "Teams only exist in team rooms");
            return;
        }
        let room = self.rooms.get_mut(&room_id).unwrap();
        for (i, player) in room.players.iter_mut().enumerate() {
            player.team = (i % 2) as u8;
            player.ready = false;
        }
        self.broadcast_room_update(&room_id, None);
    }

    fn start_game(&mut self, conn: u64) {
        let Some((room_id, is_host)) = self
            .memberships
            .get(&conn)
            .map(|mb| (mb.room_id.clone(), mb.player_id == 0))
        else {
            self.error(conn, "Only the room host can start the game");
            return;
        };
        if !is_host {
            self.error(conn, "Only the room host can start the game");
            return;
        }
        let waiting = self
            .rooms
            .get(&room_id)
            .is_some_and(|room| room.status == RoomStatus::Waiting);
        if !waiting {
            self.error(conn, "Game has already started");
            return;
        }
        if self
            .rooms
            .get(&room_id)
            .is_some_and(|room| room.players.len() < 2)
        {
            self.error(conn, "At least 2 players are required to start");
            return;
        }
        // The host's click counts as its own "ready"; everybody else has to have confirmed.
        let (all_ready, teams_ok) = {
            let room = self.rooms.get(&room_id).unwrap();
            let all_ready = room.players.iter().all(|p| p.conn == conn || p.ready);
            (all_ready, teams_playable(room))
        };
        if !all_ready {
            self.error(conn, "Not everybody is ready yet");
            return;
        }
        if !teams_ok {
            self.error(conn, "Both teams need at least one player");
            return;
        }
        self.begin_game(&room_id);
    }

    fn begin_game(&mut self, room_id: &str) {
        let Some(room) = self.rooms.get_mut(room_id) else {
            return;
        };
        if room.status != RoomStatus::Waiting || room.players.len() < 2 {
            return;
        }
        room.status = RoomStatus::Playing;
        room.last_state_seq = -1;
        let seed: u32 = rand::thread_rng().gen();
        room.players
            .iter_mut()
            .enumerate()
            .for_each(|(id, player)| player.id = id);
        let room_clone = (
            room.id.clone(),
            room.mode.clone(),
            room.game_mode.clone(),
            rules_to_value(&room.rules),
            room.players
                .iter()
                .map(|p| json!({ "id": p.id, "name": p.name, "team": p.team }))
                .collect::<Vec<_>>(),
            room.players.iter().map(|p| p.conn).collect::<Vec<_>>(),
        );
        let (id, mode, game_mode, rules, players, recipients) = room_clone;
        for recipient in recipients {
            self.send_value(
                recipient,
                &json!({
                    "type": "game_start",
                    "roomId": id,
                    "mode": mode,
                    "gameMode": game_mode,
                    "rules": rules,
                    "hostId": 0,
                    "seed": seed,
                    "players": players,
                }),
            );
        }
        self.broadcast_room_update(room_id, None);
        self.broadcast_lobby();
    }

    fn relay_input(&mut self, conn: u64, message: &Value) {
        let (room_id, my_id, host_conn) = {
            let Some(membership) = self.memberships.get(&conn) else {
                self.error(conn, "You are not in a running game");
                return;
            };
            let room_id = membership.room_id.clone();
            let my_id = membership.player_id;
            let Some(room) = self.rooms.get(&room_id) else {
                self.error(conn, "You are not in a running game");
                return;
            };
            if room.status != RoomStatus::Playing {
                self.error(conn, "You are not in a running game");
                return;
            }
            let host_conn = room.players.iter().find(|p| p.id == 0).map(|p| p.conn);
            (room_id, my_id, host_conn)
        };
        if my_id == 0 {
            self.error(conn, "Host input is not accepted");
            return;
        }
        let Some(input) = message.get("input").filter(|v| is_input_message(v)) else {
            self.error(conn, "Malformed input message");
            return;
        };
        if let Some(host_conn) = host_conn {
            let from = my_id;
            let _ = room_id;
            self.send_value(
                host_conn,
                &json!({ "type": "input", "from": from, "input": input }),
            );
        }
    }

    fn relay_state(&mut self, conn: u64, message: &Value) {
        let Some((room_id, my_id)) = self
            .memberships
            .get(&conn)
            .map(|mb| (mb.room_id.clone(), mb.player_id))
        else {
            self.error(conn, "You are not in a running game");
            return;
        };
        let playing = self
            .rooms
            .get(&room_id)
            .is_some_and(|room| room.status == RoomStatus::Playing);
        if !playing {
            self.error(conn, "You are not in a running game");
            return;
        }
        if my_id != 0 {
            self.error(conn, "Only the room host can send state");
            return;
        }
        let seq = message
            .get("seq")
            .filter(|value| is_safe_integer(value))
            .and_then(Value::as_i64);
        let patch_ok = message.get("patch").is_some_and(is_record);
        let events_ok = message
            .get("events")
            .and_then(Value::as_array)
            .is_some_and(|events| events.iter().all(is_game_event));
        if seq.is_none() || seq.unwrap() < 0 || !patch_ok || !events_ok {
            self.error(conn, "Malformed state message");
            return;
        }
        let seq = seq.unwrap();
        let last_seq = self
            .rooms
            .get(&room_id)
            .map(|room| room.last_state_seq)
            .unwrap_or(0);
        if seq <= last_seq {
            self.error(conn, "State sequence must increase monotonically");
            return;
        }
        self.rooms.get_mut(&room_id).unwrap().last_state_seq = seq;

        let text = serde_json::to_string(&json!({
            "type": "state",
            "seq": seq,
            "patch": message.get("patch"),
            "events": message.get("events"),
        }))
        .expect("serialize state frame");
        let recipients: Vec<u64> = self
            .rooms
            .get(&room_id)
            .map(|room| {
                room.players
                    .iter()
                    .filter(|p| p.conn != conn)
                    .map(|p| p.conn)
                    .collect()
            })
            .unwrap_or_default();
        for recipient in recipients {
            self.send_fast(recipient, &text);
        }
    }

    fn leave_room(&mut self, conn: u64) {
        if !self.memberships.contains_key(&conn) {
            self.error(conn, "You are not in a room");
            return;
        }
        self.remove_from_room(conn, "A player left");
        self.send_lobby(conn);
    }

    /**
     * Takes a connection out of its room.
     * - The host leaving closes the room; everybody else is sent back to the lobby.
     * - Anyone else leaving a running game aborts that game; the remaining players land in the
     *   waiting room again (the room itself survives).
     */
    fn remove_from_room(&mut self, conn: u64, reason: &str) {
        let Some(membership) = self.memberships.remove(&conn) else {
            return;
        };
        let room_id = membership.room_id;
        let player_id = membership.player_id;

        if player_id == 0 {
            let others: Vec<u64> = self
                .rooms
                .get(&room_id)
                .map(|room| {
                    room.players
                        .iter()
                        .filter(|player| player.conn != conn)
                        .map(|player| player.conn)
                        .collect()
                })
                .unwrap_or_default();
            self.rooms.remove(&room_id);
            for other in &others {
                self.memberships.remove(other);
                self.send_value(
                    *other,
                    &json!({ "type": "room_closed", "message": "The host left the room" }),
                );
            }
            self.broadcast_lobby();
            return;
        }

        let was_playing = self
            .rooms
            .get(&room_id)
            .is_some_and(|room| room.status == RoomStatus::Playing);
        self.remove_player(&room_id, player_id);
        if was_playing {
            self.reset_to_waiting(&room_id);
        }
        let notice = was_playing.then(|| format!("{reason} – the game was ended"));
        self.broadcast_room_update(&room_id, notice.as_deref());
        self.broadcast_lobby();
    }

    fn reset_to_waiting(&mut self, room_id: &str) {
        let Some(room) = self.rooms.get_mut(room_id) else {
            return;
        };
        room.status = RoomStatus::Waiting;
        room.last_state_seq = -1;
        for player in room.players.iter_mut() {
            player.ready = false;
        }
    }

    fn add_player(&mut self, room_id: &str, conn: u64, name: String) {
        let team = match self.rooms.get(room_id) {
            Some(room) if room.mode == "team" => smallest_team(room),
            _ => 0,
        };
        let room = self.rooms.get_mut(room_id).unwrap();
        let id = room.next_player_id;
        room.next_player_id += 1;
        room.players.push(Player {
            id,
            name,
            ready: false,
            team,
            conn,
        });
        self.memberships.insert(
            conn,
            Membership {
                room_id: room_id.to_string(),
                player_id: id,
            },
        );
    }

    fn remove_player(&mut self, room_id: &str, player_id: usize) {
        let room = self.rooms.get_mut(room_id).unwrap();
        if let Some(pos) = room.players.iter().position(|p| p.id == player_id) {
            room.players.remove(pos);
        }
        // Room IDs must stay contiguous because they become game player indexes.
        // Everybody stays in the team they picked.
        for (id, remaining) in room.players.iter_mut().enumerate() {
            remaining.id = id;
            let conn = remaining.conn;
            self.memberships.insert(
                conn,
                Membership {
                    room_id: room_id.to_string(),
                    player_id: id,
                },
            );
        }
        room.next_player_id = room.players.len();
    }

    fn broadcast_room_update(&mut self, room_id: &str, notice: Option<&str>) {
        let Some(room) = self.rooms.get(room_id) else {
            return;
        };
        let room_info = json!({
            "id": room.id,
            "mode": room.mode,
            "gameMode": room.game_mode,
            "rules": rules_to_value(&room.rules),
            "maxPlayers": room.max_players,
            "status": room.status.as_str(),
            "locked": room.password.is_some(),
            "players": room
                .players
                .iter()
                .map(|p| json!({ "id": p.id, "name": p.name, "ready": p.ready, "team": p.team }))
                .collect::<Vec<_>>(),
        });
        let recipients: Vec<(u64, usize)> = room.players.iter().map(|p| (p.conn, p.id)).collect();
        for (conn, player_id) in recipients {
            let mut message = json!({
                "type": "room_update",
                "room": room_info,
                "you": { "playerId": player_id, "host": player_id == 0 },
            });
            if let Some(notice) = notice {
                message["notice"] = json!(notice);
            }
            self.send_value(conn, &message);
        }
    }

    fn new_room_id(&self) -> String {
        loop {
            let mut bytes = [0u8; 6];
            rand::thread_rng().fill(&mut bytes);
            let candidate = URL_SAFE_NO_PAD.encode(bytes);
            if !self.rooms.contains_key(&candidate) {
                return candidate;
            }
        }
    }
}

/// The team with fewer players, team 0 when they are even: where a newcomer goes.
fn smallest_team(room: &Room) -> u8 {
    let in_first = room.players.iter().filter(|p| p.team == 0).count();
    if in_first <= room.players.len() - in_first {
        0
    } else {
        1
    }
}

/// A team game needs somebody in each team.
fn teams_playable(room: &Room) -> bool {
    room.mode != "team" || {
        let mut present = [false; 2];
        for p in &room.players {
            present[p.team as usize] = true;
        }
        present[0] && present[1]
    }
}

pub fn password_length(password: &str) -> usize {
    password.encode_utf16().count()
}

pub fn valid_create_room_message(message: &Value) -> bool {
    let Some(name) = clean_name_checked(message.get("name")) else {
        return false;
    };
    let _ = name;
    let mode_ok = matches!(
        message.get("mode").and_then(Value::as_str),
        Some("ffa" | "team")
    );
    let game_mode_ok = matches!(
        message.get("gameMode").and_then(Value::as_str),
        Some("classic" | "horizon")
    );
    let max_players_ok = message.get("maxPlayers").is_some_and(|value| {
        is_safe_integer(value)
            && value
                .as_f64()
                .is_some_and(|n| (2.0..=MAX_ROOM_PLAYERS as f64).contains(&n))
    });
    let password_ok = message.get("password").is_none_or(|value| {
        value
            .as_str()
            .is_some_and(|password| password_length(password) <= MAX_PASSWORD_LENGTH)
    });
    let rules_ok = message
        .get("rules")
        .is_none_or(|value| parse_rules(value).is_some());
    mode_ok && game_mode_ok && max_players_ok && password_ok && rules_ok
}

pub fn valid_join_room_message(message: &Value) -> bool {
    clean_name_checked(message.get("name")).is_some()
        && message
            .get("roomId")
            .and_then(Value::as_str)
            .is_some_and(|room_id| !room_id.is_empty())
}

pub fn create_password_plaintext(message: &Value) -> Option<&str> {
    message
        .get("password")
        .and_then(Value::as_str)
        .filter(|password| !password.is_empty() && password_length(password) <= MAX_PASSWORD_LENGTH)
}

pub fn join_password_plaintext(message: &Value) -> Option<&str> {
    message.get("password").and_then(Value::as_str)
}

pub fn hash_password(password: &str) -> (Vec<u8>, Vec<u8>) {
    let mut salt = [0u8; 16];
    rand::thread_rng().fill(&mut salt);
    let mut hash = vec![0u8; 32];
    scrypt::scrypt(
        password.as_bytes(),
        &salt,
        &scrypt::Params::new(14, 8, 1, 32).unwrap(),
        &mut hash,
    )
    .expect("scrypt derivation");
    (salt.to_vec(), hash)
}

pub fn check_password(password: &str, salt: &[u8], expected: &[u8]) -> bool {
    let mut actual = vec![0u8; expected.len()];
    if scrypt::scrypt(
        password.as_bytes(),
        salt,
        &scrypt::Params::new(14, 8, 1, 32).unwrap(),
        &mut actual,
    )
    .is_err()
    {
        return false;
    }
    timing_safe_eq(&actual, expected)
}

fn timing_safe_eq(left: &[u8], right: &[u8]) -> bool {
    let mut difference = (left.len() ^ right.len()) as u8;
    let max_len = left.len().max(right.len());
    for index in 0..max_len {
        difference |=
            left.get(index).copied().unwrap_or(0) ^ right.get(index).copied().unwrap_or(0);
    }
    difference == 0
}

#[cfg(test)]
mod tests {
    use super::*;
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
        while let Ok(crate::codec::WireMessage::Text(text, _permit)) = rx.try_recv() {
            messages.push(serde_json::from_str(&text).unwrap());
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

        let state = json!({"type":"state","seq":1,"patch":{"phase":"aiming"},"events":[]});
        rooms.handle(1, &state);
        let relayed = take_type(&drain_json(&mut guest_rx), "state");
        assert_eq!(relayed["seq"], 1);
        assert_eq!(relayed["patch"]["phase"], "aiming");

        rooms.handle(2, &json!({"type":"state","seq":2,"patch":{},"events":[]}));
        assert_eq!(
            take_type(&drain_json(&mut guest_rx), "error")["message"],
            "Only the room host can send state"
        );
        rooms.handle(1, &state);
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
        rooms.create_room(1, &create, Some((vec![1; 16], vec![2; 32])));
        let room_id = take_type(&drain_json(&mut host_rx), "room_update")["room"]["id"]
            .as_str()
            .unwrap()
            .to_owned();

        let mut guest_rx = connect(&mut rooms, 2);
        drain_json(&mut guest_rx);
        for _ in 0..5 {
            rooms.join_room(
                2,
                &json!({"type":"join_room","roomId":room_id,"name":"Guest","password":"wrong"}),
                Some(false),
            );
            assert_eq!(
                take_type(&drain_json(&mut guest_rx), "error")["message"],
                "Wrong password"
            );
        }
        rooms.join_room(
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
        rooms.create_room(
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
        rooms.join_room(
            2,
            &join("incorrect"),
            Some(check_password("incorrect", &salt, &hash)),
        );
        assert_eq!(
            take_type(&drain_json(&mut guest_rx), "error")["message"],
            "Wrong password"
        );
        rooms.join_room(
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
        rooms.create_room(
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
        rooms.create_room(
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
        rooms.create_room(3, &create("Open", None), None);
        let open_id = take_type(&drain_json(&mut open_host_rx), "room_update")["room"]["id"]
            .as_str()
            .unwrap()
            .to_owned();

        let mut guest_rx = connect(&mut rooms, 2);
        drain_json(&mut guest_rx);
        for _ in 0..MAX_PASSWORD_ATTEMPTS - 1 {
            rooms.join_room(
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
        rooms.join_room(
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
        rooms.join_room(
            2,
            &json!({"type":"join_room","roomId":locked_id,"name":"Guest","password":"wrong"}),
            Some(false),
        );
        assert_eq!(
            take_type(&drain_json(&mut guest_rx), "error")["message"],
            "Wrong password"
        );
        rooms.join_room(
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
    fn sequences_must_be_safe_integers() {
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
        for seq in [1.5, -0.5, 9_007_199_254_740_992.0] {
            rooms.handle(1, &json!({"type":"state","seq":seq,"patch":{},"events":[]}));
            assert_eq!(
                take_type(&drain_json(&mut host_rx), "error")["message"],
                "Malformed state message"
            );
        }
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
        rooms.send_fast(1, &"x".repeat(crate::codec::OUTBOUND_BYTES + 1));
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
}
