import { AVATARS } from '../../platform/avatars';
import { t } from '../../platform/i18n';
import type { NetworkCpuLevel, RoomInfo, RoomMode } from '../../net/net';
import type { RoomLook } from '../../data/roomLook';
import { AVATAR_LABEL, avatarSvg } from '../room/avatars';
import { h } from '../menu/menu';

export const matchTypeName = (mode: RoomMode) => (mode === 'team' ? t('players.teams', { n: 2 }) : t('players.ffa'));
/** The symbols a player can pick, as the choices of a picker. */
export const avatarOptions = () => AVATARS.map((avatar) => ({ value: avatar, label: t(AVATAR_LABEL[avatar]), face: avatarSvg(avatar) }));
export const lookOf = (room: RoomInfo): RoomLook => ({ visibility: room.visibility, symbol: room.symbol, color: room.color });

export function button(label: string, primary = false): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `lobby__button${primary ? ' lobby__button--primary' : ''}`;
  b.textContent = label;
  return b;
}

export function textInput(value: string, attrs: Partial<HTMLInputElement> = {}): HTMLInputElement {
  const input = document.createElement('input');
  Object.assign(input, attrs, { value });
  return input;
}

export function passwordInput(placeholder = ''): HTMLInputElement {
  return textInput('', { type: 'password', maxLength: 64, autocomplete: 'off', placeholder });
}

/** Stroke icons for the password fields: an eye, the same with a slash, and a copy sheet. */
const ICON_EYE = '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>';
const ICON_EYE_OFF = '<path d="M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6A16.5 16.5 0 0 0 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/><path d="M3 3l18 18"/>';
export const ICON_COPY = '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>';
export const ICON_CLOSE = '<path d="M6 6l12 12M18 6L6 18"/>';

/** The levels a CPU seat can take online, in the order the offline game lists them. */
export const CPU_LEVELS: NetworkCpuLevel[] = ['easy', 'medium', 'hard', 'hawking'];

/** A square button with one of the icons above. */
export function iconButton(label: string, icon: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'lobby__icon-button';
  b.title = label;
  b.setAttribute('aria-label', label);
  // Only our own constants go in here.
  b.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon}</svg>`;
  return b;
}

/**
 * A password field with an eye that shows or hides what is typed. With `onCopy`, a button beside it
 * copies the password.
 */
export function secretField(input: HTMLInputElement, onCopy?: (button: HTMLElement) => void): HTMLElement {
  const eye = iconButton('', ICON_EYE);
  const paintEye = (): void => {
    const shown = input.type === 'text';
    const label = t(shown ? 'multiplayer.hidePassword' : 'multiplayer.showPassword');
    eye.title = label;
    eye.setAttribute('aria-label', label);
    eye.setAttribute('aria-pressed', String(shown));
    eye.querySelector('svg')?.replaceChildren(...svgChildren(shown ? ICON_EYE_OFF : ICON_EYE));
  };
  eye.addEventListener('click', () => {
    input.type = input.type === 'text' ? 'password' : 'text';
    paintEye();
  });
  paintEye();
  const parts: Node[] = [input, eye];
  if (onCopy) {
    const copy = iconButton(t('multiplayer.copyPassword'), ICON_COPY);
    copy.addEventListener('click', () => onCopy(copy));
    parts.push(copy);
  }
  return h('span.lobby__secret', null, ...parts);
}

export const ICON_LINK = '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>';
export const ICON_KEY = '<circle cx="8" cy="15" r="4"/><path d="M11 12l8-8M16 7l3 3M14 9l2 2"/>';
const ICON_CHECK = '<path d="M5 12.5l4.5 4.5L19 7"/>';

/** Confirms "copied" in the thing that was pressed, for a moment, and then gives it back. */
export function flashCopied(button: HTMLElement, what: string): void {
  if (button.classList.contains('is-flash')) return;
  button.classList.add('is-flash');
  if (button.classList.contains('slot-card__join')) {
    flashSeat(button, what);
    return;
  }
  // An icon button lights up and draws a check; what was copied floats under it as a tooltip, so nothing around it moves.
  const note = h('span.flash-note', { role: 'status' }, what);
  const icon = button.querySelector('svg');
  const saved = icon?.innerHTML;
  if (icon) icon.replaceChildren(...svgChildren(ICON_CHECK));
  button.classList.add('is-copied');
  button.append(note);
  setTimeout(() => {
    if (icon && saved !== undefined) icon.innerHTML = saved;
    note.remove();
    button.classList.remove('is-copied', 'is-flash');
  }, 1600);
}

/** An open seat says it in the seat itself: the card lights up and its label is swapped for what was copied. */
function flashSeat(button: HTMLElement, what: string): void {
  const card = button.closest('.slot-card');
  const saved = [...button.childNodes];
  const check = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  check.setAttribute('viewBox', '0 0 24 24');
  check.setAttribute('class', 'slot-card__check');
  check.setAttribute('aria-hidden', 'true');
  check.innerHTML = ICON_CHECK;
  card?.classList.add('is-copied');
  button.replaceChildren(check, h('span.slot-card__copied', { role: 'status' }, what));
  setTimeout(() => {
    button.replaceChildren(...saved);
    button.classList.remove('is-flash');
    card?.classList.remove('is-copied');
  }, 1800);
}

/** A small padlock that takes the colour of its text. */
export function lockIcon(): SVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'lock-icon');
  svg.setAttribute('aria-hidden', 'true');
  // Only our own constants go in here.
  svg.innerHTML = '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>';
  return svg;
}

/** The children of an SVG, parsed from a constant. */
function svgChildren(markup: string): Node[] {
  const holder = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  holder.innerHTML = markup;
  return [...holder.childNodes];
}

export const field = (label: string, input: HTMLElement) => h('label.lobby__field', null, h('span', null, label), input);

/** One of the pips that show how full a room is. */
export const pips = (taken: number, total: number) => h('span.pips.pips--room', { role: 'img', 'aria-label': `${taken}/${total}` }, ...Array.from({ length: total }, (_, i) => h(i < taken ? 'span.pip.pip--on' : 'span.pip', null)));
