import { describe, expect, it } from 'vitest';
import { stickAim, stickKnob } from '../../src/ui/touch/touchstick';

describe('the aiming stick', () => {
  it('shoots the other way from the pull, as hard as it is long', () => {
    // Pulled straight down: the shot goes up.
    expect(stickAim(0, 100, 100)).toEqual({ angle: 90, power: 100 });
    expect(stickAim(0, 50, 100)).toEqual({ angle: 90, power: 50 });
    // Pulled left: the shot goes right; pulled right: left; pulled up: down.
    expect(stickAim(-100, 0, 100)).toEqual({ angle: 0, power: 100 });
    expect(stickAim(100, 0, 100)).toEqual({ angle: 180, power: 100 });
    expect(stickAim(0, -100, 100)?.angle).toBe(270);
  });

  it('takes no knob at rest, and never more than the cap or the radius', () => {
    expect(stickAim(2, 3, 100)).toBeNull();
    expect(stickAim(0, 400, 100)?.power).toBe(100);
    expect(stickAim(0, 90, 100, 60)?.power).toBe(60);
  });

  it('snaps the angle to half a degree and keeps it in 0–360', () => {
    expect(stickAim(-100, -0.3, 100)?.angle).toBe(0);
    const angle = stickAim(-100, 2, 100)!.angle;
    expect(angle).toBeGreaterThanOrEqual(0);
    expect(angle * 2).toBe(Math.round(angle * 2));
  });

  it('puts the knob back where the finger had it', () => {
    for (const [angle, power] of [[0, 40], [47.5, 100], [180, 20], [271.5, 75]] as const) {
      const { x, y } = stickKnob(angle, power, 100);
      expect(stickAim(x, y, 100)).toEqual({ angle, power });
    }
  });
});
