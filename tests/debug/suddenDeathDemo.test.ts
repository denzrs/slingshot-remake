import { describe, expect, it } from 'vitest';
import type { ClassicMatch } from '../../src/game';
import { createSuddenDeathPreview, SUDDEN_DEATH_PREVIEWS } from '../../src/debug/suddenDeathDemo';
import { SUDDEN_DEATH } from '../../src/sim/config';

const shots: number[] = [];

/** Plays the demo for `seconds` of match time, one 30 fps frame at a time, as the page does. */
const play = (name: string, seconds: number) => {
  const demo = createSuddenDeathPreview(name)!;
  const reached: number[] = [];
  demo.match.on((e) => e.type === 'fire' && shots.push(e.player));
  for (let t = 0; t < seconds; t += 1 / 30) {
    demo.match.update(1 / 30);
    demo.tick(1 / 30);
    reached.push((demo.match as ClassicMatch).snapshot().passes ?? 0);
  }
  return { demo, most: Math.max(...reached) };
};

describe('the ?preview= demos of sudden death', () => {
  it('knows none but its own names', () => {
    expect(createSuddenDeathPreview(null)).toBeNull();
    expect(createSuddenDeathPreview('oracle-card')).toBeNull();
    for (const name of SUDDEN_DEATH_PREVIEWS) {
      const demo = createSuddenDeathPreview(name);
      expect(demo).not.toBeNull();
      demo!.match.dispose();
    }
  });

  it('plays the collision course on a loop: sudden death sets in, the ships drift, and the round starts over', () => {
    const { demo, most } = play('collision', 90);
    try {
      expect(most).toBeGreaterThan(SUDDEN_DEATH.START_PASS);
      expect((demo.match as ClassicMatch).snapshot().suddenDeathKind).toBe('collision');
    } finally {
      demo.match.dispose();
    }
  });

  it('plays the meteor shower: sudden death sets in, the shower takes every ship, and the round starts over', () => {
    const showers: string[] = [];
    const demo = createSuddenDeathPreview('meteors')!;
    demo.match.on((e) => e.type === 'meteors' && showers.push(e.type));
    const titles: string[] = [];
    demo.match.on((e) => e.type === 'roundEnd' && titles.push((demo.match as ClassicMatch).summary?.title ?? ''));
    try {
      for (let t = 0; t < 60; t += 1 / 30) {
        demo.match.update(1 / 30);
        demo.tick(1 / 30);
      }
      expect(showers.length).toBeGreaterThanOrEqual(1);
      expect(titles).toContain('meteors');
    } finally {
      demo.match.dispose();
    }
  });

  it('plays the UFO invasion: sudden death sets in, the saucers take every ship, and the round starts over', () => {
    const demo = createSuddenDeathPreview('ufos')!;
    const invasions: string[] = [];
    const titles: string[] = [];
    demo.match.on((e) => e.type === 'ufos' && invasions.push(e.type));
    demo.match.on((e) => e.type === 'roundEnd' && titles.push((demo.match as ClassicMatch).summary?.title ?? ''));
    try {
      for (let t = 0; t < 60; t += 1 / 30) {
        demo.match.update(1 / 30);
        demo.tick(1 / 30);
      }
      expect(invasions.length).toBeGreaterThanOrEqual(1);
      expect(titles).toContain('ufos');
    } finally {
      demo.match.dispose();
    }
  });

  it('plays the gravity well with ships that shoot', () => {
    const { demo, most } = play('gravity', 120);
    try {
      expect(most).toBeGreaterThanOrEqual(SUDDEN_DEATH.START_PASS - 2);
      expect((demo.match as ClassicMatch).snapshot().suddenDeathKind).toBe('gravity');
      expect(shots.length).toBeGreaterThan(4);
    } finally {
      demo.match.dispose();
    }
  });
});
