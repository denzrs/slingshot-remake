import { ORACLE } from '../config';

/** What a tip is about: one shot ("will it hit?", turn by turn) or a whole salvo ("who gets hit?"). */
export type OracleKind = 'shot' | 'salvo';

/** Picks for a shot; a salvo pick is a ship's index, or `TIP_NOBODY`. */
export const TIP_MISS = 0;
export const TIP_HIT = 1;
export const TIP_NOBODY = -1;

export interface OracleQuestion {
  /** Rises with every question, so a screen can tell a new verdict from one it already showed. */
  id: number;
  kind: OracleKind;
  /** The player whose shot it is (`shot`), -1 for a salvo. */
  shooter: number;
  /** The ships a tip may name (`salvo`): everybody who was still alive when the question opened. */
  choices: number[];
  /** The shots are on their way; no more tips. */
  locked: boolean;
}

export interface OracleTip {
  player: number;
  pick: number;
  right: boolean;
  points: number;
}

export interface OracleResult {
  /** The question this answers. */
  id: number;
  kind: OracleKind;
  shooter: number;
  /** Ships the shots destroyed, the shooter's own included. */
  victims: number[];
  /** `shot`: the shooter hit an enemy. */
  hit: boolean;
  tips: OracleTip[];
  /** Match clock when the verdict fell. */
  at: number;
}

export interface OracleScore {
  /** The whole match. */
  points: number;
  right: number;
  total: number;
  /** Right tips in a row; a wrong one ends it, no tip leaves it alone. */
  streak: number;
  /** This round only — for the scorecard. */
  roundPoints: number;
  roundRight: number;
  roundTotal: number;
}

/** What travels to the guests. The open tips come along, so the eliminated players see each other's tips as they are made. */
export interface OracleSnapshot {
  question: OracleQuestion | null;
  result: OracleResult | null;
  scores: OracleScore[];
  /** Who tipped what on the open question, as [player, pick] pairs. Hosts from before live tips send none. */
  tips?: [player: number, pick: number][];
}

const emptyScore = (): OracleScore => ({ points: 0, right: 0, total: 0, streak: 0, roundPoints: 0, roundRight: 0, roundTotal: 0 });

/** The multiplier a right tip earns as the `streak`-th in a row. */
export function oracleMultiplier(streak: number): number {
  return Math.min(ORACLE.MAX_MULTIPLIER, 1 + ORACLE.STREAK_STEP * Math.max(0, streak - 1));
}

/**
 * The tipping game for eliminated players. It only watches the match — questions open when a shot or
 * a salvo is about to be aimed, close when it is fired, and are judged from what the shots did.
 * The host judges; every screen mirrors the verdict and the standings from its snapshots.
 */
export class Oracle {
  question: OracleQuestion | null = null;
  result: OracleResult | null = null;
  scores: OracleScore[] = [];
  /** This screen's own tip on the open question. Display only: it never leaves the screen. */
  mine: { id: number; pick: number } | null = null;

  private serial = 0;
  /** Who tipped what on the open question: the host's book, mirrored on every screen for the live view. */
  private tips = new Map<number, number>();

  /** A new match: fresh standings for `players` ships (the question counter keeps running). */
  reset(players: number): void {
    this.question = null;
    this.result = null;
    this.mine = null;
    this.tips.clear();
    this.scores = Array.from({ length: players }, emptyScore);
  }

  startRound(): void {
    this.question = null;
    this.mine = null;
    this.tips.clear();
    for (const score of this.scores) {
      score.roundPoints = 0;
      score.roundRight = 0;
      score.roundTotal = 0;
    }
  }

  open(kind: OracleKind, shooter: number, choices: number[]): void {
    this.question = { id: ++this.serial, kind, shooter, choices, locked: false };
    this.tips.clear();
  }

  /** Nothing to tip on right now. */
  close(): void {
    this.question = null;
    this.tips.clear();
  }

  /** The shots are away: the tips are in. */
  lock(): void {
    if (this.question) this.question.locked = true;
  }

  /** Whether `pick` answers the open question. */
  accepts(pick: number): boolean {
    const q = this.question;
    if (!q || q.locked || !Number.isInteger(pick)) return false;
    return q.kind === 'shot' ? pick === TIP_HIT || pick === TIP_MISS : pick === TIP_NOBODY || q.choices.includes(pick);
  }

  /** Records a tip, replacing the player's earlier one. Whether the player may tip at all is the match's call. */
  bet(player: number, pick: number): boolean {
    if (!this.accepts(pick)) return false;
    this.tips.set(player, pick);
    return true;
  }

  /** Judges the open question. `victims` are the ships the shots destroyed, `hit` whether the shooter downed an enemy. */
  resolve(victims: number[], hit: boolean, at: number): void {
    const q = this.question;
    if (!q) return;
    const tips: OracleTip[] = [];
    for (const [player, pick] of this.tips) {
      const right = q.kind === 'shot' ? (pick === TIP_HIT) === hit : pick === TIP_NOBODY ? victims.length === 0 : victims.includes(pick);
      const score = this.scores[player];
      let points = 0;
      if (score) {
        score.total++;
        score.roundTotal++;
        if (right) {
          score.streak++;
          score.right++;
          score.roundRight++;
          const base = q.kind === 'shot' ? ORACLE.SHOT : pick === TIP_NOBODY ? ORACLE.NOBODY : ORACLE.SHIP;
          points = Math.round((base * oracleMultiplier(score.streak)) / 5) * 5;
          score.points += points;
          score.roundPoints += points;
        } else {
          score.streak = 0;
        }
      }
      tips.push({ player, pick, right, points });
    }
    this.result = { id: q.id, kind: q.kind, shooter: q.shooter, victims, hit, tips, at };
    this.close();
  }

  /** Players with at least one tip in the match, best first. */
  ranking(): { player: number; score: OracleScore }[] {
    return this.scores
      .map((score, player) => ({ player, score }))
      .filter(({ score }) => score.total > 0)
      .sort((a, b) => b.score.points - a.score.points || b.score.right - a.score.right || a.player - b.player);
  }

  /** Players with at least one tip this round, best first. */
  roundRanking(): { player: number; score: OracleScore }[] {
    return this.scores
      .map((score, player) => ({ player, score }))
      .filter(({ score }) => score.roundTotal > 0)
      .sort((a, b) => b.score.roundPoints - a.score.roundPoints || b.score.roundRight - a.score.roundRight || a.player - b.player);
  }

  /** The open tips, for the live view. */
  get picks(): ReadonlyMap<number, number> {
    return this.tips;
  }

  snapshot(): OracleSnapshot {
    return {
      question: this.question && { ...this.question, choices: [...this.question.choices] },
      result: this.result,
      scores: this.scores.map((score) => ({ ...score })),
      tips: [...this.tips],
    };
  }

  restore(snapshot: OracleSnapshot): void {
    this.question = snapshot.question && { ...snapshot.question, choices: [...snapshot.question.choices] };
    this.result = snapshot.result;
    this.scores = snapshot.scores.map((score) => ({ ...score }));
    this.tips = new Map(snapshot.tips ?? []);
  }
}
