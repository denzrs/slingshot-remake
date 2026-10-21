import { AIM } from '../config';
import { normalizeAngle } from '../physics';
import { t } from '../i18n';
import { h } from './dom';

/** What the controls show: the aim of the ship that is being aimed. */
export interface TouchAimState {
  angle: number;
  power: number;
  /** The cap on the power (the setting), and whether the power is fixed altogether. */
  maxPower: number;
  fixedPower: boolean;
}

export interface TouchAimHandlers {
  /** A button changed the angle or the power (not both at once). */
  aim(change: { angle?: number; power?: number }): void;
  /** The first touch: browsers want one before they play sound. */
  touched(): void;
}

/** What a tap moves, and how fast it goes on while the button is held. */
const NUDGE = { angle: 0.5, power: 1 };
const HOLD_DELAY = 350;
const HOLD_EVERY = 70;
const HOLD_FASTER_AFTER = 12;

/**
 * The buttons for the last bit of an aim on a touch screen: the angle in half degrees and the power in ones, a
 * pair each, on either side of the fire button. The rest of the aiming is done by dragging on the field.
 */
export class TouchControls {
  private readonly angleGroup = h('div.tgroup.tgroup--angle', { role: 'group' });
  private readonly powerGroup = h('div.tgroup.tgroup--power', { role: 'group' });
  private readonly powerButtons: HTMLButtonElement[] = [];
  private angle = 0;
  private power = 0;
  private maxPower: number = AIM.MAX_POWER;
  private fixedPower = false;
  private labelled = '';
  private repeat: { delay?: number; every?: number } = {};

  constructor(bar: HTMLElement, private readonly on: TouchAimHandlers) {
    this.angleGroup.hidden = this.powerGroup.hidden = true;
    this.angleGroup.append(this.step('↺', () => this.nudgeAngle(1)), this.step('↻', () => this.nudgeAngle(-1)));
    this.powerGroup.append(this.step('−', () => this.nudgePower(-1), true), this.step('+', () => this.nudgePower(1), true));
    // The fire button, in the markup, stays between them.
    bar.prepend(this.angleGroup);
    bar.append(this.powerGroup);
  }

  /** Show the buttons for this aim, or hide them (null). */
  update(state: TouchAimState | null): void {
    if (!state) {
      if (!this.angleGroup.hidden) this.angleGroup.hidden = this.powerGroup.hidden = true;
      this.stop();
      return;
    }
    if (this.angleGroup.hidden) this.angleGroup.hidden = this.powerGroup.hidden = false;
    // While a button is held it knows the aim better than the match, which may be behind (online).
    if (this.repeat.delay === undefined && this.repeat.every === undefined) {
      this.angle = state.angle;
      this.power = state.power;
    }
    this.maxPower = state.maxPower;
    if (this.fixedPower !== state.fixedPower) {
      this.fixedPower = state.fixedPower;
      for (const button of this.powerButtons) button.disabled = state.fixedPower;
    }
    const labels = `${t('hud.angle')}|${t('hud.power')}`;
    if (labels !== this.labelled) {
      this.labelled = labels;
      this.angleGroup.setAttribute('aria-label', t('hud.angle'));
      this.powerGroup.setAttribute('aria-label', t('hud.power'));
    }
  }

  private step(label: string, run: () => void, power = false): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tbtn';
    button.textContent = label;
    if (power) this.powerButtons.push(button);
    button.addEventListener('pointerdown', (e) => {
      this.on.touched();
      if (button.disabled || this.repeat.delay !== undefined || this.repeat.every !== undefined) return;
      button.setPointerCapture(e.pointerId);
      run();
      let held = 0;
      this.repeat.delay = window.setTimeout(() => {
        this.repeat.delay = undefined;
        this.repeat.every = window.setInterval(() => {
          // After a moment of holding, it goes on in bigger steps.
          for (let i = held++ < HOLD_FASTER_AFTER ? 1 : 4; i > 0; i--) run();
        }, HOLD_EVERY);
      }, HOLD_DELAY);
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) button.addEventListener(type, () => this.stop());
    button.addEventListener('contextmenu', (e) => e.preventDefault());
    return button;
  }

  private stop(): void {
    window.clearTimeout(this.repeat.delay);
    window.clearInterval(this.repeat.every);
    this.repeat = {};
  }

  private nudgeAngle(direction: number): void {
    this.angle = normalizeAngle(Math.round((this.angle + direction * NUDGE.angle) / NUDGE.angle) * NUDGE.angle) || 0;
    this.on.aim({ angle: this.angle });
  }

  private nudgePower(direction: number): void {
    if (this.fixedPower) return;
    this.power = Math.min(this.maxPower, Math.max(AIM.MIN_POWER, Math.round(this.power) + direction * NUDGE.power));
    this.on.aim({ power: this.power });
  }
}
