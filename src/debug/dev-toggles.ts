import './dev-toggles.css';
import { t } from '../platform/i18n';

/** A pad with the standard layout that is plugged in and untouched: the game takes it for a real one. */
export const FAKE_PAD = { connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false })) };

let fakePad = false;

/** Whether the pretend pad is switched on: the game adds `FAKE_PAD` after the real ones, which keep their numbers. */
export const fakePadOn = (): boolean => fakePad;

export interface DevTogglesHost {
  colorblind: { get(): boolean; set(on: boolean): void };
  /** The pretend pad was switched on (hints speak of its buttons, settings and tutorial know a pad) or off. */
  pad: { set(on: boolean): void };
}

/**
 * The dev build's switches for the two accessibility modes, on the game's own page, so any screen can be looked at
 * either way: the colour-blind colours with seat numbers, and a controller that is plugged in (and was used last).
 * `?colorblind=1` and `?pad=1` start them on, for links and screenshots.
 */
export function mountDevToggles(host: DevTogglesHost): { sync(): void } {
  const box = (label: string): { row: HTMLLabelElement; input: HTMLInputElement } => {
    const input = document.createElement('input');
    input.type = 'checkbox';
    const row = document.createElement('label');
    row.append(input, ` ${label}`);
    return { row, input };
  };
  const colorblind = box(t('dev.toggles.colorblind'));
  const pad = box(t('dev.toggles.pad'));
  const panel = document.createElement('details');
  panel.className = 'dev-toggles';
  const summary = document.createElement('summary');
  summary.textContent = 'DEV';
  panel.append(summary, colorblind.row, pad.row);
  document.body.append(panel);

  const params = new URLSearchParams(location.search);
  colorblind.input.addEventListener('change', () => {
    host.colorblind.set(colorblind.input.checked);
    colorblind.input.blur();
  });
  pad.input.addEventListener('change', () => {
    fakePad = pad.input.checked;
    host.pad.set(fakePad);
    pad.input.blur();
  });
  if (params.get('colorblind') === '1') host.colorblind.set(true);
  if (params.get('pad') === '1') {
    pad.input.checked = fakePad = true;
    host.pad.set(true);
  }
  const sync = (): void => {
    colorblind.input.checked = host.colorblind.get();
  };
  sync();
  panel.open = colorblind.input.checked || pad.input.checked;
  return { sync };
}
