import { ORACLE } from '../sim/config';

/** What a tip is about: one shot ("will it hit?", turn by turn) or a whole salvo ("who gets hit?"). */
export type OracleKind = 'shot' | 'salvo';

/** Picks for a shot; a salvo pick is a ship's index, or `TIP_NOBODY`. */
export const TIP_MISS = 0;
export const TIP_HIT = 1;
export const TIP_NOBODY = -1;
/** What a tip looks like to everybody else until the shots are away: face down. */
export const TIP_HIDDEN = -2;

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

/** "Who wins the round?" — opens once somebody is out, stays open for the rest of the round, and is judged when it ends. */
export interface RoundQuestion {
  id: number;
  kind: 'winner';
  /** The ships that were still in when the question opened; a tip names one that still is. */
  choices: number[];
  /** A round can end in a draw (everybody aims at once), so "nobody" is an answer too. */
  draw: boolean;
}

/** How the tipsters were split, when it is worth a remark: the majority was wrong ("fooled"), or everybody agreed and was right. */
export type Crowd = 'wrong' | 'right';

export interface OracleTip {
  player: number;
  pick: number;
  right: boolean;
  points: number;
  /** Right against the crowd: fewer than half of the tipsters named the same, and it was this one. */
  underdog?: boolean;
  /** A bet on the round question: what was staked, and what comes back (the stake itself included; 0 when it is lost). */
  stake?: number;
  payout?: number;
}

/** A judged tip as the relay's statistics keep it: nobody's name, only how it came out. */
export interface TipReport {
  /** A single shot's hit/miss tip or a salvo question (`shot`), or the round's winner (`round`). */
  kind: 'shot' | 'round';
  right: boolean;
  /** A bet on the round: the points staked and what came back (the stake included); 0 and 0 for a plain tip. */
  stake: number;
  payout: number;
  underdog: boolean;
  /** Placed from the stands rather than by a shot-down player. */
  stands: boolean;
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
  crowd?: Crowd;
  /** Match clock when the verdict fell. */
  at: number;
}

export interface RoundResult {
  id: number;
  kind: 'winner';
  round: number;
  /** The ships that won: a lone survivor, a whole team, or nobody in a draw. */
  winners: number[];
  tips: OracleTip[];
  crowd?: Crowd;
  at: number;
}

/** The little things the awards are made of. Kept for the whole match and, separately, for the round. */
export interface OracleTally {
  /** The longest run of right tips. */
  bestStreak: number;
  /** The longest run of wrong tips. */
  worstRun: number;
  /** Tips on single shots: "hit" and "miss". */
  hitTips: number;
  missTips: number;
  /** Right tips against the crowd. */
  underdogs: number;
}

export interface OracleScore {
  /** The whole match. */
  points: number;
  right: number;
  total: number;
  /** Right tips in a row; a wrong one ends it, no tip leaves it alone. */
  streak: number;
  /** Wrong tips in a row. */
  wrongRun: number;
  /** This round only — for the scorecard. */
  roundPoints: number;
  roundRight: number;
  roundTotal: number;
  stats: OracleTally;
  roundStats: OracleTally;
}

/**
 * What travels to the guests. The open tips come along face down — who has tipped, not what — so the
 * eliminated players cannot copy each other; they are turned over when the shots are away.
 */
export interface OracleSnapshot {
  question: OracleQuestion | null;
  result: OracleResult | null;
  scores: OracleScore[];
  /** Who tipped on the open question, as [player, pick] pairs. Picks are `TIP_HIDDEN` until the question is locked. Hosts from before live tips send none. */
  tips?: [player: number, pick: number][];
  /** How the eliminated lean on an open shot: [hit, miss] tips. The living feel it as the ghosts' mood. */
  mood?: [hit: number, miss: number] | null;
  round?: RoundQuestion | null;
  roundResult?: RoundResult | null;
  /** Who tipped on the round question; picks stay `TIP_HIDDEN` until the round is over. */
  roundTips?: [player: number, pick: number][];
  /** What the eliminated have staked on the round question, as [player, stake] pairs. */
  roundStakes?: [player: number, stake: number][];
  /** The stands' book only: how much is staked on each pick, as [pick, stake] pairs — the odds are made of it. */
  pools?: [pick: number, stake: number][];
}

/** What a ghost with `score` points may stake on the round question: half of the allowed most, and the most; none if it is not worth it. */
export function stakeOptions(score: number): number[] {
  const most = Math.floor((Math.max(0, score) * ORACLE.STAKE_SHARE) / ORACLE.STAKE_STEP) * ORACLE.STAKE_STEP;
  if (most < ORACLE.STAKE_MIN) return [];
  const half = Math.floor(most / 2 / ORACLE.STAKE_STEP) * ORACLE.STAKE_STEP;
  return half >= ORACLE.STAKE_MIN && half < most ? [half, most] : [most];
}

const emptyTally = (): OracleTally => ({ bestStreak: 0, worstRun: 0, hitTips: 0, missTips: 0, underdogs: 0 });
const emptyScore = (): OracleScore => ({ points: 0, right: 0, total: 0, streak: 0, wrongRun: 0, roundPoints: 0, roundRight: 0, roundTotal: 0, stats: emptyTally(), roundStats: emptyTally() });
/** A score as a host of any age sent it: whatever is missing starts from zero. */
const scoreFrom = (score: Partial<OracleScore>): OracleScore => ({ ...emptyScore(), ...score, stats: { ...emptyTally(), ...score.stats }, roundStats: { ...emptyTally(), ...score.roundStats } });

/** The multiplier a right tip earns as the `streak`-th in a row. */
export function oracleMultiplier(streak: number): number {
  return Math.min(ORACLE.MAX_MULTIPLIER, 1 + ORACLE.STREAK_STEP * Math.max(0, streak - 1));
}

/** One tip, as the judging sees it. */
interface Entry {
  player: number;
  pick: number;
  right: boolean;
  /** Points before the streak multiplier. */
  base: number;
  /** A single shot's hit/miss tip, which the awards count. */
  shot: boolean;
}

/**
 * The tipping game for eliminated players. It only watches the match — questions open when a shot or
 * a salvo is about to be aimed, close when it is fired, and are judged from what the shots did.
 * One more question runs alongside for the whole round: who wins it.
 * The host judges; every screen mirrors the verdict and the standings from its snapshots.
 *
 * The same game is played twice in an online room: by the shot-down players, and by the stands (people
 * watching without a ship). Each has an oracle of its own, so their pots never mix. The stands' one has an
 * open book (`publicBook`): what is staked on each pick is shown to everybody, because the odds come from it.
 */
export class Oracle {
  question: OracleQuestion | null = null;
  result: OracleResult | null = null;
  scores: OracleScore[] = [];
  roundQuestion: RoundQuestion | null = null;
  roundResult: RoundResult | null = null;
  /** This screen's own tip on the open question. Display only: it never leaves the screen. */
  mine: { id: number; pick: number } | null = null;
  /** …and on the round question. */
  roundMine: { id: number; pick: number } | null = null;

  /** Every tip judged in this round, for the statistics (not part of a snapshot). */
  readonly judged: TipReport[] = [];

  /** The stakes on each pick of the round question as the host sent them; null where this oracle works them out itself. */
  private sharedPools: Map<number, number> | null = null;

  constructor(private readonly publicBook = false) {}

  /** Whether what is staked on each pick is common knowledge (the stands) or secret until the round is over (the shot-down). */
  get openBook(): boolean {
    return this.publicBook;
  }

  private serial = 0;
  /** Who tipped what on the open question: the host's book. Guests only ever hold the faces-down copy. */
  private tips = new Map<number, number>();
  /** Who tipped what on the round question, and how many sides — lone ships or whole teams — were still in at that moment (the more, the better the odds against). */
  private roundTips = new Map<number, { pick: number; sides: number }>();
  /** What every bettor has staked on the round question. The stake is out of the player's score until the round is over. */
  private roundStakes = new Map<number, number>();
  /** Oracle standings before this round, so a skipped round can give back every point and honour it earned. */
  private roundStartScores: OracleScore[] = [];
  /** [hit, miss] on the open shot question. */
  private heard: [number, number] = [0, 0];

  /** A new match: fresh standings for `players` ships (the question counter keeps running). */
  reset(players: number): void {
    this.question = null;
    this.result = null;
    this.roundQuestion = null;
    this.roundResult = null;
    this.mine = null;
    this.roundMine = null;
    this.tips.clear();
    this.roundTips.clear();
    this.roundStakes.clear();
    this.judged.length = 0;
    this.recount();
    this.sharedPools = null;
    this.scores = Array.from({ length: players }, emptyScore);
    this.roundStartScores = this.copyScores(this.scores);
  }

  /** Makes room in the standings for a bettor who was not there when the match began (somebody who came to watch). */
  private ensure(player: number): void {
    while (this.scores.length <= player) this.scores.push(emptyScore());
  }

  startRound(): void {
    this.question = null;
    this.roundQuestion = null;
    this.roundResult = null;
    this.mine = null;
    this.roundMine = null;
    this.tips.clear();
    this.roundTips.clear();
    this.roundStakes.clear();
    this.sharedPools = null;
    this.judged.length = 0;
    this.recount();
    for (const score of this.scores) {
      score.roundPoints = 0;
      score.roundRight = 0;
      score.roundTotal = 0;
      score.roundStats = emptyTally();
    }
    this.roundStartScores = this.copyScores(this.scores);
  }

  /** Undo oracle points, streaks, totals and honours earned during a round that was skipped. */
  rollbackRound(): void {
    const length = this.scores.length;
    this.scores = this.copyScores(this.roundStartScores);
    while (this.scores.length < length) this.scores.push(emptyScore());
  }

  private copyScores(scores: readonly OracleScore[]): OracleScore[] {
    return scores.map((score) => ({ ...score, stats: { ...score.stats }, roundStats: { ...score.roundStats } }));
  }

  open(kind: OracleKind, shooter: number, choices: number[]): void {
    this.question = { id: ++this.serial, kind, shooter, choices, locked: false };
    this.tips.clear();
    this.recount();
  }

  /** Nothing to tip on right now. */
  close(): void {
    this.question = null;
    this.tips.clear();
    this.recount();
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
    this.ensure(player);
    this.tips.set(player, pick);
    this.recount();
    return true;
  }

  /** Judges the open question. `victims` are the ships the shots destroyed, `hit` whether the shooter downed an enemy. */
  resolve(victims: number[], hit: boolean, at: number): void {
    const q = this.question;
    if (!q) return;
    const entries: Entry[] = [...this.tips].map(([player, pick]) => {
      const right = q.kind === 'shot' ? (pick === TIP_HIT) === hit : pick === TIP_NOBODY ? victims.length === 0 : victims.includes(pick);
      const base = q.kind === 'shot' ? ORACLE.SHOT : pick === TIP_NOBODY ? ORACLE.NOBODY : ORACLE.SHIP;
      return { player, pick, right, base, shot: q.kind === 'shot' };
    });
    this.result = { id: q.id, kind: q.kind, shooter: q.shooter, victims, hit, ...this.settle(entries), at };
    this.keep('shot', this.result.tips);
    this.close();
  }

  // ————————————————————————————— The round question —————————————————————————————

  /** Opens "who wins the round?" for the ships `choices`. A round has one; a second call changes nothing. */
  openRound(choices: number[], draw: boolean): void {
    if (this.roundQuestion) return;
    this.roundQuestion = { id: ++this.serial, kind: 'winner', choices: [...choices], draw };
  }

  /** Whether `pick` answers the round question, with `alive` the ships still in. */
  acceptsRound(pick: number, alive: readonly number[]): boolean {
    const q = this.roundQuestion;
    if (!q || !Number.isInteger(pick)) return false;
    return pick === TIP_NOBODY ? q.draw : q.choices.includes(pick) && alive.includes(pick);
  }

  /**
   * Records a tip on the round question, replacing the player's earlier one — until a stake rides on it.
   * What it pays depends on how many sides are in now: ships in a free for all, teams in a team match
   * (`sides`; the ships still in when it is left out).
   */
  betRound(player: number, pick: number, alive: readonly number[], sides = alive.length): boolean {
    if (!this.acceptsRound(pick, alive)) return false;
    if (this.roundStakes.has(player)) return this.roundTips.get(player)?.pick === pick;
    this.ensure(player);
    this.roundTips.set(player, { pick, sides });
    return true;
  }

  /** Whether this player has a tip on the round question and has not staked on it yet: a stake is made once. */
  canStake(player: number): boolean {
    return !!this.roundQuestion && this.roundTips.has(player) && !this.roundStakes.has(player);
  }

  /** Records a stake on the player's tip on the round question. Whether the player has the points is the match's call. */
  setStake(player: number, stake: number): boolean {
    if (!this.canStake(player) || !Number.isSafeInteger(stake) || stake < ORACLE.STAKE_MIN || stake % ORACLE.STAKE_STEP !== 0) return false;
    this.roundStakes.set(player, stake);
    return true;
  }

  /** What a player has staked on the round question; 0 for no bet. */
  stakeOf(player: number): number {
    return this.roundStakes.get(player) ?? 0;
  }

  /** All the stakes on the round question: the pot. */
  get pot(): number {
    let sum = 0;
    for (const stake of this.roundStakes.values()) sum += stake;
    return sum;
  }

  /** What is staked on each pick of the round question. */
  get pools(): ReadonlyMap<number, number> {
    if (this.sharedPools) return this.sharedPools;
    const out = new Map<number, number>();
    for (const [player, stake] of this.roundStakes) {
      const pick = this.roundTips.get(player)?.pick;
      if (pick !== undefined) out.set(pick, (out.get(pick) ?? 0) + stake);
    }
    return out;
  }

  /**
   * What a point on `pick` pays if it wins, as things stand (the stake included): the pot over everything staked
   * on the same side — `sideOf` says which ships share a side, the members of a team. Null while nobody has backed it.
   */
  oddsFor(pick: number, sideOf: (pick: number) => number): number | null {
    const side = pick === TIP_NOBODY ? TIP_NOBODY : sideOf(pick);
    let staked = 0;
    for (const [p, stake] of this.pools) if ((p === TIP_NOBODY ? TIP_NOBODY : sideOf(p)) === side) staked += stake;
    return staked > 0 ? this.pot / staked : null;
  }

  /** Stakes taken and not yet paid out, for a round that is cut short. */
  get stakes(): ReadonlyMap<number, number> {
    return this.roundStakes;
  }

  /** The round is over: judges the round question. `winners` are the ships that won — none in a draw. */
  resolveRound(winners: number[], round: number, at: number): void {
    const q = this.roundQuestion;
    if (!q) return;
    const entries: Entry[] = [...this.roundTips].map(([player, { pick, sides }]) => {
      const right = pick === TIP_NOBODY ? winners.length === 0 : winners.includes(pick);
      const base = pick === TIP_NOBODY ? ORACLE.DRAW : ORACLE.WINNER * Math.max(1, sides - 1);
      return { player, pick, right, base, shot: false };
    });
    const settled = this.settle(entries);
    this.shareThePot(settled.tips);
    this.roundResult = { id: q.id, kind: 'winner', round, winners, ...settled, at };
    this.keep('round', settled.tips);
    this.roundQuestion = null;
    this.roundTips.clear();
    this.roundStakes.clear();
    this.sharedPools = null;
  }

  /**
   * The stakes of the round make one pot; whoever tipped right shares it in proportion to their stakes,
   * the rest lose theirs. With nobody right, or only right tips, there is nothing to share and everybody
   * gets their stake back. Pays in steps of `STAKE_STEP`; the steps that do not divide evenly go, one
   * each, to the largest shares first — the whole pot is paid out, none of it is lost on the way.
   */
  private shareThePot(tips: OracleTip[]): void {
    const pot = this.pot;
    const winners = tips.filter((tip) => tip.right && this.stakeOf(tip.player) > 0);
    const right = winners.reduce((sum, tip) => sum + this.stakeOf(tip.player), 0);
    const refund = right === 0 || right === pot;
    const steps = pot / ORACLE.STAKE_STEP;
    // Whole steps of the pot per winner, and what is left of each share after them.
    const shares = winners.map((tip) => {
      const exact = (steps * this.stakeOf(tip.player)) / right;
      return { tip, whole: Math.floor(exact), rest: exact - Math.floor(exact) };
    });
    let left = steps - shares.reduce((sum, share) => sum + share.whole, 0);
    for (const share of [...shares].sort((a, b) => b.rest - a.rest)) {
      if (left <= 0) break;
      share.whole++;
      left--;
    }
    for (const tip of tips) {
      const stake = this.stakeOf(tip.player);
      if (!stake) continue;
      tip.stake = stake;
      tip.payout = refund ? stake : (shares.find((share) => share.tip === tip)?.whole ?? 0) * ORACLE.STAKE_STEP;
    }
  }

  private keep(kind: TipReport['kind'], tips: readonly OracleTip[]): void {
    for (const tip of tips) this.judged.push({ kind, right: tip.right, stake: tip.stake ?? 0, payout: tip.payout ?? 0, underdog: !!tip.underdog, stands: this.publicBook });
  }

  /** Books a question's tips: the points, the streaks, the tallies the awards come from. */
  private settle(entries: Entry[]): { tips: OracleTip[]; crowd?: Crowd } {
    const sameAs = (pick: number) => entries.filter((e) => e.pick === pick).length;
    const tips = entries.map((entry): OracleTip => {
      const { player, pick, right } = entry;
      // Right while fewer than half of the others agreed: not a lucky guess with the herd.
      const underdog = right && entries.length >= ORACLE.UNDERDOG_MIN_TIPS && sameAs(pick) * 2 < entries.length;
      const score = this.scores[player];
      let points = 0;
      if (score) {
        const tallies = [score.stats, score.roundStats];
        score.total++;
        score.roundTotal++;
        if (entry.shot) for (const tally of tallies) (pick === TIP_HIT ? tally.hitTips++ : tally.missTips++);
        if (right) {
          score.streak++;
          score.wrongRun = 0;
          score.right++;
          score.roundRight++;
          points = Math.round((entry.base * oracleMultiplier(score.streak)) / 5) * 5 + (underdog ? ORACLE.UNDERDOG : 0);
          score.points += points;
          score.roundPoints += points;
          for (const tally of tallies) {
            tally.bestStreak = Math.max(tally.bestStreak, score.streak);
            if (underdog) tally.underdogs++;
          }
        } else {
          score.streak = 0;
          score.wrongRun++;
          for (const tally of tallies) tally.worstRun = Math.max(tally.worstRun, score.wrongRun);
        }
      }
      return { player, pick, right, points, ...(underdog ? { underdog } : {}) };
    });

    // The biggest group of tipsters, if it holds more than half of them.
    const lead = entries.find((e) => sameAs(e.pick) * 2 > entries.length);
    let crowd: Crowd | undefined;
    if (lead && entries.length >= 2) {
      if (!lead.right) crowd = 'wrong';
      else if (entries.length >= ORACLE.UNDERDOG_MIN_TIPS && sameAs(lead.pick) === entries.length) crowd = 'right';
    }
    return crowd ? { tips, crowd } : { tips };
  }

  // ————————————————————————————— Standings —————————————————————————————

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

  // ————————————————————————————— What the screens see —————————————————————————————

  /** The open tips as everybody sees them: who has tipped, and — once the shots are away — what. */
  get picks(): ReadonlyMap<number, number> {
    if (this.question?.locked) return this.tips;
    return new Map([...this.tips.keys()].map((player) => [player, TIP_HIDDEN]));
  }

  /** Who has tipped on the round question. What they tipped stays face down until the round is over. */
  get roundTippers(): ReadonlySet<number> {
    return new Set(this.roundTips.keys());
  }

  /** How the eliminated lean on the open shot — null while none of them has tipped. */
  get mood(): { hit: number; miss: number } | null {
    const [hit, miss] = this.heard;
    return this.question?.kind === 'shot' && hit + miss > 0 ? { hit, miss } : null;
  }

  private recount(): void {
    const q = this.question;
    let hit = 0;
    let miss = 0;
    if (q?.kind === 'shot') for (const pick of this.tips.values()) (pick === TIP_HIT ? hit++ : miss++);
    this.heard = [hit, miss];
  }

  snapshot(): OracleSnapshot {
    return {
      question: this.question && { ...this.question, choices: [...this.question.choices] },
      result: this.result,
      scores: this.scores.map((score) => scoreFrom(score)),
      tips: [...this.picks],
      mood: this.mood && [this.mood.hit, this.mood.miss],
      round: this.roundQuestion && { ...this.roundQuestion, choices: [...this.roundQuestion.choices] },
      roundResult: this.roundResult,
      roundTips: [...this.roundTips.keys()].map((player) => [player, TIP_HIDDEN]),
      roundStakes: [...this.roundStakes],
      ...(this.publicBook ? { pools: [...this.pools] } : {}),
    };
  }

  restore(snapshot: OracleSnapshot): void {
    this.question = snapshot.question && { ...snapshot.question, choices: [...snapshot.question.choices] };
    this.result = snapshot.result;
    this.scores = snapshot.scores.map(scoreFrom);
    this.tips = new Map(snapshot.tips ?? []);
    this.heard = snapshot.mood ?? [0, 0];
    this.roundQuestion = snapshot.round ? { ...snapshot.round, choices: [...snapshot.round.choices] } : null;
    this.roundResult = snapshot.roundResult ?? null;
    this.roundTips = new Map((snapshot.roundTips ?? []).map(([player, pick]) => [player, { pick, sides: 0 }]));
    this.roundStakes = new Map(snapshot.roundStakes ?? []);
    this.sharedPools = snapshot.pools ? new Map(snapshot.pools) : null;
  }
}

// ————————————————————————————— Awards —————————————————————————————

export type OracleAwardKind = 'prophet' | 'seer' | 'wolf' | 'optimist' | 'pessimist' | 'unlucky';

export interface OracleAward {
  kind: OracleAwardKind;
  player: number;
  /** Points, a run of tips, or a count of tips — whatever the award is for. */
  value: number;
}

/** The least an award takes, in the round and in the match. */
const AWARD_MIN = {
  seer: { round: 2, match: 3 },
  wolf: { round: 1, match: 2 },
  lean: { round: 3, match: 5 },
  unlucky: { round: 3, match: 4 },
} as const;

/** How one-sided a player's hit/miss tips must be to make an optimist or a pessimist. */
const LEAN_SHARE = 0.75;

/** The index of the one clear best value, if it reaches `min`; a tie for the top gives nobody the award. */
function clearBest(values: number[], min: number): number {
  const top = Math.max(...values);
  if (!(top >= min) || values.filter((v) => v === top).length > 1) return -1;
  return values.indexOf(top);
}

/**
 * The tipsters' honours for the round or the match: the prophet (most points), the seer (longest run of
 * right tips), the lone wolf (right against the crowd), the optimist and the pessimist (always "hit",
 * always "miss") and the unlucky one (longest run of wrong tips). Only a clear winner gets one.
 */
export function oracleAwards(scores: readonly OracleScore[], scope: 'round' | 'match'): OracleAward[] {
  const tallies = scores.map((score) => (scope === 'round' ? score.roundStats : score.stats));
  const points = scores.map((score) => (scope === 'round' ? score.roundPoints : score.points));
  const out: OracleAward[] = [];
  const give = (kind: OracleAwardKind, values: number[], min: number) => {
    const player = clearBest(values, min);
    if (player >= 0) out.push({ kind, player, value: values[player] });
  };
  give('prophet', points, 1);
  give('seer', tallies.map((t) => t.bestStreak), AWARD_MIN.seer[scope]);
  give('wolf', tallies.map((t) => t.underdogs), AWARD_MIN.wolf[scope]);
  const lean = AWARD_MIN.lean[scope];
  const leaning = (pick: 'hitTips' | 'missTips') => tallies.map((t) => (t[pick] >= lean && t[pick] / (t.hitTips + t.missTips) >= LEAN_SHARE ? t[pick] : 0));
  give('optimist', leaning('hitTips'), lean);
  give('pessimist', leaning('missTips'), lean);
  give('unlucky', tallies.map((t) => t.worstRun), AWARD_MIN.unlucky[scope]);
  return out;
}
