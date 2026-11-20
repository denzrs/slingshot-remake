//! Tournaments on the relay: who is in which one, the messages that change them, and the rooms their
//! matches are played in.
//!
//! A connection can be in a tournament and in a room at once: the bracket stays live while it plays.
//! A match's room is opened by whoever of its teams comes first, and is an ordinary team room apart
//! from keeping the setup the tournament gave it. Its host may fill a team's free seats with CPUs, but a
//! game starts only with a person on each side, and a team's person who comes takes a CPU's seat. What happens to the room decides what happens to the
//! match: its game starting starts the match, the host's `match_result` decides it, and the room going
//! back to waiting (or away) without a result makes it ready to play again.

use std::collections::HashMap;
use std::time::Instant;

use rand::Rng;
use serde_json::{json, Value};
use tracing::info;

use crate::command::{Parsed, TournamentCommand};
use crate::protocol::{parse_room_look, RoomLook};
use crate::tournament::{
    new_code, normalize_code, MatchId, MatchState, PersonId, Phase, Settings, Tournament,
    MAX_TEAM_SIZE, SKIP_AFTER,
};
use crate::wire::{Avatar, RoomColor, RoomMode};

use super::model::*;
use super::RoomManager;

/// The most tournaments the relay runs at once.
pub(super) const MAX_TOURNAMENTS: usize = 100;

pub(super) const NOT_IN_TOURNAMENT: &str = "You are not in a tournament";
pub(super) const KEEPS_ITS_SETUP: &str = "A tournament match keeps its setup";

/// The tournaments and who is in them.
#[derive(Default)]
pub(super) struct Tournaments {
    pub(super) by_code: HashMap<String, Tournament>,
    /// Which tournament each connection is in, as which person.
    of_conn: HashMap<u64, (String, PersonId)>,
    /// The room each match is played in, while it has one.
    pub(super) rooms: HashMap<(String, MatchId), String>,
    /// A dev relay's matches between pretend players only, which it plays out itself; see `simulate`.
    pub(super) simulated: HashMap<(String, MatchId), super::simulate::Simulated>,
    /// The people of each tournament a dev relay has seen connected as pretend players: their
    /// matches are still played out when the page that made them went away.
    pub(super) pretend: std::collections::HashSet<(String, PersonId)>,
    /// What each tournament looked like when it was last sent (without what is a person's own), to send only what changed since.
    last_sent: HashMap<String, Value>,
    /// What each connection holds of its tournament: it is sent changes only once it has been sent the whole.
    synced: HashMap<u64, Synced>,
}

/// What a connection was last told about its tournament.
struct Synced {
    code: String,
    you: Value,
}

impl Tournaments {
    /// The connection leaves its tournament, and has to be sent the whole of one again.
    fn unlink(&mut self, conn: u64) -> Option<(String, PersonId)> {
        self.synced.remove(&conn);
        self.of_conn.remove(&conn)
    }
}

/// What differs between two sendings of a tournament, as the fields of a `tournament_patch`: the fields that changed, and of the
/// bracket only the matches that did (or all of it, when its shape did). How long a match has waited is not news by itself.
fn tournament_patch(before: &Value, after: &Value) -> serde_json::Map<String, Value> {
    let mut patch = serde_json::Map::new();
    for key in ["phase", "settings"] {
        if before[key] != after[key] {
            patch.insert(key.into(), after[key].clone());
        }
    }
    for key in ["people", "teams"] {
        if let Some(entries) = list_patch(&before[key], &after[key]) {
            patch.insert(key.into(), entries);
        }
    }
    if let Some(bracket) = bracket_patch(&before["bracket"], &after["bracket"]) {
        patch.insert("bracket".into(), bracket);
    }
    if !patch.is_empty() {
        patch.insert("expiresIn".into(), after["expiresIn"].clone());
    }
    patch
}

/// A list with some entries changed: its new length and the entries that differ or were added, by place.
fn list_patch(before: &Value, after: &Value) -> Option<Value> {
    let (Some(old), Some(new)) = (before.as_array(), after.as_array()) else {
        return (before != after).then(|| after.clone());
    };
    let at: Vec<Value> = new
        .iter()
        .enumerate()
        .filter(|(i, entry)| old.get(*i) != Some(entry))
        .map(|(i, entry)| json!({ "i": i, "v": entry }))
        .collect();
    (!at.is_empty() || old.len() != new.len()).then(|| json!({ "len": new.len(), "at": at }))
}

fn bracket_patch(before: &Value, after: &Value) -> Option<Value> {
    let (Some(old), Some(new)) = (before["levels"].as_array(), after["levels"].as_array()) else {
        return (before != after).then(|| after.clone());
    };
    let same_shape = old.len() == new.len()
        && old
            .iter()
            .zip(new)
            .all(|(a, b)| a.as_array().map(Vec::len) == b.as_array().map(Vec::len));
    if !same_shape {
        return Some(after.clone());
    }
    let mut matches = Vec::new();
    for (level, (old, new)) in old.iter().zip(new).enumerate() {
        for (index, (a, b)) in old.as_array()?.iter().zip(new.as_array()?).enumerate() {
            if !same_match(a, b) {
                matches.push(json!({ "level": level, "index": index, "match": b }));
            }
        }
    }
    let champion_changed = before["champion"] != after["champion"];
    (!matches.is_empty() || champion_changed)
        .then(|| json!({ "matches": matches, "champion": after["champion"] }))
}

fn same_match(a: &Value, b: &Value) -> bool {
    match (a.as_object(), b.as_object()) {
        (Some(a), Some(b)) => {
            a.len() == b.len()
                && a.iter()
                    .all(|(key, value)| key == "waited" || b.get(key) == Some(value))
        }
        _ => a == b,
    }
}

fn phase_str(phase: Phase) -> &'static str {
    match phase {
        Phase::Registration => "registration",
        Phase::Running => "running",
        Phase::Finished => "finished",
    }
}

fn state_str(state: MatchState) -> &'static str {
    match state {
        MatchState::Waiting => "waiting",
        MatchState::Ready => "ready",
        MatchState::Playing => "playing",
        MatchState::Done => "done",
    }
}

/// The points each side of a match room has after the rounds its host reported, the room's team 0 being the match's
/// first team; none while the seats and the reported scores do not match up.
fn side_totals(room: &Room) -> Option<[i64; 2]> {
    (room.scores.len() == room.players.len()).then(|| {
        let mut totals = [0i64; 2];
        for (player, score) in room.players.iter().zip(&room.scores) {
            totals[player.team as usize] += score;
        }
        totals
    })
}

/// How a match being played stands, for those watching the tournament: the rounds played so far and each side's points.
fn live_json(room: Option<&Room>) -> Value {
    match room {
        Some(room) if room.status == RoomStatus::Playing => json!({
            "round": room.reported_round,
            "score": side_totals(room),
        }),
        _ => Value::Null,
    }
}

fn settings_json(settings: &Settings) -> Value {
    json!({
        "teamSize": settings.team_size,
        "maxTeams": settings.max_teams,
        "stages": settings.stages.iter().map(|stage| json!({
            "gameMode": stage.game_mode.as_str(),
            "rules": stage.rules.to_value(),
        })).collect::<Vec<_>>(),
    })
}

impl RoomManager {
    pub(super) fn tournament_command(&mut self, conn: u64, command: TournamentCommand) {
        let now = Instant::now();
        match command {
            TournamentCommand::Create {
                name,
                avatar,
                settings,
            } => self.create_tournament(conn, name, avatar, settings, now),
            TournamentCommand::Join { code, name, avatar } => {
                self.join_tournament(conn, code, name, avatar)
            }
            TournamentCommand::Resume(token) => self.resume_tournament(conn, token),
            TournamentCommand::Leave => self.leave_tournament(conn, now),
            TournamentCommand::CreateTeam { name, closed, slot } => {
                let Some(name) = self.accept(conn, name) else {
                    return;
                };
                self.in_tournament(conn, |t, me, rng| {
                    t.create_team_at(me, name, closed, slot, rng).map(|_| ())
                });
            }
            TournamentCommand::JoinTeam { team, code } => {
                let Some(team) = self.accept(conn, team) else {
                    return;
                };
                self.in_tournament(conn, |t, me, _| t.join_team(me, team, code.as_deref()));
            }
            TournamentCommand::TeamLook {
                team,
                emblem,
                color,
            } => {
                let Some(team) = self.accept(conn, team) else {
                    return;
                };
                let Some(emblem) = self.accept(conn, emblem) else {
                    return;
                };
                let Some(color) = self.accept(conn, color) else {
                    return;
                };
                self.in_tournament(conn, |t, me, _| t.set_team_look(me, team, emblem, color));
            }
            TournamentCommand::LeaveTeam => {
                self.in_tournament(conn, |t, me, _| t.leave_team(me));
            }
            TournamentCommand::Promote(person) => {
                let Some(person) = self.accept(conn, person) else {
                    return;
                };
                self.in_tournament(conn, |t, me, _| t.promote(me, person));
            }
            TournamentCommand::RemoveTeam(team) => {
                let Some(team) = self.accept(conn, team) else {
                    return;
                };
                self.in_tournament(conn, |t, me, _| t.remove_team(me, team, now));
            }
            TournamentCommand::SetStage { stage, rules } => {
                let Some(stage) = self.accept(conn, stage) else {
                    return;
                };
                let Some(rules) = self.accept(conn, rules) else {
                    return;
                };
                self.in_tournament(conn, |t, me, _| t.set_stage(me, stage, rules));
            }
            TournamentCommand::Start => {
                self.in_tournament(conn, |t, me, rng| t.start(me, now, rng));
            }
            TournamentCommand::Skip { game, team } => {
                let Some(game) = self.accept(conn, game) else {
                    return;
                };
                let Some(team) = self.accept(conn, team) else {
                    return;
                };
                self.in_tournament(conn, |t, me, rng| {
                    t.skip(me, game, team, now, rng).map(|_| ())
                });
            }
            TournamentCommand::Enter(avatar) => self.enter_match(conn, avatar),
            TournamentCommand::Watch(game) => self.watch_match(conn, game),
            TournamentCommand::Result(side) => self.match_result(conn, side, now),
        }
        self.sync_tournament_rooms(now);
    }

    /// Change the connection's tournament and tell everybody in it, or tell the connection why not.
    fn in_tournament(
        &mut self,
        conn: u64,
        change: impl FnOnce(
            &mut Tournament,
            PersonId,
            &mut rand::rngs::ThreadRng,
        ) -> Result<(), &'static str>,
    ) {
        let Some((code, me)) = self.tournaments.of_conn.get(&conn).cloned() else {
            self.error(conn, NOT_IN_TOURNAMENT);
            return;
        };
        let Some(tournament) = self.tournaments.by_code.get_mut(&code) else {
            self.error(conn, NOT_IN_TOURNAMENT);
            return;
        };
        match change(tournament, me, &mut rand::thread_rng()) {
            Ok(()) => self.broadcast_tournament(&code),
            Err(refusal) => self.error(conn, refusal),
        }
    }

    fn create_tournament(
        &mut self,
        conn: u64,
        name: Parsed<String>,
        avatar: Parsed<Avatar>,
        settings: Parsed<Settings>,
        now: Instant,
    ) {
        let Some(name) = self.accept(conn, name) else {
            return;
        };
        let Some(avatar) = self.accept(conn, avatar) else {
            return;
        };
        let Some(settings) = self.accept(conn, settings) else {
            return;
        };
        if self.tournaments.of_conn.contains_key(&conn) {
            self.error(conn, "Leave your tournament first");
            return;
        }
        if self.tournaments.by_code.len() >= MAX_TOURNAMENTS {
            self.error(conn, "Too many tournaments are running – try again later");
            return;
        }
        let code = loop {
            let candidate = new_code(6, &mut rand::thread_rng());
            if !self.tournaments.by_code.contains_key(&candidate) {
                break candidate;
            }
        };
        let (mut tournament, me) =
            Tournament::new(settings, name, conn, now, &mut rand::thread_rng());
        tournament.people[me].avatar = avatar;
        info!(conn, tournament = %code, "tournament created");
        self.tournaments.by_code.insert(code.clone(), tournament);
        self.tournaments.of_conn.insert(conn, (code.clone(), me));
        self.broadcast_tournament(&code);
    }

    fn join_tournament(
        &mut self,
        conn: u64,
        code: Parsed<String>,
        name: Parsed<String>,
        avatar: Parsed<Avatar>,
    ) {
        let Some(code) = self.accept(conn, code) else {
            return;
        };
        let code = normalize_code(&code);
        let Some(name) = self.accept(conn, name) else {
            return;
        };
        let Some(avatar) = self.accept(conn, avatar) else {
            return;
        };
        if self.tournaments.of_conn.contains_key(&conn) {
            self.error(conn, "Leave your tournament first");
            return;
        }
        let Some(tournament) = self.tournaments.by_code.get_mut(&code) else {
            self.error(conn, "Tournament not found");
            return;
        };
        match tournament.join(name, conn, &mut rand::thread_rng()) {
            Ok(me) => {
                tournament.people[me].avatar = avatar;
                self.tournaments.of_conn.insert(conn, (code.clone(), me));
                self.broadcast_tournament(&code);
            }
            Err(refusal) => self.error(conn, refusal),
        }
    }

    fn resume_tournament(&mut self, conn: u64, token: Parsed<String>) {
        let Some(token) = self.accept(conn, token) else {
            return;
        };
        if self.tournaments.of_conn.contains_key(&conn) {
            self.error(conn, "You are already in a tournament");
            return;
        }
        let found = self.tournaments.by_code.iter().find_map(|(code, t)| {
            t.person_with_token(&token)
                .map(|person| (code.clone(), person))
        });
        let Some((code, person)) = found else {
            self.send_value(
                conn,
                &json!({ "type": "tournament_resume_failed", "message": "The tournament is over" }),
            );
            return;
        };
        let tournament = self.tournaments.by_code.get_mut(&code).unwrap();
        // A half-dead old connection may still be on the person: the token wins.
        if let Some(old) = tournament.people[person].conn {
            self.tournaments.synced.remove(&old);
            self.tournaments.of_conn.remove(&old);
        }
        tournament.resume(person, conn);
        self.tournaments
            .of_conn
            .insert(conn, (code.clone(), person));
        self.broadcast_tournament(&code);
    }

    /// The person leaves the tournament for good (see `Tournament::leave`).
    fn leave_tournament(&mut self, conn: u64, now: Instant) {
        let Some((code, me)) = self.tournaments.unlink(conn) else {
            self.error(conn, NOT_IN_TOURNAMENT);
            return;
        };
        if let Some(tournament) = self.tournaments.by_code.get_mut(&code) {
            tournament.leave(me, now);
        }
        self.send_value(conn, &json!({ "type": "tournament_left" }));
        self.broadcast_tournament(&code);
    }

    /// A connection went away: the person stays, with their team.
    pub(super) fn tournament_disconnect(&mut self, conn: u64) {
        let Some((code, me)) = self.tournaments.unlink(conn) else {
            return;
        };
        if let Some(tournament) = self.tournaments.by_code.get_mut(&code) {
            tournament.disconnect(me, Instant::now());
        }
        self.broadcast_tournament(&code);
    }

    /// The connection's team's match, with the side of the room the team plays on.
    fn my_match(&self, conn: u64) -> Result<(String, MatchId, u8), &'static str> {
        let (code, me) = self
            .tournaments
            .of_conn
            .get(&conn)
            .ok_or(NOT_IN_TOURNAMENT)?;
        let tournament = &self.tournaments.by_code[code];
        let team = tournament.people[*me].team.ok_or("You are not in a team")?;
        let bracket = tournament
            .bracket
            .as_ref()
            .ok_or("The tournament has not started")?;
        let game = bracket
            .current_match(team)
            .ok_or("Your team has no match to play")?;
        let side = bracket
            .get(game)
            .teams
            .iter()
            .position(|t| *t == Some(team));
        Ok((
            code.clone(),
            game,
            side.expect("the team is in its match") as u8,
        ))
    }

    /// Take a seat in the team's ready match: whoever comes first opens its room and hosts it. When the
    /// team's seats are taken, or the game already runs, the stands instead.
    fn enter_match(&mut self, conn: u64, avatar: Parsed<Avatar>) {
        let Some(avatar) = self.accept(conn, avatar) else {
            return;
        };
        let (code, game, side) = match self.my_match(conn) {
            Ok(found) => found,
            Err(refusal) => {
                self.error(conn, refusal);
                return;
            }
        };
        let room_id = self.tournaments.rooms.get(&(code.clone(), game)).cloned();
        if let Some(room_id) = &room_id {
            if self.room_of(conn).as_deref() == Some(room_id.as_str()) {
                return;
            }
        }
        if self.is_placed(conn) {
            self.error(conn, "Leave your current room first");
            return;
        }
        let (_, me) = self.tournaments.of_conn[&conn].clone();
        let tournament = self
            .tournaments
            .by_code
            .get_mut(&code)
            .expect("my_match found it");
        tournament.people[me].avatar = avatar;
        let tournament = &*tournament;
        let name = tournament.people[me].name.clone();
        let team_size = tournament.settings.team_size;
        if tournament.bracket.as_ref().unwrap().get(game).state != MatchState::Ready {
            self.watch_match(conn, Ok(game));
            return;
        }
        let Some(room_id) = room_id else {
            self.open_match_room(conn, &code, game, side, name, avatar);
            return;
        };
        let room = &self.rooms[&room_id];
        let people = room
            .players
            .iter()
            .filter(|p| p.team == side && !p.left && !p.is_cpu())
            .count();
        if room.status != RoomStatus::Waiting || people >= team_size {
            self.watch_match(conn, Ok(game));
            return;
        }
        // A CPU keeps a seat of the team only until one of its people comes: the newest gives way.
        if seats_on(room, side) >= team_size {
            let newest_cpu = room
                .players
                .iter()
                .rev()
                .find(|p| p.team == side && p.is_cpu())
                .map(|p| p.id);
            if let Some(cpu_id) = newest_cpu {
                self.remove_player(&room_id, cpu_id);
            }
        }
        self.add_player(&room_id, conn, name, avatar);
        let room = self.rooms.get_mut(&room_id).unwrap();
        room.players.last_mut().unwrap().team = side;
        unready_humans(room);
        self.broadcast_room_update(&room_id, None);
    }

    fn open_match_room(
        &mut self,
        conn: u64,
        code: &str,
        game: MatchId,
        side: u8,
        name: String,
        avatar: Avatar,
    ) {
        let tournament = &self.tournaments.by_code[code];
        let stage = tournament
            .rules_for(game)
            .expect("a match of the bracket has rules")
            .clone();
        let teams = tournament.bracket.as_ref().unwrap().get(game).teams;
        let team_name =
            |side: usize| teams[side].map_or("?", |t| tournament.teams[t].name.as_str());
        let room_name = format!("{} – {}", team_name(0), team_name(1));
        let team_names = [team_name(0).to_owned(), team_name(1).to_owned()];
        let team_color =
            |side: usize| teams[side].map_or(RoomColor::default(), |t| tournament.teams[t].color);
        let team_colors = [team_color(0), team_color(1)];
        let max_players = (2 * tournament.settings.team_size) as i64;
        debug_assert!(tournament.settings.team_size <= MAX_TEAM_SIZE);
        let look: RoomLook =
            parse_room_look(&json!({ "visibility": "private" })).expect("a private look");
        let id = self.new_room_id();
        let created_order = self.next_room_order;
        self.next_room_order += 1;
        self.rooms.insert(
            id.clone(),
            Room {
                id: id.clone(),
                uid: format!("{:032x}", rand::thread_rng().gen::<u128>()),
                name: room_name
                    .chars()
                    .take(crate::protocol::MAX_ROOM_NAME_LENGTH)
                    .collect(),
                name_is_default: false,
                mode: RoomMode::Team,
                game_mode: stage.game_mode,
                rules: stage.rules,
                look,
                max_players,
                status: RoomStatus::Waiting,
                players: Vec::new(),
                next_player_id: 0,
                game: 0,
                password: None,
                created_order,
                spectators: Vec::new(),
                next_spectator_id: 0,
                seed: 0,
                match_id: String::new(),
                reported_round: 0,
                reported_turn: (0, 0),
                seat_change_lost: false,
                tournament: Some(MatchRef {
                    code: code.to_owned(),
                    game,
                    team_names,
                    team_colors,
                }),
                scores: Vec::new(),
            },
        );
        self.tournaments
            .rooms
            .insert((code.to_owned(), game), id.clone());
        self.add_player(&id, conn, name, avatar);
        self.rooms.get_mut(&id).unwrap().players[0].team = side;
        info!(conn, room = %id, tournament = %code, "match room opened");
        self.broadcast_room_update(&id, None);
        self.broadcast_tournament(code);
    }

    /// Watch a match of one's tournament from its stands, whether it waits or runs.
    fn watch_match(&mut self, conn: u64, game: Parsed<MatchId>) {
        let Some(game) = self.accept(conn, game) else {
            return;
        };
        let Some((code, me)) = self.tournaments.of_conn.get(&conn).cloned() else {
            self.error(conn, NOT_IN_TOURNAMENT);
            return;
        };
        let Some(room_id) = self.tournaments.rooms.get(&(code.clone(), game)).cloned() else {
            self.error(conn, "That match is not being played");
            return;
        };
        if self.room_of(conn).as_deref() == Some(room_id.as_str()) {
            return;
        }
        if self.is_placed(conn) {
            self.error(conn, "Leave your current room first");
            return;
        }
        if !self.net.allow_spectate_join(conn) {
            self.error(conn, "You are coming and going too fast");
            return;
        }
        let name = self.tournaments.by_code[&code].people[me].name.clone();
        let room = self.rooms.get_mut(&room_id).unwrap();
        if room.spectators.len() >= MAX_SPECTATORS {
            self.error(conn, "The stands are full");
            return;
        }
        let id = room.next_spectator_id;
        room.next_spectator_id += 1;
        room.spectators.push(Spectator { id, name, conn });
        let playing = room.status == RoomStatus::Playing;
        self.watching.insert(
            conn,
            Watching {
                room_id: room_id.clone(),
                spectator_id: id,
            },
        );
        self.broadcast_room_update(&room_id, None);
        if playing {
            self.catch_up(conn, &room_id);
        }
    }

    /// The host of a match room says which side won. It is held to the last scores the host reported:
    /// the winner cannot be the side that was behind.
    fn match_result(&mut self, conn: u64, side: Parsed<u8>, now: Instant) {
        let Some(side) = self.accept(conn, side) else {
            return;
        };
        let Some(membership) = self.memberships.get(&conn) else {
            self.error(conn, "You are not in a running game");
            return;
        };
        let room = &self.rooms[&membership.room_id];
        if membership.player_id != 0 {
            self.error(conn, "Only the room host can report the result");
            return;
        }
        let Some(MatchRef { code, game, .. }) = room.tournament.clone() else {
            self.error(conn, "This is not a tournament match");
            return;
        };
        if room.status != RoomStatus::Playing {
            self.error(conn, "You are not in a running game");
            return;
        }
        let totals = side_totals(room);
        if totals.is_some_and(|totals| totals[side as usize] < totals[1 - side as usize]) {
            self.error(conn, "That is not how the game ended");
            return;
        }
        let Some(tournament) = self.tournaments.by_code.get_mut(&code) else {
            return;
        };
        let teams = tournament.bracket.as_ref().unwrap().get(game).teams;
        let Some(winner) = teams[side as usize] else {
            return;
        };
        match tournament.match_won(game, winner, now) {
            Ok(()) => {
                if let Some(totals) = totals {
                    tournament.record_score(game, totals);
                }
                info!(tournament = %code, ?game, winner, "match decided");
                self.broadcast_tournament(&code);
            }
            Err(refusal) => self.error(conn, refusal),
        }
    }

    /// Bring the tournaments up to date with their rooms. A game that began starts its match; a room that
    /// went back to waiting, or away, without a result makes its match ready to play again; a room whose
    /// match is decided closes once its game is over. Called after every step that may change a room.
    pub(super) fn sync_tournament_rooms(&mut self, now: Instant) {
        let rooms: Vec<((String, MatchId), String)> = self
            .tournaments
            .rooms
            .iter()
            .map(|(key, room)| (key.clone(), room.clone()))
            .collect();
        for ((code, game), room_id) in rooms {
            let status = self.rooms.get(&room_id).map(|room| room.status);
            let Some(tournament) = self.tournaments.by_code.get_mut(&code) else {
                self.tournaments.rooms.remove(&(code, game));
                self.close_match_room(&room_id, "The tournament is over");
                continue;
            };
            let state = tournament.bracket.as_ref().map(|b| b.get(game).state);
            let changed = match (status, state) {
                (None, Some(MatchState::Playing)) => {
                    self.tournaments.rooms.remove(&(code.clone(), game));
                    tournament.match_abandoned(game, now).is_ok()
                }
                (None, _) => {
                    self.tournaments.rooms.remove(&(code.clone(), game));
                    true
                }
                (Some(RoomStatus::Playing), Some(MatchState::Ready)) => {
                    tournament.match_started(game).is_ok()
                }
                (Some(RoomStatus::Waiting), Some(MatchState::Playing)) => {
                    tournament.match_abandoned(game, now).is_ok()
                }
                (Some(RoomStatus::Waiting), Some(MatchState::Done)) => {
                    self.tournaments.rooms.remove(&(code.clone(), game));
                    self.close_match_room(&room_id, "The match is over");
                    true
                }
                _ => false,
            };
            if changed {
                self.broadcast_tournament(&code);
            }
        }
    }

    /// Close a match's room: everybody in it, seats and stands, is told and goes back to the bracket.
    fn close_match_room(&mut self, room_id: &str, message: &str) {
        let Some(room) = self.rooms.remove(room_id) else {
            return;
        };
        for other in room.recipients().collect::<Vec<_>>() {
            self.memberships.remove(&other);
            self.watching.remove(&other);
            self.net.forget_spectator(other);
            self.send_value(other, &json!({ "type": "room_closed", "message": message }));
        }
        // Lets go of the room's relay and its seats' tokens.
        self.sync_room(room_id);
    }

    /// What has to happen with time: tournaments that ran out end, and a tournament left without an
    /// organizer gets one. Called every few seconds.
    pub(super) fn tick_tournaments(&mut self, now: Instant) {
        let expired: Vec<String> = self
            .tournaments
            .by_code
            .iter()
            .filter(|(_, t)| t.expired(now))
            .map(|(code, _)| code.clone())
            .collect();
        for code in expired {
            let tournament = self.tournaments.by_code.remove(&code).unwrap();
            info!(tournament = %code, "tournament ran out");
            for person in &tournament.people {
                if let Some(conn) = person.conn {
                    self.tournaments.unlink(conn);
                    self.send_value(
                        conn,
                        &json!({ "type": "tournament_closed", "message": "The tournament ran out" }),
                    );
                }
            }
        }
        let mut named = Vec::new();
        for (code, tournament) in &mut self.tournaments.by_code {
            if tournament.tick(now, &mut rand::thread_rng()).is_some() {
                named.push(code.clone());
            }
        }
        // Who watches a match, and how long one has waited, change without a message of their own: found by comparing.
        for (code, tournament) in &self.tournaments.by_code {
            if tournament.bracket.is_some() && !named.contains(code) {
                named.push(code.clone());
            }
        }
        for code in named {
            self.broadcast_tournament(&code);
        }
        let Tournaments {
            by_code,
            of_conn,
            last_sent,
            synced,
            ..
        } = &mut self.tournaments;
        last_sent.retain(|code, _| by_code.contains_key(code));
        synced.retain(|conn, _| of_conn.contains_key(conn));
        self.sync_tournament_rooms(now);
        self.simulate_matches(now, &mut rand::thread_rng());
    }

    /// Whether what the connection does can change a tournament: it is in one, or in the room of one of its matches.
    pub(super) fn concerns_tournament(&self, conn: u64, room: Option<&str>) -> bool {
        self.tournaments.of_conn.contains_key(&conn)
            || room.is_some_and(|room| self.is_match_room(room))
    }

    /// Whether the connection's room is a tournament match, whose setup nobody changes.
    pub(super) fn in_match_room(&self, conn: u64) -> bool {
        self.memberships
            .get(&conn)
            .and_then(|m| self.rooms.get(&m.room_id))
            .is_some_and(|room| room.tournament.is_some())
    }

    /// Whether a room is a tournament match, which is entered through the tournament only.
    pub(super) fn is_match_room(&self, room_id: &str) -> bool {
        self.rooms
            .get(room_id)
            .is_some_and(|room| room.tournament.is_some())
    }

    /// Tell everybody connected to a tournament how it stands, each with what is theirs. A connection that holds the
    /// tournament already is sent what changed since (`tournament_patch`); one that does not, the whole of it.
    pub(super) fn broadcast_tournament(&mut self, code: &str) {
        let Some(tournament) = self.tournaments.by_code.get(code) else {
            return;
        };
        let base = self.tournament_json(code, tournament, Instant::now());
        let patch = self
            .tournaments
            .last_sent
            .get(code)
            .map(|before| tournament_patch(before, &base));
        let mut sends = Vec::new();
        for (me, person) in tournament.people.iter().enumerate() {
            let Some(conn) = person.conn else {
                continue;
            };
            let you = json!({
                "id": me,
                "token": person.token,
                "organizer": person.organizer,
                "team": person.team,
            });
            // A closed team's code is for its members, who hand it on.
            let teams = || {
                let mut teams = base["teams"].clone();
                if let Some(team) = person.team {
                    teams[team]["code"] = json!(tournament.teams[team].code);
                }
                teams
            };
            let held = self
                .tournaments
                .synced
                .get(&conn)
                .filter(|held| held.code == code);
            let message = match (&patch, held) {
                (Some(patch), Some(held)) => {
                    let mut message = patch.clone();
                    if held.you["team"] != you["team"] {
                        // Another team is yours: its code comes with it, so the teams come whole.
                        message.insert("teams".into(), teams());
                    } else if let (Some(team), Some(entries)) = (
                        person.team,
                        message
                            .get_mut("teams")
                            .and_then(|t| t["at"].as_array_mut()),
                    ) {
                        for entry in entries.iter_mut().filter(|e| e["i"] == json!(team)) {
                            entry["v"]["code"] = json!(tournament.teams[team].code);
                        }
                    }
                    if held.you != you {
                        message.insert("you".into(), you.clone());
                    }
                    if message.is_empty() {
                        continue;
                    }
                    message.insert("type".into(), json!("tournament_patch"));
                    message.insert("code".into(), json!(code));
                    Value::Object(message)
                }
                _ => {
                    let mut message = base.clone();
                    message["teams"] = teams();
                    message["you"] = you.clone();
                    message
                }
            };
            sends.push((conn, message, you));
        }
        for (conn, message, you) in sends {
            self.send_value(conn, &message);
            self.tournaments.synced.insert(
                conn,
                Synced {
                    code: code.to_owned(),
                    you,
                },
            );
        }
        self.tournaments.last_sent.insert(code.to_owned(), base);
    }

    fn tournament_json(&self, code: &str, tournament: &Tournament, now: Instant) -> Value {
        let bracket = tournament.bracket.as_ref().map(|bracket| {
            let mut levels: Vec<Vec<Value>> = vec![Vec::new(); bracket.depth()];
            for (id, m) in bracket.matches() {
                let room = self.tournaments.rooms.get(&(code.to_owned(), id));
                let ready_for = tournament.ready_for(id, now);
                levels[id.level].push(json!({
                    "teams": m.teams,
                    "state": state_str(m.state),
                    "winner": m.winner,
                    "bye": m.bye,
                    "score": m.score,
                    "room": room.is_some(),
                    "watching": room.and_then(|r| self.rooms.get(r)).map_or(0, |r| r.spectators.len()),
                    "live": match self.tournaments.simulated.get(&(code.to_owned(), id)) {
                        Some(sim) if m.state == MatchState::Playing => sim.live_json(),
                        _ => live_json(room.and_then(|r| self.rooms.get(r)).filter(|_| m.state == MatchState::Playing)),
                    },
                    "simulated": self.tournaments.simulated.contains_key(&(code.to_owned(), id)),
                    "waited": ready_for.map(|d| d.as_secs()),
                    "skippable": ready_for.is_some_and(|d| d >= SKIP_AFTER),
                }));
            }
            json!({ "levels": levels, "champion": bracket.champion() })
        });
        json!({
            "type": "tournament",
            "code": code,
            "phase": phase_str(tournament.phase),
            "settings": settings_json(&tournament.settings),
            "expiresIn": tournament.expires_in(now).as_secs(),
            "people": tournament.people.iter().map(|p| json!({
                "name": p.name,
                "avatar": p.avatar.as_str(),
                "connected": p.conn.is_some(),
                "team": p.team,
                "organizer": p.organizer,
                "gone": p.gone,
            })).collect::<Vec<_>>(),
            "teams": tournament.teams.iter().enumerate().map(|(id, t)| json!({
                "name": t.name,
                "slot": t.slot,
                "closed": t.code.is_some(),
                "emblem": t.emblem.as_str(),
                "color": t.color.as_str(),
                "members": t.members,
                "withdrawn": t.withdrawn,
                "present": tournament.present(id),
            })).collect::<Vec<_>>(),
            "bracket": bracket,
        })
    }
}

#[cfg(test)]
impl RoomManager {
    pub(super) fn forget_sync(&mut self, conn: u64) {
        self.tournaments.synced.remove(&conn);
    }

    pub(super) fn tournaments_is_empty(&self) -> bool {
        self.tournaments.by_code.is_empty() && self.tournaments.of_conn.is_empty()
    }
}
