//! The host's control over CPU seats while the room waits.

use crate::command::Parsed;
use crate::wire::{CpuLevel, RoomMode};

use super::model::*;
use super::RoomManager;

impl RoomManager {
    /// The room a connection hosts while it waits, or why it may not change the CPU seats.
    pub(super) fn host_of_cpu_seats(&self, conn: u64) -> Result<String, &'static str> {
        self.host_of_waiting_room(
            conn,
            "Only the room host can change the CPU seats",
            "The CPU seats cannot change while a game is running",
        )
    }

    /// The host seats a CPU while the room waits. It is always ready; the humans confirm again.
    pub(super) fn add_cpu(&mut self, conn: u64, level: Parsed<CpuLevel>, team: Parsed<Option<u8>>) {
        let guard = self.host_of_cpu_seats(conn);
        let Some(room_id) = self.accept(conn, guard) else {
            return;
        };
        let Some(level) = self.accept(conn, level) else {
            return;
        };
        let Some(requested_team) = self.accept(conn, team) else {
            return;
        };
        let (full, team, name, avatar) = {
            let room = self.rooms.get(&room_id).unwrap();
            let team = if room.mode == RoomMode::Team {
                requested_team.unwrap_or_else(|| smallest_team(room))
            } else {
                0
            };
            (
                room.players.len() >= room.max_players as usize,
                team,
                free_cpu_name(room, level),
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
            token: String::new(),
            lost_at: None,
            seat_grace: None,
            left: false,
            left_after_round: 0,
            came_from: None,
        });
        unready_humans(room);
        self.broadcast_room_update(&room_id, None);
        self.broadcast_lobby();
    }

    /// The host changes a CPU seat's level or team while the room waits. A new level brings a new name.
    pub(super) fn set_cpu(
        &mut self,
        conn: u64,
        seat: Parsed<usize>,
        level: Parsed<Option<CpuLevel>>,
        team: Parsed<Option<u8>>,
    ) {
        let guard = self.host_of_cpu_seats(conn);
        let Some(room_id) = self.accept(conn, guard) else {
            return;
        };
        let Some(player_id) = self.accept(conn, seat) else {
            return;
        };
        let Some(level) = self.accept(conn, level) else {
            return;
        };
        let Some(team) = self.accept(conn, team) else {
            return;
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
        if team.is_some() && room.mode != RoomMode::Team {
            self.error(conn, "Teams only exist in team rooms");
            return;
        }
        let renamed = level
            .filter(|level| seat.cpu != Some(*level))
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
    pub(super) fn remove_cpu(&mut self, conn: u64, seat: Parsed<usize>) {
        let guard = self.host_of_cpu_seats(conn);
        let Some(room_id) = self.accept(conn, guard) else {
            return;
        };
        let Some(player_id) = self.accept(conn, seat) else {
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
}
