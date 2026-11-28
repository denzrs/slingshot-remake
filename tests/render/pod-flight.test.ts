import { describe, expect, it } from 'vitest';
import { flyPodFrame, launchPod, POD, standsSlot, type PodGoal } from '../../src/render/pod-flight';

const W = 1280;
const H = 800;
const FRAME = 1 / 60;

/** The orbit slot round a ship at (640, 400), as `Renderer.drawPods` sets it: where it is and how it moves at `t`. */
function slot(t: number): PodGoal {
  const angle = t * POD.ORBIT_SPEED;
  const r = POD.ORBIT;
  return { x: 640 + Math.cos(angle) * r, y: 400 + Math.sin(angle) * r, vx: -Math.sin(angle) * r * POD.ORBIT_SPEED, vy: Math.cos(angle) * r * POD.ORBIT_SPEED };
}

/** A pod flung out of a wreck at (300, 300), then sent to the orbit slot; every frame's place, speed and nose. */
function fly(seconds: number, frame = FRAME) {
  const pod = launchPod(300, 300, 0.4, 0, 1);
  const frames: { t: number; x: number; y: number; speed: number; heading: number }[] = [];
  for (let t = frame; t <= seconds; t += frame) {
    const launching = t < POD.LAUNCH_SECONDS;
    const speed = flyPodFrame(pod, frame, launching ? null : slot(t), launching, W, H);
    frames.push({ t, x: pod.x, y: pod.y, speed, heading: pod.heading });
  }
  return frames;
}

describe('an escape pod in flight', () => {
  it('never jumps: from one frame to the next it moves no further than its speed allows', () => {
    const frames = fly(8);
    for (let i = 1; i < frames.length; i++) {
      const step = Math.hypot(frames[i].x - frames[i - 1].x, frames[i].y - frames[i - 1].y);
      expect(step).toBeLessThanOrEqual(Math.max(POD.LAUNCH_SPEED, POD.MAX_SPEED) * FRAME + 1e-6);
    }
  });

  it('never turns on the spot: its nose turns no faster than its turn rate, from the first frame on', () => {
    const frames = fly(8);
    for (let i = 1; i < frames.length; i++) {
      const turn = Math.abs(Math.atan2(Math.sin(frames[i].heading - frames[i - 1].heading), Math.cos(frames[i].heading - frames[i - 1].heading)));
      expect(turn).toBeLessThanOrEqual(POD.TURN * FRAME + 1e-9);
    }
  });

  it('slows into the orbit and stays in its slot', () => {
    const frames = fly(10);
    const last = frames[frames.length - 1];
    const goal = slot(last.t);
    expect(Math.hypot(last.x - goal.x!, last.y - goal.y!)).toBeLessThan(2);
    expect(Math.abs(last.speed - POD.ORBIT * POD.ORBIT_SPEED)).toBeLessThan(2);
  });

  it('comes round in a curve when its goal lies behind it, flying the way its nose points all along', () => {
    // Flung right, then sent to a slot behind it on the left: it slows while it turns, and never flies backwards.
    const pod = launchPod(600, 400, 0, 0, 1);
    for (let t = FRAME; t <= 6; t += FRAME) {
      const launching = t < POD.LAUNCH_SECONDS;
      flyPodFrame(pod, FRAME, launching ? null : { x: 300, y: 400, vx: 0, vy: 0 }, launching, W, H);
      const speed = Math.hypot(pod.vx, pod.vy);
      if (speed > 1e-6) expect((pod.vx * Math.cos(pod.heading) + pod.vy * Math.sin(pod.heading)) / speed).toBeGreaterThan(0.999);
    }
    expect(Math.hypot(pod.x - 300, pod.y - 400)).toBeLessThan(3);
  });

  it('flies the same path at 15 frames a second as at 60', () => {
    const fast = fly(6);
    const slow = fly(6, 1 / 15);
    const a = fast[fast.length - 1];
    const b = slow[slow.length - 1];
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(3);
  });
});

describe('the stands round a ship', () => {
  it('shows every UFO: the inner ring fills first, then roomier rings further out', () => {
    expect(standsSlot(0, 3)).toEqual({ ring: 0, slot: 0, of: 3 });
    expect(standsSlot(POD.STANDS_FIRST - 1, 20)).toEqual({ ring: 0, slot: POD.STANDS_FIRST - 1, of: POD.STANDS_FIRST });
    expect(standsSlot(POD.STANDS_FIRST, 20)).toEqual({ ring: 1, slot: 0, of: 20 - POD.STANDS_FIRST });
    // Twenty in the stands, all for one ship: two rings, nobody left out.
    const places = Array.from({ length: 20 }, (_, i) => standsSlot(i, 20));
    expect(new Set(places.map((p) => `${p.ring}:${p.slot}`)).size).toBe(20);
    expect(Math.max(...places.map((p) => p.ring))).toBe(1);
  });
});
