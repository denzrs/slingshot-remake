use std::time::{Duration, Instant};

use rand::rngs::StdRng;
use rand::SeedableRng;

use super::*;
use crate::protocol::DEFAULT_RULES;

fn rng() -> StdRng {
    StdRng::seed_from_u64(7)
}

fn settings(team_size: usize) -> Settings {
    let stage = |game_mode| StageRules {
        game_mode,
        rules: DEFAULT_RULES.clone(),
    };
    Settings {
        team_size,
        max_teams: MAX_TEAMS,
        stages: [
            stage(GameMode::Horizon),
            stage(GameMode::Classic),
            stage(GameMode::Classic),
            stage(GameMode::Solar),
        ],
    }
}

/// A tournament whose organizer (person 0, connection 0) made no team, with `teams` teams of one
/// person each (connections 1, 2, …).
fn with_teams(teams: usize, now: Instant, rng: &mut StdRng) -> Tournament {
    let (mut t, _) = Tournament::new(settings(1), "Orga".into(), 0, now, rng);
    for n in 1..=teams {
        let person = t.join(format!("P{n}"), n as u64, rng).unwrap();
        t.create_team(person, format!("Team {n}"), false, rng)
            .unwrap();
    }
    t
}

/// Play every ready match, the first team winning, until the final is decided.
fn play_out(t: &mut Tournament, now: Instant) {
    while t.phase == Phase::Running {
        let id = t.ready_matches()[0];
        let winner = t.bracket.as_ref().unwrap().get(id).teams[0].unwrap();
        t.match_started(id).unwrap();
        t.match_won(id, winner, now).unwrap();
    }
}

#[test]
fn the_maker_is_the_first_organizer_and_gets_a_token() {
    let (t, me) = Tournament::new(settings(2), "Lena".into(), 9, Instant::now(), &mut rng());
    assert!(t.people[me].organizer);
    assert_eq!(t.people[me].conn, Some(9));
    assert!(!t.people[me].token.is_empty());
    assert_eq!(t.person_with_token(&t.people[me].token), Some(me));
    assert_eq!(t.phase, Phase::Registration);
}

#[test]
fn names_are_unique_in_upper_and_lower_case() {
    let mut rng = rng();
    let (mut t, _) = Tournament::new(settings(1), "Lena".into(), 0, Instant::now(), &mut rng);
    assert_eq!(t.join("LENA".into(), 1, &mut rng), Err(NAME_TAKEN));
    let tim = t.join("Tim".into(), 1, &mut rng).unwrap();
    t.create_team(tim, "Blau".into(), false, &mut rng).unwrap();
    assert_eq!(
        t.create_team(0, "blau".into(), false, &mut rng),
        Err(TEAM_NAME_TAKEN)
    );
}

#[test]
fn a_closed_team_wants_its_code_and_an_open_one_does_not() {
    let mut rng = rng();
    let (mut t, lena) = Tournament::new(settings(2), "Lena".into(), 0, Instant::now(), &mut rng);
    let tim = t.join("Tim".into(), 1, &mut rng).unwrap();
    let ida = t.join("Ida".into(), 2, &mut rng).unwrap();
    let closed = t.create_team(lena, "Rot".into(), true, &mut rng).unwrap();
    let open = t.create_team(tim, "Blau".into(), false, &mut rng).unwrap();
    let code = t.teams[closed].code.clone().unwrap();
    assert!(t.teams[open].code.is_none());

    assert_eq!(t.join_team(ida, closed, None), Err(WRONG_TEAM_CODE));
    assert_eq!(t.join_team(ida, closed, Some("nope")), Err(WRONG_TEAM_CODE));
    assert!(code.bytes().all(|b| CODE_ALPHABET.contains(&b)));
    t.join_team(ida, closed, Some(&code.to_lowercase()))
        .unwrap();
    assert_eq!(t.teams[closed].members, vec![lena, ida]);

    // Joining another team leaves the old one.
    t.join_team(ida, open, None).unwrap();
    assert_eq!(t.teams[closed].members, vec![lena]);
    assert_eq!(t.teams[open].members, vec![tim, ida]);
    assert_eq!(t.people[ida].team, Some(open));
}

#[test]
fn a_team_holds_five_and_a_tournament_sixteen_teams() {
    let mut rng = rng();
    let (mut t, lena) = Tournament::new(settings(3), "Lena".into(), 0, Instant::now(), &mut rng);
    let team = t.create_team(lena, "Rot".into(), false, &mut rng).unwrap();
    for n in 1..MAX_MEMBERS {
        let p = t.join(format!("P{n}"), n as u64, &mut rng).unwrap();
        t.join_team(p, team, None).unwrap();
    }
    let late = t.join("Late".into(), 99, &mut rng).unwrap();
    assert_eq!(t.join_team(late, team, None), Err(TEAM_FULL));

    for n in 1..MAX_TEAMS {
        let p = t.join(format!("Q{n}"), 100 + n as u64, &mut rng).unwrap();
        t.create_team(p, format!("Team {n}"), false, &mut rng)
            .unwrap();
    }
    assert_eq!(
        t.create_team(late, "One too many".into(), false, &mut rng),
        Err(TEAMS_FULL)
    );
}

#[test]
fn only_an_organizer_starts_and_two_teams_with_players_are_needed() {
    let mut rng = rng();
    let now = Instant::now();
    let mut t = with_teams(1, now, &mut rng);
    assert_eq!(t.start(1, now, &mut rng), Err(NOT_ORGANIZER));
    assert_eq!(t.start(0, now, &mut rng), Err(TOO_FEW_TEAMS));

    // A team everybody left does not count, and is dropped at the start.
    let p = t.join("Gone".into(), 50, &mut rng).unwrap();
    t.create_team(p, "Leer".into(), false, &mut rng).unwrap();
    t.leave_team(p).unwrap();
    assert_eq!(t.start(0, now, &mut rng), Err(TOO_FEW_TEAMS));
    let q = t.join("Here".into(), 51, &mut rng).unwrap();
    t.create_team(q, "Voll".into(), false, &mut rng).unwrap();
    t.start(0, now, &mut rng).unwrap();
    assert_eq!(t.phase, Phase::Running);
    assert_eq!(t.teams.len(), 2);
    assert_eq!(t.people[q].team, Some(1));
    assert_eq!(t.start(0, now, &mut rng), Err(REGISTRATION_CLOSED));
    assert_eq!(
        t.create_team(q, "Zu spät".into(), false, &mut rng),
        Err(REGISTRATION_CLOSED)
    );
}

#[test]
fn byes_are_spread_one_per_match_and_go_straight_through() {
    for teams in 2..=MAX_TEAMS {
        let mut rng = rng();
        let now = Instant::now();
        let mut t = with_teams(teams, now, &mut rng);
        t.start(0, now, &mut rng).unwrap();
        let bracket = t.bracket.as_ref().unwrap();
        let size = teams.next_power_of_two();
        assert_eq!(bracket.depth(), size.trailing_zeros() as usize);

        let first: Vec<&Match> = bracket
            .matches()
            .filter(|(id, _)| id.level == 0)
            .map(|(_, m)| m)
            .collect();
        let byes = first.iter().filter(|m| m.bye).count();
        assert_eq!(byes, size - teams, "{teams} teams");
        for m in &first {
            assert!(m.teams[0].is_some(), "no match is all byes");
            assert_eq!(m.bye, m.teams[1].is_none());
            assert_eq!(m.state == MatchState::Done, m.bye);
        }
        // Every team is drawn once.
        let mut drawn: Vec<TeamId> = first.iter().flat_map(|m| m.teams).flatten().collect();
        drawn.sort();
        assert_eq!(drawn, (0..teams).collect::<Vec<_>>());
        // Two byes side by side meet at once in the next level.
        let byes_ahead = bracket
            .matches()
            .filter(|(id, m)| id.level == 1 && m.state == MatchState::Ready)
            .count();
        let pairs_of_byes = first.chunks(2).filter(|p| p.iter().all(|m| m.bye)).count();
        assert_eq!(byes_ahead, pairs_of_byes, "{teams} teams");
    }
}

#[test]
fn a_winner_moves_on_as_soon_as_the_other_side_is_known() {
    let mut rng = rng();
    let now = Instant::now();
    let mut t = with_teams(8, now, &mut rng);
    t.start(0, now, &mut rng).unwrap();
    assert_eq!(t.ready_matches().len(), 4);

    let m0 = MatchId { level: 0, index: 0 };
    let m1 = MatchId { level: 0, index: 1 };
    let semi = MatchId { level: 1, index: 0 };
    let a = t.bracket.as_ref().unwrap().get(m0).teams[1].unwrap();
    let b = t.bracket.as_ref().unwrap().get(m1).teams[0].unwrap();

    assert_eq!(t.match_won(m0, a, now), Err(MATCH_NOT_PLAYING));
    t.match_started(m0).unwrap();
    assert_eq!(t.match_started(m0), Err(MATCH_NOT_READY));
    assert_eq!(t.match_won(m0, b, now), Err(NOT_IN_MATCH));
    t.match_won(m0, a, now).unwrap();
    let bracket = t.bracket.as_ref().unwrap();
    assert_eq!(bracket.get(semi).teams, [Some(a), None]);
    assert_eq!(bracket.get(semi).state, MatchState::Waiting);
    assert_eq!(bracket.current_match(a), Some(semi));

    // The semi-final is ready once its other quarter-final is played, whatever the rest do.
    t.match_started(m1).unwrap();
    t.match_won(m1, b, now).unwrap();
    assert_eq!(
        t.bracket.as_ref().unwrap().get(semi).state,
        MatchState::Ready
    );
    assert!(t.ready_matches().contains(&semi));
}

#[test]
fn each_level_plays_by_its_own_rules() {
    let mut rng = rng();
    let now = Instant::now();
    let mut t = with_teams(5, now, &mut rng);
    t.start(0, now, &mut rng).unwrap();
    // Five teams make a bracket of eight: quarter-finals, semi-finals, final.
    let mode = |t: &Tournament, level| t.rules_for(MatchId { level, index: 0 }).unwrap().game_mode;
    assert_eq!(mode(&t, 2), GameMode::Horizon);
    assert_eq!(mode(&t, 1), GameMode::Classic);
    assert_eq!(mode(&t, 0), GameMode::Classic);
    assert!(t.rules_for(MatchId { level: 3, index: 0 }).is_none());
}

#[test]
fn the_final_ends_the_tournament() {
    let mut rng = rng();
    let now = Instant::now();
    let mut t = with_teams(6, now, &mut rng);
    t.start(0, now, &mut rng).unwrap();
    play_out(&mut t, now);
    assert_eq!(t.phase, Phase::Finished);
    assert!(t.bracket.as_ref().unwrap().champion().is_some());
    assert!(t.ready_matches().is_empty());
}

#[test]
fn a_match_whose_room_went_away_is_played_again() {
    let mut rng = rng();
    let now = Instant::now();
    let mut t = with_teams(2, now, &mut rng);
    t.start(0, now, &mut rng).unwrap();
    let final_ = MatchId { level: 0, index: 0 };
    t.match_started(final_).unwrap();
    t.match_abandoned(final_, now).unwrap();
    assert_eq!(t.ready_matches(), vec![final_]);
    assert_eq!(t.match_abandoned(final_, now), Err(MATCH_NOT_PLAYING));
}

#[test]
fn a_skip_waits_thirty_seconds_and_lets_the_team_that_is_there_through() {
    let mut rng = rng();
    let now = Instant::now();
    let mut t = with_teams(2, now, &mut rng);
    t.start(0, now, &mut rng).unwrap();
    let final_ = MatchId { level: 0, index: 0 };
    let [a, b] = t
        .bracket
        .as_ref()
        .unwrap()
        .get(final_)
        .teams
        .map(Option::unwrap);

    assert_eq!(t.skip(1, final_, None, now, &mut rng), Err(NOT_ORGANIZER));
    let later = now + SKIP_AFTER;
    assert_eq!(
        t.skip(0, final_, None, later, &mut rng),
        Err(BOTH_TEAMS_HERE)
    );

    let gone = t.teams[b].members[0];
    t.disconnect(gone, now);
    assert_eq!(
        t.skip(0, final_, None, now + Duration::from_secs(29), &mut rng),
        Err(SKIP_TOO_EARLY)
    );
    assert_eq!(t.skip(0, final_, Some(b), later, &mut rng), Ok(a));
    assert_eq!(t.phase, Phase::Finished);
}

#[test]
fn when_neither_team_came_the_organizer_picks_or_lots_are_drawn() {
    let now = Instant::now();
    let later = now + SKIP_AFTER;
    let final_ = MatchId { level: 0, index: 0 };
    let empty = |rng: &mut StdRng| {
        let mut t = with_teams(2, now, rng);
        t.start(0, now, rng).unwrap();
        for team in 0..2 {
            let member = t.teams[team].members[0];
            t.disconnect(member, now);
        }
        t
    };

    let mut rng = rng();
    let mut t = empty(&mut rng);
    let b = t.bracket.as_ref().unwrap().get(final_).teams[1].unwrap();
    assert_eq!(
        t.skip(0, final_, Some(99), later, &mut rng),
        Err(NOT_IN_MATCH)
    );
    assert_eq!(t.skip(0, final_, Some(b), later, &mut rng), Ok(b));

    let mut t = empty(&mut rng);
    let teams = t.bracket.as_ref().unwrap().get(final_).teams;
    let drawn = t.skip(0, final_, None, later, &mut rng).unwrap();
    assert!(teams.contains(&Some(drawn)));
}

#[test]
fn a_withdrawn_team_loses_its_match_and_the_next() {
    let mut rng = rng();
    let now = Instant::now();
    let mut t = with_teams(4, now, &mut rng);
    t.start(0, now, &mut rng).unwrap();
    let m0 = MatchId { level: 0, index: 0 };
    let m1 = MatchId { level: 0, index: 1 };
    let final_ = MatchId { level: 1, index: 0 };
    let [a, b] = t
        .bracket
        .as_ref()
        .unwrap()
        .get(m0)
        .teams
        .map(Option::unwrap);

    assert_eq!(t.remove_team(1, a, now), Err(NOT_ORGANIZER));
    t.remove_team(0, a, now).unwrap();
    let bracket = t.bracket.as_ref().unwrap();
    assert_eq!(bracket.get(m0).winner, Some(b));
    assert!(t.teams[a].members.is_empty());
    assert_eq!(t.join_team(0, a, None), Err(NO_SUCH_TEAM));

    // Withdrawing a team already through to the final gives the final to whoever comes out of the other half.
    t.remove_team(0, b, now).unwrap();
    let c = t.bracket.as_ref().unwrap().get(m1).teams[0].unwrap();
    t.match_started(m1).unwrap();
    t.match_won(m1, c, now).unwrap();
    assert_eq!(t.bracket.as_ref().unwrap().get(final_).winner, Some(c));
    assert_eq!(t.phase, Phase::Finished);
}

#[test]
fn a_team_removed_in_registration_is_gone() {
    let mut rng = rng();
    let now = Instant::now();
    let mut t = with_teams(3, now, &mut rng);
    t.remove_team(0, 0, now).unwrap();
    assert_eq!(t.teams.len(), 2);
    assert_eq!(t.teams[0].name, "Team 2");
    assert_eq!(t.people[1].team, None);
    assert_eq!(t.people[2].team, Some(0));
    assert_eq!(t.people[3].team, Some(1));
}

#[test]
fn people_change_teams_after_the_start_and_come_back_with_their_token() {
    let mut rng = rng();
    let now = Instant::now();
    let mut t = with_teams(2, now, &mut rng);
    t.start(0, now, &mut rng).unwrap();
    let late = t.join("Late".into(), 70, &mut rng).unwrap();
    t.join_team(late, 1, None).unwrap();
    assert_eq!(t.teams[1].members.len(), 2);

    t.disconnect(late, now);
    assert_eq!(t.people[late].conn, None);
    assert_eq!(t.people[late].team, Some(1), "a drop keeps the team");
    let token = t.people[late].token.clone();
    let back = t.person_with_token(&token).unwrap();
    t.resume(back, 71);
    assert_eq!(t.people[late].conn, Some(71));
}

#[test]
fn organizers_name_more_organizers_and_somebody_takes_over_when_all_are_gone() {
    let mut rng = rng();
    let now = Instant::now();
    let mut t = with_teams(3, now, &mut rng);
    assert_eq!(t.promote(1, 2), Err(NOT_ORGANIZER));
    t.promote(0, 1).unwrap();
    assert!(t.people[1].organizer);

    t.disconnect(0, now);
    assert_eq!(
        t.tick(now + ORGANIZER_GRACE, &mut rng),
        None,
        "one is still here"
    );
    t.disconnect(1, now);
    assert_eq!(t.tick(now + Duration::from_secs(59), &mut rng), None);
    let named = t.tick(now + ORGANIZER_GRACE, &mut rng).unwrap();
    assert!([2, 3].contains(&named));
    assert!(t.people[named].organizer);
    assert_eq!(t.tick(now + 2 * ORGANIZER_GRACE, &mut rng), None);
}

#[test]
fn an_organizer_coming_back_in_time_keeps_the_job() {
    let mut rng = rng();
    let now = Instant::now();
    let mut t = with_teams(2, now, &mut rng);
    t.disconnect(0, now);
    t.resume(0, 5);
    assert_eq!(t.tick(now + ORGANIZER_GRACE, &mut rng), None);
    assert!(!t.people[1].organizer && !t.people[2].organizer);
}

#[test]
fn a_tournament_runs_out_after_a_day() {
    let now = Instant::now();
    let (t, _) = Tournament::new(settings(1), "Lena".into(), 0, now, &mut rng());
    assert!(!t.expired(now + LIFETIME - Duration::from_secs(1)));
    assert!(t.expired(now + LIFETIME));
}

#[test]
fn whoever_leaves_frees_the_name_and_their_token_brings_nobody_back() {
    let mut rng = rng();
    let now = Instant::now();
    let mut t = with_teams(2, now, &mut rng);
    t.promote(0, 1).unwrap();
    let token = t.people[1].token.clone();
    t.leave(1, now);
    assert!(t.teams[0].members.is_empty());
    assert!(!t.people[1].organizer);
    assert_eq!(t.person_with_token(&token), None);
    assert_eq!(t.promote(0, 1), Err(NO_SUCH_PERSON));
    let again = t.join("P1".into(), 1, &mut rng).unwrap();
    assert_ne!(again, 1);
}

#[test]
fn an_organizer_changes_a_levels_game_until_the_level_begins() {
    let mut rng = rng();
    let now = Instant::now();
    let mut t = with_teams(4, now, &mut rng);
    let solar = StageRules {
        game_mode: GameMode::Solar,
        rules: DEFAULT_RULES.clone(),
    };
    assert_eq!(t.set_stage(1, 0, solar.clone()), Err(NOT_ORGANIZER));
    assert_eq!(t.set_stage(0, STAGES, solar.clone()), Err(NO_SUCH_STAGE));
    t.set_stage(0, 1, solar.clone()).unwrap();
    assert_eq!(t.settings.stages[1].game_mode, GameMode::Solar);

    t.start(0, now, &mut rng).unwrap();
    // The semi-finals have not begun: still free to change. Once one is played, they keep their game.
    t.set_stage(0, 1, solar.clone()).unwrap();
    let semi = MatchId { level: 0, index: 0 };
    t.match_started(semi).unwrap();
    assert_eq!(t.set_stage(0, 1, solar.clone()), Err(STAGE_UNDER_WAY));
    t.set_stage(0, 0, solar).unwrap();
}

#[test]
fn teams_get_their_own_look_and_members_change_it() {
    use crate::wire::{Emblem, RoomColor};
    let mut rng = rng();
    let now = Instant::now();
    let mut t = with_teams(3, now, &mut rng);
    assert_ne!(t.teams[0].emblem, t.teams[1].emblem);
    assert_ne!(t.teams[1].color, t.teams[2].color);
    // Person 1 is in team 0; person 2 is not, and is no organizer.
    assert_eq!(
        t.set_team_look(2, 0, Emblem::Crown, RoomColor::Pink),
        Err(NOT_IN_THAT_TEAM)
    );
    t.set_team_look(1, 0, Emblem::Crown, RoomColor::Pink)
        .unwrap();
    assert_eq!(
        (t.teams[0].emblem, t.teams[0].color),
        (Emblem::Crown, RoomColor::Pink)
    );
    t.set_team_look(0, 1, Emblem::Anchor, RoomColor::Sky)
        .unwrap();
    assert_eq!(
        t.set_team_look(1, 9, Emblem::Anchor, RoomColor::Sky),
        Err(NO_SUCH_TEAM)
    );
}

#[test]
fn a_team_taken_out_leaves_its_place_free_and_the_others_stay_put() {
    let mut rng = rng();
    let now = Instant::now();
    let mut t = with_teams(4, now, &mut rng);
    assert_eq!(
        t.teams.iter().map(|x| x.slot).collect::<Vec<_>>(),
        [0, 1, 2, 3]
    );

    // Team 2 (place 1) goes: the places after it keep theirs.
    t.remove_team(0, 1, now).unwrap();
    assert_eq!(
        t.teams.iter().map(|x| x.slot).collect::<Vec<_>>(),
        [0, 2, 3]
    );

    // The next one asking for place 3 (taken) gets the first free place, 1; one asking for 5 gets it.
    let late = t.join("Late".into(), 9, &mut rng).unwrap();
    t.create_team_at(late, "Late".into(), false, Some(3), &mut rng)
        .unwrap();
    assert_eq!(t.teams.last().unwrap().slot, 1);
    let later = t.join("Later".into(), 10, &mut rng).unwrap();
    t.create_team_at(later, "Later".into(), false, Some(5), &mut rng)
        .unwrap();
    assert_eq!(t.teams.last().unwrap().slot, 5);
}
