import { describe, expect, it } from 'vitest';
import { keepPace, newPace } from '../../src/render/looks/forged-sky';

type Pace = ReturnType<typeof newPace>;

/** Runs this many frames, each this many milliseconds after the last. */
const draw = (pace: Pace, frames: number, ms: number): void => {
  for (let i = 0; i < frames; i++) keepPace(pace, ms / 1000);
};

describe('forged sprite pace', () => {
  it('keeps full detail on a frame only just over a sixtieth of a second', () => {
    const pace = newPace();
    draw(pace, 2000, 17);
    expect(pace.lean).toBe(0);
  });

  it('keeps full detail through a short busy stretch', () => {
    const pace = newPace();
    draw(pace, 200, 30);
    draw(pace, 100, 10);
    draw(pace, 200, 30);
    expect(pace.lean).toBe(0);
  });

  it('steps down when frames stay slow, and only as far as there are steps', () => {
    const pace = newPace();
    draw(pace, 300, 40);
    draw(pace, 60, 25);
    expect(pace).toMatchObject({ lean: 1, stuck: false });
    draw(pace, 300, 25);
    draw(pace, 60, 20);
    expect(pace.lean).toBe(2);
    draw(pace, 1000, 25);
    expect(pace.lean).toBe(2);
  });

  it('steps back up once the frames have room for what the step saved, with the margin', () => {
    const pace = newPace();
    draw(pace, 300, 30);
    draw(pace, 60, 20);
    expect(pace.lean).toBe(1);
    expect(pace.saved[0]).toBeGreaterThan(0.005);
    // The saving of about 10 ms does not fit in the margin at 7 ms.
    draw(pace, 1000, 7);
    expect(pace.lean).toBe(1);
    draw(pace, 700, 5);
    expect(pace.lean).toBe(0);
  });

  it('never steps up past full detail', () => {
    const pace = newPace();
    draw(pace, 2000, 1);
    expect(pace.lean).toBe(0);
  });

  it('takes back a step that saved nothing, and tries again only after the frames recover', () => {
    const pace = newPace();
    draw(pace, 400, 40);
    expect(pace).toMatchObject({ lean: 0, stuck: true });
    draw(pace, 1000, 40);
    expect(pace).toMatchObject({ lean: 0, stuck: true });
    draw(pace, 100, 5);
    expect(pace.stuck).toBe(false);
    draw(pace, 330, 40);
    expect(pace.lean).toBe(1);
  });
});
