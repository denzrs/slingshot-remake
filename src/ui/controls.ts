import type { Sound } from '../audio';
import { t } from '../i18n';
import { h } from './dom';
import type { MenuItem } from './menu';

/** One row that can be changed: what the menu (or the lobby) needs to keep it in sync. */
export interface Control {
  /** The row; it is the one focusable thing, and it handles its own keys. */
  el: HTMLElement;
  /** Read the value again and redraw. */
  refresh(): void;
}

type Item<K extends MenuItem['kind']> = Extract<MenuItem, { kind: K }>;

/** What a control needs from whatever it sits in. */
export interface Env {
  sound?: Sound;
  /** A value changed (the control has redrawn itself already): the other rows may depend on it. */
  changed(): void;
  /** Show the value but don't let it be changed (the rules of somebody else's room). */
  readonly?: boolean;
}

/** Builds the control for a menu item that has one. */
export function buildControl(item: Exclude<MenuItem, { kind: 'action' }>, env: Env): Control {
  switch (item.kind) {
    case 'slider':
      return sliderControl(item, env);
    case 'toggle':
      return toggleControl(item, env);
    case 'segmented':
      return segmentedControl(item, env);
    case 'seat':
      return seatControl(item, env);
    case 'choice':
      return choiceControl(item, env);
  }
}

// ————————————————————————————— Stepping —————————————————————————————

/** Index `i` moved by `dir` within `count` values: it wraps around, or stops at the ends. */
export function stepIndex(i: number, dir: 1 | -1, count: number, wrap: boolean): number {
  if (count < 1) return 0;
  if (wrap) return (i + dir + count) % count;
  return Math.min(count - 1, Math.max(0, i + dir));
}

/** The value a slider takes when its track is hit at `fraction` (0 = left end, 1 = right end): the nearest of `count` evenly spaced stops. */
export function indexAtFraction(fraction: number, count: number): number {
  if (count < 2) return 0;
  return Math.min(count - 1, Math.max(0, Math.round(fraction * (count - 1))));
}

/** Where stop `i` of `count` sits on the track, from 0 to 1. */
export const positionOf = (i: number, count: number): number => (count < 2 ? 0 : i / (count - 1));

/** The stop a value is at; an unknown value (an old save, say) counts as the first. */
const indexOf = (options: { value: unknown }[], value: unknown): number => Math.max(0, options.findIndex((o) => o.value === value));

// ————————————————————————————— Shared bits —————————————————————————————

const reducedMotion = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A short pop on a value that just changed, so every step is felt. */
function pop(el: HTMLElement): void {
  if (reducedMotion()) return;
  el.animate?.([{ transform: 'scale(1.3)', color: 'var(--sodium)' }, { transform: 'scale(1)' }], { duration: 200, easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)' });
}

/** A row that just turned up slides in instead of jumping into place. */
function reveal(el: HTMLElement): void {
  if (reducedMotion()) return;
  el.animate?.([{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)' });
}

/** Rows can come and go with the other settings; this shows or hides one, announcing a newcomer. */
function syncHidden(el: HTMLElement, hidden: boolean, shownBefore: boolean): void {
  const wasHidden = el.hidden;
  el.hidden = hidden;
  if (shownBefore && wasHidden && !hidden) reveal(el);
}

/** Lets a row handle its own keys; what it consumes never reaches the menu around it. */
function keys(el: HTMLElement, handle: (e: KeyboardEvent) => boolean): void {
  el.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (handle(e)) {
      e.preventDefault();
      e.stopPropagation();
    }
  });
}

/** Makes a row focusable, unless it only shows a value. */
function focusable(el: HTMLElement, env: Env): void {
  if (env.readonly) {
    el.classList.add('is-readonly');
    el.setAttribute('aria-readonly', 'true');
  } else {
    el.tabIndex = 0;
  }
}

// ————————————————————————————— Slider —————————————————————————————

/** Ticks are only worth drawing while they stay apart. */
const MAX_TICKS = 12;

/** A track with a stop for every option: drag it, click it, or use the arrow keys. */
export function sliderControl(item: Item<'slider'>, env: Env): Control {
  const { steps } = item;
  const last = steps.length - 1;
  const value = h('span.slider__value', null);
  const fill = h('span.slider__fill', null);
  const thumb = h('span.slider__thumb', null);
  const ticks = steps.length <= MAX_TICKS ? steps.map((_, i) => {
    const tick = h('span.slider__tick', null);
    tick.style.setProperty('--at', String(positionOf(i, steps.length)));
    return tick;
  }) : [];
  const rail = h('span.slider__rail', null, fill, ...ticks, thumb);
  const track = h('span.slider__track', null, rail);
  const el = h('div.item.item--slider', { role: 'slider', 'aria-valuemin': '0', 'aria-valuemax': String(last), 'aria-label': item.label }, h('span.item__label', null, item.label), value, track);
  focusable(el, env);

  let shown = -1;
  const draw = (): void => {
    const hidden = item.hidden?.() ?? false;
    syncHidden(el, hidden, shown >= 0);
    el.classList.toggle('is-reserved', hidden && (item.reserve?.() ?? false));
    const i = indexOf(steps, item.get());
    el.style.setProperty('--pos', String(positionOf(i, steps.length)));
    ticks.forEach((tick, k) => tick.classList.toggle('is-on', k <= i));
    value.textContent = steps[i].label;
    el.setAttribute('aria-valuenow', String(i));
    el.setAttribute('aria-valuetext', steps[i].label);
    if (shown >= 0 && shown !== i) pop(value);
    shown = i;
  };

  /** Moves to a stop; true when that was a change. */
  const goTo = (i: number): boolean => {
    const next = Math.min(last, Math.max(0, i));
    if (next === indexOf(steps, item.get())) return false;
    item.set(steps[next].value);
    draw();
    env.sound?.tick(positionOf(next, steps.length));
    env.changed();
    return true;
  };

  if (!env.readonly) {
    let dragging = false;
    let moved = false;
    const aim = (e: PointerEvent): void => {
      const box = rail.getBoundingClientRect();
      if (goTo(indexAtFraction(box.width ? (e.clientX - box.left) / box.width : 0, steps.length))) moved = true;
    };
    track.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      dragging = true;
      moved = false;
      el.classList.add('is-dragging');
      track.setPointerCapture(e.pointerId);
      el.focus({ preventScroll: true });
      aim(e);
    });
    track.addEventListener('pointermove', (e) => dragging && aim(e));
    const release = (): void => {
      if (!dragging) return;
      dragging = false;
      el.classList.remove('is-dragging');
      // Only now is the edit done: an online room is told once, not at every stop on the way.
      if (moved) item.commit?.();
    };
    track.addEventListener('pointerup', release);
    track.addEventListener('pointercancel', release);

    const at = () => indexOf(steps, item.get());
    keys(el, (e) => {
      let target: number;
      switch (e.key) {
        case 'ArrowLeft':
          target = stepIndex(at(), -1, steps.length, false);
          break;
        case 'ArrowRight':
          target = stepIndex(at(), 1, steps.length, false);
          break;
        case 'Home':
          target = 0;
          break;
        case 'End':
          target = last;
          break;
        default:
          return false;
      }
      if (goTo(target)) item.commit?.();
      return true;
    });
  }

  draw();
  return { el, refresh: draw };
}

// ————————————————————————————— Toggle —————————————————————————————

/** An on/off switch: the whole row is the button. */
function toggleControl(item: Item<'toggle'>, env: Env): Control {
  const readout = h('span.item__readout', null);
  const el = h('div.item.item--toggle', { role: 'switch', 'aria-label': item.label }, h('span.item__label', null, item.label), h('span.switch', { 'aria-hidden': 'true' }, h('span.switch__knob', null)), readout);
  focusable(el, env);

  let drawn = false;
  const draw = (): void => {
    syncHidden(el, item.hidden?.() ?? false, drawn);
    drawn = true;
    const on = item.get();
    el.classList.toggle('is-on', on);
    el.setAttribute('aria-checked', String(on));
    readout.textContent = on ? t('common.on') : t('common.off');
  };
  const set = (on: boolean): void => {
    if (on === item.get()) return;
    item.set(on);
    draw();
    env.sound?.toggle(on);
    env.changed();
    item.commit?.();
  };

  if (!env.readonly) {
    el.addEventListener('click', () => set(!item.get()));
    // ← switches off, → on: the arrows mean the same here as on a slider.
    keys(el, (e) => {
      switch (e.key) {
        case 'ArrowLeft':
        case 'Home':
          set(false);
          return true;
        case 'ArrowRight':
        case 'End':
          set(true);
          return true;
        case 'Enter':
        case ' ':
          if (!e.repeat) set(!item.get());
          return true;
      }
      return false;
    });
  }

  draw();
  return { el, refresh: draw };
}

// ————————————————————————————— Segmented —————————————————————————————

/** A bar with one segment per option, the chosen one lit by a marker that slides over to a new choice. */
export function segmentedControl(item: Item<'segmented'>, env: Env): Control {
  const { options } = item;
  const segments = options.map((o, i) => {
    const seg = h('span.segmented__option', { role: 'radio' }, o.label);
    if (!env.readonly) seg.addEventListener('click', () => pick(i));
    return seg;
  });
  const bar = h('span.segmented', null, h('span.segmented__marker', { 'aria-hidden': 'true' }), ...segments);
  bar.style.setProperty('--n', String(options.length));
  const readout = h('span.item__readout', null);
  const el = h('div.item.item--segmented', { role: 'radiogroup', 'aria-label': item.label }, h('span.item__label', null, item.label), bar, readout);
  focusable(el, env);

  let drawn = false;
  const draw = (): void => {
    syncHidden(el, item.hidden?.() ?? false, drawn);
    drawn = true;
    const i = indexOf(options, item.get());
    readout.textContent = options[i].label;
    bar.style.setProperty('--i', String(i));
    segments.forEach((seg, k) => {
      seg.classList.toggle('is-on', k === i);
      seg.setAttribute('aria-checked', String(k === i));
    });
  };
  function pick(i: number): void {
    el.focus({ preventScroll: true });
    if (i === indexOf(options, item.get())) return;
    item.set(options[i].value);
    draw();
    env.sound?.tick(positionOf(i, options.length));
    env.changed();
    item.commit?.();
  }

  if (!env.readonly) {
    keys(el, (e) => {
      const at = indexOf(options, item.get());
      switch (e.key) {
        case 'ArrowLeft':
          pick(stepIndex(at, -1, options.length, false));
          return true;
        case 'ArrowRight':
          pick(stepIndex(at, 1, options.length, false));
          return true;
        case 'Home':
          pick(0);
          return true;
        case 'End':
          pick(options.length - 1);
          return true;
      }
      return false;
    });
  }

  draw();
  return { el, refresh: draw };
}

// ————————————————————————————— Choice —————————————————————————————

/** A row that cycles through a list of values: click it to go on, or use the arrows at its sides to go either way. */
function choiceControl(item: Item<'choice'>, env: Env): Control {
  const value = h('span.item__value', null);
  const arrow = (dir: 1 | -1) => {
    const a = h('span.item__arrow', { 'aria-hidden': 'true' }, dir === 1 ? '›' : '‹');
    // The row itself goes forward; the arrows must not trigger that on top.
    a.addEventListener('click', (e) => {
      e.stopPropagation();
      step(dir);
    });
    return a;
  };
  const name = h('span.item__name', null, h('span.item__label', null, item.label));
  if (item.swatch) {
    const swatch = h('span.item__swatch', { 'aria-hidden': 'true' });
    swatch.style.background = item.swatch;
    name.prepend(swatch);
  }
  const el = h('button.item.item--choice', { type: 'button' }, name, h('span.item__picker', null, arrow(-1), value, arrow(1)));

  let drawn = false;
  const draw = (): void => {
    syncHidden(el, item.hidden?.() ?? false, drawn);
    drawn = true;
    const current = item.options.find((o) => o.value === item.get());
    value.textContent = current?.label ?? String(item.get());
    const disabled = item.disabled?.() ?? false;
    el.classList.toggle('is-disabled', disabled);
    el.setAttribute('aria-disabled', String(disabled));
    el.setAttribute('aria-label', `${item.label}: ${value.textContent}`);
  };
  function step(dir: 1 | -1): void {
    if (item.disabled?.()) return;
    const next = item.options[stepIndex(item.options.findIndex((o) => o.value === item.get()), dir, item.options.length, true)];
    item.set(next.value);
    draw();
    env.sound?.blip();
    pop(value);
    env.changed();
    item.commit?.();
  }
  el.addEventListener('click', () => step(1));
  keys(el, (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return false;
    step(e.key === 'ArrowRight' ? 1 : -1);
    return true;
  });

  draw();
  return { el, refresh: draw };
}

// ————————————————————————————— Seat —————————————————————————————

/**
 * One ship of the line-up: who flies it, which team it is in, and a way to take it out. The row is
 * one stop for ↑/↓; ←/→ move a cursor over its buttons and Enter presses the one it is on.
 */
function seatControl(item: Item<'seat'>, env: Env): Control {
  /** What each button does, in the order the cursor visits them. */
  const buttons: { el: HTMLElement; skip(): boolean; press(): void; draw(): void }[] = [];

  const pill = (label: string, tone?: string): HTMLElement => {
    const p = h('span.pill', null, label);
    if (tone) {
      p.classList.add('pill--tone');
      p.style.setProperty('--tone', tone);
    }
    return p;
  };

  const fliers = h('span.seat__group', { role: 'radiogroup', 'aria-label': item.label });
  item.fliers.forEach((flier, i) => {
    // The CPU levels sit behind a small caption, apart from the human.
    if (i === 1) fliers.append(h('span.seat__caption', null, item.cpuCaption));
    const el = pill(flier.label);
    el.setAttribute('role', 'radio');
    fliers.append(el);
    buttons.push({
      el,
      skip: () => false,
      press: () => item.set(flier.value),
      draw: () => {
        const on = item.get() === flier.value;
        el.classList.toggle('is-on', on);
        el.setAttribute('aria-checked', String(on));
      },
    });
  });

  const cells: HTMLElement[] = [fliers];
  if (item.teams) {
    const { teams } = item;
    const group = h('span.seat__group.seat__group--teams', { role: 'radiogroup' }, h('span.seat__caption', null, teams.caption));
    teams.options.forEach((team, i) => {
      const el = pill(team.label, teams.tones[i]);
      el.setAttribute('role', 'radio');
      group.append(el);
      buttons.push({
        el,
        skip: () => false,
        press: () => teams.set(team.value),
        draw: () => {
          const on = teams.get() === team.value;
          el.classList.toggle('is-on', on);
          el.setAttribute('aria-checked', String(on));
        },
      });
    });
    cells.push(group);
  }
  if (item.remove) {
    const { remove } = item;
    const el = h('span.pill.pill--remove', { role: 'button', 'aria-label': remove.label, title: remove.label }, '✕');
    buttons.push({
      el,
      skip: () => remove.disabled(),
      press: () => remove.run(),
      draw: () => {
        el.classList.toggle('is-disabled', remove.disabled());
        el.setAttribute('aria-disabled', String(remove.disabled()));
      },
    });
    cells.push(h('span.seat__remove', null, el));
  }

  const name = h('span.item__name.seat__name', null, h('span.item__label', null, item.label));
  const swatch = h('span.item__swatch', { 'aria-hidden': 'true' });
  swatch.style.background = item.swatch;
  name.prepend(swatch);
  const el = h('div.item.item--seat', { role: 'group', 'aria-label': item.label }, name, h('span.seat__cells', null, ...cells));
  focusable(el, env);

  /** The button the cursor is on. */
  let cursor = Math.max(0, item.fliers.findIndex((f) => f.value === item.get()));
  const draw = (): void => {
    syncHidden(el, item.hidden?.() ?? false, true);
    if (item.teams) {
      // In team play the ship flies in its team's colour: the row, its dot and its team bar all say so.
      const tone = item.teams.tones[item.teams.options.findIndex((o) => o.value === item.teams!.get())];
      el.classList.add('item--teamed');
      el.style.setProperty('--team', tone);
      swatch.style.background = tone;
    }
    buttons.forEach((b, i) => {
      b.draw();
      b.el.classList.toggle('is-cursor', i === cursor);
    });
  };
  const press = (i: number): void => {
    const b = buttons[i];
    if (!b || b.skip()) return;
    cursor = i;
    b.press();
    env.sound?.blip();
    env.changed();
    draw();
  };

  if (!env.readonly) {
    buttons.forEach((b, i) =>
      b.el.addEventListener('click', () => {
        el.focus({ preventScroll: true });
        press(i);
      }),
    );
    const move = (dir: 1 | -1): void => {
      for (let i = cursor + dir; i >= 0 && i < buttons.length; i += dir) {
        if (!buttons[i].skip()) {
          cursor = i;
          break;
        }
      }
      draw();
    };
    keys(el, (e) => {
      switch (e.key) {
        case 'ArrowLeft':
          move(-1);
          return true;
        case 'ArrowRight':
          move(1);
          return true;
        case 'Enter':
        case ' ':
          if (!e.repeat) press(cursor);
          return true;
      }
      return false;
    });
  }

  draw();
  return { el, refresh: draw };
}
