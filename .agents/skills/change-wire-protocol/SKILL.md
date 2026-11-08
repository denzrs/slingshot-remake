---
name: change-wire-protocol
description: Record a change to the wire between client and relay: messages, state patches and their events, room rules, server/protocol-contract.json, or relay code that builds or validates messages. Use whenever such code changes, or when tests/protocol-wire.test.ts is red.
---

# Change the wire

The relay turns away a client built for an older wire (`PROTOCOL_VERSION`), and the client then offers a reload. The version is raised by a command, never by hand, and a test keeps it honest: `server/protocol-contract.json` records a fingerprint of the wire, and `tests/protocol-wire.test.ts` goes red as soon as the sources no longer match it.

## Steps

1. Make the change on both sides. The client's half is declared in the wire files (`WIRE_FILES` and `WIRE_DECLARATIONS` in `scripts/protocol/wire.ts`); the relay's half is in `server/src` (`command.rs` and `protocol.rs` parse what arrives, `room/` builds what is sent).
2. Run `npm test`. A red `tests/protocol-wire.test.ts` is the cue; a relay-only change leaves it green, so ask the question in step 3 anyway.
3. Decide whether a client built before the change still works against the relay after it, and the relay for it. Judge from the shapes: a field it never reads or sends is _compatible_; a removed, renamed, retyped or re-meant field, a message the other side must now handle, a new rule option the relay refuses from old clients, or a changed state-patch format is a _break_.
4. Record it:
   - break, or unsure: `npm run protocol` (records the fingerprint and raises `PROTOCOL_VERSION` in the contract, `src/net/net.ts` and `server/src/protocol.rs`). Unsure means break: an old client is only asked to reload.
   - compatible: `npm run protocol -- --compatible` (records the fingerprint only).
5. Run `npm test` again, which also builds the relay, until it is green, and commit the recorded files with the change.

## Reference

- A new file that defines what crosses the wire belongs in `WIRE_FILES`, or the fingerprint will not notice it.
- A browser that names no version counts as protocol 1; a tool with no browser id is let in. Both are in `server/src/connection.rs` (`is_outdated`), with the close code `4001`.
- How it is meant to work for players and operators: `docs/multiplayer.md` (Wire format).
