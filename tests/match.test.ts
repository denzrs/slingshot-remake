import { describe, expect, it } from 'vitest';
import { createMatch, type Match, type VersusMode } from '../src/game';
import { ClassicMatch } from '../src/game/classic';
import { HorizonMatch } from '../src/game/horizon';
import { FIELD } from '../src/config';
import { DEFAULT_SETTINGS, type Seat } from '../src/settings';

/** Run a CPU-only match headlessly until the first round is decided. */
function playRound(mode: VersusMode, seats: Seat[], maxSeconds = 600): Match {
  const match = createMatch(mode, { ...DEFAULT_SETTINGS, rounds: 1, seats }, { seats });
  const dt = 1 / 30;
  for (let t = 0; t < maxSeconds && match.phase !== 'roundOver'; t += dt) {
    match.update(dt);
    if (match.phase === 'killcam') match.advance();
  }
  return match;
}

const cpus = (n: number, level: Seat = 'medium'): Seat[] => [...Array(n).fill(level), ...Array(6 - n).fill('off')];

describe('classic match', () => {
  it('restores an authoritative mid-flight snapshot', () => {
    const host = createMatch('classic', { ...DEFAULT_SETTINGS, rounds: 3 }, { seats: ['human', 'human', 'human', 'off', 'off', 'off'] }) as ClassicMatch;
    const guest = createMatch('classic', { ...DEFAULT_SETTINGS, rounds: 3 }, { seats: ['human', 'human', 'human', 'off', 'off', 'off'] }) as ClassicMatch;
    host.world = {
      width: FIELD.width,
      height: FIELD.height,
      planets: [],
      ships: [{ x: 100, y: 400, alive: true }, { x: 1100, y: 400, alive: true }, { x: 640, y: 700, alive: true }],
      hole: null,
      version: 0,
    };
    host.setPlayerAim(host.current, 17, 75);
    host.commitPlayer(host.current);
    for (let frame = 0; frame < 5; frame++) host.update(0.01);

    guest.restoreSnapshot(host.snapshot());
    const authoritative = host.snapshot();
    guest.restoreSnapshot(authoritative);
    expect(guest.snapshot()).toEqual(authoritative);
    expect(guest.snapshot().volley?.shots[0].x).toBe(authoritative.volley?.shots[0].x);
    expect(guest.phase).toBe('flying');
    expect(guest.players[0].team).toBe(host.players[0].team);
    expect(guest.players[1].team).toBe(host.players[1].team);
  });

  it('plays a three-ship round to a single survivor', () => {
    const m = playRound('classic', cpus(3, 'hard'));
    expect(m.phase).toBe('roundOver');
    expect(m.alive).toHaveLength(1);
    expect(m.summary?.survivor).toBe(m.alive[0].id);
    // Every eliminated ship shows up in the kill feed.
    expect(m.killFeed.map((k) => k.victim).sort()).toEqual(m.players.filter((p) => !p.alive).map((p) => p.id).sort());
  });

  it('keeps the original duel layout and scoring', () => {
    const m = playRound('classic', cpus(2, 'hard'));
    expect(m.phase).toBe('roundOver');
    const kill = m.lastKill!;
    // In a duel there is no extra survivor bonus: the winner's score is exactly the hit (or the opponent's own goal).
    const winner = m.players[m.summary!.survivor!];
    expect(winner.score).toBe(kill.self ? 0 : kill.points);
  });
});

describe('event horizon match', () => {
  it('restores authoritative planning state and black-hole world', () => {
    const host = createMatch('horizon', { ...DEFAULT_SETTINGS, rounds: 3 }, { seats: ['human', 'human', 'off', 'off', 'off', 'off'] }) as HorizonMatch;
    const guest = createMatch('horizon', { ...DEFAULT_SETTINGS, rounds: 3 }, { seats: ['human', 'human', 'off', 'off', 'off', 'off'] }) as HorizonMatch;
    host.adjustPlayer(host.current, 23, 10);
    const state = host.snapshot();

    guest.restoreSnapshot(state);
    expect(guest.snapshot()).toEqual(state);
    expect(guest.world.hole).not.toBeNull();
    expect(guest.current).toBe(host.current);
  });

  it('always ends: the growing hole guarantees a decision', () => {
    for (let i = 0; i < 3; i++) {
      const m = playRound('horizon', cpus(4));
      expect(m.phase).toBe('roundOver');
      expect(m.alive.length).toBeLessThanOrEqual(1);
    }
  });

  it('CPUs rarely shoot themselves', () => {
    let kills = 0;
    let selfKills = 0;
    for (let i = 0; i < 4; i++) {
      const m = playRound('horizon', cpus(5, 'hard'));
      kills += m.killFeed.filter((k) => k.killer !== null).length;
      selfKills += m.killFeed.filter((k) => k.self).length;
    }
    expect(kills).toBeGreaterThan(0);
    expect(selfKills / kills).toBeLessThan(0.25);
  });
});

describe('team mode', () => {
  const teamSettings = (seats: Seat[], seatTeams: number[], teamMode = 2) => ({ ...DEFAULT_SETTINGS, rounds: 1, seats, seatTeams, teamMode });

  it('falls back to free for all without two real teams', () => {
    const m = createMatch('classic', teamSettings(cpus(3), [0, 0, 0, 0, 0, 0]));
    expect(m.teamMode).toBe(0);
    expect(m.players.every((p) => p.team === null)).toBe(true);
  });

  it('plays a team round until one team is left and pays every member of the winning team', () => {
    const m = createMatch('classic', teamSettings(cpus(4, 'hard'), [0, 1, 0, 1, 0, 1]));
    expect(m.teamMode).toBe(2);
    const dt = 1 / 30;
    for (let t = 0; t < 600 && m.phase !== 'roundOver'; t += dt) m.update(dt);
    expect(m.phase).toBe('roundOver');
    const s = m.summary!;
    expect(s.title).toBe('teamWin');
    expect(s.bonus).toBe(250);
    expect(m.alive.every((p) => p.team === s.team)).toBe(true);
    expect(m.winner()).not.toBeNull();
  });

  it('alternates turns between teams, not seats', () => {
    // Seats 1+2 in team A, seat 3 alone in team B: B must shoot every other turn.
    const m = createMatch('classic', teamSettings(['human', 'human', 'human', 'off', 'off', 'off'], [0, 0, 1, 0, 0, 0]));
    m.world.planets = [];
    const order: number[] = [];
    for (let turn = 0; turn < 4; turn++) {
      order.push(m.current);
      // Fire straight up and out of the field: a harmless miss.
      m.setAim(90, 60);
      m.commit();
      for (let t = 0; t < 30 && m.phase === 'flying'; t += 1 / 30) m.update(1 / 30);
    }
    expect(order.map((id) => m.players[id].team)).toEqual([0, 1, 0, 1]);
    expect(order[0]).not.toBe(order[2]);
  });

  it('works in Event Horizon too: the round ends with one team left in orbit', () => {
    for (let i = 0; i < 3; i++) {
      const m = createMatch('horizon', teamSettings(cpus(6, 'hard'), [0, 1, 2, 0, 1, 2], 3));
      expect(m.teamMode).toBe(3);
      const dt = 1 / 30;
      for (let t = 0; t < 900 && m.phase !== 'roundOver'; t += dt) {
        m.update(dt);
        if (m.phase === 'killcam') m.advance();
      }
      expect(m.phase).toBe('roundOver');
      const teamsLeft = new Set(m.alive.map((p) => p.team));
      expect(teamsLeft.size).toBeLessThanOrEqual(1);
      if (teamsLeft.size === 1) expect(m.summary!.team).toBe([...teamsLeft][0]);
    }
  });

  it('punishes friendly fire without ending the round', () => {
    const m = createMatch('classic', teamSettings(['human', 'human', 'human', 'off', 'off', 'off'], [0, 0, 1, 0, 0, 0]));
    m.world.planets = [];
    const shooter = m.players[m.current];
    const mate = m.players.find((p) => p.team === shooter.team && p.id !== shooter.id)!;
    // Park the teammate right in front of the shooter.
    const from = m.world.ships[shooter.id];
    Object.assign(m.world.ships[mate.id], { x: from.x + 200, y: from.y });
    m.setAim(0, 50);
    m.commit();
    for (let t = 0; t < 10 && m.phase === 'flying'; t += 1 / 30) m.update(1 / 30);
    expect(m.killFeed[0]).toMatchObject({ killer: shooter.id, victim: mate.id, friendly: true, points: -300 });
    expect(shooter.score).toBe(-300);
    expect(m.phase).toBe('aiming');
  });
});
