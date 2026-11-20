import { afterEach, describe, expect, it } from 'vitest';
import { setTeamNames, teamName, teamTitle } from '../../src/game/match-types';

describe('team names', () => {
  afterEach(() => setTeamNames(null));

  it('are the game\'s own outside a tournament, as a heading with "Team"', () => {
    expect(teamTitle(0)).toContain(teamName(0));
    expect(teamTitle(0)).not.toBe(teamName(0));
  });

  it('are the tournament teams\' own names in a tournament match, as they are', () => {
    setTeamNames(['Rote Raketen', 'Blau']);
    expect(teamName(0)).toBe('Rote Raketen');
    expect(teamTitle(1)).toBe('Blau');
  });

  it('go back to the game\'s once the match is left', () => {
    const plain = teamName(1);
    setTeamNames(['A', 'B']);
    setTeamNames(null);
    expect(teamName(1)).toBe(plain);
  });
});
