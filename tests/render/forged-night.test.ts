import { describe, expect, it } from 'vitest';
import { NIGHT_FALLS, nightAfterSupernova } from '../../src/render/looks/forged-sky';

describe('Forged sky after a supernova', () => {
  it('stays lit without a remnant and goes out over a few seconds once there is one', () => {
    expect(nightAfterSupernova(null)).toBe(0);
    expect(nightAfterSupernova(0)).toBe(0);
    expect(nightAfterSupernova(NIGHT_FALLS / 2)).toBeCloseTo(.5);
    expect(nightAfterSupernova(NIGHT_FALLS)).toBe(1);
    expect(nightAfterSupernova(60)).toBe(1);
  });
});
