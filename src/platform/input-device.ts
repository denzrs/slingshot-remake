import { t, type Key } from './i18n';

/** What a person last played or navigated with: the hints on screen name its keys. */
export type InputDevice = 'keyboard' | 'pointer' | 'pad';

let last: InputDevice = 'keyboard';

export const lastInput = (): InputDevice => last;

/** Whether the hints speak of the controller's buttons: it was used last (and is switched on). */
export const padMode = (): boolean => last === 'pad';

/** Notes what was used; true when that turns the hints from keys to buttons or back. */
export function noteInput(device: InputDevice): boolean {
  const before = padMode();
  last = device;
  return before !== padMode();
}

/** Texts that have a twin written for the pad, under the same key with `.pad` after it. */
type PadTwin =
  | 'shell.keys' | 'launcher.keys' | 'flow.tabKeys' | 'briefing.keys' | 'title.keys' | 'setup.keys' | 'over.keys'
  | 'onboarding.keys' | 'players.moveTarget' | 'tutorial.welcome.3' | 'tutorial.powerups.1' | 'skip.confirm';

/** A hint in the words of the device that was used last. */
export function hintText(key: PadTwin, params?: Record<string, string | number>): string {
  return t(padMode() ? (`${key}.pad` as const) satisfies Key : key, params);
}

/** The keycaps of the keyboard and what stands for each on the controller. */
const PAD_CAPS: Readonly<Record<string, string>> = {
  Q: 'LB',
  E: 'RB',
  Enter: 'A',
  Space: 'A',
  Leertaste: 'A',
  Esc: 'B',
  C: 'Back',
  P: 'X',
  N: 'Y',
  '← →': 'L-Stick ← →',
  '↑ ↓': 'L-Stick ↑ ↓',
};

/** A keycap as it should read now: the same key on a keyboard, the button that does the same on a controller. */
export function cap(key: string): string {
  return padMode() ? PAD_CAPS[key] ?? key : key;
}
