//! The closed sets of names that cross the wire: a room's mode, symbol and colour, a player's
//! symbol, a CPU's level. Each is an enum with its wire spelling in one place; the client offers
//! exactly these (see `protocol-contract.json`).

/// A name from a closed set, as it is spelled on the wire.
pub trait Wire: Sized + Copy {
    fn parse(name: &str) -> Option<Self>;
}

macro_rules! wire_enum {
    ($(#[$meta:meta])* $name:ident { $($variant:ident = $wire:literal),+ $(,)? }) => {
        $(#[$meta])*
        #[derive(Clone, Copy, Debug, PartialEq, Eq)]
        pub enum $name {
            $($variant),+
        }

        impl $name {
            /// Every choice's wire spelling, in the order the client lists them.
            #[allow(dead_code)]
            pub const NAMES: &'static [&'static str] = &[$($wire),+];

            /// Every choice, in the same order as `NAMES`.
            #[allow(dead_code)]
            pub const ALL: &'static [$name] = &[$($name::$variant),+];

            pub fn as_str(self) -> &'static str {
                match self {
                    $($name::$variant => $wire),+
                }
            }
        }

        impl Wire for $name {
            fn parse(name: &str) -> Option<Self> {
                match name {
                    $($wire => Some($name::$variant),)+
                    _ => None,
                }
            }
        }
    };
}

wire_enum! {
    /// Free-for-all, or two teams.
    RoomMode { Ffa = "ffa", Team = "team" }
}

wire_enum! {
    GameMode { Classic = "classic", Horizon = "horizon" }
}

wire_enum! {
    /// Public rooms are listed in the lobby; a private room is joined with its code only.
    Visibility { Public = "public", Private = "private" }
}

wire_enum! {
    /// The symbols a room can wear in the lobby.
    RoomSymbol {
        Planet = "planet", Moon = "moon", Star = "star", Sun = "sun",
        Comet = "comet", Blackhole = "blackhole", Ufo = "ufo", Asteroid = "asteroid",
    }
}

wire_enum! {
    /// The colours a room can take.
    RoomColor {
        Coral = "#ff8660", Sand = "#ffd27a", Lime = "#c6e86a", Mint = "#6fe3c8",
        Sky = "#62b6ff", Violet = "#b99cff", Pink = "#ff6f9f", Bone = "#e8e4d8",
    }
}

wire_enum! {
    /// The symbols a player shows in an online game. Players pick their own; they are not the room's.
    Avatar {
        Rocket = "rocket", Satellite = "satellite", Alien = "alien", Robot = "robot",
        Astronaut = "astronaut", Crosshair = "crosshair", Bolt = "bolt", Gem = "gem",
    }
}

wire_enum! {
    /// The levels a CPU seat in an online room can take: the ones the offline game offers.
    CpuLevel { Easy = "easy", Medium = "medium", Hard = "hard", Hawking = "hawking" }
}

impl CpuLevel {
    /// The name a CPU seat starts with: the offline game's names.
    pub fn name(self) -> &'static str {
        match self {
            CpuLevel::Easy => "Kepler",
            CpuLevel::Medium => "Newton",
            CpuLevel::Hard => "Einstein",
            CpuLevel::Hawking => "Hawking",
        }
    }
}

#[allow(clippy::derivable_impls)]
impl Default for Visibility {
    fn default() -> Self {
        Visibility::Public
    }
}

#[allow(clippy::derivable_impls)]
impl Default for RoomSymbol {
    fn default() -> Self {
        RoomSymbol::Planet
    }
}

#[allow(clippy::derivable_impls)]
impl Default for RoomColor {
    fn default() -> Self {
        RoomColor::Coral
    }
}

#[allow(clippy::derivable_impls)]
impl Default for Avatar {
    fn default() -> Self {
        Avatar::Rocket
    }
}
