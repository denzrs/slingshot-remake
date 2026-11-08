import { afterEach, describe, expect, it } from 'vitest';
import { MAX_PLAYERS } from '../../src/sim/config';
import { dangerColor, PALETTES, seatColor, setPalette, teamColor } from '../../src/data/palette';

/** Colour-vision simulation (Machado et al. 2009, full severity) and a distance in Oklab, scaled by 100. */
const KINDS = {
  normal: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  tritanopia: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
} as const;

const toLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** A colour as seen with `kind` of sight, in Oklab. */
function seen(hex: string, kind: keyof typeof KINDS): [number, number, number] {
  const rgb = [1, 3, 5].map((i) => toLinear(parseInt(hex.slice(i, i + 2), 16) / 255));
  const [r, g, b] = KINDS[kind].map((row) => Math.min(1, Math.max(0, row[0] * rgb[0] + row[1] * rgb[1] + row[2] * rgb[2])));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

/** How far apart two colours look at the least, over normal sight and the three kinds of colour blindness. */
function apart(a: string, b: string): number {
  return Math.min(...(Object.keys(KINDS) as (keyof typeof KINDS)[]).map((kind) => {
    const [x, y] = [seen(a, kind), seen(b, kind)];
    return 100 * Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
  }));
}

const closest = (colors: readonly string[]): number => Math.min(...colors.flatMap((a, i) => colors.slice(i + 1).map((b) => apart(a, b))));

afterEach(() => setPalette('standard'));

describe('the colour-blind palette', () => {
  const { players, teams, danger } = PALETTES.colorblind;

  it('has a colour for every seat and three teams of three shades', () => {
    expect(players).toHaveLength(MAX_PLAYERS);
    expect(teams).toHaveLength(3);
    for (const family of teams) expect(family).toHaveLength(3);
  });

  it('keeps every seat, and the target drone, apart for every kind of sight', () => {
    expect(closest([...players, danger])).toBeGreaterThan(12);
  });

  it('keeps the teams apart, and the shades within a team too', () => {
    expect(closest(teams.flat())).toBeGreaterThan(8);
  });

  it('is better than the standard palette, where two seats are almost one colour to a deuteranope', () => {
    expect(closest(PALETTES.standard.players)).toBeLessThan(2);
  });
});

describe('seatColor, teamColor and dangerColor', () => {
  it('follow the palette that is set', () => {
    expect(seatColor(1)).toBe(PALETTES.standard.players[1]);
    expect(teamColor(2, 1)).toBe(PALETTES.standard.teams[2][1]);
    expect(dangerColor()).toBe(PALETTES.standard.danger);
    setPalette('colorblind');
    expect(seatColor(1)).toBe(PALETTES.colorblind.players[1]);
    expect(teamColor(2, 1)).toBe(PALETTES.colorblind.teams[2][1]);
    expect(dangerColor()).toBe(PALETTES.colorblind.danger);
  });

  it('start over past the last seat or shade', () => {
    expect(seatColor(MAX_PLAYERS)).toBe(seatColor(0));
    expect(teamColor(0, 3)).toBe(teamColor(0, 0));
  });
});
