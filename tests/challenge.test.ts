import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  baselineScore,
  buildSector,
  challengeNumber,
  dailyChallenge,
  isDateKey,
  modifiersOf,
  rankOf,
  sectorRules,
  type Sector,
  type SectorSpec,
  shiftDate,
  themeFor,
  THEMES,
  weekday,
} from '../src/challenge';
import { AIM, CHALLENGE, FIELD, PHYSICS, SCORING } from '../src/config';
import { loadDay, loadStreak, recordRun } from '../src/dailyStore';
import { createChallenge, type ChallengeMatch } from '../src/game';
import { cloneWorld, simulateShot } from '../src/physics';
import { DEFAULT_SETTINGS } from '../src/settings';
import { shareText } from '../src/ui/daily';

const START = CHALLENGE.EPOCH;
const days = (n: number, from = START) => Array.from({ length: n }, (_, i) => shiftDate(from, i));

describe('calendar', () => {
  it('numbers the days from the launch', () => {
    expect(challengeNumber(START)).toBe(1);
    expect(challengeNumber(shiftDate(START, 40))).toBe(41);
  });

  it('knows the weekday and rolls over months and years', () => {
    expect(weekday('2026-10-02')).toBe(4); // a Friday
    expect(weekday('2026-10-05')).toBe(0);
    expect(shiftDate('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftDate('2028-03-01', -1)).toBe('2028-02-29');
  });

  it('validates date keys', () => {
    expect(isDateKey('2026-10-02')).toBe(true);
    expect(isDateKey('2026-02-30')).toBe(false);
    expect(isDateKey('02.10.2026')).toBe(false);
    expect(isDateKey(null)).toBe(false);
  });
});

describe('themes', () => {
  it('plays every theme once per cycle', () => {
    for (let cycle = 0; cycle < 12; cycle++) {
      const seen = Array.from({ length: THEMES.length }, (_, i) => themeFor(cycle * THEMES.length + i + 1));
      expect(new Set(seen).size).toBe(THEMES.length);
    }
  });

  it('never repeats a theme two days in a row', () => {
    for (let n = 1; n < 400; n++) expect(themeFor(n + 1)).not.toBe(themeFor(n));
  });
});

describe('daily challenge', () => {
  it('is the same on every machine: pure function of the date', () => {
    expect(dailyChallenge('2026-10-09')).toEqual(dailyChallenge('2026-10-09'));
    const a = buildSector(dailyChallenge('2026-10-09').sectors[3]);
    const b = buildSector(dailyChallenge('2026-10-09').sectors[3]);
    expect(a).toEqual(b);
  });

  it('differs from day to day', () => {
    const seeds = new Set(days(30).flatMap((d) => dailyChallenge(d).sectors.map((s) => s.seed)));
    expect(seeds.size).toBe(30 * CHALLENGE.SECTORS);
  });

  it('ramps up through the day and with the weekend', () => {
    for (const d of days(28)) {
      const { sectors } = dailyChallenge(d);
      expect(sectors).toHaveLength(CHALLENGE.SECTORS);
      for (const s of sectors) {
        expect(s.difficulty).toBeGreaterThanOrEqual(1);
        expect(s.difficulty).toBeLessThanOrEqual(5);
        expect(s.targets).toBeGreaterThanOrEqual(1);
        expect(s.targets).toBeLessThanOrEqual(3);
        expect(s.shots).toBeGreaterThanOrEqual(s.targets);
        // A hidden hole would hide the hole too.
        expect(s.invisible && s.hole).toBe(false);
      }
      expect(sectors[4].difficulty).toBeGreaterThanOrEqual(sectors[0].difficulty);
    }
    const monday = dailyChallenge('2026-10-05');
    const saturday = dailyChallenge('2026-10-10');
    expect(monday.sectors[0].difficulty).toBe(1);
    expect(saturday.sectors[4].difficulty).toBe(5);
  });

  it('applies the theme of the day', () => {
    const all = days(70).map((d) => dailyChallenge(d));
    for (const ch of all) {
      const mods = ch.sectors.map(modifiersOf);
      if (ch.theme === 'billiard') expect(mods.slice(1).every((m) => m.includes('bounce'))).toBe(true);
      if (ch.theme === 'blind') expect(mods.slice(2).every((m) => m.includes('invisible'))).toBe(true);
      if (ch.theme === 'singularity') expect(mods.slice(2).every((m) => m.includes('hole'))).toBe(true);
      if (ch.theme === 'heavy') expect(mods.slice(1).every((m) => m.includes('heavy'))).toBe(true);
      if (ch.theme === 'precision') expect(mods.slice(1).every((m) => m.includes('fixedPower'))).toBe(true);
    }
  });
});

describe('sector layout', () => {
  // Every day for five weeks, every sector: the whole point is that none of them can be broken.
  const sectors = days(35).flatMap((d) => dailyChallenge(d).sectors.map((spec) => ({ day: d, spec })));
  // Built once for the two sweeps below — a CI runner needs a few seconds for all 175.
  let built: { day: string; spec: SectorSpec; sector: Sector }[] | null = null;
  const buildAll = () => (built ??= sectors.map(({ day, spec }) => ({ day, spec, sector: buildSector(spec) })));
  const SWEEP_TIMEOUT = 60_000;

  it('puts every target on a path the player can actually fly', () => {
    for (const { day, spec, sector } of buildAll()) {
      const { world, solutions } = sector;
      const rules = sectorRules(spec);
      expect(solutions.length, `${day} sector ${spec.index}`).toBe(spec.targets);
      expect(world.ships).toHaveLength(1 + spec.targets);
      for (const s of solutions) {
        const { end } = simulateShot(cloneWorld(world), 0, s.angle, s.power, rules);
        expect(end, `${day} sector ${spec.index} target ${s.target}`).toEqual({ kind: 'ship', ship: s.target });
        expect(s.window).toBeGreaterThanOrEqual(0.08);
      }
    }
  }, SWEEP_TIMEOUT);

  it('keeps targets in the field, away from planets, the hole and each other', () => {
    for (const { day, spec, sector } of buildAll()) {
      const { world } = sector;
      const [me, ...targets] = world.ships;
      targets.forEach((t, i) => {
        const label = `${day} sector ${spec.index} target ${i + 1}`;
        expect(t.x, label).toBeGreaterThan(0);
        expect(t.x, label).toBeLessThan(FIELD.width);
        expect(t.y, label).toBeGreaterThan(0);
        expect(t.y, label).toBeLessThan(FIELD.height);
        for (const p of world.planets) expect(Math.hypot(p.x - t.x, p.y - t.y), label).toBeGreaterThan(p.radius + PHYSICS.SHIP_RADIUS);
        if (world.hole) expect(Math.hypot(world.hole.x - t.x, world.hole.y - t.y), label).toBeGreaterThan(world.hole.radius + PHYSICS.SHIP_RADIUS);
        expect(Math.hypot(me.x - t.x, me.y - t.y), label).toBeGreaterThan(100);
        targets.slice(i + 1).forEach((o) => expect(Math.hypot(o.x - t.x, o.y - t.y), label).toBeGreaterThan(60));
      });
      expect(world.hole !== null).toBe(spec.hole);
    }
  }, SWEEP_TIMEOUT);

  it('builds a sector fast enough to do between two rounds', () => {
    const t0 = performance.now();
    for (const { spec } of sectors.slice(0, 40)) buildSector(spec);
    expect((performance.now() - t0) / 40).toBeLessThan(250);
  });
});

describe('ranking', () => {
  it('climbs the ladder with the share of the flawless baseline', () => {
    const ch = dailyChallenge(START);
    const base = baselineScore(ch);
    expect(rankOf(0, ch)).toBe(0);
    expect(rankOf(-500, ch)).toBe(0);
    expect(rankOf(base * 0.6, ch)).toBe(2);
    expect(rankOf(base * 1.4, ch)).toBe(5);
  });
});

/** Fly a match headlessly until the current volley has landed. */
function settle(m: ChallengeMatch): void {
  for (let i = 0; i < 20_000 && m.phase === 'flying'; i++) m.update(1 / 30);
}

function pass(m: ChallengeMatch): void {
  m.update(1);
  m.advance();
}

describe('challenge match', () => {
  const ch = dailyChallenge('2026-10-09');

  it('can be won by flying the known solutions', () => {
    const m = createChallenge(DEFAULT_SETTINGS, ch);
    for (let i = 0; i < ch.sectors.length; i++) {
      const sector = buildSector(ch.sectors[i]);
      expect(m.round).toBe(i + 1);
      expect(m.targetsTotal).toBe(sector.solutions.length);
      for (const s of sector.solutions) {
        expect(m.phase).toBe('aiming');
        m.setAim(s.angle, s.power);
        m.commit();
        settle(m);
      }
      expect(m.phase).toBe('roundOver');
      expect(m.summary?.title).toBe('cleared');
      pass(m);
    }
    expect(m.phase).toBe('gameOver');

    const r = m.result();
    expect(r.sectors.every((s) => s.cleared && s.shots.every((x) => x.kind === 'hit'))).toBe(true);
    expect(r.sectors.every((s) => s.bonus === CHALLENGE.CLEAR_BONUS)).toBe(true);
    // Every target on the first try: no shot factor penalty, so each hit is worth at least base × 0.5 (power) × 1.
    expect(r.total).toBe(r.sectors.reduce((sum, s) => sum + s.points, 0));
    const hits = r.sectors.flatMap((s) => s.shots);
    expect(hits.every((h) => h.points >= SCORING.BASE * 0.5)).toBe(true);
    expect(r.total).toBeGreaterThan(baselineScore(ch) * 0.5);
    expect(r.rank).toBeGreaterThanOrEqual(2);
  });

  it('starts a retry from zero with the same sectors', () => {
    const m = createChallenge(DEFAULT_SETTINGS, ch);
    const first = buildSector(ch.sectors[0]).solutions[0];
    m.setAim(first.angle, first.power);
    m.commit();
    settle(m);
    expect(m.total).toBeGreaterThan(0);
    m.newMatch();
    expect(m.round).toBe(1);
    expect(m.total).toBe(0);
    expect(m.results).toEqual([]);
    expect(m.shotsLeft).toBe(ch.sectors[0].shots);
    expect(m.targetsLeft).toBe(m.targetsTotal);
  });

  it('fails the sector when the shots run out, without punishing the score', () => {
    const m = createChallenge(DEFAULT_SETTINGS, ch);
    const budget = m.spec.shots;
    const rules = sectorRules(m.spec);
    // Find an aim that wastes the shot: not a target, not the own ship.
    let angle = 0;
    while (simulateShot(cloneWorld(m.world), 0, angle, 50, rules).end.kind === 'ship') angle += 7;
    for (let i = 0; i < budget; i++) {
      expect(m.phase).toBe('aiming');
      m.setAim(angle, 50);
      m.commit();
      settle(m);
    }
    expect(m.phase).toBe('roundOver');
    expect(m.summary?.title).toBe('outOfShots');
    const sector = m.results[0];
    expect(sector.cleared).toBe(false);
    expect(sector.shots).toHaveLength(budget);
    expect(sector.shots.every((s) => s.kind === 'miss')).toBe(true);
    expect(sector.points).toBe(0);
  });

  it('charges the self-hit penalty and ends the sector', () => {
    const m = createChallenge(DEFAULT_SETTINGS, ch);
    // An empty field with reflecting edges: a shot at the left wall comes straight back.
    m.world.planets.length = 0;
    m.world.ships[0].x = 200;
    m.world.ships[0].y = 400;
    Object.assign(m.spec, { bounce: true, fixedPower: false });
    m.setAim(180, 50);
    m.commit();
    settle(m);
    expect(m.phase).toBe('roundOver');
    expect(m.summary?.title).toBe('selfHit');
    expect(m.total).toBe(-SCORING.SELF_HIT);
    expect(m.results[0].shots[0].kind).toBe('self');
    expect(m.results[0].cleared).toBe(false);
  });

  it('lowers the payout for every extra shot on the same target', () => {
    const run = (misses: number) => {
      const m = createChallenge(DEFAULT_SETTINGS, ch);
      const sector = buildSector(ch.sectors[0]);
      const rules = sectorRules(m.spec);
      let angle = 0;
      while (simulateShot(cloneWorld(m.world), 0, angle, 50, rules).end.kind === 'ship') angle += 7;
      for (let i = 0; i < misses; i++) {
        m.setAim(angle, 50);
        m.commit();
        settle(m);
      }
      const s = sector.solutions[0];
      m.setAim(s.angle, s.power);
      m.commit();
      settle(m);
      return m.results.length ? m.results[0].shots.at(-1)!.points : m.pilot.score;
    };
    // Same winning shot after 0 and 2 wasted shots: 100 % vs 70 %.
    const clean = run(0);
    const late = run(2);
    expect(late).toBeLessThan(clean);
    expect(late).toBeCloseTo(clean * 0.7, -2);
  });
});

describe('daily store', () => {
  const memory = new Map<string, string>();
  beforeEach(() => {
    memory.clear();
    Object.assign(globalThis, {
      localStorage: {
        getItem: (k: string) => memory.get(k) ?? null,
        setItem: (k: string, v: string) => void memory.set(k, v),
      },
    });
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it('keeps the best run of a day and counts attempts', () => {
    const first = recordRun('2026-10-09', 4000);
    expect(first).toMatchObject({ record: { best: 4000, attempts: 1 }, newBest: false, streak: 1 });
    expect(recordRun('2026-10-09', 3000)).toMatchObject({ record: { best: 4000, attempts: 2 }, newBest: false });
    expect(recordRun('2026-10-09', 5200)).toMatchObject({ record: { best: 5200, attempts: 3 }, newBest: true });
    expect(loadDay('2026-10-09')).toEqual({ best: 5200, attempts: 3 });
    expect(loadDay('2026-10-10')).toBeNull();
  });

  it('counts a streak of consecutive days and lets it survive until today is flown', () => {
    for (const d of ['2026-10-07', '2026-10-08', '2026-10-09']) recordRun(d, 1000);
    expect(loadStreak('2026-10-09')).toBe(3);
    expect(loadStreak('2026-10-10')).toBe(3);
    expect(loadStreak('2026-10-11')).toBe(0);
    recordRun('2026-10-11', 1000);
    expect(loadStreak('2026-10-11')).toBe(1);
  });

  it('survives corrupt storage', () => {
    memory.set('slingshot.daily.v1', '{not json');
    expect(loadDay('2026-10-09')).toBeNull();
    expect(recordRun('2026-10-09', 100).record.attempts).toBe(1);
  });
});

describe('share text', () => {
  it('shows score, rank and one row of squares per sector', () => {
    const ch = dailyChallenge('2026-10-09');
    const m = createChallenge(DEFAULT_SETTINGS, ch);
    const s = buildSector(ch.sectors[0]).solutions[0];
    m.setAim(s.angle, s.power);
    m.commit();
    settle(m);
    pass(m);
    const lines = shareText(m).split('\n');
    expect(lines[0]).toContain(`#${ch.number}`);
    expect(lines.some((l) => /^1 [🟩🟨⬛🟥]+/u.test(l))).toBe(true);
  });
});

describe('the daily challenge and a fixed power level', () => {
  it('keeps its own fixed power, whatever level is set up for normal games', () => {
    // A precision day: fixed power from the second sector on.
    let day = '2026-10-02';
    while (dailyChallenge(day).theme !== 'precision') day = shiftDate(day, 1);
    const m = createChallenge({ ...DEFAULT_SETTINGS, fixedPower: true, fixedPowerLevel: 90 }, dailyChallenge(day));
    m.startRound();
    expect(m.spec.fixedPower).toBe(true);
    expect(m.pilot.power).toBe(AIM.FIXED_POWER);
  });
});
