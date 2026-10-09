//! Validation helpers for untrusted wire input, checked before the room logic sees it.

use serde_json::Value;

/// Tips name a ship; there are at most six.
pub const MAX_TIP: i64 = 6;

/// The longest a player name may be.
pub const MAX_NAME_LENGTH: usize = 24;

/// `name.trim().slice(0, 24)`; None when the value is not a non-empty trimmed string.
/// Control characters (C0/C1, DEL, zero-width/bidi chars) are stripped so a name cannot
/// smuggle terminal escapes or invisible directionality into other clients' UIs.
pub fn clean_name_checked(value: Option<&Value>) -> Option<String> {
    let s = value.and_then(Value::as_str)?;
    let stripped: String = s
        .trim()
        .chars()
        .filter(|c| {
            let u = *c as u32;
            !matches!(u, 0x00..=0x1F | 0x7F..=0x9F)
                && !matches!(u, 0x200B..=0x200F | 0x202A..=0x202E | 0x2060..=0x2064 | 0xFEFF)
        })
        .collect();
    if stripped.is_empty() {
        return None;
    }
    let cut = stripped
        .char_indices()
        .nth(MAX_NAME_LENGTH)
        .map_or(stripped.len(), |(index, _)| index);
    Some(stripped[..cut].to_string())
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

/// A finite non-negative safe integer (a ship index).
fn is_index(value: &Value) -> bool {
    is_safe_integer(value) && value.as_f64().is_some_and(|f| f >= 0.0)
}

fn is_bool_field(value: &Value, key: &str) -> bool {
    value.get(key).and_then(Value::as_bool).is_some()
}

fn is_index_of(value: &Value, key: &str) -> bool {
    value.get(key).is_some_and(is_index)
}

fn is_record_of(value: &Value, key: &str) -> bool {
    value.get(key).is_some_and(is_record)
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

fn is_bool(value: Option<&Value>) -> bool {
    value.and_then(Value::as_bool).is_some()
}

/// A client's aim/fire request, as the host will apply it.
pub fn is_input_message(value: &Value) -> bool {
    if !is_record(value) {
        return false;
    }
    match value.get("kind").and_then(Value::as_str) {
        Some("adjust") => is_finite_number(value.get("dAngle")) && is_finite_number(value.get("dPower")),
        Some("aim") => is_finite_number(value.get("angle")) && is_finite_number(value.get("power")),
        Some("fire") | Some("skip") => true,
        Some("bet") => match value.get("pick") {
            Some(pick) => is_safe_integer(pick) && pick.as_f64().is_some_and(|f| f >= -1.0 && f < MAX_TIP as f64),
            None => false,
        },
        _ => false,
    }
}

fn is_clash_players(value: Option<&Value>) -> bool {
    match value.and_then(Value::as_array) {
        Some(list) => list.len() == 2 && list.iter().all(is_index),
        None => false,
    }
}

fn is_clash_velocities(value: Option<&Value>) -> bool {
    match value.and_then(Value::as_array) {
        Some(list) => {
            list.len() == 2
                && list.iter().all(|v| is_record(v) && is_finite_number(v.get("x")) && is_finite_number(v.get("y")))
        }
        None => false,
    }
}

/// A game event the host relays to the guests (sounds and effects are driven from these).
pub fn is_game_event(value: &Value) -> bool {
    if !is_record(value) {
        return false;
    }
    let Some(ty) = value.get("type").and_then(Value::as_str) else {
        return false;
    };
    match ty {
        "round" | "gameOver" | "roundEnd" | "volley" | "collapse" => true,
        "killcam" => is_bool(value.get("active")) && is_bool(value.get("recording")),
        "turn" | "lock" => is_index_of(value, "player"),
        "fire" => {
            is_index_of(value, "player")
                && is_finite_number(value.get("x"))
                && is_finite_number(value.get("y"))
                && is_finite_number(value.get("angle"))
                && is_finite_number(value.get("power"))
        }
        "impact" => {
            is_index_of(value, "player")
                && is_finite_number(value.get("x"))
                && is_finite_number(value.get("y"))
                && is_finite_number(value.get("vx"))
                && is_finite_number(value.get("vy"))
        }
        "explode" => {
            is_finite_number(value.get("x"))
                && is_finite_number(value.get("y"))
                && is_index_of(value, "ship")
                && is_finite_number(value.get("vx"))
                && is_finite_number(value.get("vy"))
        }
        "fizzle" => {
            is_index_of(value, "player")
                && is_finite_number(value.get("x"))
                && is_finite_number(value.get("y"))
                && is_finite_number(value.get("vx"))
                && is_finite_number(value.get("vy"))
                && is_bool(value.get("lost"))
        }
        "clash" => {
            is_finite_number(value.get("x"))
                && is_finite_number(value.get("y"))
                && is_clash_players(value.get("players"))
                && is_clash_velocities(value.get("velocities"))
        }
        "devour" => {
            is_finite_number(value.get("x"))
                && is_finite_number(value.get("y"))
                && is_finite_number(value.get("toX"))
                && is_finite_number(value.get("toY"))
                && value.get("color").and_then(Value::as_str).is_some()
                && is_finite_number(value.get("vx"))
                && is_finite_number(value.get("vy"))
        }
        "style" => {
            is_index_of(value, "player")
                && value.get("kind").and_then(Value::as_str).is_some()
                && is_finite_number(value.get("x"))
                && is_finite_number(value.get("y"))
        }
        "kill" => is_record_of(value, "record"),
        _ => false,
    }
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
    })
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
    if !is_int_between(rounds, 0, 99) || !is_int_between(max_planets, 1, 8) || !is_int_between(shot_time, 5, 120) {
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
    let fading_trails = field("fadingTrails")?;
    if !is_number_in(fading_trails, &[0, 1, 2, 4]) {
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
        fixed_power_level: field("fixedPowerLevel").map(i64_of).unwrap_or(DEFAULT_RULES.fixed_power_level),
        max_power: field("maxPower").map(i64_of).unwrap_or(DEFAULT_RULES.max_power),
        shot_time: i64_of(shot_time),
        style_bonuses: value.get("styleBonuses").unwrap().as_bool().unwrap(),
        neighbor_grace: i64_of(neighbor_grace),
        simultaneous_shots: value.get("simultaneousShots").unwrap().as_bool().unwrap(),
        hidden_aim: value.get("hiddenAim").unwrap().as_bool().unwrap(),
        fading_trails: i64_of(fading_trails),
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
        for invalid in [
            json!({"kind":"bet"}),
            json!({"kind":"bet","pick":-2}),
            json!({"kind":"bet","pick":6}),
            json!({"kind":"bet","pick":1.5}),
            json!({"kind":"bet","pick":"1"}),
        ] {
            assert!(!is_input_message(&invalid), "rejected input: {invalid}");
        }
        assert!(is_input_message(&json!({"kind":"aim","angle":0,"power":55})));
        assert!(!is_input_message(&json!({"kind":"aim","angle":"0","power":55})));
    }

    fn valid_rules() -> Value {
        json!({
            "rounds":5,"maxPlanets":4,"invisiblePlanets":false,"bounce":true,
            "fixedPower":true,"fixedPowerLevel":70,"maxPower":80,"shotTime":20,
            "styleBonuses":true,"neighborGrace":1,"simultaneousShots":true,
            "hiddenAim":false,"fadingTrails":2
        })
    }

    #[test]
    fn rules_accept_complete_values_and_legacy_omissions() {
        let parsed = parse_rules(&valid_rules()).expect("complete rules accepted");
        assert_eq!(parsed.rounds, 5);
        assert_eq!(parsed.fixed_power_level, 70);
        assert_eq!(parsed.max_power, 80);
        assert!(parsed.bounce && parsed.fixed_power && parsed.style_bonuses);
        assert!(parsed.simultaneous_shots);

        let mut legacy = valid_rules();
        legacy.as_object_mut().unwrap().remove("maxPower");
        legacy.as_object_mut().unwrap().remove("fixedPowerLevel");
        let parsed = parse_rules(&legacy).expect("legacy omissions accepted");
        assert_eq!(parsed.max_power, 100);
        assert_eq!(parsed.fixed_power_level, 55);
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
            assert!(parse_rules(&rules).is_none(), "accepted invalid {key}: {rules}");
        }
        for key in ["invisiblePlanets", "bounce", "fixedPower", "styleBonuses", "simultaneousShots", "hiddenAim"] {
            let mut rules = valid_rules();
            rules[key] = json!("true");
            assert!(parse_rules(&rules).is_none(), "accepted invalid boolean {key}");
        }
    }

    #[test]
    fn event_validation_checks_required_fields_and_values() {
        assert!(is_game_event(&json!({"type":"turn","player":0})));
        assert!(is_game_event(&json!({"type":"fire","player":1,"x":1,"y":2,"angle":45,"power":55})));
        assert!(is_game_event(&json!({"type":"killcam","active":true,"recording":false})));
        assert!(!is_game_event(&json!({"type":"turn"})));
        assert!(!is_game_event(&json!({"type":"turn","player":-1})));
        assert!(!is_game_event(&json!({"type":"fire","player":1,"x":1,"y":2,"angle":45})));
        assert!(!is_game_event(&json!({"type":"killcam","active":true})));
        assert!(!is_game_event(&json!({"type":"unknown"})));
    }
}
