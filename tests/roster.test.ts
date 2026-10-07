import { describe, expect, it } from 'vitest';
import { activeSeats, addSeat, balanceTeams, cloneSettings, DEFAULT_SETTINGS, freeSeat, MIN_SEATS, removeSeat, seatTeamsFor, teamCounts, type Seat, type Settings } from '../src/settings';

const lineup = (seats: Seat[], over: Partial<Settings> = {}): Settings => cloneSettings({ ...DEFAULT_SETTINGS, ...over, seats: [...seats, ...Array<Seat>(6 - seats.length).fill('off')] });

describe('the line-up', () => {
  it('starts with two humans', () => {
    expect(activeSeats(DEFAULT_SETTINGS)).toEqual([0, 1]);
  });

  it('puts a new ship into the first free seat', () => {
    const s = lineup(['human', 'human']);
    expect(addSeat(s, 'medium')).toBe(2);
    expect(s.seats.slice(0, 3)).toEqual(['human', 'human', 'medium']);
  });

  it('fills a gap before it reaches for the end', () => {
    const s = lineup(['human', 'off', 'human', 'easy']);
    expect(freeSeat(s)).toBe(1);
    expect(addSeat(s, 'human')).toBe(1);
  });

  it('stops at six ships', () => {
    const s = lineup(['human', 'human', 'human', 'human', 'human', 'human']);
    expect(freeSeat(s)).toBeNull();
    expect(addSeat(s, 'human')).toBeNull();
    expect(activeSeats(s)).toHaveLength(6);
  });

  it('takes a ship out, but never below the two a match needs', () => {
    const s = lineup(['human', 'easy', 'hard']);
    expect(removeSeat(s, 1)).toBe(true);
    expect(s.seats[1]).toBe('off');
    expect(activeSeats(s)).toHaveLength(MIN_SEATS);
    expect(removeSeat(s, 0)).toBe(false);
    expect(removeSeat(s, 2)).toBe(false);
    expect(activeSeats(s)).toEqual([0, 2]);
  });

  it('has nothing to take out of an empty seat', () => {
    const s = lineup(['human', 'human', 'human']);
    expect(removeSeat(s, 5)).toBe(false);
  });
});

describe('teams', () => {
  it('count the ships of each team', () => {
    const s = lineup(['human', 'human', 'human', 'human'], { teamMode: 2, seatTeams: [0, 0, 1, 0, 0, 0] });
    expect(teamCounts(s)).toEqual([3, 1]);
    // Seats that are off don't count, however they are set.
    s.seats[1] = 'off';
    expect(teamCounts(s)).toEqual([2, 1]);
  });

  it('read a team number that is too big for the mode as a wrapped one', () => {
    const s = lineup(['human', 'human', 'human'], { teamMode: 2, seatTeams: [2, 3, 1, 0, 0, 0] });
    expect(teamCounts(s)).toEqual([1, 2]);
  });

  it('send a newcomer to the smallest team', () => {
    const s = lineup(['human', 'human', 'human'], { teamMode: 2, seatTeams: [0, 0, 1, 0, 0, 0] });
    addSeat(s, 'human');
    expect(s.seatTeams[3]).toBe(1);
    expect(teamCounts(s)).toEqual([2, 2]);
  });

  it('send a newcomer to the first of equal teams', () => {
    const s = lineup(['human', 'human'], { teamMode: 3, seatTeams: [0, 1, 0, 0, 0, 0] });
    addSeat(s, 'human');
    expect(s.seatTeams[2]).toBe(2);
  });

  it('can be dealt out evenly, one after the other', () => {
    const s = lineup(['human', 'human', 'easy', 'easy', 'hard'], { teamMode: 2, seatTeams: [0, 0, 0, 0, 0, 0] });
    balanceTeams(s);
    expect(teamCounts(s)).toEqual([3, 2]);
    const t3 = lineup(['human', 'human', 'easy', 'easy', 'hard', 'hard'], { teamMode: 3 });
    balanceTeams(t3);
    expect(teamCounts(t3)).toEqual([2, 2, 2]);
  });

  it('are left alone by balancing when there are none', () => {
    const s = lineup(['human', 'human', 'human'], { teamMode: 0, seatTeams: [1, 1, 1, 1, 1, 1] });
    balanceTeams(s);
    expect(s.seatTeams).toEqual([1, 1, 1, 1, 1, 1]);
    expect(teamCounts(s)).toEqual([]);
  });

  it('only make a match with three ships in two teams', () => {
    const two = lineup(['human', 'human'], { teamMode: 2, seatTeams: [0, 1, 0, 0, 0, 0] });
    expect(seatTeamsFor(two, activeSeats(two))).toBeNull();
    const lopsided = lineup(['human', 'human', 'human'], { teamMode: 2, seatTeams: [0, 0, 0, 0, 0, 0] });
    expect(seatTeamsFor(lopsided, activeSeats(lopsided))).toBeNull();
    const fine = lineup(['human', 'human', 'human'], { teamMode: 2, seatTeams: [0, 1, 0, 0, 0, 0] });
    expect(seatTeamsFor(fine, activeSeats(fine))).toEqual([0, 1, 0]);
  });
});
