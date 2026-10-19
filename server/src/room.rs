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

use crate::auth::{password_length, MAX_PASSWORD_LENGTH};
use crate::codec::{frame, Outbound};
use crate::leaderboard::Board;
use crate::protocol::{
    clean_name_checked, cpu_name, is_input_message, is_safe_integer, parse_avatar, parse_cpu_level,
    parse_room_look, parse_rules, rules_to_value, RoomLook, RoomRules, AVATARS, DEFAULT_AVATAR,
    DEFAULT_RULES,
};

const MAX_ROOM_PLAYERS: i64 = 6;
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
    /// The symbol the player shows in an online game.
    avatar: String,
    ready: bool,
    team: u8,
    /// The connection of a human. A CPU seat has none: the host's game runs it.
    conn: Option<u64>,
    /// The level of a CPU seat.
    cpu: Option<String>,
}

impl Player {
    fn is_cpu(&self) -> bool {
        self.cpu.is_some()
    }

    /// A human has to confirm (ready); a CPU is always ready.
    fn confirmed(&self) -> bool {
        self.ready || self.is_cpu()
    }
}

struct Room {
    id: String,
    mode: String,
    game_mode: String,
    rules: RoomRules,
    look: RoomLook,
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
    /// Where each connection came from. The leaderboard is told apart by it; nothing else uses it.
    ips: HashMap<u64, IpAddr>,
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
            ips: HashMap::new(),
        }
    }

    pub fn connect(
        &mut self,
        conn: u64,
        ip: IpAddr,
        tx: Outbound,
        slow: tokio::sync::watch::Sender<bool>,
    ) {
        self.connections.insert(conn);
        self.ips.insert(conn, ip);
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
        if room.status != RoomStatus::Waiting || !can_take_human(room) {
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
            "set_room" => self.set_room(conn, message),
            "set_avatar" => self.set_avatar(conn, message),
            "set_team" => self.set_team(conn, message),
            "reset_teams" => self.reset_teams(conn),
            "add_cpu" => self.add_cpu(conn, message),
            "set_cpu" => self.set_cpu(conn, message),
            "remove_cpu" => self.remove_cpu(conn, message),
            "start_game" => self.start_game(conn),
            "input" => self.relay_input(conn, message),
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
        self.ips.remove(&conn);
        self.remove_from_room(conn, "A player disconnected");
    }

    // ————————————————————————————— Daily challenge —————————————————————————————

    /// Where a connection came from, so the board can tell one player from another. The board
    /// itself is reached from the async dispatch, which can await it; the room dispatch cannot.
    pub fn peer_ip(&self, conn: u64) -> Option<IpAddr> {
        self.ips.get(&conn).copied()
    }

    /// One day's board as it goes on the wire: the top runs, and the caller's own run if it posted one.
    pub fn daily_board(&mut self, conn: u64, day: &str, board: &Board) {
        fn entry(e: &crate::leaderboard::Entry) -> Value {
            json!({ "rank": e.rank, "name": e.name, "score": e.score })
        }
        self.send_value(
            conn,
            &json!({
                "type": "daily_board",
                "day": day,
                "entries": board.entries.iter().map(entry).collect::<Vec<_>>(),
                "you": board.you.as_ref().map(entry),
            }),
        );
    }

    // ————————————————————————————— Outbound —————————————————————————————

    fn send_value(&mut self, conn: u64, value: &Value) {
        let Ok(bytes) = rmp_serde::to_vec_named(value) else {
            return;
        };
        self.send_fast(conn, &bytes);
    }

    /// The fast path: an already-serialized MessagePack frame that may be fanned out to several players.
    fn send_fast(&self, conn: u64, bytes: &[u8]) {
        let Some(out) = self.outbounds.get(&conn) else {
            return;
        };
        if bytes.len() > crate::codec::OUTBOUND_BYTES {
            let _ = out.slow.send(true);
            warn!(
                conn,
                "outbound frame exceeds byte budget; closing connection"
            );
            return;
        }
        let permits = bytes.len();
        let Ok(permit) = out.bytes.clone().try_acquire_many_owned(permits as u32) else {
            let _ = out.slow.send(true);
            warn!(conn, "outbound byte budget exhausted; closing connection");
            return;
        };
        if out.tx.try_send(frame(bytes, Some(permit))).is_err() {
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
            .filter(|room| room.status == RoomStatus::Waiting && !room.look.is_private())
            .collect();
        rooms.sort_by_key(|room| room.created_order);
        rooms
            .into_iter()
            .map(|room| {
                json!({
                    "id": room.id,
                    "host": room.players.first().map(|p| p.name.clone()).unwrap_or_default(),
                    "number": room.created_order + 1,
                    "symbol": room.look.symbol,
                    "color": room.look.color,
                    "mode": room.mode,
                    "gameMode": room.game_mode,
                    "players": room.players.len(),
                    "cpus": room.players.iter().filter(|p| p.is_cpu()).count(),
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
        let Some(look) = parse_room_look(message) else {
            self.error(conn, "Malformed room settings");
            return;
        };
        let Some(avatar) = parse_avatar(message.get("avatar")) else {
            self.error(conn, "Malformed player symbol");
            return;
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
                look,
                max_players: max_players_num.unwrap() as i64,
                status: RoomStatus::Waiting,
                players: Vec::new(),
                next_player_id: 0,
                last_state_seq: -1,
                password,
                created_order,
            },
        );
        self.add_player(&id, conn, name, avatar);
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
        let open = self.rooms.get(room_id).is_some_and(can_take_human);
        if !open {
            self.error(conn, "Room is full");
            return;
        }
        let Some(avatar) = parse_avatar(message.get("avatar")) else {
            self.error(conn, "Malformed player symbol");
            return;
        };
        let locked = self
            .rooms
            .get(room_id)
            .is_some_and(|room| room.password.is_some());
        if locked && !self.password_attempt_ok(conn, room_id, preverified) {
            return;
        }
        // A full room gives its newest CPU seat to the human who joins.
        let full = self
            .rooms
            .get(room_id)
            .is_some_and(|room| room.players.len() >= room.max_players as usize);
        if full {
            let newest_cpu = self
                .rooms
                .get(room_id)
                .and_then(|room| room.players.iter().rev().find(|p| p.is_cpu()))
                .map(|p| p.id);
            if let Some(cpu_id) = newest_cpu {
                self.remove_player(room_id, cpu_id);
                if let Some(room) = self.rooms.get_mut(room_id) {
                    unready_humans(room);
                }
            }
        }
        self.add_player(room_id, conn, name.unwrap(), avatar);
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
                .find(|p| p.conn == Some(conn))
                .expect("member's player is in the room");
            player.ready = ready;
            humans(room) >= 2 && room.players.iter().all(Player::confirmed) && teams_playable(room)
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

    /// The host changes how the room shows up while it waits: name, listing, symbol and colour. None of
    /// it changes the game, so nobody has to confirm again.
    fn set_room(&mut self, conn: u64, message: &Value) {
        let Some((room_id, is_host)) = self
            .memberships
            .get(&conn)
            .map(|mb| (mb.room_id.clone(), mb.player_id == 0))
        else {
            self.error(conn, "Only the room host can change the lobby");
            return;
        };
        if !is_host {
            self.error(conn, "Only the room host can change the lobby");
            return;
        }
        let waiting = self
            .rooms
            .get(&room_id)
            .is_some_and(|room| room.status == RoomStatus::Waiting);
        if !waiting {
            self.error(conn, "The lobby cannot change while a game is running");
            return;
        }
        let Some(look) = message.get("look").and_then(parse_room_look) else {
            self.error(conn, "Malformed room settings");
            return;
        };
        let room = self.rooms.get_mut(&room_id).unwrap();
        room.look = look;
        self.broadcast_room_update(&room_id, None);
        // A room that went private leaves the list, and one that went public joins it.
        self.broadcast_lobby();
    }

    /// A player picks the symbol they show in the game, while the room waits. Nobody has to confirm again.
    fn set_avatar(&mut self, conn: u64, message: &Value) {
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
            self.error(conn, "The symbol cannot change while a game is running");
            return;
        }
        let Some(avatar) = parse_avatar(message.get("avatar")) else {
            self.error(conn, "Malformed player symbol");
            return;
        };
        let room = self.rooms.get_mut(&room_id).unwrap();
        if let Some(player) = room.players.iter_mut().find(|p| p.id == player_id) {
            player.avatar = avatar;
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

    /// The room a connection hosts while it waits, or why it may not change the CPU seats.
    fn host_of_waiting_room(&self, conn: u64) -> Result<String, &'static str> {
        let Some((room_id, is_host)) = self
            .memberships
            .get(&conn)
            .map(|mb| (mb.room_id.clone(), mb.player_id == 0))
        else {
            return Err("Only the room host can change the CPU seats");
        };
        if !is_host {
            return Err("Only the room host can change the CPU seats");
        }
        let waiting = self
            .rooms
            .get(&room_id)
            .is_some_and(|room| room.status == RoomStatus::Waiting);
        if !waiting {
            return Err("The CPU seats cannot change while a game is running");
        }
        Ok(room_id)
    }

    /// The host seats a CPU while the room waits. It is always ready; the humans confirm again.
    fn add_cpu(&mut self, conn: u64, message: &Value) {
        let room_id = match self.host_of_waiting_room(conn) {
            Ok(room_id) => room_id,
            Err(reason) => return self.error(conn, reason),
        };
        let Some(level) = parse_cpu_level(message.get("level")) else {
            self.error(conn, "Malformed CPU level");
            return;
        };
        let requested_team = match named_team(message) {
            Ok(team) => team,
            Err(reason) => return self.error(conn, reason),
        };
        let (full, team, name, avatar) = {
            let room = self.rooms.get(&room_id).unwrap();
            let team = if room.mode == "team" {
                requested_team.unwrap_or_else(|| smallest_team(room))
            } else {
                0
            };
            (
                room.players.len() >= room.max_players as usize,
                team,
                free_cpu_name(room, &level),
                free_avatar(room),
            )
        };
        if full {
            self.error(conn, "Room is full");
            return;
        }
        let room = self.rooms.get_mut(&room_id).unwrap();
        let id = room.next_player_id;
        room.next_player_id += 1;
        room.players.push(Player {
            id,
            name,
            avatar,
            ready: false,
            team,
            conn: None,
            cpu: Some(level),
        });
        unready_humans(room);
        self.broadcast_room_update(&room_id, None);
        self.broadcast_lobby();
    }

    /// The host changes a CPU seat's level or team while the room waits. A new level brings a new name.
    fn set_cpu(&mut self, conn: u64, message: &Value) {
        let room_id = match self.host_of_waiting_room(conn) {
            Ok(room_id) => room_id,
            Err(reason) => return self.error(conn, reason),
        };
        let Some(player_id) = cpu_seat_id(message) else {
            self.error(conn, "Malformed CPU seat");
            return;
        };
        let level = match named_cpu_level(message) {
            Ok(level) => level,
            Err(reason) => return self.error(conn, reason),
        };
        let team = match named_team(message) {
            Ok(team) => team,
            Err(reason) => return self.error(conn, reason),
        };
        let room = self.rooms.get(&room_id).unwrap();
        let Some(seat) = room
            .players
            .iter()
            .find(|p| p.id == player_id && p.is_cpu())
        else {
            self.error(conn, "No CPU sits in that seat");
            return;
        };
        if team.is_some() && room.mode != "team" {
            self.error(conn, "Teams only exist in team rooms");
            return;
        }
        let renamed = level
            .as_deref()
            .filter(|level| seat.cpu.as_deref() != Some(*level))
            .map(|level| free_cpu_name(room, level));
        let room = self.rooms.get_mut(&room_id).unwrap();
        let seat = room
            .players
            .iter_mut()
            .find(|p| p.id == player_id)
            .expect("the CPU seat is in the room");
        if let Some(level) = level {
            seat.cpu = Some(level);
        }
        if let Some(name) = renamed {
            seat.name = name;
        }
        if let Some(team) = team {
            seat.team = team;
        }
        unready_humans(room);
        self.broadcast_room_update(&room_id, None);
    }

    /// The host takes a CPU seat away while the room waits.
    fn remove_cpu(&mut self, conn: u64, message: &Value) {
        let room_id = match self.host_of_waiting_room(conn) {
            Ok(room_id) => room_id,
            Err(reason) => return self.error(conn, reason),
        };
        let Some(player_id) = cpu_seat_id(message) else {
            self.error(conn, "Malformed CPU seat");
            return;
        };
        let is_cpu = self
            .rooms
            .get(&room_id)
            .is_some_and(|room| room.players.iter().any(|p| p.id == player_id && p.is_cpu()));
        if !is_cpu {
            self.error(conn, "No CPU sits in that seat");
            return;
        }
        self.remove_player(&room_id, player_id);
        if let Some(room) = self.rooms.get_mut(&room_id) {
            unready_humans(room);
        }
        self.broadcast_room_update(&room_id, None);
        self.broadcast_lobby();
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
        let (seats, people) = self
            .rooms
            .get(&room_id)
            .map(|room| (room.players.len(), humans(room)))
            .unwrap_or_default();
        if seats < 2 {
            self.error(conn, "At least 2 players are required to start");
            return;
        }
        // A game against CPUs alone is played offline, not on the relay.
        if people < 2 {
            self.error(conn, "Play against CPUs alone in the singleplayer lobby");
            return;
        }
        // The host's click counts as its own "ready"; everybody else has to have confirmed.
        let (all_ready, teams_ok) = {
            let room = self.rooms.get(&room_id).unwrap();
            let all_ready = room
                .players
                .iter()
                .all(|p| p.conn == Some(conn) || p.confirmed());
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
        if room.status != RoomStatus::Waiting || humans(room) < 2 {
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
                .map(|p| json!({ "id": p.id, "name": p.name, "avatar": p.avatar, "team": p.team, "cpu": p.cpu }))
                .collect::<Vec<_>>(),
            room.players.iter().filter_map(|p| p.conn).collect::<Vec<_>>(),
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
            let host_conn = room.players.iter().find(|p| p.id == 0).and_then(|p| p.conn);
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

    /// Relay a client-encoded state frame after validating its readable envelope header.
    pub fn handle_state_envelope(&mut self, conn: u64, seq: u64, bytes: &[u8]) {
        let Some((room_id, my_id)) = self
            .memberships
            .get(&conn)
            .map(|mb| (mb.room_id.clone(), mb.player_id))
        else {
            self.error(conn, "You are not in a running game");
            return;
        };
        if !self
            .rooms
            .get(&room_id)
            .is_some_and(|room| room.status == RoomStatus::Playing)
        {
            self.error(conn, "You are not in a running game");
            return;
        }
        if my_id != 0 {
            self.error(conn, "Only the room host can send state");
            return;
        }
        if seq > 9_007_199_254_740_991 {
            self.error(conn, "Invalid state sequence");
            return;
        }
        let seq = seq as i64;
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
        let recipients: Vec<u64> = self
            .rooms
            .get(&room_id)
            .map(|room| {
                room.players
                    .iter()
                    .filter_map(|p| p.conn)
                    .filter(|other| *other != conn)
                    .collect()
            })
            .unwrap_or_default();
        for recipient in recipients {
            self.send_fast(recipient, bytes);
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
                        .filter_map(|player| player.conn)
                        .filter(|other| *other != conn)
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

    fn add_player(&mut self, room_id: &str, conn: u64, name: String, avatar: String) {
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
            avatar,
            ready: false,
            team,
            conn: Some(conn),
            cpu: None,
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
            // A CPU seat has no connection to remember.
            let Some(conn) = remaining.conn else {
                continue;
            };
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
            "number": room.created_order + 1,
            "visibility": room.look.visibility,
            "symbol": room.look.symbol,
            "color": room.look.color,
            "maxPlayers": room.max_players,
            "status": room.status.as_str(),
            "locked": room.password.is_some(),
            "players": room
                .players
                .iter()
                .map(|p| json!({ "id": p.id, "name": p.name, "avatar": p.avatar, "ready": p.confirmed(), "team": p.team, "cpu": p.cpu }))
                .collect::<Vec<_>>(),
        });
        let recipients: Vec<(u64, usize)> = room
            .players
            .iter()
            .filter_map(|p| p.conn.map(|conn| (conn, p.id)))
            .collect();
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

/// The seats with a person in them. A game needs two of them; CPUs alone are played offline.
fn humans(room: &Room) -> usize {
    room.players.iter().filter(|p| !p.is_cpu()).count()
}

/// A human may join when a seat is free, or when a CPU seat can give way to them.
fn can_take_human(room: &Room) -> bool {
    room.players.len() < room.max_players as usize || room.players.iter().any(Player::is_cpu)
}

/// Whenever the seats change, every human confirms again: the game they agreed to is not the same.
fn unready_humans(room: &mut Room) {
    for player in room.players.iter_mut().filter(|p| !p.is_cpu()) {
        player.ready = false;
    }
}

/// The name for a new CPU of this level: the offline name, or the next free number after it.
fn free_cpu_name(room: &Room, level: &str) -> String {
    let base = cpu_name(level);
    let taken = |name: &str| room.players.iter().any(|p| p.name == name);
    if !taken(base) {
        return base.to_owned();
    }
    (2..)
        .map(|n| format!("{base} {n}"))
        .find(|name| !taken(name))
        .expect("an unbounded range has a free name")
}

/// A symbol nobody in the room shows yet, so the seats can be told apart.
fn free_avatar(room: &Room) -> String {
    AVATARS
        .into_iter()
        .find(|avatar| room.players.iter().all(|p| p.avatar != *avatar))
        .unwrap_or(DEFAULT_AVATAR)
        .to_owned()
}

/// The seat a CPU message names. It has to be a whole number.
fn cpu_seat_id(message: &Value) -> Option<usize> {
    message
        .get("playerId")
        .filter(|value| is_safe_integer(value))
        .and_then(Value::as_i64)
        .and_then(|id| usize::try_from(id).ok())
}

/// The team a message names, if it names one. Only 0 and 1 exist.
fn named_team(message: &Value) -> Result<Option<u8>, &'static str> {
    match message.get("team") {
        None => Ok(None),
        Some(value) => value
            .as_f64()
            .filter(|team| *team == 0.0 || *team == 1.0)
            .map(|team| Some(team as u8))
            .ok_or("team must be 0 or 1"),
    }
}

/// The CPU level a message names, if it names one.
fn named_cpu_level(message: &Value) -> Result<Option<String>, &'static str> {
    match message.get("level") {
        None => Ok(None),
        Some(_) => parse_cpu_level(message.get("level"))
            .map(Some)
            .ok_or("Malformed CPU level"),
    }
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
    let look_ok = parse_room_look(message).is_some();
    let avatar_ok = parse_avatar(message.get("avatar")).is_some();
    mode_ok && game_mode_ok && max_players_ok && password_ok && rules_ok && look_ok && avatar_ok
}

pub fn valid_join_room_message(message: &Value) -> bool {
    clean_name_checked(message.get("name")).is_some()
        && parse_avatar(message.get("avatar")).is_some()
        && message
            .get("roomId")
            .and_then(Value::as_str)
            .is_some_and(|room_id| !room_id.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::{check_password, hash_password};
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
        rooms.handle(1, &add_cpu("experimental"));
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
}
