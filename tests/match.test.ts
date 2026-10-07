import { describe, expect, it } from 'vitest';
import { createMatch, type Match, type VersusMode } from '../src/game';
import { ClassicMatch } from '../src/game/classic';
import { HorizonMatch } from '../src/game/horizon';
import { FIELD, TRAIL_FADE } from '../src/config';
import { cloneSettings, DEFAULT_SETTINGS, type Seat } from '../src/settings';

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

describe('classic trick-shot bonuses', () => {
  /** One slow, straight shot across an empty field: nothing but the airtime bonus can apply. */
  function slowHit(styleBonuses: boolean): Match {
    const seats: Seat[] = ['human', 'human', 'off', 'off', 'off', 'off'];
    const m = createMatch('classic', { ...DEFAULT_SETTINGS, rounds: 1, seats, styleBonuses }, { seats });
    m.world.planets = [];
    Object.assign(m.world.ships[0], { x: 100, y: 400 });
    Object.assign(m.world.ships[1], { x: 1180, y: 400 });
    m.setAim(0, 20);
    m.commit();
    for (let t = 0; t < 30 && m.phase === 'flying'; t += 1 / 30) m.update(1 / 30);
    return m;
  }

  it('are off by default: a hit pays the plain score', () => {
    const m = slowHit(false);
    expect(m.lastKill).toMatchObject({ victim: 1, points: 1300, multiplier: 1, combo: [] });
  });

  it('multiply the hit once switched on', () => {
    const m = slowHit(true);
    expect(m.lastKill).toMatchObject({ victim: 1, points: 1560, multiplier: 1.2, combo: ['airtime'] });
    expect(m.players[0].score).toBe(1560);
  });
});

describe('settings', () => {
  it('a match plays by its own copy, so editing the setup mid-game changes nothing', () => {
    const live = { ...DEFAULT_SETTINGS, seats: [...DEFAULT_SETTINGS.seats], seatTeams: [...DEFAULT_SETTINGS.seatTeams] };
    const m = createMatch('classic', cloneSettings(live));
    live.bounce = true;
    live.fixedPower = true;
    live.seats[2] = 'human';
    m.applySettings(live);
    expect(m.settings.bounce).toBe(false);
    expect(m.settings.fixedPower).toBe(false);
    expect(m.settings.seats[2]).toBe('off');
  });

  it('display options follow along live', () => {
    const live = cloneSettings(DEFAULT_SETTINGS);
    const m = createMatch('horizon', cloneSettings(live));
    live.contours = false;
    m.applySettings(live);
    expect(m.settings.contours).toBe(false);
  });
});

describe('max power', () => {
  const capped = (mode: 'classic' | 'horizon', maxPower: number, fixedPower = false) => createMatch(mode, { ...DEFAULT_SETTINGS, maxPower, fixedPower }, { seats: ['human', 'human', 'off', 'off', 'off', 'off'] });

  it('caps what a human can aim for, in classic and event horizon', () => {
    for (const mode of ['classic', 'horizon'] as const) {
      const m = capped(mode, 70) as ClassicMatch | HorizonMatch;
      m.setPlayerAim(0, 10, 100);
      expect(m.players[0].power).toBe(70);
      m.adjustPlayer(0, 0, -200);
      expect(m.players[0].power).toBe(0);
      m.adjustPlayer(0, 0, 55);
      expect(m.players[0].power).toBe(55);
    }
  });

  it('starts a round at most at the cap, also with fixed power', () => {
    expect(capped('classic', 50).players[0].power).toBe(50);
    expect(capped('classic', 100).players[0].power).toBe(50);
    expect(capped('classic', 50, true).players[0].power).toBe(50);
    expect(capped('classic', 100, true).players[0].power).toBe(55);
  });

  it('keeps every CPU shot under the cap', () => {
    const seats: Seat[] = ['hard', 'hard', 'off', 'off', 'off', 'off'];
    const m = createMatch('classic', { ...DEFAULT_SETTINGS, rounds: 1, seats, maxPower: 60 }, { seats }) as ClassicMatch;
    const dt = 1 / 30;
    let fired = 0;
    for (let t = 0; t < 300 && m.phase !== 'roundOver'; t += dt) {
      m.update(dt);
      if (m.phase === 'killcam') m.advance();
      if (m.phase === 'flying') fired++;
      for (const p of m.players) expect(p.power).toBeLessThanOrEqual(60);
    }
    expect(fired).toBeGreaterThan(0);
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

  it('uses the configured bounce and shot timeout settings', () => {
    const m = createMatch('horizon', { ...DEFAULT_SETTINGS, bounce: true, shotTime: 60 }, { seats: cpus(2) });
    expect(m.rules).toEqual({ bounce: true, timeLimit: 60 });
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

describe('online matches', () => {
  it('keep the players\' names and teams across a rematch', () => {
    const seats: Seat[] = ['human', 'human', 'human', 'off', 'off', 'off'];
    for (const mode of ['classic', 'horizon'] as const) {
      const m = createMatch(mode, { ...DEFAULT_SETTINGS, seats, teamMode: 2 }, { seats, names: ['Anna', 'Ben', 'Cem'], teams: [0, 1, 0] });
      expect(m.players.map((p) => p.name)).toEqual(['Anna', 'Ben', 'Cem']);
      m.newMatch();
      expect(m.players.map((p) => p.name)).toEqual(['Anna', 'Ben', 'Cem']);
      expect(m.players.map((p) => p.team)).toEqual([0, 1, 0]);
      expect(m.teamMode).toBe(2);
    }
  });

  it('put two players on opposing teams even in a duel', () => {
    const seats: Seat[] = ['human', 'human', 'off', 'off', 'off', 'off'];
    const m = createMatch('classic', { ...DEFAULT_SETTINGS, seats, teamMode: 2 }, { seats, teams: [0, 1] });
    expect(m.teamMode).toBe(2);
    expect(m.players.map((p) => p.team)).toEqual([0, 1]);
  });
});

describe('skipping the killcam', () => {
  /** A match of four people at the table, run until the first kill starts a killcam. */
  function inKillcam(humans: number): HorizonMatch {
    const seats: Seat[] = [...Array(humans).fill('human'), ...Array(6 - humans).fill('off')];
    const m = createMatch('horizon', { ...DEFAULT_SETTINGS, rounds: 1, seats }, { seats, simultaneous: true }) as HorizonMatch;
    m.world.planets = [];
    Object.assign(m.world.ships[0], { x: 100, y: 400 });
    Object.assign(m.world.ships[1], { x: 300, y: 400 });
    for (let t = 0; t < 60 && m.phase !== 'aiming'; t += 1 / 30) m.update(1 / 30);
    m.setPlayerAim(0, 0, 30);
    m.commitPlayer(0);
    for (let id = 1; id < humans; id++) {
      m.setPlayerAim(id, 90, 30);
      m.commitPlayer(id);
    }
    for (let t = 0; t < 60 && m.phase !== 'killcam'; t += 1 / 30) m.update(1 / 30);
    expect(m.phase).toBe('killcam');
    m.update(0.5);
    return m;
  }

  it('takes at least half of the people at the table', () => {
    const m = inKillcam(4);
    expect(m.killcamInfo).toMatchObject({ votes: 0, needed: 2 });
    m.voteSkip(0);
    m.voteSkip(0); // the same person voting twice counts once
    expect(m.phase).toBe('killcam');
    expect(m.killcamInfo!.votes).toBe(1);
    m.voteSkip(2);
    expect(m.phase).not.toBe('killcam');
  });

  it('is decided by one vote between two', () => {
    const m = inKillcam(2);
    expect(m.killcamInfo!.needed).toBe(1);
    m.voteSkip(1);
    expect(m.phase).not.toBe('killcam');
  });
});

describe('neighbour grace period', () => {
  const seats = (n: number): Seat[] => [...Array(n).fill('human'), ...Array(6 - n).fill('off')];
  /** Four ships in a row: ship 1 is ship 0's nearest enemy, ship 3 the farthest. */
  function row(mode: 'classic' | 'horizon', neighborGrace: number, n = 4): Match {
    const m = createMatch(mode, { ...DEFAULT_SETTINGS, rounds: 1, seats: seats(n), neighborGrace }, { seats: seats(n) });
    m.world.planets = [];
    [[100, 400], [300, 400], [700, 400], [1100, 400]].slice(0, n).forEach(([x, y], i) => Object.assign(m.world.ships[i], { x, y }));
    return m;
  }

  it('is off by default', () => {
    expect(row('classic', 0).sparedFor(0)).toEqual([]);
  });

  it('spares the nearest enemy for the first shots of a round only', () => {
    for (const mode of ['classic', 'horizon'] as const) {
      const m = row(mode, 2);
      expect(m.sparedFor(0)).toEqual([1]);
      expect(m.sparedFor(3)).toEqual([2]);
      m.players[0].shots = 2;
      expect(m.sparedFor(0)).toEqual([]);
      expect(m.sparedFor(1)).toEqual([0]);
    }
  });

  it('can last one shot or two', () => {
    const one = row('classic', 1);
    expect(one.sparedFor(0)).toEqual([1]);
    one.players[0].shots = 1;
    expect(one.sparedFor(0)).toEqual([]);
    const two = row('classic', 2);
    two.players[0].shots = 1;
    expect(two.sparedFor(0)).toEqual([1]);
  });

  it('needs four ships: in a smaller game the nearest enemy is no shortcut', () => {
    expect(row('classic', 2, 3).sparedFor(0)).toEqual([]);
  });

  it('follows the fallen and teammates: the nearest *living enemy* counts', () => {
    const m = row('classic', 2);
    m.players[1].alive = false;
    expect(m.sparedFor(0)).toEqual([2]);
  });

  it('lets the shot fly through the spared ship and hit the next one', () => {
    const m = row('classic', 2);
    m.current = 0;
    m.setAim(0, 40);
    m.commit();
    for (let t = 0; t < 30 && m.phase === 'flying'; t += 1 / 30) m.update(1 / 30);
    expect(m.players[1].alive).toBe(true);
    expect(m.lastKill).toMatchObject({ killer: 0, victim: 2 });
  });

  it('only protects while it is switched on', () => {
    const m = row('classic', 0);
    m.current = 0;
    m.setAim(0, 40);
    m.commit();
    for (let t = 0; t < 30 && m.phase === 'flying'; t += 1 / 30) m.update(1 / 30);
    expect(m.lastKill).toMatchObject({ killer: 0, victim: 1 });
  });
});

describe('classic with simultaneous shots', () => {
  const seats = (humans: number, cpu = 0): Seat[] => [...Array(humans).fill('human'), ...Array(cpu).fill('medium'), ...Array(6 - humans - cpu).fill('off')];
  function duel(): Match {
    const s = seats(2);
    const m = createMatch('classic', { ...DEFAULT_SETTINGS, rounds: 1, seats: s, simultaneousShots: true }, { seats: s });
    m.world.planets = [];
    Object.assign(m.world.ships[0], { x: 100, y: 400 });
    Object.assign(m.world.ships[1], { x: 1180, y: 400 });
    return m;
  }
  const run = (m: Match, until: (m: Match) => boolean, seconds = 40) => {
    for (let t = 0; t < seconds && !until(m); t += 1 / 30) m.update(1 / 30);
  };

  it('has everybody aim first and fires all shots together', () => {
    const m = duel();
    expect(m.salvo).toBe(true);
    // At a shared keyboard the humans lock in one after another.
    const first = m.current;
    m.setAim(0, 20);
    m.commit();
    expect(m.phase).toBe('aiming');
    expect(m.current).not.toBe(first);
    m.setAim(180, 20);
    m.commit();
    run(m, (x) => x.phase === 'flying');
    expect(m.phase).toBe('flying');
    expect(m.volley!.shots.map((s) => s.owner).sort()).toEqual([0, 1]);
  });

  it('can take every ship down in the same volley', () => {
    // A hits B, B hits C, C hits A: three different lines, so no shots annihilate each other.
    const s = seats(3);
    const m = createMatch('classic', { ...DEFAULT_SETTINGS, rounds: 1, seats: s, simultaneousShots: true }, { seats: s });
    m.world.planets = [];
    [[200, 200], [1000, 200], [600, 650]].forEach(([x, y], i) => Object.assign(m.world.ships[i], { x, y }));
    for (let i = 0; i < 3; i++) {
      const from = m.world.ships[m.current];
      const to = m.world.ships[(m.current + 1) % 3];
      m.setAim((Math.atan2(-(to.y - from.y), to.x - from.x) * 180) / Math.PI, 50);
      m.commit();
    }
    run(m, (x) => x.phase === 'roundOver', 60);
    expect(m.phase).toBe('roundOver');
    expect(m.players.every((p) => !p.alive)).toBe(true);
    expect(m.summary).toMatchObject({ title: 'noneLeft', survivor: null });
  });

  it('lets CPUs aim in parallel and finishes a whole round', () => {
    const s = seats(0, 4);
    const m = createMatch('classic', { ...DEFAULT_SETTINGS, rounds: 1, seats: s, simultaneousShots: true }, { seats: s });
    run(m, (x) => x.phase === 'roundOver', 600);
    expect(m.phase).toBe('roundOver');
    expect(m.summary).not.toBeNull();
  });

  it('is off by default: one shot per turn', () => {
    const s = seats(2);
    const m = createMatch('classic', { ...DEFAULT_SETTINGS, rounds: 1, seats: s }, { seats: s });
    expect(m.salvo).toBe(false);
    m.setAim(0, 20);
    m.commit();
    expect(m.phase).toBe('flying');
    expect(m.volley!.shots).toHaveLength(1);
  });

  it('keeps the neighbour grace period working', () => {
    const s = seats(0, 4);
    const m = createMatch('classic', { ...DEFAULT_SETTINGS, rounds: 1, seats: s, simultaneousShots: true, neighborGrace: 2 }, { seats: s });
    run(m, (x) => x.phase === 'flying');
    expect(m.volley!.snapshot().aims.every((a) => a.spare?.length === 1)).toBe(true);
  });
});

describe('hidden aim', () => {
  const seats: Seat[] = ['human', 'human', 'medium', 'off', 'off', 'off'];
  const make = (hiddenAim: boolean, mode: 'classic' | 'horizon' = 'classic') =>
    createMatch(mode, { ...DEFAULT_SETTINGS, rounds: 1, seats, hiddenAim }, { seats });

  it('shows everything when the option is off', () => {
    const m = make(false);
    expect([0, 1, 2].every((id) => m.aimVisible(id))).toBe(true);
  });

  it('at a shared keyboard shows only whoever is on turn', () => {
    const m = make(true);
    const on = m.focus;
    expect(m.players[on].cpu).toBeFalsy();
    expect(m.aimVisible(on)).toBe(true);
    expect([0, 1, 2].filter((id) => id !== on).some((id) => m.aimVisible(id))).toBe(false);
  });

  it('online shows only the viewer\'s own aim, also in Event Horizon', () => {
    for (const mode of ['classic', 'horizon'] as const) {
      const m = make(true, mode);
      m.viewer = 1;
      expect([0, 1, 2].map((id) => m.aimVisible(id))).toEqual([false, true, false]);
    }
  });
});

describe('fading trails', () => {
  const seats: Seat[] = ['human', 'human', 'off', 'off', 'off', 'off'];
  const trail = (at: number) => ({ owner: 0, points: [0, 0, 1, 1], volley: 1, at });

  it('keeps trails for good when the option is off', () => {
    const m = createMatch('classic', { ...DEFAULT_SETTINGS, seats }, { seats });
    m.clock = 1000;
    expect(m.trailAlpha(trail(0))).toBe(1);
  });

  it('holds a fresh trail, fades it, then drops it', () => {
    const m = createMatch('classic', { ...DEFAULT_SETTINGS, seats, fadingTrails: 4 }, { seats });
    m.clock = 10;
    expect(m.trailAlpha(trail(10))).toBe(1);
    // 4 s: 1.6 s fully visible, then 2.4 s of fading.
    expect(m.trailAlpha(trail(10 - 4 * TRAIL_FADE.HOLD))).toBe(1);
    expect(m.trailAlpha(trail(10 - 4 * TRAIL_FADE.HOLD - 1.2))).toBeCloseTo(0.5);
    expect(m.trailAlpha(trail(10 - 4))).toBe(0);
  });

  it('runs faster with a shorter lifetime', () => {
    const m = createMatch('classic', { ...DEFAULT_SETTINGS, seats, fadingTrails: 1 }, { seats });
    m.clock = 10;
    expect(m.trailAlpha(trail(9))).toBe(0);
    expect(m.trailAlpha(trail(9.5))).toBeGreaterThan(0);
  });
});
