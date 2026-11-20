import { afterEach, describe, expect, it } from 'vitest';
import { setPalette, setTeamColors, teamColor } from '../../src/data/palette';

describe('a tournament match\'s team colours', () => {
  afterEach(() => {
    setTeamColors(null);
    setPalette('standard');
  });

  it('draw each team in the colour it picked, its members in shades of it', () => {
    setTeamColors(['#36c2d6', '#ff5a5a']);
    expect(teamColor(0)).toBe('#36c2d6');
    expect(teamColor(1)).toBe('#ff5a5a');
    const shades = [teamColor(0, 0), teamColor(0, 1), teamColor(0, 2)];
    expect(new Set(shades).size).toBe(3);
  });

  it('give way to the game\'s when both teams picked the same colour', () => {
    const plain = [teamColor(0), teamColor(1)];
    setTeamColors(['#36c2d6', '#36c2d6']);
    expect([teamColor(0), teamColor(1)]).toEqual(plain);
  });

  it('give way to the colour-blind palette', () => {
    setPalette('colorblind');
    const safe = teamColor(0);
    setTeamColors(['#36c2d6', '#ff5a5a']);
    expect(teamColor(0)).toBe(safe);
  });

  it('go back to the game\'s once the match is left', () => {
    const plain = teamColor(1);
    setTeamColors(['#36c2d6', '#ff5a5a']);
    setTeamColors(null);
    expect(teamColor(1)).toBe(plain);
  });
});
