import { BETS, FANS } from '../sim/config';

/** A bet names a ship (and so its side), or `PICK_DRAW` for a round that ends with nobody left. */
export const PICK_DRAW = -1;

/** "Who wins the round?": open for bets once somebody is out, for the rest of the round. */
export interface RoundQuestion {
  /** Rises with every question and settled bet, so a screen can tell a new one from one it already showed. */
  id: number;
  /** The ships that were still in when the question opened; a bet names one that still is. */
  choices: number[];
  /** A round can end in a draw (everybody aims at once), so a draw can be bet on too. */
  draw: boolean;
}

/** A bet on who wins the round: points of the bettor's own, on a ship (or its team), or on a draw. */
export interface Bet {
  player: number;
  pick: number;
  stake: number;
  /** What a right bet pays, the stake included: how many sides were still in when it was placed (a draw pays a fixed amount). */
  multiplier: number;
  /** What its bettor's calls on the ship's shots added to the multiplier, or took off it (`oddsOf`). */
  bonus?: number;
  /** A right "is hit" call: should the bet be lost, only part of the stake goes. */
  insured?: boolean;
}

/** What a bet pays when it is right, the stake included: its multiplier with what the calls made of it, never below `FANS.MIN_ODDS`. */
export function oddsOf(bet: Bet): number {
  return bet.bonus ? Math.max(FANS.MIN_ODDS, bet.multiplier + bet.bonus) : bet.multiplier;
}

/** What a lost bet costs: the stake, or the insured part of it, in whole steps. */
export function lossOf(bet: Bet): number {
  return bet.insured ? Math.ceil((bet.stake * FANS.INSURED) / BETS.STAKE_STEP) * BETS.STAKE_STEP : bet.stake;
}

/** A bet that has been settled: lost the moment its side was shot out, or won or lost when the round ended. */
export interface SettledBet extends Bet {
  id: number;
  won: boolean;
  /** What it did to the bettor's points: the stake times the multiplier less the stake, or minus the stake. */
  delta: number;
  at: number;
  /** A seat's place in the match before and after (the stands have none). */
  places?: [before: number, after: number];
}

export interface RoundResult {
  id: number;
  round: number;
  /** The ships that won: a lone survivor, a whole team, or nobody in a draw. */
  winners: number[];
  /** Every bet of the round, in the order it was settled. */
  bets: SettledBet[];
  at: number;
}

/** A settled bet, or a call on a shot, as the relay's statistics keep it: nobody's name, only how it came out. */
export interface TipReport {
  /** `round`: a bet on the round's winner; `shot`: a fan's call on the next shot (hits, misses, gets hit), staked nothing. */
  kind: 'shot' | 'round';
  right: boolean;
  /** The points staked and what came back (the stake included). */
  stake: number;
  payout: number;
  /** Kept for the statistics' shape; always false. */
  underdog: boolean;
  /** Placed from the stands rather than by a shot-down player. */
  stands: boolean;
}

/** One bettor's match: how their bets came out. */
export interface BetScore {
  bets: number;
  won: number;
  /** What the bets came to, all together. */
  net: number;
}

/** What travels to the guests: the question, the bets open and settled, and the standings. */
export interface BetSnapshot {
  question: RoundQuestion | null;
  placed: Bet[];
  settled: SettledBet[];
  result: RoundResult | null;
  scores: BetScore[];
}

/** A stake to choose: the share of the bettor's points it stands for, and how many points that is. */
export interface StakeOption {
  share: number;
  amount: number;
}

/**
 * The stakes a bettor with `purse` points may choose: a quarter, half or all of them, rounded down to whole steps,
 * each at least the least stake. Two shares that come to the same amount are offered once, as the larger.
 */
export function stakeOptions(purse: number): StakeOption[] {
  const all = BETS.STAKE_SHARES.map((share) => ({ share, amount: Math.floor((Math.max(0, purse) * share) / BETS.STAKE_STEP) * BETS.STAKE_STEP }));
  return all.filter((option, i) => option.amount >= BETS.STAKE_MIN && !all.slice(i + 1).some((later) => later.amount === option.amount));
}

/** What a right bet pays (the stake included): as many times the stake as there are sides still in, or the draw's fixed amount. */
export function betMultiplier(pick: number, sides: number): number {
  return pick === PICK_DRAW ? BETS.DRAW_MULTIPLIER : Math.max(2, sides);
}

const emptyScore = (): BetScore => ({ bets: 0, won: 0, net: 0 });
const scoreFrom = (score: Partial<BetScore>): BetScore => ({ ...emptyScore(), ...score });

/**
 * The bets on who wins the round. Once somebody is out, a shot-down player may bet points of their own on a
 * side — once a round — and the bet pays as many times the stake as there were sides in when it was placed.
 * It is lost the moment its side is out, and the rest are settled when the round ends. The host keeps the
 * book; every screen mirrors it from its snapshots.
 *
 * An online room keeps two: one for the shot-down players, who bet points of the match, and one for the stands,
 * who bet a bankroll of their own.
 */
export class BetBook {
  question: RoundQuestion | null = null;
  result: RoundResult | null = null;
  scores: BetScore[] = [];
  /** The side this screen has picked but not yet staked on. Display only: it never leaves the screen. */
  pending: { id: number; pick: number } | null = null;
  /** The bets of this round already settled, in order. */
  settled: SettledBet[] = [];

  /** Every bet settled in this round, and (in the shot-down players' book) every call on a shot, for the statistics (not part of a snapshot). */
  readonly judged: TipReport[] = [];

  constructor(private readonly stands = false) {}

  private serial = 0;
  /** The bets of the round not yet settled. */
  private open = new Map<number, Bet>();
  /** Standings before this round, so a skipped round can give back what it changed. */
  private roundStartScores: BetScore[] = [];

  /** A new match: fresh standings for `players` bettors (the counter keeps running). */
  reset(players: number): void {
    this.scores = Array.from({ length: players }, emptyScore);
    this.startRound();
  }

  /** Makes room in the standings for a bettor who was not there when the match began (somebody who came to watch). */
  private ensure(player: number): void {
    while (this.scores.length <= player) this.scores.push(emptyScore());
  }

  startRound(): void {
    this.question = null;
    this.result = null;
    this.pending = null;
    this.settled = [];
    this.open.clear();
    this.judged.length = 0;
    this.roundStartScores = this.scores.map(scoreFrom);
  }

  /** Undoes the standings of a round that was skipped. */
  rollbackRound(): void {
    const length = this.scores.length;
    this.scores = this.roundStartScores.map(scoreFrom);
    while (this.scores.length < length) this.scores.push(emptyScore());
  }

  /** What the settled bets of this round did to a bettor's points, all together. */
  roundDelta(player: number): number {
    return this.settled.reduce((sum, bet) => sum + (bet.player === player ? bet.delta : 0), 0);
  }

  /** Opens "who wins the round?" for the ships `choices`. A round has one; a second call changes nothing. */
  openRound(choices: number[], draw: boolean): void {
    if (this.question) return;
    this.question = { id: ++this.serial, choices: [...choices], draw };
  }

  /** Whether `pick` is a side to bet on, with `alive` the ships still in. */
  accepts(pick: number, alive: readonly number[]): boolean {
    const q = this.question;
    if (!q || !Number.isInteger(pick)) return false;
    return pick === PICK_DRAW ? q.draw : q.choices.includes(pick) && alive.includes(pick);
  }

  /** Whether this bettor can still bet this round: the question is open and they have not bet yet. A bet is made once. */
  canBet(player: number): boolean {
    return !!this.question && !this.open.has(player) && !this.settled.some((bet) => bet.player === player);
  }

  /**
   * Records a bet: `stake` points on `pick`, at as many times the stake as there are `sides` still in. Whether
   * the bettor has the points is the match's call; it takes them only if the bet is lost.
   */
  place(player: number, pick: number, stake: number, alive: readonly number[], sides: number): boolean {
    if (!this.canBet(player) || !this.accepts(pick, alive)) return false;
    if (!Number.isSafeInteger(stake) || stake < BETS.STAKE_MIN || stake % BETS.STAKE_STEP !== 0) return false;
    this.ensure(player);
    this.open.set(player, { player, pick, stake, multiplier: betMultiplier(pick, sides) });
    return true;
  }

  /** The bettor's bet on this round: open, or already settled. */
  betOf(player: number): Bet | SettledBet | undefined {
    return this.open.get(player) ?? this.settled.find((bet) => bet.player === player);
  }

  /** The bets of the round not yet settled. */
  get placed(): ReadonlyMap<number, Bet> {
    return this.open;
  }

  /** Settles the open bets whose side is out of the round (`out`): lost, at once. */
  fallen(out: (pick: number) => boolean, at: number): SettledBet[] {
    const lost = [...this.open.values()].filter((bet) => bet.pick !== PICK_DRAW && out(bet.pick));
    return lost.map((bet) => this.settle(bet, false, at));
  }

  /** The round is over: settles every open bet. `winners` are the ships that won — none in a draw. */
  resolve(winners: number[], round: number, at: number): SettledBet[] {
    const q = this.question;
    const done = [...this.open.values()].map((bet) => this.settle(bet, bet.pick === PICK_DRAW ? winners.length === 0 : winners.includes(bet.pick), at));
    if (q || this.settled.length) this.result = { id: q?.id ?? ++this.serial, round, winners, bets: [...this.settled], at };
    this.question = null;
    this.pending = null;
    return done;
  }

  /** A call on the ship bet on came out: `bonus` on the multiplier of `player`'s open bet, and with `insure` its loss halved. */
  adjust(player: number, bonus: number, insure: boolean): void {
    const bet = this.open.get(player);
    if (!bet) return;
    if (bonus) bet.bonus = (bet.bonus ?? 0) + bonus;
    if (insure) bet.insured = true;
  }

  private settle(bet: Bet, won: boolean, at: number): SettledBet {
    this.open.delete(bet.player);
    const odds = oddsOf(bet);
    const delta = won ? Math.round(bet.stake * (odds - 1)) : -lossOf(bet);
    const settled: SettledBet = { ...bet, id: ++this.serial, won, delta, at };
    this.settled.push(settled);
    this.ensure(bet.player);
    const score = this.scores[bet.player];
    score.bets++;
    if (won) score.won++;
    score.net += delta;
    this.judged.push({ kind: 'round', right: won, stake: bet.stake, payout: bet.stake + delta, underdog: false, stands: this.stands });
    return settled;
  }

  /** Bettors with at least one bet in the match, best first. */
  ranking(): { player: number; score: BetScore }[] {
    return this.scores
      .map((score, player) => ({ player, score }))
      .filter(({ score }) => score.bets > 0)
      .sort((a, b) => b.score.net - a.score.net || b.score.won - a.score.won || a.player - b.player);
  }

  snapshot(): BetSnapshot {
    return {
      question: this.question && { ...this.question, choices: [...this.question.choices] },
      placed: [...this.open.values()].map((bet) => ({ ...bet })),
      settled: this.settled.map((bet) => ({ ...bet })),
      result: this.result,
      scores: this.scores.map(scoreFrom),
    };
  }

  restore(snapshot: BetSnapshot): void {
    this.question = snapshot.question ? { ...snapshot.question, choices: [...snapshot.question.choices] } : null;
    this.open = new Map((snapshot.placed ?? []).map((bet) => [bet.player, { ...bet }]));
    this.settled = (snapshot.settled ?? []).map((bet) => ({ ...bet }));
    this.result = snapshot.result ?? null;
    this.scores = (snapshot.scores ?? []).map(scoreFrom);
    // The counter follows the host's, so a screen that becomes the host goes on from there.
    this.serial = Math.max(this.serial, this.question?.id ?? 0, this.result?.id ?? 0, ...this.settled.map((bet) => bet.id));
  }
}
