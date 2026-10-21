import { describe, expect, it } from 'vitest';
import { MAYHEM } from '../src/config';
import { mayhemRules } from '../src/lobbyPrefs';
import { createMatch, type Match, type VersusMode } from '../src/game';
import type { ClassicMatch } from '../src/game/classic';
import type { HorizonMatch } from '../src/game/horizon';
import { cloneSettings, DEFAULT_SETTINGS, type Seat, type Settings } from '../src/settings';

const humans: Seat[] = ['human', 'human', 'off', 'off', 'off', 'off'];
const cpus: Seat[] = ['medium', 'medium', 'medium', 'off', 'off', 'off'];

const room = (patch: Partial<Settings> = {}, seats: Seat[] = humans): Settings => ({ ...cloneSettings(DEFAULT_SETTINGS), mayhem: 2, rounds: 4, seats, ...patch });

const start = (mode: VersusMode, patch: Partial<Settings> = {}, seats: Seat[] = humans, seed = 11): Match => createMatch(mode, room(patch, seats), { seats, seed, deterministicCpu: true });

/** Lets the announcement of the round pass the way a player would: with the fire key. */
const skipReveal = (match: Match): void => {
  match.commit();
  expect(match.revealing).toBe(false);
};

describe('a match without Mayhem', () => {
  it.each<VersusMode>(['classic', 'horizon'])('plays %s by the room rules, with no twists and no announcement', (mode) => {
    const settings = room({ mayhem: 0 });
    const match = createMatch(mode, settings, { seats: humans, seed: 3 });
    expect(match.mayhem).toBeNull();
    expect(match.revealing).toBe(false);
    expect(match.settings).toBe(settings);
    expect(match.isHumanTurn).toBe(true);
  });
});

describe('a match with Mayhem', () => {
  it.each<VersusMode>(['classic', 'horizon'])('announces the round before anybody may aim in %s, and the fire key ends the announcement', (mode) => {
    const match = start(mode);
    expect(match.mayhem).not.toBeNull();
    expect(match.revealing).toBe(true);
    expect(match.isHumanTurn).toBe(false);
    expect(match.canAim(match.current)).toBe(false);
    match.commit();
    expect(match.revealing).toBe(false);
    expect(match.isHumanTurn).toBe(true);
    expect(match.players.every((p) => !p.locked)).toBe(true);
  });

  it('lets the announcement run out by itself', () => {
    const match = start('classic');
    for (let t = 0; t < MAYHEM.REVEAL_TIME + 0.5; t += 1 / 30) match.update(1 / 30);
    expect(match.revealing).toBe(false);
    expect(match.isHumanTurn).toBe(true);
  });

  it('holds the ships still while it is announced', () => {
    const match = start('classic', {}, cpus);
    for (let t = 0; t < MAYHEM.REVEAL_TIME - 0.3; t += 1 / 30) match.update(1 / 30);
    expect(match.phase).toBe('aiming');
    expect(match.players.every((p) => p.shots === 0)).toBe(true);
  });

  it('lays the twists over the room rules for the round, and takes them off for the next', () => {
    const settings = room({ mayhem: 3, rounds: 6 });
    const before = JSON.stringify(settings);
    const match = createMatch('classic', settings, { seats: humans, seed: 5 });
    const seen: string[] = [];
    for (let round = 1; round <= 6; round++) {
      expect(match.round).toBe(round);
      expect(match.mayhem!.twists.length).toBeGreaterThanOrEqual(2);
      // Everything the twists did not touch stays as the room set it.
      expect(match.settings).toMatchObject({ rounds: 6, shotTime: settings.shotTime, seats: settings.seats });
      expect(match.settings).not.toEqual(settings);
      seen.push(JSON.stringify(match.mayhem));
      (match as unknown as { endRound(): void }).endRound();
      match.update(1);
      match.advance();
    }
    expect(JSON.stringify(settings)).toBe(before);
    expect(new Set(seen).size).toBeGreaterThan(1);
  });

  it('stacks twists and calls the last round of a finite match the finale', () => {
    const match = createMatch('classic', room({ mayhem: 1, rounds: 3 }), { seats: humans, seed: 9 });
    for (let round = 1; round <= 3; round++) {
      expect(match.mayhem!.finale).toBe(round === 3);
      if (round === 3) expect(match.mayhem!.twists.length).toBeGreaterThanOrEqual(2);
      (match as unknown as { endRound(): void }).endRound();
      match.update(1);
      match.advance();
    }
  });

  it('draws the same rounds from the same seed', () => {
    const rounds = (seed: number) => {
      const match = createMatch('classic', room({ rounds: 5 }), { seats: humans, seed });
      const out = [];
      for (let i = 0; i < 5; i++) {
        out.push(match.mayhem);
        (match as unknown as { endRound(): void }).endRound();
        match.update(1);
        match.advance();
      }
      return out;
    };
    expect(rounds(21)).toEqual(rounds(21));
  });

  it('keeps the room\'s choice of simultaneous shots in every round, since no twist touches it', () => {
    const match = createMatch('classic', room({ rounds: 4, simultaneousShots: true }), { seats: humans, seed: 6 });
    for (let round = 1; round <= 4; round++) {
      expect(match.salvo).toBe(true);
      expect(match.settings.simultaneousShots).toBe(true);
      (match as unknown as { endRound(): void }).endRound();
      match.update(1);
      match.advance();
    }
  });

  it('pays for trick shots in every round of a Mayhem game, in Classic too', () => {
    const settings = { ...cloneSettings(DEFAULT_SETTINGS), ...mayhemRules({ mayhem: 3, rounds: 4, shotTime: 10, simultaneousShots: false }, 'classic'), seats: humans };
    const match = createMatch('classic', settings, { seats: humans, seed: 12 });
    for (let round = 1; round <= 4; round++) {
      expect(match.settings.styleBonuses).toBe(true);
      expect(match.settings.shotTime).toBe(10);
      expect((match as unknown as { stylePays: boolean }).stylePays).toBe(true);
      (match as unknown as { endRound(): void }).endRound();
      match.update(1);
      match.advance();
    }
  });

  it('does not twist the title screen', () => {
    const match = createMatch('classic', room(), { attract: true, seats: cpus, seed: 1 });
    expect(match.mayhem).toBeNull();
    expect(match.revealing).toBe(false);
  });

  it('keeps a rematch drawing new rounds', () => {
    const match = createMatch('classic', room({ rounds: 1 }), { seats: humans, seed: undefined });
    expect(match.mayhem).not.toBeNull();
    (match as unknown as { endRound(): void }).endRound();
    match.update(1);
    match.advance();
    match.update(1);
    match.advance();
    expect(match.phase).toBe('aiming');
    expect(match.mayhem).not.toBeNull();
  });
});

/** The scores after one round of CPUs, with the round forced to be (or not be) a jackpot. */
function scoresOf(mode: VersusMode, jackpot: boolean): number[] {
  const match = start(mode, { rounds: 1, maxPlanets: 2 }, cpus, 17);
  match.mayhem = { twists: [], finale: false, jackpot };
  skipReveal(match);
  for (let t = 0; t < 600 && match.phase !== 'roundOver'; t += 1 / 30) {
    match.update(1 / 30);
    if (match.phase === 'killcam') match.advance();
  }
  expect(match.phase).toBe('roundOver');
  return match.players.map((p) => p.score);
}

describe('jackpot rounds', () => {
  it.each<VersusMode>(['classic', 'horizon'])('pay and cost double in %s', (mode) => {
    const normal = scoresOf(mode, false);
    const jackpot = scoresOf(mode, true);
    expect(normal.some((n) => n !== 0)).toBe(true);
    expect(jackpot).toEqual(normal.map((n) => n * MAYHEM.JACKPOT_FACTOR));
  }, 30_000);
});

describe('Mayhem online', () => {
  it.each<VersusMode>(['classic', 'horizon'])('holds every player back in %s until somebody presses fire, which then does not lock in an aim', (mode) => {
    const match = createMatch(mode, room(), { seats: humans, seed: 4, simultaneous: true }) as ClassicMatch | HorizonMatch;
    // Online Event Horizon everybody aims at once; Classic still goes by turns.
    const aimer = mode === 'horizon' ? 0 : match.current;
    expect(match.canAim(aimer)).toBe(false);
    match.commitPlayer(1);
    expect(match.revealing).toBe(false);
    expect(match.players.every((p) => !p.locked)).toBe(true);
    expect(match.canAim(aimer)).toBe(true);
  });
});

describe('the recap', () => {
  it('keeps how every finished round was played, and starts over with a rematch', () => {
    const match = createMatch('classic', room({ rounds: 2 }), { seats: humans, seed: 8 });
    const first = match.mayhem;
    (match as unknown as { endRound(): void }).endRound();
    expect(match.mayhemHistory).toEqual([first]);
    match.update(1);
    match.advance();
    (match as unknown as { endRound(): void }).endRound();
    expect(match.mayhemHistory).toHaveLength(2);
    expect(match.scoreHistory).toHaveLength(3);
    match.update(1);
    match.advance();
    match.update(1);
    match.advance();
    expect(match.mayhemHistory).toEqual([]);
  });

  it('travels in the snapshot', () => {
    const host = start('classic', { rounds: 3 }) as ClassicMatch;
    (host as unknown as { endRound(): void }).endRound();
    const guest = createMatch('classic', room({ mayhem: 0 }), { seats: humans, seed: 99 }) as ClassicMatch;
    guest.restoreSnapshot(JSON.parse(JSON.stringify(host.snapshot())));
    expect(guest.mayhemHistory).toEqual(host.mayhemHistory);
    expect(guest.mayhemHistory).toHaveLength(1);
  });
});

describe('Mayhem over the wire', () => {
  it('carries the round and the announcement in the snapshot, so a guest sees the same twists and rules', () => {
    const host = start('classic') as ClassicMatch;
    const guest = createMatch('classic', room({ mayhem: 0 }), { seats: humans, seed: 99 }) as ClassicMatch;
    expect(guest.mayhem).toBeNull();
    guest.restoreSnapshot(JSON.parse(JSON.stringify(host.snapshot())));
    expect(guest.mayhem).toEqual(host.mayhem);
    expect(guest.revealEnd).toBe(host.revealEnd);
    expect(guest.revealing).toBe(true);
    expect(guest.settings).toEqual(host.settings);
  });

  it('does the same in Event Horizon', () => {
    const host = start('horizon') as HorizonMatch;
    const guest = createMatch('horizon', room({ mayhem: 0 }), { seats: humans, seed: 99 }) as HorizonMatch;
    guest.restoreSnapshot(JSON.parse(JSON.stringify(host.snapshot())));
    expect(guest.mayhem).toEqual(host.mayhem);
    expect(guest.revealing).toBe(true);
  });
});
