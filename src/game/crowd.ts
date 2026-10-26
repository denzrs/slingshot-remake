import { GALLERY } from '../sim/config';

/** One person in the stands, with the points they bet with. Those who leave keep their line until the match is over. */
export interface CrowdSeat {
  id: number;
  name: string;
  /** What they can still stake: their own, never a player's. */
  balance: number;
  /** Still watching. */
  present: boolean;
}

/**
 * The people watching an online room, and what each has to bet with. The bets themselves are the stands'
 * oracle's (`Match.stands`), which plays the same tipping game the shot-down players play; this only keeps
 * who is there and their bankrolls. The host keeps it, and every screen mirrors it.
 */
export class Crowd {
  seats: CrowdSeat[] = [];

  seat(id: number | null): CrowdSeat | undefined {
    return id === null ? undefined : this.seats.find((seat) => seat.id === id);
  }

  /** Somebody is in the stands right now. */
  get watching(): boolean {
    return this.seats.some((seat) => seat.present);
  }

  /** A new match: everybody who is still here starts again with the full bankroll. */
  reset(): void {
    this.seats = this.seats.filter((seat) => seat.present).map((seat) => ({ ...seat, balance: GALLERY.BANKROLL }));
  }

  /** The people in the stands now, from the room: newcomers get the bankroll, those who left stay on the list. */
  sync(people: readonly { id: number; name: string }[]): void {
    for (const seat of this.seats) seat.present = people.some((person) => person.id === seat.id);
    for (const { id, name } of people) {
      const seat = this.seat(id);
      if (seat) seat.name = name;
      else this.seats.push({ id, name, balance: GALLERY.BANKROLL, present: true });
    }
  }

  /** Somebody who is nearly broke starts the round with a little more, so they can keep betting. */
  relief(): void {
    for (const seat of this.seats) if (seat.present) seat.balance = Math.max(seat.balance, GALLERY.RELIEF);
  }

  snapshot(): CrowdSeat[] {
    return this.seats.map((seat) => ({ ...seat }));
  }

  restore(seats: CrowdSeat[] | undefined): void {
    this.seats = (seats ?? []).map((seat) => ({ ...seat }));
  }
}
