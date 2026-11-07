import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/data/settings';
import { ChallengeMatch, createChallenge, createShotReplay, type GameEvent, type Match } from '../../src/game';
import { buildSector, dailyChallenge, type DailyShot } from '../../src/sim/challenge';
import { planetDurability } from '../../src/sim/physics';
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
  if (match.revealing) match.skipReveal();
  match.pilot.angle = angle;
  match.pilot.power = power;
  match.commit();
  expect(match.phase).toBe('flying');
  runUntil(match, () => match.phase !== 'flying');
}

const targetsOf = (match: ChallengeMatch): number[] => match.players.filter((p) => p.target).map((p) => p.id);

/** A replay ready to fly; what it killed, how often it asked for the end screen, and when each event last came. */
function start(day: string, shot: DailyShot) {
  const replay = createShotReplay(settings(), dailyChallenge(day), { ...shot, name: 'Ada' });
  const events: GameEvent[] = [];
  const at: Partial<Record<GameEvent['type'], number>> = {};
  replay.on((event) => {
    events.push(event);
    at[event.type] = replay.clock;
  });
  const before = replay.players.filter((p) => p.target && p.alive).length;
  return { replay, events, at, before };
}

/** Flies a replay to its end. */
function watch(day: string, shot: DailyShot) {
  const watched = start(day, shot);
  runUntil(watched.replay, () => watched.replay.phase === 'gameOver');
  return watched;
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

  it.each([1, 2])('replays Instabil after %i real planet impacts, including a destroyed planet', (impacts) => {
    const day = '2026-11-15';
    const challenge = dailyChallenge(day);
    const match = createChallenge(settings(), challenge);
    const original = match.world.planets[0];
    expect(planetDurability(original)).toBe(2);
    // This aim hits the small planet without hitting either ship.
    for (let i = 0; i < impacts; i++) fire(match, 19, 60);
    const terrainBefore = match.world.planets.map((p) => [p.seed, p.fractures?.length ?? 0]);
    expect(match.world.planets.some((p) => p.seed === original.seed)).toBe(impacts < 2);
    const solution = buildSector(challenge.sectors[0]).solutions.at(-1)!;
    fire(match, solution.angle, solution.power);
    const shot = match.bestShot!;
    expect(shot.terrain).toEqual([impacts, 0, 0]);
    const { replay, events } = start(day, shot);
    expect(replay.world.planets.map((p) => [p.seed, p.fractures?.length ?? 0])).toEqual(terrainBefore);
    runUntil(replay, () => replay.phase === 'gameOver');
    const kills = events.flatMap((e) => e.type === 'kill' ? [e.record] : []);
    expect(kills).toHaveLength(1);
    expect(kills[0].points).toBe(shot.points);
    expect(replay.trails.find((trail) => trail.owner === 0)!.points.at(-1)).toBeCloseTo(shot.trail.at(-1)!, 0);
  });

  it('lets the shot land before its end card comes up', () => {
    const match = createChallenge(settings(), dailyChallenge(DAY));
    clearSector(match, 0);
    const { replay, at } = start(DAY, match.bestShot!);
    runUntil(replay, () => at.kill !== undefined);
    runUntil(replay, () => replay.clock - at.kill! >= CHALLENGE.SHOT_LINGER - 0.5);
    // Still on the field, not on the card.
    expect(replay.phase).toBe('flying');
    expect(replay.volley).not.toBeNull();
    runUntil(replay, () => replay.phase === 'gameOver');
    expect(at.gameOver! - at.kill!).toBeCloseTo(CHALLENGE.SHOT_LINGER, 1);
  });

  it('counts the hold from the hit, not from the stray missiles that outlive it', () => {
    const day = '2026-10-29';
    const sector = 3;
    const spec = dailyChallenge(day).sectors[sector];
    const shot: DailyShot = { sector, down: [], attempt: 1, left: spec.shots - 1, angle: 356, power: 30, points: 0, trail: [] };
    const { replay, at } = start(day, shot);
    runUntil(replay, () => !!replay.volley?.done);
    expect(replay.clock - at.kill!).toBeGreaterThan(0.5);
    runUntil(replay, () => replay.phase === 'gameOver');
    expect(at.gameOver! - at.kill!).toBeCloseTo(CHALLENGE.SHOT_LINGER, 1);
  });

  it('lets a miss end its flight before the end card comes up', () => {
    const match = createChallenge(settings(), dailyChallenge(DAY));
    clearSector(match, 0);
    const shot = match.bestShot!;
    const { replay, events, at } = start(DAY, { ...shot, angle: shot.angle + 180, power: 5 });
    runUntil(replay, () => !!replay.volley?.done);
    const ended = replay.clock;
    runUntil(replay, () => replay.phase === 'gameOver');
    expect(events.some((event) => event.type === 'kill')).toBe(false);
    expect(at.gameOver! - ended).toBeCloseTo(CHALLENGE.SHOT_LINGER, 1);
  });

  it('a key press ends the hold, but not the flight', () => {
    const match = createChallenge(settings(), dailyChallenge(DAY));
    clearSector(match, 0);
    const { replay } = start(DAY, match.bestShot!);
    expect(replay.skipHold()).toBe(false);
    runUntil(replay, () => replay.phase === 'flying');
    expect(replay.skipHold()).toBe(false);
    runUntil(replay, () => !!replay.volley?.done);
    expect(replay.skipHold()).toBe(true);
    replay.update(DT);
    expect(replay.phase).toBe('gameOver');
    expect(replay.skipHold()).toBe(false);
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
