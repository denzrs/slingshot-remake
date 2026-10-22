/**
 * Every shot of a round, one line each: how it was aimed, what rode with it and how it ended. The match
 * keeps it as the round goes and the host reports it when the round is over (`roundReport`).
 */
import type { ShotEnd } from './physics';
import type { PowerUpKind } from './powerups';
import type { VolleyAim, VolleyShot } from './volley';

/** How a shot ended: on a ship, a planet or a black hole, shot down by a defense, against another shot, off the field or out of time. */
export type ShotResolution = ShotEnd['kind'];

/** Whose ship a shot hit: an enemy's, the shooter's own or a teammate's. */
export type HitKind = 'enemy' | 'self' | 'friendly';

/** The power-ups that ride on a single shot; the others are placed, or wait for a hit. */
const RIDES: readonly PowerUpKind[] = ['preview', 'piercing', 'plasma'];

export interface ShotRecord {
  /** Order of launch within the round, from 1. */
  n: number;
  /** The turn (volley) of the round it was fired in, from 1. */
  turn: number;
  player: number;
  /** As aimed: degrees, and power 0 to 100. */
  angle: number;
  power: number;
  powerUp: PowerUpKind | null;
  /** One of the extra shots of a splitter, not the one that was aimed. */
  fork: boolean;
  /** Null while the shot is still flying. */
  resolution: ShotResolution | null;
  /** Ships the shot took out (an armor-piercing one can take several), and the first of them. */
  hits: number;
  hitSeat: number | null;
  hitKind: HitKind | null;
  /** What the shot earned: for its hits, a high-five, a multi-kill bonus. Negative for a ship of one's own. */
  points: number;
}

export class ShotLog {
  shots: ShotRecord[] = [];
  /** Volleys launched so far this round. */
  turn = 0;
  private bySource = new WeakMap<VolleyShot, ShotRecord>();
  private carried = new Map<number, PowerUpKind>();

  reset(): void {
    this.shots = [];
    this.turn = 0;
    this.bySource = new WeakMap();
    this.carried.clear();
  }

  /** What a player's next shot carries: noted as it is aimed, before the power-up is spent on it. */
  carry(player: number, held: PowerUpKind | null, armed: boolean): void {
    if (armed && held && RIDES.includes(held)) this.carried.set(player, held);
    else this.carried.delete(player);
  }

  launched(shots: readonly VolleyShot[], aims: readonly VolleyAim[]): void {
    this.turn++;
    shots.forEach((vs, i) => {
      if (vs.stray) return;
      this.add(vs, aims[i].angle, aims[i].power, false, this.carried.get(vs.owner) ?? null);
    });
    this.carried.clear();
  }

  /** The line of a shot, if it is one a player fired: a splitter's fork gets one when it first shows up. */
  of(vs: VolleyShot): ShotRecord | null {
    if (vs.stray) return null;
    let record = this.bySource.get(vs);
    if (!record) {
      const parent = [...this.shots].reverse().find((s) => s.player === vs.owner && !s.fork);
      record = this.add(vs, parent?.angle ?? 0, parent?.power ?? 0, true, null);
    }
    if (vs.fan !== undefined) record.powerUp = 'splitter';
    return record;
  }

  private add(vs: VolleyShot, angle: number, power: number, fork: boolean, powerUp: PowerUpKind | null): ShotRecord {
    const record: ShotRecord = { n: this.shots.length + 1, turn: this.turn, player: vs.owner, angle, power, powerUp, fork, resolution: null, hits: 0, hitSeat: null, hitKind: null, points: 0 };
    this.shots.push(record);
    this.bySource.set(vs, record);
    return record;
  }

  /** The shots of the turn that has just been flown. */
  ofTurn(): ShotRecord[] {
    return this.shots.filter((s) => s.turn === this.turn);
  }

  hit(vs: VolleyShot, seat: number, kind: HitKind, points: number): void {
    const record = this.of(vs);
    if (!record) return;
    record.hits++;
    record.hitSeat ??= seat;
    record.hitKind ??= kind;
    record.points += points;
  }

  /** Points on top of a hit: a high-five, the multi-kill bonus. */
  bonus(vs: VolleyShot, points: number): void {
    const record = this.of(vs);
    if (record) record.points += points;
  }

  ended(vs: VolleyShot, resolution: ShotResolution): void {
    const record = this.of(vs);
    if (record) record.resolution = resolution;
  }
}
