//! Starting a game, and relaying a running game's input and state.

use rand::Rng;
use serde_json::{json, Value};

use crate::command::Parsed;
use crate::protocol::rules_to_value;
use crate::wire::CpuLevel;

use super::model::*;
use super::RoomManager;

impl RoomManager {
    pub(super) fn start_game(&mut self, conn: u64) {
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

    pub(super) fn begin_game(&mut self, room_id: &str) {
        let Some(room) = self.rooms.get_mut(room_id) else {
            return;
        };
        if room.status != RoomStatus::Waiting || humans(room) < 2 {
            return;
        }
        room.status = RoomStatus::Playing;
        room.last_state_seq = -1;
        let seed: u32 = rand::thread_rng().gen();
        room.seed = seed;
        room.players
            .iter_mut()
            .enumerate()
            .for_each(|(id, player)| player.id = id);
        let start = self.game_start_message(self.rooms.get(room_id).unwrap());
        let room = self.rooms.get(room_id).unwrap();
        let recipients: Vec<u64> = room
            .players
            .iter()
            .filter_map(|p| p.conn)
            .chain(room.spectators.iter().map(|s| s.conn))
            .collect();
        for recipient in recipients {
            self.send_value(recipient, &start);
        }
        self.broadcast_room_update(room_id, None);
        self.broadcast_lobby();
    }

    /// What a client needs to build the match of a running room.
    pub(super) fn game_start_message(&self, room: &Room) -> Value {
        json!({
            "type": "game_start",
            "roomId": room.id,
            "mode": room.mode.as_str(),
            "gameMode": room.game_mode.as_str(),
            "rules": rules_to_value(&room.rules),
            "hostId": 0,
            "seed": room.seed,
            "players": room
                .players
                .iter()
                .map(|p| json!({ "id": p.id, "name": p.name, "avatar": p.avatar.as_str(), "team": p.team, "cpu": p.cpu.map(CpuLevel::as_str) }))
                .collect::<Vec<_>>(),
        })
    }

    pub(super) fn relay_input(&mut self, conn: u64, input: Parsed<&Value>) {
        if self.watching.contains_key(&conn) {
            return self.relay_spectator_input(conn, input);
        }
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
        let Some(input) = self.accept(conn, input) else {
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
                    .chain(room.spectators.iter().map(|s| s.conn))
                    .collect()
            })
            .unwrap_or_default();
        for recipient in recipients {
            self.send_fast(recipient, bytes);
        }
    }
}
