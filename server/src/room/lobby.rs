//! The lobby: the room list, making and joining a room, and leaving one.

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use rand::Rng;
use serde_json::{json, Value};
use tracing::{debug, warn};

use crate::auth::Hashed;
use crate::command::{CreateRoom, JoinRoom, JoinTarget};
use crate::protocol::{default_room_name, NAME_TAKEN};

use super::model::*;
use super::RoomManager;

impl RoomManager {
    pub(super) fn send_lobby(&mut self, conn: u64) {
        self.send_value(
            conn,
            &json!({ "type": "lobby_update", "rooms": self.visible_rooms() }),
        );
    }

    pub(super) fn broadcast_lobby(&mut self) {
        let message = json!({ "type": "lobby_update", "rooms": self.visible_rooms() });
        // The same list goes to everybody, so it is encoded once and the bytes are shared.
        let Ok(bytes) = rmp_serde::to_vec_named(&message) else {
            return;
        };
        for conn in self.net.connected() {
            // Players inside a room have no use for the room list.
            if !self.is_placed(conn) {
                self.send_fast(conn, &bytes);
            }
        }
    }

    pub(super) fn visible_rooms(&self) -> Vec<Value> {
        let mut rooms: Vec<_> = self
            .rooms
            .values()
            // A running game is listed too when it can be watched: public, and without a password.
            .filter(|room| {
                !room.look.is_private()
                    && (room.status == RoomStatus::Waiting || open_to_latecomers(room))
            })
            .collect();
        rooms.sort_by_key(|room| room.created_order);
        rooms
            .into_iter()
            .map(|room| {
                json!({
                    "id": room.id,
                    "name": room.name,
                    "host": room.players.first().map(|p| p.name.clone()).unwrap_or_default(),
                    "number": room.created_order + 1,
                    "symbol": room.look.symbol.as_str(),
                    "color": room.look.color.as_str(),
                    "mode": room.mode.as_str(),
                    "gameMode": room.game_mode.as_str(),
                    "mayhem": room.rules.mayhem,
                    "status": room.status.as_str(),
                    "spectators": room.spectators.len(),
                    "players": room.players.len(),
                    "cpus": room.players.iter().filter(|p| p.is_cpu()).count(),
                    "maxPlayers": room.max_players,
                    "locked": room.password.is_some(),
                })
            })
            .collect()
    }

    pub fn create_room(&mut self, conn: u64, create: CreateRoom, prehashed: Option<Hashed>) {
        if self.is_placed(conn) {
            self.error(conn, "Leave your current room before creating another");
            return;
        }
        let CreateRoom {
            name,
            room_name,
            mode,
            game_mode,
            max_players,
            password,
            rules,
            look,
            avatar,
        } = create;
        let Some(name) = self.accept(conn, name) else {
            return;
        };
        let Some(room_name) = self.accept(conn, room_name) else {
            return;
        };
        let Some(mode) = self.accept(conn, mode) else {
            return;
        };
        let Some(game_mode) = self.accept(conn, game_mode) else {
            return;
        };
        let Some(max_players) = self.accept(conn, max_players) else {
            return;
        };
        let Some(password_text) = self.accept(conn, password) else {
            return;
        };
        let Some(rules) = self.accept(conn, rules) else {
            return;
        };
        let Some(look) = self.accept(conn, look) else {
            return;
        };
        let Some(avatar) = self.accept(conn, avatar) else {
            return;
        };
        let id = self.new_room_id();
        let created_order = self.next_room_order;
        self.next_room_order += 1;
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
        let name_is_default = room_name.is_none();
        let room_name = room_name.unwrap_or_else(|| default_room_name(&name, created_order + 1));
        self.rooms.insert(
            id.clone(),
            Room {
                id: id.clone(),
                name: room_name,
                name_is_default,
                mode,
                game_mode,
                rules,
                look,
                max_players,
                status: RoomStatus::Waiting,
                players: Vec::new(),
                next_player_id: 0,
                last_state_seq: -1,
                password,
                created_order,
                spectators: Vec::new(),
                next_spectator_id: 0,
                seed: 0,
            },
        );
        self.add_player(&id, conn, name, avatar);
        self.broadcast_room_update(&id, None);
        self.broadcast_lobby();
    }

    pub fn join_room(&mut self, conn: u64, join: JoinRoom, preverified: Option<bool>) {
        if self.is_placed(conn) {
            self.error(conn, "Leave your current room before joining another");
            return;
        }
        if join.spectate {
            return self.join_as_spectator(conn, join, preverified);
        }
        let Some(JoinTarget { room_id, name }) = self.accept(conn, join.target) else {
            return;
        };
        let room_id = room_id.as_str();
        if !self.is_waiting(room_id) {
            self.error(conn, "Room not found or no longer accepting players");
            return;
        }
        let open = self.rooms.get(room_id).is_some_and(can_take_human);
        if !open {
            self.error(conn, "Room is full");
            return;
        }
        let Some(avatar) = self.accept(conn, join.avatar) else {
            return;
        };
        let locked = self
            .rooms
            .get(room_id)
            .is_some_and(|room| room.password.is_some());
        if locked && !self.password_attempt_ok(conn, room_id, preverified) {
            return;
        }
        if self
            .rooms
            .get(room_id)
            .is_some_and(|room| name_taken(room, &name, None))
        {
            self.error(conn, NAME_TAKEN);
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
        self.add_player(room_id, conn, name, avatar);
        self.broadcast_room_update(room_id, None);
        self.broadcast_lobby();
    }

    /// Applies the verification result computed off-lock by the transport layer.
    pub(super) fn password_attempt_ok(
        &mut self,
        conn: u64,
        room_id: &str,
        preverified: Option<bool>,
    ) -> bool {
        if self.net.password_attempts_exhausted(conn) {
            warn!(room_id = %room_id, "password attempts exhausted");
            self.error(conn, "Too many wrong passwords – reconnect to try again");
            return false;
        }
        let correct = preverified.unwrap_or(false);
        if correct {
            debug!(room_id = %room_id, "password accepted");
            true
        } else {
            self.net.password_failed(conn);
            debug!(room_id = %room_id, "password rejected");
            self.error(conn, "Wrong password");
            false
        }
    }

    pub(super) fn leave_room(&mut self, conn: u64) {
        if !self.is_placed(conn) {
            self.error(conn, "You are not in a room");
            return;
        }
        self.remove_from_room(conn, "A player left");
        self.send_lobby(conn);
    }

    /**
     * Takes a connection out of its room.
     * - The host leaving closes the room; everybody else, the stands included, is sent back to the lobby.
     * - A spectator leaving changes nothing about the game.
     * - Anyone else leaving a running game aborts that game; the remaining players land in the
     *   waiting room again (the room itself survives).
     */
    pub(super) fn remove_from_room(&mut self, conn: u64, reason: &str) {
        if self.remove_spectator(conn) {
            return;
        }
        let Some(membership) = self.memberships.remove(&conn) else {
            return;
        };
        let room_id = membership.room_id;
        let player_id = membership.player_id;

        if player_id == 0 {
            let others: Vec<u64> = self
                .rooms
                .get(&room_id)
                .map(|room| room.recipients().filter(|other| *other != conn).collect())
                .unwrap_or_default();
            self.rooms.remove(&room_id);
            for other in &others {
                self.memberships.remove(other);
                self.watching.remove(other);
                self.net.forget_spectator(*other);
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

    pub(super) fn new_room_id(&self) -> String {
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
