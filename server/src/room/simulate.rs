//! A dev relay plays out the tournament matches nobody would run: those between teams of pretend
//! players only (`?bot=`). A pretend player never hosts, so without this such a match would wait
//! for ever; with it, a tournament full of bot teams runs from the first level to the final on its
//! own, round by round, for trying the bracket, the arena and the ticker alone. No game is played:
//! the points of each round are drawn. A person once seen as a pretend player stays one, so the
//! tournament runs on when the page that made the bots reloads. A public relay lets no pretend
//! player in, so it never simulates anything.

use std::time::{Duration, Instant};

use rand::Rng;
use serde_json::{json, Value};
use tracing::info;

use crate::tournament::{MatchId, MatchState, Tournament};

use super::RoomManager;

/// How long a simulated round takes, at the least and at the most.
const ROUND_TIME: (u64, u64) = (3, 6);
/// The rounds a match lasts when its level's game sets none (an endless game).
const ENDLESS_ROUNDS: i64 = 5;

/// A match the relay plays out itself.
#[derive(Debug)]
pub(super) struct Simulated {
    /// Rounds played so far.
    round: i64,
    rounds: i64,
    /// Each side's points, in the order of the match's teams.
    score: [i64; 2],
    next_round: Instant,
}

impl Simulated {
    /// How it stands, as a match room's game would tell it.
    pub(super) fn live_json(&self) -> Value {
        json!({ "round": self.round, "score": self.score })
    }
}

fn round_time(rng: &mut impl Rng) -> Duration {
    Duration::from_secs(rng.gen_range(ROUND_TIME.0..=ROUND_TIME.1))
}

impl RoomManager {
    /// Whether every one of a team's people is a pretend player (and it has any).
    fn bots_only(&self, code: &str, tournament: &Tournament, team: usize) -> bool {
        let people: Vec<_> = tournament.teams[team]
            .members
            .iter()
            .filter(|&&m| !tournament.people[m].gone)
            .collect();
        !people.is_empty()
            && people
                .iter()
                .all(|&&m| self.tournaments.pretend.contains(&(code.to_owned(), m)))
    }

    /// Notes the people connected as pretend players now.
    fn note_pretend_people(&mut self) {
        for (code, tournament) in &self.tournaments.by_code {
            for (id, person) in tournament.people.iter().enumerate() {
                if person
                    .conn
                    .is_some_and(|conn| self.bots.contains_key(&conn))
                {
                    self.tournaments.pretend.insert((code.clone(), id));
                }
            }
        }
        let codes = &self.tournaments.by_code;
        self.tournaments
            .pretend
            .retain(|(code, _)| codes.contains_key(code));
    }

    /// Start the ready matches between pretend players only, play a round of each running one
    /// whose round is up, and decide the ones played out. Called with the tournaments' tick.
    pub(super) fn simulate_matches(&mut self, now: Instant, rng: &mut impl Rng) {
        if !self.bots_allowed {
            return;
        }
        self.note_pretend_people();
        let mut changed: Vec<String> = Vec::new();

        // Matches to start: ready, without a room, both teams pretend players only.
        let mut starting: Vec<(String, MatchId, i64)> = Vec::new();
        for (code, tournament) in &self.tournaments.by_code {
            for id in tournament.ready_matches() {
                let key = (code.clone(), id);
                if self.tournaments.rooms.contains_key(&key)
                    || self.tournaments.simulated.contains_key(&key)
                {
                    continue;
                }
                let teams = tournament.bracket.as_ref().unwrap().get(id).teams;
                let [Some(a), Some(b)] = teams else { continue };
                if !self.bots_only(code, tournament, a) || !self.bots_only(code, tournament, b) {
                    continue;
                }
                let rounds = tournament
                    .rules_for(id)
                    .and_then(|stage| stage.rules.get("rounds").as_i64())
                    .unwrap_or(0)
                    .max(0);
                starting.push((
                    code.clone(),
                    id,
                    if rounds == 0 { ENDLESS_ROUNDS } else { rounds },
                ));
            }
        }
        for (code, id, rounds) in starting {
            let tournament = self.tournaments.by_code.get_mut(&code).unwrap();
            if tournament.match_started(id).is_ok() {
                info!(tournament = %code, ?id, "simulated match started");
                self.tournaments.simulated.insert(
                    (code.clone(), id),
                    Simulated {
                        round: 0,
                        rounds,
                        score: [0, 0],
                        next_round: now + round_time(rng),
                    },
                );
                changed.push(code);
            }
        }

        // Rounds that are up, and matches that are over.
        let keys: Vec<(String, MatchId)> = self.tournaments.simulated.keys().cloned().collect();
        for key in keys {
            let (code, id) = key.clone();
            let playing = self
                .tournaments
                .by_code
                .get(&code)
                .and_then(|t| t.bracket.as_ref())
                .is_some_and(|b| b.get(id).state == MatchState::Playing);
            if !playing {
                self.tournaments.simulated.remove(&key);
                continue;
            }
            let sim = self.tournaments.simulated.get_mut(&key).unwrap();
            if now < sim.next_round {
                continue;
            }
            sim.round += 1;
            for side in &mut sim.score {
                *side += rng.gen_range(0..=40) * 10;
            }
            sim.next_round = now + round_time(rng);
            changed.push(code.clone());
            if sim.round < sim.rounds {
                continue;
            }
            // Played out: the side with more points wins; a draw is settled by a last shot.
            if sim.score[0] == sim.score[1] {
                sim.score[rng.gen_range(0..2)] += 10;
            }
            let score = sim.score;
            self.tournaments.simulated.remove(&key);
            let tournament = self.tournaments.by_code.get_mut(&code).unwrap();
            let teams = tournament.bracket.as_ref().unwrap().get(id).teams;
            let side = usize::from(score[1] > score[0]);
            if let Some(winner) = teams[side] {
                if tournament.match_won(id, winner, now).is_ok() {
                    tournament.record_score(id, score);
                    info!(tournament = %code, ?id, winner, "simulated match decided");
                }
            }
        }

        changed.sort();
        changed.dedup();
        for code in changed {
            self.broadcast_tournament(&code);
        }
    }
}
