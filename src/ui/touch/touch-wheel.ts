import { t } from '../../platform/i18n';
import { h } from '../dom';
import { markPhi, pointerPhi, snapAngle, stepAngle, WHEEL_DEAD, WHEEL_QUARTER, WHEEL_SPLIT, wheelBand, wheelDelta, wheelMarker, type WheelBand } from './touchaim';
import type { TouchAimHandlers, TouchAimState } from './touch-controls';

const BONE = '#e8e4d8';
const ACCENT = '#ff8660';

/** How far down the wheel, as a share of its height, it starts to fade out. */
const FADE_FROM = 0.45;

/** How far from the mark, in degrees round the corner, a number on the scale is left out. */
const LABEL_CLEAR = 5;

/** A finger this near the corner has no direction: turning stops rather than jumps. */
const NO_DIRECTION = 0.15;

/**
 * A quarter-circle dial in a corner of the screen, for the angle: it turns under the thumb like a jog dial, so every
 * angle of the 360° can be reached from one corner. Two bands, as on a watch's bezel: the inner one is quick, the
 * outer one fine, and the one the thumb lands on is the one that turns. The angle reads in the corner, and the mark
 * for it stands still while the scale turns past.
 */
export class TouchWheel {
  readonly el: HTMLElement;
  private readonly canvas = document.createElement('canvas');
  private side: 'left' | 'right' = 'right';
  /** The finger that turns the wheel, the band it landed in and where it was last seen; any other finger is ignored until it lets go. */
  private finger: number | null = null;
  private band: WheelBand | null = null;
  private phi = 0;
  /** The angle as the finger turns it, before it is snapped to the half degree, so that the scale runs smoothly under the thumb. */
  private raw = 0;
  private angle = 0;
  private lastSent = NaN;
  /** What the wheel was last drawn for, so it is only drawn again when something changed. */
  private drawn = '';

  constructor(private readonly on: TouchAimHandlers) {
    this.el = h('div.twheel', { role: 'slider', 'aria-valuemin': '0', 'aria-valuemax': '360', tabindex: '0' }, this.canvas);
    this.el.hidden = true;
    this.setSide('right');
    this.wire();
  }

  /** The corner the wheel sits in. */
  setSide(side: 'left' | 'right'): void {
    this.side = side;
    this.el.classList.toggle('twheel--left', side === 'left');
    this.drawn = '';
    if (!this.el.hidden) this.draw();
  }

  /** Show the wheel for this aim, or hide it (null). */
  update(state: TouchAimState | null): void {
    if (!state) {
      if (!this.el.hidden) this.el.hidden = true;
      this.finger = this.band = null;
      return;
    }
    if (this.el.hidden) this.el.hidden = false;
    // The finger says what the angle is while it is down; the match may be behind (online).
    if (this.finger === null) this.angle = this.raw = state.angle;
    this.el.setAttribute('aria-valuenow', `${this.angle}`);
    const label = t('touch.wheel');
    if (this.el.getAttribute('aria-label') !== label) this.el.setAttribute('aria-label', label);
    this.draw();
  }

  /** The finger's distance from the corner the wheel turns about, and its direction from it. */
  private reading(e: PointerEvent): { distance: number; phi: number; radius: number } {
    const box = this.el.getBoundingClientRect();
    const dx = e.clientX - (this.side === 'right' ? box.right : box.left);
    const dy = e.clientY - box.bottom;
    return { distance: Math.hypot(dx, dy), phi: pointerPhi(dx, dy), radius: box.width };
  }

  private wire(): void {
    this.el.addEventListener('pointerdown', (e) => {
      this.on.touched();
      if (this.finger !== null) return;
      const { distance, phi, radius } = this.reading(e);
      const band = wheelBand(distance, radius);
      // Outside the quarter, or in the middle, it is the field's.
      if (!band || distance > radius) return;
      this.finger = e.pointerId;
      this.band = band;
      this.phi = phi;
      this.raw = this.angle;
      this.el.setPointerCapture(e.pointerId);
      this.draw();
    });
    this.el.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.finger || !this.band) return;
      const { distance, phi, radius } = this.reading(e);
      if (distance < radius * NO_DIRECTION) return;
      this.raw += wheelDelta(this.band, this.phi, phi);
      this.phi = phi;
      this.angle = snapAngle(this.raw);
      this.send(this.angle);
      this.draw();
    });
    const lift = (e: PointerEvent): void => {
      if (e.pointerId !== this.finger) return;
      this.finger = this.band = null;
      this.draw();
    };
    this.el.addEventListener('pointerup', lift);
    this.el.addEventListener('pointercancel', lift);
    this.el.addEventListener('contextmenu', (e) => e.preventDefault());
    this.el.addEventListener('keydown', (e) => {
      const direction = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowRight' || e.key === 'ArrowDown' ? -1 : 0;
      if (!direction) return;
      e.preventDefault();
      this.angle = this.raw = stepAngle(this.angle, direction);
      this.send(this.angle);
      this.draw();
    });
  }

  /** Tells the match, if it is news. */
  private send(angle: number): void {
    if (angle === this.lastSent) return;
    this.lastSent = angle;
    this.on.aim({ angle });
  }

  /** The wheel, in see-through ink: the two bands with their scales, the mark that stands still, and the angle in the corner. */
  private draw(): void {
    const size = this.canvas.clientWidth;
    if (!size) return;
    const shown = this.finger === null ? this.angle : this.raw;
    const key = `${size}|${this.side}|${this.band}|${Math.round(shown * 8)}|${this.angle}|${t('touch.wheel')}`;
    if (key === this.drawn) return;
    this.drawn = key;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (this.canvas.width !== Math.round(size * dpr)) this.canvas.width = this.canvas.height = Math.round(size * dpr);
    const ctx = this.canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);

    // The corner the wheel turns about; directions are counter-clockwise from the right, as on the field.
    const { from, to } = WHEEL_QUARTER[this.side];
    const marker = wheelMarker(this.side);
    const cx = this.side === 'right' ? size : 0;
    const cy = size;
    const rad = (phi: number): number => (phi * Math.PI) / 180;
    const at = (phi: number, r: number): [number, number] => [cx + Math.cos(rad(phi)) * r, cy - Math.sin(rad(phi)) * r];
    /** An arc from one direction to the other, counter-clockwise on the screen (canvas angles run the other way). */
    const arc = (r: number, a: number, b: number): void => ctx.arc(cx, cy, r, -rad(a), -rad(b), true);
    const rim = size - 1.5;
    const dead = size * WHEEL_DEAD;
    const split = size * WHEEL_SPLIT;

    ctx.lineCap = 'round';
    ctx.fillStyle = 'rgba(11, 26, 51, 0.34)';
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    arc(rim, from, to);
    ctx.closePath();
    ctx.fill();
    // The band that has the thumb is lit.
    if (this.band) {
      const [inner, outer] = this.band === 'fine' ? [split, rim] : [dead, split];
      ctx.fillStyle = 'rgba(232, 228, 216, 0.1)';
      ctx.beginPath();
      arc(outer, from, to);
      ctx.arc(cx, cy, inner, -rad(to), -rad(from), false);
      ctx.closePath();
      ctx.fill();
    }
    ctx.strokeStyle = BONE;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.45;
    ctx.beginPath();
    arc(rim, from, to);
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.2;
    for (const r of [dead, split]) {
      ctx.beginPath();
      arc(r, from, to);
      ctx.stroke();
    }

    /** A scale on a band: ticks at every `every` degrees of angle, longer at every `major`, numbered at every `numbered`. */
    const scale = (band: WheelBand, edge: number, inward: number, every: number, major: number, numbered: number, labelAt: number): void => {
      const reach = ((to - from) / 2 + 3) * (band === 'fine' ? 0.25 : 2);
      for (let a = Math.ceil((shown - reach) / every) * every; a <= shown + reach; a += every) {
        const phi = markPhi(band, marker, shown, a);
        if (phi < from + 1.5 || phi > to - 1.5) continue;
        // Marks fade out towards the ends of the quarter.
        const fade = Math.min(1, (Math.min(phi - from, to - phi) + 2) / 14);
        const long = ((a % major) + major) % major === 0;
        ctx.strokeStyle = BONE;
        ctx.globalAlpha = (long ? 0.85 : 0.45) * fade;
        ctx.lineWidth = long ? 2 : 1;
        ctx.beginPath();
        ctx.moveTo(...at(phi, edge));
        ctx.lineTo(...at(phi, edge - inward * (long ? 1.8 : 1)));
        ctx.stroke();
        // The angle itself reads in the corner; a number under the mark would only hide behind it.
        if (((a % numbered) + numbered) % numbered === 0 && Math.abs(phi - marker) > LABEL_CLEAR) {
          ctx.globalAlpha = 0.8 * fade;
          ctx.fillStyle = BONE;
          ctx.fillText(`${((Math.round(a) % 360) + 360) % 360}`, ...at(phi, labelAt));
        }
      }
    };
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${Math.max(10, size * 0.058)}px B612, sans-serif`;
    scale('fine', rim - 2, size * 0.035, 1, 5, 10, (split + rim) / 2 + size * 0.02);
    scale('coarse', split - 2, size * 0.035, 15, 45, 45, (dead + split) / 2 + size * 0.01);

    // The mark that stands still, across both bands.
    ctx.globalAlpha = 1;
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(...at(marker, dead + 2));
    ctx.lineTo(...at(marker, rim));
    ctx.stroke();

    // The foot of the wheel dissolves into the field; the angle in the corner is drawn after, and stays.
    ctx.save();
    ctx.globalCompositeOperation = 'destination-in';
    const fade = ctx.createLinearGradient(0, 0, 0, size);
    fade.addColorStop(0, '#000');
    fade.addColorStop(FADE_FROM, '#000');
    fade.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, size, size);
    ctx.restore();

    // The angle, in the corner.
    ctx.fillStyle = ACCENT;
    ctx.font = `800 ${Math.max(15, size * 0.115)}px "Big Shoulders Stencil Display", sans-serif`;
    ctx.textAlign = this.side === 'right' ? 'right' : 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(`${Math.round(this.angle * 10) / 10}°`, this.side === 'right' ? size - 8 : 8, size - 8);
    ctx.globalAlpha = 1;
  }
}
