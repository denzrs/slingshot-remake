import { describe, expect, it } from 'vitest';
import { createMatch } from '../../src/game';
import type { ClassicMatch } from '../../src/game/classic';
import type { ReplayScript, SeatChange } from '../../src/game/replay';
import { turnReport } from '../../src/game/roundReport';
import { DEFAULT_SETTINGS, type Seat } from '../../src/data/settings';

const seats: Seat[] = ['hard', 'medium', 'medium', 'off', 'off', 'off'];
const settings = { ...DEFAULT_SETTINGS, rounds: 3, seats };
const DT = 1 / 30;
/** The seat whose person drops out and comes back. */
const GONE = 1;

type Step = (match: ClassicMatch) => void;

/** Plays a match to its end, calling `act` before every frame: the room's changes arrive between frames, whenever the network says. */
function play(match: ClassicMatch, act: Step = () => {}): void {
  for (let i = 0; i < 200_000 && match.phase !== 'gameOver' && match.replayState === 'playing'; i++) {
    act(match);
    match.update(DT);
    if (match.phase === 'roundOver' && match.phaseTime > 1 && !match.replaying) match.advance();
  }
}

/** Flies a recorded game again from what its turn reports say, as the relay hands it back. */
type Mode = 'classic' | 'horizon';

function replayOf(reports: ReturnType<typeof turnReport>[], seatChanges: SeatChange[], mode: Mode): ClassicMatch {
  const script: ReplayScript = {
    ...(seatChanges.length ? { seatChanges } : {}),
    turns: reports.map((t) => ({
      round: t.round,
      turn: t.turn,
      placements: t.placements,
      shots: t.shots.filter((s) => !s.fork).map((s) => ({ player: s.player, angle: s.angle, power: s.power, rider: s.rider, splitAt: s.splitAt })),
    })),
  };
  const again = createMatch(mode, settings, { seats, seed: 5, deterministicCpu: true, script }) as unknown as ClassicMatch;
  play(again);
  return again;
}

/** A game in which seat `GONE` leaves the table and comes back as `act` says; the replay must end where the game did. */
function flownAgain(act: Step, mode: Mode = 'classic'): { original: ClassicMatch; again: ClassicMatch; changes: SeatChange[] } {
  const original = createMatch(mode, settings, { seats, seed: 5, deterministicCpu: true }) as unknown as ClassicMatch;
  const reports: ReturnType<typeof turnReport>[] = [];
  const changes: SeatChange[] = [];
  original.onTurnEnd(() => reports.push(turnReport(original)));
  original.onSeatChange((change) => changes.push(change));
  play(original, act);
  expect(original.phase).toBe('gameOver');
  return { original, again: replayOf(reports, changes, mode), changes };
}

function expectSameGame(original: ClassicMatch, again: ClassicMatch): void {
  expect(again.replayState).not.toBe('drifted');
  expect(again.phase).toBe('gameOver');
  expect(again.players.map((p) => Math.round(p.score))).toEqual(original.players.map((p) => Math.round(p.score)));
  expect(again.round).toBe(original.round);
}

/** Does `once` the first time `when` holds. */
const once = (when: (m: ClassicMatch) => boolean, once: Step): Step => {
  let done = false;
  return (m) => {
    if (done || !when(m)) return;
    done = true;
    once(m);
  };
};
const both = (...steps: Step[]): Step => (m) => steps.forEach((step) => step(m));

describe('a seat that drops out and comes back is flown again the way it was played', () => {
  it('when the person drops out while their turn is being aimed', () => {
    const { original, again, changes } = flownAgain(both(
      once((m) => m.phase === 'aiming' && m.shotLog.turn === 4 && m.current === GONE && m.phaseTime > 0.2, (m) => m.setAway(GONE, true)),
      once((m) => m.phase === 'aiming' && m.round === 2 && m.shotLog.turn === 0 && m.phaseTime > 0.2, (m) => m.setAway(GONE, false)),
    ));
    // The recording says so, or the replay could not know.
    expect(changes.map((c) => [c.player, c.change, c.when])).toEqual([[GONE, 'away', 'aiming'], [GONE, 'back', 'aiming']]);
    expectSameGame(original, again);
  });

  it('when the person drops out while a shot is in the air', () => {
    const { original, again, changes } = flownAgain(both(
      once((m) => m.phase === 'flying' && m.shotLog.turn === 3, (m) => m.setAway(GONE, true)),
      once((m) => m.phase === 'flying' && m.round === 2 && m.shotLog.turn === 2, (m) => m.setAway(GONE, false)),
    ));
    expect(changes.map((c) => [c.player, c.change, c.when])).toEqual([[GONE, 'away', 'flight'], [GONE, 'back', 'flight']]);
    expectSameGame(original, again);
  });

  it('when the person drops out between two rounds, and comes back in the next', () => {
    const { original, again, changes } = flownAgain(both(
      once((m) => m.phase === 'roundOver' && m.round === 1, (m) => m.setAway(GONE, true)),
      once((m) => m.round === 2 && m.phase === 'aiming' && m.shotLog.turn === 2, (m) => m.setAway(GONE, false)),
    ));
    // What happened between the rounds belongs to the first turn of the next one.
    expect(changes[0]).toMatchObject({ round: 2, turn: 1, player: GONE, change: 'away', when: 'between' });
    expectSameGame(original, again);
  });

  it('when the drop settles the round before the turn that was being aimed went off', () => {
    // Seat 1 goes while seat 0 aims the last shot of the round: those still at the table are one side, and the round is over at once.
    const { original, again, changes } = flownAgain(once((m) => m.phase === 'aiming' && m.round === 1 && m.shotLog.turn === 8 && m.current === 0 && m.phaseTime > 0.2, (m) => m.setAway(GONE, true)));
    expect(changes).toMatchObject([{ round: 1, turn: 9, player: GONE, change: 'away', when: 'aiming' }]);
    expectSameGame(original, again);
  });

  it('when a person leaves for good while a shot is in the air: the ship is gone from there on, not from the end of the flight', () => {
    // Found by playing games at random: seat 1 drops out in the first turn's flight, seat 2 leaves in the third turn's.
    const { original, again, changes } = flownAgain(both(
      once((m) => m.phase === 'flying' && m.round === 1 && m.shotLog.turn === 1 && m.phaseTime > 0.5, (m) => m.setAway(1, true)),
      once((m) => m.phase === 'flying' && m.round === 1 && m.shotLog.turn === 3 && m.phaseTime > 0.5, (m) => m.removePlayer(2)),
    ));
    // The step of the flight it came at is kept: a replay makes the change there, between two steps of the physics.
    expect(changes.map((c) => [c.player, c.change, c.when, typeof c.at])).toEqual([[1, 'away', 'flight', 'number'], [2, 'left', 'flight', 'number']]);
    expectSameGame(original, again);
  });

  it('in Event Horizon, when the person comes back during a killcam', () => {
    // The killcam is a phase of its own between two turns; the game hands the next turn out when it ends.
    const { original, again, changes } = flownAgain(both(
      once((m) => m.phase === 'flying' && m.round === 1 && m.shotLog.turn === 1, (m) => m.setAway(GONE, true)),
      once((m) => m.phase === 'killcam' && m.round === 1 && m.shotLog.turn >= 2, (m) => m.setAway(GONE, false)),
    ), 'horizon');
    expect(changes.map((c) => [c.player, c.change, c.when])).toEqual([[GONE, 'away', 'flight'], [GONE, 'back', 'between']]);
    expectSameGame(original, again);
  });

  it('when the person leaves for good', () => {
    const { original, again, changes } = flownAgain(once((m) => m.phase === 'aiming' && m.shotLog.turn === 4, (m) => m.removePlayer(GONE)));
    expect(changes.map((c) => [c.player, c.change])).toEqual([[GONE, 'left']]);
    expectSameGame(original, again);
  });

  it('and a game nobody left is recorded with no changes at all', () => {
    const { original, again, changes } = flownAgain(() => {});
    expect(changes).toEqual([]);
    expectSameGame(original, again);
  });
});
