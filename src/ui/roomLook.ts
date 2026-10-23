import type { Sound } from '../audio';
import { t, type Key } from '../i18n';
import { ROOM_COLORS, ROOM_SYMBOLS, type RoomColor, type RoomLook, type RoomSymbol, type RoomVisibility } from '../roomLook';
import { segmentedControl } from './controls';
import { h } from './menu';

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

const COLOR_LABEL: Record<RoomColor, Key> = {
  '#ff8660': 'roomLook.colour.coral',
  '#ffd27a': 'roomLook.colour.gold',
  '#c6e86a': 'roomLook.colour.lime',
  '#6fe3c8': 'roomLook.colour.mint',
  '#62b6ff': 'roomLook.colour.sky',
  '#b99cff': 'roomLook.colour.violet',
  '#ff6f9f': 'roomLook.colour.pink',
  '#e8e4d8': 'roomLook.colour.silver',
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

/** A row of buttons to choose one of a few predefined things; read-only, the row only shows the choice. */
export function picker<T extends string>(label: string, options: PickOption<T>[], readonly: boolean, pick: (value: T) => void) {
  const buttons = options.map((option) => {
    const button = h('button.room-pick__option', { type: 'button', role: 'radio', title: option.label, 'aria-label': option.label }, option.face);
    button.toggleAttribute('disabled', readonly);
    if (!readonly) button.addEventListener('click', () => pick(option.value));
    return { value: option.value, button };
  });
  const el = h('div.room-pick', { role: 'radiogroup', 'aria-label': label }, ...buttons.map((b) => b.button));
  return {
    el,
    show(current: T): void {
      for (const { value, button } of buttons) {
        button.classList.toggle('is-on', value === current);
        button.setAttribute('aria-checked', String(value === current));
      }
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
 * The room's symbol and colour at a glance: the symbol in its colour and its names. With `open`, a button
 * beside them opens the dialog to change them; without it, the summary only shows.
 */
export function lookSummary(look: RoomLook, open?: () => void): LookControl {
  const icon = h('span.look-summary__icon', null);
  const text = h('span.look-summary__text', null);
  const action = h('button.lobby__button', { type: 'button' }, t('multiplayer.lookChange'));
  if (open) action.addEventListener('click', open);
  const el = h('div.look-summary', null, icon, h('div.look-summary__body', null, h('span.look-caption', null, t('multiplayer.lookTitle')), text), ...(open ? [action] : []));
  const refresh = (next: RoomLook): void => {
    icon.replaceChildren(roomIcon(next.symbol, next.color));
    text.textContent = `${t(SYMBOL_LABEL[next.symbol])} · ${t(COLOR_LABEL[next.color])}`;
  };
  refresh(look);
  return { el, refresh };
}

/** The dialog that opens over the screen to choose the symbol and colour. Each choice applies at once. */
export interface LookDialog extends LookControl {
  open(): void;
  close(): void;
  isOpen(): boolean;
}

export function lookDialog(look: RoomLook, change: (patch: Partial<RoomLook>) => void, { sound }: { sound?: Sound } = {}): LookDialog {
  let current = look;
  let shown = false;
  const redraw = (): void => {
    dialog.style.setProperty('--tone', current.color);
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
  const done = h('button.lobby__button.lobby__button--primary', { type: 'button' }, t('multiplayer.lookDone'));
  /** Over the whole page while it is open: the screen it belongs to scrolls, and the dialog must not. */
  const close = (): void => {
    shown = false;
    dialog.hidden = true;
    dialog.remove();
  };
  done.addEventListener('click', close);
  const dialog = h(
    'div.look-dialog',
    { role: 'dialog', 'aria-modal': 'true', 'aria-label': t('multiplayer.lookTitle') },
    h('div.lobby__card.look-dialog__card', null, h('h3.setup__title', null, t('multiplayer.lookTitle')), h('span.look-caption', null, t('multiplayer.symbol')), symbols.el, h('span.look-caption', null, t('multiplayer.color')), colours.el, h('div.lobby__actions', null, done)),
  );
  dialog.hidden = true;
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) close();
  });
  const open = (): void => {
    shown = true;
    dialog.hidden = false;
    document.body.append(dialog);
    redraw();
    done.focus();
  };
  const refresh = (next: RoomLook): void => {
    current = next;
    redraw();
  };
  refresh(look);
  return { el: dialog, open, close, isOpen: () => shown, refresh };
}
