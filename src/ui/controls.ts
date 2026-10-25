import type { Sound } from '../audio';
import { t } from '../i18n';
import { h } from './dom';
import type { MenuItem } from './menu';
import { pilotArt } from './mode-icons';
import './player-slots.css';

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
    case 'tiles':
      return tilesControl(item, env);
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
  const inactive = (): boolean => item.inactive?.() ?? false;

  let shown = -1;
  const draw = (): void => {
    const hidden = item.hidden?.() ?? false;
    syncHidden(el, hidden, shown >= 0);
    el.classList.toggle('is-reserved', hidden && (item.reserve?.() ?? false));
    const off = inactive();
    el.classList.toggle('is-inactive', off);
    el.setAttribute('aria-disabled', String(off));
    const i = off ? 0 : indexOf(steps, item.get());
    el.style.setProperty('--pos', String(positionOf(i, steps.length)));
    ticks.forEach((tick, k) => tick.classList.toggle('is-on', !off && k <= i));
    value.textContent = off ? t('common.off') : steps[i].label;
    el.setAttribute('aria-valuenow', String(i));
    el.setAttribute('aria-valuetext', value.textContent);
    if (shown >= 0 && shown !== i) pop(value);
    shown = i;
  };

  /** Moves to a stop; true when that was a change. */
  const goTo = (i: number): boolean => {
    if (inactive()) return false;
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
      if (e.button !== 0 || inactive()) return;
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
      if (inactive()) return false;
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
  // The rules page shows the switch as an off / on bar like its other choices; every other page keeps the switch.
  const offOption = h('span.segmented__option', null, t('common.off'));
  const onOption = h('span.segmented__option', null, t('common.on'));
  const bar = h('span.segmented.toggle-bar', { 'aria-hidden': 'true' }, h('span.segmented__marker', null), offOption, onOption);
  bar.style.setProperty('--n', '2');
  const el = h('div.item.item--toggle', { role: 'switch', 'aria-label': item.label }, h('span.item__label', null, item.label), h('span.switch', { 'aria-hidden': 'true' }, h('span.switch__knob', null)), bar, readout);
  focusable(el, env);

  let drawn = false;
  const draw = (): void => {
    syncHidden(el, item.hidden?.() ?? false, drawn);
    drawn = true;
    const on = item.get();
    el.classList.toggle('is-on', on);
    el.setAttribute('aria-checked', String(on));
    readout.textContent = on ? t('common.on') : t('common.off');
    bar.style.setProperty('--i', on ? '1' : '0');
    offOption.classList.toggle('is-on', !on);
    onOption.classList.toggle('is-on', on);
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
    // A click on one side of the bar picks that side, rather than flipping whatever is set.
    for (const [option, on] of [[offOption, false], [onOption, true]] as const) {
      option.addEventListener('click', (e) => { e.stopPropagation(); el.focus({ preventScroll: true }); set(on); });
    }
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
    const hidden = item.hidden?.() ?? false;
    syncHidden(el, hidden, drawn);
    el.classList.toggle('is-reserved', hidden && (item.reserve?.() ?? false));
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

// ————————————————————————————— Tiles —————————————————————————————

const TILE_ICON = 34;

/**
 * A row of tiles with a symbol each, every one on or off on its own: click or tap a tile, or move the cursor
 * with ←/→ and press Enter. Some groups allow every tile to be off.
 */
function tilesControl(item: Item<'tiles'>, env: Env): Control {
  const { tiles } = item;
  let cursor = 0;
  const dpr = typeof devicePixelRatio === 'number' ? Math.max(1, devicePixelRatio) : 1;
  const cells = tiles.map((tile, i) => {
    const icon = h('canvas.tile__icon', { width: String(Math.round(TILE_ICON * dpr)), height: String(Math.round(TILE_ICON * dpr)), 'aria-hidden': 'true' }) as HTMLCanvasElement;
    const cell = h('span.tile', { role: 'checkbox', 'aria-label': tile.label }, icon, h('span.tile__name', null, tile.label));
    cell.style.setProperty('--tone', tile.color);
    if (!env.readonly) cell.addEventListener('click', () => {
      el.focus({ preventScroll: true });
      cursor = i;
      toggle(i);
    });
    return { cell, icon };
  });
  const row = h('span.tiles', null, ...cells.map((c) => c.cell));
  const quickButton = (text: string, key: string, on: boolean) => {
    const b = h('button.tiles__quick', { type: 'button', tabindex: '-1', title: `${text} (${key})` }, text);
    b.addEventListener('click', () => {
      el.focus({ preventScroll: true });
      setAll(on);
    });
    return b;
  };
  const quick = item.quick && !env.readonly ? { all: quickButton(item.quick.all, 'A', true), none: quickButton(item.quick.none, 'N', false) } : null;
  const el = h('div.item.item--tiles', { role: 'group', 'aria-label': item.label },
    quick ? h('span.tiles__head', null, h('span.item__label', null, item.label), h('span.tiles__quick-row', null, quick.all, quick.none)) : h('span.item__label', null, item.label),
    row);
  focusable(el, env);

  const isOn = (i: number): boolean => item.get().includes(tiles[i].value);
  let drawn = false;
  const draw = (): void => {
    const hidden = item.hidden?.() ?? false;
    syncHidden(el, hidden, drawn);
    el.classList.toggle('is-reserved', hidden && (item.reserve?.() ?? false));
    drawn = true;
    cells.forEach(({ cell, icon }, i) => {
      const on = isOn(i);
      cell.classList.toggle('is-on', on);
      cell.classList.toggle('is-cursor', !env.readonly && i === cursor);
      cell.setAttribute('aria-checked', String(on));
      const ctx = icon.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, icon.width, icon.height);
      ctx.translate(icon.width / 2, icon.height / 2);
      ctx.scale(dpr, dpr);
      ctx.globalAlpha = on ? 1 : 0.4;
      ctx.strokeStyle = ctx.fillStyle = on ? tiles[i].color : '#8fa3c4';
      ctx.lineWidth = 2.2;
      ctx.lineCap = ctx.lineJoin = 'round';
      tiles[i].draw(ctx, TILE_ICON * 0.36);
    });
    if (quick) {
      const count = tiles.filter((_, i) => isOn(i)).length;
      quick.all.classList.toggle('is-on', count === tiles.length);
      quick.none.classList.toggle('is-on', count === 0);
    }
  };
  function toggle(i: number): void {
    const wasOn = isOn(i);
    const next = tiles.filter((_, k) => (k === i ? !wasOn : isOn(k))).map((tile) => tile.value);
    if (!next.length && !item.allowEmpty) {
      draw();
      env.sound?.blip();
      return;
    }
    item.set(next);
    draw();
    env.sound?.toggle(!wasOn);
    env.changed();
    item.commit?.();
  }

  /** Every tile on or, where a group may be empty, every one off. */
  function setAll(on: boolean): void {
    const next = on ? tiles.map((tile) => tile.value) : [];
    if (!next.length && !item.allowEmpty) return;
    if (next.length === item.get().length) return;
    item.set(next);
    draw();
    env.sound?.toggle(on);
    env.changed();
    item.commit?.();
  }

  if (!env.readonly) {
    el.addEventListener('focus', draw);
    keys(el, (e) => {
      switch (e.key) {
        case 'a':
        case 'A':
          if (!item.quick) return false;
          setAll(true);
          return true;
        case 'n':
        case 'N':
          if (!item.quick) return false;
          setAll(false);
          return true;
        case 'ArrowLeft':
          cursor = stepIndex(cursor, -1, tiles.length, false);
          break;
        case 'ArrowRight':
          cursor = stepIndex(cursor, 1, tiles.length, false);
          break;
        case 'Home':
          cursor = 0;
          break;
        case 'End':
          cursor = tiles.length - 1;
          break;
        case 'Enter':
        case ' ':
          if (!e.repeat) toggle(cursor);
          return true;
        default:
          return false;
      }
      draw();
      env.sound?.tick(positionOf(cursor, tiles.length));
      return true;
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

/** A compact radio selector with every option visible, shared by local and online CPU seats. */
export function optionSelector<T>(label: string, choices: readonly { value: T; label: string }[], get: () => T, change: (value: T) => void): Control {
  const el = h('div.option-selector', { role: 'radiogroup', 'aria-label': label });
  const buttons = choices.map((choice, index) => {
    const button = h('button.option-selector__choice', { type: 'button', role: 'radio', title: choice.label },
      h('span.option-selector__rank', { 'aria-hidden': 'true' }, ...choices.map((_, i) => h(i <= index ? 'i.is-on' : 'i', null))),
      h('span', null, choice.label),
    ) as HTMLButtonElement;
    const choose = () => { change(choice.value); refresh(); };
    button.addEventListener('click', choose);
    keys(button, (event) => {
      const direction = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1 : direction ? (index + direction + choices.length) % choices.length : -1;
      if (next < 0) return false;
      change(choices[next].value);
      refresh();
      buttons[next].focus();
      return true;
    });
    return button;
  });
  const refresh = () => buttons.forEach((button, i) => {
    const selected = choices[i].value === get();
    button.setAttribute('aria-checked', String(selected));
    button.tabIndex = selected ? 0 : -1;
  });
  el.append(...buttons);
  refresh();
  return { el, refresh };
}

// ————————————————————————————— Seat —————————————————————————————

/** A ship card: choose human or CPU first; CPU strength fades in over the portrait slot when it applies. */
function seatControl(item: Item<'seat'>, env: Env): Control {
  let lastCpu = item.get() === 'human' ? item.lastCpu?.() ?? item.fliers[2]?.value ?? item.fliers[1].value : item.get();
  const human = h('button.pilot__type', { type: 'button' }, item.fliers[0].label) as HTMLButtonElement;
  const cpu = h('button.pilot__type', { type: 'button' }, item.cpuCaption) as HTMLButtonElement;
  human.setAttribute('role', 'radio');
  cpu.setAttribute('role', 'radio');
  const types = h('div.pilot__types', { role: 'radiogroup', 'aria-label': `${item.label} · ${t('players.assignment')}` }, human, cpu);
  const kind = h('span.slot-card__kind', null);
  const header = h('div.slot-card__head', null, h('span.pilot__name', null, item.label), kind);
  const identity = h('div.slot-card__portrait.pilot__picture', { 'aria-hidden': 'true' }, pilotArt());
  const assignment = h('div.pilot__assignment', null,
    h('span.pilot__section-label', null, t('players.assignment')),
    types,
  );
  const level = optionSelector(`${item.label} · ${t('flow.cpuLevel')}`, item.fliers.slice(1), item.get, (value) => set(value));
  const options = h('div.pilot__options', null, level.el);
  // Portrait and strength picker share one fixed-height body so switching Mensch/CPU never resizes the card.
  const body = h('div.pilot__body', null, identity, options);
  const el = h('div.item.item--seat.pilot.slot-card', { role: 'group', 'aria-label': item.label }, header, body, assignment);
  let removeButton: HTMLButtonElement | undefined;
  if (item.remove) {
    removeButton = h('button.pilot__remove', { type: 'button', 'aria-label': item.remove.label, title: item.remove.label }, '×') as HTMLButtonElement;
    removeButton.addEventListener('click', () => { if (!item.remove!.disabled()) item.remove!.run(); });
    el.append(removeButton);
  }
  focusable(el, env);
  const draw = () => {
    const isCpu = item.get() !== item.fliers[0].value;
    el.classList.toggle('is-cpu', isCpu);
    kind.textContent = t(isCpu ? 'players.cpu' : 'slots.local');
    human.setAttribute('aria-pressed', String(!isCpu));
    cpu.setAttribute('aria-pressed', String(isCpu));
    human.setAttribute('aria-checked', String(!isCpu));
    cpu.setAttribute('aria-checked', String(isCpu));
    human.tabIndex = isCpu ? -1 : 0;
    cpu.tabIndex = isCpu ? 0 : -1;
    level.refresh();
    if (removeButton) removeButton.disabled = item.remove!.disabled();
    el.style.setProperty('--slot-tone', item.swatch);
  };
  const set = (value: unknown) => {
    if (env.readonly) return;
    item.set(value);
    if (value !== item.fliers[0].value) {
      lastCpu = value;
      item.rememberCpu?.(value);
    }
    env.sound?.blip();
    env.changed();
    draw();
  };
  human.addEventListener('click', () => set(item.fliers[0].value));
  cpu.addEventListener('click', () => set(lastCpu));
  human.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowRight') return;
    event.preventDefault();
    event.stopPropagation();
    cpu.focus();
    set(lastCpu);
  });
  cpu.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft') return;
    event.preventDefault();
    event.stopPropagation();
    human.focus();
    set(item.fliers[0].value);
  });
  keys(el, (e) => {
    if (e.target !== el) return false;
    if (e.key === 'ArrowLeft') { set(item.fliers[0].value); return true; }
    if (e.key === 'ArrowRight') { set(lastCpu); return true; }
    if (e.key === 'Enter' || e.key === ' ') { (item.get() === item.fliers[0].value ? human : cpu).focus(); return true; }
    return false;
  });
  draw();
  return { el, refresh: draw };
}
