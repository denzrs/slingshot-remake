import { describe, expect, it } from 'vitest';
import { groupRoster } from '../src/ui/team-roster';

const seat = (id: number, team: number | null) => ({ id, team });
const ids = (groups: ReturnType<typeof groupRoster<{ id: number; team: number | null }>>) => groups.map((group) => group.map((s) => s.id));

describe('the roster arranged by team', () => {
  it('keeps all six physical slots in order in free for all', () => {
    const seats = [seat(0, 0), seat(1, null), seat(2, 1), seat(3, null), seat(4, 2), seat(5, null)];
    expect(ids(groupRoster(seats, 0))).toEqual([[0, 1, 2, 3, 4, 5]]);
  });

  it('sorts players into their chosen teams without changing those assignments', () => {
    const seats = [seat(0, 1), seat(1, 0), seat(2, 1), seat(3, 0)];
    expect(ids(groupRoster(seats, 2))).toEqual([[1, 3], [0, 2]]);
    expect(seats.map((s) => s.team)).toEqual([1, 0, 1, 0]);
  });

  it('gives each of two teams three slots when the active players are balanced', () => {
    const seats = [seat(0, 0), seat(1, 1), seat(2, null), seat(3, null), seat(4, null), seat(5, null)];
    expect(ids(groupRoster(seats, 2))).toEqual([[0, 2, 4], [1, 3, 5]]);
  });

  it('gives each of three teams two slots', () => {
    const seats = [seat(0, 0), seat(1, 1), seat(2, 2), seat(3, null), seat(4, null), seat(5, null)];
    expect(ids(groupRoster(seats, 3))).toEqual([[0, 3], [1, 4], [2, 5]]);
  });

  it('keeps deliberately uneven teams and puts free slots in the smaller team', () => {
    const seats = [seat(0, 0), seat(1, 0), seat(2, 0), seat(3, 0), seat(4, 1), seat(5, null)];
    expect(ids(groupRoster(seats, 2))).toEqual([[0, 1, 2, 3], [4, 5]]);
  });

  it('places a moved player in the destination group and retains every slot exactly once', () => {
    const seats = [seat(0, 0), seat(1, 1), seat(2, 2), seat(3, 0), seat(4, 1), seat(5, 2)];
    seats[3].team = 2;
    const groups = groupRoster(seats, 3);
    expect(ids(groups)).toEqual([[0], [1, 4], [2, 3, 5]]);
    expect(groups.flat().map((s) => s.id).sort()).toEqual([0, 1, 2, 3, 4, 5]);
  });
});
