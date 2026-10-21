//! The stands: people who watch a room without a seat. They see everything a player sees, may walk
//! into a running game when the room is public and open, and may do nothing but place bets.

use serde_json::{json, Value};

use crate::command::{JoinRoom, JoinTarget, Parsed};

use super::model::*;
use super::RoomManager;

impl RoomManager {
    /// A `join_room` that asks for the stands.
    pub(super) fn join_as_spectator(
        &mut self,
        conn: u64,
        join: JoinRoom,
        preverified: Option<bool>,
    ) {
        let Some(JoinTarget { room_id, name }) = self.accept(conn, join.target) else {
            return;
        };
        let room_id = room_id.as_str();
        let Some(room) = self.rooms.get(room_id) else {
            self.error(conn, "Room not found");
            return;
        };
        let playing = room.status == RoomStatus::Playing;
        if playing && !open_to_latecomers(room) {
            self.error(conn, "This game can only be watched from the start");
            return;
        }
        if room.spectators.len() >= MAX_SPECTATORS {
            self.error(conn, "The stands are full");
            return;
        }
        // A game in progress has no password to ask for: only open rooms get this far.
        if room.password.is_some() && !self.password_attempt_ok(conn, room_id, preverified) {
            return;
        }
        let room = self.rooms.get_mut(room_id).unwrap();
        let id = room.next_spectator_id;
        room.next_spectator_id += 1;
        room.spectators.push(Spectator { id, name, conn });
        self.watching.insert(
            conn,
            Watching {
                room_id: room_id.to_owned(),
                spectator_id: id,
            },
        );
        self.broadcast_room_update(room_id, None);
        if playing {
            self.catch_up(conn, room_id);
        }
        self.broadcast_lobby();
    }

    /// Brings somebody who came in mid-game up to date: the game's start, and — because the host
    /// sends only what changed — a request for one complete frame to start from.
    fn catch_up(&mut self, conn: u64, room_id: &str) {
        let Some(room) = self.rooms.get(room_id) else {
            return;
        };
        let start = self.game_start_message(room);
        let host = room.players.first().and_then(|p| p.conn);
        self.send_value(conn, &start);
        if let Some(host) = host {
            self.send_value(host, &json!({ "type": "keyframe" }));
        }
    }

    /// A spectator leaves; nothing about the game changes.
    pub(super) fn remove_spectator(&mut self, conn: u64) -> bool {
        let Some(watching) = self.watching.remove(&conn) else {
            return false;
        };
        self.net.forget_spectator(conn);
        if let Some(room) = self.rooms.get_mut(&watching.room_id) {
            room.spectators.retain(|s| s.id != watching.spectator_id);
            self.broadcast_room_update(&watching.room_id, None);
            self.broadcast_lobby();
        }
        true
    }

    /// A spectator's input goes to the host like a guest's does, but only bets are taken.
    pub(super) fn relay_spectator_input(&mut self, conn: u64, input: Parsed<&Value>) {
        let Some(watching) = self.watching.get(&conn) else {
            return;
        };
        let (room_id, from) = (watching.room_id.clone(), watching.spectator_id);
        let host = self
            .rooms
            .get(&room_id)
            .filter(|room| room.status == RoomStatus::Playing)
            .and_then(|room| room.players.first().and_then(|p| p.conn));
        let Some(host) = host else {
            self.error(conn, "There is no running game to bet on");
            return;
        };
        let Some(input) = self.accept(conn, input) else {
            return;
        };
        if input.get("kind").and_then(Value::as_str) != Some("bet") {
            self.error(conn, "Spectators can only bet");
            return;
        }
        if !self.net.allow_spectator_input(conn) {
            return;
        }
        self.send_value(
            host,
            &json!({ "type": "input", "from": from, "spectator": true, "input": input }),
        );
    }
}
