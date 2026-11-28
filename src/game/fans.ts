import { FANS } from '../sim/config';

/**
 * The fans of a round: online, a shot-down player flies an escape pod and may pick a ship still in the round to
 * root for. Their pod flies over and circles it, and they can cheer it on. It is for fun and counts for nothing;
 * a bet on the round (`BetBook`) makes its bettor a fan of the ship bet on, and keeps them there.
 */

/** What a fan calls for the next shot of their ship: it hits an enemy, hits nobody, or is hit itself. */
export type CallKind = 'hit' | 'miss' | 'hitBy';
export const CALL_KINDS: readonly CallKind[] = ['hit', 'miss', 'hitBy'];

/** A fan's call: open until the shot has flown, then right or wrong (`at`: match clock it was settled). */
export interface Call {
  kind: CallKind;
  state: 'open' | 'right' | 'wrong';
  at: number;
}
const CALL_STATES: readonly Call['state'][] = ['open', 'right', 'wrong'];

/** One fan: the ship they root for, how often they have cheered it on this round, and when they last did (match clock); their latest call. */
export interface Fan {
  pick: number;
  cheers: number;
  at: number;
  call?: Call;
}

/** The fans as they cross the wire: who, for which ship, how many cheers so far, and their latest call (kind, state, when settled). */
export type FanSnapshot = [player: number, pick: number, cheers: number, call?: [kind: number, state: number, at: number]][];

export class FanClub {
  private fans = new Map<number, Fan>();

  /** A new round: nobody roots for anybody yet. */
  reset(): void {
    this.fans.clear();
  }

  /** Who `player` roots for, if anybody. */
  of(player: number): Fan | undefined {
    return this.fans.get(player);
  }

  /** Every fan, by player. */
  get all(): ReadonlyMap<number, Fan> {
    return this.fans;
  }

  /** `player` roots for `pick` from now on (their cheers so far stay theirs). */
  follow(player: number, pick: number): void {
    const fan = this.fans.get(player);
    if (fan) fan.pick = pick;
    else this.fans.set(player, { pick, cheers: 0, at: -Infinity });
  }

  /** `player` cheers their ship on, at `clock`; not more often than every `FANS.CHEER_GAP` seconds. Whether it counted. */
  cheer(player: number, clock: number): boolean {
    const fan = this.fans.get(player);
    if (!fan || clock - fan.at < FANS.CHEER_GAP) return false;
    fan.cheers++;
    fan.at = clock;
    return true;
  }

  /** `player` calls `kind` for the next shot of their ship (a call not yet settled is changed). */
  call(player: number, kind: CallKind): void {
    const fan = this.fans.get(player);
    if (fan) fan.call = { kind, state: 'open', at: 0 };
  }

  snapshot(): FanSnapshot {
    return [...this.fans].map(([player, fan]) => {
      const call = fan.call;
      return call ? [player, fan.pick, fan.cheers, [CALL_KINDS.indexOf(call.kind), CALL_STATES.indexOf(call.state), call.at]] : [player, fan.pick, fan.cheers];
    });
  }

  restore(snapshot: FanSnapshot): void {
    const before = this.fans;
    this.fans = new Map(
      snapshot.map(([player, pick, cheers, call]) => {
        const fan: Fan = { pick, cheers, at: before.get(player)?.at ?? -Infinity };
        const kind = call && CALL_KINDS[call[0]];
        const state = call && CALL_STATES[call[1]];
        if (call && kind && state) fan.call = { kind, state, at: call[2] };
        return [player, fan];
      }),
    );
  }
}
