//! What a client asks of the relay, read once from the decoded message.
//!
//! Every field is parsed up front, but a field that does not parse keeps its error as a value
//! instead of failing the whole command. The handler reports it at the point where it matters: a
//! player who is not the host hears that first, before hearing that the rules were malformed.

use serde_json::Value;

use crate::auth::{password_length, MAX_PASSWORD_LENGTH};
use crate::protocol::{
    clean_chat, clean_name_checked, is_acceptable_name, is_input_message, is_safe_integer,
    parse_avatar, parse_cpu_level, parse_daily_day, parse_daily_submit, parse_emblem,
    parse_player_name, parse_room_look, parse_room_name, parse_rules, DailyScore, RoomLook,
    RoomName, RoomRules, NAME_REFUSED, NAME_REQUIRED,
};
use crate::report::{
    parse_local_game, parse_round_report, parse_seat_report, parse_turn_report, LocalGame,
    RoundReport, SeatReport, TurnReport,
};
use crate::tournament::{MatchId, Settings, StageRules, MAX_TEAMS, MAX_TEAM_SIZE, STAGES};
use crate::wire::{Avatar, CpuLevel, Emblem, GameMode, RoomColor, RoomMode, Wire};

/// The most players a room takes.
pub const MAX_ROOM_PLAYERS: i64 = 6;

/// A field read from a message, or the reason the client hears when it is not usable.
pub type Parsed<T> = Result<T, &'static str>;

/// A message from a connected client.
pub enum Command<'a> {
    /// A request for the room logic.
    Room(RoomCommand<'a>),
    /// A request for the daily-challenge board, which is awaited outside the room lock.
    Daily(DailyCommand),
}

pub enum DailyCommand {
    Submit(Parsed<DailyScore>),
    Top(Parsed<String>),
    /// The stats page's numbers.
    Stats,
    /// The menu's facts.
    Facts,
    /// One game, to fly again.
    Replay(Parsed<String>),
    /// A game played on one device, reported when it is over.
    Local(Box<Parsed<LocalGame>>),
}

pub enum RoomCommand<'a> {
    Lobby,
    CreateRoom(CreateRoom),
    JoinRoom(JoinRoom),
    Ready(Parsed<bool>),
    SetRules {
        rules: Parsed<RoomRules>,
        /// The game the rules are for; none keeps the room's.
        game_mode: Parsed<Option<GameMode>>,
    },
    SetRoom(Parsed<RoomLook>),
    /// Host only: free for all or teams, while the room waits.
    SetMode(Parsed<RoomMode>),
    SetAvatar(Parsed<Avatar>),
    SetName(Parsed<String>),
    SetTeam(Parsed<u8>),
    ResetTeams,
    AddCpu {
        level: Parsed<CpuLevel>,
        team: Parsed<Option<u8>>,
    },
    SetCpu {
        seat: Parsed<usize>,
        level: Parsed<Option<CpuLevel>>,
        team: Parsed<Option<u8>>,
    },
    RemoveCpu {
        seat: Parsed<usize>,
    },
    StartGame,
    /// The host ends the running game and brings the room back to its waiting state.
    EndGame,
    /// The host plays the game again in the same room: a new game for the statistics, its worlds from this seed.
    Rematch(Parsed<u32>),
    Input(Parsed<&'a Value>),
    /// Something to say to the room.
    Chat(Parsed<String>),
    /// The host speaks for a CPU seat: its taunt, sent as that seat's chat line.
    CpuChat {
        seat: Parsed<usize>,
        text: Parsed<String>,
    },
    /// The host's account of a round that just ended.
    RoundStats(Box<Parsed<RoundReport>>),
    /// The host's account of a turn that was just flown.
    TurnStats(Parsed<TurnReport>),
    SeatStats(Parsed<SeatReport>),
    LeaveRoom,
    /// A new connection asks for the seat its `token` was given for.
    Resume(Parsed<String>),
    /// Something to do with a tournament.
    Tournament(TournamentCommand),
    /// A message with no `type`.
    Malformed,
    /// A message whose `type` is not one the relay knows.
    Unknown(&'a str),
}

/// A `create_room` message.
pub struct CreateRoom {
    pub name: Parsed<String>,
    /// What the lobby calls the room; None when nothing usable was typed (the room is named after its host).
    pub room_name: Parsed<Option<String>>,
    pub mode: Parsed<RoomMode>,
    pub game_mode: Parsed<GameMode>,
    pub max_players: Parsed<i64>,
    /// The password to lock the room with; None for an open room (an empty password is open).
    pub password: Parsed<Option<String>>,
    pub rules: Parsed<RoomRules>,
    pub look: Parsed<RoomLook>,
    pub avatar: Parsed<Avatar>,
}

impl CreateRoom {
    /// Whether every field is usable, so it is worth hashing the password for.
    pub fn is_valid(&self) -> bool {
        self.name.is_ok()
            && self.room_name.is_ok()
            && self.mode.is_ok()
            && self.game_mode.is_ok()
            && self.max_players.is_ok()
            && self.password.is_ok()
            && self.rules.is_ok()
            && self.look.is_ok()
            && self.avatar.is_ok()
    }

    /// The password that has to be hashed before the room is made.
    pub fn password_plaintext(&self) -> Option<&str> {
        self.password.as_ref().ok()?.as_deref()
    }
}

/// A `join_room` message.
pub struct JoinRoom {
    /// The room and the name to join as; both have to be there.
    pub target: Parsed<JoinTarget>,
    pub avatar: Parsed<Avatar>,
    /// Whatever the client sent as a password, to be checked against the room's.
    pub password: Option<String>,
    /// Watch from the stands instead of taking a seat.
    pub spectate: bool,
}

pub struct JoinTarget {
    pub room_id: String,
    pub name: String,
}

impl JoinRoom {
    /// Whether the room and name are usable, so it is worth looking at the password.
    pub fn is_valid(&self) -> bool {
        self.avatar.is_ok()
            && self
                .target
                .as_ref()
                .is_ok_and(|target| !target.room_id.is_empty())
    }

    pub fn room_id(&self) -> &str {
        self.target
            .as_ref()
            .map_or("", |target| target.room_id.as_str())
    }
}

/// A tournament message. The plan is `docs/plans/tournament.md`; the model is `crate::tournament`.
pub enum TournamentCommand {
    Create {
        name: Parsed<String>,
        avatar: Parsed<Avatar>,
        settings: Parsed<Settings>,
    },
    /// Come in with the tournament's code.
    Join {
        code: Parsed<String>,
        name: Parsed<String>,
        avatar: Parsed<Avatar>,
    },
    /// A new connection asks for the person its `token` was given to.
    Resume(Parsed<String>),
    Leave,
    CreateTeam {
        name: Parsed<String>,
        /// A closed team gets a code; an open one may be joined by anyone in the tournament.
        closed: bool,
        /// The place in the bracket it was founded in; none lets the tournament pick the first free one.
        slot: Option<usize>,
    },
    JoinTeam {
        team: Parsed<usize>,
        code: Option<String>,
    },
    LeaveTeam,
    /// What a team shows: its symbol and colour.
    TeamLook {
        team: Parsed<usize>,
        emblem: Parsed<Emblem>,
        color: Parsed<RoomColor>,
    },
    Promote(Parsed<usize>),
    RemoveTeam(Parsed<usize>),
    Start,
    /// What a level of the bracket plays: 0 is the final.
    SetStage {
        stage: Parsed<usize>,
        rules: Parsed<StageRules>,
    },
    Skip {
        game: Parsed<MatchId>,
        /// The team an organizer lets through when neither came; none draws lots.
        team: Parsed<Option<usize>>,
    },
    /// Take a seat in the team's ready match, or a place in its stands when the team's seats are taken.
    Enter(Parsed<Avatar>),
    /// Watch a match of the tournament from its stands.
    Watch(Parsed<MatchId>),
    /// The host of a match room says which side won: 0 or 1, the room's team.
    Result(Parsed<u8>),
}

/// The most characters of a tournament or team code.
const MAX_CODE_LENGTH: usize = 16;

fn whole(value: Option<&Value>) -> Option<usize> {
    value
        .filter(|value| is_safe_integer(value))
        .and_then(Value::as_i64)
        .and_then(|n| usize::try_from(n).ok())
}

fn code(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|code| !code.is_empty() && code.len() <= MAX_CODE_LENGTH)
        .map(str::to_owned)
}

fn parse_match_ref(message: &Value) -> Parsed<MatchId> {
    match (whole(message.get("level")), whole(message.get("index"))) {
        (Some(level), Some(index)) => Ok(MatchId { level, index }),
        _ => Err("Malformed match"),
    }
}

/// A team's name: cleaned like a player's and held to the same check.
fn parse_team_name(value: Option<&Value>) -> Parsed<String> {
    let name = clean_name_checked(value).ok_or("A team needs a name")?;
    if is_acceptable_name(&name) {
        Ok(name)
    } else {
        Err(NAME_REFUSED)
    }
}

/// What one level plays: `{gameMode, rules}`. A tournament match has to end, so an endless one
/// (`rounds: 0`, legal in a room of its own) is refused.
fn parse_stage(stage: &Value) -> Option<StageRules> {
    let rules = parse_rules(stage.get("rules")?)?;
    if rules.get("rounds").as_u64().is_none_or(|rounds| rounds < 1) {
        return None;
    }
    Some(StageRules {
        game_mode: stage
            .get("gameMode")
            .and_then(Value::as_str)
            .and_then(GameMode::parse)?,
        rules,
    })
}

/// A tournament's settings: the team size, the most teams, and a mode and rules for each of the four
/// levels, the final first.
fn parse_settings(message: &Value) -> Option<Settings> {
    let team_size = whole(message.get("teamSize")).filter(|n| (1..=MAX_TEAM_SIZE).contains(n))?;
    let max_teams = whole(message.get("maxTeams")).filter(|n| (2..=MAX_TEAMS).contains(n))?;
    let stages = message.get("stages")?.as_array()?;
    if stages.len() != STAGES {
        return None;
    }
    let stages: Vec<StageRules> = stages.iter().map(parse_stage).collect::<Option<_>>()?;
    Some(Settings {
        team_size,
        max_teams,
        stages: stages.try_into().ok()?,
    })
}

impl TournamentCommand {
    fn parse(kind: &str, message: &Value) -> Option<Self> {
        Some(match kind {
            "tournament_create" => TournamentCommand::Create {
                name: parse_player_name(message.get("name")),
                avatar: parse_avatar(message.get("avatar")).ok_or("Malformed player symbol"),
                settings: parse_settings(message).ok_or("Malformed tournament settings"),
            },
            "tournament_join" => TournamentCommand::Join {
                code: code(message.get("code")).ok_or("A tournament code is needed"),
                name: parse_player_name(message.get("name")),
                avatar: parse_avatar(message.get("avatar")).ok_or("Malformed player symbol"),
            },
            "tournament_resume" => TournamentCommand::Resume(
                message
                    .get("token")
                    .and_then(Value::as_str)
                    .filter(|token| !token.is_empty() && token.len() <= 64)
                    .map(str::to_owned)
                    .ok_or("Malformed resume token"),
            ),
            "tournament_leave" => TournamentCommand::Leave,
            "tournament_create_team" => TournamentCommand::CreateTeam {
                name: parse_team_name(message.get("name")),
                closed: message.get("closed").and_then(Value::as_bool) == Some(true),
                slot: message
                    .get("slot")
                    .and_then(Value::as_u64)
                    .map(|s| s as usize),
            },
            "tournament_join_team" => TournamentCommand::JoinTeam {
                team: whole(message.get("team")).ok_or("Malformed team"),
                code: code(message.get("code")),
            },
            "tournament_leave_team" => TournamentCommand::LeaveTeam,
            "tournament_team_look" => TournamentCommand::TeamLook {
                team: whole(message.get("team")).ok_or("Malformed team"),
                emblem: parse_emblem(message.get("emblem")).ok_or("Malformed team emblem"),
                color: message
                    .get("color")
                    .and_then(Value::as_str)
                    .and_then(RoomColor::parse)
                    .ok_or("Malformed team colour"),
            },
            "tournament_promote" => {
                TournamentCommand::Promote(whole(message.get("person")).ok_or("Malformed person"))
            }
            "tournament_remove_team" => {
                TournamentCommand::RemoveTeam(whole(message.get("team")).ok_or("Malformed team"))
            }
            "tournament_start" => TournamentCommand::Start,
            "tournament_set_stage" => TournamentCommand::SetStage {
                stage: whole(message.get("stage"))
                    .filter(|stage| *stage < STAGES)
                    .ok_or("Malformed level"),
                rules: parse_stage(message).ok_or("Malformed game rules"),
            },
            "tournament_skip" => TournamentCommand::Skip {
                game: parse_match_ref(message),
                team: match message.get("team") {
                    None | Some(Value::Null) => Ok(None),
                    some => whole(some).map(Some).ok_or("Malformed team"),
                },
            },
            "tournament_enter" => TournamentCommand::Enter(
                parse_avatar(message.get("avatar")).ok_or("Malformed player symbol"),
            ),
            "tournament_watch" => TournamentCommand::Watch(parse_match_ref(message)),
            "match_result" => TournamentCommand::Result(
                named_team(message).and_then(|team| team.ok_or("team must be 0 or 1")),
            ),
            _ => return None,
        })
    }
}

/// The `id` of a `stats_replay`: a game's random id, 16 hex digits.
fn parse_match_id(message: &Value) -> Option<String> {
    let id = message.get("id")?.as_str()?;
    (id.len() == 16 && id.bytes().all(|b| b.is_ascii_hexdigit())).then(|| id.to_string())
}

impl<'a> Command<'a> {
    pub fn parse(message: &'a Value) -> Self {
        match message.get("type").and_then(Value::as_str) {
            Some("daily_submit") => Command::Daily(DailyCommand::Submit(
                parse_daily_submit(message).ok_or("Invalid daily run"),
            )),
            Some("daily_top") => Command::Daily(DailyCommand::Top(
                parse_daily_day(message).ok_or("Invalid day"),
            )),
            Some("stats_overview") => Command::Daily(DailyCommand::Stats),
            Some("stats_facts") => Command::Daily(DailyCommand::Facts),
            Some("local_game") => Command::Daily(DailyCommand::Local(Box::new(
                parse_local_game(message).ok_or("Invalid game"),
            ))),
            Some("stats_replay") => Command::Daily(DailyCommand::Replay(
                parse_match_id(message).ok_or("Invalid game"),
            )),
            _ => Command::Room(RoomCommand::parse(message)),
        }
    }
}

impl<'a> RoomCommand<'a> {
    pub fn parse(message: &'a Value) -> Self {
        let Some(kind) = message.get("type").and_then(Value::as_str) else {
            return RoomCommand::Malformed;
        };
        match kind {
            "lobby" => RoomCommand::Lobby,
            "create_room" => RoomCommand::CreateRoom(CreateRoom::parse(message)),
            "join_room" => RoomCommand::JoinRoom(JoinRoom::parse(message)),
            "ready" => RoomCommand::Ready(
                message
                    .get("ready")
                    .and_then(Value::as_bool)
                    .ok_or("ready must be a boolean"),
            ),
            "set_rules" => RoomCommand::SetRules {
                rules: message
                    .get("rules")
                    .and_then(parse_rules)
                    .ok_or("Malformed game rules"),
                game_mode: match message.get("gameMode") {
                    None | Some(Value::Null) => Ok(None),
                    Some(value) => value
                        .as_str()
                        .and_then(GameMode::parse)
                        .map(Some)
                        .ok_or("gameMode must be classic, solar or horizon"),
                },
            },
            "set_room" => RoomCommand::SetRoom(
                message
                    .get("look")
                    .and_then(parse_room_look)
                    .ok_or("Malformed room settings"),
            ),
            "set_mode" => RoomCommand::SetMode(
                message
                    .get("mode")
                    .and_then(Value::as_str)
                    .and_then(RoomMode::parse)
                    .ok_or("Mode must be ffa or team"),
            ),
            "set_avatar" => RoomCommand::SetAvatar(
                parse_avatar(message.get("avatar")).ok_or("Malformed player symbol"),
            ),
            "set_name" => RoomCommand::SetName(parse_player_name(message.get("name"))),
            "set_team" => RoomCommand::SetTeam(
                named_team(message).and_then(|team| team.ok_or("team must be 0 or 1")),
            ),
            "reset_teams" => RoomCommand::ResetTeams,
            "add_cpu" => RoomCommand::AddCpu {
                level: parse_cpu_level(message.get("level")).ok_or("Malformed CPU level"),
                team: named_team(message),
            },
            "set_cpu" => RoomCommand::SetCpu {
                seat: cpu_seat(message),
                level: named_cpu_level(message),
                team: named_team(message),
            },
            "remove_cpu" => RoomCommand::RemoveCpu {
                seat: cpu_seat(message),
            },
            "start_game" => RoomCommand::StartGame,
            "end_game" => RoomCommand::EndGame,
            "rematch" => RoomCommand::Rematch(
                message
                    .get("seed")
                    .filter(|value| is_safe_integer(value))
                    .and_then(Value::as_u64)
                    .and_then(|seed| u32::try_from(seed).ok())
                    .ok_or("Malformed seed"),
            ),
            "input" => RoomCommand::Input(
                message
                    .get("input")
                    .filter(|input| is_input_message(input))
                    .ok_or("Malformed input message"),
            ),
            "chat" => {
                RoomCommand::Chat(clean_chat(message.get("text")).ok_or("Say something first"))
            }
            "cpu_chat" => RoomCommand::CpuChat {
                seat: cpu_seat(message),
                text: clean_chat(message.get("text")).ok_or("Say something first"),
            },
            "round_stats" => RoomCommand::RoundStats(Box::new(
                parse_round_report(message).ok_or("Malformed round stats"),
            )),
            "turn_stats" => {
                RoomCommand::TurnStats(parse_turn_report(message).ok_or("Malformed turn stats"))
            }
            "seat_stats" => {
                RoomCommand::SeatStats(parse_seat_report(message).ok_or("Malformed seat stats"))
            }
            "leave_room" => RoomCommand::LeaveRoom,
            kind if kind.starts_with("tournament_") || kind == "match_result" => {
                match TournamentCommand::parse(kind, message) {
                    Some(command) => RoomCommand::Tournament(command),
                    None => RoomCommand::Unknown(kind),
                }
            }
            "resume" => RoomCommand::Resume(
                message
                    .get("token")
                    .and_then(Value::as_str)
                    .filter(|token| !token.is_empty() && token.len() <= 64)
                    .map(str::to_owned)
                    .ok_or("Malformed resume token"),
            ),
            other => RoomCommand::Unknown(other),
        }
    }
}

impl CreateRoom {
    fn parse(message: &Value) -> Self {
        let max_players = message.get("maxPlayers");
        let max_players_num = max_players.and_then(Value::as_f64);
        let password = match message.get("password") {
            None => Ok(None),
            Some(value) => match value.as_str() {
                Some(text) if password_length(text) <= MAX_PASSWORD_LENGTH => {
                    Ok(Some(text.to_owned()).filter(|text| !text.is_empty()))
                }
                _ => Err("The password must be at most 64 characters"),
            },
        };
        Self {
            name: parse_player_name(message.get("name")),
            room_name: match parse_room_name(message.get("roomName")) {
                RoomName::Default => Ok(None),
                RoomName::Named(name) => Ok(Some(name)),
                RoomName::Refused => Err("That room name is not allowed"),
            },
            mode: message
                .get("mode")
                .and_then(Value::as_str)
                .and_then(RoomMode::parse)
                .ok_or("Mode must be ffa or team"),
            game_mode: message
                .get("gameMode")
                .and_then(Value::as_str)
                .and_then(GameMode::parse)
                .ok_or("gameMode must be classic, solar or horizon"),
            max_players: match max_players_num {
                Some(count)
                    if max_players.is_some_and(is_safe_integer)
                        && (2.0..=MAX_ROOM_PLAYERS as f64).contains(&count) =>
                {
                    Ok(count as i64)
                }
                _ => Err("maxPlayers must be an integer from 2 to 6"),
            },
            password,
            rules: match message.get("rules") {
                None => Ok(crate::protocol::DEFAULT_RULES.clone()),
                Some(value) => parse_rules(value).ok_or("Malformed game rules"),
            },
            look: parse_room_look(message).ok_or("Malformed room settings"),
            avatar: parse_avatar(message.get("avatar")).ok_or("Malformed player symbol"),
        }
    }
}

impl JoinRoom {
    fn parse(message: &Value) -> Self {
        let name = parse_player_name(message.get("name"));
        let room_id = message.get("roomId").and_then(Value::as_str);
        Self {
            target: match (room_id, name) {
                (Some(room_id), Ok(name)) => Ok(JoinTarget {
                    room_id: room_id.to_owned(),
                    name,
                }),
                (Some(_), Err(refused)) if refused != NAME_REQUIRED => Err(refused),
                _ => Err("join_room requires a roomId and non-empty player name"),
            },
            avatar: parse_avatar(message.get("avatar")).ok_or("Malformed player symbol"),
            password: message
                .get("password")
                .and_then(Value::as_str)
                .map(str::to_owned),
            spectate: message.get("spectate").and_then(Value::as_bool) == Some(true),
        }
    }
}

/// The team a message names, if it names one. Only 0 and 1 exist.
fn named_team(message: &Value) -> Parsed<Option<u8>> {
    match message.get("team") {
        None => Ok(None),
        Some(value) => value
            .as_f64()
            .filter(|team| *team == 0.0 || *team == 1.0)
            .map(|team| Some(team as u8))
            .ok_or("team must be 0 or 1"),
    }
}

/// The CPU level a message names, if it names one.
fn named_cpu_level(message: &Value) -> Parsed<Option<CpuLevel>> {
    match message.get("level") {
        None => Ok(None),
        Some(_) => parse_cpu_level(message.get("level"))
            .map(Some)
            .ok_or("Malformed CPU level"),
    }
}

/// The seat a CPU message names. It has to be a whole number.
fn cpu_seat(message: &Value) -> Parsed<usize> {
    message
        .get("playerId")
        .filter(|value| is_safe_integer(value))
        .and_then(Value::as_i64)
        .and_then(|id| usize::try_from(id).ok())
        .ok_or("Malformed CPU seat")
}
