import type { Sound } from '../audio';

export interface Choice<T> {
  value: T;
  label: string;
}

export type MenuItem =
  | { kind: 'action'; label: string; run: () => void; primary?: boolean; /** Small second line under the label. */ hint?: string; disabled?: boolean }
  | {
      kind: 'choice';
      label: string;
      options: Choice<unknown>[];
      get: () => unknown;
      set: (v: unknown) => void;
      disabled?: () => boolean;
    };

/** Screens are built from a factory, so a language switch can rebuild them with fresh labels. */
export type ScreenFactory = () => Screen;

export interface Screen {
  /** Builds the screen's DOM. Items become keyboard-navigable buttons inside `[data-items]`. */
  build: () => HTMLElement;
  items: MenuItem[];
  /** What Esc does when this is the bottom-most screen. */
  onEscape?: () => void;
}

/**
 * DOM menu stack with retro keyboard navigation: ↑/↓ move, ←/→ change a setting,
 * Enter/Space activate, Esc goes back. Mouse and touch work as normal buttons.
 */
export class Menu {
  private stack: ScreenFactory[] = [];
  private buttons: HTMLButtonElement[] = [];
  private rows = new Map<HTMLButtonElement, { item: Extract<MenuItem, { kind: 'choice' }>; value: HTMLElement }>();

  constructor(
    private readonly root: HTMLElement,
    private readonly sound: Sound,
  ) {}

  get isOpen(): boolean {
    return this.stack.length > 0;
  }

  /** Replace the whole stack with one screen. */
  open(screen: ScreenFactory): void {
    this.stack = [screen];
    this.render();
  }

  push(screen: ScreenFactory): void {
    this.stack.push(screen);
    this.render();
  }

  /** Build the current screen again (e.g. after a language switch), keeping the focused row. */
  rebuild(): void {
    if (!this.isOpen) return;
    const focused = document.activeElement as HTMLButtonElement | null;
    this.render(Math.max(0, focused ? this.buttons.indexOf(focused) : 0));
  }

  back(): void {
    if (this.stack.length > 1) {
      this.stack.pop();
      this.render();
    } else {
      this.stack[0]?.().onEscape?.();
    }
  }

  close(): void {
    this.stack = [];
    this.root.hidden = true;
    this.root.replaceChildren();
  }

  /** Re-read every setting row, e.g. after something outside the menu changed a value. */
  refresh(): void {
    for (const [btn, row] of this.rows) this.updateChoice(row.item, row.value, btn);
  }

  /** Returns true if the key was consumed. */
  handleKey(e: KeyboardEvent): boolean {
    // Typing into a field (the lobby's name, address, password) is not menu navigation — only Esc still goes back.
    if (e.key !== 'Escape' && (e.target as HTMLElement | null)?.matches?.('input, select, textarea')) return false;
    const focused = document.activeElement as HTMLButtonElement | null;
    const index = focused ? this.buttons.indexOf(focused) : -1;
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        const dir = e.key === 'ArrowDown' ? 1 : -1;
        const next = index < 0 ? 0 : (index + dir + this.buttons.length) % this.buttons.length;
        this.buttons[next]?.focus();
        this.sound.blip();
        return true;
      }
      case 'ArrowLeft':
      case 'ArrowRight': {
        const row = focused && this.rows.get(focused);
        if (row) this.cycle(row.item, e.key === 'ArrowRight' ? 1 : -1);
        return true;
      }
      case 'Enter':
      case ' ':
        if (index >= 0) {
          if (!e.repeat) focused!.click();
        } else {
          this.buttons[0]?.focus();
        }
        return true;
      case 'Escape':
        this.sound.blip();
        this.back();
        return true;
    }
    return false;
  }

  private render(focusIndex = 0): void {
    const screen = this.stack[this.stack.length - 1]();
    const el = screen.build();
    const list = el.querySelector<HTMLElement>('[data-items]') ?? el;
    this.buttons = [];
    this.rows.clear();

    for (const item of screen.items) {
      const b = document.createElement('button');
      b.type = 'button';
      if (item.kind === 'action') {
        b.className = item.primary ? 'item item--primary' : 'item';
        if (item.hint) {
          b.classList.add('item--hinted');
          const label = document.createElement('span');
          label.textContent = item.label;
          const hint = document.createElement('span');
          hint.className = 'item__hint';
          hint.textContent = item.hint;
          b.append(label, hint);
        } else {
          b.textContent = item.label;
        }
        if (item.disabled) {
          b.classList.add('is-disabled');
          b.setAttribute('aria-disabled', 'true');
        }
        b.addEventListener('click', () => {
          if (item.disabled) return;
          this.sound.select();
          item.run();
        });
      } else {
        b.className = 'item item--choice';
        const label = document.createElement('span');
        label.className = 'item__label';
        label.textContent = item.label;
        const value = document.createElement('span');
        value.className = 'item__value';
        b.append(label, value);
        this.rows.set(b, { item, value });
        this.updateChoice(item, value, b);
        b.addEventListener('click', () => this.cycle(item, 1));
      }
      list.append(b);
      this.buttons.push(b);
    }

    this.root.replaceChildren(el);
    this.root.hidden = false;
    this.buttons[focusIndex]?.focus({ preventScroll: true });
  }

  private cycle(item: Extract<MenuItem, { kind: 'choice' }>, dir: 1 | -1): void {
    if (item.disabled?.()) return;
    const i = item.options.findIndex((o) => o.value === item.get());
    const next = item.options[(i + dir + item.options.length) % item.options.length];
    item.set(next.value);
    this.sound.blip();
    // Other rows may depend on this one (e.g. CPU level only matters against the CPU).
    this.refresh();
  }

  private updateChoice(item: Extract<MenuItem, { kind: 'choice' }>, value: HTMLElement, button: HTMLButtonElement): void {
    const current = item.options.find((o) => o.value === item.get());
    value.textContent = current?.label ?? String(item.get());
    const disabled = item.disabled?.() ?? false;
    button.classList.toggle('is-disabled', disabled);
    button.setAttribute('aria-disabled', String(disabled));
    button.setAttribute('aria-label', `${item.label}: ${value.textContent}`);
  }
}

/** Small DOM helper: h('div.class', {…attrs}, …children). */
export function h(tag: string, attrs: Record<string, string> | null, ...children: (Node | string)[]): HTMLElement {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name);
  if (classes.length) el.className = classes.join(' ');
  if (attrs) for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.append(...children);
  return el;
}
