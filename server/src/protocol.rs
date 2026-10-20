//! Validation helpers for untrusted wire input, checked before the room logic sees it.

use rustrict::CensorStr;
use serde_json::Value;

use crate::wire::{Avatar, CpuLevel, RoomColor, RoomSymbol, Visibility, Wire};

/// Tips name a ship; there are at most six.
pub const MAX_TIP: i64 = 6;
/// A teleport offers a few spots to choose from; a pick names one by its place in the list.
const MAX_SPOT: usize = 8;
/// The power-ups a room can lay, in the order the client lists them. A room's kinds are kept as a bitmask over this list.
pub const POWER_UP_KINDS: [&str; 11] = [
    "preview",
    "teleport",
    "splitter",
    "repulse",
    "shield",
    "blackhole",
    "planetkiller",
    "nebula",
    "piercing",
    "wormhole",
    "defense",
];
/// Every kind switched on: one bit per kind, so the mask fills from the top down and never shifts past the type.
pub const ALL_POWER_UP_KINDS: u16 = u16::MAX >> (16 - POWER_UP_KINDS.len());
/// How many pickups may lie on the field.
const POWER_UP_AMOUNTS: [i64; 4] = [1, 2, 3, 4];

/// The most points one stake may name on the wire; the host holds a player to what they actually have.
const MAX_STAKE: f64 = 1_000_000.0;

/// The longest a player name may be.
pub const MAX_NAME_LENGTH: usize = 24;

/// `name.trim().slice(0, 24)`; None when the value is not a non-empty trimmed string.
pub fn clean_name_checked(value: Option<&Value>) -> Option<String> {
    let s = value.and_then(Value::as_str)?;
    let cleaned = clean_text(s, MAX_NAME_LENGTH);
    (!cleaned.is_empty()).then_some(cleaned)
}

/// The longest a room name may be: room for a full-length player name plus "'s room".
pub const MAX_ROOM_NAME_LENGTH: usize = 40;

/// What the host typed as the room's name.
#[derive(Debug, PartialEq)]
pub enum RoomName {
    /// Nothing usable was typed; the room is called after its host.
    Default,
    Named(String),
    /// The words will not do on a public list.
    Refused,
}

/// A room name from a `create_room`, cleaned like a player name (longer allowed) and held to the
/// same profanity check. A blank or missing one is not an error: the room gets the default.
pub fn parse_room_name(value: Option<&Value>) -> RoomName {
    match value {
        None | Some(Value::Null) => RoomName::Default,
        Some(Value::String(s)) => {
            let cleaned = clean_text(s, MAX_ROOM_NAME_LENGTH);
            if cleaned.is_empty() {
                RoomName::Default
            } else if is_acceptable_name(&cleaned) {
                RoomName::Named(cleaned)
            } else {
                RoomName::Refused
            }
        }
        Some(_) => RoomName::Refused,
    }
}

/// "Ada's room"; a host name the check refuses gives "Room N" instead, so a default cannot slip a
/// bad word onto the list either.
pub fn default_room_name(host: &str, number: u64) -> String {
    let name = format!("{host}'s room");
    if is_acceptable_name(&name) {
        name
    } else {
        format!("Room {number}")
    }
}

/// Control characters (C0/C1, DEL, zero-width/bidi chars) are stripped so a name cannot smuggle
/// terminal escapes or invisible directionality into other clients' UIs; then the text is trimmed
/// and cut to `MAX_NAME_LENGTH` UTF-16 units. May come out empty.
fn clean_text(s: &str, max: usize) -> String {
    let stripped: String = s
        .chars()
        .filter(|c| {
            let u = *c as u32;
            !matches!(u, 0x00..=0x1F | 0x7F..=0x9F)
                && !matches!(u, 0x200B | 0x200E..=0x200F | 0x202A..=0x202E | 0x2060..=0x2064 | 0xFEFF)
        })
        .collect();
    let stripped = stripped.trim();
    let mut units = 0;
    let mut end = stripped.len();
    for (index, character) in stripped.char_indices() {
        let width = character.len_utf16();
        if units + width > max {
            end = index;
            break;
        }
        units += width;
    }
    stripped[..end].to_string()
}

/// A CPU seat's level from a client. There is no default: anything but a level is None.
pub fn parse_cpu_level(value: Option<&Value>) -> Option<CpuLevel> {
    value.and_then(Value::as_str).and_then(CpuLevel::parse)
}

/// How a room presents itself: whether it is listed, and its symbol and colour.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RoomLook {
    pub visibility: Visibility,
    pub symbol: RoomSymbol,
    pub color: RoomColor,
}

impl RoomLook {
    pub fn is_private(&self) -> bool {
        self.visibility == Visibility::Private
    }
}

/// A room's look from a client, read from an object that holds the keys (a `create_room` message,
/// or the `look` of a `set_room`). A missing key takes its default; a value that is not one of the
/// choices makes the whole look invalid.
pub fn parse_room_look(value: &Value) -> Option<RoomLook> {
    if !is_record(value) {
        return None;
    }
    Some(RoomLook {
        visibility: choice_of(value.get("visibility"))?,
        symbol: choice_of(value.get("symbol"))?,
        color: choice_of(value.get("color"))?,
    })
}

/// A player's symbol from a client; a missing one is the default, anything that is not a choice is None.
pub fn parse_avatar(value: Option<&Value>) -> Option<Avatar> {
    choice_of(value)
}

/// One of the choices; a missing (or null) value is the default.
fn choice_of<T: Wire + Default>(value: Option<&Value>) -> Option<T> {
    match value.filter(|v| !v.is_null()) {
        None => Some(T::default()),
        Some(v) => v.as_str().and_then(T::parse),
    }
}

/// Largest double-precision integer (`Number.isSafeInteger`).
const MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;

pub fn is_record(value: &Value) -> bool {
    value.is_object()
}

/// `Number.isFinite`, for JSON numbers (whole-number literals included).
fn is_finite_number(value: Option<&Value>) -> bool {
    value.and_then(Value::as_f64).is_some_and(|f| f.is_finite())
}

/// `Number.isSafeInteger`: an integer a double can hold exactly.
pub fn is_safe_integer(value: &Value) -> bool {
    let Some(n) = value.as_number() else {
        return false;
    };
    if let Some(i) = n.as_i64() {
        return (-MAX_SAFE_INTEGER..=MAX_SAFE_INTEGER).contains(&i);
    }
    if let Some(u) = n.as_u64() {
        return u <= MAX_SAFE_INTEGER as u64;
    }
    if let Some(f) = n.as_f64() {
        return f.fract() == 0.0 && f.abs() <= MAX_SAFE_INTEGER as f64;
    }
    false
}

fn is_bool_field(value: &Value, key: &str) -> bool {
    value.get(key).and_then(Value::as_bool).is_some()
}

/// `Number.isInteger(v) && v >= min && v <= max`.
fn is_int_between(value: &Value, min: i64, max: i64) -> bool {
    let Some(f) = value.as_f64() else {
        return false;
    };
    f.fract() == 0.0 && f >= min as f64 && f <= max as f64
}

/// `[..].includes(v)` with `===` equality, for small integer sets.
fn is_number_in(value: &Value, allowed: &[i64]) -> bool {
    let Some(f) = value.as_f64() else {
        return false;
    };
    allowed.iter().any(|&a| f == a as f64)
}

/// A client's aim/fire request, as the host will apply it.
pub fn is_input_message(value: &Value) -> bool {
    if !is_record(value) {
        return false;
    }
    match value.get("kind").and_then(Value::as_str) {
        Some("adjust") => {
            is_finite_number(value.get("dAngle")) && is_finite_number(value.get("dPower"))
        }
        Some("aim") => is_finite_number(value.get("angle")) && is_finite_number(value.get("power")),
        Some("fire") | Some("skip") | Some("power") | Some("cancel") => true,
        // A teleport spot picked by number: there are only a few.
        Some("spot") => value
            .get("index")
            .is_some_and(|index| is_int_between(index, 0, MAX_SPOT as i64 - 1)),
        Some("bet") => match value.get("pick") {
            Some(pick) => {
                is_safe_integer(pick)
                    && pick
                        .as_f64()
                        .is_some_and(|f| f >= -1.0 && f < MAX_TIP as f64)
                    // `round` says the tip is about the winner of the round, `stake` bets points on it.
                    && matches!(value.get("round"), None | Some(Value::Bool(_)))
                    && value.get("stake").is_none_or(is_stake)
            }
            None => false,
        },
        _ => false,
    }
}

/// A stake on the round question: a whole number of points, not absurdly many (whether the player has them is the host's call).
fn is_stake(value: &Value) -> bool {
    is_safe_integer(value)
        && value
            .as_f64()
            .is_some_and(|f| (0.0..=MAX_STAKE).contains(&f))
}

/// The highest daily-challenge total the relay takes. Not a proof of anything — a run that scores
/// more than this is not a run — the board has no way to fly the challenge again (`leaderboard`).
pub const MAX_DAILY_SCORE: i64 = 10_000_000;
/// The four-digit years a submitted day may carry. The client only ever sends the days the daily
/// challenge has been played on, and `?daily=…` goes back no further than the game has existed.
const DAY_YEAR_RANGE: std::ops::RangeInclusive<i32> = 2000..=2999;

/// A `YYYY-MM-DD` calendar day from a client: the shape *and* a date that exists (the same rule as
/// the client's `isDateKey`).
pub fn is_date_key(value: &Value) -> bool {
    let Some(text) = value.as_str() else {
        return false;
    };
    let bytes = text.as_bytes();
    if bytes.len() != 10 || bytes[4] != b'-' || bytes[7] != b'-' {
        return false;
    }
    if !bytes
        .iter()
        .enumerate()
        .all(|(at, byte)| at == 4 || at == 7 || byte.is_ascii_digit())
    {
        return false;
    }
    let year = text[0..4].parse::<i32>().unwrap();
    let month = text[5..7].parse::<u32>().unwrap();
    let day = text[8..10].parse::<u32>().unwrap();
    DAY_YEAR_RANGE.contains(&year)
        && (1..=12).contains(&month)
        && day >= 1
        && day <= days_in_month(year, month)
}

/// The days of a month in the proleptic Gregorian calendar, February included.
fn days_in_month(year: i32, month: u32) -> u32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        _ => {
            let leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
            if leap {
                29
            } else {
                28
            }
        }
    }
}

/// A daily run a client wants on the board: the day it was flown, the name to post it under, and
/// the total. The name is cleaned like any other player name, and the day has to be a real one.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DailyScore {
    pub day: String,
    pub name: String,
    pub score: i64,
}

/// The `day` of a `daily_top`: which day's board is wanted.
pub fn parse_daily_day(value: &Value) -> Option<String> {
    value
        .get("day")
        .filter(|day| is_date_key(day))
        .and_then(Value::as_str)
        .map(str::to_owned)
}

/// A `daily_submit`, or None when the day, the name or the score will not do.
pub fn parse_daily_submit(value: &Value) -> Option<DailyScore> {
    if !is_record(value) {
        return None;
    }
    let day = parse_daily_day(value)?;
    let name = clean_name_checked(value.get("name"))?;
    let score = value
        .get("score")
        .filter(|score| is_safe_integer(score))?
        .as_f64()? as i64;
    (0..=MAX_DAILY_SCORE)
        .contains(&score)
        .then_some(DailyScore { day, name, score })
}

/// Whether a name may stand on a public board. `clean_name_checked` has already dropped the control
/// characters and cut the length; this is about the words themselves.
///
/// It is `rustrict` at its "inappropriate" threshold: an English dictionary with the usual simple
/// evasions folded in (`f4ck`, `sh1t` and `a55hole` are all caught). Two honest limits come with it,
/// and neither is a reason not to have it: the dictionary is English, so German profanity is covered
/// only in part — `Arsch` and `Hurensohn` are, `Fick` is not — and it reads no context, so a few
/// real surnames come out unacceptable (`Hancock`, `Dick`). A name that is refused can simply be
/// typed again.
pub fn is_acceptable_name(name: &str) -> bool {
    !name.is_inappropriate()
}

/// The rules of an online game, chosen by whoever creates (and later edits) the room.
#[derive(Clone, Debug)]
pub struct RoomRules {
    /// 0 = endless.
    pub rounds: i64,
    pub max_planets: i64,
    pub invisible_planets: bool,
    pub bounce: bool,
    /// Every shot flies with `fixed_power_level`.
    pub fixed_power: bool,
    /// The power of a fixed shot, 10 to 100 in steps of 5.
    pub fixed_power_level: i64,
    /// Highest power a shot may be fired with (100 = no cap).
    pub max_power: i64,
    /// Seconds before a shot fizzles out.
    pub shot_time: i64,
    /// Classic only: trick shots multiply a hit's points.
    pub style_bonuses: bool,
    /// Four or more ships: the shooter's first this many shots of a round (0 = off) pass through
    /// its nearest enemy.
    pub neighbor_grace: i64,
    /// Classic only: everybody aims at once and all shots fly together.
    pub simultaneous_shots: bool,
    /// Everybody sees only their own aim, not the opponents'.
    pub hidden_aim: bool,
    /// Seconds a finished shot's flight path stays on the board (0 = for good).
    pub fading_trails: i64,
    /// Online: eliminated players may bet points of the match on who wins the round.
    pub betting: bool,
    /// Experimental power-ups: pickups on the field, one held at a time.
    pub power_ups: bool,
    /// Which kinds may turn up: a bitmask over `POWER_UP_KINDS`, never empty.
    pub power_up_kinds: u16,
    /// How many pickups lie on the field.
    pub power_up_amount: i64,
}

pub const DEFAULT_RULES: RoomRules = RoomRules {
    rounds: 5,
    max_planets: 4,
    invisible_planets: false,
    bounce: false,
    fixed_power: false,
    fixed_power_level: 55,
    max_power: 100,
    shot_time: 20,
    style_bonuses: false,
    neighbor_grace: 0,
    simultaneous_shots: false,
    hidden_aim: false,
    fading_trails: 0,
    betting: false,
    power_ups: false,
    power_up_kinds: ALL_POWER_UP_KINDS,
    power_up_amount: 2,
};

/// The rules as they leave the relay, keyed like the client-side `RoomRules` object.
pub fn rules_to_value(rules: &RoomRules) -> Value {
    serde_json::json!({
        "rounds": rules.rounds,
        "maxPlanets": rules.max_planets,
        "invisiblePlanets": rules.invisible_planets,
        "bounce": rules.bounce,
        "fixedPower": rules.fixed_power,
        "fixedPowerLevel": rules.fixed_power_level,
        "maxPower": rules.max_power,
        "shotTime": rules.shot_time,
        "styleBonuses": rules.style_bonuses,
        "neighborGrace": rules.neighbor_grace,
        "simultaneousShots": rules.simultaneous_shots,
        "hiddenAim": rules.hidden_aim,
        "fadingTrails": rules.fading_trails,
        "betting": rules.betting,
        "powerUps": rules.power_ups,
        "powerUpKinds": POWER_UP_KINDS
            .iter()
            .enumerate()
            .filter(|(bit, _)| rules.power_up_kinds & (1u16 << bit) != 0)
            .map(|(_, kind)| *kind)
            .collect::<Vec<_>>(),
        "powerUpAmount": rules.power_up_amount,
    })
}

/// The kinds of a client's `powerUpKinds`: a non-empty list of distinct known kinds, as a bitmask.
fn parse_power_up_kinds(value: &Value) -> Option<u16> {
    let list = value.as_array()?;
    let mut mask = 0u16;
    for kind in list {
        let bit = POWER_UP_KINDS
            .iter()
            .position(|k| Some(*k) == kind.as_str())?;
        if mask & (1u16 << bit) != 0 {
            return None;
        }
        mask |= 1u16 << bit;
    }
    (mask != 0).then_some(mask)
}

/// Validates untrusted rules from a client; None when anything is off.
pub fn parse_rules(value: &Value) -> Option<RoomRules> {
    if !is_record(value) {
        return None;
    }
    // A present-but-null field behaves like a missing one, mirroring `?? 100` on the JS side.
    let field = |key: &str| value.get(key).filter(|v| !v.is_null());

    let rounds = field("rounds")?;
    let max_planets = field("maxPlanets")?;
    let shot_time = field("shotTime")?;
    if !is_int_between(rounds, 0, 99)
        || !is_int_between(max_planets, 1, 8)
        || !is_int_between(shot_time, 5, 120)
    {
        return None;
    }
    for key in [
        "invisiblePlanets",
        "bounce",
        "fixedPower",
        "styleBonuses",
        "simultaneousShots",
        "hiddenAim",
    ] {
        if !is_bool_field(value, key) {
            return None;
        }
    }
    let neighbor_grace = field("neighborGrace")?;
    if !is_number_in(neighbor_grace, &[0, 1, 2]) {
        return None;
    }
    // Clients from before the cap, or the fixed level, existed don't send them; a missing field
    // (or a null one) falls back to the default, exactly like `?? 100` on the JS side.
    let max_power_ok = match field("maxPower") {
        Some(v) => is_number_in(v, &[10, 20, 30, 40, 50, 60, 70, 80, 90, 100]),
        None => true,
    };
    if !max_power_ok {
        return None;
    }
    let fixed_power_level_ok = match field("fixedPowerLevel") {
        Some(v) => is_int_between(v, 10, 100) && v.as_f64().unwrap() % 5.0 == 0.0,
        None => true,
    };
    if !fixed_power_level_ok {
        return None;
    }
    // Clients from before betting existed don't send it: no betting, the default. A present value has to be a boolean.
    if field("betting").is_some_and(|v| !v.is_boolean()) {
        return None;
    }
    let fading_trails = field("fadingTrails")?;
    if !is_number_in(fading_trails, &[0, 1, 2, 4]) {
        return None;
    }
    // Power-ups came later: a client that doesn't send them plays without. A present value has to be valid.
    if field("powerUps").is_some_and(|v| !v.is_boolean()) {
        return None;
    }
    let power_up_kinds = match field("powerUpKinds") {
        Some(v) => parse_power_up_kinds(v)?,
        None => DEFAULT_RULES.power_up_kinds,
    };
    if field("powerUpAmount").is_some_and(|v| !is_number_in(v, &POWER_UP_AMOUNTS)) {
        return None;
    }

    fn i64_of(value: &Value) -> i64 {
        value.as_f64().unwrap() as i64
    }
    Some(RoomRules {
        rounds: i64_of(rounds),
        max_planets: i64_of(max_planets),
        invisible_planets: value.get("invisiblePlanets").unwrap().as_bool().unwrap(),
        bounce: value.get("bounce").unwrap().as_bool().unwrap(),
        fixed_power: value.get("fixedPower").unwrap().as_bool().unwrap(),
        fixed_power_level: field("fixedPowerLevel")
            .map(i64_of)
            .unwrap_or(DEFAULT_RULES.fixed_power_level),
        max_power: field("maxPower")
            .map(i64_of)
            .unwrap_or(DEFAULT_RULES.max_power),
        shot_time: i64_of(shot_time),
        style_bonuses: value.get("styleBonuses").unwrap().as_bool().unwrap(),
        neighbor_grace: i64_of(neighbor_grace),
        simultaneous_shots: value.get("simultaneousShots").unwrap().as_bool().unwrap(),
        hidden_aim: value.get("hiddenAim").unwrap().as_bool().unwrap(),
        fading_trails: i64_of(fading_trails),
        betting: field("betting")
            .and_then(Value::as_bool)
            .unwrap_or(DEFAULT_RULES.betting),
        power_ups: field("powerUps")
            .and_then(Value::as_bool)
            .unwrap_or(DEFAULT_RULES.power_ups),
        power_up_kinds,
        power_up_amount: field("powerUpAmount")
            .map(i64_of)
            .unwrap_or(DEFAULT_RULES.power_up_amount),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn input_validation_matches_wire_contract() {
        assert!(is_input_message(&json!({"kind":"bet","pick":-1})));
        assert!(is_input_message(&json!({"kind":"bet","pick":0})));
        assert!(is_input_message(&json!({"kind":"bet","pick":5})));
        assert!(is_input_message(
            &json!({"kind":"bet","pick":2,"round":true})
        ));
        assert!(is_input_message(
            &json!({"kind":"bet","pick":2,"round":false})
        ));
        assert!(is_input_message(
            &json!({"kind":"bet","pick":2,"round":true,"stake":200})
        ));
        for invalid in [
            json!({"kind":"bet"}),
            json!({"kind":"bet","pick":-2}),
            json!({"kind":"bet","pick":6}),
            json!({"kind":"bet","pick":1.5}),
            json!({"kind":"bet","pick":"1"}),
            json!({"kind":"bet","pick":2,"round":"yes"}),
            json!({"kind":"bet","pick":2,"round":true,"stake":-10}),
            json!({"kind":"bet","pick":2,"round":true,"stake":2.5}),
            json!({"kind":"bet","pick":2,"round":true,"stake":"100"}),
            json!({"kind":"bet","pick":2,"round":true,"stake":10000000}),
        ] {
            assert!(!is_input_message(&invalid), "rejected input: {invalid}");
        }
        assert!(is_input_message(
            &json!({"kind":"aim","angle":0,"power":55})
        ));
        assert!(!is_input_message(
            &json!({"kind":"aim","angle":"0","power":55})
        ));
    }

    #[test]
    fn clean_names_trim_after_stripping_controls_and_preserve_joiners() {
        assert_eq!(
            clean_name_checked(Some(&json!("\u{200b} Bob\u{200b}"))).as_deref(),
            Some("Bob")
        );
        assert_eq!(
            clean_name_checked(Some(&json!("👩‍🚀"))).as_deref(),
            Some("👩‍🚀")
        );
        assert_eq!(
            clean_name_checked(Some(&json!("می‌خواهم"))).as_deref(),
            Some("می‌خواهم")
        );
        assert_eq!(
            clean_name_checked(Some(&json!("  \u{0007}  Ada  "))).as_deref(),
            Some("Ada")
        );
        assert_eq!(
            clean_name_checked(Some(&json!("😀".repeat(13))))
                .unwrap()
                .encode_utf16()
                .count(),
            24
        );
    }

    fn valid_rules() -> Value {
        json!({
            "rounds":5,"maxPlanets":4,"invisiblePlanets":false,"bounce":true,
            "fixedPower":true,"fixedPowerLevel":70,"maxPower":80,"shotTime":20,
            "styleBonuses":true,"neighborGrace":1,"simultaneousShots":true,
            "hiddenAim":false,"fadingTrails":2,"betting":true,
            "powerUps":true,"powerUpKinds":["teleport","shield"],"powerUpAmount":3
        })
    }

    #[test]
    fn shared_menu_contract_matches_relay_defaults_and_slider_options() {
        let contract: Value =
            serde_json::from_str(include_str!("../protocol-contract.json")).unwrap();
        assert_eq!(rules_to_value(&DEFAULT_RULES), contract["defaults"]);
        for (key, options) in contract["options"].as_object().unwrap() {
            for option in options.as_array().unwrap() {
                let mut rules = valid_rules();
                rules[key] = option.clone();
                assert!(
                    parse_rules(&rules).is_some(),
                    "relay rejected {key}={option}"
                );
            }
        }
    }

    #[test]
    fn rules_accept_complete_values_and_legacy_omissions() {
        let parsed = parse_rules(&valid_rules()).expect("complete rules accepted");
        assert_eq!(parsed.rounds, 5);
        assert_eq!(parsed.fixed_power_level, 70);
        assert_eq!(parsed.max_power, 80);
        assert!(parsed.bounce && parsed.fixed_power && parsed.style_bonuses);
        assert!(parsed.simultaneous_shots);
        assert!(parsed.betting);

        let mut legacy = valid_rules();
        legacy.as_object_mut().unwrap().remove("maxPower");
        legacy.as_object_mut().unwrap().remove("fixedPowerLevel");
        legacy.as_object_mut().unwrap().remove("betting");
        let parsed = parse_rules(&legacy).expect("legacy omissions accepted");
        assert_eq!(parsed.max_power, 100);
        assert_eq!(parsed.fixed_power_level, 55);
        assert!(!parsed.betting);
    }

    #[test]
    fn power_up_rules_default_off_and_take_a_list_of_known_kinds() {
        let parsed = parse_rules(&valid_rules()).expect("complete rules accepted");
        assert!(parsed.power_ups);
        assert_eq!(parsed.power_up_kinds, 0b10010);
        assert_eq!(parsed.power_up_amount, 3);
        assert_eq!(
            rules_to_value(&parsed)["powerUpKinds"],
            json!(["teleport", "shield"])
        );

        let mut legacy = valid_rules();
        for key in ["powerUps", "powerUpKinds", "powerUpAmount"] {
            legacy.as_object_mut().unwrap().remove(key);
        }
        let parsed = parse_rules(&legacy).expect("legacy omissions accepted");
        assert!(!parsed.power_ups);
        assert_eq!(parsed.power_up_kinds, ALL_POWER_UP_KINDS);
        assert_eq!(parsed.power_up_amount, 2);

        for (key, value) in [
            ("powerUps", json!("yes")),
            ("powerUpKinds", json!([])),
            ("powerUpKinds", json!("shield")),
            ("powerUpKinds", json!(["shield", "shield"])),
            ("powerUpKinds", json!(["laser"])),
            ("powerUpAmount", json!(0)),
            ("powerUpAmount", json!(5)),
        ] {
            let mut rules = valid_rules();
            rules[key] = value;
            assert!(
                parse_rules(&rules).is_none(),
                "accepted invalid {key}: {rules}"
            );
        }
    }

    #[test]
    fn power_up_inputs_are_accepted_and_spots_stay_in_range() {
        assert!(is_input_message(&json!({"kind":"power"})));
        assert!(is_input_message(&json!({"kind":"cancel"})));
        assert!(is_input_message(&json!({"kind":"spot","index":0})));
        assert!(is_input_message(&json!({"kind":"spot","index":7})));
        for invalid in [
            json!({"kind":"spot"}),
            json!({"kind":"spot","index":-1}),
            json!({"kind":"spot","index":8}),
            json!({"kind":"spot","index":1.5}),
            json!({"kind":"spot","index":"1"}),
        ] {
            assert!(!is_input_message(&invalid), "accepted input: {invalid}");
        }
    }

    #[test]
    fn rules_reject_out_of_range_values_and_invalid_booleans() {
        for (key, value) in [
            ("rounds", json!(100)),
            ("maxPlanets", json!(0)),
            ("shotTime", json!(121)),
            ("maxPower", json!(95)),
            ("fixedPowerLevel", json!(56)),
            ("neighborGrace", json!(3)),
            ("fadingTrails", json!(3)),
        ] {
            let mut rules = valid_rules();
            rules[key] = value;
            assert!(
                parse_rules(&rules).is_none(),
                "accepted invalid {key}: {rules}"
            );
        }
        for key in [
            "invisiblePlanets",
            "bounce",
            "fixedPower",
            "styleBonuses",
            "simultaneousShots",
            "hiddenAim",
            "betting",
        ] {
            let mut rules = valid_rules();
            rules[key] = json!("true");
            assert!(
                parse_rules(&rules).is_none(),
                "accepted invalid boolean {key}"
            );
        }
    }

    #[test]
    fn room_look_takes_defaults_and_refuses_unknown_choices() {
        assert_eq!(
            parse_room_look(&json!({})),
            Some(RoomLook {
                visibility: Visibility::Public,
                symbol: RoomSymbol::Planet,
                color: RoomColor::Coral,
            })
        );
        let custom = parse_room_look(&json!({
            "visibility":"private","symbol":"blackhole","color":"#6fe3c8"
        }))
        .expect("a complete look is accepted");
        assert!(custom.is_private());
        assert_eq!(custom.symbol, RoomSymbol::Blackhole);
        assert_eq!(custom.color, RoomColor::Mint);
        for invalid in [
            json!({"visibility": "secret"}),
            json!({"symbol": "<svg onload=alert(1)>"}),
            json!({"symbol": 3}),
            json!({"color": "#000000"}),
        ] {
            assert!(parse_room_look(&invalid).is_none(), "accepted {invalid}");
        }
    }

    #[test]
    fn player_symbols_default_and_refuse_room_symbols_and_junk() {
        assert_eq!(parse_avatar(None), Some(Avatar::Rocket));
        assert_eq!(parse_avatar(Some(&json!("gem"))), Some(Avatar::Gem));
        assert!(parse_avatar(Some(&json!("planet"))).is_none());
        assert!(parse_avatar(Some(&json!(3))).is_none());
    }

    #[test]
    fn shared_avatar_contract_matches_relay_choices() {
        let contract: Value =
            serde_json::from_str(include_str!("../protocol-contract.json")).unwrap();
        assert_eq!(contract["avatar"]["options"], json!(Avatar::NAMES));
        assert_eq!(contract["avatar"]["default"], Avatar::default().as_str());
    }

    #[test]
    fn cpu_levels_are_the_offline_ones_and_the_contract_shares_them() {
        let contract: Value =
            serde_json::from_str(include_str!("../protocol-contract.json")).unwrap();
        assert_eq!(contract["cpu"]["levels"], json!(CpuLevel::NAMES));
        assert_eq!(
            parse_cpu_level(Some(&json!("hawking"))),
            Some(CpuLevel::Hawking)
        );
        assert!(parse_cpu_level(None).is_none());
        assert!(parse_cpu_level(Some(&json!("einstein"))).is_none());
        assert!(parse_cpu_level(Some(&json!(2))).is_none());
    }

    #[test]
    fn shared_room_contract_matches_relay_choices() {
        let contract: Value =
            serde_json::from_str(include_str!("../protocol-contract.json")).unwrap();
        let room = &contract["room"];
        assert_eq!(room["options"]["visibility"], json!(Visibility::NAMES));
        assert_eq!(room["options"]["symbol"], json!(RoomSymbol::NAMES));
        assert_eq!(room["options"]["color"], json!(RoomColor::NAMES));
        assert_eq!(room["defaults"]["visibility"], "public");
        assert_eq!(room["defaults"]["symbol"], "planet");
        assert_eq!(room["defaults"]["color"], RoomColor::NAMES[0]);
    }

    #[test]
    fn a_day_key_is_a_shape_and_a_date_that_exists() {
        assert!(is_date_key(&json!("2026-10-19")));
        assert!(is_date_key(&json!("2024-02-29")));
        for invalid in [
            json!("2026-2-19"),
            json!("26-10-19"),
            json!("2026/10/19"),
            json!("2026-13-01"),
            json!("2026-00-10"),
            json!("2026-10-00"),
            json!("2026-10-32"),
            json!("2026-04-31"),
            json!("2023-02-29"),
            json!("0999-01-01"),
            json!(20261019),
            json!(null),
        ] {
            assert!(!is_date_key(&invalid), "accepted day: {invalid}");
        }
    }

    #[test]
    fn a_daily_run_needs_a_real_day_a_clean_name_and_a_sane_score() {
        let run = parse_daily_submit(&json!({"day":"2026-10-19","name":" Ada ","score":4200}))
            .expect("a complete run is accepted");
        assert_eq!(
            run,
            DailyScore {
                day: "2026-10-19".into(),
                name: "Ada".into(),
                score: 4200,
            }
        );
        assert_eq!(
            parse_daily_submit(&json!({"day":"2026-10-19","name":"Ada","score":0}))
                .unwrap()
                .score,
            0
        );
        assert_eq!(
            parse_daily_submit(&json!({"day":"2026-10-19","name":"Ada","score":MAX_DAILY_SCORE}))
                .unwrap()
                .score,
            MAX_DAILY_SCORE
        );
        assert_eq!(
            parse_daily_day(&json!({"day":"2026-10-19","name":"Ada","score":1})).as_deref(),
            Some("2026-10-19")
        );

        for invalid in [
            // no day, an impossible day
            json!({"name":"Ada","score":10}),
            json!({"day":"today","name":"Ada","score":10}),
            // no name, a name that is only control characters
            json!({"day":"2026-10-19","score":10}),
            json!({"day":"2026-10-19","name":"  ","score":10}),
            json!({"day":"2026-10-19","name":"\u{200b}","score":10}),
            // no score, a fraction, a negative one, one past the cap, one that is not a number
            json!({"day":"2026-10-19","name":"Ada"}),
            json!({"day":"2026-10-19","name":"Ada","score":1.5}),
            json!({"day":"2026-10-19","name":"Ada","score":-1}),
            json!({"day":"2026-10-19","name":"Ada","score":MAX_DAILY_SCORE + 1}),
            json!({"day":"2026-10-19","name":"Ada","score":"4200"}),
        ] {
            assert!(
                parse_daily_submit(&invalid).is_none(),
                "accepted run: {invalid}"
            );
        }
        assert!(parse_daily_submit(&json!([])).is_none());
    }

    #[test]
    fn a_submitted_name_is_cut_to_the_player_name_length() {
        let long = "x".repeat(MAX_NAME_LENGTH + 20);
        let run = parse_daily_submit(&json!({"day":"2026-10-19","name":long,"score":1})).unwrap();
        assert_eq!(run.name.chars().count(), MAX_NAME_LENGTH);
    }

    #[test]
    fn a_board_name_is_refused_when_it_is_profane() {
        // The gate is the words themselves: a profane name is a well-formed run, and only the
        // board refuses it. Ordinary names — the game's own CPU names among them — pass.
        for profane in [
            "fuck", "shit", "bitch", "asshole", "cunt", "nigger", "faggot", "f4ck", "sh1t",
            "a55hole",
        ] {
            assert!(!is_acceptable_name(profane), "accepted {profane}");
        }
        // Three or more x's is the adult-content marker, not a name; a pair of them is fine.
        assert!(!is_acceptable_name("xxx"));
        assert!(!is_acceptable_name("Xxxxx"));
        assert!(is_acceptable_name("xx"));
        for fine in [
            "Ada",
            "Grace",
            "Alan",
            "Kepler",
            "Newton",
            "Einstein",
            "Hawking",
            "Scunthorpe",
            "Assassin",
            "Michelle",
            "Precision",
            "Admiral",
            "Navigator",
        ] {
            assert!(is_acceptable_name(fine), "refused {fine}");
        }

        let run = parse_daily_submit(&json!({"day":"2026-10-19","name":"fuck","score":1}))
            .expect("the shape is fine");
        assert_eq!(run.name, "fuck");
        assert!(!is_acceptable_name(&run.name));
    }

    #[test]
    fn shared_daily_contract_matches_relay_limits() {
        let contract: Value =
            serde_json::from_str(include_str!("../protocol-contract.json")).unwrap();
        let daily = &contract["daily"];
        assert_eq!(daily["boardSize"], crate::leaderboard::BOARD_SIZE);
        assert_eq!(daily["maxScore"], MAX_DAILY_SCORE);
        assert_eq!(daily["nameLength"], MAX_NAME_LENGTH);
        assert_eq!(daily["keepDays"], crate::leaderboard::DEFAULT_KEEP_DAYS);
    }
}
