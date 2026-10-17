//! Validation helpers for untrusted wire input, checked before the room logic sees it.

use serde_json::Value;

/// Tips name a ship; there are at most six.
pub const MAX_TIP: i64 = 6;
/// The most points one stake may name on the wire; the host holds a player to what they actually have.
const MAX_STAKE: f64 = 1_000_000.0;

/// The longest a player name may be.
pub const MAX_NAME_LENGTH: usize = 24;

/// `name.trim().slice(0, 24)`; None when the value is not a non-empty trimmed string.
pub fn clean_name_checked(value: Option<&Value>) -> Option<String> {
    let s = value.and_then(Value::as_str)?;
    let cleaned = clean_text(s);
    (!cleaned.is_empty()).then_some(cleaned)
}

/// Control characters (C0/C1, DEL, zero-width/bidi chars) are stripped so a name cannot smuggle
/// terminal escapes or invisible directionality into other clients' UIs; then the text is trimmed
/// and cut to `MAX_NAME_LENGTH` UTF-16 units. May come out empty.
fn clean_text(s: &str) -> String {
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
        if units + width > MAX_NAME_LENGTH {
            end = index;
            break;
        }
        units += width;
    }
    stripped[..end].to_string()
}

/// The symbols a room can wear in the lobby, and the colours it can take. The client offers exactly these
/// (see `protocol-contract.json`).
pub const ROOM_SYMBOLS: [&str; 8] = [
    "planet",
    "moon",
    "star",
    "sun",
    "comet",
    "blackhole",
    "ufo",
    "asteroid",
];
pub const ROOM_COLORS: [&str; 8] = [
    "#ff8660", "#ffd27a", "#c6e86a", "#6fe3c8", "#62b6ff", "#b99cff", "#ff6f9f", "#e8e4d8",
];
/// Public rooms are listed in the lobby; a private room is joined with its code only.
pub const ROOM_VISIBILITIES: [&str; 2] = ["public", "private"];

/// The symbols a player shows in an online game. Players pick their own; they are not the room's symbols.
pub const AVATARS: [&str; 8] = [
    "rocket",
    "satellite",
    "alien",
    "robot",
    "astronaut",
    "crosshair",
    "bolt",
    "gem",
];
pub const DEFAULT_AVATAR: &str = "rocket";

/// The levels a CPU seat in an online room can take: the ones the offline game offers.
pub const CPU_LEVELS: [&str; 4] = ["easy", "medium", "hard", "hawking"];

/// The name a CPU seat starts with, by level: the offline game's names.
pub fn cpu_name(level: &str) -> &'static str {
    match level {
        "easy" => "Kepler",
        "medium" => "Newton",
        "hard" => "Einstein",
        "hawking" => "Hawking",
        _ => "CPU",
    }
}

/// A CPU seat's level from a client. There is no default: anything but a level is None.
pub fn parse_cpu_level(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .filter(|level| CPU_LEVELS.contains(level))
        .map(str::to_owned)
}

/// How a room presents itself: whether it is listed, and its symbol and colour.
#[derive(Clone, Debug, PartialEq)]
pub struct RoomLook {
    pub visibility: String,
    pub symbol: String,
    pub color: String,
}

impl RoomLook {
    pub fn is_private(&self) -> bool {
        self.visibility == "private"
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
        visibility: choice_of(value.get("visibility"), &ROOM_VISIBILITIES, "public")?,
        symbol: choice_of(value.get("symbol"), &ROOM_SYMBOLS, "planet")?,
        color: choice_of(value.get("color"), &ROOM_COLORS, ROOM_COLORS[0])?,
    })
}

/// A player's symbol from a client; a missing one is the default, anything that is not a choice is None.
pub fn parse_avatar(value: Option<&Value>) -> Option<String> {
    choice_of(value, &AVATARS, DEFAULT_AVATAR)
}

/// One of `allowed`; a missing (or null) value is `default`.
fn choice_of(value: Option<&Value>, allowed: &[&str], default: &str) -> Option<String> {
    match value.filter(|v| !v.is_null()) {
        None => Some(default.to_owned()),
        Some(v) => v
            .as_str()
            .filter(|s| allowed.contains(s))
            .map(str::to_owned),
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
        Some("fire") | Some("skip") => true,
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
            "hiddenAim":false,"fadingTrails":2,"betting":true
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
                visibility: "public".into(),
                symbol: "planet".into(),
                color: "#ff8660".into(),
            })
        );
        let custom = parse_room_look(&json!({
            "visibility":"private","symbol":"blackhole","color":"#6fe3c8"
        }))
        .expect("a complete look is accepted");
        assert!(custom.is_private());
        assert_eq!(custom.symbol, "blackhole");
        assert_eq!(custom.color, "#6fe3c8");
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
        assert_eq!(parse_avatar(None).as_deref(), Some("rocket"));
        assert_eq!(parse_avatar(Some(&json!("gem"))).as_deref(), Some("gem"));
        assert!(parse_avatar(Some(&json!("planet"))).is_none());
        assert!(parse_avatar(Some(&json!(3))).is_none());
    }

    #[test]
    fn shared_avatar_contract_matches_relay_choices() {
        let contract: Value =
            serde_json::from_str(include_str!("../protocol-contract.json")).unwrap();
        assert_eq!(contract["avatar"]["options"], json!(AVATARS));
        assert_eq!(contract["avatar"]["default"], DEFAULT_AVATAR);
    }

    #[test]
    fn cpu_levels_are_the_offline_ones_and_the_contract_shares_them() {
        let contract: Value =
            serde_json::from_str(include_str!("../protocol-contract.json")).unwrap();
        assert_eq!(contract["cpu"]["levels"], json!(CPU_LEVELS));
        assert_eq!(
            parse_cpu_level(Some(&json!("hawking"))).as_deref(),
            Some("hawking")
        );
        assert!(parse_cpu_level(None).is_none());
        assert!(parse_cpu_level(Some(&json!("experimental"))).is_none());
        assert!(parse_cpu_level(Some(&json!(2))).is_none());
    }

    #[test]
    fn shared_room_contract_matches_relay_choices() {
        let contract: Value =
            serde_json::from_str(include_str!("../protocol-contract.json")).unwrap();
        let room = &contract["room"];
        assert_eq!(room["options"]["visibility"], json!(ROOM_VISIBILITIES));
        assert_eq!(room["options"]["symbol"], json!(ROOM_SYMBOLS));
        assert_eq!(room["options"]["color"], json!(ROOM_COLORS));
        assert_eq!(room["defaults"]["visibility"], "public");
        assert_eq!(room["defaults"]["symbol"], "planet");
        assert_eq!(room["defaults"]["color"], ROOM_COLORS[0]);
    }
}
