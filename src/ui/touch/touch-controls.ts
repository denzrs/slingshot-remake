/** What the controls show: the aim of the ship that is being aimed. */
export interface TouchAimState {
  angle: number;
  power: number;
  /** The cap on the power (the setting), and whether the power is fixed altogether. */
  maxPower: number;
  fixedPower: boolean;
}

export interface TouchAimHandlers {
  /** The wheel or the bar changed the angle or the power (not both at once). */
  aim(change: { angle?: number; power?: number }): void;
  /** The first touch: browsers want one before they play sound. */
  touched(): void;
}

/** How long a button is held before it goes on by itself, how often, and when it speeds up. */
const HOLD_DELAY = 350;
const HOLD_EVERY = 70;
const HOLD_FASTER_AFTER = 12;

/**
 * Makes a button act once when it is pressed and go on while it is held, in bigger steps after a moment.
 * Returns whether it is being held, which is when the one who holds it knows the value better than the match.
 */
export function holdToRepeat(button: HTMLButtonElement, run: () => void, touched: () => void): () => boolean {
  let delay: number | undefined;
  let every: number | undefined;
  const held = (): boolean => delay !== undefined || every !== undefined;
  const stop = (): void => {
    window.clearTimeout(delay);
    window.clearInterval(every);
    delay = every = undefined;
  };
  button.addEventListener('pointerdown', (e) => {
    touched();
    if (button.disabled || held()) return;
    button.setPointerCapture(e.pointerId);
    run();
    let count = 0;
    delay = window.setTimeout(() => {
      delay = undefined;
      every = window.setInterval(() => {
        for (let i = count++ < HOLD_FASTER_AFTER ? 1 : 4; i > 0; i--) run();
      }, HOLD_EVERY);
    }, HOLD_DELAY);
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) button.addEventListener(type, stop);
  button.addEventListener('contextmenu', (e) => e.preventDefault());
  return held;
}

/** A click that follows a press this recently is the same press, seen twice. */
const SAME_PRESS = 700;

/**
 * Makes a button act when a finger (or the mouse) is lifted on it, without waiting for the browser's `click`. The wheel, the
 * bar and the field all take their touches as pointer events and work in an iPhone's home-screen web app, where the buttons
 * that waited for a `click` did not answer. A `click` that comes on its own (the keyboard, a screen reader) still runs it.
 */
export function onPress(button: HTMLElement, run: () => void): void {
  let down: number | null = null;
  let last = -Infinity;
  button.addEventListener('pointerdown', (e) => {
    if (e.isPrimary && e.button === 0) down = e.pointerId;
  });
  button.addEventListener('pointerup', (e) => {
    if (e.pointerId !== down) return;
    down = null;
    // Slid off the button before lifting: not a press.
    const box = button.getBoundingClientRect();
    if (e.clientX < box.left - 8 || e.clientX > box.right + 8 || e.clientY < box.top - 8 || e.clientY > box.bottom + 8) return;
    last = e.timeStamp;
    run();
  });
  button.addEventListener('pointercancel', () => (down = null));
  button.addEventListener('click', (e) => {
    if (e.timeStamp - last < SAME_PRESS) return;
    run();
  });
}
