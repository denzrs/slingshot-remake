import { AIM } from '../config';
import { t } from '../i18n';
import { isTurned } from '../render/orientation';
import { stickAim, stickKnob } from '../touchstick';
import { h } from './dom';
import type { TouchAimHandlers, TouchAimState } from './touch-controls';

const BONE = '#e8e4d8';
const ACCENT = '#ff8660';
const LINE = '#5b7db3';

/**
 * A round, see-through stick for aiming with a thumb, over a corner of the field: the knob is pulled back like the
 * pouch of a slingshot, the shot goes the other way and the farther the harder. It always shows the aim, touched or not.
 */
export class TouchStick {
  readonly el: HTMLElement;
  private readonly canvas = document.createElement('canvas');
  /** The finger that holds the knob; any other one is ignored until it lets go. */
  private finger: number | null = null;
  /** Where the knob is while a finger holds it (from the middle, CSS px); otherwise it follows the match. */
  private knob: { x: number; y: number } | null = null;
  private angle = 0;
  private power = 0;
  private maxPower: number = AIM.MAX_POWER;
  private fixedPower = false;
  private lastSent = { angle: NaN, power: NaN };
  /** What the stick was last drawn for, so it is only drawn again when something changed. */
  private drawn = '';

  constructor(private readonly on: TouchAimHandlers) {
    this.el = h('div', { id: 'touch-stick', role: 'application', 'aria-label': t('touch.stick') }, this.canvas);
    this.el.hidden = true;
    this.wire();
  }

  /** Show the stick for this aim, or hide it (null). */
  update(state: TouchAimState | null): void {
    if (!state) {
      if (!this.el.hidden) this.el.hidden = true;
      this.finger = null;
      this.knob = null;
      return;
    }
    if (this.el.hidden) this.el.hidden = false;
    this.maxPower = state.maxPower;
    this.fixedPower = state.fixedPower;
    // The finger says what the aim is while it is down; the match may be behind (online).
    if (this.finger === null) {
      this.angle = state.angle;
      this.power = state.power;
    }
    this.draw();
  }

  private geometry(): { size: number; radius: number } {
    const size = this.canvas.clientWidth;
    // The knob's travel for full power: the circle less the room the knob itself needs.
    return { size, radius: Math.max(1, size / 2 - size * 0.12) };
  }

  private wire(): void {
    const pull = (e: PointerEvent): void => {
      const box = this.el.getBoundingClientRect();
      const { radius } = this.geometry();
      let x = e.clientX - (box.left + box.width / 2);
      let y = e.clientY - (box.top + box.height / 2);
      // The knob stays within the circle — and within the power cap.
      const reach = (radius * Math.min(this.maxPower, AIM.MAX_POWER)) / AIM.MAX_POWER;
      const length = Math.hypot(x, y);
      if (length > reach) {
        x = (x / length) * reach;
        y = (y / length) * reach;
      }
      // The stick is on the screen, the aim in the field: turned a quarter round, the two differ by that.
      const aim = isTurned() ? stickAim(-y, x, radius, this.maxPower) : stickAim(x, y, radius, this.maxPower);
      if (!aim) return;
      this.knob = { x, y };
      this.angle = aim.angle;
      // A fixed power is shown, not changed.
      if (!this.fixedPower) this.power = aim.power;
      this.send(this.fixedPower ? { angle: this.angle } : { angle: this.angle, power: this.power });
    };
    this.el.addEventListener('pointerdown', (e) => {
      this.on.touched();
      if (this.finger !== null) return;
      this.finger = e.pointerId;
      this.el.setPointerCapture(e.pointerId);
      pull(e);
    });
    this.el.addEventListener('pointermove', (e) => e.pointerId === this.finger && pull(e));
    const lift = (e: PointerEvent): void => {
      if (e.pointerId !== this.finger) return;
      this.finger = null;
      this.knob = null;
    };
    this.el.addEventListener('pointerup', lift);
    this.el.addEventListener('pointercancel', lift);
    this.el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Tells the match, if it is news. */
  private send(change: { angle?: number; power?: number }): void {
    const angle = change.angle ?? this.angle;
    const power = change.power ?? this.power;
    if (angle === this.lastSent.angle && power === this.lastSent.power) return;
    this.lastSent = { angle, power };
    this.on.aim(change);
  }

  /** The circle, in see-through ink: a ring at half power, the cap, the rubber band, the way the shot will go, the knob. */
  private draw(): void {
    const { size, radius } = this.geometry();
    if (!size) return;
    const pulled = stickKnob(this.angle, this.power, radius);
    const knob = this.knob ?? (isTurned() ? { x: pulled.y, y: -pulled.x } : pulled);
    const key = `${size}|${this.maxPower}|${this.fixedPower}|${Math.round(knob.x * 2)},${Math.round(knob.y * 2)}`;
    if (key === this.drawn) return;
    this.drawn = key;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (this.canvas.width !== Math.round(size * dpr)) this.canvas.width = this.canvas.height = Math.round(size * dpr);
    const ctx = this.canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.translate(size / 2, size / 2);
    ctx.lineCap = 'round';
    const rim = size / 2 - 1.5;

    ctx.fillStyle = 'rgba(11, 26, 51, 0.3)';
    ctx.beginPath();
    ctx.arc(0, 0, rim, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = BONE;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.4;
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.16;
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.5, 0, Math.PI * 2);
    ctx.stroke();
    // What lies beyond the cap cannot be reached.
    if (this.maxPower < AIM.MAX_POWER) {
      ctx.strokeStyle = LINE;
      ctx.globalAlpha = 0.7;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(0, 0, (radius * this.maxPower) / AIM.MAX_POWER, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const length = Math.hypot(knob.x, knob.y);
    if (length > 1) {
      // The way the shot will go: the other way from the knob, out to the rim.
      const dx = -knob.x / length;
      const dy = -knob.y / length;
      const tip = rim - 4;
      ctx.strokeStyle = BONE;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 6]);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(dx * tip, dy * tip);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(dx * tip, dy * tip);
      ctx.lineTo(dx * (tip - 9) - dy * 5, dy * (tip - 9) + dx * 5);
      ctx.moveTo(dx * tip, dy * tip);
      ctx.lineTo(dx * (tip - 9) + dy * 5, dy * (tip - 9) - dx * 5);
      ctx.stroke();
      // The rubber band, from the post in the middle to the knob.
      ctx.strokeStyle = ACCENT;
      ctx.globalAlpha = 0.75;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(knob.x, knob.y);
      ctx.stroke();
    }
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = BONE;
    ctx.beginPath();
    ctx.arc(0, 0, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = ACCENT;
    ctx.strokeStyle = BONE;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(knob.x, knob.y, size * 0.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.8;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}
