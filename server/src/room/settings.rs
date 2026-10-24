//! What the people in a waiting room change: ready, the rules, the lobby look, symbols and teams.

use crate::command::Parsed;
use std::time::Instant;

use crate::protocol::{default_room_name, RoomLook, RoomRules, NAME_TAKEN, RENAME_TOO_FAST};
use crate::wire::{Avatar, GameMode, RoomMode};

use super::model::*;
use super::{RoomManager, RENAME_COOLDOWN};

impl RoomManager {
    pub(super) fn set_ready(&mut self, conn: u64, ready: Parsed<bool>) {
        let Some(ready) = self.accept(conn, ready) else {
            return;
        };
        let guard = self.member_of_waiting_room(
            conn,
            "You are not in a waiting room",
            "You are not in a waiting room",
        );
        let Some((room_id, _)) = self.accept(conn, guard) else {
            return;
        };
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
    pub(super) fn set_rules(
        &mut self,
        conn: u64,
        rules: Parsed<RoomRules>,
        game_mode: Parsed<Option<GameMode>>,
    ) {
        let guard = self.host_of_waiting_room(
            conn,
            "Only the room host can change the rules",
            "The rules cannot change while a game is running",
        );
        let Some(room_id) = self.accept(conn, guard) else {
            return;
        };
        let Some(rules) = self.accept(conn, rules) else {
            return;
        };
        let Some(game_mode) = self.accept(conn, game_mode) else {
            return;
        };
        let room = self.rooms.get_mut(&room_id).unwrap();
        room.rules = rules;
        if let Some(game_mode) = game_mode {
            room.game_mode = game_mode;
        }
        for player in room.players.iter_mut() {
            player.ready = false;
        }
        self.broadcast_room_update(&room_id, None);
    }

    /// The host changes how the room shows up while it waits: name, listing, symbol and colour. None of
    /// it changes the game, so nobody has to confirm again.
    pub(super) fn set_room(&mut self, conn: u64, look: Parsed<RoomLook>) {
        let guard = self.host_of_waiting_room(
            conn,
            "Only the room host can change the lobby",
            "The lobby cannot change while a game is running",
        );
        let Some(room_id) = self.accept(conn, guard) else {
            return;
        };
        let Some(look) = self.accept(conn, look) else {
            return;
        };
        let room = self.rooms.get_mut(&room_id).unwrap();
        room.look = look;
        self.broadcast_room_update(&room_id, None);
        // A room that went private leaves the list, and one that went public joins it.
        self.broadcast_lobby();
    }

    /// The host turns the waiting room into a team room or back into a free for all. Going to teams
    /// deals everybody out to the two teams in the order they joined; everybody confirms again.
    pub(super) fn set_mode(&mut self, conn: u64, mode: Parsed<RoomMode>) {
        let guard = self.host_of_waiting_room(
            conn,
            "Only the room host can change the mode",
            "The mode cannot change while a game is running",
        );
        let Some(room_id) = self.accept(conn, guard) else {
            return;
        };
        let Some(mode) = self.accept(conn, mode) else {
            return;
        };
        let room = self.rooms.get_mut(&room_id).unwrap();
        if room.mode == mode {
            return;
        }
        room.mode = mode;
        for (i, player) in room.players.iter_mut().enumerate() {
            player.team = (i % 2) as u8;
            player.ready = false;
        }
        self.broadcast_room_update(&room_id, None);
        self.broadcast_lobby();
    }

    /// A player picks the symbol they show in the game, while the room waits. Nobody has to confirm again.
    pub(super) fn set_avatar(&mut self, conn: u64, avatar: Parsed<Avatar>) {
        let guard = self.member_of_waiting_room(
            conn,
            "You are not in a waiting room",
            "The symbol cannot change while a game is running",
        );
        let Some((room_id, player_id)) = self.accept(conn, guard) else {
            return;
        };
        let Some(avatar) = self.accept(conn, avatar) else {
            return;
        };
        let room = self.rooms.get_mut(&room_id).unwrap();
        if let Some(player) = room.players.iter_mut().find(|p| p.id == player_id) {
            player.avatar = avatar;
        }
        self.broadcast_room_update(&room_id, None);
    }

    /// A player renames themselves while the room waits. The name has passed the same checks as at
    /// joining; nobody has to confirm again.
    pub(super) fn set_name(&mut self, conn: u64, name: Parsed<String>) {
        let guard = self.member_of_waiting_room(
            conn,
            "You are not in a waiting room",
            "The name cannot change while a game is running",
        );
        let Some((room_id, player_id)) = self.accept(conn, guard) else {
            return;
        };
        let Some(name) = self.accept(conn, name) else {
            return;
        };
        let room = self.rooms.get_mut(&room_id).unwrap();
        // The same name again changes nothing, so nobody is told anything.
        if room
            .players
            .iter()
            .any(|p| p.id == player_id && p.name == name)
        {
            return;
        }
        if name_taken(room, &name, Some(player_id)) {
            self.error(conn, NAME_TAKEN);
            return;
        }
        let now = Instant::now();
        if self
            .last_rename
            .get(&conn)
            .is_some_and(|last| now.duration_since(*last) < RENAME_COOLDOWN)
        {
            self.error(conn, RENAME_TOO_FAST);
            return;
        }
        self.last_rename.insert(conn, now);
        let room = self.rooms.get_mut(&room_id).unwrap();
        if let Some(player) = room.players.iter_mut().find(|p| p.id == player_id) {
            // A new name has to be confirmed again: nobody readies up as one person and plays as another.
            player.ready = false;
            player.name = name.clone();
        }
        // A room the host never named is called after the host, so it follows their rename.
        if player_id == 0 && room.name_is_default {
            room.name = default_room_name(&name, room.created_order + 1);
        }
        let listed = player_id == 0 && !room.look.is_private();
        self.broadcast_room_update(&room_id, None);
        // The host's name is on the list beside the room; nobody else's is, and a private room is not on it.
        if listed {
            self.broadcast_lobby();
        }
    }

    /// A player picks their own team; they have to confirm (ready) again, everybody else's choice
    /// stands.
    pub(super) fn set_team(&mut self, conn: u64, team: Parsed<u8>) {
        let guard = self.member_of_waiting_room(
            conn,
            "You are not in a waiting room",
            "You are not in a waiting room",
        );
        let Some((room_id, player_id)) = self.accept(conn, guard) else {
            return;
        };
        let guard = self.require_team_room(&room_id);
        if self.accept(conn, guard).is_none() {
            return;
        }
        let Some(team) = self.accept(conn, team) else {
            return;
        };
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
    pub(super) fn reset_teams(&mut self, conn: u64) {
        let guard = self.host_of_waiting_room(
            conn,
            "Only the room host can reset the teams",
            "The teams cannot change while a game is running",
        );
        let Some(room_id) = self.accept(conn, guard) else {
            return;
        };
        let guard = self.require_team_room(&room_id);
        if self.accept(conn, guard).is_none() {
            return;
        }
        let room = self.rooms.get_mut(&room_id).unwrap();
        for (i, player) in room.players.iter_mut().enumerate() {
            player.team = (i % 2) as u8;
            player.ready = false;
        }
        self.broadcast_room_update(&room_id, None);
    }
}
