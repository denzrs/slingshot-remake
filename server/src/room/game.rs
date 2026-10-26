//! Starting a game, and relaying a running game's input and state.

use std::sync::Arc;

use rand::Rng;
use serde_json::{json, Value};

use crate::command::Parsed;
use crate::protocol::rules_to_value;
use crate::report::{RoundReport, TurnReport};
use crate::stats::{Job, Occupant, RoundFacts, SeatFacts, Stats};
use crate::wire::{CpuLevel, RoomMode};

use super::model::*;
use super::RoomManager;

/// What the statistics need once a report has passed: where to put it and what the room knows.
struct Reporting {
    stats: Arc<Stats>,
    facts: RoundFacts,
    /// The host, whose daily budget the report is written from.
    host: crate::admission::Who,
}

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
        room.game += 1;
        let seed: u32 = rand::thread_rng().gen();
        room.seed = seed;
        room.match_id = format!("{:016x}", rand::thread_rng().gen::<u64>());
        room.reported_round = 0;
        room.reported_turn = (0, 0);
        room.players
            .iter_mut()
            .enumerate()
            .for_each(|(id, player)| player.id = id);
        let start = self.game_start_message(self.rooms.get(room_id).unwrap());
        let room = self.rooms.get(room_id).unwrap();
        let recipients: Vec<u64> = room.recipients().collect();
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

    /// The checks every report from the host has to pass: it comes from the host of a running game
    /// and has one entry per seat. Gives the room, and what the statistics need to know about it
    /// (nothing, when they are off, or when somebody has just left a seat).
    fn reporter(&mut self, conn: u64, seats: usize) -> Option<(String, Option<Reporting>)> {
        let Some(membership) = self.memberships.get(&conn) else {
            self.error(conn, "You are not in a running game");
            return None;
        };
        let (room_id, my_id) = (membership.room_id.clone(), membership.player_id);
        let Some(room) = self.rooms.get(&room_id) else {
            self.error(conn, "You are not in a running game");
            return None;
        };
        if room.status != RoomStatus::Playing {
            self.error(conn, "You are not in a running game");
            return None;
        }
        if my_id != 0 {
            self.error(conn, "Only the room host can report stats");
            return None;
        }
        if seats != room.players.len() {
            self.error(conn, "Stats do not match the seats");
            return None;
        }
        let reporting = self.stats.clone().and_then(|stats| {
            let seats: Option<Vec<SeatFacts>> = room
                .players
                .iter()
                .map(|player| {
                    let occupant = match (player.cpu, player.conn) {
                        (Some(level), _) => Occupant::Cpu(level.as_str()),
                        (None, Some(conn)) => Occupant::Person {
                            ip: self.net.peer_ip(conn)?,
                            name: player.name.clone(),
                        },
                        // Whoever left the game is still the one who played the seat.
                        (None, None) if player.left => Occupant::Person {
                            ip: player.left_from?,
                            name: player.name.clone(),
                        },
                        (None, None) => return None,
                    };
                    Some(SeatFacts {
                        occupant,
                        team: (room.mode == RoomMode::Team).then_some(player.team),
                    })
                })
                .collect();
            Some(Reporting {
                stats,
                host: self.net.who(conn)?,
                facts: RoundFacts {
                    room_id: room.uid.clone(),
                    match_id: room.match_id.clone(),
                    seed: room.seed,
                    game_mode: room.game_mode.as_str(),
                    mode: room.mode.as_str(),
                    rules: rules_to_value(&room.rules),
                    spectators: room.spectators.len(),
                    seats: seats?,
                    local: false,
                },
            })
        });
        Some((room_id, reporting))
    }

    /// The host says how a round went. It is written down once per round, in order.
    pub(super) fn report_round(&mut self, conn: u64, report: Parsed<RoundReport>) {
        let Some(report) = self.accept(conn, report) else {
            return;
        };
        let Some((room_id, reporting)) = self.reporter(conn, report.seats.len()) else {
            return;
        };
        let room = self.rooms.get_mut(&room_id).unwrap();
        if report.round <= room.reported_round {
            self.error(conn, "That round was already reported");
            return;
        }
        room.reported_round = report.round;
        // Queued for the writer: the dispatch is synchronous, the database is not.
        if let Some(Reporting { stats, facts, host }) = reporting {
            if stats.admit(host, report.rows(), std::time::Instant::now()) {
                stats.submit(Job::Round(facts, report));
            }
        }
    }

    /// The host says how a turn went: the shots just flown. A turn is written down once, in order,
    /// and only while its round is still on (the round's own report closes it).
    pub(super) fn report_turn(&mut self, conn: u64, report: Parsed<TurnReport>) {
        let Some(report) = self.accept(conn, report) else {
            return;
        };
        let Some((room_id, reporting)) = self.reporter(conn, report.seats.len()) else {
            return;
        };
        let room = self.rooms.get_mut(&room_id).unwrap();
        if report.round <= room.reported_round {
            self.error(conn, "That round is already over");
            return;
        }
        if (report.round, report.turn) <= room.reported_turn {
            self.error(conn, "That turn was already reported");
            return;
        }
        room.reported_turn = (report.round, report.turn);
        if let Some(Reporting { stats, facts, host }) = reporting {
            if stats.admit(host, report.rows(), std::time::Instant::now()) {
                stats.submit(Job::Turn(facts, report));
            }
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
        let Some(relay) = self.relay_of(&room_id) else {
            self.error(conn, "You are not in a running game");
            return;
        };
        match relay.forward(conn, seq, bytes) {
            super::Forward::Sent => {}
            super::Forward::Refused(reason) => self.error(conn, reason),
            super::Forward::NotHost => self.error(conn, "Only the room host can send state"),
        }
    }
}
