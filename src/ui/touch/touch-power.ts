import { AIM } from '../../sim/config';
import { t } from '../../platform/i18n';
import { h } from '../dom';
import { barFraction, barPower, stepPower, trackFraction } from './touchaim';
import { holdToRepeat, type TouchAimHandlers, type TouchAimState } from './touch-controls';

/** How far from the handle a finger still takes hold of it instead of moving it to the finger, in handle lengths. */
const GRAB = 1;

/**
 * The power as a bar: a handle on a track that a thumb slides, with ticks every ten. It stands upright on the edge
 * of the screen held sideways and lies across the foot of it held upright (the stylesheet says which). The handle
 * stays under the thumb where it was taken, so it does not jump; the buttons at the ends move it by ones. A cap on the
 * power shows as hatching beyond reach, and a fixed power as a bar that cannot be moved.
 */
export class TouchPower {
  readonly el: HTMLElement;
  private readonly track = h('div.pbar__track', null);
  private readonly handle = h('div.pbar__handle', null);
  private readonly value = h('span.pbar__value', null);
  private readonly steps: HTMLButtonElement[] = [];
  private finger: number | null = null;
  /** From the finger to the middle of the handle along the track, kept while it is down. */
  private grip = 0;
  private power = 0;
  private maxPower: number = AIM.MAX_POWER;
  private fixedPower = false;
  private held: () => boolean = () => false;
  private labelled = '';

  constructor(private readonly on: TouchAimHandlers) {
    this.handle.append(this.value);
    const cap = h('div.pbar__cap', null);
    const ticks = Array.from({ length: 11 }, (_, i) => h(`div.pbar__tick${i % 5 === 0 ? '.pbar__tick--major' : ''}`, null));
    ticks.forEach((tick, i) => tick.style.setProperty('--at', `${i / 10}`));
    this.track.append(...ticks, cap, h('div.pbar__fill', null), this.handle);
    const less = this.step('−', -1);
    const more = this.step('+', 1);
    this.el = h('div.pbar', { role: 'slider', 'aria-valuemin': `${AIM.MIN_POWER}`, 'aria-valuemax': `${AIM.MAX_POWER}`, tabindex: '0' }, less, this.track, more);
    this.el.hidden = true;
    this.wire();
  }

  /** Show the bar for this aim, or hide it (null). */
  update(state: TouchAimState | null): void {
    if (!state) {
      if (!this.el.hidden) this.el.hidden = true;
      this.finger = null;
      return;
    }
    if (this.el.hidden) this.el.hidden = false;
    // While the thumb is on it, it knows the power better than the match, which may be behind (online).
    if (this.finger === null && !this.held()) this.power = state.power;
    this.maxPower = state.maxPower;
    if (this.fixedPower !== state.fixedPower) {
      this.fixedPower = state.fixedPower;
      this.el.classList.toggle('pbar--fixed', state.fixedPower);
      for (const button of this.steps) button.disabled = state.fixedPower;
    }
    this.el.classList.toggle('pbar--capped', state.maxPower < AIM.MAX_POWER);
    this.el.style.setProperty('--p', `${barFraction(this.power)}`);
    this.el.style.setProperty('--cap', `${barFraction(state.maxPower)}`);
    const text = `${Math.round(this.power)}`;
    if (this.value.textContent !== text) this.value.textContent = text;
    this.el.setAttribute('aria-valuenow', text);
    const label = t('hud.power');
    if (label !== this.labelled) {
      this.labelled = label;
      this.el.setAttribute('aria-label', label);
      this.steps[0].setAttribute('aria-label', t('touch.lessPower'));
      this.steps[1].setAttribute('aria-label', t('touch.morePower'));
    }
  }

  private step(label: string, direction: number): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pbar__step';
    button.textContent = label;
    button.tabIndex = -1;
    this.steps.push(button);
    const held = holdToRepeat(button, () => this.send(stepPower(this.power, direction, this.maxPower)), this.on.touched);
    const before = this.held;
    this.held = () => before() || held();
    return button;
  }

  /** The finger's place along the track, from its low end, and the track's and the handle's length. */
  private along(e: PointerEvent): { at: number; length: number; handle: number } {
    const box = this.track.getBoundingClientRect();
    const handle = this.handle.getBoundingClientRect();
    const upright = box.height > box.width;
    return upright
      ? { at: box.bottom - e.clientY, length: box.height, handle: handle.height }
      : { at: e.clientX - box.left, length: box.width, handle: handle.width };
  }

  private send(power: number): void {
    if (this.fixedPower || power === this.power) return;
    this.power = power;
    this.on.aim({ power });
  }

  private wire(): void {
    const move = (e: PointerEvent): void => {
      const { at, length, handle } = this.along(e);
      this.send(barPower(trackFraction(at + this.grip, 0, length, handle), this.maxPower));
    };
    this.track.addEventListener('pointerdown', (e) => {
      this.on.touched();
      if (this.finger !== null || this.fixedPower) return;
      const { at, length, handle } = this.along(e);
      // Taken on the handle it stays where it is under the thumb; taken elsewhere on the track it comes to the thumb.
      const middle = handle / 2 + (length - handle) * barFraction(this.power);
      this.grip = Math.abs(middle - at) <= handle * GRAB ? middle - at : 0;
      this.finger = e.pointerId;
      this.track.setPointerCapture(e.pointerId);
      move(e);
    });
    this.track.addEventListener('pointermove', (e) => e.pointerId === this.finger && move(e));
    const lift = (e: PointerEvent): void => {
      if (e.pointerId === this.finger) this.finger = null;
    };
    this.track.addEventListener('pointerup', lift);
    this.track.addEventListener('pointercancel', lift);
    this.track.addEventListener('contextmenu', (e) => e.preventDefault());
    this.el.addEventListener('keydown', (e) => {
      const direction = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
      if (!direction) return;
      e.preventDefault();
      this.send(stepPower(this.power, direction, this.maxPower));
    });
  }
}
