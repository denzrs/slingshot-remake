//! A round's numbers as the host's client reports them (`round_stats`), checked before anything
//! looks at them. Nothing here is a name: a seat is its index, and the relay already knows who sits
//! where.

use std::ops::RangeInclusive;

use serde_json::Value;

use crate::protocol::{is_record, is_safe_integer, parse_rules, RoomRules, POWER_UP_KINDS};
use crate::wire::{CpuLevel, GameMode, RoomMode, Wire};

/// A room never seats more than this many ships.
pub const MAX_SEATS: usize = 6;
/// The titles a round can end under, as the client names them.
const TITLES: [&str; 9] = [
    "hit",
    "selfHit",
    "swallowed",
    "lastInOrbit",
    "noneLeft",
    "teamWin",
    "cleared",
    "outOfShots",
    "skipped",
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
/// The power-ups that ride on one shot.
const RIDERS: [&str; 3] = ["preview", "piercing", "plasma"];
/// The power-ups that are laid on the field, as a placement names them.
const PLACEMENT_KINDS: [&str; 7] = [
    "teleport",
    "blackhole",
    "planetkiller",
    "nebula",
    "wormhole",
    "defense",
    "antigravity",
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
/// Physics steps in one flight; the longest takes far fewer.
const MAX_STEP: i64 = 1_000_000;
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

/// One judged tip of the oracle game: a hit/miss or salvo tip, or a bet on who wins the round.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TipRound {
    /// `shot` (a question about a shot or a salvo) or `round` (who wins the round).
    pub kind: &'static str,
    pub right: bool,
    /// The points staked on a round tip and what came back, the stake included; 0 for a plain tip.
    pub stake: i64,
    pub payout: i64,
    pub underdog: bool,
    /// Placed from the stands rather than by a shot-down player.
    pub stands: bool,
}

/// Tips in one round: a few spectators on a handful of questions.
const MAX_TIPS: usize = 2000;
const TIP_KINDS: [&str; 2] = ["shot", "round"];

fn parse_tip(value: &Value) -> Option<TipRound> {
    if !is_record(value) {
        return None;
    }
    Some(TipRound {
        kind: choice(value.get("kind"), &TIP_KINDS)??,
        right: value.get("right")?.as_bool()?,
        stake: int(value.get("stake"), 0..=MAX_SCORE)?,
        payout: int(value.get("payout"), 0..=MAX_SCORE * 10)?,
        underdog: value.get("underdog")?.as_bool()?,
        stands: value.get("stands")?.as_bool()?,
    })
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
    /// What was armed when the shot was fired (a preview, armor piercing or plasma), unlike `power_up` it
    /// stays that when the shot is split on the way; None for a fork.
    pub rider: Option<&'static str>,
    /// The splitter fan the shot belongs to (the shot that was split and its forks share it); None
    /// for a shot that was never split. Unique within a turn.
    pub fan: Option<i64>,
    /// The physics step of the flight at which the splitter went off, the same for the whole fan.
    pub split_at: Option<i64>,
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
    /// How many turns the round took, as the host counted them: what the turn reports are checked against, so a
    /// turn lost at the end of a round is noticed. None from a client that does not say.
    pub turns: Option<i64>,
    /// The tips and bets judged in the round; empty from a client that does not say, or when nobody tipped.
    pub tips: Vec<TipRound>,
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

/// An optional integer: absent or null is nothing, anything else has to be in range.
fn optional_int(value: Option<&Value>, range: RangeInclusive<i64>) -> Option<Option<i64>> {
    match value {
        None | Some(Value::Null) => Some(None),
        some => int(some, range).map(Some),
    }
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
        rider: choice(value.get("rider"), &RIDERS)?,
        fan: optional_int(value.get("fan"), 0..=MAX_COUNT)?,
        split_at: optional_int(value.get("splitAt"), 0..=MAX_STEP)?,
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
    let tips: Vec<TipRound> = match value.get("tips") {
        None | Some(Value::Null) => Vec::new(),
        Some(list) => list
            .as_array()
            .filter(|list| list.len() <= MAX_TIPS)?
            .iter()
            .map(parse_tip)
            .collect::<Option<_>>()?,
    };
    Some(RoundReport {
        round: int(value.get("round"), 1..=MAX_ROUND)?,
        title,
        survivor: seat(value.get("survivor"), seats.len())?,
        team,
        seconds: real(value.get("seconds"), MAX_SECONDS)?,
        planets: int(value.get("planets"), 0..=MAX_PLANETS)?,
        seats,
        turns: optional_int(value.get("turns"), 0..=MAX_TURN)?,
        tips,
        records,
    })
}

/// A ship after a turn.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SeatTurn {
    pub score: i64,
    pub alive: bool,
}

/// A power-up laid on the field before a turn's shots (see `game/replay.ts` on the client).
#[derive(Clone, Debug, PartialEq)]
pub struct PlacementReport {
    pub seat: usize,
    pub kind: &'static str,
    pub x: Option<f64>,
    pub y: Option<f64>,
    /// A wormhole's second mouth.
    pub x2: Option<f64>,
    pub y2: Option<f64>,
    /// The planet it went to, as its place in the world's list; -1 for a planet killer that found its planet gone.
    pub planet: Option<i64>,
}

/// Placements in one turn: every ship may lay one, and a salvo's rescue teleports add a few.
const MAX_PLACEMENTS: usize = 64;

fn parse_placement(value: &Value, seats: usize) -> Option<PlacementReport> {
    if !is_record(value) {
        return None;
    }
    let coordinate = |key: &str| match value.get(key) {
        None | Some(Value::Null) => Some(None),
        some => real(some, MAX_RECORD).map(Some),
    };
    Some(PlacementReport {
        seat: seat(value.get("player"), seats)??,
        kind: choice(value.get("kind"), &PLACEMENT_KINDS)??,
        x: coordinate("x")?,
        y: coordinate("y")?,
        x2: coordinate("x2")?,
        y2: coordinate("y2")?,
        planet: optional_int(value.get("planet"), -1..=MAX_PLANETS)?,
    })
}

/// The shots of one turn (a volley) and where the scores stand after them.
#[derive(Clone, Debug, PartialEq)]
pub struct TurnReport {
    pub round: i64,
    pub turn: i64,
    pub seats: Vec<SeatTurn>,
    pub shots: Vec<ShotRound>,
    /// The power-ups laid on the field before the shots; None from a client that does not say, whose
    /// game cannot be flown again.
    pub placements: Option<Vec<PlacementReport>>,
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
    let placements = match value.get("placements") {
        None | Some(Value::Null) => None,
        Some(list) => Some(
            list.as_array()
                .filter(|list| list.len() <= MAX_PLACEMENTS)?
                .iter()
                .map(|placement| parse_placement(placement, seats.len()))
                .collect::<Option<Vec<_>>>()?,
        ),
    };
    Some(TurnReport {
        round: int(value.get("round"), 1..=MAX_ROUND)?,
        turn,
        seats,
        shots,
        placements,
    })
}

/// A game played on one device, reported when it is over: no turns and no shots, so nothing to fly again.
#[derive(Clone, Debug)]
pub struct LocalGame {
    pub game_mode: GameMode,
    pub mode: RoomMode,
    pub rules: RoomRules,
    /// Who sat where: a CPU's level, or None for a person; the team in team games.
    pub seats: Vec<(Option<CpuLevel>, Option<u8>)>,
    pub rounds: Vec<RoundReport>,
}

/// Rounds of one local game beyond which a report is not believed.
const MAX_LOCAL_ROUNDS: usize = 99;

/// A `local_game`, or None when anything in it will not do.
pub fn parse_local_game(value: &Value) -> Option<LocalGame> {
    if !is_record(value) {
        return None;
    }
    let game_mode = value
        .get("gameMode")
        .and_then(Value::as_str)
        .and_then(GameMode::parse)?;
    let mode = value
        .get("mode")
        .and_then(Value::as_str)
        .and_then(RoomMode::parse)?;
    let rules = parse_rules(value.get("rules")?)?;
    let seats = value
        .get("seats")?
        .as_array()
        .filter(|list| (2..=MAX_SEATS).contains(&list.len()))?
        .iter()
        .map(|seat| {
            if !is_record(seat) {
                return None;
            }
            let cpu = match seat.get("cpu") {
                None | Some(Value::Null) => None,
                some => Some(some.and_then(Value::as_str).and_then(CpuLevel::parse)?),
            };
            let team = match seat.get("team") {
                None | Some(Value::Null) => None,
                some => Some(int(some, 0..=1)? as u8),
            };
            Some((cpu, team))
        })
        .collect::<Option<Vec<_>>>()?;
    let rounds = value
        .get("rounds")?
        .as_array()
        .filter(|list| (1..=MAX_LOCAL_ROUNDS).contains(&list.len()))?
        .iter()
        .map(parse_round_report)
        .collect::<Option<Vec<_>>>()?;
    // The rounds count up from 1, and every one has a ship for every seat.
    let in_order = rounds
        .iter()
        .enumerate()
        .all(|(i, round)| round.round == i as i64 + 1 && round.seats.len() == seats.len());
    in_order.then_some(LocalGame {
        game_mode,
        mode,
        rules,
        seats,
        rounds,
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
    fn a_local_game_has_rounds_in_order_for_every_seat_and_rules_that_will_do() {
        let rules = json!({
            "rounds":2,"maxPlanets":4,"invisiblePlanets":false,"bounce":true,
            "fixedPower":false,"fixedPowerLevel":55,"maxPower":100,"shotTime":20,
            "styleBonuses":false,"neighborGrace":0,"simultaneousShots":false,
            "hiddenAim":false,"fadingTrails":0,"mayhem":0,"betting":false,
            "chatPlayersOnly":false,"powerUps":false,"powerUpKinds":["teleport"],"powerUpAmount":2
        });
        let mut round_two = sample();
        round_two["round"] = json!(2);
        let game = |rounds: Vec<Value>| {
            json!({
                "gameMode": "classic", "mode": "ffa", "rules": rules,
                "seats": [{"cpu": null, "team": null}, {"cpu": "hard", "team": null}],
                "rounds": rounds,
            })
        };
        let mut first = sample();
        first["round"] = json!(1);
        let parsed =
            parse_local_game(&game(vec![first.clone(), round_two.clone()])).expect("a whole game");
        assert_eq!(parsed.rounds.len(), 2);
        assert_eq!(parsed.seats[1].0.map(|level| level.as_str()), Some("hard"));
        // Out of order, a seat short, nothing played, or rules that will not do.
        assert!(parse_local_game(&game(vec![round_two.clone(), first.clone()])).is_none());
        assert!(parse_local_game(&game(vec![])).is_none());
        let mut short = first.clone();
        short["players"] = json!([short["players"][0].clone()]);
        assert!(parse_local_game(&game(vec![short])).is_none());
        let mut bad = game(vec![first]);
        bad["rules"]["rounds"] = json!(1000);
        assert!(parse_local_game(&bad).is_none());
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
