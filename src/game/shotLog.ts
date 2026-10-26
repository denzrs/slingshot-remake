/**
 * Every shot of a round, one line each: how it was aimed, what rode with it and how it ended. The match
 * keeps it as the round goes and the host reports it when the round is over (`roundReport`).
 */
import type { ShotEnd } from '../sim/physics';
import type { PowerUpKind } from '../sim/powerups';
import { RIDERS, type ReplayPlacement, type Rider } from './replay';
import type { VolleyAim, VolleyScript, VolleyShot } from '../sim/volley';

/** How a shot ended: on a ship, a planet or a black hole, shot down by a defense, against another shot, off the field or out of time. */
export type ShotResolution = ShotEnd['kind'];

/** Whose ship a shot hit: an enemy's, the shooter's own or a teammate's. */
export type HitKind = 'enemy' | 'self' | 'friendly';

/** The power-ups that ride on a single shot; the others are placed, or wait for a hit. */
const RIDES: readonly PowerUpKind[] = RIDERS;

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
  /** What was armed when the shot was fired: unlike `powerUp` it stays that when the shot is split on the way. Null for a fork. */
  rider: Rider | null;
  /** One of the extra shots of a splitter, not the one that was aimed. */
  fork: boolean;
  /** The splitter fan the shot belongs to (the shot that was split and its forks share it), unique within the turn. Null for a shot that was never split. */
  fan: number | null;
  /** The physics step of the flight at which the splitter went off, the same for the whole fan. A replay splits the shot at this step. Null for a shot that was never split. */
  splitAt: number | null;
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
  /** The placements of the round, each with the turn it is made before (the one that has not been launched yet). */
  placements: (ReplayPlacement & { turn: number })[] = [];
  /** Volleys launched so far this round. */
  turn = 0;
  private bySource = new WeakMap<VolleyShot, ShotRecord>();
  private carried = new Map<number, PowerUpKind>();

  reset(): void {
    this.shots = [];
    this.placements = [];
    this.turn = 0;
    this.bySource = new WeakMap();
    this.carried.clear();
  }

  /** The volley in the air is given up (the round was skipped): it never ends, so it is not a turn of the round. */
  abandonTurn(): void {
    this.shots = this.shots.filter((s) => s.turn !== this.turn);
    this.placements = this.placements.filter((p) => p.turn !== this.turn);
    this.turn = Math.max(0, this.turn - 1);
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
    if (vs.fan !== undefined) {
      record.powerUp = 'splitter';
      record.fan = vs.fan;
    }
    return record;
  }

  /** The splits a flight made, from its script: when each fan was split, put on the shots of the turn that has just been flown. */
  splits(script: readonly VolleyScript[]): void {
    for (const entry of script) {
      if (entry.kind !== 'split') continue;
      for (const record of this.ofTurn()) if (record.fan === entry.fan) record.splitAt = entry.at;
    }
  }

  private add(vs: VolleyShot, angle: number, power: number, fork: boolean, powerUp: PowerUpKind | null): ShotRecord {
    const record: ShotRecord = { n: this.shots.length + 1, turn: this.turn, player: vs.owner, angle, power, powerUp, rider: RIDERS.find((r) => r === powerUp) ?? null, fork, fan: null, splitAt: null, resolution: null, hits: 0, hitSeat: null, hitKind: null, points: 0 };
    this.shots.push(record);
    this.bySource.set(vs, record);
    return record;
  }

  /** A power-up was laid on the field: it belongs to the turn that is being aimed. */
  placed(placement: ReplayPlacement): void {
    this.placements.push({ ...placement, turn: this.turn + 1 });
  }

  /** The placements made for the turn that has just been flown. */
  placementsOfTurn(): ReplayPlacement[] {
    return this.placements.filter((p) => p.turn === this.turn).map(({ turn: _turn, ...placement }) => placement);
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
