//! A room's own path for the host's state frames, with a lock of its own.
//!
//! State frames are nearly all of the relay's traffic: 30 a second from every running game. Passed
//! through `RoomManager`, each one took the lock every room shares, and every room waited for every
//! other. A `Relay` holds just what a frame needs (who the host is, the last sequence, who hears it),
//! so a frame takes only its own room's lock.
//!
//! `RoomManager` stays the owner of the room: it brings the relay up to date (`RoomManager::sync_room`)
//! at the end of every step that may change who is in the room or whether it plays, while it still
//! holds its own lock. A frame therefore sees the room as it was before such a step or as it is after
//! it. The one thing a frame can do that it could not before is arrive just after the message telling
//! somebody they left; a client drops a state frame when it has no game running.

use std::sync::Arc;

use parking_lot::Mutex;

use super::connections::Sink;
use crate::codec::{Frame, OutboundPool};

/// Which room's relay a connection's state frames go to, if any. Each connection has one, written by
/// `RoomManager` and read by the connection's own task.
#[derive(Default)]
pub struct RelaySlot(Mutex<Option<Arc<Relay>>>);

impl RelaySlot {
    pub fn get(&self) -> Option<Arc<Relay>> {
        self.0.lock().clone()
    }

    pub(super) fn set(&self, relay: &Arc<Relay>) {
        *self.0.lock() = Some(relay.clone());
    }

    /// Point the slot at nothing, unless another room's relay has taken it over since.
    pub(super) fn clear(&self, relay: &Arc<Relay>) {
        let mut slot = self.0.lock();
        if slot
            .as_ref()
            .is_some_and(|current| Arc::ptr_eq(current, relay))
        {
            *slot = None;
        }
    }
}

pub struct Relay {
    state: Mutex<State>,
    pool: OutboundPool,
}

struct State {
    /// The host's connection while the room plays; nobody else may send state.
    host: Option<u64>,
    /// Which game of the room this is: a new one starts the sequence over.
    game: u64,
    last_seq: i64,
    /// Everybody who hears the room, the host included.
    recipients: Vec<(u64, Arc<Sink>)>,
}

/// What became of a state frame.
#[derive(Debug, PartialEq)]
pub enum Forward {
    Sent,
    /// The frame is the host's, and wrong; the host is told why.
    Refused(&'static str),
    /// Not the host of a running game. `RoomManager` works out what to tell the sender.
    NotHost,
}

/// The highest sequence a client can count to: JavaScript numbers are exact up to 2^53 - 1.
const MAX_SEQ: u64 = 9_007_199_254_740_991;

impl Relay {
    pub(super) fn new(pool: OutboundPool) -> Self {
        Self {
            state: Mutex::new(State {
                host: None,
                game: 0,
                last_seq: -1,
                recipients: Vec::new(),
            }),
            pool,
        }
    }

    /// Bring the relay up to date with its room.
    pub(super) fn update(&self, host: Option<u64>, game: u64, recipients: Vec<(u64, Arc<Sink>)>) {
        let mut state = self.state.lock();
        if state.game != game {
            state.game = game;
            state.last_seq = -1;
        }
        state.host = host;
        state.recipients = recipients;
    }

    /// Send the host's frame on to everybody else in the room, once its sequence is checked.
    pub fn forward(&self, conn: u64, seq: u64, bytes: &[u8]) -> Forward {
        let mut state = self.state.lock();
        if state.host != Some(conn) {
            return Forward::NotHost;
        }
        if seq > MAX_SEQ {
            return Forward::Refused("Invalid state sequence");
        }
        let seq = seq as i64;
        if seq <= state.last_seq {
            return Forward::Refused("State sequence must increase monotonically");
        }
        state.last_seq = seq;
        // Copied once, here, and shared by every recipient's queue.
        let frame = Frame::from(bytes);
        for (recipient, sink) in &state.recipients {
            if *recipient != conn {
                sink.send(*recipient, &frame, &self.pool);
            }
        }
        Forward::Sent
    }
}

/// What the room manager keeps about a room's relay: the relay, and who and which seat tokens it was
/// last brought up to date with, to undo what no longer holds.
pub(super) struct Wire {
    relay: Arc<Relay>,
    members: Vec<u64>,
    tokens: Vec<String>,
}

impl super::RoomManager {
    /// Bring a room's relay, its connections' slots and the seat-token index up to date with the room,
    /// or take them down if the room is gone. Called at the end of every step that may change a room,
    /// while the room manager's lock is still held.
    pub(super) fn sync_room(&mut self, room_id: &str) {
        let Some(room) = self.rooms.get(room_id) else {
            if let Some(wire) = self.wires.remove(room_id) {
                wire.relay.update(None, u64::MAX, Vec::new());
                for conn in &wire.members {
                    if let Some(slot) = self.net.relay_slot(*conn) {
                        slot.clear(&wire.relay);
                    }
                }
                for token in &wire.tokens {
                    if self.tokens.get(token).is_some_and(|room| room == room_id) {
                        self.tokens.remove(token);
                    }
                }
            }
            return;
        };
        let members: Vec<u64> = room.recipients().collect();
        let host = if room.status == super::RoomStatus::Playing {
            room.players.iter().find(|p| p.id == 0).and_then(|p| p.conn)
        } else {
            None
        };
        let tokens: Vec<String> = room
            .players
            .iter()
            .filter(|p| !p.token.is_empty())
            .map(|p| p.token.clone())
            .collect();
        let pool = self.net.pool();
        let wire = self
            .wires
            .entry(room_id.to_string())
            .or_insert_with(|| Wire {
                relay: Arc::new(Relay::new(pool)),
                members: Vec::new(),
                tokens: Vec::new(),
            });
        let sinks = members
            .iter()
            .filter_map(|conn| self.net.sink(*conn).map(|sink| (*conn, sink)))
            .collect();
        wire.relay.update(host, room.game, sinks);
        for conn in wire.members.iter().filter(|conn| !members.contains(conn)) {
            if let Some(slot) = self.net.relay_slot(*conn) {
                slot.clear(&wire.relay);
            }
        }
        for conn in &members {
            if let Some(slot) = self.net.relay_slot(*conn) {
                slot.set(&wire.relay);
            }
        }
        for token in wire.tokens.iter().filter(|token| !tokens.contains(token)) {
            if self.tokens.get(token).is_some_and(|room| room == room_id) {
                self.tokens.remove(token);
            }
        }
        for token in &tokens {
            self.tokens.insert(token.clone(), room_id.to_string());
        }
        wire.members = members;
        wire.tokens = tokens;
    }

    /// The relay a room's state frames go through, if the room has been synced.
    pub(super) fn relay_of(&self, room_id: &str) -> Option<Arc<Relay>> {
        self.wires.get(room_id).map(|wire| wire.relay.clone())
    }
}
