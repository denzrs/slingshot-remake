import { AIM } from '../../sim/config';

/**
 * What a pad's state means to the game, with no browser in it: a snapshot goes in, actions come out. The pad is
 * the standard layout of the Gamepad API (`mapping === 'standard'`); anything else is left alone.
 */

/** The part of a `Gamepad` the mapping reads, so a test can hand it a made-up one. */
export interface PadLike {
  readonly connected: boolean;
  readonly mapping: string;
  readonly axes: readonly number[];
  readonly buttons: readonly { readonly pressed: boolean }[];
}

/** Button numbers of the standard layout. */
export const PAD = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, BACK: 8, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 } as const;

/** Where the pad's input goes: aiming a match, or moving about a menu. */
export type PadContext = 'game' | 'menu';

/** The keys a menu is moved with; the pad presses them like a keyboard would. */
export type PadKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'Enter' | 'Escape' | 'q' | 'e';

export type PadAction =
  | { kind: 'adjust'; dAngle: number; dPower: number }
  | { kind: 'primary' }
  | { kind: 'escape' }
  | { kind: 'power' }
  | { kind: 'skip' }
  | { kind: 'clip' }
  | { kind: 'key'; key: PadKey; repeat: boolean };

/** What one look at a pad found: what to do, and whether the pad was in use at all (a button down, a stick pushed). */
export interface PadFrame {
  actions: PadAction[];
  active: boolean;
}

/** Below this much of the stick's travel nothing happens; the rest of the travel is stretched over 0–1. */
export const DEADZONE = 0.25;
/** A stick moves a menu like a D-pad: pushed past `PUSH` it is a press, back under `RELEASE` it is let go. */
const PUSH = 0.6;
const RELEASE = 0.4;
/** One axis of the stick counts as zero when it is less than this much of the other, so a push to the side does not drift. */
const AXIS_SNAP = 0.4;

/** A held direction goes on after this long (ms) and then every so often; a long hold takes bigger steps. Same feel as the touch buttons. */
export const HOLD = { delay: 350, every: 70, fasterAfter: 12, faster: 4 } as const;
/** The menu repeats slower: a row at a time is easier to follow than steps of a degree. */
export const MENU_HOLD = { delay: 400, every: 120 } as const;

/** How many angle degrees or power points a fully pushed stick moves in a second, by step size (shoulder buttons pick it). */
export const STICK_RATE = { normal: 45, small: 6, large: 150, tiny: 0.6 } as const;
/** An aiming stick sends no more often than this (ms), so online it is no flood of messages. */
export const EMIT_EVERY = 33;
/** A gap this long between two looks (a hidden tab, say) is not made up for. */
const MAX_GAP = 100;

type Dir = 'up' | 'down' | 'left' | 'right';
const DIRS: readonly Dir[] = ['up', 'down', 'left', 'right'];
const DPAD: Record<Dir, number> = { up: PAD.UP, down: PAD.DOWN, left: PAD.LEFT, right: PAD.RIGHT };
const ARROW: Record<Dir, PadKey> = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };

/** The step sizes the shoulder buttons choose between: LB for fine, RB for coarse, both for the finest. */
export type StepSize = keyof typeof AIM.STEPS;
export function stepSize(left: boolean, right: boolean): StepSize {
  return left && right ? 'tiny' : left ? 'small' : right ? 'large' : 'normal';
}

/** The stick's push with the dead zone taken out: 0 inside it, growing to 1 at the rim. */
export function stickPush(x: number, y: number): [number, number] {
  const mag = Math.hypot(x, y);
  if (mag < DEADZONE) return [0, 0];
  const scale = Math.min(1, (mag - DEADZONE) / (1 - DEADZONE)) / mag;
  let px = x * scale;
  let py = y * scale;
  if (Math.abs(px) < AXIS_SNAP * Math.abs(py)) px = 0;
  else if (Math.abs(py) < AXIS_SNAP * Math.abs(px)) py = 0;
  return [px, py];
}

interface Hold {
  next: number;
  count: number;
}

/** Remembers what one pad did the last time it was looked at, to tell a press from a button that is still down. */
export class PadMapper {
  private down = new Set<number>();
  private dirDown: Record<Dir, boolean> = { up: false, down: false, left: false, right: false };
  private holds = new Map<Dir, Hold>();
  private context: PadContext | null = null;
  private lastAt: number | null = null;
  private lastEmit = -Infinity;
  private carry = { angle: 0, power: 0 };
  private seen = false;

  /**
   * Looks at the pad at time `now` (ms) and says what it asked for. The first look only learns what is held already: the
   * press that made the browser show the pad must not also fire a shot.
   */
  poll(pad: PadLike, now: number, context: PadContext): PadFrame {
    const pressed = (i: number): boolean => !!pad.buttons[i]?.pressed;
    const buttons = new Set<number>();
    for (let i = 0; i < pad.buttons.length; i++) if (pressed(i)) buttons.add(i);
    const sx = pad.axes[0] ?? 0;
    const sy = pad.axes[1] ?? 0;
    const [px, py] = stickPush(sx, sy);
    const active = buttons.size > 0 || px !== 0 || py !== 0;

    const first = !this.seen;
    const gap = this.lastAt === null ? 0 : Math.min(MAX_GAP, now - this.lastAt);
    const changedContext = context !== this.context;
    this.seen = true;
    this.lastAt = now;
    if (changedContext) {
      this.context = context;
      this.holds.clear();
      this.carry = { angle: 0, power: 0 };
    }

    const actions: PadAction[] = [];
    const wasDown = this.down;
    const edge = (i: number): boolean => buttons.has(i) && !wasDown.has(i);

    // The directions: the D-pad always, and in a menu the stick too, as a D-pad.
    const dirNow: Record<Dir, boolean> = { up: false, down: false, left: false, right: false };
    for (const dir of DIRS) dirNow[dir] = buttons.has(DPAD[dir]);
    if (context === 'menu') {
      const length = Math.hypot(sx, sy);
      const horizontal = Math.abs(sx) >= Math.abs(sy);
      for (const [dir, value, axisIsX] of [['left', -sx, true], ['right', sx, true], ['up', -sy, false], ['down', sy, false]] as const) {
        const onThisAxis = axisIsX === horizontal;
        const limit = this.dirDown[dir] ? RELEASE : PUSH;
        if (onThisAxis && length > 0 && value > limit) dirNow[dir] = true;
      }
    }

    if (!first) {
      if (context === 'game') this.game(actions, buttons, dirNow, edge, now, gap, [px, py]);
      else this.menu(actions, dirNow, edge, now);
    }

    this.down = buttons;
    this.dirDown = dirNow;
    return { actions, active };
  }

  /** Forgets everything, e.g. after the pad was unplugged. */
  reset(): void {
    this.down = new Set();
    this.dirDown = { up: false, down: false, left: false, right: false };
    this.holds.clear();
    this.context = null;
    this.lastAt = null;
    this.lastEmit = -Infinity;
    this.carry = { angle: 0, power: 0 };
    this.seen = false;
  }

  private game(actions: PadAction[], buttons: Set<number>, dirNow: Record<Dir, boolean>, edge: (i: number) => boolean, now: number, gap: number, push: [number, number]): void {
    if (edge(PAD.A)) actions.push({ kind: 'primary' });
    if (edge(PAD.B) || edge(PAD.START)) actions.push({ kind: 'escape' });
    if (edge(PAD.X)) actions.push({ kind: 'power' });
    if (edge(PAD.Y)) actions.push({ kind: 'skip' });
    if (edge(PAD.BACK)) actions.push({ kind: 'clip' });

    const size = stepSize(buttons.has(PAD.LB), buttons.has(PAD.RB));
    let dAngle = 0;
    let dPower = 0;

    // D-pad: one step at a press, then — held — steps by themselves, bigger after a while.
    for (const dir of DIRS) {
      let steps = 0;
      if (!dirNow[dir]) {
        this.holds.delete(dir);
      } else if (!this.dirDown[dir] || !this.holds.has(dir)) {
        // A direction held since before this context only starts when it is let go and pressed again.
        if (this.dirDown[dir]) continue;
        this.holds.set(dir, { next: now + HOLD.delay, count: 0 });
        steps = 1;
      } else {
        const hold = this.holds.get(dir)!;
        if (now - hold.next > 500) hold.next = now;
        while (now >= hold.next) {
          steps += hold.count++ < HOLD.fasterAfter || size === 'large' ? 1 : HOLD.faster;
          hold.next += HOLD.every;
        }
      }
      if (!steps) continue;
      const [angleStep, powerStep] = AIM.STEPS[size];
      if (dir === 'left') dAngle += angleStep * steps;
      else if (dir === 'right') dAngle -= angleStep * steps;
      else if (dir === 'up') dPower += powerStep * steps;
      else dPower -= powerStep * steps;
    }

    // The stick: the further it is pushed, the faster — and the dead zone, the snap to one axis and the curve keep a hand's tremble out of it.
    const [px, py] = push;
    if (px !== 0 || py !== 0) {
      const rate = STICK_RATE[size];
      const seconds = gap / 1000;
      this.carry.angle += -px * Math.abs(px) * rate * seconds;
      this.carry.power += -py * Math.abs(py) * rate * seconds;
    } else {
      this.carry = { angle: 0, power: 0 };
    }

    if (dAngle || dPower) {
      actions.push({ kind: 'adjust', dAngle: round(dAngle), dPower: round(dPower) });
    }
    if ((this.carry.angle || this.carry.power) && now - this.lastEmit >= EMIT_EVERY) {
      this.lastEmit = now;
      actions.push({ kind: 'adjust', dAngle: round(this.carry.angle), dPower: round(this.carry.power) });
      this.carry = { angle: 0, power: 0 };
    }
  }

  private menu(actions: PadAction[], dirNow: Record<Dir, boolean>, edge: (i: number) => boolean, now: number): void {
    if (edge(PAD.A)) actions.push({ kind: 'key', key: 'Enter', repeat: false });
    if (edge(PAD.B)) actions.push({ kind: 'key', key: 'Escape', repeat: false });
    // The shoulders turn the pages of the screens that have them (Q and E).
    if (edge(PAD.LB)) actions.push({ kind: 'key', key: 'q', repeat: false });
    if (edge(PAD.RB)) actions.push({ kind: 'key', key: 'e', repeat: false });

    for (const dir of DIRS) {
      if (!dirNow[dir]) {
        this.holds.delete(dir);
        continue;
      }
      if (!this.dirDown[dir]) {
        this.holds.set(dir, { next: now + MENU_HOLD.delay, count: 0 });
        actions.push({ kind: 'key', key: ARROW[dir], repeat: false });
        continue;
      }
      const hold = this.holds.get(dir);
      if (!hold) continue;
      if (now - hold.next > 500) hold.next = now;
      if (now >= hold.next) {
        hold.next = Math.max(hold.next + MENU_HOLD.every, now);
        actions.push({ kind: 'key', key: ARROW[dir], repeat: true });
      }
    }
  }
}

/** Steps are hundredths at the finest, so anything below that is rounding noise. */
const round = (v: number): number => Math.round(v * 100) / 100;
