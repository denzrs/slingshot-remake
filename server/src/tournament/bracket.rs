//! The knockout bracket: who meets whom, and where a match's winner goes next.

use rand::seq::SliceRandom;
use rand::Rng;

/// A team, by its place in the tournament's list of teams.
pub type TeamId = usize;

/// A match, by its level (0 is the first level played) and its place in that level.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct MatchId {
    pub level: usize,
    pub index: usize,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MatchState {
    /// At least one of its teams is not known yet: an earlier match has still to be played.
    Waiting,
    /// Both teams are known and the match can be played.
    Ready,
    /// Its room is open and the game runs.
    Playing,
    /// It has a winner: played, skipped, or a bye.
    Done,
}

#[derive(Clone, Debug)]
pub struct Match {
    pub teams: [Option<TeamId>; 2],
    pub state: MatchState,
    pub winner: Option<TeamId>,
    /// One team had nobody to meet in the first level and went through without playing.
    pub bye: bool,
    /// The points each side ended the game on, in the order of `teams`; none for a match not played out.
    pub score: Option<[i64; 2]>,
}

impl Match {
    fn empty() -> Self {
        Self {
            teams: [None, None],
            state: MatchState::Waiting,
            winner: None,
            bye: false,
            score: None,
        }
    }
}

/// A single-elimination bracket. Its size is the smallest power of two that holds every team; the
/// places left over are byes, at most one per first-level match, spread over the bracket.
#[derive(Clone, Debug)]
pub struct Bracket {
    /// `levels[0]` is the first level played, the last one holds the final alone.
    levels: Vec<Vec<Match>>,
}

impl Bracket {
    /// Draw `teams` (two at least) at random into a bracket and let the byes through.
    pub fn draw(teams: &[TeamId], rng: &mut impl Rng) -> Self {
        assert!(teams.len() >= 2, "a bracket needs two teams");
        let mut order = teams.to_vec();
        order.shuffle(rng);
        let size = order.len().next_power_of_two();
        let first = size / 2;
        let byes = size - order.len();
        // Spread the byes: match `k * first / byes` for each bye k, which never picks one twice as
        // there are fewer byes than first-level matches.
        let bye_at: Vec<usize> = (0..byes).map(|k| k * first / byes).collect();
        let mut levels = Vec::new();
        let mut count = first;
        while count >= 1 {
            levels.push((0..count).map(|_| Match::empty()).collect::<Vec<_>>());
            count /= 2;
        }
        let mut next = order.into_iter();
        for (index, slot) in levels[0].iter_mut().enumerate() {
            slot.teams[0] = next.next();
            if bye_at.contains(&index) {
                slot.bye = true;
            } else {
                slot.teams[1] = next.next();
            }
        }
        let mut bracket = Self { levels };
        for index in 0..first {
            let id = MatchId { level: 0, index };
            if bracket.get(id).bye {
                let team = bracket.get(id).teams[0].expect("a bye has its team");
                bracket.decide(id, team);
            } else {
                bracket.get_mut(id).state = MatchState::Ready;
            }
        }
        bracket
    }

    /// How many levels there are: 1 for a final alone, 4 for a round of 16 and on.
    pub fn depth(&self) -> usize {
        self.levels.len()
    }

    /// How far a level is from the final: 0 for the final, 1 for the semi-finals, and so on.
    pub fn stage(&self, level: usize) -> usize {
        self.depth() - 1 - level
    }

    pub fn get(&self, id: MatchId) -> &Match {
        &self.levels[id.level][id.index]
    }

    fn get_mut(&mut self, id: MatchId) -> &mut Match {
        &mut self.levels[id.level][id.index]
    }

    pub fn contains(&self, id: MatchId) -> bool {
        self.levels
            .get(id.level)
            .is_some_and(|level| id.index < level.len())
    }

    /// Every match, level by level.
    pub fn matches(&self) -> impl Iterator<Item = (MatchId, &Match)> {
        self.levels.iter().enumerate().flat_map(|(level, matches)| {
            matches
                .iter()
                .enumerate()
                .map(move |(index, m)| (MatchId { level, index }, m))
        })
    }

    /// The match a team plays now or next, if it is still in the tournament.
    pub fn current_match(&self, team: TeamId) -> Option<MatchId> {
        self.matches()
            .find(|(_, m)| m.state != MatchState::Done && m.teams.contains(&Some(team)))
            .map(|(id, _)| id)
    }

    /// The winner of the final, once it is played.
    pub fn champion(&self) -> Option<TeamId> {
        self.levels.last().and_then(|final_| final_[0].winner)
    }

    /// What a played match ended on.
    pub fn set_score(&mut self, id: MatchId, score: [i64; 2]) {
        self.get_mut(id).score = Some(score);
    }

    pub fn start(&mut self, id: MatchId) {
        self.get_mut(id).state = MatchState::Playing;
    }

    /// Send a running match back to ready, as when its room went away before it had a winner.
    pub fn restart(&mut self, id: MatchId) {
        self.get_mut(id).state = MatchState::Ready;
    }

    /// Give a match its winner and move the winner on: into the next level's match, which is ready
    /// once both of its teams are known.
    pub fn decide(&mut self, id: MatchId, winner: TeamId) {
        let m = self.get_mut(id);
        debug_assert!(m.teams.contains(&Some(winner)));
        m.winner = Some(winner);
        m.state = MatchState::Done;
        if id.level + 1 == self.depth() {
            return;
        }
        let next = MatchId {
            level: id.level + 1,
            index: id.index / 2,
        };
        let m = self.get_mut(next);
        m.teams[id.index % 2] = Some(winner);
        if m.teams.iter().all(Option::is_some) {
            m.state = MatchState::Ready;
        }
    }
}
