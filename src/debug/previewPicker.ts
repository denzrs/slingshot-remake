import type { SuddenDeathKind } from '../sim/config';
import { SUDDEN_DEATH_PREVIEWS, type SuddenDeathPreview } from './suddenDeathDemo';

/** The preview that shows each kind of sudden death: a new kind has to be given one here, or this file does not compile. */
export const PREVIEW_OF_KIND: Record<SuddenDeathKind, SuddenDeathPreview> = {
  gravity: 'gravity',
  collision: 'collision',
  overcharge: 'overcharge',
  meteors: 'meteors',
  ufos: 'ufos',
  redGiant: 'supernova',
};

/** How the picker names and describes each preview. Dev-only tooling, so English only. */
export const PREVIEW_ABOUT: Record<SuddenDeathPreview, { name: string; where: string; text: string }> = {
  gravity: { name: 'Gravity well', where: 'Classic', text: 'Every ship pulls its enemies’ shots in, harder each pass. Ships shoot a little wide.' },
  collision: { name: 'Collision course', where: 'Classic', text: 'The engines fail: every ship drifts toward the middle, a little further each pass.' },
  overcharge: { name: 'Overcharge', where: 'Classic', text: 'Every ship’s hit zone grows each pass (the dashed ring). Ships shoot a little wide.' },
  meteors: { name: 'Meteor shower', where: 'Classic, finale', text: 'After pass 13 a meteor takes every ship and every planet.' },
  ufos: { name: 'UFO invasion', where: 'Classic, finale', text: 'After pass 13 a saucer zaps every ship and every planet.' },
  supernova: { name: 'Red giant and supernova', where: 'Solar System, finale', text: 'The sun swells, swallows what it reaches, then goes supernova.' },
};

/** A small DOM helper of this file's own (`debug/` stands below `ui/`, so it cannot use `ui/dom`): el('div.class', {attrs}, ...children). */
function h(tag: string, attrs: Record<string, string> | null, ...children: (Node | string)[]): HTMLElement {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name);
  if (classes.length) el.className = classes.join(' ');
  if (attrs) for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.append(...children);
  return el;
}

/** The previews in the order the kinds are listed. */
export const PICKER_ORDER: readonly SuddenDeathPreview[] = (Object.keys(PREVIEW_OF_KIND) as SuddenDeathKind[]).map((kind) => PREVIEW_OF_KIND[kind]);

const STYLE = `
.preview-picker { position: fixed; inset: 0; z-index: 9999; display: flex; align-items: center; justify-content: center; pointer-events: none; font: 14px/1.4 system-ui, sans-serif; color: #e8e2d0; }
.preview-picker[hidden] { display: none; }
.preview-picker .pp-card { pointer-events: auto; background: rgba(9, 14, 32, 0.94); border: 1px solid rgba(232, 226, 208, 0.25); border-radius: 12px; padding: 22px; width: min(92vw, 760px); box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5); }
.preview-picker h1 { margin: 0 0 4px; font-size: 20px; letter-spacing: 0.08em; text-transform: uppercase; }
.preview-picker p { margin: 0 0 16px; opacity: 0.7; }
.preview-picker .pp-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 10px; }
.preview-picker .pp-item { text-align: left; font: inherit; color: inherit; background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(232, 226, 208, 0.2); border-radius: 8px; padding: 12px; cursor: pointer; }
.preview-picker .pp-item:hover, .preview-picker .pp-item:focus-visible { border-color: #ff7a5a; background: rgba(255, 122, 90, 0.12); outline: none; }
.preview-picker .pp-item[aria-pressed='true'] { border-color: #ff7a5a; background: rgba(255, 122, 90, 0.2); }
.preview-picker .pp-name { display: block; font-weight: 700; }
.preview-picker .pp-where { display: block; font-size: 12px; opacity: 0.6; margin-bottom: 4px; }
.preview-picker .pp-text { display: block; font-size: 13px; opacity: 0.85; }
.preview-picker .pp-pill { display: none; }
.preview-picker.has-pick { align-items: flex-end; justify-content: flex-start; }
.preview-picker.has-pick .pp-card { width: auto; max-width: calc(100vw - 20px); margin: 10px; padding: 0; background: none; border: 0; box-shadow: none; display: flex; flex-direction: column-reverse; align-items: flex-start; gap: 6px; }
.preview-picker.has-pick h1, .preview-picker.has-pick p, .preview-picker.has-pick .pp-where, .preview-picker.has-pick .pp-text { display: none; }
.preview-picker.has-pick .pp-pill { display: block; font: inherit; font-size: 12px; color: inherit; background: rgba(9, 14, 32, 0.7); border: 1px solid rgba(232, 226, 208, 0.25); border-radius: 999px; padding: 5px 12px; cursor: pointer; opacity: 0.55; }
.preview-picker.has-pick .pp-pill:hover, .preview-picker.has-pick .pp-pill:focus-visible, .preview-picker.has-pick.is-open .pp-pill { opacity: 1; outline: none; }
.preview-picker.has-pick .pp-list { display: none; flex-direction: column; gap: 6px; background: rgba(9, 14, 32, 0.94); border: 1px solid rgba(232, 226, 208, 0.25); border-radius: 12px; padding: 8px; }
.preview-picker.has-pick.is-open .pp-list { display: flex; }
.preview-picker.has-pick .pp-item { padding: 6px 12px; white-space: nowrap; }
`;

export interface PreviewPicker {
  /** Marks `name` as the preview that is playing (and folds the picker into a small button in the corner). */
  select(name: SuddenDeathPreview): void;
  /** Shows or hides the picker (it is hidden while a menu is open). */
  show(visible: boolean): void;
  /** Takes the picker off the page for good. */
  destroy(): void;
}

/**
 * Dev-only: a card that lists every kind of sudden death with a line on what it does, so one can be clicked to watch
 * instead of remembering its `?preview=` name. Once one is playing the card folds into a small button in the bottom
 * left corner (out of the way of the scoreboard and the round label) that opens the list again to switch.
 */
export function mountPreviewPicker(active: SuddenDeathPreview | null, onPick: (name: SuddenDeathPreview) => void): PreviewPicker {
  const style = h('style', null, STYLE);
  const buttons = new Map<SuddenDeathPreview, HTMLElement>();
  const list = h('div.pp-list', null);
  for (const name of PICKER_ORDER.filter((n) => SUDDEN_DEATH_PREVIEWS.includes(n))) {
    const about = PREVIEW_ABOUT[name];
    const button = h('button.pp-item', { type: 'button', 'aria-pressed': 'false' }, h('span.pp-name', null, about.name), h('span.pp-where', null, about.where), h('span.pp-text', null, about.text));
    button.addEventListener('click', () => {
      // Space and Enter belong to the game: a focused button would be pressed again by them.
      button.blur();
      onPick(name);
    });
    buttons.set(name, button);
    list.append(button);
  }
  const pill = h('button.pp-pill', { type: 'button', 'aria-expanded': 'false' }, '');
  const root = h('div.preview-picker', null, h('div.pp-card', null, h('h1', null, 'Sudden death'), h('p', null, 'Pick one to watch it on a loop (dev only).'), list, pill));
  document.head.append(style);
  document.body.append(root);

  const open = (isOpen: boolean): void => {
    root.classList.toggle('is-open', isOpen);
    pill.setAttribute('aria-expanded', String(isOpen));
  };
  pill.addEventListener('click', () => {
    pill.blur();
    open(!root.classList.contains('is-open'));
  });
  const select = (name: SuddenDeathPreview): void => {
    root.classList.add('has-pick');
    open(false);
    pill.textContent = `Sudden death \u00b7 ${PREVIEW_ABOUT[name].name} \u25be`;
    for (const [n, button] of buttons) button.setAttribute('aria-pressed', String(n === name));
  };
  if (active) select(active);
  return {
    select,
    show: (visible) => {
      root.hidden = !visible;
    },
    destroy: () => {
      root.remove();
      style.remove();
    },
  };
}
