import type { Sound } from '../../platform/audio';
import { t, type Key } from '../../platform/i18n';
import { ROOM_COLORS, ROOM_SYMBOLS, type RoomColor, type RoomLook, type RoomSymbol, type RoomVisibility } from '../../data/roomLook';
import { segmentedControl } from '../menu/controls';
import { h } from '../menu/menu';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** The predefined symbols, drawn on a 24-unit grid in the current colour. */
const SYMBOL_SVG: Record<RoomSymbol, string> = {
  planet: '<circle cx="12" cy="12" r="6"/><ellipse cx="12" cy="12" rx="11" ry="3.4" transform="rotate(-18 12 12)" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  moon: '<path d="M14.6 3.1A9 9 0 1 0 20.9 16.4 7.2 7.2 0 0 1 14.6 3.1Z"/>',
  star: '<path d="M12 2.8l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.7l-5.9 3.1 1.2-6.5-4.8-4.6 6.6-.9z"/>',
  sun: '<circle cx="12" cy="12" r="4.8"/><path d="M12 1.8v3.2M12 19v3.2M1.8 12h3.2M19 12h3.2M4.6 4.6l2.3 2.3M17.1 17.1l2.3 2.3M19.4 4.6l-2.3 2.3M6.9 17.1l-2.3 2.3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  comet: '<circle cx="15" cy="9" r="4.4"/><path d="M17.1 11.1 3 21 12.9 6.9Z" opacity="0.6"/>',
  blackhole: '<circle cx="12" cy="12" r="3.4"/><circle cx="12" cy="12" r="7.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-dasharray="4.5 2.6"/><circle cx="12" cy="12" r="10.4" fill="none" stroke="currentColor" stroke-width="0.9" opacity="0.5"/>',
  ufo: '<path d="M8 11.2a4 4 0 0 1 8 0z"/><ellipse cx="12" cy="13.2" rx="10" ry="2.6"/>',
  asteroid: '<path d="M6.2 7.1l4.1-3.4 5.2.9 3.9 3.1.9 4.4-2.1 3.4.9 4.3-4.1 2.9-5.1-1-3.1-3.1-2.6-3.9z"/>',
};

const SYMBOL_LABEL: Record<RoomSymbol, Key> = {
  planet: 'roomLook.symbol.planet',
  moon: 'roomLook.symbol.moon',
  star: 'roomLook.symbol.star',
  sun: 'roomLook.symbol.sun',
  comet: 'roomLook.symbol.comet',
  blackhole: 'roomLook.symbol.blackhole',
  ufo: 'roomLook.symbol.ufo',
  asteroid: 'roomLook.symbol.asteroid',
};

export const COLOR_LABEL: Record<RoomColor, Key> = {
  '#ff8660': 'roomLook.colour.coral',
  '#ffd27a': 'roomLook.colour.gold',
  '#c6e86a': 'roomLook.colour.lime',
  '#6fe3c8': 'roomLook.colour.mint',
  '#62b6ff': 'roomLook.colour.sky',
  '#b99cff': 'roomLook.colour.violet',
  '#ff6f9f': 'roomLook.colour.pink',
  '#e8e4d8': 'roomLook.colour.silver',
  '#ff5a5a': 'roomLook.colour.red',
  '#ffa94d': 'roomLook.colour.amber',
  '#4fd98a': 'roomLook.colour.green',
  '#36c2d6': 'roomLook.colour.teal',
  '#5b7cff': 'roomLook.colour.royal',
  '#e46cff': 'roomLook.colour.magenta',
  '#d4915c': 'roomLook.colour.copper',
  '#9aa8bd': 'roomLook.colour.slate',
};

/** A symbol as an element; it takes the colour of its surroundings. */
function symbolSvg(symbol: RoomSymbol): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'currentColor');
  // Only our own constants go in here.
  svg.innerHTML = SYMBOL_SVG[symbol];
  return svg;
}

/** A room's symbol in the room's colour, as it shows in the lobby. */
export function roomIcon(symbol: RoomSymbol, color: string): HTMLElement {
  const icon = h('span.room-icon', null, symbolSvg(symbol));
  icon.style.setProperty('--tone', color);
  return icon;
}

interface PickOption<T> {
  value: T;
  label: string;
  face: Node;
}

/**
 * A row of buttons to choose one of a few predefined things; read-only, the row only shows the choice.
 *
 * With `row`, a long list stays one row: it shows that many choices (the current one always among them, in the last place
 * when it is further on) and a button beside them that opens the whole set as a panel over the page, so nothing around it
 * moves. Choosing in the panel, clicking elsewhere or Escape closes it.
 */
export function picker<T extends string>(
  label: string, options: PickOption<T>[], readonly: boolean, pick: (value: T) => void,
  { row }: { row?: number } = {},
) {
  const optionButton = (option: PickOption<T>, face: Node, after?: () => void) => {
    const button = h('button.room-pick__option', { type: 'button', role: 'radio', title: option.label, 'aria-label': option.label }, face);
    button.toggleAttribute('disabled', readonly);
    if (!readonly) button.addEventListener('click', () => { pick(option.value); after?.(); });
    return { value: option.value, button };
  };
  const buttons = options.map((option) => optionButton(option, option.face));
  const grid = h('div.room-pick', { role: 'radiogroup', 'aria-label': label }, ...buttons.map((b) => b.button));
  const folds = row !== undefined && options.length > row && !readonly;
  let current: T | null = null;
  const paintRow = () => {
    if (!folds) return;
    const at = buttons.findIndex((b) => b.value === current);
    // The first row, with the current choice in its last place when it lies further on.
    buttons.forEach(({ button }, i) => { button.hidden = at >= row ? i !== at && i >= row - 1 : i >= row; });
  };
  const paintOn = (list: { value: T; button: HTMLElement }[]) => {
    for (const { value, button } of list) {
      button.classList.toggle('is-on', value === current);
      button.setAttribute('aria-checked', String(value === current));
    }
  };
  if (!folds) {
    return { el: grid, show(next: T): void { current = next; paintOn(buttons); } };
  }

  const more = h('button.room-pick__more', { type: 'button', 'aria-haspopup': 'true', 'aria-expanded': 'false' }, `+${options.length - row}`) as HTMLButtonElement;
  more.title = t('picker.more', { n: options.length });
  more.setAttribute('aria-label', more.title);
  const panel = h('div.room-pick__panel', { role: 'radiogroup', 'aria-label': label, hidden: '' });
  const group = h('div.room-pick-group', null, grid, more, panel);
  const close = (focus = false) => {
    if (panel.hidden) return;
    panel.hidden = true;
    more.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', escape, true);
    if (focus) more.focus({ preventScroll: true });
  };
  const outside = (event: Event) => { if (!(event.target instanceof Node) || !group.contains(event.target)) close(); };
  const escape = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    close(true);
  };
  const open = () => {
    // Its own buttons, built when opened, the size of the row's, so the panel is the row grown, not a new look.
    const all = options.map((option) => optionButton(option, option.face.cloneNode(true), () => close(true)));
    const size = buttons.find((b) => !b.button.hidden)?.button.offsetWidth ?? 36;
    panel.style.setProperty('--pick-size', `${size}px`);
    panel.replaceChildren(...all.map((b) => b.button));
    paintOn(all);
    panel.hidden = false;
    more.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape, true);
    (all.find((b) => b.value === current) ?? all[0]).button.focus({ preventScroll: true });
  };
  more.addEventListener('click', () => (panel.hidden ? open() : close()));
  return {
    el: group,
    show(next: T): void {
      current = next;
      paintOn(buttons);
      paintRow();
    },
  };
}

/** One part of a room's look, redrawn from the look as it is now. */
export interface LookControl {
  el: HTMLElement;
  refresh(look: RoomLook): void;
}

/** Whether the room is listed (public) or only found by its code (private), as a switch. */
export function visibilityControl(look: RoomLook, change: (patch: Partial<RoomLook>) => void, { readonly = false, sound }: { readonly?: boolean; sound?: Sound } = {}): LookControl {
  let current = look;
  const control = segmentedControl(
    {
      kind: 'segmented',
      label: t('multiplayer.visibility'),
      options: [
        { value: 'public', label: t('multiplayer.public') },
        { value: 'private', label: t('multiplayer.private') },
      ],
      get: () => current.visibility,
      set: (v) => {
        current = { ...current, visibility: v as RoomVisibility };
        change({ visibility: v as RoomVisibility });
      },
    },
    { sound, changed: () => {}, readonly },
  );
  const refresh = (next: RoomLook): void => {
    current = next;
    control.refresh();
  };
  const el = h('div.look-visibility', null, control.el);
  refresh(look);
  return { el, refresh };
}

/**
 * The card that opens beside the room's symbol to choose the symbol and colour, in the pilot editor's style. Each choice applies at
 * once, and the card takes the colour as its accent while it is chosen. "Done", clicking elsewhere or Escape closes it.
 */
export interface LookDialog extends LookControl {
  /** Opens under `anchor` (the button that opened it), or under the middle of the screen without one. */
  open(anchor?: HTMLElement): void;
  close(): void;
  isOpen(): boolean;
}

export function lookDialog(look: RoomLook, change: (patch: Partial<RoomLook>) => void, { sound }: { sound?: Sound } = {}): LookDialog {
  let current = look;
  let shown = false;
  let anchor: HTMLElement | null = null;
  const redraw = (): void => {
    card.style.setProperty('--tone', current.color);
    preview.replaceChildren(symbolSvg(current.symbol));
    symbols.show(current.symbol);
    colours.show(current.color);
  };
  const apply = (patch: Partial<RoomLook>): void => {
    current = { ...current, ...patch };
    redraw();
    change(patch);
  };
  const symbols = picker<RoomSymbol>(
    t('multiplayer.symbol'),
    ROOM_SYMBOLS.map((symbol) => ({ value: symbol, label: t(SYMBOL_LABEL[symbol]), face: symbolSvg(symbol) })),
    false,
    (symbol) => {
      sound?.blip();
      apply({ symbol });
    },
  );
  // The card is over the page, so the whole set of colours fits in it.
  const colours = picker<RoomColor>(
    t('multiplayer.color'),
    ROOM_COLORS.map((color) => {
      const swatch = h('span.room-swatch', null);
      swatch.style.background = color;
      return { value: color, label: t(COLOR_LABEL[color]), face: swatch };
    }),
    false,
    (color) => {
      sound?.blip();
      apply({ color });
    },
  );
  const preview = h('span.look-popover__preview', { 'aria-hidden': 'true' });
  const done = h('button.lobby__button.lobby__button--primary', { type: 'button' }, t('multiplayer.lookDone'));
  const card = h(
    'div.look-popover',
    { role: 'dialog', 'aria-label': t('multiplayer.lookTitle') },
    h('header.look-popover__head', null, preview, h('span.look-popover__caption', null, t('multiplayer.lookTitle'))),
    h('span.look-popover__caption', null, t('multiplayer.symbol')), symbols.el,
    h('span.look-popover__caption', null, t('multiplayer.color')), colours.el,
    h('div.look-popover__actions', null, done),
  );
  card.hidden = true;
  /** Under the anchor, kept inside the screen; the card is on the page's top layer, so no scrolling box cuts it off. */
  const place = (): void => {
    const width = card.offsetWidth;
    const height = card.offsetHeight;
    const box = anchor?.isConnected ? anchor.getBoundingClientRect() : null;
    const left = box ? box.left - 8 : (innerWidth - width) / 2;
    const below = box ? box.bottom + 10 : (innerHeight - height) / 2;
    const top = box && below + height > innerHeight - 16 && box.top - height - 10 > 16 ? box.top - height - 10 : below;
    card.style.left = `${Math.round(Math.max(16, Math.min(left, innerWidth - width - 16)))}px`;
    card.style.top = `${Math.round(Math.max(16, top))}px`;
  };
  const outside = (event: Event): void => {
    if (event.target instanceof Node && !card.contains(event.target) && !anchor?.contains(event.target)) close();
  };
  const escape = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    close();
  };
  const close = (): void => {
    if (!shown) return;
    shown = false;
    card.hidden = true;
    card.remove();
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', escape, true);
    removeEventListener('resize', place);
    removeEventListener('scroll', place, true);
    if (anchor?.isConnected) anchor.focus({ preventScroll: true });
  };
  done.addEventListener('click', close);
  const open = (from?: HTMLElement): void => {
    if (shown) { close(); return; }
    shown = true;
    anchor = from ?? null;
    card.hidden = false;
    document.body.append(card);
    redraw();
    place();
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape, true);
    addEventListener('resize', place);
    addEventListener('scroll', place, true);
    (card.querySelector<HTMLElement>('.room-pick__option.is-on') ?? done).focus({ preventScroll: true });
  };
  const refresh = (next: RoomLook): void => {
    current = next;
    redraw();
  };
  refresh(look);
  return { el: card, open, close, isOpen: () => shown, refresh };
}
