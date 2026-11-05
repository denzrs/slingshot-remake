import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/data/settings';
import { ChallengeMatch, createChallenge, createShotReplay, type GameEvent, type Match } from '../../src/game';
import { buildSector, dailyChallenge, type DailyShot } from '../../src/sim/challenge';
import { CHALLENGE } from '../../src/sim/config';

const DAY = '2026-10-19';
const DT = 1 / 60;

const settings = () => structuredClone(DEFAULT_SETTINGS);

function runUntil(match: Match, done: () => boolean): void {
  for (let i = 0; i < 60 * 120 && !done(); i++) match.update(DT);
  expect(done()).toBe(true);
}

/** Fire a sector's known solutions, one per target, and let each flight end. */
function clearSector(match: ChallengeMatch, sector: number, wasteFirst = false): void {
  const { solutions } = buildSector(match.challenge.sectors[sector]);
  if (wasteFirst) fire(match, solutions[0].angle + 180, 5);
  for (const { angle, power } of solutions) fire(match, angle, power);
}

function fire(match: ChallengeMatch, angle: number, power: number): void {
  match.pilot.angle = angle;
  match.pilot.power = power;
  match.commit();
  expect(match.phase).toBe('flying');
  runUntil(match, () => match.phase !== 'flying');
}

const targetsOf = (match: ChallengeMatch): number[] => match.players.filter((p) => p.target).map((p) => p.id);

/** Flies a replay to its end; what it killed, and how often it asked for the end screen. */
function watch(day: string, shot: DailyShot) {
  const replay = createShotReplay(settings(), dailyChallenge(day), { ...shot, name: 'Ada' });
  const events: GameEvent[] = [];
  replay.on((event) => events.push(event));
  const before = replay.players.filter((p) => p.target && p.alive).length;
  runUntil(replay, () => replay.phase === 'gameOver');
  return { replay, events, before };
}

describe('the shot of the day', () => {
  it('a run notes its shot that paid the most, and a new run starts without one', () => {
    const match = createChallenge(settings(), dailyChallenge(DAY));
    expect(match.bestShot).toBeNull();
    // A miss is no shot to show.
    const { solutions } = buildSector(match.challenge.sectors[0]);
    fire(match, solutions[0].angle + 180, 5);
    expect(match.bestShot).toBeNull();

    for (const { angle, power } of solutions) fire(match, angle, power);
    const best = match.bestShot!;
    expect(best.points).toBeGreaterThan(0);
    expect(best.sector).toBe(0);
    expect(best.trail.length).toBeGreaterThanOrEqual(4);
    expect(best.trail.length % 2).toBe(0);
    expect(best.trail.length / 2).toBeLessThanOrEqual(CHALLENGE.SHOT_TRAIL);

    match.newMatch();
    expect(match.bestShot).toBeNull();
  });

  it('flies again on the sector as it stood: same target, same points, targets already down stay down', () => {
    const match = createChallenge(settings(), dailyChallenge(DAY));
    clearSector(match, 0, true);
    match.advance();
    runUntil(match, () => {
      match.advance();
      return match.phase === 'aiming' && match.round === 2;
    });
    clearSector(match, 1);

    const shot = match.bestShot!;
    const { replay, events, before } = watch(DAY, shot);
    expect(replay.spec.index).toBe(shot.sector);
    expect(before).toBe(replay.targetsTotal - shot.down.length);
    const kills = events.flatMap((event) => (event.type === 'kill' ? [event.record] : []));
    expect(kills).toHaveLength(1);
    expect(kills[0].points).toBe(shot.points);
    expect(replay.targetsLeft).toBe(before - 1);
    expect(replay.shotsLeft).toBe(shot.left);
    expect([...replay.trails].reverse().find((trail) => trail.owner === 0)!.points.at(-1)).toBeCloseTo(shot.trail.at(-1)!, 0);
  });

  it('lets the shot land before its end card comes up', () => {
    const match = createChallenge(settings(), dailyChallenge(DAY));
    clearSector(match, 0);
    const replay = createShotReplay(settings(), dailyChallenge(DAY), { ...match.bestShot!, name: 'Ada' });
    let landed = 0;
    let over = 0;
    replay.on((event) => {
      if (event.type === 'kill') landed = replay.clock;
      if (event.type === 'gameOver') over = replay.clock;
    });
    runUntil(replay, () => replay.phase === 'gameOver');
    expect(landed).toBeGreaterThan(0);
    expect(over - landed).toBeGreaterThanOrEqual(CHALLENGE.SHOT_LINGER);
  });

  it('a target already down is not there to be hit a second time', () => {
    const match = createChallenge(settings(), dailyChallenge(DAY));
    clearSector(match, 0);
    const shot = match.bestShot!;
    const { replay, before } = watch(DAY, { ...shot, down: [...new Set([...shot.down, ...targetsOf(match)])] });
    expect(before).toBe(0);
    expect(replay.targetsLeft).toBe(0);
    expect(replay.pilot.score).toBe(0);
  });

  it('asks for its own end screen and never scores as a run of the day', () => {
    const match = createChallenge(settings(), dailyChallenge(DAY));
    clearSector(match, 0);
    const { replay, events } = watch(DAY, match.bestShot!);
    expect(events.filter((event) => event.type === 'gameOver')).toHaveLength(1);
    expect(replay.replaying).toBe(true);
    expect(replay.isHumanTurn).toBe(false);
    // Nothing a key press can do takes it anywhere else.
    replay.commit();
    expect(replay.phase).toBe('gameOver');
    expect(replay.results).toHaveLength(0);
    expect(replay.bestShot).toBeNull();
  });
});
