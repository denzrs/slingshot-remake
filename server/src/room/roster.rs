//! Who sits in a room: adding and removing seats, and telling the room about it.

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use rand::Rng;
use serde_json::json;

use crate::protocol::rules_to_value;
use crate::wire::{Avatar, CpuLevel, RoomMode};

use super::model::*;
use super::RoomManager;

impl RoomManager {
    pub(super) fn add_player(&mut self, room_id: &str, conn: u64, name: String, avatar: Avatar) {
        let team = match self.rooms.get(room_id) {
            Some(room) if room.mode == RoomMode::Team => smallest_team(room),
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
            token: URL_SAFE_NO_PAD.encode(rand::thread_rng().gen::<[u8; 16]>()),
            lost_at: None,
            left: false,
            came_from: None,
        });
        self.memberships.insert(
            conn,
            Membership {
                room_id: room_id.to_string(),
                player_id: id,
            },
        );
    }

    pub(super) fn remove_player(&mut self, room_id: &str, player_id: usize) {
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

    pub(super) fn reset_to_waiting(&mut self, room_id: &str) {
        // The seats of those who left the game were kept for its player indexes only.
        while let Some(seat) = self
            .rooms
            .get(room_id)
            .and_then(|room| room.players.iter().rfind(|p| p.left).map(|p| p.id))
        {
            self.remove_player(room_id, seat);
        }
        let Some(room) = self.rooms.get_mut(room_id) else {
            return;
        };
        room.status = RoomStatus::Waiting;
        for player in room.players.iter_mut() {
            player.ready = false;
        }
    }

    pub(super) fn broadcast_room_update(&mut self, room_id: &str, notice: Option<&str>) {
        let Some(room) = self.rooms.get(room_id) else {
            return;
        };
        let room_info = json!({
            "id": room.id,
            "name": room.name,
            "mode": room.mode.as_str(),
            "gameMode": room.game_mode.as_str(),
            "rules": rules_to_value(&room.rules),
            "number": room.created_order + 1,
            "visibility": room.look.visibility.as_str(),
            "symbol": room.look.symbol.as_str(),
            "color": room.look.color.as_str(),
            "maxPlayers": room.max_players,
            "status": room.status.as_str(),
            "locked": room.password.is_some(),
            "players": room
                .players
                .iter()
                .map(|p| json!({ "id": p.id, "name": p.name, "avatar": p.avatar.as_str(), "ready": p.confirmed(), "team": p.team, "cpu": p.cpu.map(CpuLevel::as_str), "connected": p.lost_at.is_none(), "left": p.left }))
                .collect::<Vec<_>>(),
            "spectators": room
                .spectators
                .iter()
                .map(|s| json!({ "id": s.id, "name": s.name }))
                .collect::<Vec<_>>(),
        });
        let in_the_stands: Vec<(u64, usize)> =
            room.spectators.iter().map(|s| (s.conn, s.id)).collect();
        let recipients: Vec<(u64, usize, String)> = room
            .players
            .iter()
            .filter_map(|p| p.conn.map(|conn| (conn, p.id, p.token.clone())))
            .collect();
        for (conn, player_id, token) in recipients {
            let mut message = json!({
                "type": "room_update",
                "room": room_info,
                "you": { "playerId": player_id, "host": player_id == 0, "token": token },
            });
            if let Some(notice) = notice {
                message["notice"] = json!(notice);
            }
            self.send_value(conn, &message);
        }
        for (conn, spectator_id) in in_the_stands {
            let mut message = json!({
                "type": "room_update",
                "room": room_info,
                "you": { "playerId": -1, "host": false, "spectator": true, "spectatorId": spectator_id },
            });
            if let Some(notice) = notice {
                message["notice"] = json!(notice);
            }
            self.send_value(conn, &message);
        }
    }
}
