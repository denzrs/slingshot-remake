//! Tournaments through the wire: making one, teams, the start, match rooms, results and skips.

use std::net::{IpAddr, Ipv4Addr};
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tokio::sync::mpsc;

use super::*;
use crate::protocol::{rules_to_value, DEFAULT_RULES};
use crate::tournament::{LIFETIME, ORGANIZER_GRACE};

type Rx = mpsc::Receiver<crate::codec::WireMessage>;

fn connect(manager: &mut RoomManager, id: u64) -> Rx {
    let (tx, rx) = mpsc::channel(512);
    let (slow, _) = tokio::sync::watch::channel(false);
    manager.connect(id, IpAddr::V4(Ipv4Addr::LOCALHOST), tx, slow);
    rx
}

fn drain(rx: &mut Rx) -> Vec<Value> {
    let mut messages = Vec::new();
    while let Ok(crate::codec::WireMessage::Binary(bytes, _permit)) = rx.try_recv() {
        if crate::codec::state_header(&bytes).is_none() {
            messages.push(rmp_serde::from_slice(&bytes).unwrap());
        }
    }
    messages
}

fn last(messages: &[Value], ty: &str) -> Option<Value> {
    messages.iter().rev().find(|m| m["type"] == ty).cloned()
}

fn errors(messages: &[Value]) -> Vec<String> {
    messages
        .iter()
        .filter(|m| m["type"] == "error")
        .map(|m| m["message"].as_str().unwrap_or_default().to_owned())
        .collect()
}

fn create_message(name: &str, team_size: usize) -> Value {
    let rules = rules_to_value(&DEFAULT_RULES);
    json!({
        "type": "tournament_create", "name": name, "avatar": "rocket", "teamSize": team_size, "maxTeams": 8,
        "stages": [
            {"gameMode": "horizon", "rules": rules},
            {"gameMode": "classic", "rules": rules},
            {"gameMode": "classic", "rules": rules},
            {"gameMode": "solar", "rules": rules},
        ],
    })
}

struct Table {
    rooms: RoomManager,
    rx: Vec<Rx>,
    code: String,
}

impl Table {
    /// A tournament made by connection 0, with `people` more connections (1, 2, …) in it.
    fn new(team_size: usize, people: usize) -> Self {
        let mut rooms = RoomManager::new();
        let mut rx = vec![connect(&mut rooms, 0)];
        rooms.handle(0, &create_message("Orga", team_size));
        let update = last(&drain(&mut rx[0]), "tournament").expect("a tournament update");
        let code = update["code"].as_str().unwrap().to_owned();
        let mut table = Self { rooms, rx, code };
        for n in 1..=people {
            table.rx.push(connect(&mut table.rooms, n as u64));
            let code = table.code.clone();
            table.send(
                n,
                json!({"type": "tournament_join", "code": code, "name": format!("P{n}"), "avatar": "gem"}),
            );
        }
        table.drain_all();
        table
    }

    fn send(&mut self, conn: usize, message: Value) -> Vec<Value> {
        self.rooms.handle(conn as u64, &message);
        drain(&mut self.rx[conn])
    }

    fn drain_all(&mut self) {
        for rx in &mut self.rx {
            drain(rx);
        }
    }

    /// What the tournament looks like to one connection now.
    fn view(&mut self, conn: usize) -> Value {
        // Sent anew as to a connection that has just come: the whole of it, not what changed.
        self.rooms.forget_sync(conn as u64);
        self.rooms.broadcast_tournament(&self.code.clone());
        let seen = last(&drain(&mut self.rx[conn]), "tournament").expect("a tournament update");
        self.drain_all();
        seen
    }

    fn team(&mut self, conn: usize, name: &str) {
        let sent = self.send(
            conn,
            json!({"type": "tournament_create_team", "name": name, "closed": false}),
        );
        assert!(errors(&sent).is_empty(), "{sent:?}");
    }

    fn join_team(&mut self, conn: usize, team: usize) {
        let sent = self.send(conn, json!({"type": "tournament_join_team", "team": team}));
        assert!(errors(&sent).is_empty(), "{sent:?}");
    }

    fn start(&mut self) {
        let sent = self.send(0, json!({"type": "tournament_start"}));
        assert!(errors(&sent).is_empty(), "{sent:?}");
        self.drain_all();
    }

    fn enter(&mut self, conn: usize) -> Vec<Value> {
        self.send(
            conn,
            json!({"type": "tournament_enter", "avatar": "rocket"}),
        )
    }

    fn room_of(&self, conn: usize) -> Option<&Room> {
        self.rooms
            .room_of(conn as u64)
            .and_then(|id| self.rooms.rooms.get(&id))
    }
}

/// Two duelling teams, one person each (connections 1 and 2), started.
fn duel() -> Table {
    let mut table = Table::new(1, 2);
    table.team(1, "Rot");
    table.team(2, "Blau");
    table.start();
    table
}

/// Play the duel's final to its end: both enter, the host starts, a round is reported in which the
/// host's side leads, and the host reports the result.
fn play_final(table: &mut Table) -> (usize, usize) {
    table.enter(1);
    table.enter(2);
    let host = table.room_of(1).unwrap().players[0].conn.unwrap() as usize;
    let guest = 3 - host;
    table.send(guest, json!({"type": "ready", "ready": true}));
    let sent = table.send(host, json!({"type": "start_game"}));
    assert!(errors(&sent).is_empty(), "{sent:?}");
    (host, guest)
}

fn seat_report(scores: &[i64]) -> Value {
    let players: Vec<Value> = scores
        .iter()
        .map(|score| json!({"score": score, "shots": 1, "kills": 0, "swingbys": 0, "grazes": 0, "ownGoals": 0, "pickups": 0, "saves": 0, "alive": true}))
        .collect();
    json!({
        "type": "round_stats", "round": 1, "title": "hit", "survivor": 0, "team": null,
        "seconds": 20.0, "planets": 3, "players": players, "records": {},
    })
}

#[test]
fn a_tournament_is_made_and_joined_with_its_code() {
    let mut table = Table::new(2, 1);
    let view = table.view(1);
    assert_eq!(view["phase"], "registration");
    assert_eq!(view["settings"]["teamSize"], 2);
    assert_eq!(view["settings"]["stages"][0]["gameMode"], "horizon");
    assert_eq!(view["people"].as_array().unwrap().len(), 2);
    // Each person keeps the symbol they came with.
    assert_eq!(view["people"][0]["avatar"], "rocket");
    assert_eq!(view["people"][1]["avatar"], "gem");
    assert_eq!(view["you"]["id"], 1);
    assert_eq!(view["you"]["organizer"], false);
    assert!(view["you"]["token"].as_str().is_some_and(|t| !t.is_empty()));
    assert!(view["bracket"].is_null());

    let stranger = table.rx.len();
    table.rx.push(connect(&mut table.rooms, stranger as u64));
    let sent = table.send(
        stranger,
        json!({"type": "tournament_join", "code": "nope", "name": "X", "avatar": "gem"}),
    );
    assert_eq!(errors(&sent), ["Tournament not found"]);
    let code = table.code.clone();
    let sent = table.send(
        stranger,
        json!({"type": "tournament_join", "code": code, "name": "p1", "avatar": "gem"}),
    );
    assert_eq!(errors(&sent), [crate::tournament::NAME_TAKEN]);
    // A code is found whatever case it is typed in.
    let sent = table.send(
        stranger,
        json!({"type": "tournament_join", "code": format!(" {} ", code.to_lowercase()), "name": "Neu", "avatar": "gem"}),
    );
    assert!(errors(&sent).is_empty(), "{sent:?}");
}

#[test]
fn malformed_settings_are_refused() {
    let mut rooms = RoomManager::new();
    let mut rx = connect(&mut rooms, 1);
    for (key, value) in [
        ("teamSize", json!(4)),
        ("teamSize", json!(0)),
        ("maxTeams", json!(17)),
        ("stages", json!([])),
    ] {
        let mut message = create_message("Orga", 1);
        message[key] = value;
        rooms.handle(1, &message);
        assert_eq!(errors(&drain(&mut rx)), ["Malformed tournament settings"]);
    }
    // A tournament match has to end: an endless level is refused, though a room of its own may play one.
    let mut message = create_message("Orga", 1);
    message["stages"][2]["rules"]["rounds"] = json!(0);
    rooms.handle(1, &message);
    assert_eq!(errors(&drain(&mut rx)), ["Malformed tournament settings"]);
    assert!(rooms.tournaments_is_empty());
}

#[test]
fn a_closed_teams_code_goes_to_its_members_only() {
    let mut table = Table::new(2, 2);
    table.send(
        1,
        json!({"type": "tournament_create_team", "name": "Rot", "closed": true}),
    );
    let mine = table.view(1);
    let code = mine["teams"][0]["code"].as_str().unwrap().to_owned();
    assert_eq!(mine["teams"][0]["closed"], true);
    let theirs = table.view(2);
    assert!(theirs["teams"][0].get("code").is_none());

    let sent = table.send(2, json!({"type": "tournament_join_team", "team": 0}));
    assert_eq!(errors(&sent), [crate::tournament::WRONG_TEAM_CODE]);
    let sent = table.send(
        2,
        json!({"type": "tournament_join_team", "team": 0, "code": code}),
    );
    assert!(errors(&sent).is_empty());
    assert_eq!(table.view(2)["teams"][0]["members"], json!([1, 2]));
}

#[test]
fn only_an_organizer_starts_and_the_bracket_goes_out() {
    let mut table = Table::new(1, 3);
    table.team(1, "A");
    table.team(2, "B");
    table.team(3, "C");
    let sent = table.send(1, json!({"type": "tournament_start"}));
    assert_eq!(errors(&sent), [crate::tournament::NOT_ORGANIZER]);
    table.start();
    let view = table.view(1);
    assert_eq!(view["phase"], "running");
    let levels = view["bracket"]["levels"].as_array().unwrap();
    assert_eq!(levels.len(), 2, "three teams make semi-finals and a final");
    let byes = levels[0]
        .as_array()
        .unwrap()
        .iter()
        .filter(|m| m["bye"] == true)
        .count();
    assert_eq!(byes, 1);
}

#[test]
fn the_first_to_enter_opens_the_match_room_and_the_other_team_sits_opposite() {
    let mut table = duel();
    let sent = table.enter(1);
    assert!(errors(&sent).is_empty(), "{sent:?}");
    let room = table.room_of(1).expect("a match room");
    assert_eq!(room.mode, crate::wire::RoomMode::Team);
    assert_eq!(
        room.game_mode,
        crate::wire::GameMode::Horizon,
        "the final's mode"
    );
    assert_eq!(room.max_players, 2);
    assert!(room.look.is_private());
    let host_side = room.players[0].team;
    // The game plays under the teams' own names, side 0 first.
    let mut names = ["Rot".to_owned(), "Blau".to_owned()];
    if host_side == 1 {
        names.reverse();
    }
    assert_eq!(room.tournament.as_ref().unwrap().team_names, names);
    // And under their own colours: a new team takes the first colour no other team has.
    let mut colors = [
        crate::wire::RoomColor::ALL[0],
        crate::wire::RoomColor::ALL[1],
    ];
    if host_side == 1 {
        colors.reverse();
    }
    assert_eq!(room.tournament.as_ref().unwrap().team_colors, colors);

    table.enter(2);
    let room = table.room_of(2).expect("the same room");
    assert_eq!(room.players.len(), 2);
    assert_ne!(room.players[1].team, host_side);
    assert_eq!(table.view(1)["bracket"]["levels"][0][0]["room"], true);
}

#[test]
fn a_team_whose_seats_are_taken_watches_instead() {
    let mut table = Table::new(1, 3);
    table.team(1, "Rot");
    table.team(2, "Blau");
    table.join_team(3, 0);
    table.start();
    table.enter(1);
    table.enter(3);
    assert!(
        table.rooms.watching.contains_key(&3),
        "Rot's one seat is taken"
    );
    assert!(table.room_of(3).is_some());
}

#[test]
fn a_match_room_keeps_its_setup_and_is_not_joined_by_code() {
    let mut table = duel();
    table.enter(1);
    let room_id = table.rooms.room_of(1).unwrap();
    let sent = table.send(1, json!({"type": "set_mode", "mode": "ffa"}));
    assert_eq!(errors(&sent), [tournament::KEEPS_ITS_SETUP]);

    let stranger = table.rx.len();
    table.rx.push(connect(&mut table.rooms, stranger as u64));
    let sent = table.send(
        stranger,
        json!({"type": "join_room", "roomId": room_id, "name": "Fremd"}),
    );
    assert_eq!(errors(&sent).len(), 1);
    assert_eq!(table.rooms.rooms[&room_id].players.len(), 1);
}

#[test]
fn cpus_fill_a_teams_seats_but_each_team_needs_a_person() {
    let mut table = Table::new(2, 2);
    table.team(1, "Rot");
    table.team(2, "Blau");
    table.start();
    table.enter(1);
    let ours = table.room_of(1).unwrap().players[0].team;
    let theirs = 1 - ours;
    let add = |team: u8| json!({"type": "add_cpu", "level": "medium", "team": team});
    for team in [ours, theirs] {
        let sent = table.send(1, add(team));
        assert!(errors(&sent).is_empty(), "{sent:?}");
    }
    let sent = table.send(1, add(ours));
    assert_eq!(errors(&sent), ["That team's seats are taken"]);
    let sent = table.send(1, add(theirs));
    assert!(errors(&sent).is_empty(), "{sent:?}");
    let sent = table.send(1, json!({"type": "start_game"}));
    assert_eq!(
        errors(&sent),
        ["Both teams need at least one person"],
        "the other team's CPUs alone do not play"
    );

    // Their person comes and takes the newest of their CPUs' seats.
    let sent = table.enter(2);
    assert!(errors(&sent).is_empty(), "{sent:?}");
    let room = table.room_of(2).unwrap();
    assert!(!table.rooms.watching.contains_key(&2));
    assert_eq!(room.players.len(), 4);
    let on_theirs: Vec<bool> = room
        .players
        .iter()
        .filter(|p| p.team == theirs)
        .map(|p| p.is_cpu())
        .collect();
    assert_eq!(on_theirs, [true, false]);

    table.send(2, json!({"type": "ready", "ready": true}));
    let sent = table.send(1, json!({"type": "start_game"}));
    assert!(errors(&sent).is_empty(), "{sent:?}");
    assert_eq!(table.view(1)["bracket"]["levels"][0][0]["state"], "playing");
}

#[test]
fn a_cpu_moves_only_to_a_side_with_a_free_seat() {
    let mut table = Table::new(1, 2);
    table.team(1, "Rot");
    table.team(2, "Blau");
    table.start();
    table.enter(1);
    let ours = table.room_of(1).unwrap().players[0].team;
    let sent = table.send(1, json!({"type": "add_cpu", "level": "medium"}));
    assert!(errors(&sent).is_empty(), "{sent:?}");
    let cpu = &table.room_of(1).unwrap().players[1];
    let (seat, side) = (cpu.id, cpu.team);
    assert_ne!(side, ours, "a CPU goes to the side with room");
    let sent = table.send(
        1,
        json!({"type": "set_cpu", "playerId": seat, "team": ours}),
    );
    assert_eq!(errors(&sent), ["That team's seats are taken"]);
}

#[test]
fn the_hosts_result_decides_the_match_and_the_room_closes_after_its_game() {
    let mut table = duel();
    let (host, guest) = play_final(&mut table);
    assert_eq!(table.view(1)["bracket"]["levels"][0][0]["state"], "playing");
    let room_id = table.rooms.room_of(host as u64).unwrap();

    let host_side = table.room_of(host).unwrap().players[0].team as usize;
    let mut scores = [0, 0];
    scores[0] = 500; // seat 0 is the host
    table.send(host, seat_report(&scores));

    let sent = table.send(
        guest,
        json!({"type": "match_result", "team": 1 - host_side}),
    );
    assert_eq!(errors(&sent), ["Only the room host can report the result"]);
    let sent = table.send(host, json!({"type": "match_result", "team": 1 - host_side}));
    assert_eq!(errors(&sent), ["That is not how the game ended"]);
    let sent = table.send(host, json!({"type": "match_result", "team": host_side}));
    assert!(errors(&sent).is_empty(), "{sent:?}");

    let view = table.view(1);
    assert_eq!(view["phase"], "finished");
    let mut score = [0, 0];
    score[host_side] = 500;
    assert_eq!(view["bracket"]["levels"][0][0]["score"], json!(score));
    assert!(view["bracket"]["champion"].is_number());
    assert!(
        table.rooms.rooms.contains_key(&room_id),
        "the results stay on screen"
    );

    table.send(host, json!({"type": "end_game"}));
    assert!(!table.rooms.rooms.contains_key(&room_id));
    assert!(table.room_of(guest).is_none());
}

#[test]
fn a_reported_round_tells_the_tournament_how_the_match_stands() {
    let mut table = duel();
    assert_eq!(
        table.view(1)["bracket"]["levels"][0][0]["live"],
        Value::Null
    );
    let (host, guest) = play_final(&mut table);
    let live = &table.view(1)["bracket"]["levels"][0][0]["live"];
    assert_eq!(live["round"], 0);

    let host_side = table.room_of(host).unwrap().players[0].team as usize;
    table.drain_all();
    table.send(host, seat_report(&[300, 120]));
    // The round goes out to the tournament on its own, to the guest as to everybody else in it.
    // Only what changed is sent: the match, not the whole tournament.
    let patch = last(&drain(&mut table.rx[guest]), "tournament_patch").expect("the round goes out");
    assert_eq!(patch.as_object().unwrap().get("people"), None);
    assert_eq!(patch["bracket"]["matches"].as_array().unwrap().len(), 1);
    let live = &patch["bracket"]["matches"][0]["match"]["live"];
    assert_eq!(live["round"], 1);
    let mut score = [0, 0];
    score[host_side] = 300;
    score[1 - host_side] = 120;
    assert_eq!(live["score"], json!(score));
}

#[test]
fn a_game_ended_without_a_result_is_played_again() {
    let mut table = duel();
    let (host, _) = play_final(&mut table);
    table.send(host, json!({"type": "end_game"}));
    let view = table.view(1);
    assert_eq!(view["bracket"]["levels"][0][0]["state"], "ready");
    assert!(
        table.room_of(host).is_some(),
        "the room waits for the next try"
    );
}

#[test]
fn a_host_who_never_comes_back_sends_the_match_back_to_ready() {
    let mut table = duel();
    let (host, guest) = play_final(&mut table);
    table.rooms.disconnect(host as u64);
    table
        .rooms
        .expire_seats_at(Instant::now() + Duration::from_secs(31));
    assert!(table.room_of(guest).is_none(), "the room is gone");
    let view = table.view(guest);
    let final_ = &view["bracket"]["levels"][0][0];
    assert_eq!(final_["state"], "ready");
    assert_eq!(final_["room"], false);

    // Whoever comes first opens a new room.
    let sent = table.enter(guest);
    assert!(errors(&sent).is_empty(), "{sent:?}");
    assert!(table.room_of(guest).is_some());
}

#[test]
fn a_skip_needs_an_organizer_thirty_seconds_and_a_missing_team() {
    let mut table = duel();
    let sent = table.send(
        1,
        json!({"type": "tournament_skip", "level": 0, "index": 0}),
    );
    assert_eq!(errors(&sent), [crate::tournament::NOT_ORGANIZER]);
    let sent = table.send(
        0,
        json!({"type": "tournament_skip", "level": 0, "index": 0}),
    );
    assert_eq!(errors(&sent), [crate::tournament::SKIP_TOO_EARLY]);
    let sent = table.send(
        0,
        json!({"type": "tournament_skip", "level": 5, "index": 0}),
    );
    assert_eq!(errors(&sent), [crate::tournament::NO_SUCH_MATCH]);
}

#[test]
fn the_organizer_can_make_others_organizers() {
    let mut table = Table::new(1, 2);
    let sent = table.send(1, json!({"type": "tournament_promote", "person": 2}));
    assert_eq!(errors(&sent), [crate::tournament::NOT_ORGANIZER]);
    table.send(0, json!({"type": "tournament_promote", "person": 2}));
    assert_eq!(table.view(2)["you"]["organizer"], true);
}

#[test]
fn somebody_takes_over_when_the_organizer_is_gone() {
    let mut table = Table::new(1, 2);
    table.rooms.disconnect(0);
    table
        .rooms
        .expire_seats_at(Instant::now() + ORGANIZER_GRACE + Duration::from_secs(1));
    let people = &table.view(1)["people"];
    let organizers: Vec<usize> = (1..=2)
        .filter(|&p| people[p]["organizer"] == true)
        .collect();
    assert_eq!(organizers.len(), 1);
}

#[test]
fn a_dropped_connection_comes_back_with_its_token() {
    let mut table = Table::new(1, 1);
    table.team(1, "Rot");
    let token = table.view(1)["you"]["token"].as_str().unwrap().to_owned();
    table.rooms.disconnect(1);
    assert_eq!(table.view(0)["people"][1]["connected"], false);

    table.rx.push(connect(&mut table.rooms, 2));
    let sent = table.send(2, json!({"type": "tournament_resume", "token": token}));
    let view = last(&sent, "tournament").expect("the tournament again");
    assert_eq!(view["you"]["id"], 1);
    assert_eq!(view["you"]["team"], 0);

    table.rx.push(connect(&mut table.rooms, 3));
    let sent = table.send(3, json!({"type": "tournament_resume", "token": "nope"}));
    assert!(last(&sent, "tournament_resume_failed").is_some());
}

#[test]
fn a_connection_plays_and_stays_in_its_tournament() {
    let mut table = duel();
    play_final(&mut table);
    // While it sits in the match room, the bracket still reaches it.
    table.rooms.forget_sync(1);
    table.rooms.broadcast_tournament(&table.code.clone());
    assert!(last(&drain(&mut table.rx[1]), "tournament").is_some());
}

#[test]
fn a_tournament_runs_out_and_closes_its_rooms() {
    let mut table = duel();
    table.enter(1);
    table
        .rooms
        .expire_seats_at(Instant::now() + LIFETIME + Duration::from_secs(1));
    let sent = drain(&mut table.rx[1]);
    assert!(last(&sent, "tournament_closed").is_some());
    assert!(last(&sent, "room_closed").is_some());
    assert!(table.room_of(1).is_none());
    assert!(table.rooms.tournaments_is_empty());
}

#[test]
fn an_organizer_sets_a_levels_game_on_the_wire() {
    let mut table = Table::new(1, 1);
    let rules = rules_to_value(&DEFAULT_RULES);
    let sent = table.send(
        1,
        json!({"type": "tournament_set_stage", "stage": 0, "gameMode": "solar", "rules": rules}),
    );
    assert_eq!(errors(&sent), [crate::tournament::NOT_ORGANIZER]);
    let sent = table.send(
        0,
        json!({"type": "tournament_set_stage", "stage": 4, "gameMode": "solar", "rules": rules}),
    );
    assert_eq!(errors(&sent), ["Malformed level"]);
    let mut endless = rules.clone();
    endless["rounds"] = json!(0);
    let sent = table.send(
        0,
        json!({"type": "tournament_set_stage", "stage": 0, "gameMode": "solar", "rules": endless}),
    );
    assert_eq!(errors(&sent), ["Malformed game rules"]);
    assert_ne!(table.view(1)["settings"]["stages"][0]["gameMode"], "solar");
    table.send(
        0,
        json!({"type": "tournament_set_stage", "stage": 0, "gameMode": "solar", "rules": rules}),
    );
    assert_eq!(table.view(1)["settings"]["stages"][0]["gameMode"], "solar");
}

#[test]
fn a_team_picks_its_look_on_the_wire() {
    let mut table = Table::new(1, 1);
    table.team(1, "Rot");
    let sent = table.send(
        1,
        json!({"type": "tournament_team_look", "team": 0, "emblem": "crown", "color": "#ff6f9f"}),
    );
    assert!(errors(&sent).is_empty(), "{sent:?}");
    let team = &table.view(0)["teams"][0];
    assert_eq!(
        (team["emblem"].clone(), team["color"].clone()),
        (json!("crown"), json!("#ff6f9f"))
    );
    // A player's symbol is not a team's emblem.
    let sent = table.send(
        1,
        json!({"type": "tournament_team_look", "team": 0, "emblem": "rocket", "color": "#ff6f9f"}),
    );
    assert_eq!(errors(&sent), ["Malformed team emblem"]);
    let sent = table.send(
        1,
        json!({"type": "tournament_team_look", "team": 0, "emblem": "crown", "color": "red"}),
    );
    assert_eq!(errors(&sent), ["Malformed team colour"]);
}

/// The table's relay as a dev relay, with the given connections pretend players.
fn with_bots(table: &mut Table, bots: &[u64]) {
    let rooms = std::mem::replace(&mut table.rooms, RoomManager::new()).with_bots();
    table.rooms = rooms;
    for &conn in bots {
        table.rooms.mark_bot(conn, crate::wire::CpuLevel::Medium);
    }
}

#[test]
fn a_dev_relay_plays_out_a_tournament_of_bot_teams_on_its_own() {
    let mut table = Table::new(1, 4);
    with_bots(&mut table, &[1, 2, 3, 4]);
    for (conn, name) in [(1, "A"), (2, "B"), (3, "C"), (4, "D")] {
        table.team(conn, name);
    }
    table.start();
    let start = std::time::Instant::now();

    // The first tick starts both semi-finals, without a room.
    table.rooms.expire_seats_at(start);
    let view = table.view(0);
    for m in view["bracket"]["levels"][0].as_array().unwrap() {
        assert_eq!(m["state"], "playing");
        assert_eq!(m["simulated"], true);
        assert_eq!(m["room"], false);
        assert_eq!(m["live"]["round"], 0);
    }

    // A round comes every few seconds; the live score goes up with it.
    table
        .rooms
        .expire_seats_at(start + std::time::Duration::from_secs(7));
    let view = table.view(0);
    assert_eq!(view["bracket"]["levels"][0][0]["live"]["round"], 1);

    // The page that made the bots reloads: their connections go, and the tournament still runs on.
    for conn in 1..=4 {
        table.rooms.disconnect(conn);
    }

    for step in 2..60 {
        table
            .rooms
            .expire_seats_at(start + std::time::Duration::from_secs(7 * step));
    }
    let view = table.view(0);
    assert_eq!(view["phase"], "finished");
    assert!(view["bracket"]["champion"].is_number());
    let final_match = &view["bracket"]["levels"][1][0];
    let score = final_match["score"].as_array().unwrap();
    assert_ne!(
        score[0], score[1],
        "a simulated match has a winner by points"
    );
    assert_eq!(final_match["simulated"], false);
}

#[test]
fn a_match_with_a_person_in_it_is_not_simulated() {
    let mut table = Table::new(1, 2);
    with_bots(&mut table, &[1]);
    table.team(1, "Bots");
    table.team(2, "People");
    table.start();
    table
        .rooms
        .expire_seats_at(std::time::Instant::now() + std::time::Duration::from_secs(10));
    let view = table.view(0);
    assert_eq!(view["bracket"]["levels"][0][0]["state"], "ready");
    assert_eq!(view["bracket"]["levels"][0][0]["simulated"], false);
}

#[test]
fn an_update_sends_what_changed_and_nothing_when_nothing_did() {
    let mut table = Table::new(1, 1);
    table.drain_all();
    // Nothing changed: nobody is told.
    table.rooms.broadcast_tournament(&table.code.clone());
    for rx in &mut table.rx {
        assert!(drain(rx).is_empty());
    }
    // A team founded changes the teams and the people, and leaves the rules and the bracket out.
    let sent = table.send(
        1,
        json!({"type": "tournament_create_team", "name": "Rot", "closed": false}),
    );
    let patch = last(&sent, "tournament_patch").expect("what changed");
    let fields = patch.as_object().unwrap();
    assert!(fields.contains_key("teams") && fields.contains_key("people") && fields.contains_key("you"));
    assert!(!fields.contains_key("settings") && !fields.contains_key("bracket"));
    // A connection told anew is sent all of it.
    table.drain_all();
    table.rooms.forget_sync(0);
    table.rooms.broadcast_tournament(&table.code.clone());
    let whole = last(&drain(&mut table.rx[0]), "tournament").expect("a connection told anew gets all of it");
    assert!(whole["settings"].is_object() && whole["you"].is_object());
}
