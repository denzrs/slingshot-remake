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
    /// The secret that lets a new connection take this seat back (`resume`); empty for a CPU.
    pub(super) token: String,
    /// Set while a running game holds the seat for a connection that dropped.
    pub(super) lost_at: Option<std::time::Instant>,
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

/// How long a running game holds the seat of a dropped connection before giving it up.
pub(super) const SEAT_GRACE: std::time::Duration = std::time::Duration::from_secs(30);

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
    /// The code players type to join. Free again once the room is gone, so it is not an identity.
    pub(super) id: String,
    /// Names the room in the statistics and nothing else: 128 random bits made with the room and
    /// never reused, where the code is only unique among the rooms open now.
    pub(super) uid: String,
    /// What the lobby calls the room; set at creation and already past the profanity check.
    pub(super) name: String,
    /// The host never typed a name: the room is called after the host and follows their rename.
    pub(super) name_is_default: bool,
    pub(super) mode: RoomMode,
    pub(super) game_mode: GameMode,
    pub(super) rules: RoomRules,
    pub(super) look: RoomLook,
    pub(super) max_players: i64,
    pub(super) status: RoomStatus,
    pub(super) players: Vec<Player>,
    pub(super) next_player_id: usize,
    /// Counts the games the room has started; a new one starts the state sequence over (see `relay`).
    pub(super) game: u64,
    /// (salt, hash) — the plaintext never leaves the server.
    pub(super) password: Option<(Vec<u8>, Vec<u8>)>,
    pub(super) created_order: u64,
    pub(super) spectators: Vec<Spectator>,
    pub(super) next_spectator_id: usize,
    /// The seed the running game started with, so a spectator who comes late can be told it.
    pub(super) seed: u32,
    /// Names the running game in the statistics and nothing else: random, and new for every game.
    pub(super) match_id: String,
    /// The last round the host reported, so a round is written down once.
    pub(super) reported_round: i64,
    /// The last turn the host reported, as (round, turn): a turn is written down once, in order.
    pub(super) reported_turn: (i64, i64),
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

/// Whether somebody in the room already goes by `name`, upper or lower case alike. A player's own seat
/// (`except`) does not count, so they can change the case of their own name.
pub(super) fn name_taken(room: &Room, name: &str, except: Option<usize>) -> bool {
    let wanted = name.to_lowercase();
    room.players
        .iter()
        .any(|p| Some(p.id) != except && p.name.to_lowercase() == wanted)
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

impl Room {
    /// Everybody who hears the room: connected players, then spectators.
    pub(super) fn recipients(&self) -> impl Iterator<Item = u64> + '_ {
        self.players
            .iter()
            .filter_map(|p| p.conn)
            .chain(self.spectators.iter().map(|s| s.conn))
    }
}
