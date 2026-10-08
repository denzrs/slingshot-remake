import type { Sound } from '../audio';
import { buildControl, type Control } from './controls';

export { h } from './dom';

export interface Choice<T> {
  value: T;
  label: string;
}

interface Placed {
  /** The `[data-section]` of the screen this row goes into; the screen's main list when left out. */
  section?: string;
}

/** What the rows that hold a value can do on top of that. */
interface Live {
  /** The row is out of sight while this holds, e.g. a cap's slider while shot power isn't capped. */
  hidden?: () => boolean;
  /** While the row is hidden and this holds, it still takes up its space (unseen), so the screen doesn't change size. */
  reserve?: () => boolean;
  /** An edit is over (a slider let go of, a switch flipped): save it, send it on. */
  commit?: () => void;
}

export type MenuItem =
  | (Placed & { kind: 'action'; label: string; run: () => void; primary?: boolean; /** Small second line under the label. */ hint?: string; disabled?: boolean })
  | (Placed &
      Live & {
        /** Cycles through its options; the arrows at its sides go back and forth. */
        kind: 'choice';
        label: string;
        options: Choice<unknown>[];
        get: () => unknown;
        set: (v: unknown) => void;
        disabled?: () => boolean;
        /** A colour dot before the label. */
        swatch?: string;
      })
  | (Placed & Live & { kind: 'toggle'; label: string; get: () => boolean; set: (v: boolean) => void })
  | (Placed &
      Live & {
        /** A track with a stop for each of its steps, lowest first. */
        kind: 'slider';
        label: string;
        steps: Choice<unknown>[];
        get: () => unknown;
        set: (v: unknown) => void;
      })
  | (Placed &
      Live & {
        /** A bar with a segment for each option: pick one. */
        kind: 'segmented';
        label: string;
        options: Choice<unknown>[];
        get: () => unknown;
        set: (v: unknown) => void;
      })
  | (Placed &
      Live & {
        /** A ship of the line-up. */
        kind: 'seat';
        label: string;
        /** The ship's colour. */
        swatch: string;
        /** Who can fly it: the first is the human, the others are the CPU levels. */
        fliers: Choice<unknown>[];
        cpuCaption: string;
        get: () => unknown;
        set: (v: unknown) => void;
        /** In team play: the teams it can be in, each with its colour. */
        teams?: { caption: string; options: Choice<unknown>[]; tones: string[]; get: () => unknown; set: (v: unknown) => void };
        /** A button that takes the ship out. */
        remove?: { label: string; disabled: () => boolean; run: () => void };
      });

/** Screens are built from a factory, so a language switch can rebuild them with fresh labels. */
type ScreenFactory = () => Screen;

export interface Screen {
  /** Builds the screen's DOM. Items become keyboard-navigable rows inside `[data-items]`, or inside the `[data-section]` they name. */
  build: () => HTMLElement;
  items: MenuItem[];
  /** The row (an index into `items`) that has the focus when the screen opens; the first by default. */
  focus?: number;
  /** A value changed (or something outside changed it): redraw what the rows don't, like a summary line. */
  update?: () => void;
  /** What Esc does when this is the bottom-most screen. */
  onEscape?: () => void;
}

interface Level {
  screen: ScreenFactory;
  /** The row that had the focus when a screen was opened on top, so going back lands where you left. */
  focus: number;
}

/**
 * DOM menu stack with retro keyboard navigation: ↑/↓ move, ←/→ change a setting,
 * Enter/Space activate, Esc goes back. Mouse and touch work as normal buttons, sliders and switches.
 * The rows that hold a value read their own ←/→; the menu only moves between rows.
 */
export class Menu {
  private stack: Level[] = [];
  /** The screen on display. */
  private current: Screen | null = null;
  /** Every row, in the order ↑/↓ visit them. */
  private focusables: HTMLElement[] = [];
  private controls: Control[] = [];

  constructor(
    private readonly root: HTMLElement,
    readonly sound: Sound,
  ) {}

  get isOpen(): boolean {
    return this.stack.length > 0;
  }

  /** Replace the whole stack with one screen. */
  open(screen: ScreenFactory): void {
    this.stack = [{ screen, focus: 0 }];
    this.render();
  }

  push(screen: ScreenFactory): void {
    this.rememberFocus();
    this.stack.push({ screen, focus: 0 });
    this.render();
  }

  /** Build the current screen again (e.g. after a language switch or a new row), without the screen's entrance. The focus stays on its row, or goes to row `focus`. */
  rebuild(focus?: number): void {
    if (!this.isOpen) return;
    this.render(focus ?? Math.max(0, this.focusedIndex()), true);
  }

  back(): void {
    if (this.stack.length > 1) {
      this.stack.pop();
      this.render(this.stack[this.stack.length - 1].focus);
    } else {
      this.current?.onEscape?.();
    }
  }

  close(): void {
    this.stack = [];
    this.current = null;
    this.root.hidden = true;
    this.root.replaceChildren();
  }

  /** Re-read every setting row, e.g. after something outside the menu changed a value. */
  refresh(): void {
    for (const control of this.controls) control.refresh();
    this.current?.update?.();
  }

  /** Returns true if the key was consumed. */
  handleKey(e: KeyboardEvent): boolean {
    // Typing into a field (the lobby's name, address, password) is not menu navigation — only Esc still goes back.
    if (e.key !== 'Escape' && (e.target as HTMLElement | null)?.matches?.('input, select, textarea')) return false;
    // A screen without rows of its own (the lobby) leaves its keys alone.
    if (!this.focusables.length && e.key !== 'Escape') return false;
    const focused = document.activeElement as HTMLElement | null;
    const index = this.focusedIndex();
    // Somewhere the menu knows nothing about (a button of the lobby): its own keys apply.
    const elsewhere = index < 0 && !!focused && focused !== document.body && this.root.contains(focused);
    if (elsewhere && e.key !== 'Escape') return false;
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        const dir = e.key === 'ArrowDown' ? 1 : -1;
        const next = this.visibleFrom(index < 0 ? (dir === 1 ? -1 : 0) : index, dir);
        this.focusables[next]?.focus();
        this.sound.blip();
        return true;
      }
      case 'ArrowLeft':
      case 'ArrowRight':
        // The rows that hold a value read these themselves; a plain button just hands over to its neighbour.
        this.focusBeside(focused, e.key === 'ArrowRight' ? 1 : -1);
        return true;
      case 'Enter':
      case ' ':
        if (index >= 0) {
          if (!e.repeat && focused instanceof HTMLButtonElement) focused.click();
        } else {
          this.focusables[this.visibleFrom(-1, 1)]?.focus();
        }
        return true;
      case 'Escape':
        this.sound.blip();
        this.back();
        return true;
    }
    return false;
  }

  /** The next row from `index` in direction `dir` that is in sight, wrapping around. */
  private visibleFrom(index: number, dir: 1 | -1): number {
    const n = this.focusables.length;
    for (let step = 1; step <= n; step++) {
      const i = (index + dir * step + n * step) % n;
      if (!this.focusables[i].hidden) return i;
    }
    return Math.max(0, index);
  }

  private focusedIndex(): number {
    const focused = document.activeElement as HTMLElement | null;
    return focused ? this.focusables.indexOf(focused) : -1;
  }

  private rememberFocus(): void {
    const level = this.stack[this.stack.length - 1];
    if (level) level.focus = Math.max(0, this.focusedIndex());
  }

  /** ←/→ on a button laid out in a row (the choices under a result, say) move to its neighbour. */
  private focusBeside(from: HTMLElement | null, dir: 1 | -1): void {
    if (!from?.parentElement?.matches('.items--row')) return;
    const target = this.focusables[this.focusables.indexOf(from) + dir];
    if (target && target.parentElement === from.parentElement && !target.hidden) {
      target.focus();
      this.sound.blip();
    }
  }

  private render(focusIndex?: number, quietly = false): void {
    const screen = this.stack[this.stack.length - 1].screen();
    const el = screen.build();
    if (quietly) el.dataset.rebuild = '';
    const list = el.querySelector<HTMLElement>('[data-items]') ?? el;
    this.current = screen;
    this.focusables = [];
    this.controls = [];
    const env = { sound: this.sound, changed: () => this.refresh() };

    for (const item of screen.items) {
      let row: HTMLElement;
      if (item.kind === 'action') {
        const b = document.createElement('button');
        b.type = 'button';
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
        row = b;
      } else {
        const control = buildControl(item, env);
        this.controls.push(control);
        row = control.el;
      }
      const home = item.section ? el.querySelector<HTMLElement>(`[data-section="${item.section}"]`) : null;
      (home ?? list).append(row);
      this.focusables.push(row);
    }

    this.root.replaceChildren(el);
    this.root.hidden = false;
    this.refresh();
    this.focusables[focusIndex ?? screen.focus ?? 0]?.focus({ preventScroll: true });
  }
}
