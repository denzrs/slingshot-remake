import { GALLERY } from '../config';

/** A round with nobody left standing: the pick for "a draw". */
export const PICK_DRAW = -1;

/** One person in the stands, with their own points. Those who leave keep their line for the final standings. */
export interface GallerySeat {
  id: number;
  name: string;
  balance: number;
  /** Still watching. */
  present: boolean;
  /** Bets placed, and how many of them won. */
  bets: number;
  right: number;
  /** Winning bets in a row. */
  streak: number;
  bestStreak: number;
}

export interface GalleryBet {
  /** A ship's index, or `PICK_DRAW`. */
  pick: number;
  stake: number;
}

/** "Who wins the round?" for the stands: open from the start of the round until the first shot is away. */
export interface GalleryBook {
  round: number;
  open: boolean;
  /** The ships that may be backed. */
  choices: number[];
  /** A round can end with nobody standing (everybody aims at once): backing a draw is allowed too. */
  draw: boolean;
  /** Which side each ship is on — its team, or itself in a free for all. Teammates win and lose together, so they share their odds. */
  sides: number[];
}

export interface GalleryPayout {
  id: number;
  pick: number;
  stake: number;
  /** What comes back: the stake plus the winnings, 0 when lost. */
  payout: number;
}

export interface GalleryResult {
  round: number;
  winners: number[];
  payouts: GalleryPayout[];
}

export interface GallerySnapshot {
  seats: GallerySeat[];
  book: GalleryBook | null;
  bets: [id: number, pick: number, stake: number][];
  result: GalleryResult | null;
}

/** What the crowd has put on one side. */
export interface Pool {
  stake: number;
  bettors: number;
}

/** The stakes a person with `balance` may choose from. A last few points can always go all in. */
export function galleryStakes(balance: number): number[] {
  const options = GALLERY.STAKES.filter((stake) => stake <= balance);
  return options.length || balance <= 0 ? options : [Math.floor(balance)];
}

const newSeat = (id: number, name: string): GallerySeat => ({ id, name, balance: GALLERY.BANKROLL, present: true, bets: 0, right: 0, streak: 0, bestStreak: 0 });

/**
 * The bets of the stands on who wins the round, with the odds the crowd makes: every stake goes into one
 * pot, and whoever backed the winning side shares all of it in proportion to their stakes. A side nobody
 * backed pays nothing; if the winner was not backed at all, or only winners put money in, everybody gets
 * their stake back. So the odds are never set by anybody — they are what people have guessed.
 *
 * The host judges; every screen mirrors the book and the standings from its snapshots. The bets are not
 * hidden: the odds are made of them, and they carry nothing the players could use.
 */
export class Gallery {
  seats: GallerySeat[] = [];
  book: GalleryBook | null = null;
  result: GalleryResult | null = null;
  private bets = new Map<number, GalleryBet>();

  /** Somebody is in the stands right now. */
  get watching(): boolean {
    return this.seats.some((seat) => seat.present);
  }

  get isOpen(): boolean {
    return !!this.book?.open;
  }

  /** A new match: everybody's points start again. */
  reset(): void {
    this.bets.clear();
    this.book = null;
    this.result = null;
    this.seats = this.seats.filter((seat) => seat.present).map((seat) => newSeat(seat.id, seat.name));
  }

  /** The people in the stands now, from the room: newcomers get their bankroll, those who left stay on the board. */
  sync(people: readonly { id: number; name: string }[]): void {
    for (const seat of this.seats) seat.present = people.some((person) => person.id === seat.id);
    for (const { id, name } of people) {
      const seat = this.seats.find((s) => s.id === id);
      if (seat) seat.name = name;
      else this.seats.push(newSeat(id, name));
    }
    // A bet of somebody who walked out stays in the pot; the points are theirs on the board, not on their screen.
  }

  /** A round begins: any stake that was never settled goes back, and the book opens. `sides[i]` is ship i's team (or i). */
  openBook(round: number, choices: number[], draw: boolean, sides: number[]): void {
    this.refundAll();
    for (const seat of this.seats) if (seat.present) seat.balance = Math.max(seat.balance, GALLERY.RELIEF);
    this.result = null;
    this.book = { round, open: true, choices: [...choices], draw, sides: [...sides] };
  }

  /** The first shot is away: no more bets. */
  close(): void {
    if (this.book) this.book.open = false;
  }

  /** What `id` has on the table. */
  betOf(id: number): GalleryBet | null {
    return this.bets.get(id) ?? null;
  }

  /** Whether `id` may bet `stake` on `pick` right now. A new bet replaces the old one, so the old stake counts as theirs again. */
  accepts(id: number, pick: number, stake: number): boolean {
    const book = this.book;
    const seat = this.seats.find((s) => s.id === id);
    if (!book?.open || !seat?.present || !Number.isSafeInteger(pick) || !Number.isSafeInteger(stake)) return false;
    if (!(pick === PICK_DRAW ? book.draw : book.choices.includes(pick))) return false;
    return galleryStakes(seat.balance + (this.bets.get(id)?.stake ?? 0)).includes(stake);
  }

  /** Places a bet; the stake leaves the balance at once. */
  bet(id: number, pick: number, stake: number): boolean {
    if (!this.accepts(id, pick, stake)) return false;
    this.refund(id);
    const seat = this.seats.find((s) => s.id === id)!;
    seat.balance -= stake;
    this.bets.set(id, { pick, stake });
    return true;
  }

  private refund(id: number): void {
    const bet = this.bets.get(id);
    const seat = this.seats.find((s) => s.id === id);
    if (bet && seat) seat.balance += bet.stake;
    this.bets.delete(id);
  }

  private refundAll(): void {
    for (const id of [...this.bets.keys()]) this.refund(id);
  }

  // ————————————————————————————— The odds —————————————————————————————

  private sideOf(pick: number): number {
    return pick === PICK_DRAW ? PICK_DRAW : (this.book?.sides[pick] ?? pick);
  }

  /** Everything staked this round. */
  get pot(): number {
    let sum = 0;
    for (const bet of this.bets.values()) sum += bet.stake;
    return sum;
  }

  /** What the crowd has staked on `pick`'s side — its team, in a team match. */
  pool(pick: number): Pool {
    const side = this.sideOf(pick);
    let stake = 0;
    let bettors = 0;
    for (const bet of this.bets.values()) {
      if (this.sideOf(bet.pick) !== side) continue;
      stake += bet.stake;
      bettors++;
    }
    return { stake, bettors };
  }

  /** What one point on `pick` pays if it wins, stake included, as things stand; null while nobody has backed it. */
  odds(pick: number): number | null {
    const { stake } = this.pool(pick);
    return stake > 0 ? this.pot / stake : null;
  }

  /** The share of the pot on `pick`'s side, 0 to 1. */
  share(pick: number): number {
    const pot = this.pot;
    return pot > 0 ? this.pool(pick).stake / pot : 0;
  }

  // ————————————————————————————— The verdict —————————————————————————————

  /** The round is over: `winners` are the ships that won — none in a draw. Pays out the pot. */
  resolve(winners: number[]): void {
    const book = this.book;
    if (!book) return;
    const winningSides = new Set(winners.length ? winners.map((w) => this.sideOf(w)) : [PICK_DRAW]);
    const entries = [...this.bets].map(([id, bet]) => ({ id, ...bet, won: winningSides.has(this.sideOf(bet.pick)) }));
    const pot = entries.reduce((sum, e) => sum + e.stake, 0);
    const right = entries.filter((e) => e.won).reduce((sum, e) => sum + e.stake, 0);
    const refund = right === 0 || right === pot;
    // Whole points of the pot per winner, and the points that did not divide evenly go to the biggest remainders: none is lost.
    const shares = entries.filter((e) => e.won).map((e) => ({ e, whole: Math.floor((pot * e.stake) / right), rest: ((pot * e.stake) / right) % 1 }));
    let left = pot - shares.reduce((sum, s) => sum + s.whole, 0);
    for (const share of [...shares].sort((a, b) => b.rest - a.rest)) {
      if (left <= 0) break;
      share.whole++;
      left--;
    }
    const payouts = entries.map((e): GalleryPayout => ({ id: e.id, pick: e.pick, stake: e.stake, payout: refund ? e.stake : (shares.find((s) => s.e === e)?.whole ?? 0) }));
    for (const [i, payout] of payouts.entries()) {
      const seat = this.seats.find((s) => s.id === payout.id);
      if (!seat) continue;
      seat.balance += payout.payout;
      seat.bets++;
      if (entries[i].won) {
        seat.right++;
        seat.streak++;
        seat.bestStreak = Math.max(seat.bestStreak, seat.streak);
      } else seat.streak = 0;
    }
    this.result = { round: book.round, winners: [...winners], payouts };
    this.bets.clear();
    this.book = null;
  }

  /** The standings, richest first. */
  ranking(): GallerySeat[] {
    return [...this.seats].sort((a, b) => b.balance - a.balance || b.right - a.right || a.id - b.id);
  }

  snapshot(): GallerySnapshot {
    return {
      seats: this.seats.map((seat) => ({ ...seat })),
      book: this.book && { ...this.book, choices: [...this.book.choices], sides: [...this.book.sides] },
      bets: [...this.bets].map(([id, bet]) => [id, bet.pick, bet.stake]),
      result: this.result,
    };
  }

  restore(snapshot: GallerySnapshot | undefined): void {
    this.seats = (snapshot?.seats ?? []).map((seat) => ({ ...seat }));
    this.book = snapshot?.book ? { ...snapshot.book, choices: [...snapshot.book.choices], sides: [...snapshot.book.sides] } : null;
    this.bets = new Map((snapshot?.bets ?? []).map(([id, pick, stake]) => [id, { pick, stake }]));
    this.result = snapshot?.result ?? null;
  }
}
