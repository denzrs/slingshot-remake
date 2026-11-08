import { afterEach, describe, expect, it, vi } from 'vitest';
import { AIM } from '../../src/sim/config';
import { Gamepads, padKeyEvent, pressMenuKey, type GamepadHandlers } from '../../src/ui/gamepad/gamepad';
import { DEADZONE, EMIT_EVERY, HOLD, MENU_HOLD, PAD, PadMapper, STICK_RATE, stepSize, stickPush, type PadAction, type PadContext, type PadLike } from '../../src/ui/gamepad/mapping';

/** A pad as the browser would hand it over: the buttons that are down, the left stick's push. */
function pad(down: number[] = [], stick: [number, number] = [0, 0], over: Partial<PadLike> = {}): PadLike {
  return {
    connected: true,
    mapping: 'standard',
    axes: [stick[0], stick[1], 0, 0],
    buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: down.includes(i) })),
    ...over,
  };
}

/** Plays a series of looks at one pad, `step` ms apart, and returns what each one asked for. */
function run(mapper: PadMapper, context: PadContext, looks: PadLike[], start = 1000, step = 16): PadAction[][] {
  return looks.map((look, i) => mapper.poll(look, start + i * step, context).actions);
}

const adjusts = (frames: PadAction[][]) => frames.flat().filter((a) => a.kind === 'adjust');

describe('the stick', () => {
  it('does nothing inside the dead zone and is stretched over the rest of the travel', () => {
    expect(stickPush(0.1, 0.1)).toEqual([0, 0]);
    expect(stickPush(DEADZONE - 0.01, 0)).toEqual([0, 0]);
    expect(stickPush(1, 0)).toEqual([1, 0]);
    const [x] = stickPush(0.625, 0);
    expect(x).toBeCloseTo(0.5, 5);
  });

  it('lets a diagonal push through, but drops the axis that is only a slip of the thumb', () => {
    const [x, y] = stickPush(0.3, -0.9);
    expect(x).toBe(0);
    expect(y).toBeLessThan(0);
    const [dx, dy] = stickPush(0.7, -0.7);
    expect(dx).toBeGreaterThan(0);
    expect(dy).toBeLessThan(0);
  });
});

describe('the step size', () => {
  it('is fine on the left shoulder, coarse on the right, finest on both', () => {
    expect(stepSize(false, false)).toBe('normal');
    expect(stepSize(true, false)).toBe('small');
    expect(stepSize(false, true)).toBe('large');
    expect(stepSize(true, true)).toBe('tiny');
  });
});

describe('the buttons in a match', () => {
  it('turns A, B, Start, X, Y and Back into one action each, on the press only', () => {
    const m = new PadMapper();
    const frames = run(m, 'game', [pad(), pad([PAD.A]), pad([PAD.A]), pad(), pad([PAD.B]), pad([PAD.START]), pad([PAD.X]), pad([PAD.Y]), pad([PAD.BACK])]);
    expect(frames.map((f) => f.map((a) => a.kind))).toEqual([[], ['primary'], [], [], ['escape'], ['escape'], ['power'], ['skip'], ['clip']]);
  });

  it('presses again only after a button was let go', () => {
    const m = new PadMapper();
    const frames = run(m, 'game', [pad(), pad([PAD.A]), pad([PAD.A]), pad([PAD.A]), pad(), pad([PAD.A])]);
    expect(frames.flat().filter((a) => a.kind === 'primary')).toHaveLength(2);
  });

  it('does not take the press that woke the pad, nor a button held when a menu gives way to the match', () => {
    const m = new PadMapper();
    expect(m.poll(pad([PAD.A]), 0, 'game').actions).toEqual([]);
    expect(m.poll(pad([PAD.A]), 16, 'game').actions).toEqual([]);
    const n = new PadMapper();
    n.poll(pad(), 0, 'menu');
    expect(n.poll(pad([PAD.A]), 16, 'menu').actions).toEqual([{ kind: 'key', key: 'Enter', repeat: false }]);
    // The same press still being held when the match takes over fires no shot.
    expect(n.poll(pad([PAD.A]), 32, 'game').actions).toEqual([]);
  });

  it('knows when the pad was in use', () => {
    const m = new PadMapper();
    expect(m.poll(pad(), 0, 'game').active).toBe(false);
    expect(m.poll(pad([], [0.1, 0.1]), 16, 'game').active).toBe(false);
    expect(m.poll(pad([], [0.9, 0]), 32, 'game').active).toBe(true);
    expect(m.poll(pad([PAD.LB]), 48, 'game').active).toBe(true);
  });
});

describe('the D-pad in a match', () => {
  const [angle, power] = AIM.STEPS.normal;

  it('steps once at the press, like a key: left turns up, right down, up and down change the power', () => {
    const m = new PadMapper();
    m.poll(pad(), 0, 'game');
    expect(m.poll(pad([PAD.LEFT]), 16, 'game').actions).toEqual([{ kind: 'adjust', dAngle: angle, dPower: 0 }]);
    m.poll(pad(), 32, 'game');
    expect(m.poll(pad([PAD.RIGHT]), 48, 'game').actions).toEqual([{ kind: 'adjust', dAngle: -angle, dPower: 0 }]);
    m.poll(pad(), 64, 'game');
    expect(m.poll(pad([PAD.UP]), 80, 'game').actions).toEqual([{ kind: 'adjust', dAngle: 0, dPower: power }]);
    m.poll(pad(), 96, 'game');
    expect(m.poll(pad([PAD.DOWN]), 112, 'game').actions).toEqual([{ kind: 'adjust', dAngle: 0, dPower: -power }]);
  });

  it('waits a moment when held, then goes on by itself', () => {
    const m = new PadMapper();
    m.poll(pad(), 0, 'game');
    const held = pad([PAD.LEFT]);
    expect(adjusts([m.poll(held, 0, 'game').actions])).toHaveLength(1);
    expect(adjusts([m.poll(held, HOLD.delay - 10, 'game').actions])).toHaveLength(0);
    expect(adjusts([m.poll(held, HOLD.delay + 1, 'game').actions])).toHaveLength(1);
    expect(adjusts([m.poll(held, HOLD.delay + HOLD.every / 2, 'game').actions])).toHaveLength(0);
    expect(adjusts([m.poll(held, HOLD.delay + HOLD.every + 1, 'game').actions])).toHaveLength(1);
  });

  it('takes bigger steps the longer it is held, and stops when let go', () => {
    const m = new PadMapper();
    m.poll(pad(), 0, 'game');
    const held = pad([PAD.UP]);
    let t = 0;
    m.poll(held, t, 'game');
    const sizes: number[] = [];
    for (let i = 0; i < HOLD.fasterAfter + 3; i++) {
      t += i === 0 ? HOLD.delay : HOLD.every;
      for (const a of adjusts([m.poll(held, t, 'game').actions])) if (a.kind === 'adjust') sizes.push(a.dPower);
    }
    expect(sizes.slice(0, HOLD.fasterAfter).every((s) => s === power)).toBe(true);
    expect(sizes.at(-1)).toBe(power * HOLD.faster);
    expect(adjusts([m.poll(pad(), t + 16, 'game').actions])).toHaveLength(0);
    expect(adjusts([m.poll(pad(), t + 1000, 'game').actions])).toHaveLength(0);
  });

  it('does not make up for a long gap, as when the tab was in the background', () => {
    const m = new PadMapper();
    m.poll(pad(), 0, 'game');
    m.poll(pad([PAD.LEFT]), 0, 'game');
    const n = adjusts([m.poll(pad([PAD.LEFT]), 60_000, 'game').actions]).length;
    expect(n).toBeLessThanOrEqual(1);
  });

  it('takes the left shoulder for fine steps, the right for coarse ones, both for the finest', () => {
    const step = (down: number[]) => {
      const m = new PadMapper();
      m.poll(pad(down.filter((b) => b === PAD.LB || b === PAD.RB)), 0, 'game');
      return m.poll(pad([...down, PAD.LEFT]), 16, 'game').actions[0];
    };
    expect(step([PAD.LB])).toEqual({ kind: 'adjust', dAngle: AIM.STEPS.small[0], dPower: 0 });
    expect(step([PAD.RB])).toEqual({ kind: 'adjust', dAngle: AIM.STEPS.large[0], dPower: 0 });
    expect(step([PAD.LB, PAD.RB])).toEqual({ kind: 'adjust', dAngle: AIM.STEPS.tiny[0], dPower: 0 });
  });

  it('stays quiet for a direction that was already held when the match began, until it is pressed again', () => {
    const m = new PadMapper();
    m.poll(pad([PAD.DOWN]), 0, 'menu');
    m.poll(pad([PAD.DOWN]), 16, 'menu');
    expect(adjusts(run(m, 'game', [pad([PAD.DOWN]), pad([PAD.DOWN]), pad([PAD.DOWN])], 32))).toHaveLength(0);
    expect(adjusts(run(m, 'game', [pad([PAD.DOWN]), pad([PAD.DOWN])], 5000))).toHaveLength(0);
    m.poll(pad(), 6000, 'game');
    expect(adjusts([m.poll(pad([PAD.DOWN]), 6016, 'game').actions])).toHaveLength(1);
  });
});

describe('the stick in a match', () => {
  /** Holds the stick for `ms`, a look every 16 ms, and adds up what it moved. */
  function hold(stick: [number, number], ms: number, down: number[] = []) {
    const m = new PadMapper();
    m.poll(pad(down), 0, 'game');
    let angle = 0;
    let power = 0;
    let sent = 0;
    for (let t = 16; t <= ms; t += 16) {
      for (const a of m.poll(pad(down, stick), t, 'game').actions) {
        if (a.kind !== 'adjust') continue;
        angle += a.dAngle;
        power += a.dPower;
        sent++;
      }
    }
    return { angle, power, sent };
  }

  it('moves nothing while it stays in the dead zone', () => {
    expect(hold([0.15, -0.15], 1000)).toEqual({ angle: 0, power: 0, sent: 0 });
  });

  it('turns the ship the way the stick leans, as fast as it is pushed', () => {
    const left = hold([-1, 0], 1000);
    const right = hold([1, 0], 1000);
    expect(left.angle).toBeGreaterThan(STICK_RATE.normal * 0.9);
    expect(left.angle).toBeLessThan(STICK_RATE.normal * 1.05);
    expect(right.angle).toBeCloseTo(-left.angle, 1);
    expect(left.power).toBe(0);
    const gentle = hold([-0.625, 0], 1000);
    expect(gentle.angle).toBeGreaterThan(0);
    expect(gentle.angle).toBeLessThan(left.angle / 2);
  });

  it('moves the power with up and down — up is more', () => {
    expect(hold([0, -1], 500).power).toBeGreaterThan(0);
    expect(hold([0, 1], 500).power).toBeLessThan(0);
    expect(hold([0, -1], 500).angle).toBe(0);
  });

  it('moves both at once on a diagonal', () => {
    const d = hold([-0.8, -0.8], 500);
    expect(d.angle).toBeGreaterThan(0);
    expect(d.power).toBeGreaterThan(0);
  });

  it('sends no more often than every so many ms', () => {
    const { sent } = hold([-1, 0], 1000);
    expect(sent).toBeLessThanOrEqual(Math.ceil(1000 / EMIT_EVERY) + 1);
    expect(sent).toBeGreaterThan(10);
  });

  it('is finer with the left shoulder and coarser with the right', () => {
    const normal = hold([-1, 0], 500).angle;
    expect(hold([-1, 0], 500, [PAD.LB]).angle).toBeLessThan(normal / 4);
    expect(hold([-1, 0], 500, [PAD.RB]).angle).toBeGreaterThan(normal * 2);
  });
});

describe('the pad in a menu', () => {
  const keys = (frames: PadAction[][]) => frames.flat().map((a) => (a.kind === 'key' ? `${a.key}${a.repeat ? '*' : ''}` : a.kind));

  it('presses Enter for A, Escape for B, and Q and E for the shoulders', () => {
    const m = new PadMapper();
    expect(keys(run(m, 'menu', [pad(), pad([PAD.A]), pad(), pad([PAD.B]), pad(), pad([PAD.LB]), pad(), pad([PAD.RB])]))).toEqual(['Enter', 'Escape', 'q', 'e']);
  });

  it('leaves the match buttons alone', () => {
    const m = new PadMapper();
    expect(keys(run(m, 'menu', [pad(), pad([PAD.X]), pad(), pad([PAD.Y]), pad(), pad([PAD.START])]))).toEqual([]);
  });

  it('presses the arrow for a D-pad direction, and repeats it, slower, while held', () => {
    const m = new PadMapper();
    m.poll(pad(), 0, 'menu');
    const held = pad([PAD.DOWN]);
    expect(keys([m.poll(held, 16, 'menu').actions])).toEqual(['ArrowDown']);
    expect(keys([m.poll(held, 16 + MENU_HOLD.delay - 20, 'menu').actions])).toEqual([]);
    expect(keys([m.poll(held, 16 + MENU_HOLD.delay + 1, 'menu').actions])).toEqual(['ArrowDown*']);
    expect(keys([m.poll(held, 16 + MENU_HOLD.delay + MENU_HOLD.every + 2, 'menu').actions])).toEqual(['ArrowDown*']);
    expect(keys([m.poll(pad(), 2000, 'menu').actions])).toEqual([]);
  });

  it('takes the stick as a D-pad, with some give before it lets go again', () => {
    const m = new PadMapper();
    m.poll(pad(), 0, 'menu');
    expect(keys([m.poll(pad([], [0.4, 0]), 16, 'menu').actions])).toEqual([]);
    expect(keys([m.poll(pad([], [0.8, 0.1]), 32, 'menu').actions])).toEqual(['ArrowRight']);
    // Eased off a little, still held; no second press.
    expect(keys([m.poll(pad([], [0.5, 0]), 48, 'menu').actions])).toEqual([]);
    expect(keys([m.poll(pad([], [0.2, 0]), 64, 'menu').actions])).toEqual([]);
    expect(keys([m.poll(pad([], [0, -0.9]), 80, 'menu').actions])).toEqual(['ArrowUp']);
  });
});

describe('the pads the browser reports', () => {
  /** Handlers that write down what they were asked. */
  function harness(context: PadContext | null = 'game') {
    const calls: string[] = [];
    let where = context;
    const handlers: GamepadHandlers = {
      context: () => where,
      adjust: (a, p) => calls.push(`adjust ${a} ${p}`),
      primary: () => calls.push('primary'),
      escape: () => calls.push('escape'),
      power: () => calls.push('power'),
      skip: () => calls.push('skip'),
      clip: () => calls.push('clip'),
      key: (k, r) => calls.push(`key ${k}${r ? '*' : ''}`),
      touched: () => calls.push('touched'),
      connection: (e) => calls.push(e),
    };
    let list: (PadLike | null)[] = [];
    const pads = new Gamepads(handlers, () => list);
    return {
      calls,
      pads,
      set: (...p: (PadLike | null)[]) => (list = p),
      context: (c: PadContext | null) => (where = c),
    };
  }

  it('knows nothing of a pad until the browser shows one, and says so when it does', () => {
    const h = harness();
    h.pads.poll(0);
    expect(h.pads.connected).toBe(false);
    expect(h.calls).toEqual([]);
    h.set(null, pad());
    h.pads.poll(16);
    expect(h.pads.connected).toBe(true);
    expect(h.calls).toEqual(['connected']);
    h.pads.poll(32);
    expect(h.calls).toEqual(['connected']);
  });

  it('says so when the last pad goes away, and not for each of two', () => {
    const h = harness();
    h.set(pad(), pad());
    h.pads.poll(0);
    h.set(null, pad());
    h.pads.poll(16);
    expect(h.calls).toEqual(['connected']);
    h.set(null, null);
    h.pads.poll(32);
    expect(h.calls).toEqual(['connected', 'lost']);
    expect(h.pads.connected).toBe(false);
    h.set(pad());
    h.pads.poll(48);
    expect(h.calls).toEqual(['connected', 'lost', 'connected']);
  });

  it('treats a pad that is no longer connected as gone', () => {
    const h = harness();
    h.set(pad());
    h.pads.poll(0);
    h.set(pad([], [0, 0], { connected: false }));
    h.pads.poll(16);
    expect(h.calls).toEqual(['connected', 'lost']);
  });

  it('only takes pads with the standard layout', () => {
    const h = harness();
    h.set(pad([], [0, 0], { mapping: '' }));
    h.pads.poll(0);
    expect(h.pads.connected).toBe(false);
    expect(h.calls).toEqual([]);
  });

  it('hands the actions to the handlers and says the pad was touched', () => {
    const h = harness('game');
    h.set(pad());
    h.pads.poll(0);
    h.calls.length = 0;
    h.set(pad([PAD.A]));
    h.pads.poll(16);
    expect(h.calls).toEqual(['touched', 'primary']);
    h.set(pad([PAD.LEFT]));
    h.pads.poll(32);
    expect(h.calls.at(-1)).toBe(`adjust ${AIM.STEPS.normal[0]} 0`);
  });

  it('sends keys to a menu, where the match is not', () => {
    const h = harness('menu');
    h.set(pad());
    h.pads.poll(0);
    h.set(pad([PAD.DOWN]));
    h.pads.poll(16);
    expect(h.calls).toContain('key ArrowDown');
    expect(h.calls).not.toContain('primary');
  });

  it('does nothing while nothing wants the pad, as when the chat has the keyboard', () => {
    const h = harness(null);
    h.set(pad());
    h.pads.poll(0);
    h.calls.length = 0;
    h.set(pad([PAD.A, PAD.DOWN]));
    h.pads.poll(16);
    expect(h.calls).toEqual(['touched']);
  });

  it('is deaf, and does not even say it was touched, while it is switched off — but still sees the pad', () => {
    const h = harness('game');
    h.pads.enabled = false;
    h.set(pad());
    h.pads.poll(0);
    h.set(pad([PAD.A, PAD.Y]));
    h.pads.poll(16);
    expect(h.calls).toEqual(['connected']);
    expect(h.pads.connected).toBe(true);
    // A button held through the switch-on is no press: it is in use, but it fires nothing.
    h.pads.enabled = true;
    h.pads.poll(32);
    expect(h.calls).toEqual(['connected', 'touched']);
  });

  it('lets each of two pads act', () => {
    const h = harness('game');
    h.set(pad(), pad());
    h.pads.poll(0);
    h.calls.length = 0;
    h.set(pad([PAD.A]), pad([PAD.X]));
    h.pads.poll(16);
    expect(h.calls.filter((c) => c === 'primary' || c === 'power')).toEqual(['primary', 'power']);
  });
});

describe('the keys a menu is moved with', () => {
  afterEach(() => vi.unstubAllGlobals());

  class FakeKeyboardEvent {
    readonly type: string;
    readonly key: string;
    readonly code: string;
    readonly repeat: boolean;
    constructor(type: string, init: { key: string; code: string; repeat: boolean }) {
      this.type = type;
      Object.assign(this, init);
      this.key = init.key;
      this.code = init.code;
      this.repeat = init.repeat;
    }
  }

  it('are keydown events with the key and its code', () => {
    vi.stubGlobal('KeyboardEvent', FakeKeyboardEvent);
    expect(padKeyEvent('ArrowDown', false)).toMatchObject({ type: 'keydown', key: 'ArrowDown', code: 'ArrowDown', repeat: false });
    expect(padKeyEvent('q', true)).toMatchObject({ key: 'q', code: 'KeyQ', repeat: true });
  });

  it('go to the row that has the focus, or to the page when nothing has', () => {
    vi.stubGlobal('KeyboardEvent', FakeKeyboardEvent);
    const seen: string[] = [];
    const row = { dispatchEvent: (e: { key: string }) => seen.push(`row ${e.key}`) };
    const body = { dispatchEvent: (e: { key: string }) => seen.push(`body ${e.key}`) };
    pressMenuKey('Enter', false, { activeElement: row, body } as never);
    pressMenuKey('Escape', false, { activeElement: null, body } as never);
    expect(seen).toEqual(['row Enter', 'body Escape']);
  });
});
