//! A round's numbers as the host's client reports them (`round_stats`), checked before anything
//! looks at them. Nothing here is a name: a seat is its index, and the relay already knows who sits
//! where.

use std::ops::RangeInclusive;

use serde_json::Value;

use crate::protocol::{is_record, is_safe_integer, POWER_UP_KINDS};

/// A room never seats more than this many ships.
pub const MAX_SEATS: usize = 6;
/// The titles a round can end under, as the client names them.
const TITLES: [&str; 8] = [
    "hit",
    "selfHit",
    "swallowed",
    "lastInOrbit",
    "noneLeft",
    "teamWin",
    "cleared",
    "outOfShots",
];
/// The records a round keeps, in the order the columns hold them.
pub const RECORD_KEYS: [&str; 5] = [
    "longestShot",
    "fastestKill",
    "bestHit",
    "closeCall",
    "sniper",
];

/// The ways a shot ends, as the client names them.
const RESOLUTIONS: [&str; 7] = [
    "ship", "planet", "hole", "shotdown", "clash", "lost", "timeout",
];
const HIT_KINDS: [&str; 3] = ["enemy", "self", "friendly"];
/// Shots in one round beyond which a report is not believed (six ships, a long round, splitters).
const MAX_SHOTS: usize = 500;
/// Far more than a round can hold; a number beyond it is not a count.
const MAX_COUNT: i64 = 10_000;
/// Scores reach about this far in the longest match; the daily board bounds its own the same way.
const MAX_SCORE: i64 = 10_000_000;
/// A round that has run this long (an hour) is not one.
const MAX_SECONDS: f64 = 3600.0;
const MAX_PLANETS: i64 = 64;
const MAX_ROUND: i64 = 1000;
/// Turns in one round; a long endless round is still far from it.
const MAX_TURN: i64 = 1000;
/// The widest a field is (units): a shot cannot fly, or a hit be scored, beyond it.
const MAX_RECORD: f64 = 10_000_000.0;

/// One ship's round.
#[derive(Clone, Debug, PartialEq)]
pub struct SeatRound {
    pub score: i64,
    pub shots: i64,
    pub kills: i64,
    pub swingbys: i64,
    pub grazes: i64,
    pub own_goals: i64,
    pub pickups: i64,
    pub saves: i64,
    pub alive: bool,
}

/// One shot: how it was aimed, what rode with it, how it ended and what it earned.
#[derive(Clone, Debug, PartialEq)]
pub struct ShotRound {
    pub n: i64,
    pub turn: i64,
    pub seat: usize,
    pub angle: f64,
    pub power: f64,
    pub power_up: Option<&'static str>,
    pub fork: bool,
    /// None for a shot still in the air when the round ended.
    pub resolution: Option<&'static str>,
    pub hits: i64,
    pub hit_seat: Option<usize>,
    pub hit_kind: Option<&'static str>,
    pub points: i64,
}

/// A record and the seat that set it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RecordRound {
    pub seat: usize,
    pub value: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct RoundReport {
    pub round: i64,
    pub title: &'static str,
    pub survivor: Option<usize>,
    pub team: Option<u8>,
    pub seconds: f64,
    pub planets: i64,
    pub seats: Vec<SeatRound>,
    /// Indexed like `RECORD_KEYS`.
    pub records: [Option<RecordRound>; RECORD_KEYS.len()],
}

fn int(value: Option<&Value>, range: RangeInclusive<i64>) -> Option<i64> {
    let value = value.filter(|v| is_safe_integer(v))?;
    let n = value
        .as_i64()
        .or_else(|| value.as_f64().map(|f| f as i64))?;
    range.contains(&n).then_some(n)
}

fn real(value: Option<&Value>, max: f64) -> Option<f64> {
    let f = value?.as_f64()?;
    (f.is_finite() && (0.0..=max).contains(&f)).then_some(f)
}

/// An optional seat: absent or null is nobody, anything else has to be a seat of this round.
fn seat(value: Option<&Value>, seats: usize) -> Option<Option<usize>> {
    match value {
        None | Some(Value::Null) => Some(None),
        some => int(some, 0..=seats as i64 - 1).map(|n| Some(n as usize)),
    }
}

/// A string out of a fixed list, or None for an absent or null field; a string outside the list fails.
fn choice(value: Option<&Value>, list: &[&'static str]) -> Option<Option<&'static str>> {
    match value {
        None | Some(Value::Null) => Some(None),
        Some(text) => list
            .iter()
            .find(|item| text.as_str() == Some(**item))
            .map(|item| Some(*item)),
    }
}

fn parse_shot(value: &Value, seats: usize, turn: i64) -> Option<ShotRound> {
    if !is_record(value) {
        return None;
    }
    let angle = value.get("angle")?.as_f64().filter(|a| a.abs() <= 1000.0)?;
    Some(ShotRound {
        n: int(value.get("n"), 1..=MAX_SHOTS as i64)?,
        // A shot belongs to the turn that reports it.
        turn: int(value.get("turn"), turn..=turn)?,
        seat: seat(value.get("player"), seats)??,
        angle,
        power: real(value.get("power"), 100.0)?,
        power_up: choice(value.get("powerUp"), &POWER_UP_KINDS)?,
        fork: value.get("fork")?.as_bool()?,
        resolution: choice(value.get("resolution"), &RESOLUTIONS)?,
        hits: int(value.get("hits"), 0..=MAX_SEATS as i64)?,
        hit_seat: seat(value.get("hitSeat"), seats)?,
        hit_kind: choice(value.get("hitKind"), &HIT_KINDS)?,
        points: int(value.get("points"), -MAX_SCORE..=MAX_SCORE)?,
    })
}

fn parse_seat(value: &Value) -> Option<SeatRound> {
    if !is_record(value) {
        return None;
    }
    let count = |key: &str| int(value.get(key), 0..=MAX_COUNT);
    Some(SeatRound {
        score: int(value.get("score"), -MAX_SCORE..=MAX_SCORE)?,
        shots: count("shots")?,
        kills: count("kills")?,
        swingbys: count("swingbys")?,
        grazes: count("grazes")?,
        own_goals: count("ownGoals")?,
        pickups: count("pickups")?,
        saves: count("saves")?,
        alive: value.get("alive")?.as_bool()?,
    })
}

/// A `round_stats`, or None when anything in it will not do.
pub fn parse_round_report(value: &Value) -> Option<RoundReport> {
    if !is_record(value) {
        return None;
    }
    let seats: Vec<SeatRound> = value
        .get("players")?
        .as_array()
        .filter(|list| (2..=MAX_SEATS).contains(&list.len()))?
        .iter()
        .map(parse_seat)
        .collect::<Option<_>>()?;
    let title = TITLES
        .iter()
        .find(|t| value.get("title").and_then(Value::as_str) == Some(**t))?;
    let team = match value.get("team") {
        None | Some(Value::Null) => None,
        some => Some(int(some, 0..=1)? as u8),
    };
    let mut records = [None; RECORD_KEYS.len()];
    let sent = value.get("records").filter(|r| is_record(r))?;
    for (slot, key) in records.iter_mut().zip(RECORD_KEYS) {
        let Some(entry) = sent.get(key) else {
            continue;
        };
        *slot = Some(RecordRound {
            seat: seat(entry.get("player"), seats.len())??,
            value: real(entry.get("value"), MAX_RECORD)?,
        });
    }
    Some(RoundReport {
        round: int(value.get("round"), 1..=MAX_ROUND)?,
        title,
        survivor: seat(value.get("survivor"), seats.len())?,
        team,
        seconds: real(value.get("seconds"), MAX_SECONDS)?,
        planets: int(value.get("planets"), 0..=MAX_PLANETS)?,
        seats,
        records,
    })
}

/// A ship after a turn.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SeatTurn {
    pub score: i64,
    pub alive: bool,
}

/// The shots of one turn (a volley) and where the scores stand after them.
#[derive(Clone, Debug, PartialEq)]
pub struct TurnReport {
    pub round: i64,
    pub turn: i64,
    pub seats: Vec<SeatTurn>,
    pub shots: Vec<ShotRound>,
}

/// A `turn_stats`, or None when anything in it will not do.
pub fn parse_turn_report(value: &Value) -> Option<TurnReport> {
    if !is_record(value) {
        return None;
    }
    let seats: Vec<SeatTurn> = value
        .get("players")?
        .as_array()
        .filter(|list| (2..=MAX_SEATS).contains(&list.len()))?
        .iter()
        .map(|seat| {
            Some(SeatTurn {
                score: int(seat.get("score"), -MAX_SCORE..=MAX_SCORE)?,
                alive: seat.get("alive")?.as_bool()?,
            })
        })
        .collect::<Option<_>>()?;
    let turn = int(value.get("turn"), 1..=MAX_TURN)?;
    let shots = value
        .get("shots")?
        .as_array()
        .filter(|list| list.len() <= MAX_SHOTS)?
        .iter()
        .map(|shot| parse_shot(shot, seats.len(), turn))
        .collect::<Option<_>>()?;
    Some(TurnReport {
        round: int(value.get("round"), 1..=MAX_ROUND)?,
        turn,
        seats,
        shots,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    pub fn sample() -> Value {
        json!({
            "type": "round_stats",
            "round": 2,
            "title": "hit",
            "survivor": 1,
            "team": null,
            "seconds": 41.3,
            "planets": 3,
            "players": [
                {"score": 120, "shots": 3, "kills": 0, "swingbys": 1, "grazes": 0, "ownGoals": 0, "pickups": 0, "saves": 0, "alive": false},
                {"score": 800, "shots": 2, "kills": 1, "swingbys": 0, "grazes": 2, "ownGoals": 0, "pickups": 1, "saves": 0, "alive": true},
            ],
            "records": {"bestHit": {"player": 1, "value": 250.5}},
        })
    }

    #[test]
    fn a_well_formed_report_is_read_seat_by_seat() {
        let report = parse_round_report(&sample()).expect("a report");
        assert_eq!(report.round, 2);
        assert_eq!(report.title, "hit");
        assert_eq!(report.survivor, Some(1));
        assert_eq!(report.team, None);
        assert_eq!(report.seats.len(), 2);
        assert_eq!(report.seats[1].grazes, 2);
        assert_eq!(
            report.records[2],
            Some(RecordRound {
                seat: 1,
                value: 250.5
            })
        );
        assert!(report.records[0].is_none());
    }

    #[test]
    fn nonsense_is_refused() {
        let broken = |edit: &dyn Fn(&mut Value)| {
            let mut report = sample();
            edit(&mut report);
            assert!(parse_round_report(&report).is_none(), "{report}");
        };
        broken(&|r| r["round"] = json!(0));
        broken(&|r| r["title"] = json!("exploded"));
        broken(&|r| r["survivor"] = json!(2));
        broken(&|r| r["team"] = json!(2));
        broken(&|r| r["seconds"] = json!(-1));
        broken(&|r| r["seconds"] = json!(1e9));
        broken(&|r| r["players"][0]["kills"] = json!(-1));
        broken(&|r| r["players"][0]["kills"] = json!(1.5));
        broken(&|r| r["players"][0]["score"] = json!(1e12));
        broken(&|r| r["players"][0]["alive"] = json!(1));
        broken(&|r| r["players"] = json!([r["players"][0].clone()]));
        broken(&|r| r["players"] = Value::Array(vec![r["players"][0].clone(); 7]));
        broken(&|r| r["records"]["bestHit"]["player"] = json!(5));
        broken(&|r| r["records"]["bestHit"]["value"] = json!(-3));
        broken(&|r| r["records"] = json!(null));
        assert!(parse_round_report(&json!([])).is_none());
    }

    fn turn_sample() -> Value {
        json!({
            "type": "turn_stats",
            "round": 2,
            "turn": 3,
            "players": [{"score": 120, "alive": false}, {"score": 800, "alive": true}],
            "shots": [
                {"n": 1, "turn": 3, "player": 0, "angle": 33.33, "power": 61.3, "powerUp": null, "fork": false, "resolution": "planet", "hits": 0, "hitSeat": null, "hitKind": null, "points": 0},
                {"n": 2, "turn": 3, "player": 1, "angle": 140.0, "power": 80.0, "powerUp": "plasma", "fork": false, "resolution": "ship", "hits": 1, "hitSeat": 0, "hitKind": "enemy", "points": 250},
            ],
        })
    }

    #[test]
    fn a_turn_report_is_read_shot_by_shot() {
        let report = parse_turn_report(&turn_sample()).expect("a report");
        assert_eq!((report.round, report.turn), (2, 3));
        assert_eq!(
            report.seats[1],
            SeatTurn {
                score: 800,
                alive: true
            }
        );
        assert_eq!(report.shots.len(), 2);
        assert_eq!(report.shots[0].resolution, Some("planet"));
        assert_eq!(report.shots[0].turn, 3);
        assert_eq!(report.shots[1].power_up, Some("plasma"));
        assert_eq!(report.shots[1].hit_seat, Some(0));
        assert_eq!(report.shots[1].points, 250);
        // A turn in which nobody fired is still a turn.
        let mut quiet = turn_sample();
        quiet["shots"] = json!([]);
        assert!(parse_turn_report(&quiet).is_some());
    }

    #[test]
    fn nonsense_in_a_turn_is_refused() {
        let broken = |edit: &dyn Fn(&mut Value)| {
            let mut report = turn_sample();
            edit(&mut report);
            assert!(parse_turn_report(&report).is_none(), "{report}");
        };
        broken(&|r| r["turn"] = json!(0));
        broken(&|r| r["players"][0]["alive"] = json!("yes"));
        broken(&|r| r["players"] = json!([]));
        broken(&|r| r["shots"] = json!(null));
        // A shot of some other turn does not belong in this one.
        broken(&|r| r["shots"][0]["turn"] = json!(2));
        broken(&|r| r["shots"][0]["resolution"] = json!("teleported"));
        broken(&|r| r["shots"][0]["powerUp"] = json!("laser"));
        broken(&|r| r["shots"][0]["power"] = json!(101));
        broken(&|r| r["shots"][0]["player"] = json!(2));
        broken(&|r| r["shots"][1]["hitSeat"] = json!(9));
        broken(&|r| r["shots"][1]["hitKind"] = json!("ally"));
        broken(&|r| r["shots"] = Value::Array(vec![r["shots"][0].clone(); 501]));
    }
}
