//! The lobby and its rooms: who is in which room, and what each client may do there.
//!
//! `RoomManager` owns the rooms and who sits in them; `Connections` owns the sockets. The handlers
//! are split by what they change: the lobby list, a room's roster, its settings, its CPU seats and
//! the running game.

mod chat;
mod connections;
mod cpu;
mod game;
mod guards;
mod lobby;
mod model;
mod roster;
mod settings;
mod spectate;
#[cfg(test)]
mod tests;

use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::Arc;

use serde_json::{json, Value};

use crate::auth::Hashed;
use crate::codec::Outbound;
use crate::command::RoomCommand;
use crate::leaderboard::Board;
use crate::stats::{Overview, Stats};

use connections::Connections;
use model::*;

pub struct RoomManager {
    rooms: HashMap<String, Room>,
    next_room_order: u64,
    memberships: HashMap<u64, Membership>,
    /// Connections in the stands. They hold no seat, so they are not in `memberships`: everything
    /// that acts on a seat treats them as outsiders.
    watching: HashMap<u64, Watching>,
    net: Connections,
    /// When each connection last renamed itself, so a rename cannot be repeated at the connection's message rate.
    last_rename: HashMap<u64, std::time::Instant>,
    /// Where the host's round reports go; none in the tests that have no business writing files.
    stats: Option<Arc<Stats>>,
}

/// The shortest time between two renames of one connection.
const RENAME_COOLDOWN: std::time::Duration = std::time::Duration::from_secs(1);

impl RoomManager {
    pub fn new() -> Self {
        Self {
            rooms: HashMap::new(),
            next_room_order: 0,
            memberships: HashMap::new(),
            watching: HashMap::new(),
            net: Connections::default(),
            last_rename: HashMap::new(),
            stats: None,
        }
    }

    pub fn with_stats(mut self, stats: Arc<Stats>) -> Self {
        self.stats = Some(stats);
        self
    }

    pub fn connect(
        &mut self,
        conn: u64,
        ip: IpAddr,
        tx: Outbound,
        slow: tokio::sync::watch::Sender<bool>,
    ) {
        self.net.open(conn, ip, tx, slow);
        self.send_lobby(conn);
    }

    pub fn disconnect(&mut self, conn: u64) {
        self.net.close(conn);
        self.last_rename.remove(&conn);
        // A dropped connection in a running game keeps its seat for a while: it may come back.
        if !self.hold_seat(conn) {
            self.remove_from_room(conn, "A player disconnected");
        }
    }

    /// Prune expired password and scrypt timestamps without disturbing active lockouts.
    pub fn sweep(&mut self) {
        self.net.sweep();
    }

    pub fn scrypt_budget_available(&mut self, conn: u64) -> bool {
        self.net.scrypt_budget_available(conn)
    }

    pub fn can_create_room(&self, conn: u64) -> bool {
        self.net.is_connected(conn) && !self.is_placed(conn)
    }

    /// Whether a connection already sits in a room, in a seat or in the stands.
    pub(super) fn is_placed(&self, conn: u64) -> bool {
        self.memberships.contains_key(&conn) || self.watching.contains_key(&conn)
    }

    pub fn password_attempts_exhausted(&self, conn: u64) -> bool {
        self.net.password_attempts_exhausted(conn)
    }

    pub fn join_password_salt(&self, conn: u64, room_id: &str, spectate: bool) -> Option<Hashed> {
        if !self.net.is_connected(conn) || self.is_placed(conn) {
            return None;
        }
        let room = self.rooms.get(room_id)?;
        // The stands of a waiting room take a password like a seat does; a running game has none.
        if room.status != RoomStatus::Waiting || (!spectate && !can_take_human(room)) {
            return None;
        }
        room.password.clone()
    }

    /// Read a raw message and carry it out, for the tests that speak the wire format.
    #[cfg(test)]
    pub fn handle(&mut self, conn: u64, message: &Value) {
        self.dispatch(conn, RoomCommand::parse(message));
    }

    /// Carry out a command. Password work and the daily board are done first, by the router.
    pub fn dispatch(&mut self, conn: u64, command: RoomCommand<'_>) {
        if !self.net.is_connected(conn) {
            return;
        }
        match command {
            RoomCommand::Malformed => self.error(conn, "Malformed message"),
            RoomCommand::Unknown(other) => {
                self.error(conn, &format!("Unknown message type: {other}"))
            }
            RoomCommand::Lobby => self.send_lobby(conn),
            RoomCommand::CreateRoom(create) => self.create_room(conn, create, None),
            RoomCommand::JoinRoom(join) => self.join_room(conn, join, None),
            RoomCommand::Ready(ready) => self.set_ready(conn, ready),
            RoomCommand::SetRules(rules) => self.set_rules(conn, rules),
            RoomCommand::SetRoom(look) => self.set_room(conn, look),
            RoomCommand::SetAvatar(avatar) => self.set_avatar(conn, avatar),
            RoomCommand::SetName(name) => self.set_name(conn, name),
            RoomCommand::SetTeam(team) => self.set_team(conn, team),
            RoomCommand::ResetTeams => self.reset_teams(conn),
            RoomCommand::AddCpu { level, team } => self.add_cpu(conn, level, team),
            RoomCommand::SetCpu { seat, level, team } => self.set_cpu(conn, seat, level, team),
            RoomCommand::RemoveCpu { seat } => self.remove_cpu(conn, seat),
            RoomCommand::StartGame => self.start_game(conn),
            RoomCommand::Input(input) => self.relay_input(conn, input),
            RoomCommand::Chat(text) => self.chat(conn, text),
            RoomCommand::RoundStats(report) => self.report_round(conn, report),
            RoomCommand::TurnStats(report) => self.report_turn(conn, report),
            RoomCommand::LeaveRoom => self.leave_room(conn),
            RoomCommand::Resume(token) => self.resume(conn, token),
        }
    }

    /// Where a connection came from. The board itself is reached from the async dispatch, which can
    /// await it; the room dispatch cannot.
    pub fn peer_ip(&self, conn: u64) -> Option<IpAddr> {
        self.net.peer_ip(conn)
    }

    /// One day's board as it goes on the wire: the top runs, and the caller's own run if it posted one.
    pub fn daily_board(&mut self, conn: u64, day: &str, board: &Board) {
        fn entry(e: &crate::leaderboard::Entry) -> Value {
            json!({ "rank": e.rank, "name": e.name, "score": e.score })
        }
        self.send_value(
            conn,
            &json!({
                "type": "daily_board",
                "day": day,
                "entries": board.entries.iter().map(entry).collect::<Vec<_>>(),
                "you": board.you.as_ref().map(entry),
            }),
        );
    }

    /// The statistics, to await outside the room lock.
    pub fn stats(&self) -> Option<Arc<Stats>> {
        self.stats.clone()
    }

    /// The stats page's numbers as they go on the wire; `None` when the relay keeps no statistics.
    pub fn stats_overview(&mut self, conn: u64, overview: Option<&Overview>) {
        let value = match overview {
            None => {
                json!({ "type": "stats_overview", "enabled": false, "days": [], "localDays": [], "games": [], "betting": null })
            }
            Some(overview) => json!({
                "type": "stats_overview",
                "enabled": true,
                "betting": overview.betting.as_ref().map(|b| json!({
                    "shotTips": b.shot_tips, "shotRight": b.shot_right,
                    "roundTips": b.round_tips, "roundRight": b.round_right,
                    "underdogs": b.underdogs, "stands": b.stands,
                    "bets": b.bets, "staked": b.staked, "paid": b.paid, "won": b.won,
                    "biggestWin": b.biggest_win, "biggestStake": b.biggest_stake,
                })),
                "days": overview.days.iter().map(day_json).collect::<Vec<_>>(),
                "localDays": overview.local_days.iter().map(day_json).collect::<Vec<_>>(),
                "games": overview.games.iter().map(|g| json!({
                    "id": g.id, "at": g.at, "gameMode": g.game_mode, "mode": g.mode,
                    "humans": g.humans, "cpus": g.cpus, "rounds": g.rounds, "points": g.points,
                    "replay": g.replay,
                    "local": g.local,
                })).collect::<Vec<_>>(),
            }),
        };
        self.send_value(conn, &value);
    }

    /// The menu's facts as they go on the wire; `None` when the relay keeps no statistics.
    pub fn stats_facts(&mut self, conn: u64, facts: Option<&[crate::stats::Fact]>) {
        let value = match facts {
            None => json!({ "type": "stats_facts", "enabled": false, "facts": [] }),
            Some(facts) => json!({
                "type": "stats_facts",
                "enabled": true,
                "facts": facts.iter().map(crate::stats::Fact::json).collect::<Vec<_>>(),
            }),
        };
        self.send_value(conn, &value);
    }

    /// One game as the client flies it again; `None` when there is no such game, or not the whole of it.
    pub fn stats_replay(&mut self, conn: u64, id: &str, replay: Option<Value>) {
        self.send_value(
            conn,
            &json!({ "type": "stats_replay", "id": id, "replay": replay }),
        );
    }

    fn send_value(&self, conn: u64, value: &Value) {
        self.net.send_value(conn, value);
    }

    fn send_fast(&self, conn: u64, bytes: &[u8]) {
        self.net.send_fast(conn, bytes);
    }

    pub fn error(&self, conn: u64, message: &str) {
        self.net.error(conn, message);
    }
}

fn day_json(d: &crate::stats::DayTotals) -> Value {
    json!({ "day": d.day, "rounds": d.rounds, "players": d.players, "points": d.points })
}

/// The raw-message entry points the tests use to give a room a prehashed password or a verdict.
#[cfg(test)]
impl RoomManager {
    pub fn handle_create_room(&mut self, conn: u64, message: &Value, prehashed: Option<Hashed>) {
        let RoomCommand::CreateRoom(create) = RoomCommand::parse(message) else {
            panic!("not a create_room message: {message}");
        };
        self.create_room(conn, create, prehashed);
    }

    pub fn handle_join_room(&mut self, conn: u64, message: &Value, preverified: Option<bool>) {
        let RoomCommand::JoinRoom(join) = RoomCommand::parse(message) else {
            panic!("not a join_room message: {message}");
        };
        self.join_room(conn, join, preverified);
    }
}
