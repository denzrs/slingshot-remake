//! The data a room is made of, and the rules about it that need no connection or channel.

use crate::protocol::{RoomLook, RoomRules};
use crate::wire::{Avatar, CpuLevel, GameMode, RoomMode};

#[derive(Clone, Copy, PartialEq)]
pub(super) enum RoomStatus {
    Waiting,
    Playing,
}

impl RoomStatus {
    pub(super) fn as_str(self) -> &'static str {
        match self {
            RoomStatus::Waiting => "waiting",
            RoomStatus::Playing => "playing",
        }
    }
}

pub(super) struct Player {
    pub(super) id: usize,
    pub(super) name: String,
    /// The symbol the player shows in an online game.
    pub(super) avatar: Avatar,
    pub(super) ready: bool,
    pub(super) team: u8,
    /// The connection of a human. A CPU seat has none: the host's game runs it.
    pub(super) conn: Option<u64>,
    /// The level of a CPU seat.
    pub(super) cpu: Option<CpuLevel>,
}

impl Player {
    pub(super) fn is_cpu(&self) -> bool {
        self.cpu.is_some()
    }

    /// A human has to confirm (ready); a CPU is always ready.
    pub(super) fn confirmed(&self) -> bool {
        self.ready || self.is_cpu()
    }
}

/// The most people who may watch one room.
pub(super) const MAX_SPECTATORS: usize = 20;

/// Somebody in the stands. Not a seat: spectators take no player index, are never counted among the
/// humans a game needs, and leaving does not end a game.
pub(super) struct Spectator {
    /// Handed out in order and never reused in a room, so a host can key a spectator's points by it.
    pub(super) id: usize,
    pub(super) name: String,
    pub(super) conn: u64,
}

pub(super) struct Room {
    pub(super) id: String,
    /// What the lobby calls the room; set at creation and already past the profanity check.
    pub(super) name: String,
    pub(super) mode: RoomMode,
    pub(super) game_mode: GameMode,
    pub(super) rules: RoomRules,
    pub(super) look: RoomLook,
    pub(super) max_players: i64,
    pub(super) status: RoomStatus,
    pub(super) players: Vec<Player>,
    pub(super) next_player_id: usize,
    pub(super) last_state_seq: i64,
    /// (salt, hash) — the plaintext never leaves the server.
    pub(super) password: Option<(Vec<u8>, Vec<u8>)>,
    pub(super) created_order: u64,
    pub(super) spectators: Vec<Spectator>,
    pub(super) next_spectator_id: usize,
    /// The seed the running game started with, so a spectator who comes late can be told it.
    pub(super) seed: u32,
}

pub(super) struct Membership {
    pub(super) room_id: String,
    pub(super) player_id: usize,
}

/// Where a spectator's connection sits: which room, and which place in its stands.
pub(super) struct Watching {
    pub(super) room_id: String,
    pub(super) spectator_id: usize,
}

/// Whether somebody may walk into the stands of a game that is already running: only a room that is
/// listed (public) and open (no password).
pub(super) fn open_to_latecomers(room: &Room) -> bool {
    !room.look.is_private() && room.password.is_none()
}

/// The team with fewer players, team 0 when they are even: where a newcomer goes.
pub(super) fn smallest_team(room: &Room) -> u8 {
    let in_first = room.players.iter().filter(|p| p.team == 0).count();
    if in_first <= room.players.len() - in_first {
        0
    } else {
        1
    }
}

/// A team game needs somebody in each team.
pub(super) fn teams_playable(room: &Room) -> bool {
    room.mode != RoomMode::Team || {
        let mut present = [false; 2];
        for p in &room.players {
            present[p.team as usize] = true;
        }
        present[0] && present[1]
    }
}

/// The seats with a person in them. A game needs two of them; CPUs alone are played offline.
pub(super) fn humans(room: &Room) -> usize {
    room.players.iter().filter(|p| !p.is_cpu()).count()
}

/// A human may join when a seat is free, or when a CPU seat can give way to them.
pub(super) fn can_take_human(room: &Room) -> bool {
    room.players.len() < room.max_players as usize || room.players.iter().any(Player::is_cpu)
}

/// Whenever the seats change, every human confirms again: the game they agreed to is not the same.
pub(super) fn unready_humans(room: &mut Room) {
    for player in room.players.iter_mut().filter(|p| !p.is_cpu()) {
        player.ready = false;
    }
}

/// The name for a new CPU of this level: the offline name, or the next free number after it.
pub(super) fn free_cpu_name(room: &Room, level: CpuLevel) -> String {
    let base = level.name();
    let taken = |name: &str| room.players.iter().any(|p| p.name == name);
    if !taken(base) {
        return base.to_owned();
    }
    (2..)
        .map(|n| format!("{base} {n}"))
        .find(|name| !taken(name))
        .expect("an unbounded range has a free name")
}

/// A symbol nobody in the room shows yet, so the seats can be told apart.
pub(super) fn free_avatar(room: &Room) -> Avatar {
    Avatar::ALL
        .iter()
        .copied()
        .find(|avatar| room.players.iter().all(|p| p.avatar != *avatar))
        .unwrap_or_default()
}
