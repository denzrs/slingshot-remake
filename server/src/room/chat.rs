//! Talking in a room: everybody inside, players and spectators, hears every message.

use serde_json::json;

use crate::command::Parsed;

use super::model::*;
use super::RoomManager;

impl RoomManager {
    /// A message to the room. The text has been cleaned and censored on the way in; what is left here is who
    /// may say it: anybody in a room, unless the host limited chat to the players and this is a spectator.
    /// The host speaks for a CPU seat during a game: its taunt goes out as that seat's chat line. The host's
    /// client is the one that flies the CPUs, so it is the only one that knows when a CPU has something to say.
    pub(super) fn cpu_chat(&mut self, conn: u64, seat: Parsed<usize>, text: Parsed<String>) {
        let Some(player_id) = self.accept(conn, seat) else {
            return;
        };
        let Some(text) = self.accept(conn, text) else {
            return;
        };
        let Some(membership) = self.memberships.get(&conn) else {
            self.error(conn, "You are not in a running game");
            return;
        };
        if membership.player_id != 0 {
            self.error(conn, "Only the room host can speak for the CPUs");
            return;
        }
        let room_id = membership.room_id.clone();
        let Some(room) = self.rooms.get(&room_id) else {
            return;
        };
        if room.status != RoomStatus::Playing {
            self.error(conn, "You are not in a running game");
            return;
        }
        let Some(name) = room
            .players
            .iter()
            .find(|p| p.id == player_id && p.is_cpu())
            .map(|p| p.name.clone())
        else {
            self.error(conn, "No CPU sits in that seat");
            return;
        };
        if !self.net.allow_cpu_chat(conn) {
            return;
        }
        let room = self.rooms.get(&room_id).unwrap();
        let everybody: Vec<u64> = room.recipients().collect();
        let message = json!({ "type": "chat", "id": player_id, "spectator": false, "name": name, "text": text });
        for recipient in everybody {
            self.send_value(recipient, &message);
        }
    }

    pub(super) fn chat(&mut self, conn: u64, text: Parsed<String>) {
        let Some(text) = self.accept(conn, text) else {
            return;
        };
        let (room_id, from, spectator) = if let Some(membership) = self.memberships.get(&conn) {
            (membership.room_id.clone(), membership.player_id, false)
        } else if let Some(watching) = self.watching.get(&conn) {
            (watching.room_id.clone(), watching.spectator_id, true)
        } else {
            self.error(conn, "Join a room to chat");
            return;
        };
        let Some(room) = self.rooms.get(&room_id) else {
            return;
        };
        if spectator && room.rules.chat_players_only {
            self.error(conn, "Only the players can write in this room");
            return;
        }
        let name = if spectator {
            room.spectators
                .iter()
                .find(|s| s.id == from)
                .map(|s| s.name.clone())
        } else {
            room.players
                .iter()
                .find(|p| p.id == from)
                .map(|p| p.name.clone())
        };
        let Some(name) = name else {
            return;
        };
        if !self.net.allow_chat(conn) {
            self.error(conn, "You are writing too fast");
            return;
        }
        let room = self.rooms.get(&room_id).unwrap();
        let everybody: Vec<u64> = room.recipients().collect();
        let message = json!({ "type": "chat", "id": from, "spectator": spectator, "name": name, "text": text });
        for recipient in everybody {
            self.send_value(recipient, &message);
        }
    }
}
