import { AIM } from '../config';
import { markPhi, pointerPhi, sliderFraction, sliderPower, WHEEL_GAIN, WHEEL_MARKER, wheelAngle } from '../touchaim';
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
  /** The finger changed the angle or the power (not both at once). */
  aim(change: { angle?: number; power?: number }): void;
  /** The first touch: browsers want one before they play sound. */
  touched(): void;
}

const BONE = '#e8e4d8';
const ACCENT = '#ff8660';

/** A power slider on the left and an angle wheel on the right, for aiming with thumbs. */
export class TouchAim {
  readonly el: HTMLElement;
  private readonly dial = h('div', { class: 'dial', role: 'slider', 'aria-label': 'Angle' });
  private readonly face = document.createElement('canvas');
  private readonly slider = h('div.pslider', { role: 'slider', 'aria-label': 'Power' });
  private readonly fill = h('div.pslider__fill', null);
  private readonly cap = h('div.pslider__cap', null);
  private readonly powerText = h('span.pslider__value', null);

  private draggingDial = false;
  private draggingSlider = false;
  /** What the fingers say while they are down; the match may be behind (online). */
  private angle = 0;
  private power = 0;
  private maxPower: number = AIM.MAX_POWER;
  /** What the wheel was last drawn for, so it is only drawn again when it changes. */
  private drawn = { angle: NaN, size: 0 };

  constructor(private readonly on: TouchAimHandlers) {
    this.dial.append(this.face);
    this.slider.append(this.fill, this.cap, this.powerText);
    this.el = h('div', { id: 'touch-aim' }, this.slider, this.dial);
    this.el.hidden = true;
    this.wireDial();
    this.wireSlider();
  }

  /** Show the controls for this aim, or hide them (null). */
  update(state: TouchAimState | null): void {
    if (!state) {
      if (!this.el.hidden) this.el.hidden = true;
      this.draggingDial = this.draggingSlider = false;
      return;
    }
    if (this.el.hidden) this.el.hidden = false;
    if (!this.draggingDial) this.angle = state.angle;
    if (!this.draggingSlider) this.power = state.power;
    this.maxPower = state.maxPower;
    this.slider.classList.toggle('pslider--fixed', state.fixedPower);
    this.dial.setAttribute('aria-valuenow', `${this.angle}`);
    this.drawWheel();

    this.fill.style.height = `${sliderFraction(this.power) * 100}%`;
    this.cap.style.height = `${(1 - state.maxPower / AIM.MAX_POWER) * 100}%`;
    const power = `${Math.round(this.power)}`;
    if (this.powerText.textContent !== power) this.powerText.textContent = power;
    this.slider.setAttribute('aria-valuenow', power);
  }

  /** The wheel: ticks every 5° that turn with the angle, a marker in the middle of the quarter, and the angle in the corner. */
  private drawWheel(): void {
    const size = this.dial.clientWidth;
    if (!size || (this.drawn.angle === this.angle && this.drawn.size === size)) return;
    this.drawn = { angle: this.angle, size };
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (this.face.width !== Math.round(size * dpr)) {
      this.face.width = this.face.height = Math.round(size * dpr);
    }
    const ctx = this.face.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    // The centre is the bottom-right corner; directions are counter-clockwise from the right, as on the field.
    const at = (phi: number, radius: number): [number, number] => [size + Math.cos((phi * Math.PI) / 180) * radius, size - Math.sin((phi * Math.PI) / 180) * radius];
    ctx.lineCap = 'round';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${Math.max(11, size * 0.07)}px B612, sans-serif`;
    const reach = 45 * WHEEL_GAIN;
    const first = Math.ceil((this.angle - reach) / 5) * 5;
    for (let a = first; a <= this.angle + reach; a += 5) {
      const phi = markPhi(this.angle, a);
      if (phi < 90 || phi > 180) continue;
      // Marks fade out towards the ends of the quarter.
      const fade = Math.min(1, (Math.min(phi - 90, 180 - phi) + 2) / 14);
      const major = ((a % 15) + 15) % 15 === 0;
      const long = major ? size * 0.12 : size * 0.06;
      ctx.strokeStyle = BONE;
      ctx.globalAlpha = (major ? 0.9 : 0.5) * fade;
      ctx.lineWidth = major ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(...at(phi, size - 3));
      ctx.lineTo(...at(phi, size - 3 - long));
      ctx.stroke();
      if (((a % 45) + 45) % 45 === 0) {
        ctx.globalAlpha = fade;
        ctx.fillStyle = BONE;
        ctx.fillText(`${((a % 360) + 360) % 360}`, ...at(phi, size * 0.7));
      }
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(...at(WHEEL_MARKER, size * 0.3));
    ctx.lineTo(...at(WHEEL_MARKER, size - 3));
    ctx.stroke();
    ctx.fillStyle = ACCENT;
    ctx.font = `800 ${Math.max(16, size * 0.13)}px "Big Shoulders Stencil Display", sans-serif`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(`${Math.round(this.angle * 10) / 10}°`, size - 10, size - 8);
  }

  private wireDial(): void {
    let startAngle = 0;
    let startPhi = 0;
    const phiOf = (e: PointerEvent): number | null => {
      const box = this.dial.getBoundingClientRect();
      const dx = e.clientX - box.right;
      const dy = e.clientY - box.bottom;
      // Right at the centre a finger has no direction.
      return Math.hypot(dx, dy) < 12 ? null : pointerPhi(dx, dy);
    };
    this.dial.addEventListener('pointerdown', (e) => {
      this.on.touched();
      const phi = phiOf(e);
      if (phi === null) return;
      this.draggingDial = true;
      startAngle = this.angle;
      startPhi = phi;
      this.dial.setPointerCapture(e.pointerId);
    });
    this.dial.addEventListener('pointermove', (e) => {
      const phi = phiOf(e);
      if (!this.draggingDial || phi === null) return;
      this.angle = wheelAngle(startAngle, startPhi, phi);
      this.on.aim({ angle: this.angle });
    });
    const release = (): void => void (this.draggingDial = false);
    this.dial.addEventListener('pointerup', release);
    this.dial.addEventListener('pointercancel', release);
  }

  private wireSlider(): void {
    const aim = (e: PointerEvent): void => {
      if (this.slider.classList.contains('pslider--fixed')) return;
      const box = this.slider.getBoundingClientRect();
      this.power = sliderPower((box.bottom - e.clientY) / box.height, this.maxPower);
      this.on.aim({ power: this.power });
    };
    this.slider.addEventListener('pointerdown', (e) => {
      this.on.touched();
      this.draggingSlider = true;
      this.slider.setPointerCapture(e.pointerId);
      aim(e);
    });
    this.slider.addEventListener('pointermove', (e) => this.draggingSlider && aim(e));
    const release = (): void => void (this.draggingSlider = false);
    this.slider.addEventListener('pointerup', release);
    this.slider.addEventListener('pointercancel', release);
  }
}
