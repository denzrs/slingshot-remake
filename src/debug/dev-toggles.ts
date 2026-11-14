import './dev-toggles.css';
import { t } from '../platform/i18n';
import { EXPERIMENT_NAMES, EXPERIMENT_PARAM, EXPERIMENTS, experimentsFrom } from '../game/experiments';

/** A pad with the standard layout that is plugged in and untouched: the game takes it for a real one. */
export const FAKE_PAD = { connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false })) };

let fakePad = false;

/** Whether the pretend pad is switched on: the game adds `FAKE_PAD` after the real ones, which keep their numbers. */
export const fakePadOn = (): boolean => fakePad;

export interface DevTogglesHost {
  colorblind: { get(): boolean; set(on: boolean): void };
  /** The pretend pad was switched on (hints speak of its buttons, settings and tutorial know a pad) or off. */
  pad: { set(on: boolean): void };
  /** The experiments the match on screen plays by: none in the menus, online, or in a replay, whatever the address asks for. */
  experiments(): readonly string[];
}

/** How often the chip looks at the match on screen, in ms: matches start and end in many places, and none has to tell it. */
const CHIP_INTERVAL = 250;

/**
 * The dev build's switches for the two accessibility modes, on the game's own page, so any screen can be looked at
 * either way: the colour-blind colours with seat numbers, and a controller that is plugged in (and was used last).
 * The panel only shows when the page was opened with `?debug` (or one of the two below); `?colorblind=1` and `?pad=1`
 * start them on, for links and screenshots.
 */
export function mountDevToggles(host: DevTogglesHost): { sync(): void } {
  const params = new URLSearchParams(location.search);
  if (!['debug', 'colorblind', 'pad', EXPERIMENT_PARAM].some((name) => params.has(name))) return { sync() {} };
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

  // Rule ideas on trial: a switch each (they are the dev build's own words, not translated), and a chip while the match
  // on screen plays by any. The switches show what the address asks for; the chip only what is really being played.
  const trying = experimentsFrom(location.search);
  const chip = document.createElement('div');
  chip.className = 'dev-experiment-chip';
  chip.hidden = true;
  document.body.append(chip);
  let shown = '';
  const showPlayed = (): void => {
    const played = host.experiments().join(', ');
    if (played === shown) return;
    shown = played;
    chip.hidden = !played;
    chip.textContent = `EXPERIMENT: ${played}`;
  };
  showPlayed();
  setInterval(showPlayed, CHIP_INTERVAL);
  for (const name of EXPERIMENT_NAMES) {
    const { row, input } = box(`${name} (${EXPERIMENTS[name]})`);
    input.checked = trying.includes(name);
    input.addEventListener('change', () => {
      const next = new Set(experimentsFrom(location.search));
      if (input.checked) next.add(name);
      else next.delete(name);
      const url = new URL(location.href);
      if (next.size) url.searchParams.set(EXPERIMENT_PARAM, EXPERIMENT_NAMES.filter((n) => next.has(n)).join(','));
      else url.searchParams.delete(EXPERIMENT_PARAM);
      // An experiment is read when a match starts: the next one plays by it.
      location.assign(url);
    });
    panel.append(row);
  }

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
  panel.open = colorblind.input.checked || pad.input.checked || trying.length > 0;
  return { sync };
}
