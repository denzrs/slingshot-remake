//! Talking in a room: everybody inside, players and spectators, hears every message.

use serde_json::json;

use crate::command::Parsed;

use super::RoomManager;

impl RoomManager {
    /// A message to the room. The text has been cleaned and censored on the way in; what is left here is who
    /// may say it: anybody in a room, unless the host limited chat to the players and this is a spectator.
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
        let everybody: Vec<u64> = room
            .players
            .iter()
            .filter_map(|p| p.conn)
            .chain(room.spectators.iter().map(|s| s.conn))
            .collect();
        let message = json!({ "type": "chat", "id": from, "spectator": spectator, "name": name, "text": text });
        for recipient in everybody {
            self.send_value(recipient, &message);
        }
    }
}
