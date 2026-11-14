import type { Volley } from '../sim/volley';
import { replayKey, RIDERS, type ReplayPlacement, type ReplayScript, type ReplayTurn, type SeatChange, type SeatChangeWhen } from './replay';
import type { Phase, PlayerState } from './match-types';

/** What the driver reads of, and asks of, the match that flies a recording. */
export interface ReplayDeps {
  round(): number;
  /** The turn of the round that has gone off last (the shot log's count). */
  turn(): number;
  phase(): Phase;
  phaseTime(): number;
  /** The turn the next volley will be, as the recording numbers it. */
  nextTurnKey(): { round: number; turn: number };
  /** The same calls the room's news made on the host, so the game answers them the same way. */
  removePlayer(id: number): void;
  setAway(id: number, away: boolean): void;
  /** Lays a placement the recording logged; false when the match does not hold what it says (nothing to lay it with). */
  placeLogged(placement: ReplayPlacement): boolean;
  /** Presses the fire key of a split shot; false when there was nothing to split. */
  splitInFlight(player: number): boolean;
  skipRound(): void;
  /** Next round, or the final screen. */
  advance(): void;
  /** The mode's own phases (a collapse, an orbit) play as they do in a game. */
  updatePhase(dt: number): void;
  /** Flies a turn of the recording, the way the mode flies its own. */
  playTurn(turn: ReplayTurn): void;
}

/**
 * Flies a recorded match again: between flights it does what the recording says where a game waits for its players, makes the changes at the
 * table at the moment they came, and presses the fire key of the shots that were split. The match flies the shots itself.
 */
export class ReplayDriver {
  /** The turns of a recorded match by round and turn; null when the match is played, not replayed. */
  private readonly turns: Map<string, ReplayTurn> | null;
  /** The rounds of a recorded match that were skipped by vote. */
  private readonly skipped: Set<number>;
  /** The changes at the table of a recorded match that the replay has still to make, by the turn they belong to (see `makeSeatChanges`). */
  private readonly seats = new Map<string, SeatChange[]>();
  /** Splits still to make in the flight on screen: whose, and the step of the flight they went off at. */
  private pendingSplits: { player: number; at: number }[] = [];
  /**
   * How the replay stands: `finished` when the recording has run out, `drifted` when the game stopped doing
   * what the recording says it did (a version that plays differently from the one that was recorded).
   */
  state: 'playing' | 'finished' | 'drifted' = 'playing';

  constructor(script: ReplayScript | undefined, private readonly deps: ReplayDeps) {
    this.skipped = new Set(script?.skipped ?? []);
    this.turns = script ? new Map(script.turns.map((turn) => [replayKey(turn.round, turn.turn), turn])) : null;
    for (const change of script?.seatChanges ?? []) {
      const key = replayKey(change.round, change.turn);
      this.seats.set(key, [...(this.seats.get(key) ?? []), change]);
    }
  }

  /** Whether the match flies a recording instead of being played. */
  get active(): boolean {
    return this.turns !== null;
  }

  /** A replay presses the fire key of every shot that was split, at the step it was pressed at. */
  makeSplits(volley: Volley): void {
    if (!this.pendingSplits.length) return;
    const due = this.pendingSplits.filter((split) => split.at <= volley.steps);
    this.pendingSplits = this.pendingSplits.filter((split) => split.at > volley.steps);
    for (const split of due) if (split.at < volley.steps || !this.deps.splitInFlight(split.player)) this.state = 'drifted';
  }

  /**
   * Makes the changes at the table the recording has for this turn that came at this moment (between turns, or while it was
   * aimed), in the order they came.
   */
  seatChanges(turn: { round: number; turn: number }, when: Exclude<SeatChangeWhen, 'flight'>): void {
    if (this.seats.size) this.makeSeatChanges(replayKey(turn.round, turn.turn), (c) => c.when === when);
  }

  /**
   * The changes at the table that came while this turn's shots were in the air, each at the step of the flight it came at:
   * a ship that goes off the field mid-flight is not there for what follows. `last`: the flight is over, so whatever is left is due.
   */
  flightSeatChanges(volley: Volley, last: boolean): void {
    if (this.seats.size) this.makeSeatChanges(replayKey(this.deps.round(), this.deps.turn()), (c) => c.when === 'flight' && (last || (c.at ?? 0) <= volley.steps));
  }

  /**
   * Makes the recorded changes of the turn `key` that are `due`, each once, in the order they came. They go through the same
   * calls the room's news did on the host, so the game answers them the same way.
   */
  private makeSeatChanges(key: string, due: (c: SeatChange) => boolean): void {
    const changes = this.seats.get(key);
    if (!changes) return;
    const now: SeatChange[] = [];
    const later: SeatChange[] = [];
    for (const c of changes) (due(c) ? now : later).push(c);
    if (!now.length) return;
    if (later.length) this.seats.set(key, later);
    else this.seats.delete(key);
    for (const c of now) {
      if (c.change === 'left') this.deps.removePlayer(c.player);
      else this.deps.setAway(c.player, c.change === 'away');
    }
  }

  /** Between flights a replay does what the recording says, where a game waits for its players. */
  update(dt: number): void {
    const { deps } = this;
    // What came at the table while the game was between two turns (a round's end, an orbit) comes now, in the same phase.
    if (deps.phase() !== 'aiming') this.seatChanges(deps.nextTurnKey(), 'between');
    if (deps.phase() === 'roundOver') {
      if (deps.phaseTime() > 3) deps.advance();
      return;
    }
    if (deps.phase() === 'gameOver') {
      this.state = 'finished';
      return;
    }
    // Mode transitions play as they do in a game.
    if (deps.phase() !== 'aiming') return deps.updatePhase(dt);
    if (this.state !== 'playing') return;
    // A beat to see the field before the shots go off.
    if (deps.phaseTime() < 1) return;
    const round = deps.round();
    const turn = deps.turn() + 1;
    // A person who dropped out while this turn was being aimed does so now: the turn may pass to somebody else, or the round be settled.
    this.seatChanges({ round, turn }, 'aiming');
    if (deps.phase() !== 'aiming' || deps.phaseTime() < 1) return;
    const recorded = this.turns!.get(replayKey(round, turn));
    if (!recorded && !this.recordedBeyond(round, turn)) {
      // The room skipped this round by vote: it ends where the recording does.
      if (this.skipped.has(round)) deps.skipRound();
      else this.state = 'finished';
      return;
    }
    deps.playTurn(recorded ?? { round, turn, placements: [], shots: [] });
  }

  /** Whether the recording has a turn of this round after `turn`: a gap before it is a turn nobody shot in. */
  private recordedBeyond(round: number, turn: number): boolean {
    for (let later = turn + 1; later <= turn + 50; later++) if (this.turns!.has(replayKey(round, later))) return true;
    return false;
  }

  /**
   * Lays the turn's placements down and puts the shooters' aims in, as the recording has them, so the mode's own launch
   * can take off from there. `who` are the ships that may shoot this turn. False when the match does not hold what the
   * recording says it did (a rider armed that was never picked up).
   */
  stage(turn: ReplayTurn, who: PlayerState[]): boolean {
    let faithful = true;
    for (const placement of turn.placements) faithful = this.deps.placeLogged(placement) && faithful;
    const shots = new Map(turn.shots.map((shot) => [shot.player, shot]));
    for (const p of who) {
      const shot = shots.get(p.id);
      p.passed = !shot;
      if (!shot) continue;
      p.angle = shot.angle;
      p.power = shot.power;
      const rides = RIDERS.some((rider) => rider === p.powerUp);
      if (rides) p.armed = shot.rider === p.powerUp;
      else if (shot.rider) faithful = false;
    }
    this.pendingSplits = turn.shots.flatMap((shot) => (shot.splitAt === null ? [] : [{ player: shot.player, at: shot.splitAt }]));
    if (!faithful) this.state = 'drifted';
    return faithful;
  }
}
