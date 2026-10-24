//! The lobby: the room list, making and joining a room, and leaving one.

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use rand::Rng;
use serde_json::{json, Value};
use tracing::{debug, info, warn};

use crate::auth::Hashed;
use crate::command::{CreateRoom, JoinRoom, JoinTarget, Parsed};
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

    /// The room list changed. It goes out now unless one went out within the lobby interval; then
    /// `flush_lobby` sends it once the interval is over, with whatever changed in between.
    pub(super) fn broadcast_lobby(&mut self) {
        self.broadcast_lobby_at(std::time::Instant::now());
    }

    pub(super) fn broadcast_lobby_at(&mut self, now: std::time::Instant) {
        let throttle = &mut self.lobby;
        let due = throttle
            .last_sent
            .is_none_or(|at| now.duration_since(at) >= throttle.interval);
        if !due {
            throttle.pending = true;
            return;
        }
        throttle.last_sent = Some(now);
        throttle.pending = false;
        self.send_lobby_to_everybody();
    }

    /// Send a held-back room list whose interval is over. Called every few dozen milliseconds.
    pub fn flush_lobby(&mut self) {
        self.flush_lobby_at(std::time::Instant::now());
    }

    pub(super) fn flush_lobby_at(&mut self, now: std::time::Instant) {
        if self.lobby.pending {
            self.broadcast_lobby_at(now);
        }
    }

    fn send_lobby_to_everybody(&mut self) {
        let message = json!({ "type": "lobby_update", "rooms": self.visible_rooms() });
        // The same list goes to everybody, so it is encoded once and the bytes are shared.
        let Ok(bytes) = rmp_serde::to_vec_named(&message) else {
            return;
        };
        let bytes = crate::codec::Frame::from(bytes);
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

    pub(super) fn open_room(&mut self, conn: u64, create: CreateRoom, prehashed: Option<Hashed>) {
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
                uid: format!("{:032x}", rand::thread_rng().gen::<u128>()),
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
                game: 0,
                password,
                created_order,
                spectators: Vec::new(),
                next_spectator_id: 0,
                seed: 0,
                match_id: String::new(),
                reported_round: 0,
                reported_turn: (0, 0),
            },
        );
        self.add_player(&id, conn, name, avatar);
        self.broadcast_room_update(&id, None);
        self.broadcast_lobby();
    }

    pub(super) fn enter_room(&mut self, conn: u64, join: JoinRoom, preverified: Option<bool>) {
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
            self.error(conn, crate::auth::PASSWORDS_EXHAUSTED);
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
        self.give_up_seat(
            &membership.room_id,
            membership.player_id,
            Some(conn),
            reason,
        );
    }

    /// Takes a seat out of its room for good. `gone` is the seat's connection, if it still had one.
    fn give_up_seat(&mut self, room_id: &str, player_id: usize, gone: Option<u64>, reason: &str) {
        if player_id == 0 {
            let others: Vec<u64> = self
                .rooms
                .get(room_id)
                .map(|room| {
                    room.recipients()
                        .filter(|other| Some(*other) != gone)
                        .collect()
                })
                .unwrap_or_default();
            self.rooms.remove(room_id);
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
            .get(room_id)
            .is_some_and(|room| room.status == RoomStatus::Playing);
        self.remove_player(room_id, player_id);
        if was_playing {
            self.reset_to_waiting(room_id);
        }
        let notice = was_playing.then(|| format!("{reason} – the game was ended"));
        self.broadcast_room_update(room_id, notice.as_deref());
        self.broadcast_lobby();
    }

    /// A connection dropped out of a running game: keep its seat for `SEAT_GRACE` so the same
    /// player can come back with their token. False when there is no such seat to hold.
    pub(super) fn hold_seat(&mut self, conn: u64) -> bool {
        let Some(membership) = self.memberships.get(&conn) else {
            return false;
        };
        let (room_id, player_id) = (membership.room_id.clone(), membership.player_id);
        let Some(room) = self.rooms.get_mut(&room_id) else {
            return false;
        };
        if room.status != RoomStatus::Playing {
            return false;
        }
        let Some(player) = room.players.iter_mut().find(|p| p.id == player_id) else {
            return false;
        };
        if player.token.is_empty() {
            return false;
        }
        player.conn = None;
        player.lost_at = Some(std::time::Instant::now());
        let notice = format!(
            "{} lost the connection – the seat is held for {} s",
            player.name,
            SEAT_GRACE.as_secs()
        );
        self.memberships.remove(&conn);
        info!(conn, room = %room_id, seat = player_id, "seat held for a dropped connection");
        self.broadcast_room_update(&room_id, Some(&notice));
        true
    }

    /// Gives up the seats whose grace has run out. Called every few seconds.
    pub fn expire_seats(&mut self) {
        self.expire_seats_at(std::time::Instant::now());
    }

    pub(super) fn expire_seats_at(&mut self, now: std::time::Instant) {
        let expired: Vec<(String, String)> = self
            .rooms
            .values()
            .flat_map(|room| {
                room.players
                    .iter()
                    .filter(|p| {
                        p.lost_at
                            .is_some_and(|at| now.duration_since(at) >= SEAT_GRACE)
                    })
                    .map(|p| (room.id.clone(), p.token.clone()))
            })
            .collect();
        for (room_id, token) in expired {
            // Earlier removals renumber the seats, and may have closed the room: look the seat up again.
            let Some(player_id) = self
                .rooms
                .get(&room_id)
                .and_then(|room| room.players.iter().find(|p| p.token == token).map(|p| p.id))
            else {
                continue;
            };
            info!(room = %room_id, seat = player_id, "held seat expired");
            self.give_up_seat(&room_id, player_id, None, "A player disconnected");
            self.sync_room(&room_id);
        }
    }

    /// A new connection takes back the seat its token was issued for.
    pub(super) fn resume(&mut self, conn: u64, token: Parsed<String>) {
        let Some(token) = self.accept(conn, token) else {
            return;
        };
        if self.is_placed(conn) {
            self.error(conn, "You are already in a room");
            return;
        }
        let found = self
            .tokens
            .get(&token)
            .and_then(|room_id| self.rooms.get(room_id))
            .and_then(|room| {
                room.players
                    .iter()
                    .find(|p| !p.token.is_empty() && p.token == token)
                    .map(|p| (room.id.clone(), p.id))
            });
        let Some((room_id, player_id)) = found else {
            self.send_value(
                conn,
                &json!({ "type": "resume_failed", "message": "Your seat was given up" }),
            );
            return;
        };
        let room = self.rooms.get_mut(&room_id).unwrap();
        let playing = room.status == RoomStatus::Playing;
        let player = room
            .players
            .iter_mut()
            .find(|p| p.id == player_id)
            .expect("the seat was just found");
        // A half-dead old connection may still be on the seat: the token wins.
        let old = player.conn.replace(conn);
        player.lost_at = None;
        let notice = format!("{} is back", player.name);
        if let Some(old) = old {
            self.memberships.remove(&old);
        }
        self.memberships.insert(
            conn,
            Membership {
                room_id: room_id.clone(),
                player_id,
            },
        );
        info!(conn, room = %room_id, seat = player_id, "seat resumed");
        self.broadcast_room_update(&room_id, Some(&notice));
        // The host sends only what changed: whoever was away needs a complete frame to start over.
        if playing && player_id != 0 {
            let host = self
                .rooms
                .get(&room_id)
                .and_then(|room| room.players.first().and_then(|p| p.conn));
            if let Some(host) = host {
                self.send_value(host, &json!({ "type": "keyframe" }));
            }
        }
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
