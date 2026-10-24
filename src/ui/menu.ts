import type { Sound } from '../audio';
import { buildControl, type Control } from './controls';

export { h } from './dom';

export interface Choice<T> {
  value: T;
  label: string;
}

/** One tile of a `tiles` row. */
export interface Tile {
  value: unknown;
  label: string;
  /** The tile's colour while it is on. */
  color: string;
  /** Draws its symbol centred on the origin, about `r` in size, in the colour the tile is drawn with. */
  draw: (ctx: CanvasRenderingContext2D, r: number) => void;
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
  /** Shown, but dimmed and not changeable while this holds: a slider that has nothing to limit right now. */
  inactive?: () => boolean;
  /** An edit is over (a slider let go of, a switch flipped): save it, send it on. */
  commit?: () => void;
}

export type MenuItem =
  | (Placed & { kind: 'action'; label: string; run: () => void; primary?: boolean; className?: string; /** Small second line under the label. */ hint?: string; /** A status line below the hint, refreshed with the rest of the menu. */ status?: () => string; /** Turn the status badge into a separate reset action. */ statusAction?: () => void; statusActionLabel?: string; /** Makes the button a card: a drawing above its label and hint. */ icon?: () => Node; /** Short category above a card's title. */ tag?: string; /** A persistent selection, independent of keyboard focus. */ selected?: () => boolean; /** Keeps conditional actions out of both sight and keyboard focus. */ hidden?: () => boolean; disabled?: boolean | (() => boolean) })
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
        /** A row of tiles, each one on or off on its own. */
        kind: 'tiles';
        label: string;
        tiles: Tile[];
        /** Let every tile be switched off, so the group can mean none. */
        allowEmpty?: boolean;
        /** Two buttons beside the label that switch every tile on or off at once (also the A and N keys). */
        quick?: { all: string; none: string };
        /** The values of the tiles that are on. */
        get: () => unknown[];
        set: (v: unknown[]) => void;
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
        /** CPU level last chosen for this seat during the current crew edit. */
        lastCpu?: () => unknown;
        rememberCpu?: (value: unknown) => void;
        get: () => unknown;
        set: (v: unknown) => void;
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
  /** Return true to consume Escape without popping the screen (e.g. closing a disclosure/dialog). */
  onEscape?: () => boolean | void;
  /** Release subscriptions or transient work before the screen is rebuilt or covered. */
  dispose?: () => void;
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
  private actionRefresh: (() => void)[] = [];

  constructor(
    private readonly root: HTMLElement,
    readonly sound: Sound,
  ) {}

  get isOpen(): boolean {
    return this.stack.length > 0;
  }

  get depth(): number {
    return this.stack.length;
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

  /** Swap the current page while keeping its parent in the navigation stack. */
  replace(screen: ScreenFactory, focusIndex = 0): void {
    const level = this.stack[this.stack.length - 1];
    if (!level) return;
    level.screen = screen;
    level.focus = focusIndex;
    this.render(focusIndex);
  }

  /** Build the current screen again (e.g. after a language switch or a new row), without the screen's entrance. The focus stays on its row, or goes to row `focus`. */
  rebuild(focus?: number): void {
    if (!this.isOpen) return;
    this.render(focus ?? Math.max(0, this.focusedIndex()), true);
  }

  back(): void {
    if (this.current?.onEscape?.() === true) return;
    if (this.stack.length > 1) {
      this.stack.pop();
      this.render(this.stack[this.stack.length - 1].focus);
    }
  }

  close(): void {
    this.current?.dispose?.();
    this.stack = [];
    this.current = null;
    this.root.hidden = true;
    this.root.replaceChildren();
  }

  /** Re-read every setting row, e.g. after something outside the menu changed a value. */
  refresh(): void {
    for (const control of this.controls) control.refresh();
    for (const refresh of this.actionRefresh) refresh();
    this.current?.update?.();
  }

  /** Move from the navigation rail into a screen's choices. */
  focusSection(section: string): void {
    this.focusables.find((el) => el.parentElement?.dataset.section === section && !el.hidden)?.focus();
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
        if (this.isTitleScreen()) return this.handleTitleDirection(focused, e.key);
        const dir = e.key === 'ArrowDown' ? 1 : -1;
        const next = this.visibleFrom(index < 0 ? (dir === 1 ? -1 : 0) : index, dir);
        this.focusables[next]?.focus();
        this.sound.blip();
        return true;
      }
      case 'ArrowLeft':
      case 'ArrowRight':
        if (this.isTitleScreen()) return this.handleTitleDirection(focused, e.key);
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
    if (!from) return;
    const cardShell = from.parentElement?.classList.contains('briefing__preset-shell') ? from.parentElement : null;
    const row = cardShell?.parentElement ?? from.parentElement;
    if (!row?.matches('.items--row')) return;
    if (cardShell) {
      const shells = Array.from(row.children).filter((child): child is HTMLElement => child instanceof HTMLElement && child.classList.contains('briefing__preset-shell'));
      const targetShell = shells[shells.indexOf(cardShell) + dir];
      const target = targetShell?.querySelector<HTMLElement>('.item--card');
      if (target && !target.hidden) {
        target.focus();
        this.sound.blip();
      }
      return;
    }
    const target = this.focusables[this.focusables.indexOf(from) + dir];
    if (target && target.parentElement === row && !target.hidden) {
      target.focus();
      this.sound.blip();
    }
  }

  /** The launcher is a spatial layout, so its arrows follow what is actually beside each row. */
  private isTitleScreen(): boolean {
    return !!this.root.querySelector('.screen--title');
  }

  private handleTitleDirection(from: HTMLElement | null, key: string): true {
    if (!from || !this.focusables.includes(from)) return true;

    const section = from.parentElement?.dataset.section;
    if (section === 'navigation' && key === 'ArrowRight') {
      const navItems = this.focusables.filter((el) => el.parentElement?.dataset.section === 'navigation' && this.isVisible(el));
      const navIndex = navItems.indexOf(from);
      // Local and Online act as tabs: a single right arrow enters the selected panel.
      if (navIndex === 0 || navIndex === 1) {
        from.click();
        return true;
      }
    }

    if (this.focusInDirection(from, key)) return true;

    if (key === 'ArrowLeft' && (section === 'modes' || section === 'daily' || section === 'online')) {
      const selectedTab = this.focusables.find((el) =>
        el.parentElement?.dataset.section === 'navigation' && el.getAttribute('aria-pressed') === 'true' && this.isVisible(el),
      );
      selectedTab?.focus();
    }
    return true;
  }

  private isVisible(el: HTMLElement): boolean {
    return !el.hidden && !el.closest('[hidden]') && el.getClientRects().length > 0;
  }

  /** Pick the closest visible row in the requested direction, using the layout's actual geometry. */
  private focusInDirection(from: HTMLElement, key: string): boolean {
    const source = from.getBoundingClientRect();
    const horizontal = key === 'ArrowLeft' || key === 'ArrowRight';
    const positive = key === 'ArrowRight' || key === 'ArrowDown';
    const sourcePrimary = horizontal ? (source.left + source.right) / 2 : (source.top + source.bottom) / 2;
    const sourceCrossStart = horizontal ? source.top : source.left;
    const sourceCrossEnd = horizontal ? source.bottom : source.right;
    let best: HTMLElement | undefined;
    let bestScore = Number.POSITIVE_INFINITY;

    for (const candidate of this.focusables) {
      if (candidate === from || !this.isVisible(candidate)) continue;
      const rect = candidate.getBoundingClientRect();
      const primary = horizontal ? (rect.left + rect.right) / 2 : (rect.top + rect.bottom) / 2;
      const delta = primary - sourcePrimary;
      if (positive ? delta <= 1 : delta >= -1) continue;

      const crossStart = horizontal ? rect.top : rect.left;
      const crossEnd = horizontal ? rect.bottom : rect.right;
      const crossGap = Math.max(0, sourceCrossStart - crossEnd, crossStart - sourceCrossEnd);
      const primaryGap = Math.abs(delta);
      // Overlapping rows on the cross axis win, then shorter movement wins.
      const score = primaryGap + crossGap * 2;
      if (score < bestScore) {
        best = candidate;
        bestScore = score;
      }
    }

    if (!best) return false;
    best.focus();
    this.sound.blip();
    return true;
  }

  private render(focusIndex?: number, quietly = false): void {
    this.current?.dispose?.();
    const screen = this.stack[this.stack.length - 1].screen();
    const el = screen.build();
    if (quietly) el.dataset.rebuild = '';
    const list = el.querySelector<HTMLElement>('[data-items]') ?? el;
    this.current = screen;
    this.focusables = [];
    this.controls = [];
    this.actionRefresh = [];
    const env = { sound: this.sound, changed: () => this.refresh() };

    for (const item of screen.items) {
      let row: HTMLElement;
      let rowFocusables: HTMLElement[] | null = null;
      if (item.kind === 'action') {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = [item.primary ? 'item item--primary' : 'item', item.className].filter(Boolean).join(' ');
        if (item.icon) {
          b.classList.add('item--card');
          const picture = document.createElement('span');
          picture.className = 'item__icon';
          picture.append(item.icon());
          const label = document.createElement('span');
          label.className = 'item__title';
          label.textContent = item.label;
          b.append(picture, label);
          if (item.hint) {
            const hint = document.createElement('span');
            hint.className = 'item__hint';
            hint.textContent = item.hint;
            b.append(hint);
          }
        } else if (item.hint) {
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
        const isDisabled = (): boolean => typeof item.disabled === 'function' ? item.disabled() : !!item.disabled;
        const refresh = (): void => {
          const disabled = isDisabled();
          b.classList.toggle('is-disabled', disabled);
          b.setAttribute('aria-disabled', String(disabled));
        };
        refresh();
        this.actionRefresh.push(refresh);
        if (item.tag) b.prepend(Object.assign(document.createElement('span'), { className: 'item__tag', textContent: item.tag }));
        const shell = item.statusAction ? Object.assign(document.createElement('div'), { className: 'briefing__preset-shell' }) : null;
        if (shell) shell.dataset.section = item.section ?? '';
        const statusButton = item.status && item.statusAction ? document.createElement('button') : null;
        const statusCount = statusButton ? Object.assign(document.createElement('span'), { className: 'item__status-count' }) : null;
        const statusAction = statusButton ? Object.assign(document.createElement('span'), { className: 'item__status-action', textContent: item.statusActionLabel ?? '' }) : null;
        if (statusButton && shell && statusCount && statusAction) {
          statusButton.type = 'button';
          statusButton.className = 'item__status item__status-reset';
          statusButton.hidden = true;
          statusButton.append(statusCount, statusAction);
          shell.append(b, statusButton);
          statusButton.addEventListener('click', (event) => {
            event.stopPropagation();
            if (statusButton.hidden || !item.statusAction) return;
            this.sound.select();
            item.statusAction();
            b.focus({ preventScroll: true });
          });
          row = shell;
          rowFocusables = [b, statusButton];
        } else {
          row = b;
        }
        const status = item.status && !item.statusAction ? Object.assign(document.createElement('span'), { className: 'item__status' }) : null;
        if (status) b.append(status);
        if (item.selected || item.status || item.hidden) {
          const marker = document.createElement('span');
          marker.className = 'item__selection';
          marker.textContent = '✓';
          marker.setAttribute('aria-hidden', 'true');
          if (item.selected && item.icon) b.append(marker);
          this.controls.push({ el: b, refresh: () => {
            b.hidden = item.hidden?.() ?? false;
            if (item.selected) {
              const selected = item.selected();
              b.classList.toggle('is-selected', selected);
              b.setAttribute('aria-pressed', String(selected));
              if (item.icon) marker.hidden = !selected;
            }
            const text = item.status?.() ?? '';
            if (statusButton) {
              statusCount!.textContent = text;
              statusButton.hidden = !text;
              statusButton.setAttribute('aria-label', text ? `${text}. ${item.statusActionLabel ?? ''}` : '');
              shell?.classList.toggle('is-modified', !!text);
              b.classList.toggle('is-modified', !!text);
            } else if (status) {
              status.textContent = text;
              status.hidden = !text;
              b.classList.toggle('is-modified', !!text);
            }
          } });
        }
        b.addEventListener('click', () => {
          if (isDisabled()) return;
          this.sound.select();
          item.run();
        });
      } else {
        const control = buildControl(item, env);
        this.controls.push(control);
        row = control.el;
      }
      const home = item.section ? el.querySelector<HTMLElement>(`[data-section="${item.section}"]`) : null;
      (home ?? list).append(row);
      this.focusables.push(...(rowFocusables ?? [row]));
    }

    this.root.replaceChildren(el);
    this.root.hidden = false;
    this.refresh();
    this.focusables[focusIndex ?? screen.focus ?? 0]?.focus({ preventScroll: true });
  }
}
