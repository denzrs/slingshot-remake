//! The checks the room handlers start with: the room a connection may change, and why not.

use crate::command::Parsed;
use crate::wire::RoomMode;

use super::model::*;
use super::RoomManager;

impl RoomManager {
    pub(super) fn is_waiting(&self, room_id: &str) -> bool {
        self.rooms
            .get(room_id)
            .is_some_and(|room| room.status == RoomStatus::Waiting)
    }

    /// A parsed field, or the client told why not.
    pub(super) fn accept<T>(&mut self, conn: u64, parsed: Parsed<T>) -> Option<T> {
        match parsed {
            Ok(value) => Some(value),
            Err(reason) => {
                self.error(conn, reason);
                None
            }
        }
    }

    /// The room and seat of a connection whose room is waiting, or the reason it is not.
    pub(super) fn member_of_waiting_room(
        &self,
        conn: u64,
        not_in_room: &'static str,
        running: &'static str,
    ) -> Result<(String, usize), &'static str> {
        let membership = self.memberships.get(&conn).ok_or(not_in_room)?;
        if !self.is_waiting(&membership.room_id) {
            return Err(running);
        }
        Ok((membership.room_id.clone(), membership.player_id))
    }

    /// The room a connection hosts while it waits, or the reason it may not change it.
    pub(super) fn host_of_waiting_room(
        &self,
        conn: u64,
        not_host: &'static str,
        running: &'static str,
    ) -> Result<String, &'static str> {
        let membership = self
            .memberships
            .get(&conn)
            .filter(|membership| membership.player_id == 0)
            .ok_or(not_host)?;
        if !self.is_waiting(&membership.room_id) {
            return Err(running);
        }
        Ok(membership.room_id.clone())
    }

    pub(super) fn require_team_room(&self, room_id: &str) -> Result<(), &'static str> {
        match self.rooms.get(room_id) {
            Some(room) if room.mode == RoomMode::Team => Ok(()),
            _ => Err("Teams only exist in team rooms"),
        }
    }
}
