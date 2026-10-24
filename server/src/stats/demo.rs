//! Synthetic match history for inspecting the statistics page locally. This is only reached by
//! the relay's explicit `--stats-demo` flag, which uses a separate database file by default.

use std::net::IpAddr;

use crate::protocol::{rules_to_value, DEFAULT_RULES};
use crate::report::{
    PlacementReport, RecordRound, RoundReport, SeatRound, SeatTurn, ShotRound, TipRound,
    TurnReport, RECORD_KEYS,
};

use super::{now_unix, Job, Occupant, RoundFacts, SeatFacts, Stats, DAY_SECS};

const DEMO_TABLES: [&str; 11] = [
    "stat_tips",
    "stat_placements",
    "stat_shots",
    "stat_turns",
    "stat_seats",
    "stat_rounds",
    "stat_matches",
    "stat_day_players",
    "stat_local_day_players",
    "stat_days",
    "stat_local_days",
];

const GAME_MODES: [&str; 3] = ["classic", "horizon", "solar"];
const CPU_LEVELS: [&str; 3] = ["easy", "hawking", "hard"];
const POWER_UPS: [Option<&str>; 5] = [
    Some("plasma"),
    Some("piercing"),
    Some("splitter"),
    Some("preview"),
    None,
];
const TITLES: [&str; 6] = [
    "hit",
    "selfHit",
    "swallowed",
    "noneLeft",
    "cleared",
    "outOfShots",
];

impl Stats {
    /// Replaces the demo database's statistics with a year of reproducible sample games.
    pub async fn seed_demo(&self) -> turso::Result<usize> {
        self.clear_demo_rows().await?;

        let now = now_unix();
        let today = now - now.rem_euclid(DAY_SECS);
        // Keep today's synthetic entries in the past even if the relay starts before noon UTC.
        let today_offset = (now - today) * 2 / 3;
        let mut games = 0;

        // A game every three days gives the heatmap a full-year shape and enough rounds for every
        // menu fact's minimum sample size. Every third game uses teams; modes and CPU levels vary.
        for age in (0..365).step_by(3) {
            let index = games;
            let id = index as u64 + 1;
            let at = today - age as i64 * DAY_SECS + today_offset;
            let game_mode = GAME_MODES[index % GAME_MODES.len()];
            let team_mode = index % 3 == 0;
            let facts = demo_facts(id, index, game_mode, team_mode, false, 2);

            for round in 1_i64..=2 {
                for turn in 1_i64..=2 {
                    let report = demo_turn(index, round, turn);
                    self.record_at(
                        &Job::Turn(facts.clone(), report),
                        at + (round * 3 + turn) * 60,
                    )
                    .await?;
                }
                let report = demo_round(index, round, team_mode, false);
                self.record_at(&Job::Round(facts.clone(), report), at + round * 5 * 60)
                    .await?;
            }

            // The sample shots and rounds are useful for the charts and facts, but they do not
            // describe a real deterministic match. Keep their replay buttons disabled.
            self.store
                .conn
                .execute(
                    "UPDATE stat_matches SET replayable = 0 WHERE match_id = ?1",
                    (facts.match_id.clone(),),
                )
                .await?;
            games += 1;
        }

        // Local games populate the second heatmap and the source switch. Their fixture rounds are
        // intentionally summary-only, as actual local-game reports are.
        let mut local_index = 0;
        for age in (6..365).step_by(15) {
            let index = local_index + 200;
            let id = index as u64 + 1;
            let game_mode = GAME_MODES[index % GAME_MODES.len()];
            let team_mode = index % 4 == 0;
            let facts = demo_facts(id, index, game_mode, team_mode, true, 2);
            let rounds = (1_i64..=2)
                .map(|round| demo_round(index, round, team_mode, true))
                .collect();
            let at = today - age as i64 * DAY_SECS + today_offset - 3600;
            self.record_at(&Job::Local(facts, rounds), at).await?;
            local_index += 1;
            games += 1;
        }

        Ok(games)
    }

    async fn clear_demo_rows(&self) -> turso::Result<()> {
        let conn = &self.store.conn;
        conn.execute("BEGIN", ()).await?;
        for table in DEMO_TABLES {
            if let Err(err) = conn.execute(format!("DELETE FROM {table}"), ()).await {
                let _ = conn.execute("ROLLBACK", ()).await;
                return Err(err);
            }
        }
        if let Err(err) = conn.execute("COMMIT", ()).await {
            let _ = conn.execute("ROLLBACK", ()).await;
            return Err(err);
        }
        Ok(())
    }
}

fn demo_facts(
    id: u64,
    index: usize,
    game_mode: &'static str,
    team_mode: bool,
    local: bool,
    rounds: i64,
) -> RoundFacts {
    let mut rules = DEFAULT_RULES.clone();
    rules.rounds = rounds;
    rules.betting = !local;
    rules.power_ups = true;

    let solo = index % 4 == 0;
    let second = if solo {
        SeatFacts {
            occupant: Occupant::Cpu(CPU_LEVELS[(index / 2) % CPU_LEVELS.len()]),
            team: team_mode.then_some(1),
        }
    } else {
        demo_person(index + 1, team_mode.then_some(1))
    };
    let seats = vec![
        demo_person(index, team_mode.then_some(0)),
        second,
        SeatFacts {
            occupant: Occupant::Cpu(CPU_LEVELS[index % CPU_LEVELS.len()]),
            team: team_mode.then_some(0),
        },
    ];

    RoundFacts {
        room_id: format!("{id:032x}"),
        match_id: format!("{id:016x}"),
        seed: id as u32,
        game_mode,
        mode: if team_mode { "team" } else { "ffa" },
        rules: rules_to_value(&rules),
        spectators: index % 6,
        seats,
        local,
    }
}

fn demo_person(index: usize, team: Option<u8>) -> SeatFacts {
    // TEST-NET-1 is reserved for documentation and cannot identify a real player.
    let address = [192, 0, 2, (index % 200 + 1) as u8];
    SeatFacts {
        occupant: Occupant::Person {
            ip: IpAddr::from(address),
            name: format!("Demo pilot {}", index % 8 + 1),
        },
        team,
    }
}

fn demo_turn(index: usize, round: i64, turn: i64) -> TurnReport {
    let shots = (0..3)
        .map(|seat| {
            let sample = (index + round as usize + turn as usize + seat) % 5;
            let (resolution, hit_kind, hits, hit_seat, points) = match sample {
                0 => ("ship", Some("enemy"), 1, Some((seat + 1) % 3), 240),
                1 => ("planet", None, 0, None, 0),
                2 => ("ship", Some("self"), 1, Some(seat), -50),
                3 => ("lost", None, 0, None, 0),
                _ => ("clash", None, 0, None, 0),
            };
            let power_up = POWER_UPS[(index + seat + turn as usize) % POWER_UPS.len()];
            ShotRound {
                n: (turn - 1) * 3 + seat as i64 + 1,
                turn,
                seat,
                angle: -145.0 + ((index * 13 + seat * 47) % 290) as f64,
                power: 15.0 + ((index + seat * 5 + turn as usize * 3) % 18) as f64 * 5.0,
                power_up,
                fork: false,
                rider: match power_up {
                    Some("preview") => Some("preview"),
                    Some("piercing") => Some("piercing"),
                    Some("plasma") => Some("plasma"),
                    _ => None,
                },
                fan: (power_up == Some("splitter")).then_some(seat as i64 + 1),
                split_at: (power_up == Some("splitter")).then_some(90),
                resolution: Some(resolution),
                hits,
                hit_seat,
                hit_kind,
                points,
            }
        })
        .collect();

    let placements = ["blackhole", "wormhole", "nebula", "planetkiller"]
        .into_iter()
        .enumerate()
        .map(|(n, kind)| PlacementReport {
            seat: (index + n) % 3,
            kind,
            x: Some(160.0 + (index * 17 + n * 37) as f64),
            y: Some(100.0 + (index * 11 + n * 29) as f64),
            x2: (kind == "wormhole").then_some(500.0),
            y2: (kind == "wormhole").then_some(260.0),
            planet: (kind == "planetkiller").then_some((index % 5) as i64),
        })
        .collect();

    TurnReport {
        round,
        turn,
        seats: (0..3)
            .map(|seat| SeatTurn {
                score: (round - 1) * 1_000 + turn * 200 + seat as i64 * 90,
                alive: true,
            })
            .collect(),
        shots,
        placements: Some(placements),
    }
}

fn demo_round(index: usize, round: i64, team_mode: bool, local: bool) -> RoundReport {
    let winning_seat = (index + round as usize) % 3;
    let winning_team = ((index + round as usize) % 2) as u8;
    let seats = (0..3)
        .map(|seat| {
            let won = if team_mode {
                (seat == 0 || seat == 2) == (winning_team == 0)
            } else {
                seat == winning_seat
            };
            SeatRound {
                score: round * 1_000 + seat as i64 * 220 + (index % 17) as i64 * 11,
                shots: 4,
                kills: if won {
                    1 + ((index + seat) % 3) as i64
                } else {
                    0
                },
                swingbys: ((index + seat) % 4) as i64,
                grazes: ((index + round as usize) % 3) as i64,
                own_goals: if (index + seat + round as usize) % 13 == 0 {
                    1
                } else {
                    0
                },
                pickups: ((index + seat) % 3) as i64,
                saves: if (index + seat + round as usize) % 11 == 0 {
                    1
                } else {
                    0
                },
                alive: won,
            }
        })
        .collect();

    let mut records: [Option<RecordRound>; RECORD_KEYS.len()] = [None; RECORD_KEYS.len()];
    records[0] = Some(RecordRound {
        seat: winning_seat,
        value: 4_000.0 + (index % 80) as f64 * 31.0,
    });
    records[1] = Some(RecordRound {
        seat: winning_seat,
        value: 6.0 + (index % 40) as f64 * 0.7,
    });
    records[2] = Some(RecordRound {
        seat: winning_seat,
        value: 180.0 + (index % 50) as f64 * 23.0,
    });
    records[3] = Some(RecordRound {
        seat: winning_seat,
        value: 0.3 + (index % 90) as f64 * 0.8,
    });
    records[4] = Some(RecordRound {
        seat: winning_seat,
        value: 7_000.0 + (index % 60) as f64 * 97.0,
    });

    let tips = if local {
        Vec::new()
    } else {
        vec![
            TipRound {
                kind: "round",
                right: index % 3 != 0,
                stake: 100 + (index % 8) as i64 * 50,
                payout: if index % 3 != 0 {
                    180 + (index % 8) as i64 * 90
                } else {
                    0
                },
                underdog: index % 4 == 0,
                stands: index % 5 == 0,
            },
            TipRound {
                kind: "shot",
                right: index % 2 == 0,
                stake: 0,
                payout: 0,
                underdog: index % 3 == 0,
                stands: index % 4 == 0,
            },
        ]
    };

    RoundReport {
        round,
        title: if team_mode {
            "teamWin"
        } else {
            TITLES[(index + round as usize) % TITLES.len()]
        },
        survivor: (!team_mode).then_some(winning_seat),
        team: team_mode.then_some(winning_team),
        seconds: 22.0 + ((index * 7 + round as usize * 19) % 230) as f64,
        planets: (index % 7 + 1) as i64,
        seats,
        turns: Some(2),
        tips,
        records,
    }
}
