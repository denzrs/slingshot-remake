//! A knockout tournament online: its people, its teams, its organizers and its bracket.
//!
//! The relay knows teams, not who is in them: a team wins, and people may come and go from it. People
//! are only kept so the relay can call them to their matches and let them back in with their token.
//! Nothing here opens rooms or touches a socket; the plan is `docs/plans/tournament.md`.

mod bracket;
#[cfg(test)]
mod tests;

use std::time::{Duration, Instant};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use rand::Rng;

use crate::protocol::RoomRules;
use crate::wire::{Avatar, Emblem, GameMode, RoomColor};

pub use bracket::{Bracket, Match, MatchId, MatchState, TeamId};

/// A person in the tournament, by their place in its list of people.
pub type PersonId = usize;

/// How long a tournament lives after it was made.
pub const LIFETIME: Duration = Duration::from_secs(24 * 60 * 60);

/// The most teams a tournament holds: a round of 16.
pub const MAX_TEAMS: usize = 16;

/// The most people in one team: a team of three keeps two to bring in.
pub const MAX_MEMBERS: usize = 5;

/// The most people in one tournament: every team full, and as many again watching or between teams.
pub const MAX_PEOPLE: usize = 2 * MAX_TEAMS * MAX_MEMBERS;

/// The most players a team puts into one match: a 3v3 fills a room's six seats.
pub const MAX_TEAM_SIZE: usize = 3;

/// How long a ready match must wait for a missing team before an organizer may skip it.
pub const SKIP_AFTER: Duration = Duration::from_secs(30);

/// How long the tournament goes without an organizer before somebody else is named one.
pub const ORGANIZER_GRACE: Duration = Duration::from_secs(60);

/// The levels a tournament can have, counted from the final: final, semi-finals, quarter-finals,
/// round of 16.
pub const STAGES: usize = 4;

/// What one level of the bracket plays: its mode and rules, the rounds of a match among them.
#[derive(Clone, Debug, PartialEq)]
pub struct StageRules {
    pub game_mode: GameMode,
    pub rules: RoomRules,
}

/// What the organizer sets before the start.
#[derive(Clone, Debug, PartialEq)]
pub struct Settings {
    /// Players per team in a match: 1 for duels, 2 for 2v2, 3 for 3v3.
    pub team_size: usize,
    /// The most teams that may enter, up to `MAX_TEAMS`.
    pub max_teams: usize,
    /// Indexed by stage: `stages[0]` is the final, `stages[1]` the semi-finals, and so on.
    pub stages: [StageRules; STAGES],
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Phase {
    /// People come in and make or join teams.
    Registration,
    /// The bracket is drawn and matches are played.
    Running,
    /// The final has a winner.
    Finished,
}

#[derive(Debug)]
pub struct Person {
    pub name: String,
    /// The person's own symbol, as their seat shows it in a room; their team has a symbol of its own.
    pub avatar: Avatar,
    /// The secret that brings a new connection back to this person.
    pub token: String,
    /// None while nobody is connected as this person.
    pub conn: Option<u64>,
    pub team: Option<TeamId>,
    pub organizer: bool,
    /// Left the tournament for good: the name is free again and the token brings nobody back.
    pub gone: bool,
}

#[derive(Debug)]
pub struct Team {
    pub name: String,
    /// Wanted to join a closed team; None for a team that anyone in the tournament may join.
    pub code: Option<String>,
    pub members: Vec<PersonId>,
    /// Its place among the bracket's first matches while registering: the two of a match are `2k` and `2k + 1`.
    pub slot: usize,
    /// Taken out by an organizer once the bracket was drawn: it loses every match it would play.
    pub withdrawn: bool,
    /// What the team shows in the bracket; its members pick it.
    pub emblem: Emblem,
    pub color: RoomColor,
}

/// What codes are written in: no letters that pass for digits or each other (I, L, O; 0, 1), as people read them out and type them.
const CODE_ALPHABET: &[u8] = b"ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/// A code people hand on: `length` characters of `CODE_ALPHABET`.
pub fn new_code(length: usize, rng: &mut impl Rng) -> String {
    (0..length)
        .map(|_| CODE_ALPHABET[rng.gen_range(0..CODE_ALPHABET.len())] as char)
        .collect()
}

/// A code as typed: upper case, so a code is found whatever case it was typed in.
pub fn normalize_code(code: &str) -> String {
    code.trim().to_uppercase()
}

/// Why something was refused, as the person is told.
pub type Refusal = &'static str;

pub const NOT_ORGANIZER: Refusal = "Only an organizer can do that";
pub const REGISTRATION_CLOSED: Refusal = "The tournament has already started";
pub const NOT_RUNNING: Refusal = "The tournament is not running";
pub const TOURNAMENT_FULL: Refusal = "The tournament is full";
pub const TEAMS_FULL: Refusal = "No more teams can enter";
pub const TEAM_FULL: Refusal = "The team is full";
pub const TEAM_NAME_TAKEN: Refusal = "That team name is taken";
pub const NAME_TAKEN: Refusal = "That name is taken in this tournament";
pub const WRONG_TEAM_CODE: Refusal = "Wrong team code";
pub const NO_SUCH_TEAM: Refusal = "No such team";
pub const NO_SUCH_PERSON: Refusal = "No such person";
pub const NO_SUCH_MATCH: Refusal = "No such match";
pub const TOO_FEW_TEAMS: Refusal = "Two teams with players are needed";
pub const MATCH_NOT_READY: Refusal = "The match is not waiting to be played";
pub const MATCH_NOT_PLAYING: Refusal = "The match is not being played";
pub const NOT_IN_MATCH: Refusal = "That team is not in this match";
pub const SKIP_TOO_EARLY: Refusal = "Wait a little longer for the missing team";
pub const BOTH_TEAMS_HERE: Refusal = "Both teams are here";
pub const NOT_IN_TEAM: Refusal = "You are not in a team";
pub const NO_SUCH_STAGE: Refusal = "No such level";
pub const NOT_IN_THAT_TEAM: Refusal = "Only the team's members can change that";
pub const STAGE_UNDER_WAY: Refusal = "That level is already being played";

#[derive(Debug)]
pub struct Tournament {
    pub settings: Settings,
    pub phase: Phase,
    pub people: Vec<Person>,
    pub teams: Vec<Team>,
    /// Drawn at the start.
    pub bracket: Option<Bracket>,
    created_at: Instant,
    /// Since when no organizer has been connected; None while one is.
    orphaned_since: Option<Instant>,
    /// Since when each ready match has been ready, so a skip waits for a missing team.
    ready_since: Vec<(MatchId, Instant)>,
}

impl Tournament {
    /// A new tournament in registration, with the person who made it as its first organizer.
    pub fn new(
        settings: Settings,
        name: String,
        conn: u64,
        now: Instant,
        rng: &mut impl Rng,
    ) -> (Self, PersonId) {
        debug_assert!((1..=MAX_TEAM_SIZE).contains(&settings.team_size));
        debug_assert!((2..=MAX_TEAMS).contains(&settings.max_teams));
        let mut tournament = Self {
            settings,
            phase: Phase::Registration,
            people: Vec::new(),
            teams: Vec::new(),
            bracket: None,
            created_at: now,
            orphaned_since: None,
            ready_since: Vec::new(),
        };
        let id = tournament.add_person(name, conn, rng);
        tournament.people[id].organizer = true;
        (tournament, id)
    }

    pub fn expired(&self, now: Instant) -> bool {
        now.duration_since(self.created_at) >= LIFETIME
    }

    /// How long until the tournament runs out.
    pub fn expires_in(&self, now: Instant) -> Duration {
        LIFETIME.saturating_sub(now.duration_since(self.created_at))
    }

    /// How long a ready match has waited for its teams.
    pub fn ready_for(&self, id: MatchId, now: Instant) -> Option<Duration> {
        self.ready_since
            .iter()
            .find(|(m, _)| *m == id)
            .map(|(_, at)| now.duration_since(*at))
    }

    /// Somebody came in with the tournament's code. They may come in after the start too, to join a
    /// team that is still in it or to watch.
    pub fn join(
        &mut self,
        name: String,
        conn: u64,
        rng: &mut impl Rng,
    ) -> Result<PersonId, Refusal> {
        if self.people.len() >= MAX_PEOPLE {
            return Err(TOURNAMENT_FULL);
        }
        if self.name_taken(&name) {
            return Err(NAME_TAKEN);
        }
        Ok(self.add_person(name, conn, rng))
    }

    fn add_person(&mut self, name: String, conn: u64, rng: &mut impl Rng) -> PersonId {
        self.people.push(Person {
            name,
            avatar: Avatar::ALL[0],
            token: URL_SAFE_NO_PAD.encode(rng.gen::<[u8; 16]>()),
            conn: Some(conn),
            team: None,
            organizer: false,
            gone: false,
        });
        self.people.len() - 1
    }

    fn name_taken(&self, name: &str) -> bool {
        let wanted = name.to_lowercase();
        self.people
            .iter()
            .any(|p| !p.gone && p.name.to_lowercase() == wanted)
    }

    /// The person a token belongs to.
    pub fn person_with_token(&self, token: &str) -> Option<PersonId> {
        self.people.iter().position(|p| !p.gone && p.token == token)
    }

    /// A new connection takes a person back with their token.
    pub fn resume(&mut self, person: PersonId, conn: u64) {
        self.people[person].conn = Some(conn);
        if self.people[person].organizer {
            self.orphaned_since = None;
        }
    }

    /// A person leaves the tournament for good: out of their team and their job, and the name free again.
    /// The tournament goes on without them; coming in again with the code makes a new person.
    pub fn leave(&mut self, person: PersonId, now: Instant) {
        self.move_to(person, None);
        let p = &mut self.people[person];
        p.organizer = false;
        p.gone = true;
        p.token.clear();
        self.disconnect(person, now);
    }

    /// A person's connection went away. They stay in the tournament and their team.
    pub fn disconnect(&mut self, person: PersonId, now: Instant) {
        self.people[person].conn = None;
        if self.orphaned_since.is_none() && !self.organizer_present() {
            self.orphaned_since = Some(now);
        }
    }

    fn organizer_present(&self) -> bool {
        self.people.iter().any(|p| p.organizer && p.conn.is_some())
    }

    /// Make a team during registration and put its maker in it. A closed team gets a code to hand on.
    #[cfg(test)]
    pub fn create_team(
        &mut self,
        person: PersonId,
        name: String,
        closed: bool,
        rng: &mut impl Rng,
    ) -> Result<TeamId, Refusal> {
        self.create_team_at(person, name, closed, None, rng)
    }

    /// The same, in a place of the bracket: the one asked for when it is free, else the first free one. A team taken out leaves its
    /// place free; the teams after it do not move up.
    pub fn create_team_at(
        &mut self,
        person: PersonId,
        name: String,
        closed: bool,
        slot: Option<usize>,
        rng: &mut impl Rng,
    ) -> Result<TeamId, Refusal> {
        if self.phase != Phase::Registration {
            return Err(REGISTRATION_CLOSED);
        }
        if self.teams.len() >= self.settings.max_teams {
            return Err(TEAMS_FULL);
        }
        let wanted = name.to_lowercase();
        if self.teams.iter().any(|t| t.name.to_lowercase() == wanted) {
            return Err(TEAM_NAME_TAKEN);
        }
        // A new team shows an emblem and a colour no other team shows yet, while there are any.
        let free_emblem = Emblem::ALL
            .iter()
            .copied()
            .find(|e| self.teams.iter().all(|t| t.emblem != *e))
            .unwrap_or(Emblem::ALL[self.teams.len() % Emblem::ALL.len()]);
        let free_color = RoomColor::ALL
            .iter()
            .copied()
            .find(|c| self.teams.iter().all(|t| t.color != *c))
            .unwrap_or(RoomColor::ALL[self.teams.len() % RoomColor::ALL.len()]);
        let taken = |s: usize| self.teams.iter().any(|t| t.slot == s);
        let slot = slot
            .filter(|&s| s < self.settings.max_teams && !taken(s))
            .or_else(|| (0..self.settings.max_teams).find(|&s| !taken(s)))
            .unwrap_or(self.teams.len());
        self.teams.push(Team {
            name,
            slot,
            code: closed.then(|| new_code(5, rng)),
            members: Vec::new(),
            withdrawn: false,
            emblem: free_emblem,
            color: free_color,
        });
        let team = self.teams.len() - 1;
        self.move_to(person, Some(team));
        Ok(team)
    }

    /// A member of the team (or an organizer) picks what it shows.
    pub fn set_team_look(
        &mut self,
        by: PersonId,
        team: TeamId,
        emblem: Emblem,
        color: RoomColor,
    ) -> Result<(), Refusal> {
        if self.teams.get(team).is_none_or(|t| t.withdrawn) {
            return Err(NO_SUCH_TEAM);
        }
        if self.people[by].team != Some(team) && !self.people[by].organizer {
            return Err(NOT_IN_THAT_TEAM);
        }
        let t = &mut self.teams[team];
        t.emblem = emblem;
        t.color = color;
        Ok(())
    }

    /// Join a team, leaving the one the person was in. A closed team wants its code. People may join
    /// teams after the start too, as long as the team is still in the tournament.
    pub fn join_team(
        &mut self,
        person: PersonId,
        team: TeamId,
        code: Option<&str>,
    ) -> Result<(), Refusal> {
        let t = self.teams.get(team).ok_or(NO_SUCH_TEAM)?;
        if t.withdrawn {
            return Err(NO_SUCH_TEAM);
        }
        if self.people[person].team == Some(team) {
            return Ok(());
        }
        if t.members.len() >= MAX_MEMBERS {
            return Err(TEAM_FULL);
        }
        if t.code.is_some() && t.code.as_deref() != code.map(normalize_code).as_deref() {
            return Err(WRONG_TEAM_CODE);
        }
        self.move_to(person, Some(team));
        Ok(())
    }

    pub fn leave_team(&mut self, person: PersonId) -> Result<(), Refusal> {
        if self.people[person].team.is_none() {
            return Err(NOT_IN_TEAM);
        }
        self.move_to(person, None);
        Ok(())
    }

    fn move_to(&mut self, person: PersonId, team: Option<TeamId>) {
        if let Some(old) = self.people[person].team {
            self.teams[old].members.retain(|&m| m != person);
        }
        if let Some(new) = team {
            self.teams[new].members.push(person);
        }
        self.people[person].team = team;
    }

    fn require_organizer(&self, person: PersonId) -> Result<(), Refusal> {
        if self.people[person].organizer {
            Ok(())
        } else {
            Err(NOT_ORGANIZER)
        }
    }

    /// An organizer makes somebody else an organizer too.
    pub fn promote(&mut self, by: PersonId, person: PersonId) -> Result<(), Refusal> {
        self.require_organizer(by)?;
        let p = self
            .people
            .get_mut(person)
            .filter(|p| !p.gone)
            .ok_or(NO_SUCH_PERSON)?;
        p.organizer = true;
        if p.conn.is_some() {
            self.orphaned_since = None;
        }
        Ok(())
    }

    /// An organizer changes what a level of the bracket plays (0 is the final). Once one of its matches has begun, the level
    /// keeps its game, so both teams of every match play by the same one.
    pub fn set_stage(
        &mut self,
        by: PersonId,
        stage: usize,
        rules: StageRules,
    ) -> Result<(), Refusal> {
        self.require_organizer(by)?;
        if stage >= STAGES {
            return Err(NO_SUCH_STAGE);
        }
        if let Some(bracket) = &self.bracket {
            let begun = bracket.matches().any(|(id, m)| {
                bracket.depth() > stage
                    && bracket.stage(id.level) == stage
                    && !m.bye
                    && matches!(m.state, MatchState::Playing | MatchState::Done)
            });
            if begun {
                return Err(STAGE_UNDER_WAY);
            }
        }
        self.settings.stages[stage] = rules;
        Ok(())
    }

    /// An organizer takes a team out. In registration it is gone; once the bracket is drawn it loses
    /// its match, and the one after if it is already through, so its opponents go on.
    pub fn remove_team(&mut self, by: PersonId, team: TeamId, now: Instant) -> Result<(), Refusal> {
        self.require_organizer(by)?;
        if team >= self.teams.len() || self.teams[team].withdrawn {
            return Err(NO_SUCH_TEAM);
        }
        for member in self.teams[team].members.clone() {
            self.move_to(member, None);
        }
        if self.phase == Phase::Registration {
            self.teams.remove(team);
            for person in &mut self.people {
                person.team = person.team.map(|t| if t > team { t - 1 } else { t });
            }
        } else {
            self.teams[team].withdrawn = true;
            self.settle_withdrawn(now);
        }
        Ok(())
    }

    /// An organizer starts the tournament: registration closes, teams nobody is in are dropped, and the
    /// bracket is drawn.
    pub fn start(&mut self, by: PersonId, now: Instant, rng: &mut impl Rng) -> Result<(), Refusal> {
        self.require_organizer(by)?;
        if self.phase != Phase::Registration {
            return Err(REGISTRATION_CLOSED);
        }
        if self.teams.iter().filter(|t| !t.members.is_empty()).count() < 2 {
            return Err(TOO_FEW_TEAMS);
        }
        let mut kept = Vec::new();
        for team in std::mem::take(&mut self.teams) {
            if !team.members.is_empty() {
                for &member in &team.members {
                    self.people[member].team = Some(kept.len());
                }
                kept.push(team);
            }
        }
        self.teams = kept;
        let ids: Vec<TeamId> = (0..self.teams.len()).collect();
        self.bracket = Some(Bracket::draw(&ids, rng));
        self.phase = Phase::Running;
        self.note_ready(now);
        Ok(())
    }

    fn bracket_mut(&mut self) -> Result<&mut Bracket, Refusal> {
        self.bracket.as_mut().ok_or(NOT_RUNNING)
    }

    fn existing_match(&self, id: MatchId) -> Result<&Match, Refusal> {
        let bracket = self.bracket.as_ref().ok_or(NOT_RUNNING)?;
        if bracket.contains(id) {
            Ok(bracket.get(id))
        } else {
            Err(NO_SUCH_MATCH)
        }
    }

    /// The rules of the level a match is in.
    pub fn rules_for(&self, id: MatchId) -> Option<&StageRules> {
        let bracket = self.bracket.as_ref()?;
        bracket
            .contains(id)
            .then(|| &self.settings.stages[bracket.stage(id.level)])
    }

    /// Whether somebody of a team is connected.
    pub fn present(&self, team: TeamId) -> bool {
        self.teams[team]
            .members
            .iter()
            .any(|&m| self.people[m].conn.is_some())
    }

    /// The matches that wait only for their teams to come, the way the relay finds which rooms to
    /// open.
    pub fn ready_matches(&self) -> Vec<MatchId> {
        self.bracket.as_ref().map_or_else(Vec::new, |bracket| {
            bracket
                .matches()
                .filter(|(_, m)| m.state == MatchState::Ready)
                .map(|(id, _)| id)
                .collect()
        })
    }

    /// The match's room is open and its game began.
    pub fn match_started(&mut self, id: MatchId) -> Result<(), Refusal> {
        if self.existing_match(id)?.state != MatchState::Ready {
            return Err(MATCH_NOT_READY);
        }
        self.bracket_mut()?.start(id);
        self.ready_since.retain(|(m, _)| *m != id);
        Ok(())
    }

    /// The match's room went away before the game had a winner (its host dropped for good): it is
    /// played again in a new room.
    pub fn match_abandoned(&mut self, id: MatchId, now: Instant) -> Result<(), Refusal> {
        if self.existing_match(id)?.state != MatchState::Playing {
            return Err(MATCH_NOT_PLAYING);
        }
        self.bracket_mut()?.restart(id);
        self.note_ready(now);
        Ok(())
    }

    /// What a decided match's game ended on, each side's points in the order of the match's teams.
    pub fn record_score(&mut self, id: MatchId, score: [i64; 2]) {
        if let Some(bracket) = self.bracket.as_mut().filter(|b| b.contains(id)) {
            bracket.set_score(id, score);
        }
    }

    /// The match's game ended with a winner.
    pub fn match_won(&mut self, id: MatchId, winner: TeamId, now: Instant) -> Result<(), Refusal> {
        let m = self.existing_match(id)?;
        if m.state != MatchState::Playing {
            return Err(MATCH_NOT_PLAYING);
        }
        if !m.teams.contains(&Some(winner)) {
            return Err(NOT_IN_MATCH);
        }
        self.decide(id, winner, now);
        Ok(())
    }

    /// An organizer skips a ready match that has waited `SKIP_AFTER` for a team. The team that is
    /// there goes through. When neither came, the organizer names the winner, or with `None` the
    /// relay draws lots.
    pub fn skip(
        &mut self,
        by: PersonId,
        id: MatchId,
        pick: Option<TeamId>,
        now: Instant,
        rng: &mut impl Rng,
    ) -> Result<TeamId, Refusal> {
        self.require_organizer(by)?;
        let m = self.existing_match(id)?;
        if m.state != MatchState::Ready {
            return Err(MATCH_NOT_READY);
        }
        let teams = m.teams.map(|t| t.expect("a ready match has both teams"));
        let since = self
            .ready_since
            .iter()
            .find(|(m, _)| *m == id)
            .map_or(now, |(_, at)| *at);
        if now.duration_since(since) < SKIP_AFTER {
            return Err(SKIP_TOO_EARLY);
        }
        let winner = match teams.map(|t| self.present(t)) {
            [true, true] => return Err(BOTH_TEAMS_HERE),
            [true, false] => teams[0],
            [false, true] => teams[1],
            [false, false] => match pick {
                Some(team) if teams.contains(&team) => team,
                Some(_) => return Err(NOT_IN_MATCH),
                None => teams[rng.gen_range(0..2)],
            },
        };
        self.decide(id, winner, now);
        Ok(winner)
    }

    fn decide(&mut self, id: MatchId, winner: TeamId, now: Instant) {
        self.ready_since.retain(|(m, _)| *m != id);
        let bracket = self
            .bracket
            .as_mut()
            .expect("a decided match has a bracket");
        bracket.decide(id, winner);
        if bracket.champion().is_some() {
            self.phase = Phase::Finished;
            self.ready_since.clear();
            return;
        }
        self.settle_withdrawn(now);
    }

    /// A ready match with a withdrawn team goes to the other one at once (to the first when both are).
    fn settle_withdrawn(&mut self, now: Instant) {
        let forfeit = self.bracket.as_ref().and_then(|bracket| {
            bracket.matches().find_map(|(id, m)| {
                let teams = m.teams.map(|t| t.filter(|&t| !self.teams[t].withdrawn));
                match (m.state, m.teams, teams) {
                    (MatchState::Ready | MatchState::Playing, [Some(a), Some(_)], [None, None]) => {
                        Some((id, a))
                    }
                    (MatchState::Ready | MatchState::Playing, _, [Some(a), None])
                    | (MatchState::Ready | MatchState::Playing, _, [None, Some(a)]) => {
                        Some((id, a))
                    }
                    _ => None,
                }
            })
        });
        match forfeit {
            Some((id, winner)) => self.decide(id, winner, now),
            None => self.note_ready(now),
        }
    }

    fn note_ready(&mut self, now: Instant) {
        for id in self.ready_matches() {
            if !self.ready_since.iter().any(|(m, _)| *m == id) {
                self.ready_since.push((id, now));
            }
        }
    }

    /// What has to happen with time: when no organizer has been connected for `ORGANIZER_GRACE`,
    /// somebody connected is named one at random.
    pub fn tick(&mut self, now: Instant, rng: &mut impl Rng) -> Option<PersonId> {
        let since = self.orphaned_since?;
        if now.duration_since(since) < ORGANIZER_GRACE {
            return None;
        }
        let connected: Vec<PersonId> = (0..self.people.len())
            .filter(|&p| self.people[p].conn.is_some())
            .collect();
        if connected.is_empty() {
            return None;
        }
        let named = connected[rng.gen_range(0..connected.len())];
        self.people[named].organizer = true;
        self.orphaned_since = None;
        Some(named)
    }
}
